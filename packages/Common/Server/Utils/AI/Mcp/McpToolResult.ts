import { JSONObject } from "../../../../Types/JSON";

/*
 * WHAT A TOOL OF AN EXTERNAL MCP SERVER ANSWERED, as text OneUptime AI
 * reads.
 *
 * A tools/call result is a list of content parts - text, images, audio,
 * links to resources, embedded resources - plus, for newer servers, a
 * structured copy of the result. OneUptime AI reads text, so:
 *
 *   - text parts are kept as they are;
 *   - an embedded resource's text is kept, under its address;
 *   - a link to a resource is named with its address;
 *   - images, audio and binary files are named and left out (a model reads
 *     no pixels here, and base64 would only be billed);
 *   - with no text at all, the structured result is shown as JSON.
 *
 * The text is the server's, from outside OneUptime: the caller hands it to
 * the model as data, never as instructions (McpRunToolkit frames it).
 */

export interface McpToolResultText {
  // The tool says it failed (isError).
  isError: boolean;
  text: string;
  // Parts that were named and left out: images, audio, files.
  omittedParts: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function describeType(mimeType: string, noun: string): string {
  return mimeType ? `${noun} (${mimeType})` : noun;
}

export function readMcpToolResult(result: JSONObject): McpToolResultText {
  const parts: Array<string> = [];
  let omittedParts: number = 0;
  // Whether the tool returned text of its own (text, or a resource's text).
  let hasText: boolean = false;

  const content: Array<unknown> = Array.isArray(result["content"])
    ? (result["content"] as Array<unknown>)
    : [];

  for (const part of content) {
    if (!isObject(part)) {
      continue;
    }

    const type: string = readString(part["type"]);
    const mimeType: string = readString(part["mimeType"]).slice(0, 100);

    switch (type) {
      case "text":
        if (typeof part["text"] === "string") {
          parts.push(part["text"]);
          hasText = hasText || part["text"].trim().length > 0;
        }
        break;
      case "image":
        omittedParts++;
        parts.push(
          `[${describeType(mimeType, "An image")} the tool returned is not shown.]`,
        );
        break;
      case "audio":
        omittedParts++;
        parts.push(
          `[${describeType(mimeType, "An audio clip")} the tool returned is not shown.]`,
        );
        break;
      case "resource_link": {
        const uri: string = readString(part["uri"]).slice(0, 2000);
        const name: string = readString(part["name"]).slice(0, 200);
        parts.push(`[Resource ${name ? `${name}: ` : ""}${uri}]`);
        break;
      }
      case "resource": {
        const resource: Record<string, unknown> = isObject(part["resource"])
          ? part["resource"]
          : {};
        const uri: string = readString(resource["uri"]).slice(0, 2000);

        if (typeof resource["text"] === "string") {
          parts.push(`[Resource ${uri}]\n${resource["text"]}`);
          hasText = hasText || resource["text"].trim().length > 0;
        } else {
          omittedParts++;
          parts.push(
            `[${describeType(
              readString(resource["mimeType"]).slice(0, 100),
              `The file ${uri}`,
            )} the tool returned is not shown.]`,
          );
        }
        break;
      }
      default:
        omittedParts++;
        parts.push(
          `[A part of type "${type.slice(0, 40) || "unknown"}" the tool returned is not shown.]`,
        );
        break;
    }
  }

  if (!hasText && isObject(result["structuredContent"])) {
    parts.push(JSON.stringify(result["structuredContent"], null, 2));
  }

  const text: string = parts.join("\n").trim();

  return {
    isError: result["isError"] === true,
    text: text || "(The tool returned nothing.)",
    omittedParts,
  };
}
