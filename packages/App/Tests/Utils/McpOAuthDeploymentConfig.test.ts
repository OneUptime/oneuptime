import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * OAuth sign-in for the MCP server has two operator switches, and a switch
 * that does not reach the process is not a switch:
 *
 *   DISABLE_MCP_OAUTH
 *     The kill switch. An operator who sets it expects the authorization
 *     server under /mcp/oauth to stop answering callers nobody has
 *     identified. If the value never reaches the container, it keeps
 *     answering - and nothing says so.
 *
 *   DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS
 *     For an instance with no route to the internet, where fetching a
 *     client's metadata document can only fail. Unset by accident, every
 *     client that identifies itself by URL fails to connect.
 *
 * Each has to be carried by every way OneUptime is deployed - the env
 * template a Docker Compose install copies, the Compose file that passes it
 * to the containers, and the Helm chart - under the exact name the code
 * reads. A name that drifts in any one of them fails silently, so the chain
 * is pinned here, end to end, on the files themselves.
 *
 * (The chart's own rendering - defaults, each switch on its own, a values
 * file that predates the keys - is covered by
 * HelmChart/Public/oneuptime/tests/mcp-oauth_test.yaml, which CI runs with
 * helm-unittest.)
 */

/* <repo>/packages/App/Tests/Utils -> <repo> */
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const KILL_SWITCH: string = "DISABLE_MCP_OAUTH";
const METADATA_DOCUMENT_SWITCH: string =
  "DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS";

const SWITCHES: Array<string> = [KILL_SWITCH, METADATA_DOCUMENT_SWITCH];

// The containers that need them: the App serves /mcp; Home serves the manifest.
const COMPOSE_SERVICES_THAT_NEED_THEM: Array<string> = ["app", "home"];

const RUNTIME_VARIABLES_ANCHOR: string = "common-runtime-variables";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function linesOf(source: string): Array<string> {
  return source.split("\n");
}

/*
 * A top-level YAML block: from its header line to the next line that starts
 * in column zero. Enough for docker-compose.base.yml, whose top-level keys
 * all start in column zero and whose bodies are all indented.
 */
function topLevelBlock(source: string, header: string): string {
  const lines: Array<string> = linesOf(source);
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(header);
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const TOP_LEVEL_LINE: RegExp = /^[^\s#]/;
  const body: Array<string> = [];

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index]!;

    if (TOP_LEVEL_LINE.test(line)) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

// One service's block inside `services:` (two-space indented name).
function composeServiceBlock(compose: string, service: string): string {
  const lines: Array<string> = linesOf(topLevelBlock(compose, "services:"));
  const start: number = lines.findIndex((line: string): boolean => {
    return line === `  ${service}:`;
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const NEXT_SERVICE_LINE: RegExp = /^ {2}[^\s#]/;
  const body: Array<string> = [];

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index]!;

    if (NEXT_SERVICE_LINE.test(line)) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/*
 * Resolve a Compose `${NAME:-default}` reference the way Compose does: the
 * default applies when the variable is unset OR empty.
 */
function interpolate(reference: string, value: string | undefined): string {
  const DEFAULTED_REFERENCE: RegExp = /^\$\{([A-Z0-9_]+):-(.*)\}$/;
  const match: RegExpMatchArray | null = reference.match(DEFAULTED_REFERENCE);

  expect(match).not.toBeNull();

  return value ? value : match![2]!;
}

// The rule Common/Server/EnvironmentConfig applies to both switches.
function isSwitchedOn(value: string): boolean {
  return value === "true";
}

describe("config.example.env", () => {
  const example: string = readRepoFile("config.example.env");

  test.each(SWITCHES)(
    "ships exactly one line for %s, set to false",
    (name: string) => {
      /*
       * One line, so an operator flips it instead of appending a second (the
       * later line would win), and so an in-place upgrade adds it to an
       * existing config.env. Shipped off: sign-in is ON by default.
       */
      expect(
        linesOf(example).filter((line: string): boolean => {
          return line.startsWith(`${name}=`);
        }),
      ).toEqual([`${name}=false`]);
    },
  );

  test.each(SWITCHES)("explains %s in the lines above it", (name: string) => {
    const lines: Array<string> = linesOf(example);
    const index: number = lines.indexOf(`${name}=false`);

    expect(index).toBeGreaterThan(0);
    // A comment directly above: nobody should have to guess what it does.
    expect(lines[index - 1]!.startsWith("#")).toBe(true);
  });

  test("the two switches are told apart: one name is not a prefix match for the other's line", () => {
    // `DISABLE_MCP_OAUTH=` must not also select the longer variable's line.
    expect(
      linesOf(example).filter((line: string): boolean => {
        return line.startsWith(`${KILL_SWITCH}=`);
      }),
    ).toHaveLength(1);
    expect(
      linesOf(example).filter((line: string): boolean => {
        return line.startsWith(KILL_SWITCH);
      }),
    ).toHaveLength(2);
  });
});

describe("docker-compose.base.yml", () => {
  const compose: string = readRepoFile("docker-compose.base.yml");
  const runtimeVariables: string = topLevelBlock(
    compose,
    `x-${RUNTIME_VARIABLES_ANCHOR}: &${RUNTIME_VARIABLES_ANCHOR}`,
  );

  test.each(SWITCHES)(
    "passes %s through the shared runtime environment, defaulted to false",
    (name: string) => {
      /*
       * Defaulted, so a config.env upgraded in place - which will not have
       * the key - neither warns nor hands the container an empty switch.
       */
      expect(
        linesOf(runtimeVariables).filter((line: string): boolean => {
          return line.trim().startsWith(`${name}:`);
        }),
      ).toEqual([`  ${name}: \${${name}:-false}`]);
    },
  );

  test.each(SWITCHES)(
    "%s appears nowhere else in the file: there is one place to get it wrong",
    (name: string) => {
      expect(
        linesOf(compose).filter((line: string): boolean => {
          return line.trim().startsWith(`${name}:`);
        }),
      ).toHaveLength(1);
    },
  );

  test.each(COMPOSE_SERVICES_THAT_NEED_THEM)(
    "the %s container receives the shared runtime environment",
    (service: string) => {
      const block: string = composeServiceBlock(compose, service);

      expect(block).toContain(`<<: *${RUNTIME_VARIABLES_ANCHOR}`);

      // And does not override either switch with a value of its own.
      for (const name of SWITCHES) {
        expect(block).not.toContain(`${name}:`);
      }
    },
  );

  test.each(SWITCHES)(
    "%s is off when unset or empty, and on only for the value the code reads as on",
    (name: string) => {
      const reference: string = `\${${name}:-false}`;

      expect(runtimeVariables).toContain(`${name}: ${reference}`);

      // An install that never heard of the switch keeps sign-in ON.
      expect(isSwitchedOn(interpolate(reference, undefined))).toBe(false);
      expect(isSwitchedOn(interpolate(reference, ""))).toBe(false);
      expect(isSwitchedOn(interpolate(reference, "false"))).toBe(false);

      // The operator's `true` arrives as the literal the code compares with.
      expect(isSwitchedOn(interpolate(reference, "true"))).toBe(true);
    },
  );
});

describe("Helm chart", () => {
  const helpers: string = readRepoFile(
    "HelmChart/Public/oneuptime/templates/_helpers.tpl",
  );
  const values: string = readRepoFile("HelmChart/Public/oneuptime/values.yaml");

  // The text of one `define` block in _helpers.tpl.
  function helperDefine(name: string): string {
    const header: string = `{{- define "${name}" }}`;
    const start: number = helpers.indexOf(header);

    expect(start).toBeGreaterThanOrEqual(0);

    const next: number = helpers.indexOf("{{- define ", start + header.length);

    return next === -1 ? helpers.slice(start) : helpers.slice(start, next);
  }

  test("the runtime environment helper emits the kill switch from mcpOAuth.disabled", () => {
    expect(helperDefine("oneuptime.env.runtime")).toContain(
      [
        `- name: ${KILL_SWITCH}`,
        '  value: {{ dig "disabled" false ($.Values.mcpOAuth | default dict) | squote }}',
      ].join("\n"),
    );
  });

  test("the runtime environment helper emits the metadata document switch from mcpOAuth.disableClientIdMetadataDocuments", () => {
    expect(helperDefine("oneuptime.env.runtime")).toContain(
      [
        `- name: ${METADATA_DOCUMENT_SWITCH}`,
        '  value: {{ dig "disableClientIdMetadataDocuments" false ($.Values.mcpOAuth | default dict) | squote }}',
      ].join("\n"),
    );
  });

  test.each(SWITCHES)(
    "%s is emitted exactly once in the chart",
    (name: string) => {
      expect(
        linesOf(helpers).filter((line: string): boolean => {
          return line === `- name: ${name}`;
        }),
      ).toHaveLength(1);
    },
  );

  test("both read through dig with a default dict, so a values file that predates the keys still renders", () => {
    /*
     * `$.Values.mcpOAuth.disabled` on a values file with no mcpOAuth block is
     * a nil pointer and fails the whole render - on an upgrade, of every
     * workload. `dig ... (… | default dict)` answers false instead.
     */
    const runtime: string = helperDefine("oneuptime.env.runtime");

    expect(runtime).not.toContain("$.Values.mcpOAuth.disabled");
    expect(runtime).not.toContain(
      "$.Values.mcpOAuth.disableClientIdMetadataDocuments",
    );
    expect(runtime.split("($.Values.mcpOAuth | default dict)").length - 1).toBe(
      2,
    );
  });

  test.each(["app", "worker", "home"])(
    "the %s workload includes the runtime environment helper",
    (workload: string) => {
      // app and worker boot the server that serves /mcp; home serves the manifest.
      expect(
        readRepoFile(`HelmChart/Public/oneuptime/templates/${workload}.yaml`),
      ).toContain('include "oneuptime.env.runtime"');
    },
  );

  test("values.yaml declares both switches, off", () => {
    const lines: Array<string> = linesOf(values);
    const header: number = lines.indexOf("mcpOAuth:");

    expect(header).toBeGreaterThanOrEqual(0);

    // The block's own keys: the indented lines directly under the header.
    const keys: Array<string> = [];

    for (let index: number = header + 1; index < lines.length; index++) {
      if (!lines[index]!.startsWith("  ")) {
        break;
      }

      keys.push(lines[index]!);
    }

    expect(keys).toEqual([
      "  disabled: false",
      "  disableClientIdMetadataDocuments: false",
    ]);
  });

  test("values.yaml declares the block once", () => {
    expect(
      linesOf(values).filter((line: string): boolean => {
        return line.startsWith("mcpOAuth:");
      }),
    ).toHaveLength(1);
  });

  test("the values schema accepts exactly the two booleans", () => {
    const schema: {
      properties: Record<
        string,
        {
          type?: string;
          properties?: Record<string, { type?: string }>;
          additionalProperties?: boolean;
        }
      >;
    } = JSON.parse(
      readRepoFile("HelmChart/Public/oneuptime/values.schema.json"),
    );

    expect(schema.properties["mcpOAuth"]).toEqual({
      type: "object",
      properties: {
        disabled: { type: "boolean" },
        disableClientIdMetadataDocuments: { type: "boolean" },
      },
      /*
       * A misspelt key (mcpOAuth.disable: true) must fail the install rather
       * than be ignored and leave sign-in on.
       */
      additionalProperties: false,
    });
  });

  test("the chart's own unit tests cover both switches", () => {
    const suite: string = readRepoFile(
      "HelmChart/Public/oneuptime/tests/mcp-oauth_test.yaml",
    );

    for (const name of SWITCHES) {
      expect(suite).toContain(`name: ${name}`);
    }

    expect(suite).toContain("mcpOAuth.disabled: true");
    expect(suite).toContain("mcpOAuth.disableClientIdMetadataDocuments: true");
  });
});

describe("the names are the ones the code reads", () => {
  const WHITESPACE: RegExp = /\s+/g;

  const environmentConfig: string = readRepoFile(
    "packages/Common/Server/EnvironmentConfig.ts",
  ).replace(WHITESPACE, "");

  test("the kill switch is read from DISABLE_MCP_OAUTH, on only for the literal true", () => {
    expect(environmentConfig).toContain(
      `exportconstDisableMcpOAuth:boolean=process.env["${KILL_SWITCH}"]==="true";`,
    );
  });

  test("the metadata document switch is read from DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS, on only for the literal true", () => {
    expect(environmentConfig).toContain(
      `exportconstDisableMcpOAuthClientIdMetadataDocuments:boolean=process.env["${METADATA_DOCUMENT_SWITCH}"]==="true";`,
    );
  });

  test.each(SWITCHES)("%s is read in exactly one place", (name: string) => {
    expect(environmentConfig.split(`process.env["${name}"]`).length - 1).toBe(
      1,
    );
  });

  test("what Helm renders is what the code compares with", () => {
    /*
     * `squote` turns the boolean into the quoted string 'true' / 'false',
     * which YAML reads as the string true / false - the literal the code
     * tests for. An unquoted boolean would reach the container as the same
     * text, but only by the grace of the YAML-to-env conversion.
     */
    const helpers: string = readRepoFile(
      "HelmChart/Public/oneuptime/templates/_helpers.tpl",
    );

    for (const name of SWITCHES) {
      const lines: Array<string> = linesOf(helpers);
      const index: number = lines.indexOf(`- name: ${name}`);

      expect(index).toBeGreaterThanOrEqual(0);
      expect(lines[index + 1]!.trim().endsWith("| squote }}")).toBe(true);
    }

    expect(isSwitchedOn("true")).toBe(true);
    expect(isSwitchedOn("false")).toBe(false);
  });

  test("Home, which only describes the server, reads the same switch", () => {
    const routes: string = readRepoFile("packages/Home/Routes.ts").replace(
      WHITESPACE,
      "",
    );

    expect(routes).toContain("isOAuthEnabled:!DisableMcpOAuth");
  });
});
