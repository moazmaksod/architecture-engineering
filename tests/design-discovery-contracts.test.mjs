import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const rawYaml = match[1];
  const body = content.slice(match[0].length);

  const frontmatter = {};
  let currentKey = null;

  for (const line of rawYaml.split(/\r?\n/)) {
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

test("Phase 3 — Dedicated Design Agent & Discovery Contracts Tests", async (t) => {
  const designPath = resolve("agents/architecture-design-agent.md");
  const discoveryPath = resolve("agents/architecture-discovery-agent.md");
  const workflowPath = resolve("skills/architecture-engineering-workflow/SKILL.md");

  assert.ok(existsSync(designPath), "agents/architecture-design-agent.md must exist");
  assert.ok(existsSync(discoveryPath), "agents/architecture-discovery-agent.md must exist");
  assert.ok(existsSync(workflowPath), "skills/architecture-engineering-workflow/SKILL.md must exist");

  const designContent = readFileSync(designPath, "utf-8");
  const discoveryContent = readFileSync(discoveryPath, "utf-8");
  const workflowContent = readFileSync(workflowPath, "utf-8");

  const { frontmatter: designFm, body: designBody } = parseFrontmatter(designContent);
  const { frontmatter: discoveryFm, body: discoveryBody } = parseFrontmatter(discoveryContent);

  await t.test("Design Agent: declares subagent role with read-only tools and no execution", () => {
    assert.equal(designFm.name, "architecture-design-agent");
    assert.equal(designFm.subagent, true);
    assert.equal(designFm.mainAgent, false);
    assert.equal(designFm.commandExecutionPolicy, "off");

    const tools = designFm.tools || [];
    assert.ok(tools.includes("read_file"), "Design agent must have read_file");
    assert.ok(tools.includes("send_message"), "Design agent must have send_message");

    const disallowedTools = ["write_file", "edit_file", "run_command", "invoke_subagent"];
    for (const tool of disallowedTools) {
      assert.ok(!tools.includes(tool), `Design agent must NOT declare disallowed tool: '${tool}'`);
    }
  });

  await t.test("Design Agent Instructions: mandates RFC proposal format and epistemic separation", () => {
    assert.ok(/synthesis|RFC|proposals/i.test(designBody), "Design prompt must specify synthesis and RFC proposals");
    assert.ok(/never edit, create, or delete/i.test(designBody), "Design prompt must forbid modifying files");
    assert.ok(/trade-offs/i.test(designBody), "Design prompt must evaluate trade-offs");
    assert.ok(/factualGrounding/i.test(designBody), "Design prompt must define factualGrounding in payload");
    assert.ok(/assumptions/i.test(designBody), "Design prompt must define assumptions in payload");
    assert.ok(/proposedSpecification/i.test(designBody), "Design prompt must define proposedSpecification in payload");
    assert.ok(/openQuestions/i.test(designBody), "Design prompt must define openQuestions in payload");
  });

  await t.test("Discovery Agent: declares subagent role with read-only tools", () => {
    assert.equal(discoveryFm.name, "architecture-discovery-agent");
    assert.equal(discoveryFm.subagent, true);
    assert.equal(discoveryFm.commandExecutionPolicy, "off");

    const tools = discoveryFm.tools || [];
    assert.ok(tools.includes("read_file"), "Discovery agent must have read_file");
    assert.ok(tools.includes("send_message"), "Discovery agent must have send_message");

    const disallowedTools = ["write_file", "edit_file", "run_command", "invoke_subagent"];
    for (const tool of disallowedTools) {
      assert.ok(!tools.includes(tool), `Discovery agent must NOT declare disallowed tool: '${tool}'`);
    }
  });

  await t.test("Discovery Agent Instructions: mandates empirical investigation and line provenance", () => {
    assert.ok(/empirical/i.test(discoveryBody), "Discovery prompt must emphasize empirical investigation");
    assert.ok(/NOT a solution designer/i.test(discoveryBody), "Discovery prompt must prohibit solution design");
    assert.ok(/sourcePath/i.test(discoveryBody), "Discovery output must include sourcePath");
    assert.ok(/lineRange/i.test(discoveryBody), "Discovery output must include lineRange");
    assert.ok(/verified_fact/i.test(discoveryBody), "Discovery output must classify verified_fact");
    assert.ok(/never speculate/i.test(discoveryBody), "Discovery prompt must prohibit speculation");
  });

  await t.test("Role Separation: Discovery and Design have mutually exclusive responsibilities", () => {
    // Discovery focuses on "what is"; Design focuses on "what should be"
    assert.ok(discoveryBody.includes('"what is"'), 'Discovery must focus on "what is"');
    assert.ok(designBody.includes('"what should be"') || designBody.includes("proposals"), 'Design must focus on architectural proposals');

    // Neither has write tools
    const designTools = designFm.tools || [];
    const discoveryTools = discoveryFm.tools || [];
    assert.ok(!designTools.includes("write_file") && !designTools.includes("edit_file"));
    assert.ok(!discoveryTools.includes("write_file") && !discoveryTools.includes("edit_file"));
  });

  await t.test("Workflow Skill: formalizes Discovery -> Orchestrator -> Design handoff contract", () => {
    assert.ok(
      workflowContent.includes("Discovery to Orchestrator Handoff"),
      "Workflow skill must formalize Discovery to Orchestrator handoff"
    );
    assert.ok(
      workflowContent.includes("Orchestrator to Design Routing"),
      "Workflow skill must formalize Orchestrator to Design routing"
    );
    assert.ok(
      workflowContent.includes("Design to Orchestrator Handoff"),
      "Workflow skill must formalize Design to Orchestrator handoff"
    );
    assert.ok(
      workflowContent.includes("No Self-Execution Fallback"),
      "Workflow skill must preserve No Self-Execution Fallback"
    );
  });
});

