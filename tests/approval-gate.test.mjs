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
  await t.test("returns force_ask for toolCall.name", async () => {
    const result = await runApprovalGate(JSON.stringify({ toolCall: { name: "edit_file" } }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /Matched action: edit_file/);
  });

  await t.test("returns force_ask for tool_name property", async () => {
    const result = await runApprovalGate(JSON.stringify({ tool_name: "run_command" }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /Matched action: run_command/);
  });

  await t.test("handles malformed JSON gracefully", async () => {
    const result = await runApprovalGate("not-json");
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /Matched action: matched tool/);
  });

  await t.test("handles empty payload gracefully", async () => {
    const result = await runApprovalGate("");
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /Matched action: matched tool/);
  });
});

