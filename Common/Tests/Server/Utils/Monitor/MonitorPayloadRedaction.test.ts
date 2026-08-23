import {
  redactForPersistence,
  stripAgentCredentials,
} from "../../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * Regression tests for https://github.com/OneUptime/oneuptime/issues/3360.
 *
 * The infrastructure agent authenticates with the monitor's
 * `serverMonitorSecretKey` and sends that key in the request BODY as well as
 * the URL (InfrastructureAgent/model/server_monitor_report.go:
 * `SecretKey string \`json:"secretKey"\``). The body became `dataToProcess`,
 * and `dataToProcess` was written verbatim into three columns that
 * `Permission.Viewer` -- the least privilege OneUptime grants -- can select:
 * `MonitorLog.logBody`, `Monitor.serverMonitorResponse` and
 * `MonitorProbe.lastMonitoringLog`.
 *
 * The property under test is therefore not "the redactor works" in the
 * abstract. It is: given the payload the real agent actually sends, the secret
 * does not appear ANYWHERE in the output, in any spelling, at any depth --
 * while every legitimate monitor observation survives untouched, because a
 * redactor that eats the metrics is a redactor somebody will turn off.
 */

// A value distinctive enough that a substring search for it is meaningful.
const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

type AgentPayloadFunction = () => JSONObject;

/*
 * The real shape, key-for-key, that the Go agent marshals and
 * ProcessServerMonitorIngest deserializes -- plus the two fields
 * MonitorResource stamps on before anything is persisted (`projectId`,
 * `evaluationSummary`). Reproduced faithfully because a redactor tested only
 * against a toy `{secretKey: "x"}` proves nothing about the payload that
 * actually leaked.
 */
const agentPayload: AgentPayloadFunction = (): JSONObject => {
  return {
    secretKey: SECRET,
    basicInfrastructureMetrics: {
      memoryMetrics: {
        total: 16_777_216,
        free: 4_194_304,
        used: 12_582_912,
        percentUsed: 75,
        percentFree: 25,
        cached: 1_048_576,
        swapTotal: 0,
      },
      cpuMetrics: {
        percentUsed: 12.5,
        cores: 8,
        perCorePercent: [10, 15, 12, 11, 14, 13, 12, 13],
      },
      diskMetrics: [{ diskPath: "/", total: 500, free: 200, percentUsed: 60 }],
    },
    requestReceivedAt: "2026-08-23T10:00:00.000Z",
    onlyCheckRequestReceivedAt: false,
    processes: [
      { pid: 1, name: "systemd", command: "/sbin/init", cpuPercent: 0.1 },
      { pid: 42, name: "node", command: "node index.js", cpuPercent: 3.2 },
    ],
    hostname: "web-01.internal",
    monitorId: "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c",
    timeNow: "2026-08-23T10:00:01.000Z",
    evaluationSummary: {
      evaluatedAt: "2026-08-23T10:00:01.000Z",
      criteriaResults: [],
      events: [],
    },
    projectId: "3c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19",
  };
};

type ContainsSecretFunction = (value: unknown) => boolean;

/*
 * The assertion that actually matters. Checking `output.secretKey` alone would
 * pass for an implementation that merely moved the value one level down, so
 * every test asserts on the serialized whole.
 */
const containsSecret: ContainsSecretFunction = (value: unknown): boolean => {
  return JSON.stringify(value)?.includes(SECRET) ?? false;
};

describe("stripAgentCredentials - the ingest boundary", () => {
  it("removes the secret the agent puts in the request body", () => {
    const output: JSONObject = stripAgentCredentials(agentPayload());

    expect(output["secretKey"]).toBeUndefined();
    expect("secretKey" in output).toBe(false);
    expect(containsSecret(output)).toBe(false);
  });

  it("keeps every legitimate observation in the beat", () => {
    const input: JSONObject = agentPayload();
    const output: JSONObject = stripAgentCredentials(input);

    /*
     * The whole point of a server monitor. If redaction ever starts eating
     * these, criteria stop evaluating and the feature is dead -- so pin the
     * metrics block as deep-equal rather than spot-checking one field.
     */
    expect(output["basicInfrastructureMetrics"]).toEqual(
      input["basicInfrastructureMetrics"],
    );
    expect(output["processes"]).toEqual(input["processes"]);
    expect(output["hostname"]).toBe("web-01.internal");
    expect(output["monitorId"]).toBe("8f14e45f-ceea-467a-9575-1b0d0d3e7a9c");
    expect(output["projectId"]).toBe("3c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19");
    expect(output["onlyCheckRequestReceivedAt"]).toBe(false);
    expect(output["requestReceivedAt"]).toBe("2026-08-23T10:00:00.000Z");
    expect(output["evaluationSummary"]).toEqual(input["evaluationSummary"]);
  });

  it("drops the key rather than masking it, so the typed column stays faithful", () => {
    /*
     * `Monitor.serverMonitorResponse` is typed as ServerMonitorResponse, which
     * declares no `secretKey`. Masking would persist a phantom field on a
     * typed jsonb column; removing keeps the stored object a valid instance of
     * its own interface.
     */
    const output: JSONObject = stripAgentCredentials(agentPayload());

    expect(Object.keys(output)).not.toContain("secretKey");
    expect(JSON.stringify(output)).not.toContain(REDACTED);
  });

  it("does not mutate the payload it was handed", () => {
    /*
     * The caller keeps using the input object. An in-place strip would be a
     * different bug wearing the same fix: it would change what the monitor
     * evaluates, not just what gets stored.
     */
    const input: JSONObject = agentPayload();

    stripAgentCredentials(input);

    expect(input["secretKey"]).toBe(SECRET);
  });

  it("returns a defensive copy, not the same object", () => {
    const input: JSONObject = agentPayload();
    const output: JSONObject = stripAgentCredentials(input);

    expect(output).not.toBe(input);
    expect(output["processes"]).not.toBe(input["processes"]);
  });
});

describe("stripAgentCredentials - spellings and nesting", () => {
  it("catches the secret under every spelling of the key", () => {
    /*
     * The Go struct tag is `secretKey` today. A future agent, a proxy that
     * renames fields, or a different ingest path may spell it otherwise, and
     * the classifier normalizes case and separators for exactly that reason.
     */
    for (const key of [
      "secretKey",
      "secret_key",
      "SecretKey",
      "SECRET_KEY",
      "secret-key",
      "monitorSecretKey",
      "serverMonitorSecretKey",
    ]) {
      const output: JSONObject = stripAgentCredentials({
        [key]: SECRET,
        hostname: "web-01",
      });

      expect(containsSecret(output)).toBe(false);
      expect(output["hostname"]).toBe("web-01");
    }
  });

  it("finds a credential buried below the top level", () => {
    const output: JSONObject = stripAgentCredentials({
      hostname: "web-01",
      nested: { deeper: { secretKey: SECRET, keep: "yes" } },
    });

    expect(containsSecret(output)).toBe(false);
    expect(
      ((output["nested"] as JSONObject)["deeper"] as JSONObject)["keep"],
    ).toBe("yes");
  });

  it("finds a credential inside an array element", () => {
    const output: JSONObject = stripAgentCredentials({
      beats: [{ secretKey: SECRET }, { hostname: "web-02" }],
    });

    expect(containsSecret(output)).toBe(false);
    expect(output["beats"] as Array<JSONObject>).toHaveLength(2);
    expect((output["beats"] as Array<JSONObject>)[1]!["hostname"]).toBe(
      "web-02",
    );
  });

  it("handles null, undefined and empty payloads without throwing", () => {
    expect(stripAgentCredentials(null)).toBeNull();
    expect(stripAgentCredentials(undefined)).toBeUndefined();
    expect(stripAgentCredentials({})).toEqual({});
    expect(stripAgentCredentials({ a: null, b: undefined })).toEqual({
      a: null,
      b: undefined,
    });
  });

  it("passes class instances through as leaves", () => {
    /*
     * The ingest boundary runs on JSONFunctions.deserialize output, which
     * rehydrates Dates and ObjectIDs into live instances. Walking into them
     * would rebuild them as plain objects and destroy the type.
     */
    const date: Date = new Date("2026-08-23T10:00:00.000Z");

    const output: JSONObject = stripAgentCredentials({
      requestReceivedAt: date,
      secretKey: SECRET,
    });

    expect(output["requestReceivedAt"]).toBe(date);
    expect(output["requestReceivedAt"] instanceof Date).toBe(true);
    expect(containsSecret(output)).toBe(false);
  });
});

describe("redactForPersistence - the logBody sink", () => {
  it("masks the secret instead of dropping it", () => {
    /*
     * logBody is a diagnostic record, so the useful answer is "a credential
     * was here" rather than silence. The value still must not survive.
     */
    const output: JSONObject = redactForPersistence(
      agentPayload(),
    ) as JSONObject;

    expect(output["secretKey"]).toBe(REDACTED);
    expect(containsSecret(output)).toBe(false);
  });

  it("masks the auth headers an incoming-request monitor records", () => {
    /*
     * The second half of the issue: IncomingMonitorRequest carries
     * requestHeaders and requestBody straight from the caller, so whatever
     * token the caller sent was landing in Viewer-readable logBody too.
     */
    const output: JSONObject = redactForPersistence({
      requestHeaders: {
        Authorization: `Bearer ${SECRET}`,
        Cookie: `session=${SECRET}`,
        "x-api-key": SECRET,
        "content-type": "application/json",
        "user-agent": "curl/8.0",
      },
      requestBody: { password: SECRET, orderId: "A-1001" },
      incomingRequestReceivedAt: "2026-08-23T10:00:00.000Z",
    }) as JSONObject;

    const headers: JSONObject = output["requestHeaders"] as JSONObject;

    expect(headers["Authorization"]).toBe(REDACTED);
    expect(headers["Cookie"]).toBe(REDACTED);
    expect(headers["x-api-key"]).toBe(REDACTED);

    // Non-credential headers are exactly why masking beats dropping the block.
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["user-agent"]).toBe("curl/8.0");

    expect((output["requestBody"] as JSONObject)["password"]).toBe(REDACTED);
    expect((output["requestBody"] as JSONObject)["orderId"]).toBe("A-1001");
    expect(containsSecret(output)).toBe(false);
  });

  it("leaves probe observations that only look credential-shaped alone", () => {
    /*
     * Over-redaction is a real cost here: these are the fields monitor
     * criteria are written against, and `code` in particular is classified by
     * VALUE, so an error code must survive while an OAuth code must not.
     */
    const output: JSONObject = redactForPersistence({
      responseCode: 200,
      responseTimeInMs: 143,
      requestFailedDetails: {
        failedPhase: "TCP Connection",
        errorCode: "ECONNREFUSED",
        errorDescription: "Connection refused",
      },
      sslResponse: {
        certificateValidationErrorCode: "CERT_HAS_EXPIRED",
        fingerprint: "AA:BB:CC",
        serialNumber: "0123456789",
        commonName: "example.com",
      },
      customCodeMonitorResponse: {
        executionTimeInMS: 12,
        scriptError: undefined,
      },
      code: "ECONNREFUSED",
    }) as JSONObject;

    expect(output["responseCode"]).toBe(200);
    expect(output["responseTimeInMs"]).toBe(143);
    expect((output["requestFailedDetails"] as JSONObject)["errorCode"]).toBe(
      "ECONNREFUSED",
    );
    expect(
      (output["sslResponse"] as JSONObject)["certificateValidationErrorCode"],
    ).toBe("CERT_HAS_EXPIRED");
    expect((output["sslResponse"] as JSONObject)["commonName"]).toBe(
      "example.com",
    );
    expect(
      (output["customCodeMonitorResponse"] as JSONObject)["executionTimeInMS"],
    ).toBe(12);
    expect(output["code"]).toBe("ECONNREFUSED");
  });

  it("still redacts a code that is actually a credential", () => {
    const output: JSONObject = redactForPersistence({
      code: SECRET,
    }) as JSONObject;

    expect(output["code"]).toBe(REDACTED);
  });

  it("does not mutate the payload it was handed", () => {
    const input: JSONObject = agentPayload();

    redactForPersistence(input);

    expect(input["secretKey"]).toBe(SECRET);
  });

  it("handles null and undefined without throwing", () => {
    expect(redactForPersistence(null)).toBeNull();
    expect(redactForPersistence(undefined as never)).toBeUndefined();
  });

  it("drops rather than passes through a subtree past the depth ceiling", () => {
    /*
     * A payload nested deeper than the walk will go is not something a monitor
     * legitimately reports, and passing the tail through unredacted would be
     * an trivially exploitable way to smuggle a secret past the walk.
     */
    let deep: JSONObject = { secretKey: SECRET };

    for (let i: number = 0; i < 40; i++) {
      deep = { nested: deep };
    }

    expect(containsSecret(redactForPersistence(deep))).toBe(false);
    expect(containsSecret(stripAgentCredentials(deep))).toBe(false);
  });
});

describe("the reproduction in the issue", () => {
  it("no longer yields the monitor secret from a stored beat", () => {
    /*
     * Issue #3360, steps 1-4: register an agent, select logBody with a
     * Viewer-only key, read logBody.secretKey, compare to
     * Monitor.serverMonitorSecretKey. The comparison is what must now fail.
     */
    const stored: JSONObject = redactForPersistence(
      stripAgentCredentials(agentPayload()),
    ) as JSONObject;

    expect(stored["secretKey"]).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(SECRET);

    // And the beat is still a usable monitor observation.
    expect(stored["hostname"]).toBe("web-01.internal");
    expect(stored["basicInfrastructureMetrics"]).toBeDefined();
  });
});
