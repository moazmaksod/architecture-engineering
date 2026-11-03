import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function runApprovalGate(input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve("scripts/approval-gate.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
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
          rejectPromise(e);
        }
      }
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

test("Approval Gate Guard Unit Tests", async (t) => {
  await t.test("allows routine file edit", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "edit_file",
        args: { Path: "src/calculator.js" }
      }
    }));
    assert.equal(result.decision, "allow");
  });

  await t.test("allows routine command (tests, build, inspect)", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "npm test" }
      }
    }));
    assert.equal(result.decision, "allow");
  });

  await t.test("allows git status and git diff inspection", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git diff --stat" }
      }
    }));
    assert.equal(result.decision, "allow");
  });

  await t.test("blocks destructive git commands (reset --hard)", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git reset --hard HEAD~1" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /destructive Git operation/i);
  });

  await t.test("blocks destructive git commands (push)", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git push origin main" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /destructive Git operation/i);
  });

  await t.test("blocks destructive database operations", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "prisma migrate reset" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /database modification/i);
  });

  await t.test("blocks destructive filesystem commands", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "rmdir /s /q temp" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /destructive filesystem operation/i);
  });

  await t.test("blocks mutation of .git directory", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "write_file",
        args: { Path: "c:/project/.git/config" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /modifying Git internals is forbidden/i);
  });

  await t.test("handles malformed JSON safely without throwing", async () => {
    const result = await runApprovalGate("not-json");
    assert.equal(result.decision, "allow");
  });

  await t.test("handles empty payload safely without throwing", async () => {
    const result = await runApprovalGate("");
    assert.equal(result.decision, "allow");
  });
});
