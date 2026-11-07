/**
 * Blind Envelope & Reconciliation Engine for Goldfish Independent Review
 * Part of Architecture Engineering V2.1 (Phase 4)
 */

export const BLIND_ENVELOPE_SCHEMA_VERSION = "2.1.0";
export const MAX_REVISION_CYCLES = 2;

/**
 * Known private/subjective fields that MUST be stripped from the Goldfish envelope.
 */
const FORBIDDEN_FIELDS = [
  "privateDeliberation",
  "privateDeliberations",
  "internalDeliberation",
  "internalDeliberations",
  "scratchpad",
  "designScratchpad",
  "intermediateDrafts",
  "draftHistory",
  "authorDefense",
  "designDefense",
  "selfReview",
  "orchestratorOpinion",
  "orchestratorOpinions",
  "orchestratorJudgment",
  "previousGoldfishReviews",
];

/**
 * Deep cleans an object by removing forbidden private fields and sentinel strings.
 */
function sanitizeObject(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const isForbidden = FORBIDDEN_FIELDS.some(
      (f) => key.toLowerCase() === f.toLowerCase() || key.toLowerCase().includes("scratchpad") || key.toLowerCase().includes("deliberation")
    );
    if (isForbidden) {
      continue;
    }
    clean[key] = sanitizeObject(value);
  }
  return clean;
}

/**
 * Constructs the sanitized, filtered blind envelope for Goldfish adversarial review.
 * Enforces that Goldfish receives only objective facts, constraints, and the formal RFC contract.
 *
 * @param {Object} input Raw input from Orchestrator, Discovery, Elephant, and Design
 * @returns {Object} The sealed blind envelope
 */
export function buildGoldfishEnvelope(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid input: Blind envelope builder requires an input object");
  }

  const {
    taskObjective,
    discoveryFindings = [],
    elephantFacts = [],
    elephantConstraints = [],
    rfcProposal,
    acceptanceCriteria = [],
  } = input;

  if (!taskObjective || typeof taskObjective !== "string" || !taskObjective.trim()) {
    throw new Error("Blind envelope contract violation: Missing required 'taskObjective'");
  }

  if (!rfcProposal || typeof rfcProposal !== "object") {
    throw new Error("Blind envelope contract violation: Missing required 'rfcProposal'");
  }

  // Ensure Discovery findings contain only empirical fields
  const cleanDiscovery = discoveryFindings.map((finding) => ({
    findingId: finding.findingId || finding.id,
    statement: finding.statement,
    classification: finding.classification || "verified_fact",
    sourcePath: finding.sourcePath || finding.path,
    lineRange: finding.lineRange,
    symbol: finding.symbol,
    relatedElephantIds: finding.relatedElephantIds || [],
  }));

  // Ensure Elephant facts and constraints are clean
  const cleanFacts = elephantFacts.map((fact) => ({
    id: fact.id,
    title: fact.title,
    status: fact.status,
    provenance: fact.provenance,
  }));

  const cleanConstraints = elephantConstraints.map((constraint) => ({
    id: constraint.id,
    title: constraint.title,
    inviolableRule: constraint.inviolableRule || constraint.statement,
    status: constraint.status,
  }));

  // Sanitize the RFC proposal to ensure no embedded private deliberation leaked
  const cleanProposal = sanitizeObject(rfcProposal);

  // Extract criteria either from top-level or from RFC proposal
  const resolvedCriteria =
    Array.isArray(acceptanceCriteria) && acceptanceCriteria.length > 0
      ? acceptanceCriteria
      : cleanProposal.acceptanceCriteria || [];

  return {
    envelopeVersion: BLIND_ENVELOPE_SCHEMA_VERSION,
    taskObjective: taskObjective.trim(),
    verifiedDiscoveryEvidence: cleanDiscovery,
    approvedElephantFacts: cleanFacts,
    activeElephantConstraints: cleanConstraints,
    proposedSpecification: {
      proposalId: cleanProposal.proposalId || cleanProposal.id,
      title: cleanProposal.title,
      factualGrounding: cleanProposal.factualGrounding || [],
      assumptions: cleanProposal.assumptions || [],
      proposedSpecification: cleanProposal.proposedSpecification || cleanProposal.specification || cleanProposal,
      tradeOffsAndAlternatives: cleanProposal.tradeOffsAndAlternatives || cleanProposal.alternatives || [],
      affectedFiles: cleanProposal.affectedFiles || [],
    },
    acceptanceCriteria: resolvedCriteria,
  };
}

/**
 * Reconciles a Design RFC proposal with Goldfish's Challenge Report.
 * Governs the 2-cycle revision boundary and halts to BLOCKED on unresolvable issues.
 *
 * @param {Object} proposal The Design Agent's RFC proposal
 * @param {Object} challengeReport The Goldfish Challenger's output report
 * @param {number} cycleCount Current correction cycle (1-based)
 * @returns {Object} Reconciliation outcome and next lifecycle state
 */
export function reconcileReview(proposal, challengeReport, cycleCount = 1) {
  if (!proposal || typeof proposal !== "object") {
    throw new Error("Reconciliation violation: Missing proposal payload");
  }
  if (!challengeReport || typeof challengeReport !== "object") {
    throw new Error("Reconciliation violation: Missing challengeReport payload");
  }

  const assessment = challengeReport.overallAssessment || "REJECT";
  const findings = challengeReport.findings || [];

  const criticalFindings = findings.filter(
    (f) => f.severity === "CRITICAL" || f.severity === "HIGH"
  );
  const mediumLowFindings = findings.filter(
    (f) => f.severity === "MEDIUM" || f.severity === "LOW"
  );

  // Remediation Limit: Maximum 2 correction cycles
  if (cycleCount > MAX_REVISION_CYCLES && (assessment === "REJECT" || criticalFindings.length > 0)) {
    return {
      state: "BLOCKED",
      cycleCount,
      reason: `Exceeded maximum ${MAX_REVISION_CYCLES} correction cycles with unresolved critical/high findings`,
      unresolvedFindings: criticalFindings,
      reconciledReport: {
        proposal,
        challengeReport,
        disagreementsPreserved: true,
      },
    };
  }

  // Assessment Rejection or Critical Defect requiring Design correction
  if (assessment === "REJECT" || criticalFindings.length > 0) {
    return {
      state: "DESIGN_REVISION_REQUIRED",
      cycleCount,
      requiredCorrections: challengeReport.requiredCorrections || criticalFindings.map((f) => f.statement),
      criticalFindings,
    };
  }

  // Assessment Accept with Conditions (non-critical issues preserved for user visibility)
  if (assessment === "ACCEPT_WITH_CONDITIONS") {
    return {
      state: "AWAITING_USER_APPROVAL",
      cycleCount,
      readyForUserApproval: true,
      assessment: "ACCEPT_WITH_CONDITIONS",
      conditions: challengeReport.requiredCorrections || [],
      notes: mediumLowFindings,
      reconciledReport: {
        proposal,
        challengeReport,
        disagreementsPreserved: true,
      },
    };
  }

  // Clean Acceptance
  return {
    state: "AWAITING_USER_APPROVAL",
    cycleCount,
    readyForUserApproval: true,
    assessment: "ACCEPT",
    reconciledReport: {
      proposal,
      challengeReport,
      disagreementsPreserved: false,
    },
  };
}

