import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolve, normalize, relative, isAbsolute, dirname } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  renameSync,
} from "node:fs";

export const APPROVAL_VERSION = "2.1.0";
export const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_REGISTRY_PATH = resolve(".architecture/tmp/approval-token-registry.json");

/**
 * Loads the persistent token registry from disk.
 * Fails closed if the file exists but contains invalid or corrupt JSON.
 */
export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const absPath = resolve(registryPath);
  if (!existsSync(absPath)) {
    return {
      version: APPROVAL_VERSION,
      usedNonces: [],
      revokedTokenIds: [],
    };
  }

  try {
    const raw = readFileSync(absPath, "utf-8");
    if (!raw.trim()) {
      return {
        version: APPROVAL_VERSION,
        usedNonces: [],
        revokedTokenIds: [],
      };
    }
    const data = JSON.parse(raw);
    if (!Array.isArray(data.usedNonces) || !Array.isArray(data.revokedTokenIds)) {
      throw new Error("Registry schema error: missing required array fields");
    }
    return data;
  } catch (err) {
    throw new Error(`Corrupt authorization registry at '${absPath}': ${err.message}`);
  }
}

/**
 * Saves the token registry atomically to disk to prevent corruption on crash or race conditions.
 */
export function saveRegistry(registry, registryPath = DEFAULT_REGISTRY_PATH) {
  const absPath = resolve(registryPath);
  const dir = dirname(absPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${absPath}.${randomBytes(6).toString("hex")}.tmp`;
  const serialized = JSON.stringify(registry, null, 2) + "\n";

  writeFileSync(tmpPath, serialized, "utf-8");
  try {
    renameSync(tmpPath, absPath);
  } catch {
    // Fallback for Windows cross-volume or lock edge-case
    writeFileSync(absPath, serialized, "utf-8");
  }
}

/**
 * Reset token registries on disk (used primarily for test isolation).
 */
export function resetTokenRegistries(registryPath = DEFAULT_REGISTRY_PATH) {
  const absPath = resolve(registryPath);
  const fresh = {
    version: APPROVAL_VERSION,
    usedNonces: [],
    revokedTokenIds: [],
  };
  saveRegistry(fresh, absPath);
}

/**
 * Revoke an active approval token by tokenId and persist to disk.
 */
export function revokeToken(tokenId, registryPath = DEFAULT_REGISTRY_PATH) {
  if (!tokenId) return;
  const registry = loadRegistry(registryPath);
  const strId = String(tokenId);
  if (!registry.revokedTokenIds.includes(strId)) {
    registry.revokedTokenIds.push(strId);
    saveRegistry(registry, registryPath);
  }
}

/**
 * Check if a token has been explicitly revoked in persistent storage.
 */
export function isTokenRevoked(tokenId, registryPath = DEFAULT_REGISTRY_PATH) {
  if (!tokenId) return false;
  const registry = loadRegistry(registryPath);
  return registry.revokedTokenIds.includes(String(tokenId));
}

/**
 * Generates an unpredictable cryptographic nonce.
 */
export function generateNonce() {
  return randomBytes(16).toString("hex");
}

/**
 * Canonical JSON stringifier to ensure deterministic signature generation.
 */
function canonicalStringify(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * Computes an HMAC-SHA-256 signature over a canonical payload.
 */
export function signPayload(payload, secret) {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    throw new Error("Token signing error: A non-empty string secret is required");
  }
  const canonical = canonicalStringify(payload);
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

/**
 * Issues a cryptographically signed approval token bound to an exact task, proposal, and scope.
 * This authority must be separate from worker agents.
 */
export function issueApprovalToken(params, secret) {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    throw new Error("Token issuance error: A non-empty string secret is required to issue tokens");
  }

  const {
    taskId,
    proposalId,
    approvedScope,
    issuedBy = "human:operator",
    ttlMs = DEFAULT_TOKEN_TTL_MS,
    nonce = generateNonce(),
    tokenId = `tok_${randomBytes(8).toString("hex")}`,
  } = params;

  if (!taskId || typeof taskId !== "string") {
    throw new Error("Token issuance error: 'taskId' is required");
  }
  if (!proposalId || typeof proposalId !== "string") {
    throw new Error("Token issuance error: 'proposalId' is required");
  }
  if (!approvedScope || !Array.isArray(approvedScope.paths) || approvedScope.paths.length === 0) {
    throw new Error("Token issuance error: 'approvedScope.paths' must contain at least one path");
  }

  const now = Date.now();
  const payload = {
    approvalVersion: APPROVAL_VERSION,
    tokenId,
    taskId,
    proposalId,
    approvedScope: {
      paths: approvedScope.paths.map((p) => normalize(p).replace(/^[/\\]/, "")),
      operations: approvedScope.operations || ["modify", "create", "test"],
    },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    issuedBy,
    nonce,
  };

  const signature = signPayload(payload, secret);

  return {
    tokenVersion: APPROVAL_VERSION,
    payload,
    signature,
  };
}

/**
 * Verifies the cryptographic integrity and validity of an approval token.
 *
 * Checks:
 * - Signature authenticity (timing-safe)
 * - Schema version and required fields
 * - Expiration timestamp
 * - Persistent revocation status
 * - Persistent anti-replay protection (atomic nonce tracking)
 */
export function verifyApprovalToken(tokenObj, secret, options = {}) {
  const {
    allowReplay = false,
    currentTime = Date.now(),
    registryPath = DEFAULT_REGISTRY_PATH,
  } = options;

  if (!tokenObj || typeof tokenObj !== "object") {
    return { valid: false, reason: "Malformed token: expected an object" };
  }

  const { payload, signature } = tokenObj;
  if (!payload || typeof payload !== "object" || !signature || typeof signature !== "string") {
    return { valid: false, reason: "Malformed token: missing payload or signature" };
  }

  if (payload.approvalVersion !== APPROVAL_VERSION) {
    return {
      valid: false,
      reason: `Unsupported token version '${payload.approvalVersion}'. Expected '${APPROVAL_VERSION}'`,
    };
  }

  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return {
      valid: false,
      reason: "Verification configuration error: missing or empty verification secret",
    };
  }

  // 1. Cryptographic signature check (timing-safe)
  try {
    const expectedSig = signPayload(payload, secret);
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSig, "hex");

    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, reason: "Cryptographic signature verification failed: invalid signature" };
    }
  } catch (err) {
    return { valid: false, reason: `Signature verification error: ${err.message}` };
  }

  // 2. Expiration check
  const expiresAtMs = Date.parse(payload.expiresAt);
  if (isNaN(expiresAtMs) || currentTime > expiresAtMs) {
    return {
      valid: false,
      reason: `Approval token expired at ${payload.expiresAt} (current time: ${new Date(currentTime).toISOString()})`,
    };
  }

  // 3. Persistent Revocation and Anti-Replay Checks
  let registry;
  try {
    registry = loadRegistry(registryPath);
  } catch (err) {
    return { valid: false, reason: `Authorization registry failure: ${err.message}` };
  }

  if (registry.revokedTokenIds.includes(String(payload.tokenId))) {
    return { valid: false, reason: `Approval token '${payload.tokenId}' has been explicitly revoked` };
  }

  if (!allowReplay) {
    if (registry.usedNonces.includes(payload.nonce)) {
      return { valid: false, reason: `Replay attack detected: nonce '${payload.nonce}' has already been used` };
    }
    // Atomic nonce consumption
    registry.usedNonces.push(payload.nonce);
    try {
      saveRegistry(registry, registryPath);
    } catch (err) {
      return { valid: false, reason: `Failed to persist nonce consumption: ${err.message}` };
    }
  }

  return { valid: true, payload };
}

/**
 * Validates whether a requested target file path is authorized by the token's approvedScope.
 * Prevents directory traversal (`..`), absolute path escape, and symlink escape.
 */
export function isPathAuthorized(targetPath, approvedPaths, workspaceRoot = process.cwd()) {
  if (!targetPath || typeof targetPath !== "string") {
    return { authorized: false, reason: "Missing target file path" };
  }
  if (!Array.isArray(approvedPaths) || approvedPaths.length === 0) {
    return { authorized: false, reason: "No paths specified in approved scope" };
  }

  const absWorkspace = resolve(workspaceRoot);
  const normalizedTarget = normalize(targetPath);

  // Check parent traversal attempt
  if (
    normalizedTarget.startsWith("..") ||
    normalizedTarget.includes("/../") ||
    normalizedTarget.includes("\\..\\") ||
    normalizedTarget.endsWith("/..") ||
    normalizedTarget.endsWith("\\..")
  ) {
    return {
      authorized: false,
      reason: `Path traversal violation: path contains parent traversal '..': ${targetPath}`,
    };
  }

  // Resolve absolute path
  const absTarget = isAbsolute(normalizedTarget)
    ? resolve(normalizedTarget)
    : resolve(absWorkspace, normalizedTarget);

  // Check workspace root escape
  if (!absTarget.startsWith(absWorkspace)) {
    return {
      authorized: false,
      reason: `Workspace escape violation: path resolves outside workspace: ${targetPath}`,
    };
  }

  // Check symlink escape if file exists
  if (existsSync(absTarget)) {
    try {
      const realTarget = realpathSync(absTarget);
      if (!realTarget.startsWith(absWorkspace)) {
        return {
          authorized: false,
          reason: `Symlink escape violation: real path '${realTarget}' escapes workspace root`,
        };
      }
    } catch {
      // Ignore if realpath cannot be resolved
    }
  }

  const relTarget = relative(absWorkspace, absTarget).replace(/\\/g, "/");

  // Check against approved patterns
  const isMatch = approvedPaths.some((approvedPattern) => {
    const pattern = approvedPattern.replace(/\\/g, "/").replace(/^\.\//, "");
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return relTarget.startsWith(prefix + "/") || relTarget === prefix;
    }
    if (pattern.endsWith("/")) {
      return relTarget.startsWith(pattern);
    }
    return relTarget === pattern;
  });

  if (!isMatch) {
    return {
      authorized: false,
      reason: `Scope boundary violation: path '${relTarget}' is not within approved scope [${approvedPaths.join(", ")}]`,
    };
  }

  return { authorized: true, relativePath: relTarget };
}
