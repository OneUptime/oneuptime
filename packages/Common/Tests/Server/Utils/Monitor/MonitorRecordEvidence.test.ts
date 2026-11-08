import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorRecordEvidence from "../../../../Server/Utils/Monitor/MonitorRecordEvidence";
import Hostname from "../../../../Types/API/Hostname";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
  MonitorSummarySnapshotVersion,
} from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import Port from "../../../../Types/Port";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN INCIDENT OR AN ALERT KEEPS OF THE CHECK: THE STORED CHECK AND THE
 * MONITOR SUMMARY.
 *
 * Both are cut by the same rules as the evaluation details: credential
 * headers keep their name and lose their value, the destination is the one
 * the step was configured with (monitor secrets by name), and a monitor set
 * to keep no response content keeps no body at all.
 */

const REDACTED: string = "[REDACTED]";

function monitor(keepResponseContent?: boolean): Monitor {
  const model: Monitor = new Monitor();
  model.monitorType = MonitorType.API;

  if (keepResponseContent !== undefined) {
    model.keepResponseContent = keepResponseContent;
  }

  return model;
}

function probeResponse(): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    isOnline: true,
    responseCode: 500,
    responseBody: '{"error":"db down","owner":"ops@acme.example"}',
    responseHeaders: {
      "content-type": "application/json",
      "set-cookie": "sid=abc",
      authorization: "Bearer xyz",
      "x-request-id": "r-1",
    },
    monitorDestination: URL.fromString(
      "https://api.acme.example/health?token=s3cret",
    ),
    failureCause: "",
    monitoredAt: new Date("2026-11-08T10:00:00.000Z"),
  } as unknown as ProbeMonitorResponse;
}

function snapshotOf(
  response: Partial<MonitorSummarySnapshot>,
): MonitorSummarySnapshot {
  return {
    version: MonitorSummarySnapshotVersion,
    source: MonitorSummarySnapshotSource.Captured,
    monitorType: MonitorType.API,
    capturedAt: new Date("2026-11-08T10:00:01.000Z"),
    ...response,
  };
}

function stepTo(destination: URL | Hostname | string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.monitorDestination = destination as URL;
  return step;
}

describe("whether a monitor keeps response content", () => {
  test("it does unless it was switched off", () => {
    expect(MonitorRecordEvidence.keepsResponseContent(monitor())).toBe(true);
    expect(MonitorRecordEvidence.keepsResponseContent(monitor(true))).toBe(
      true,
    );
    expect(MonitorRecordEvidence.keepsResponseContent(monitor(false))).toBe(
      false,
    );
    // A monitor read without the column keeps it, as every one did before.
    expect(MonitorRecordEvidence.keepsResponseContent(undefined)).toBe(true);
  });

  test.each([
    [MonitorType.Website, true],
    [MonitorType.API, true],
    [MonitorType.IncomingRequest, true],
    [MonitorType.Ping, false],
    [MonitorType.Logs, false],
    [MonitorType.Manual, false],
  ])(
    "the switch is offered for %s: %s",
    (type: MonitorType, offered: boolean) => {
      expect(MonitorRecordEvidence.isResponseContentMonitorType(type)).toBe(
        offered,
      );
    },
  );
});

describe("the stored check (createdStateLog, the state timeline's log)", () => {
  test("masks the credential headers, as the monitor's own log is", () => {
    const stored: JSONObject = MonitorRecordEvidence.toStoredCheck({
      dataToProcess: probeResponse() as unknown as DataToProcess,
      keepResponseContent: true,
    });

    expect(stored["responseHeaders"]).toEqual({
      "content-type": "application/json",
      "set-cookie": REDACTED,
      authorization: REDACTED,
      "x-request-id": "r-1",
    });
    expect(stored["responseBody"]).toBe(
      '{"error":"db down","owner":"ops@acme.example"}',
    );
    expect(stored["responseCode"]).toBe(500);
  });

  test("keeps no body for a monitor that keeps no response content", () => {
    const stored: JSONObject = MonitorRecordEvidence.toStoredCheck({
      dataToProcess: probeResponse() as unknown as DataToProcess,
      keepResponseContent: false,
    });

    expect(stored["responseBody"]).toBeUndefined();
    expect(stored["responseCode"]).toBe(500);
  });

  test("nor an incoming request's body", () => {
    const stored: JSONObject = MonitorRecordEvidence.toStoredCheck({
      dataToProcess: {
        requestBody: { alert: "fired" },
        requestHeaders: { authorization: "Bearer xyz" },
        incomingRequestReceivedAt: new Date(),
      } as unknown as DataToProcess,
      keepResponseContent: false,
    });

    expect(stored["requestBody"]).toBeUndefined();
    expect((stored["requestHeaders"] as JSONObject)["authorization"]).toBe(
      REDACTED,
    );
  });

  test("leaves the check it was handed as it was: the evaluator still reads it", () => {
    const check: ProbeMonitorResponse = probeResponse();

    MonitorRecordEvidence.toStoredCheck({
      dataToProcess: check as unknown as DataToProcess,
      keepResponseContent: false,
    });

    expect(check.responseHeaders!["set-cookie"]).toBe("sid=abc");
    expect(check.responseBody).toBeDefined();
  });

  test("is storable: a NUL in it is replaced", () => {
    const check: ProbeMonitorResponse = probeResponse();
    check.responseBody = "a\u0000b";

    const stored: JSONObject = MonitorRecordEvidence.toStoredCheck({
      dataToProcess: check as unknown as DataToProcess,
      keepResponseContent: true,
    });

    expect(String(stored["responseBody"])).not.toContain("\u0000");
  });
});

describe("the monitor summary", () => {
  test("masks credential headers and names the destination as configured", () => {
    const snapshot: MonitorSummarySnapshot =
      MonitorRecordEvidence.redactSnapshot({
        snapshot: snapshotOf({ probeMonitorResponse: probeResponse() }),
        monitor: monitor(),
        monitorStep: stepTo(
          "https://api.acme.example/health?token={{monitorSecrets.Token}}",
        ),
      });

    expect(snapshot.probeMonitorResponse!.responseHeaders).toEqual({
      "content-type": "application/json",
      "set-cookie": REDACTED,
      authorization: REDACTED,
      "x-request-id": "r-1",
    });
    expect(String(snapshot.probeMonitorResponse!.monitorDestination)).toBe(
      `https://api.acme.example/health?token=${REDACTED}`,
    );
    expect(snapshot.probeMonitorResponse!.responseBody).toBeDefined();
    expect(snapshot.isResponseContentOmitted).toBeUndefined();
  });

  test("without a step, the address the probe echoed is redacted", () => {
    const snapshot: MonitorSummarySnapshot =
      MonitorRecordEvidence.redactSnapshot({
        snapshot: snapshotOf({ probeMonitorResponse: probeResponse() }),
        monitor: monitor(),
      });

    expect(String(snapshot.probeMonitorResponse!.monitorDestination)).toBe(
      `https://api.acme.example/health?token=${REDACTED}`,
    );
  });

  test("a host destination stays as it was configured", () => {
    const snapshot: MonitorSummarySnapshot =
      MonitorRecordEvidence.redactSnapshot({
        snapshot: snapshotOf({
          monitorType: MonitorType.Port,
          probeMonitorResponse: {
            ...probeResponse(),
            responseBody: undefined,
            responseHeaders: undefined,
          },
        }),
        monitor: monitor(),
        monitorStep: stepTo(Hostname.fromString("db.acme.example")),
      });

    expect(String(snapshot.probeMonitorResponse!.monitorDestination)).toBe(
      "db.acme.example",
    );
  });

  test("keeps no body for a monitor that keeps no response content, and says why", () => {
    const snapshot: MonitorSummarySnapshot =
      MonitorRecordEvidence.redactSnapshot({
        snapshot: snapshotOf({
          probeMonitorResponse: probeResponse(),
          isResponseBodyTruncated: true,
        }),
        monitor: monitor(false),
      });

    expect(snapshot.probeMonitorResponse!.responseBody).toBeUndefined();
    expect(snapshot.isResponseContentOmitted).toBe(true);
    // It was not cut for size: it was left out.
    expect(snapshot.isResponseBodyTruncated).toBeUndefined();
  });

  test("an incoming request's headers are masked, and its body left out when off", () => {
    const request: IncomingMonitorRequest = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      requestHeaders: {
        authorization: "Bearer xyz",
        "x-hub-signature-256": "sha256=abc",
        "content-type": "application/json",
      },
      requestBody: { alert: "fired" },
      incomingRequestReceivedAt: new Date(),
      checkedAt: new Date(),
    };

    const kept: MonitorSummarySnapshot = MonitorRecordEvidence.redactSnapshot({
      snapshot: snapshotOf({
        monitorType: MonitorType.IncomingRequest,
        incomingMonitorRequest: request,
      }),
      monitor: monitor(),
    });

    expect(kept.incomingMonitorRequest!.requestHeaders).toEqual({
      authorization: REDACTED,
      "x-hub-signature-256": REDACTED,
      "content-type": "application/json",
    });
    expect(kept.incomingMonitorRequest!.requestBody).toEqual({
      alert: "fired",
    });

    const off: MonitorSummarySnapshot = MonitorRecordEvidence.redactSnapshot({
      snapshot: snapshotOf({
        monitorType: MonitorType.IncomingRequest,
        incomingMonitorRequest: request,
      }),
      monitor: monitor(false),
    });

    expect(off.incomingMonitorRequest!.requestBody).toBeUndefined();
    expect(off.isResponseContentOmitted).toBe(true);
  });

  test("the capture it was handed is not changed", () => {
    const response: ProbeMonitorResponse = probeResponse();
    const original: MonitorSummarySnapshot = snapshotOf({
      probeMonitorResponse: response,
    });

    MonitorRecordEvidence.redactSnapshot({
      snapshot: original,
      monitor: monitor(false),
    });

    expect(original.probeMonitorResponse!.responseHeaders!["set-cookie"]).toBe(
      "sid=abc",
    );
    expect(original.probeMonitorResponse!.responseBody).toBeDefined();
    expect(original.isResponseContentOmitted).toBeUndefined();
  });
});

describe("a step's destination and port, as text", () => {
  test("reads URLs, hosts, strings and the envelopes they are stored as", () => {
    expect(
      MonitorRecordEvidence.getStepDestination(
        stepTo(URL.fromString("https://www.acme.example/a")),
      ),
    ).toBe("https://www.acme.example/a");
    expect(
      MonitorRecordEvidence.getStepDestination(
        stepTo(Hostname.fromString("db.acme.example")),
      ),
    ).toBe("db.acme.example");
    expect(MonitorRecordEvidence.toText({ _type: "URL", value: " x " })).toBe(
      "x",
    );
    expect(MonitorRecordEvidence.toText({})).toBe("");
    expect(MonitorRecordEvidence.getStepDestination(undefined)).toBeUndefined();
  });

  test("reads a port", () => {
    const step: MonitorStep = new MonitorStep();
    step.data!.monitorDestinationPort = new Port(5432);

    expect(MonitorRecordEvidence.getStepPort(step)).toBe(5432);
    expect(
      MonitorRecordEvidence.getStepPort(new MonitorStep()),
    ).toBeUndefined();
  });
});
