import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "child_process";
import fs from "fs";
import {
  TEST_LOG_BODY,
  TEST_LOG_SERVICE_NAME,
  getTestLogCommand,
  getTestLogPayload,
  toShellDoubleQuoted,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryTestLog";
import { JSONArray, JSONObject } from "../../../Types/JSON";

/*
 * SEND A TEST LOG (#7760): the one command the logs guide hands out to see
 * the endpoint and the key work before any app is set up. It must be safe
 * to send - one log, at INFO, from a service of its own, timed by the
 * server - easy to tell apart and to remove, and it must reach the shell's
 * curl exactly as written, whatever the server's address and the key hold.
 */

const OTLP_URL: string = "https://oneuptime.acme.example/otlp";
const TOKEN: string = "8e3c9a4e-2f4b-4c6a-9d1e-0123456789ab";

/*
 * The arguments a shell hands curl when it runs the command: curl is a
 * function that prints each one on a line of its own, so nothing is sent.
 */
const runInShell: (command: string) => Array<string> = (
  command: string,
): Array<string> => {
  const output: string = execFileSync(
    "bash",
    ["-c", `curl() { printf '%s\\0' "$@"; }\n${command}`],
    { encoding: "utf8" },
  );

  return output.split("\0").slice(0, -1);
};

const hasBash: boolean = ["/bin/bash", "/usr/bin/bash"].some(
  (file: string): boolean => {
    return fs.existsSync(file);
  },
);

describe("the test log", () => {
  test("is one log at INFO, from oneuptime-test, saying where it came from, with no time of its own", () => {
    const payload: JSONObject = getTestLogPayload();
    const resourceLogs: JSONArray = payload["resourceLogs"] as JSONArray;

    expect(resourceLogs).toHaveLength(1);

    const resourceLog: JSONObject = resourceLogs[0] as JSONObject;

    expect((resourceLog["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "service.name", value: { stringValue: "oneuptime-test" } },
    ]);

    const scopeLogs: JSONArray = resourceLog["scopeLogs"] as JSONArray;
    expect(scopeLogs).toHaveLength(1);

    const records: JSONArray = (scopeLogs[0] as JSONObject)[
      "logRecords"
    ] as JSONArray;

    expect(records).toEqual([
      {
        severityNumber: 9,
        severityText: "INFO",
        body: { stringValue: "Test log from the OneUptime setup guide" },
      },
    ]);
    // The server times it as it arrives: no clock of the sender's.
    expect(JSON.stringify(records)).not.toContain("timeUnixNano");
  });

  test("comes from a service of its own, never an example an app is told to use", () => {
    expect(TEST_LOG_SERVICE_NAME).toBe("oneuptime-test");
    expect(["my-service", "my-react-app", "my-angular-app"]).not.toContain(
      TEST_LOG_SERVICE_NAME,
    );
    expect(TEST_LOG_BODY).toContain("OneUptime");
  });
});

describe("the command", () => {
  test("posts the log as JSON to the endpoint's logs address, with the key", () => {
    const command: string = getTestLogCommand({
      otlpUrl: OTLP_URL,
      token: TOKEN,
    });

    expect(command.split("\n")).toEqual([
      `curl -sS "${OTLP_URL}/v1/logs" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "x-oneuptime-token: ${TOKEN}" \\`,
      `  -d '${JSON.stringify(getTestLogPayload())}'`,
    ]);
  });

  test("an endpoint written with a slash at its end still posts to one /v1/logs", () => {
    expect(
      getTestLogCommand({ otlpUrl: `${OTLP_URL}/`, token: TOKEN }),
    ).toContain(`"${OTLP_URL}/v1/logs"`);
  });

  test("the body holds no single quote, so the shell takes it as written", () => {
    expect(JSON.stringify(getTestLogPayload())).not.toContain("'");
  });

  test("a value is double-quoted with what a shell reads inside double quotes escaped", () => {
    expect(toShellDoubleQuoted("plain")).toBe('"plain"');
    expect(toShellDoubleQuoted('a"b')).toBe('"a\\"b"');
    expect(toShellDoubleQuoted("$HOME")).toBe('"\\$HOME"');
    expect(toShellDoubleQuoted("`id`")).toBe('"\\`id\\`"');
    expect(toShellDoubleQuoted("a\\b")).toBe('"a\\\\b"');
  });

  (hasBash ? test : test.skip)(
    "reaches curl exactly as written: the address, the two headers and the JSON",
    () => {
      expect(
        runInShell(getTestLogCommand({ otlpUrl: OTLP_URL, token: TOKEN })),
      ).toEqual([
        "-sS",
        `${OTLP_URL}/v1/logs`,
        "-H",
        "Content-Type: application/json",
        "-H",
        `x-oneuptime-token: ${TOKEN}`,
        "-d",
        JSON.stringify(getTestLogPayload()),
      ]);
    },
  );

  (hasBash ? test : test.skip)(
    "an address or a key with a shell's own characters in it runs nothing, and reaches curl unchanged",
    () => {
      const otlpUrl: string = 'http://localhost:$PORT/`echo run`/"x"\\y/otlp';
      // Were it run, $(echo ...) and `echo ...` would change what curl gets.
      const token: string = "$(echo run)`echo run`\"'";

      const args: Array<string> = runInShell(
        getTestLogCommand({ otlpUrl: otlpUrl, token: token }),
      );

      expect(args[1]).toBe(`${otlpUrl}/v1/logs`);
      expect(args[5]).toBe(`x-oneuptime-token: ${token}`);
    },
  );
});
