#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, dirname, basename, join, normalize } from "node:path";

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx).trim();
        const value = arg.slice(eqIdx + 1).trim();
        parsed[key] = value;
      } else {
        parsed[arg.slice(2).trim()] = true;
      }
    }
  }
  return parsed;
}

function parseYamlValue(str) {
  str = str.trim();
  if (str === "" || str === "[]") return [];
  if (str === "{}") return {};
  if (str === "null" || str === "~") return null;
  if (str === "true") return true;
  if (str === "false") return false;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  return str.replace(/^['"](.*)['"]$/, "$1");
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: content, rawYaml: "" };
  const rawYaml = match[1];
  const body = content.slice(match[0].length);

  const lines = rawYaml.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const root = {};
  const stack = [{ indent: -1, container: root }];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const indent = rawLine.search(/\S/);
    const line = rawLine.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const current = stack[stack.length - 1];

    if (line.startsWith("- ")) {
      const itemStr = line.slice(2).trim();
      const colonIdx = itemStr.indexOf(":");
      if (colonIdx !== -1 && !itemStr.startsWith('"') && !itemStr.startsWith("'")) {
        const k = itemStr.slice(0, colonIdx).trim();
        const v = itemStr.slice(colonIdx + 1).trim();
        const obj = {};
        if (v === "") {
          obj[k] = {};
        } else {
          obj[k] = parseYamlValue(v);
        }
        if (Array.isArray(current.container)) {
          current.container.push(obj);
        }
        stack.push({ indent, container: obj });
      } else {
        const val = parseYamlValue(itemStr);
        if (Array.isArray(current.container)) {
          current.container.push(val);
        }
      }
    } else {
      const colonIdx = line.indexOf(":");
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim();
        const valStr = line.slice(colonIdx + 1).trim();

        if (valStr === "") {
          const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
          if (nextLine && nextLine.trim().startsWith("- ")) {
            const arr = [];
            current.container[key] = arr;
            stack.push({ indent, container: arr });
          } else {
            const obj = {};
            current.container[key] = obj;
            stack.push({ indent, container: obj });
          }
        } else {
          current.container[key] = parseYamlValue(valStr);
        }
      }
    }
  }

  if (!root.provenance && root.source_files) {
    root.provenance = { source_files: root.source_files };
  } else if (root.provenance && !root.provenance.source_files && root.source_files) {
    root.provenance.source_files = root.source_files;
  }

  return { frontmatter: root, body, rawYaml };
}

function serializeFrontmatter(frontmatter, body) {
  let yaml = "---\n";
  for (const [key, val] of Object.entries(frontmatter)) {
    if (val === null) {
      yaml += `${key}: null\n`;
    } else if (typeof val === "boolean") {
      yaml += `${key}: ${val}\n`;
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        yaml += `${key}: []\n`;
      } else {
        yaml += `${key}:\n`;
        for (const item of val) {
          if (typeof item === "object" && item !== null) {
            const entries = Object.entries(item);
            if (entries.length > 0) {
              const [firstK, firstV] = entries[0];
              yaml += `  - ${firstK}: "${firstV}"\n`;
              for (let i = 1; i < entries.length; i++) {
                const [k, v] = entries[i];
                yaml += `    ${k}: "${v}"\n`;
              }
            }
          } else {
            yaml += `  - "${item}"\n`;
          }
        }
      }
    } else if (typeof val === "object" && val !== null) {
      yaml += `${key}:\n`;
      for (const [subK, subV] of Object.entries(val)) {
        if (Array.isArray(subV)) {
          if (subV.length === 0) {
            yaml += `  ${subK}: []\n`;
          } else {
            yaml += `  ${subK}:\n`;
            for (const item of subV) {
              if (typeof item === "object" && item !== null) {
                const entries = Object.entries(item);
                if (entries.length > 0) {
                  const [firstK, firstV] = entries[0];
                  yaml += `    - ${firstK}: "${firstV}"\n`;
                  for (let i = 1; i < entries.length; i++) {
                    const [k, v] = entries[i];
                    yaml += `      ${k}: "${v}"\n`;
                  }
                }
              } else {
                yaml += `    - "${item}"\n`;
              }
            }
          }
        } else if (subV === null) {
          yaml += `  ${subK}: null\n`;
        } else {
          yaml += `  ${subK}: "${subV}"\n`;
        }
      }
    } else {
      yaml += `${key}: "${val}"\n`;
    }
  }
  yaml += "---\n";
  return yaml + (body.startsWith("\n") ? body : "\n" + body);
}

function fail(message) {
  throw new Error(message);
}

export function promoteKnowledge(options) {
  const {
    proposalPath,
    category,
    token,
    approver = "human-operator",
    elephantRoot = ".architecture/elephant",
    workspaceRoot = process.cwd(),
    keepDraft = false,
  } = options;

  if (!proposalPath) fail("Missing required option: --proposal");
  if (!category) fail("Missing required option: --category");

  const validCategories = ["facts", "decisions", "constraints", "assumptions", "known-issues", "known_issues"];
  if (!validCategories.includes(category)) {
    fail(`Invalid target category: '${category}'. Must be one of: ${validCategories.join(", ")}`);
  }

  const normalizedCategory = category === "known_issues" ? "known-issues" : category;
  const absWorkspace = resolve(workspaceRoot);
  const absElephant = resolve(absWorkspace, elephantRoot);
  const resolvedProposal = resolve(absWorkspace, proposalPath);

  // Path traversal guard
  if (!resolvedProposal.startsWith(absWorkspace)) {
    fail(`Security violation: Proposal path outside workspace root: ${proposalPath}`);
  }

  if (!existsSync(resolvedProposal)) {
    fail(`Proposal file not found: ${proposalPath}`);
  }

  const fileContent = readFileSync(resolvedProposal, "utf-8");
  const { frontmatter, body } = parseFrontmatter(fileContent);

  if (!frontmatter.id) fail("Malformed proposal: Missing 'id' in frontmatter");
  if (!frontmatter.title) fail("Malformed proposal: Missing 'title' in frontmatter");

  const now = new Date().toISOString();
  let targetStatus = "verified";

  // Tier 2: Governed categories require explicit human approval token
  if (normalizedCategory === "decisions" || normalizedCategory === "constraints") {
    if (!token || typeof token !== "string" || token.trim().length === 0) {
      fail(`Governance rejection: Category '${normalizedCategory}' strictly requires a valid --token`);
    }
    targetStatus = "approved";
    frontmatter.approved_by = approver;
    frontmatter.approval_token = token;
  } else if (normalizedCategory === "facts" || normalizedCategory === "known-issues") {
    // Provenance validation: facts & confirmed issues must cite source files
    targetStatus = "verified";
    const sourceFiles = frontmatter.provenance?.source_files;
    if (!sourceFiles || !Array.isArray(sourceFiles) || sourceFiles.length === 0) {
      fail(`Provenance rejection: Category '${normalizedCategory}' requires at least one source file in provenance.source_files`);
    }
    for (const src of sourceFiles) {
      const relPath = typeof src === "object" ? src.path : src;
      if (!relPath) fail("Provenance rejection: source_files entry missing 'path'");
      const fullSrc = resolve(absWorkspace, relPath);
      if (!existsSync(fullSrc)) {
        fail(`Provenance verification failed: Source file '${relPath}' does not exist on disk`);
      }
    }
  } else if (normalizedCategory === "assumptions") {
    targetStatus = "draft";
  }

  frontmatter.category = normalizedCategory === "known-issues" ? "known_issue" : (normalizedCategory.endsWith("s") ? normalizedCategory.slice(0, -1) : normalizedCategory);
  frontmatter.status = targetStatus;
  frontmatter.last_verified = now;

  const targetDir = join(absElephant, normalizedCategory);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const safeFilename = `${frontmatter.id}.md`;
  const targetFilePath = join(targetDir, safeFilename);

  // Immutability check
  if (existsSync(targetFilePath) && !frontmatter.supersedes) {
    fail(`Immutability violation: Record '${safeFilename}' already exists in ${normalizedCategory}. Updates must specify 'supersedes: "<existing-id>"'`);
  }

  // Handle superseding if specified
  if (frontmatter.supersedes) {
    const supersededPath = join(targetDir, `${frontmatter.supersedes}.md`);
    if (existsSync(supersededPath)) {
      const oldContent = readFileSync(supersededPath, "utf-8");
      const { frontmatter: oldFm, body: oldBody } = parseFrontmatter(oldContent);
      oldFm.status = "superseded";
      oldFm.superseded_by = frontmatter.id;
      oldFm.last_verified = now;
      writeFileSync(supersededPath, serializeFrontmatter(oldFm, oldBody), "utf-8");
    }
  }

  const updatedContent = serializeFrontmatter(frontmatter, body);
  writeFileSync(targetFilePath, updatedContent, "utf-8");

  // Remove draft proposal unless keepDraft is set
  if (!keepDraft && resolvedProposal !== targetFilePath) {
    try {
      unlinkSync(resolvedProposal);
    } catch {
      // Ignore cleanup error if file cannot be removed
    }
  }

  const receipt = {
    success: true,
    id: frontmatter.id,
    category: normalizedCategory,
    targetPath: normalize(targetFilePath).replace(absWorkspace, "").replace(/^[/\\]/, ""),
    status: targetStatus,
    timestamp: now,
    approved_by: frontmatter.approved_by ?? null,
  };

  return receipt;
}

// CLI Execution entrypoint
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1"));

if (isMain || process.argv[1]?.endsWith("elephant-promote.mjs")) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = promoteKnowledge({
      proposalPath: args.proposal,
      category: args.category,
      token: args.token,
      approver: args.approver,
      elephantRoot: args.root,
      workspaceRoot: args.cwd,
      keepDraft: Boolean(args["keep-draft"]),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
  } catch (err) {
    fail(err.message);
  }
}

