import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
      if (val === "") {
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

test("Phase 1 — Orchestrator Decoupling Acceptance Tests", async (t) => {
  const orchestratorPath = resolve("agents/architecture-orchestrator.md");
  const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(orchestratorContent);

  await t.test("Orchestrator Frontmatter: strictly excludes code/command execution tools", () => {
    const disallowedTools = ["read_file", "write_file", "edit_file", "run_command"];
    const tools = frontmatter.tools || [];

    for (const tool of disallowedTools) {
      assert.ok(
        !tools.includes(tool),
        `Orchestrator frontmatter tools must not include disallowed specialist tool: '${tool}'`
      );
    }
  });

  await t.test("Orchestrator Frontmatter: includes coordinator tools", () => {
    const expectedTools = ["invoke_subagent", "send_message", "ask_question"];
    const tools = frontmatter.tools || [];

    for (const tool of expectedTools) {
      assert.ok(
        tools.includes(tool),
        `Orchestrator frontmatter tools must include coordinator tool: '${tool}'`
      );
    }
  });

  await t.test("Orchestrator Frontmatter: commandExecutionPolicy is set to 'off'", () => {
    assert.equal(
      frontmatter.commandExecutionPolicy,
      "off",
      "Orchestrator commandExecutionPolicy must be 'off'"
    );
  });

  await t.test("Orchestrator Frontmatter: excludes specialist engineering skills", () => {
    const skills = frontmatter.skills || [];
    const specialistSkills = [
      "skills/high-performance-backend-architecture",
      "skills/improve-codebase-architecture",
      "skills/architecture-review",
    ];

    for (const skill of specialistSkills) {
      assert.ok(
        !skills.includes(skill),
        `Orchestrator skills must not include specialist skill: '${skill}'`
      );
    }

    assert.ok(
      skills.includes("skills/architecture-engineering-workflow"),
      "Orchestrator must retain 'skills/architecture-engineering-workflow'"
    );
  });

  await t.test("Orchestrator Instructions: strictly prohibits self-execution and direct file edits", () => {
    assert.ok(
      /prohibited|never/i.test(body),
      "Orchestrator instructions must explicitly prohibit specialist tasks"
    );
    assert.ok(
      !/seamlessly execute the stages sequentially yourself/i.test(body),
      "Orchestrator must not contain fallback instruction to execute stages sequentially itself"
    );
    assert.ok(
      /BLOCKED/i.test(body),
      "Orchestrator instructions must specify transitioning to BLOCKED on delegation failure"
    );
  });

  await t.test("Workflow Skill: eliminates sequential fallback and formalizes 10-state lifecycle", () => {
    const workflowPath = resolve("skills/architecture-engineering-workflow/SKILL.md");
    const workflowContent = readFileSync(workflowPath, "utf-8");

    assert.ok(
      !/sequential fallback/i.test(workflowContent),
      "Workflow skill must not contain 'sequential fallback'"
    );
    assert.ok(
      !/execute the stages sequentially without halting/i.test(workflowContent),
      "Workflow skill must not allow sequential execution without halting"
    );

    const states = [
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

    for (const state of states) {
      assert.ok(
        workflowContent.includes(state),
        `Workflow skill must define lifecycle state '${state}'`
      );
    }
  });

  await t.test("Always-On Rules: enforces thin coordinator model and prohibits self-execution", () => {
    const rulesPath = resolve("rules/AGENTS.md");
    const rulesContent = readFileSync(rulesPath, "utf-8");

    assert.ok(
      /Thin coordinator/i.test(rulesContent),
      "Rules must define Orchestrator as a thin coordinator"
    );
    assert.ok(
      /No Self-Execution Fallback/i.test(rulesContent),
      "Rules must mandate No Self-Execution Fallback"
    );
    assert.ok(
      /BLOCKED/i.test(rulesContent),
      "Rules must mandate transitioning to BLOCKED on delegation failure"
    );
  });
});

