import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/*
 * AI connections never log a provider key or anything a person wrote.
 *
 * The connectors, the read loop, the service, the routes and the worker
 * job handle decrypted credentials and, for company AI tools, people's
 * conversations. Their log lines may name a connection and say what went
 * wrong; the code inside a log call may not touch the settings, the
 * secrets, a request's headers or body, or a chat's turns and messages.
 * What a failure says is kept on the connection after LlmProviderError
 * redacts it, never written to the logs on the way.
 */

const COMMON_ROOT: string = path.join(__dirname, "../../../..");
const REPO_ROOT: string = path.join(COMMON_ROOT, "../..");

function listFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }

  return files;
}

const FILES: Array<string> = [
  ...listFiles(path.join(COMMON_ROOT, "Server/Utils/LlmObservability")),
  path.join(
    COMMON_ROOT,
    "Server/Services/LlmObservabilityConnectionService.ts",
  ),
  path.join(COMMON_ROOT, "Server/API/LlmObservabilityConnectionAPI.ts"),
  ...listFiles(
    path.join(
      REPO_ROOT,
      "packages/App/FeatureSet/Workers/Jobs/LlmObservability",
    ),
  ),
];

// Names whose values hold a credential or what someone wrote.
const FORBIDDEN_NAMES: Array<string> = [
  "settings",
  "secrets",
  "secret",
  "secretValues",
  "config",
  "adminKey",
  "apiKey",
  "clientSecret",
  "complianceAccessKey",
  "serviceAccountJson",
  "secretAccessKey",
  "privateKey",
  "token",
  "accessToken",
  "headers",
  "body",
  "bodyText",
  "responseBody",
  "payload",
  "turn",
  "turns",
  "question",
  "answer",
  "messages",
  "parts",
  "interaction",
  "interactions",
  "chat",
  "records",
];

/*
 * The text of a call starting at the "(" at `open`, up to its matching
 * ")": string and template text skipped, so a parenthesis in a message
 * does not end it.
 */
function callAt(source: string, open: number): string {
  let depth: number = 0;
  let index: number = open;

  while (index < source.length) {
    const character: string = source[index]!;

    if (character === '"' || character === "'" || character === "`") {
      index = skipString(source, index);
      continue;
    }

    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;

      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }

    index++;
  }

  return source.slice(open);
}

// Past the end of the string or template starting at `start`.
function skipString(source: string, start: number): number {
  const quote: string = source[start]!;
  let index: number = start + 1;

  while (index < source.length && source[index] !== quote) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }

    if (quote === "`" && source[index] === "$" && source[index + 1] === "{") {
      let depth: number = 0;
      index += 2;

      while (index < source.length) {
        if (source[index] === "{") {
          depth++;
        } else if (source[index] === "}") {
          if (depth === 0) {
            break;
          }
          depth--;
        }
        index++;
      }
    }

    index++;
  }

  return index + 1;
}

// The code of a call: string text dropped, template expressions kept.
function codeOf(call: string): string {
  let code: string = "";
  let index: number = 0;

  while (index < call.length) {
    const character: string = call[index]!;

    if (character === '"' || character === "'") {
      index = skipString(call, index);
      code += " ";
      continue;
    }

    if (character === "`") {
      index++;

      while (index < call.length && call[index] !== "`") {
        if (call[index] === "\\") {
          index += 2;
          continue;
        }

        if (call[index] === "$" && call[index + 1] === "{") {
          let depth: number = 0;
          index += 2;
          code += " ";

          while (index < call.length) {
            if (call[index] === "{") {
              depth++;
            } else if (call[index] === "}") {
              if (depth === 0) {
                break;
              }
              depth--;
            }
            code += call[index];
            index++;
          }

          code += " ";
        }

        index++;
      }

      index++;
      continue;
    }

    code += character;
    index++;
  }

  return code;
}

function logCallsIn(source: string): Array<string> {
  const calls: Array<string> = [];
  let from: number = 0;

  for (;;) {
    const at: number = source.indexOf("logger.", from);

    if (at === -1) {
      return calls;
    }

    const open: number = source.indexOf("(", at);
    calls.push(callAt(source, open));
    from = open + 1;
  }
}

function namesIn(code: string): Set<string> {
  const names: Set<string> = new Set<string>();
  let current: string = "";

  for (const character of `${code} `) {
    const code: number = character.charCodeAt(0);
    const isNameCharacter: boolean =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      character === "_" ||
      character === "$";

    if (isNameCharacter) {
      current += character;
      continue;
    }

    if (current) {
      names.add(current);
      current = "";
    }
  }

  return names;
}

describe("AI connections never log a key or what someone wrote", () => {
  test("the scan reads the files it is meant to (it is not vacuous)", () => {
    expect(FILES.length).toBeGreaterThan(25);
    const calls: number = FILES.reduce((sum: number, file: string) => {
      return sum + logCallsIn(fs.readFileSync(file, "utf8")).length;
    }, 0);
    expect(calls).toBeGreaterThan(3);
  });

  test("the scan finds a forbidden name in a call that has one", () => {
    const [call] = logCallsIn(
      'logger.error(`read failed (${connectionId}): ${JSON.stringify(settings.secrets)}`, { x: "(" });',
    );
    expect(namesIn(codeOf(call!)).has("settings")).toBe(true);
    expect(namesIn(codeOf(call!)).has("failed")).toBe(false);
  });

  test.each(
    FILES.map((file: string) => {
      return [path.relative(REPO_ROOT, file), file];
    }),
  )("%s", (_relative: string, file: string) => {
    const source: string = fs.readFileSync(file, "utf8");

    expect(source).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\(/);

    for (const call of logCallsIn(source)) {
      const names: Set<string> = namesIn(codeOf(call));

      for (const forbidden of FORBIDDEN_NAMES) {
        if (names.has(forbidden)) {
          throw new Error(`A log call reads "${forbidden}": ${call}`);
        }
      }
    }
  });
});
