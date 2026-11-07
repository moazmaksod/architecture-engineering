import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import {
  issueApprovalToken,
  verifyApprovalToken,
  revokeToken,
  resetTokenRegistries,
  isPathAuthorized,
  loadRegistry,
  APPROVAL_VERSION,
} from "../scripts/approval-token.mjs";

const TEST_SECRET = "test-cryptographic-secret-key-32bytes!";

function runApprovalGate(input, env = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve("scripts/approval-gate.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ARCH_APPROVAL_SECRET: TEST_SECRET, ...env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`Exit code ${code}: ${stderr}`));
      } else {
        try {
          resolvePromise(JSON.parse(stdout.trim()));
        } catch (e) {
          rejectPromise(new Error(`Unparseable stdout: "${stdout}", error: ${e.message}`));
        }
      }
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

test("Phase 5 — Approval Gate & Lifecycle Security Hardening Tests", async (t) => {
  const testWorkspace = resolve("tests/fixtures/tmp-security-test-ws");
  const testRegistryPath = resolve("tests/fixtures/tmp-security-test-ws/token-registry.json");

  t.beforeEach(() => {
    if (existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true, force: true });
    }
    mkdirSync(join(testWorkspace, "src"), { recursive: true });
    writeFileSync(join(testWorkspace, "src", "target.js"), "// target file", "utf-8");
    resetTokenRegistries(testRegistryPath);
  });

  t.afterEach(() => {
    if (existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  // ==========================================
  // 1. TOKEN INTEGRITY
  // ==========================================

  await t.test("Token Integrity: valid token is successfully issued and verified", () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/target.js"] },
        issuedBy: "human:lead",
      },
      TEST_SECRET
    );

    assert.equal(token.tokenVersion, APPROVAL_VERSION);
    assert.equal(token.payload.taskId, "TASK-001");
    assert.equal(token.payload.proposalId, "PROP-001");
    assert.ok(typeof token.signature === "string" && token.signature.length === 64);

    const verification = verifyApprovalToken(token, TEST_SECRET, {
      registryPath: testRegistryPath,
    });
    assert.equal(verification.valid, true);
    assert.equal(verification.payload.taskId, "TASK-001");
  });

  await t.test("Token Integrity: missing or empty signing secret fails closed", () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    assert.throws(
      () => issueApprovalToken({ taskId: "T1", proposalId: "P1", approvedScope: { paths: ["src/*"] } }, ""),
      /A non-empty string secret is required/
    );

    const verif1 = verifyApprovalToken(token, "", { registryPath: testRegistryPath });
    assert.equal(verif1.valid, false);
    assert.ok(verif1.reason.includes("missing or empty verification secret"));
  });

  await t.test("Token Integrity: rejects invalid signature or wrong secret", () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    const wrongSecretVerif = verifyApprovalToken(token, "wrong-secret-key-attacker", {
      registryPath: testRegistryPath,
    });
    assert.equal(wrongSecretVerif.valid, false);
    assert.ok(wrongSecretVerif.reason.includes("invalid signature"));

    // Tampered signature
    const tamperedSig = { ...token, signature: "a".repeat(64) };
    const tamperedVerif = verifyApprovalToken(tamperedSig, TEST_SECRET, {
      registryPath: testRegistryPath,
    });
    assert.equal(tamperedVerif.valid, false);
    assert.ok(tamperedVerif.reason.includes("invalid signature"));
  });

  await t.test("Token Integrity: rejects tampered payload (scope expansion attack)", () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    const tamperedToken = {
      ...token,
      payload: {
        ...token.payload,
        approvedScope: { paths: ["src/target.js", "src/critical-auth.js"] },
      },
    };

    const verif = verifyApprovalToken(tamperedToken, TEST_SECRET, {
      registryPath: testRegistryPath,
    });
    assert.equal(verif.valid, false);
    assert.ok(verif.reason.includes("invalid signature"));
  });

  await t.test("Token Integrity: rejects expired token", () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/target.js"] },
        ttlMs: -1000,
      },
      TEST_SECRET
    );

    const verif = verifyApprovalToken(token, TEST_SECRET, {
      registryPath: testRegistryPath,
    });
    assert.equal(verif.valid, false);
    assert.ok(verif.reason.includes("Approval token expired"));
  });

  // ==========================================
  // 2. PERSISTENT ANTI-REPLAY & REVOCATION
  // ==========================================

  await t.test("Persistent Revocation: survives hook process restart", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-REVOKE",
        proposalId: "PROP-REVOKE",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    // Revoke token and persist to test registry
    revokeToken(token.payload.tokenId, testRegistryPath);

    // Now run approval-gate in a FRESH separate OS process
    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );

    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("explicitly revoked"));
  });

  await t.test("Persistent Anti-Replay: prevents token reuse across separate hook processes", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-REPLAY",
        proposalId: "PROP-REPLAY",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    // First process execution: must succeed
    const firstRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        allowReplay: false,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );
    assert.equal(firstRes.decision, "allow");

    // Second process execution with SAME token: must fail closed across process boundary
    const secondRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        allowReplay: false,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );
    assert.equal(secondRes.decision, "force_ask");
    assert.ok(secondRes.reason.includes("Replay attack detected"));
  });

  await t.test("Persistent Registry: corrupt authorization registry fails closed", async () => {
    // Write corrupt JSON to registry file
    writeFileSync(testRegistryPath, "{ malformed-json-corrupt-state", "utf-8");

    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );

    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("Authorization registry failure") || res.reason.includes("Corrupt authorization registry"));
  });

  // ==========================================
  // 3. FAIL-CLOSED LIFECYCLE STATE ENFORCEMENT
  // ==========================================

  await t.test("Lifecycle Fail-Closed: edit_file without lifecycle metadata is rejected", async () => {
    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );
    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("lifecycle violation"));
  });

  await t.test("Lifecycle Fail-Closed: write_file without token is rejected", async () => {
    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "write_file", args: { Path: "src/target.js", Content: "code" } },
        lifecycleState: "IMPLEMENTATION",
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );
    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("authorization violation: file modifications require a valid human approval token"));
  });

  await t.test("Lifecycle: blocks modifications during DISCOVERY, DESIGN, INDEPENDENT_REVIEW, AWAITING_USER_APPROVAL", async () => {
    const preApprovalStates = [
      "DISCOVERY",
      "DESIGN",
      "INDEPENDENT_REVIEW",
      "AWAITING_USER_APPROVAL",
      "APPROVAL_GRANTED",
      "VERIFICATION",
      "COMPLETED",
      "BLOCKED",
      "REJECTED",
    ];

    for (const state of preApprovalStates) {
      const res = await runApprovalGate(
        JSON.stringify({
          toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
          lifecycleState: state,
        }),
        { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
      );
      assert.equal(res.decision, "force_ask");
      assert.ok(res.reason.includes(`strictly prohibited in state '${state}'`));
    }
  });

  await t.test("Lifecycle: allows authorized writes when in IMPLEMENTATION state with valid token and scope", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-042",
        proposalId: "PROP-042",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        taskId: "TASK-042",
        proposalId: "PROP-042",
        allowReplay: true,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );

    assert.equal(res.decision, "allow");
  });

  await t.test("Lifecycle: rejects write if token is bound to a different taskId or proposalId", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-CORRECT",
        proposalId: "PROP-CORRECT",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    const taskMismatch = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        taskId: "TASK-ATTACKER",
        allowReplay: true,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );
    assert.equal(taskMismatch.decision, "force_ask");
    assert.ok(taskMismatch.reason.includes("token task mismatch"));

    const propMismatch = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        proposalId: "PROP-ATTACKER",
        allowReplay: true,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );
    assert.equal(propMismatch.decision, "force_ask");
    assert.ok(propMismatch.reason.includes("token proposal mismatch"));
  });

  await t.test("Lifecycle: rejects gate execution when ARCH_APPROVAL_SECRET is missing", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/target.js"] },
      },
      TEST_SECRET
    );

    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        allowReplay: true,
      }),
      { ARCH_APPROVAL_SECRET: "", ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );
    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("ARCH_APPROVAL_SECRET is missing"));
  });

  // ==========================================
  // 4. SCOPE AND OPERATION BOUNDARIES
  // ==========================================

  await t.test("Scope: rejects write to file outside approved scope", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/allowed.js"] },
      },
      TEST_SECRET
    );

    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/unauthorized.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        allowReplay: true,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );

    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("Scope boundary violation"));
  });

  await t.test("Scope: rejects unapproved operation (deletion without delete permission)", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/*"], operations: ["modify", "create"] }, // no delete
      },
      TEST_SECRET
    );

    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "delete_file", args: { Path: "src/target.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        allowReplay: true,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );

    assert.equal(res.decision, "force_ask");
  });

  await t.test("Scope: rejects parent traversal '..' escape attempts", async () => {
    const token = issueApprovalToken(
      {
        taskId: "TASK-001",
        proposalId: "PROP-001",
        approvedScope: { paths: ["src/*"] },
      },
      TEST_SECRET
    );

    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "write_file", args: { Path: "../escaped.js" } },
        lifecycleState: "IMPLEMENTATION",
        authorization: token,
        allowReplay: true,
      }),
      { ARCH_TOKEN_REGISTRY_PATH: testRegistryPath }
    );

    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("parent traversal '..'"));
  });

  await t.test("Scope: rejects absolute path escaping workspace root", () => {
    const scopeCheck = isPathAuthorized(
      resolve("/etc/shadow"),
      ["src/*"],
      testWorkspace
    );
    assert.equal(scopeCheck.authorized, false);
    assert.ok(scopeCheck.reason.includes("Workspace escape violation"));
  });

  await t.test("Scope: rejects symlink traversal escaping workspace root", () => {
    const outsideTarget = resolve("package.json");
    const symlinkPath = join(testWorkspace, "src", "symlink-escape.js");

    try {
      symlinkSync(outsideTarget, symlinkPath);
      const scopeCheck = isPathAuthorized(
        symlinkPath,
        ["src/*"],
        testWorkspace
      );
      assert.equal(scopeCheck.authorized, false);
      assert.ok(scopeCheck.reason.includes("Symlink escape violation"));
    } catch {
      // Skip if OS lacks symlink creation rights
    }
  });

  // ==========================================
  // 5. SHELL EXECUTION BYPASS DEFENSES (`run_command`)
  // ==========================================

  await t.test("Shell Bypass: blocks node -e file writing during pre-approval and implementation", async () => {
    // Outside IMPLEMENTATION
    const preApprovalRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "node -e \"require('fs').writeFileSync('pwn.js', 'exploit')\"" } },
        lifecycleState: "AWAITING_USER_APPROVAL",
      })
    );
    assert.equal(preApprovalRes.decision, "force_ask");
    assert.ok(preApprovalRes.reason.includes("lifecycle violation: shell command execution capable of modifying files"));

    // During IMPLEMENTATION (must use scoped edit_file/write_file tools instead)
    const implRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "node -e \"require('fs').writeFileSync('src/target.js', 'code')\"" } },
        lifecycleState: "IMPLEMENTATION",
      })
    );
    assert.equal(implRes.decision, "force_ask");
    assert.ok(implRes.reason.includes("scope violation: file modifications during IMPLEMENTATION must use scoped file tools"));
  });

  await t.test("Shell Bypass: blocks python -c file writing", async () => {
    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "python -c \"open('exploit.py', 'w').write('hacked')\"" } },
        lifecycleState: "DISCOVERY",
      })
    );
    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("lifecycle violation"));
  });

  await t.test("Shell Bypass: blocks PowerShell and CMD file writing", async () => {
    const psRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "powershell Set-Content -Path target.js -Value 'exploit'" } },
        lifecycleState: "DESIGN",
      })
    );
    assert.equal(psRes.decision, "force_ask");

    const cmdRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "cmd.exe /c echo hacked > target.js" } },
        lifecycleState: "DESIGN",
      })
    );
    assert.equal(cmdRes.decision, "force_ask");
  });

  await t.test("Shell Bypass: blocks nested script execution", async () => {
    const bashRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "bash deploy.sh" } },
        lifecycleState: "AWAITING_USER_APPROVAL",
      })
    );
    assert.equal(bashRes.decision, "force_ask");
    assert.ok(bashRes.reason.includes("lifecycle violation"));

    const shRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "sh build.sh" } },
        lifecycleState: "DISCOVERY",
      })
    );
    assert.equal(shRes.decision, "force_ask");
  });

  await t.test("Shell Defense: blocks commands targeting protected security configuration files", async () => {
    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "run_command", args: { CommandLine: "cat > hooks.json" } },
        lifecycleState: "IMPLEMENTATION",
      })
    );
    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("command targeting protected security configuration is forbidden"));
  });

  // ==========================================
  // 6. UNKNOWN TOOLS & SECURITY CONFIG PROTECTION
  // ==========================================

  await t.test("Unknown Tools: fails closed on unknown or unclassified tool invocation", async () => {
    const res = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "custom_unregistered_tool", args: { foo: "bar" } },
      })
    );
    assert.equal(res.decision, "force_ask");
    assert.ok(res.reason.includes("unknown or unclassified tool call"));
  });

  await t.test("Security Config: blocks write_file targeting hooks.json or approval gate", async () => {
    const res1 = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "write_file", args: { Path: "hooks.json", Content: "{}" } },
      })
    );
    assert.equal(res1.decision, "force_ask");
    assert.ok(res1.reason.includes("modifying approval guard configuration or script is forbidden"));

    const res2 = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "write_file", args: { Path: "scripts/approval-token.mjs", Content: "hacked" } },
      })
    );
    assert.equal(res2.decision, "force_ask");
    assert.ok(res2.reason.includes("modifying approval guard configuration or script is forbidden"));
  });

  // ==========================================
  // 7. AGENT CONTRACT RESTRICTIONS
  // ==========================================

  await t.test("Agent Contracts: Implementation Agent has no token issuance capability", () => {
    const implPath = resolve("agents/architecture-implementation-agent.md");
    const implContent = readFileSync(implPath, "utf-8");

    assert.ok(
      implContent.includes("Zero Token Authority"),
      "Implementation Agent must have Zero Token Authority"
    );
    assert.ok(
      implContent.includes("NO authority to generate, sign"),
      "Implementation Agent must be prohibited from signing tokens"
    );
  });

  await t.test("Agent Contracts: Review Agent remains read-only and cannot transition state to IMPLEMENTATION", () => {
    const revPath = resolve("agents/architecture-review-agent.md");
    const revContent = readFileSync(revPath, "utf-8");

    assert.ok(
      revContent.includes("Zero Token Authority"),
      "Review Agent must have Zero Token Authority"
    );
    assert.ok(
      revContent.includes("cannot issue approval tokens"),
      "Review Agent must be prohibited from issuing tokens"
    );
    assert.ok(
      /transition tasks into.*IMPLEMENTATION/i.test(revContent),
      "Review Agent must be prohibited from state transition to IMPLEMENTATION"
    );
  });
});
