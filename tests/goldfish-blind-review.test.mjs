import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildGoldfishEnvelope,
  reconcileReview,
  MAX_REVISION_CYCLES,
} from "../scripts/blind-envelope.mjs";

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

test("Phase 4 — Goldfish Independent Architectural Challenger Tests", async (t) => {
  const goldfishPath = resolve("agents/architecture-goldfish-agent.md");
  const orchestratorPath = resolve("agents/architecture-orchestrator.md");
  const workflowPath = resolve("skills/architecture-engineering-workflow/SKILL.md");

  assert.ok(existsSync(goldfishPath), "agents/architecture-goldfish-agent.md must exist");
  assert.ok(existsSync(orchestratorPath), "agents/architecture-orchestrator.md must exist");
  assert.ok(existsSync(workflowPath), "skills/architecture-engineering-workflow/SKILL.md must exist");

  const goldfishContent = readFileSync(goldfishPath, "utf-8");
  const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
  const workflowContent = readFileSync(workflowPath, "utf-8");

  const { frontmatter: goldfishFm, body: goldfishBody } = parseFrontmatter(goldfishContent);

  await t.test("Goldfish Agent Frontmatter: strictly read-only with no execution or delegation", () => {
    assert.equal(goldfishFm.name, "architecture-goldfish-agent");
    assert.equal(goldfishFm.subagent, true);
    assert.equal(goldfishFm.mainAgent, false);
    assert.equal(goldfishFm.commandExecutionPolicy, "off");

    const tools = goldfishFm.tools || [];
    assert.ok(tools.includes("read_file"), "Goldfish must have read_file");
    assert.ok(tools.includes("send_message"), "Goldfish must have send_message");

    const disallowedTools = [
      "write_file",
      "edit_file",
      "run_command",
      "invoke_subagent",
      "ask_question",
    ];
    for (const tool of disallowedTools) {
      assert.ok(
        !tools.includes(tool),
        `Goldfish frontmatter must NOT declare disallowed tool: '${tool}'`
      );
    }
  });

  await t.test("Goldfish Agent Instructions: mandates adversarial challenge role and output schema", () => {
    assert.ok(/adversarial/i.test(goldfishBody), "Goldfish prompt must define adversarial role");
    assert.ok(/challenge/i.test(goldfishBody), "Goldfish prompt must emphasize challenging proposals");
    assert.ok(/never edit, create, or delete/i.test(goldfishBody), "Goldfish must forbid modifying files");
    assert.ok(/Zero Implementation Authority/i.test(goldfishBody), "Goldfish must forbid approving implementation");

    // Output schema fields
    const requiredSchemaFields = [
      "taskId",
      "proposalId",
      "overallAssessment",
      "findings",
      "unsupportedAssumptions",
      "missingRequirements",
      "alternativeApproaches",
      "requiredCorrections",
      "unresolvedQuestions",
    ];

    for (const field of requiredSchemaFields) {
      assert.ok(
        goldfishBody.includes(field),
        `Goldfish output contract must include field '${field}'`
      );
    }
  });

  await t.test("Blind Envelope: includes objective, verified evidence, facts, constraints, and RFC spec", () => {
    const rawInput = {
      taskObjective: "Add rate limiting to authentication endpoints",
      discoveryFindings: [
        {
          findingId: "DISC-001",
          statement: "Auth controller located in src/auth.ts",
          sourcePath: "src/auth.ts",
          lineRange: "20-45",
        },
      ],
      elephantFacts: [
        {
          id: "FACT-0010",
          title: "Express framework in use",
          status: "verified",
        },
      ],
      elephantConstraints: [
        {
          id: "CONST-0005",
          title: "Memory limit constraint",
          inviolableRule: "Max memory consumption 512MB",
          status: "approved",
        },
      ],
      rfcProposal: {
        proposalId: "PROP-2026-008",
        title: "Token Bucket Rate Limiter",
        factualGrounding: [{ sourceId: "DISC-001" }],
        proposedSpecification: {
          summary: "In-memory token bucket filter",
        },
        tradeOffsAndAlternatives: [{ alternative: "Redis rate limiter" }],
        affectedFiles: [{ path: "src/auth.ts" }],
        acceptanceCriteria: ["Rejects > 10 requests per second"],
      },
    };

    const envelope = buildGoldfishEnvelope(rawInput);

    assert.equal(envelope.envelopeVersion, "2.1.0");
    assert.equal(envelope.taskObjective, "Add rate limiting to authentication endpoints");
    assert.equal(envelope.verifiedDiscoveryEvidence.length, 1);
    assert.equal(envelope.verifiedDiscoveryEvidence[0].findingId, "DISC-001");
    assert.equal(envelope.approvedElephantFacts.length, 1);
    assert.equal(envelope.activeElephantConstraints.length, 1);
    assert.equal(envelope.proposedSpecification.proposalId, "PROP-2026-008");
    assert.equal(envelope.acceptanceCriteria[0], "Rejects > 10 requests per second");
  });

  await t.test("Leakage Resistance: strictly filters out private deliberation, scratchpads, and sentinels", () => {
    const rawInputWithSentinels = {
      taskObjective: "Refactor session store",
      discoveryFindings: [{ findingId: "DISC-002", statement: "Session store interface" }],
      elephantFacts: [{ id: "FACT-0020", title: "Redis connection verified" }],
      elephantConstraints: [{ id: "CONST-0002", inviolableRule: "Zero downtime" }],
      // FORBIDDEN SENTINELS injected into top-level and nested fields:
      privateDeliberations: "DESIGN_PRIVATE_SCRATCHPAD_SENTINEL_TOP",
      scratchpad: "SCRATCHPAD_SENTINEL_TEXT",
      authorDefense: "DESIGN_INTERNAL_DEFENSE_SENTINEL",
      orchestratorOpinions: "ORCHESTRATOR_PRIVATE_OPINION_SENTINEL",
      intermediateDrafts: ["INTERMEDIATE_DRAFT_SENTINEL"],
      previousGoldfishReviews: ["OLD_REVIEW_BIAS"],
      rfcProposal: {
        proposalId: "PROP-SESSION-01",
        title: "Encrypted Redis Session Store",
        // Embedded forbidden fields in proposal
        privateDeliberation: "DESIGN_PRIVATE_SCRATCHPAD_SENTINEL_NESTED",
        scratchpad: "NESTED_SCRATCHPAD_SENTINEL",
        designDefense: "NESTED_DEFENSE_SENTINEL",
        proposedSpecification: {
          summary: "Redis store with AES-256 encryption",
        },
        tradeOffsAndAlternatives: [],
        acceptanceCriteria: ["Sessions encrypted at rest"],
      },
    };

    const envelope = buildGoldfishEnvelope(rawInputWithSentinels);
    const serialized = JSON.stringify(envelope);

    // Verify all sentinels are completely absent from the serialized envelope
    assert.ok(
      !serialized.includes("DESIGN_PRIVATE_SCRATCHPAD_SENTINEL_TOP"),
      "Top-level scratchpad sentinel must NOT leak into envelope"
    );
    assert.ok(
      !serialized.includes("DESIGN_PRIVATE_SCRATCHPAD_SENTINEL_NESTED"),
      "Nested scratchpad sentinel must NOT leak into envelope"
    );
    assert.ok(
      !serialized.includes("DESIGN_INTERNAL_DEFENSE_SENTINEL"),
      "Design internal defense sentinel must NOT leak into envelope"
    );
    assert.ok(
      !serialized.includes("ORCHESTRATOR_PRIVATE_OPINION_SENTINEL"),
      "Orchestrator private opinion sentinel must NOT leak into envelope"
    );
    assert.ok(
      !serialized.includes("INTERMEDIATE_DRAFT_SENTINEL"),
      "Intermediate draft sentinel must NOT leak into envelope"
    );
    assert.ok(
      !serialized.includes("OLD_REVIEW_BIAS"),
      "Previous review bias must NOT leak into envelope"
    );

    // Verify legitimate proposal and evidence remain present
    assert.ok(serialized.includes("Refactor session store"));
    assert.ok(serialized.includes("Redis store with AES-256 encryption"));
    assert.ok(serialized.includes("Sessions encrypted at rest"));
  });

  await t.test("Reconciliation Lifecycle: triggers revision on rejection and enforces 2-cycle BLOCKED limit", () => {
    const proposal = { proposalId: "PROP-001", title: "Cache Layer" };
    const rejectingReport = {
      overallAssessment: "REJECT",
      findings: [
        {
          findingId: "CHAL-001",
          severity: "CRITICAL",
          statement: "Cache stampede vulnerability under concurrent load",
        },
      ],
      requiredCorrections: ["Implement mutex/single-flight locking on cache misses"],
    };

    // Cycle 1: Triggers revision
    const cycle1 = reconcileReview(proposal, rejectingReport, 1);
    assert.equal(cycle1.state, "DESIGN_REVISION_REQUIRED");
    assert.equal(cycle1.cycleCount, 1);
    assert.equal(cycle1.criticalFindings.length, 1);

    // Cycle 2: Still permits revision
    const cycle2 = reconcileReview(proposal, rejectingReport, 2);
    assert.equal(cycle2.state, "DESIGN_REVISION_REQUIRED");
    assert.equal(cycle2.cycleCount, 2);

    // Cycle 3: Exceeds 2-cycle maximum -> Transitions to BLOCKED
    const cycle3 = reconcileReview(proposal, rejectingReport, 3);
    assert.equal(cycle3.state, "BLOCKED");
    assert.ok(cycle3.reason.includes("Exceeded maximum 2 correction cycles"));
    assert.equal(cycle3.unresolvedFindings.length, 1);
    assert.equal(cycle3.reconciledReport.disagreementsPreserved, true);
  });

  await t.test("Reconciliation Lifecycle: transitions to AWAITING_USER_APPROVAL on acceptance", () => {
    const proposal = { proposalId: "PROP-002", title: "Valid Architecture" };
    const acceptedReport = {
      overallAssessment: "ACCEPT",
      findings: [
        {
          findingId: "CHAL-002",
          severity: "LOW",
          statement: "Consider documenting connection timeout values",
        },
      ],
      requiredCorrections: [],
    };

    const result = reconcileReview(proposal, acceptedReport, 1);
    assert.equal(result.state, "AWAITING_USER_APPROVAL");
    assert.equal(result.readyForUserApproval, true);
    assert.equal(result.assessment, "ACCEPT");
  });

  await t.test("Workflow Skill & Orchestrator Prompts: formalize blind envelope and 2-cycle reconciliation", () => {
    assert.ok(
      workflowContent.includes("Orchestrator to Goldfish Blind Envelope"),
      "Workflow skill must formalize blind envelope handoff"
    );
    assert.ok(
      workflowContent.includes("maximum of two (2) Design correction cycles"),
      "Workflow skill must formalize 2-cycle remediation limit"
    );
    assert.ok(
      workflowContent.includes("Preservation of Disagreements"),
      "Workflow skill must mandate preservation of disagreements"
    );
    assert.ok(
      orchestratorContent.includes("blind envelope"),
      "Orchestrator prompt must mandate blind envelope construction"
    );
    assert.ok(
      orchestratorContent.includes("maximum 2 revision cycles"),
      "Orchestrator prompt must enforce maximum 2 revision cycles before BLOCKED"
    );
  });
});

