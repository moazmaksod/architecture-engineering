import { stdin, stdout } from "node:process";

let input = "";
for await (const chunk of stdin) input += chunk;

let toolName = "matched tool";
try {
  const event = JSON.parse(input || "{}");
  toolName = event.toolCall?.name ?? event.tool_name ?? event.toolName ?? event.tool?.name ?? event.name ?? toolName;
} catch {
  // Keep the gate conservative if the event payload is absent or changes.
}

stdout.write(JSON.stringify({
  decision: "force_ask",
  reason: "Architecture Engineering approval gate: confirm this potentially mutating or external tool call before it executes. Matched action: " + String(toolName)
}) + "\n");
}