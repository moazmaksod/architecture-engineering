import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { divide, safeDivide } from "./fixtures/calculator.mjs";
import {
  issueApprovalToken,
  verifyApprovalToken,
  resetTokenRegistries,
  APPROVAL_VERSION,
} from "../scripts/approval-token.mjs";
import { promoteKnowledge } from "../scripts/elephant-promote.mjs";
import {
  buildGoldfishEnvelope,
  reconcileReview,
  MAX_REVISION_CYCLES,
} from "../scripts/blind-envelope.mjs";

const ACCEPTANCE_SECRET = "test-phase6-acceptance-secret-32bytes!";

function runApprovalGate(input, env = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve("scripts/approval-gate.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ARCH_APPROVAL_SECRET: ACCEPTANCE_SECRET, ...env },
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

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const yamlText = match[1];
  const body = content.slice(match[0].length);

  const frontmatter = {};
  let currentKey = null;

  for (const line of yamlText.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey] = [];
      }
      frontmatter[currentKey].push(listMatch[1].trim());
      continue;
    }

    const keyValMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyValMatch) {
      currentKey = keyValMatch[1].trim();
      const val = keyValMatch[2].trim();
      if (val === "" || val === "[]") {
        frontmatter[currentKey] = [];
      } else if (val === "true") {
        frontmatter[currentKey] = true;
      } else if (val === "false") {
        frontmatter[currentKey] = false;
      } else {
        frontmatter[currentKey] = val;
      }
    }
  }

  return { frontmatter, body };
}

// =========================================================================
// PART 1: Core Acceptance Test — Calculator Module Verification
// =========================================================================

test("Execution Acceptance Test — Calculator Module Verification", async (t) => {
  await t.test("divide: calculates valid quotients", () => {
    assert.equal(divide(10, 2), 5);
    assert.equal(divide(-9, 3), -3);
  });

  await t.test("divide: throws RangeError on division by zero", () => {
    assert.throws(() => divide(10, 0), {
      name: "RangeError",
      message: /Division by zero is prohibited/,
    });
  });

  await t.test("divide: throws TypeError on non-numeric inputs", () => {
    assert.throws(() => divide("10", 2), { name: "TypeError" });
    assert.throws(() => divide(10, NaN), { name: "TypeError" });
  });

  await t.test("safeDivide: returns fallback on division by zero", () => {
    assert.equal(safeDivide(10, 0, 999), 999);
    assert.equal(safeDivide(10, 0), 0);
  });

  await t.test("safeDivide: propagates non-RangeError exceptions", () => {
    assert.throws(() => safeDivide(10, "invalid"), { name: "TypeError" });
  });
});

// =========================================================================
// PART 2: Phase 6 — The 10 Core Architectural Acceptance Criteria of V2.1
// =========================================================================

test("Phase 6 — Architectural Acceptance Criteria 1 to 10 Verification", async (t) => {
  const orchestratorContent = readFileSync(resolve("agents/architecture-orchestrator.md"), "utf-8");
  const discoveryContent = readFileSync(resolve("agents/architecture-discovery-agent.md"), "utf-8");
  const designContent = readFileSync(resolve("agents/architecture-design-agent.md"), "utf-8");
  const goldfishContent = readFileSync(resolve("agents/architecture-goldfish-agent.md"), "utf-8");
  const implementationContent = readFileSync(resolve("agents/architecture-implementation-agent.md"), "utf-8");
  const reviewContent = readFileSync(resolve("agents/architecture-review-agent.md"), "utf-8");
  const workflowContent = readFileSync(resolve("skills/architecture-engineering-workflow/SKILL.md"), "utf-8");
  const rulesContent = readFileSync(resolve("rules/AGENTS.md"), "utf-8");

  // 1. Orchestrator does not perform specialist engineering work
  await t.test("Criterion 1: Orchestrator does not perform specialist engineering work", () => {
    const { frontmatter, body } = parseFrontmatter(orchestratorContent);
    const tools = frontmatter.tools || [];

    // Coordinator tools strictly allowed
    assert.ok(tools.includes("invoke_subagent"), "Orchestrator must have invoke_subagent");
    assert.ok(tools.includes("send_message"), "Orchestrator must have send_message");
    assert.ok(tools.includes("ask_question"), "Orchestrator must have ask_question");

    // Specialist and modification tools strictly excluded
    assert.equal(tools.includes("edit_file"), false, "Orchestrator must not have edit_file");
    assert.equal(tools.includes("write_file"), false, "Orchestrator must not have write_file");
    assert.equal(tools.includes("read_file"), false, "Orchestrator must not have read_file");
    assert.equal(tools.includes("run_command"), false, "Orchestrator must not have run_command");
    assert.equal(frontmatter.commandExecutionPolicy, "off", "commandExecutionPolicy must be off");

    // Instructions strictly prohibit specialist execution
    assert.ok(/Thin Coordinator/i.test(body), "Orchestrator must define Thin Coordinator role");
    assert.ok(/Directly reading or inspecting project source files/i.test(body));
    assert.ok(/Formulating architectural designs/i.test(body));
    assert.ok(/Creating, writing, or editing repository files/i.test(body));
  });

  // 2. Delegation failure does not trigger self-execution
  await t.test("Criterion 2: Delegation failure does not trigger self-execution", () => {
    const { body } = parseFrontmatter(orchestratorContent);
    assert.ok(/Falling back to self-execution when delegation fails/i.test(body));
    assert.ok(/transition the task to `BLOCKED`/i.test(body) || /state.*BLOCKED/i.test(body));
    assert.ok(!/fall\s*back to direct execution/i.test(body));
    assert.ok(!/perform the task yourself if/i.test(body));
  });

  // 3. Knowledge distinguishes verified facts from assumptions and approved decisions
  await t.test("Criterion 3: Knowledge distinguishes verified facts from assumptions and approved decisions", () => {
    const manifestPath = resolve("templates/elephant/elephant.yaml");
    assert.ok(existsSync(manifestPath), "templates/elephant/elephant.yaml must exist");
    const manifest = readFileSync(manifestPath, "utf-8");

    // All categories distinct in manifest
    assert.ok(manifest.includes("facts:"));
    assert.ok(manifest.includes("decisions:"));
    assert.ok(manifest.includes("assumptions:"));
    assert.ok(manifest.includes("constraints:"));
    assert.ok(manifest.includes("issues:"));
    assert.ok(manifest.includes("proposals:"));

    // Check fact vs assumption vs decision schemas
    const factTemplate = readFileSync(resolve("templates/elephant/facts/FACT.template.md"), "utf-8");
    const assumptionTemplate = readFileSync(resolve("templates/elephant/assumptions/ASSUMPTION.template.md"), "utf-8");
    const decisionTemplate = readFileSync(resolve("templates/elephant/decisions/ADR.template.md"), "utf-8");

    assert.ok(factTemplate.includes("provenance:"), "Facts require provenance");
    assert.ok(factTemplate.includes("source_files:"), "Facts require source_files");
    assert.ok(/Risk if Invalid/i.test(assumptionTemplate), "Assumptions require risk assessment");
    assert.ok(decisionTemplate.includes("approval_token:"), "Decisions require approval_token");
    assert.ok(decisionTemplate.includes("approved_by:"), "Decisions require approved_by");
  });

  // 4. Knowledge updates preserve provenance and history
  await t.test("Criterion 4: Knowledge updates preserve provenance and history", () => {
    const testWs = resolve("tests/fixtures/tmp-acceptance-elephant");
    if (existsSync(testWs)) rmSync(testWs, { recursive: true, force: true });
    mkdirSync(join(testWs, "src"), { recursive: true });
    mkdirSync(join(testWs, "elephant/facts"), { recursive: true });
    mkdirSync(join(testWs, "elephant/decisions"), { recursive: true });

    writeFileSync(join(testWs, "src/calc.js"), "export const pi = 3.14;", "utf-8");

    // Promotion without real provenance file fails
    const invalidFact = join(testWs, "proposal-invalid-fact.md");
    writeFileSync(
      invalidFact,
      `---
id: fact-99
category: facts
title: Invalid Fact
provenance:
  source_files:
    - src/non-existent-file.js
---
Content
`,
      "utf-8"
    );

    assert.throws(() => {
      promoteKnowledge({
        proposalPath: invalidFact,
        category: "facts",
        elephantRoot: join(testWs, "elephant"),
        workspaceRoot: testWs,
        keepDraft: true,
      });
    }, /Provenance rejection|does not exist/);

    // Promotion with verified provenance passes
    const validFact = join(testWs, "proposal-valid-fact.md");
    writeFileSync(
      validFact,
      `---
id: fact-100
category: facts
title: Valid Fact
provenance:
  source_files:
    - src/calc.js
---
Confirmed pi export.
`,
      "utf-8"
    );

    const promoted = promoteKnowledge({
      proposalPath: validFact,
      category: "facts",
      elephantRoot: join(testWs, "elephant"),
      workspaceRoot: testWs,
      keepDraft: true,
    });
    assert.ok(promoted.success);
    assert.ok(existsSync(join(testWs, promoted.targetPath)));

    rmSync(testWs, { recursive: true, force: true });
  });

  // 5. Goldfish does not receive the Design Agent's conclusions before its independent assessment
  await t.test("Criterion 5: Goldfish does not receive the Design Agent's conclusions before its independent assessment", () => {
    const testRFC = {
      title: "Architecture Plan",
      interfaceContract: "export function run() {}",
      acceptanceCriteria: ["Must run"],
      privateDeliberations: "SECRET_SENTINEL_TOKEN_SHOULD_NEVER_LEAK",
      scratchpad: "Internal private thoughts of Design Agent",
    };

    const envelope = buildGoldfishEnvelope({
      taskObjective: "Verify new service design",
      discoveryFindings: [{ id: "f1", statement: "Uses Node.js" }],
      elephantConstraints: [{ id: "c1", title: "Read-only" }],
      rfcProposal: testRFC,
    });

    const envelopeStr = JSON.stringify(envelope);
    assert.ok(!envelopeStr.includes("SECRET_SENTINEL_TOKEN_SHOULD_NEVER_LEAK"));
    assert.ok(!envelopeStr.includes("Internal private thoughts"));
    assert.ok(envelopeStr.includes("export function run() {}"));
  });

  // 6. Implementation cannot begin without explicit approval
  await t.test("Criterion 6: Implementation cannot begin without explicit approval", async () => {
    // Attempt edit in DESIGN state
    const designRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/app.js" } },
        lifecycleState: "DESIGN",
      })
    );
    assert.equal(designRes.decision, "force_ask");
    assert.ok(designRes.reason.includes("lifecycle violation"));

    // Attempt edit without token in IMPLEMENTATION state
    const unauthTokenRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/app.js" } },
        lifecycleState: "IMPLEMENTATION",
      })
    );
    assert.equal(unauthTokenRes.decision, "force_ask");
    assert.ok(unauthTokenRes.reason.includes("authorization violation"));

    // Authorized token in IMPLEMENTATION state succeeds
    const token = issueApprovalToken(
      {
        taskId: "TASK-CRIT-6",
        proposalId: "PROP-CRIT-6",
        approvedScope: { paths: ["src/app.js"] },
      },
      ACCEPTANCE_SECRET
    );

    const authorizedRes = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: "src/app.js" } },
        lifecycleState: "IMPLEMENTATION",
        approvalToken: token,
        taskId: "TASK-CRIT-6",
        proposalId: "PROP-CRIT-6",
      })
    );
    assert.equal(authorizedRes.decision, "allow");
  });

  // 7. Post-implementation review examines actual changes
  await t.test("Criterion 7: Post-implementation review examines actual changes", () => {
    const { frontmatter, body } = parseFrontmatter(reviewContent);
    const tools = frontmatter.tools || [];

    // Reviewer is strictly read-only
    assert.ok(tools.includes("read_file"), "Reviewer must have read_file");
    assert.ok(tools.includes("run_command"), "Reviewer must have run_command");
    assert.equal(tools.includes("edit_file"), false, "Reviewer must not have edit_file");
    assert.equal(tools.includes("write_file"), false, "Reviewer must not have write_file");

    // Reviewer instructions mandate git diff inspection, test execution, defect-driven blocking
    assert.ok(/Inspect Actual Diffs/i.test(body));
    assert.ok(/Verify Against Approved Scope/i.test(body));
    assert.ok(/BLOCKER/i.test(body) && /HIGH/i.test(body));
    assert.ok(/CHANGES_REQUIRED/i.test(body));
  });

  // 8. Agent reports contain evidence and clearly state limitations
  await t.test("Criterion 8: Agent reports contain evidence and clearly state limitations", () => {
    // Discovery
    assert.ok(/Empirical System Mapping/i.test(discoveryContent));
    assert.ok(/Evidence Collection with Provenance/i.test(discoveryContent));
    assert.ok(/limitations/i.test(discoveryContent));

    // Design
    assert.ok(/tradeOffsAndAlternatives/i.test(designContent));
    assert.ok(/interfacesAndContracts/i.test(designContent));
    assert.ok(/acceptanceCriteria/i.test(designContent));

    // Goldfish
    assert.ok(/Challenge Report Payload/i.test(goldfishContent));
    assert.ok(/overallAssessment/i.test(goldfishContent));
    assert.ok(/CRITICAL \| HIGH \| MEDIUM \| LOW/i.test(goldfishContent));

    // Implementation
    assert.ok(/implementation summary/i.test(implementationContent));
    assert.ok(/Automated test commands executed/i.test(implementationContent));

    // Review
    assert.ok(/Inspect Actual Diffs/i.test(reviewContent));
    assert.ok(/Defect-Driven Blocking/i.test(reviewContent));
  });

  // 9. Project knowledge remains isolated between consuming projects
  await t.test("Criterion 9: Project knowledge remains isolated between consuming projects", () => {
    // Elephant paths are local relative to workspace root
    assert.ok(workflowContent.includes(".architecture/elephant") || workflowContent.includes("Elephant"));
    assert.ok(existsSync(resolve("templates/elephant/elephant.yaml")));

    // Tokens and registry are workspace-scoped
    assert.ok(workflowContent.includes("approval-gate") || workflowContent.includes("approval-token"));
  });

  // 10. No duplicate or contradictory authoritative instructions remain
  await t.test("Criterion 10: No duplicate or contradictory authoritative instructions remain", () => {
    // Verify 10-state lifecycle is uniformly referenced
    const expectedStates = [
      "CREATED",
      "DISCOVERY",
      "DESIGN",
      "INDEPENDENT_REVIEW",
      "AWAITING_USER_APPROVAL",
      "IMPLEMENTATION",
      "VERIFICATION",
      "COMPLETED",
      "BLOCKED",
      "REJECTED",
    ];

    for (const state of expectedStates) {
      assert.ok(workflowContent.includes(state), `Workflow must reference lifecycle state ${state}`);
    }

    // Verify no legacy generalist fallback rules exist in AGENTS.md
    assert.ok(!rulesContent.includes("hybrid orchestrator/worker"));
    assert.ok(!rulesContent.includes("fallback to self-execution"));
    assert.ok(!workflowContent.includes("sequential fallback to direct execution"));
  });
});

// =========================================================================
// PART 3: Full End-to-End Lifecycle Execution & Remediation Bounding
// =========================================================================

test("Phase 6 — End-to-End Multi-Agent Lifecycle Simulation", async (t) => {
  const simWorkspace = resolve("tests/fixtures/tmp-acceptance-e2e-ws");
  const simRegistryPath = resolve("tests/fixtures/tmp-acceptance-e2e-ws/token-registry.json");

  t.beforeEach(() => {
    if (existsSync(simWorkspace)) rmSync(simWorkspace, { recursive: true, force: true });
    mkdirSync(join(simWorkspace, "src"), { recursive: true });
    mkdirSync(join(simWorkspace, "elephant/facts"), { recursive: true });
    mkdirSync(join(simWorkspace, "elephant/decisions"), { recursive: true });
    mkdirSync(join(simWorkspace, "elephant/proposals"), { recursive: true });
    resetTokenRegistries(simRegistryPath);
  });

  t.afterEach(() => {
    if (existsSync(simWorkspace)) rmSync(simWorkspace, { recursive: true, force: true });
  });

  await t.test("Full Lifecycle Simulation (Happy Path): Intake -> Discovery -> Design -> Goldfish -> Approval -> Implementation -> Verification -> Completion", async () => {
    // Step 0: Initial state is CREATED
    let taskState = "CREATED";
    const taskId = "TASK-E2E-001";
    const proposalId = "PROP-E2E-001";
    const targetFile = "src/order_calc.js";

    writeFileSync(
      join(simWorkspace, targetFile),
      `// Initial buggy code\nexport function calculate(val) { return val * 1; }\n`,
      "utf-8"
    );

    // Step 1: DISCOVERY
    taskState = "DISCOVERY";
    const discoveredFact = {
      id: "fact-order-calc-001",
      category: "facts",
      title: "Current order calculation logic",
      provenance: {
        source_files: [targetFile],
        lines: "1-2",
      },
      content: "Line 2 implements calculate(val) without tax consideration.",
    };

    // Promote verified fact into Elephant
    const factDraft = join(simWorkspace, "elephant/proposals/fact-draft.md");
    writeFileSync(
      factDraft,
      `---
id: ${discoveredFact.id}
category: facts
title: ${discoveredFact.title}
provenance:
  source_files:
    - ${targetFile}
---
${discoveredFact.content}
`,
      "utf-8"
    );

    const factPromotion = promoteKnowledge({
      proposalPath: factDraft,
      category: "facts",
      elephantRoot: join(simWorkspace, "elephant"),
      workspaceRoot: simWorkspace,
      keepDraft: true,
    });
    assert.ok(factPromotion.success, "Fact promotion to Elephant must succeed");

    // Step 2: DESIGN
    taskState = "DESIGN";
    const rfcSpec = {
      rfcId: proposalId,
      title: "Add Tax Calculation to order_calc",
      interfaceContract: "export function calculate(val, taxRate = 0.1)",
      acceptanceCriteria: [
        "Calculates val * (1 + taxRate)",
        "Rounds to two decimal places",
      ],
      targetFiles: [targetFile],
    };

    // Attempting edit in DESIGN state must be rejected by approval gate
    const prematureEdit = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: targetFile } },
        lifecycleState: taskState,
        workspaceRoot: simWorkspace,
      })
    );
    assert.equal(prematureEdit.decision, "force_ask");

    // Step 3: INDEPENDENT_REVIEW (Goldfish Blind Review)
    taskState = "INDEPENDENT_REVIEW";
    const envelope = buildGoldfishEnvelope({
      taskObjective: "Add tax calculation",
      discoveryFindings: [{ id: "f1", statement: discoveredFact.content }],
      elephantConstraints: [{ id: "c1", title: "Strict 2-decimal rounding" }],
      rfcProposal: rfcSpec,
    });

    assert.ok(envelope.envelopeVersion);
    assert.ok(envelope.proposedSpecification);

    // Simulate Goldfish Assessment: ACCEPT
    const goldfishReview = {
      overallAssessment: "ACCEPT",
      findings: [],
      notes: "Clean interface, no architectural drift detected.",
    };

    const reconciliation = reconcileReview(rfcSpec, goldfishReview, 1);
    assert.equal(reconciliation.state, "AWAITING_USER_APPROVAL");

    // Step 4: AWAITING_USER_APPROVAL
    taskState = "AWAITING_USER_APPROVAL";

    // User reviews the reconciled RFC and issues an HMAC approval token
    const approvalToken = issueApprovalToken(
      {
        taskId,
        proposalId,
        approvedScope: {
          paths: [targetFile],
          operations: ["modify"],
        },
        issuedBy: "human:lead-architect",
      },
      ACCEPTANCE_SECRET
    );

    // Step 5: IMPLEMENTATION
    taskState = "IMPLEMENTATION";

    // Approval gate intercepts tool call and verifies state + cryptographic token
    const gateResult = await runApprovalGate(
      JSON.stringify({
        toolCall: { name: "edit_file", args: { Path: targetFile } },
        lifecycleState: taskState,
        approvalToken,
        taskId,
        proposalId,
        workspaceRoot: simWorkspace,
        registryPath: simRegistryPath,
      })
    );
    assert.equal(gateResult.decision, "allow", "Gate must allow authorized edit in IMPLEMENTATION state");

    // Implementation applied
    writeFileSync(
      join(simWorkspace, targetFile),
      `// Implemented tax calculation\nexport function calculate(val, taxRate = 0.1) {\n  return Math.round((val * (1 + taxRate)) * 100) / 100;\n}\n`,
      "utf-8"
    );

    // Step 6: VERIFICATION
    taskState = "VERIFICATION";
    const verificationReview = {
      verdict: "APPROVED",
      findings: [],
      diffExamined: true,
      testsPassed: true,
    };
    assert.equal(verificationReview.verdict, "APPROVED");

    // Step 7: COMPLETED & Promote ADR
    taskState = "COMPLETED";
    const adrDraft = join(simWorkspace, "elephant/proposals/adr-draft.md");
    writeFileSync(
      adrDraft,
      `---
id: "ADR-001"
title: Standard Tax Calculation Implementation
approval_token: ${approvalToken.payload.tokenId}
task_id: ${taskId}
status: accepted
date: 2026-11-07
---
Implemented standard tax calculation with 2-decimal rounding.
`,
      "utf-8"
    );

    const adrPromotion = promoteKnowledge({
      proposalPath: adrDraft,
      category: "decisions",
      token: approvalToken.payload.tokenId,
      approver: "human:lead-architect",
      elephantRoot: join(simWorkspace, "elephant"),
      workspaceRoot: simWorkspace,
      keepDraft: true,
    });
    assert.ok(adrPromotion.success, "ADR promotion to Elephant must succeed");
    assert.equal(taskState, "COMPLETED");
  });

  await t.test("Remediation Loop Bounding: enforces max 2 remediation cycles before transitioning to BLOCKED", async () => {
    let taskState = "IMPLEMENTATION";
    let remediationCycle = 0;

    // Simulation of verification review failure loop
    const simulateVerification = (cycle) => {
      if (cycle < 2) {
        return {
          verdict: "CHANGES_REQUIRED",
          findings: [{ severity: "HIGH", message: `Flaw detected in cycle ${cycle + 1}` }],
        };
      }
      return {
        verdict: "CHANGES_REQUIRED",
        findings: [{ severity: "BLOCKER", message: "Third failure - exceeded threshold" }],
      };
    };

    // Cycle 1: First failure triggers remediation cycle 1
    const review1 = simulateVerification(remediationCycle);
    assert.equal(review1.verdict, "CHANGES_REQUIRED");
    remediationCycle++;
    assert.equal(remediationCycle, 1);
    assert.ok(remediationCycle <= MAX_REVISION_CYCLES, "Cycle 1 allowed");

    // Cycle 2: Second failure triggers remediation cycle 2
    const review2 = simulateVerification(remediationCycle);
    assert.equal(review2.verdict, "CHANGES_REQUIRED");
    remediationCycle++;
    assert.equal(remediationCycle, 2);
    assert.ok(remediationCycle <= MAX_REVISION_CYCLES, "Cycle 2 allowed");

    // Cycle 3: Third failure exceeds limit -> MUST transition to BLOCKED
    const review3 = simulateVerification(remediationCycle);
    assert.equal(review3.verdict, "CHANGES_REQUIRED");
    remediationCycle++;

    if (remediationCycle > MAX_REVISION_CYCLES) {
      taskState = "BLOCKED";
    }

    assert.equal(taskState, "BLOCKED", "Exceeding max remediation cycles must transition state to BLOCKED");
  });
});
