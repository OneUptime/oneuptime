import ProbeReportIdentity, {
  NamedProbe,
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
  REPORTING_PROBE_NOT_KNOWN_MESSAGE,
} from "../../../../Server/Utils/Probe/ProbeReportIdentity";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * What a probe reports is its own: the probe that sent a result is the one
 * that authenticated, and the id a result names is only ever read against
 * it. Every form a probe id can take on the way in is covered - the
 * ObjectID the server holds, the string a body carries, the
 * { _type: "ObjectID", value } JSON writes for an ObjectID (how a probe puts
 * a result's ids on the wire) - in either case, since Postgres compares
 * uuids whatever their case.
 */

const SENDER: ObjectID = new ObjectID("3b1c1f2e-7a52-4c47-9d2b-4f0c8a1e6b10");
const OTHER: ObjectID = new ObjectID("8d0a4c6e-1f2b-4a3c-9e5d-7b6a5c4d3e21");

function asJson(id: ObjectID): JSONObject {
  return JSON.parse(JSON.stringify(id)) as JSONObject;
}

// A check result as a probe builds it, before it goes on the wire.
function makeResult(probeId?: unknown): ProbeMonitorResponse {
  const result: Record<string, unknown> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    isOnline: true,
    failureCause: "",
    monitoredAt: new Date("2026-10-17T10:00:00.000Z"),
  };

  if (probeId !== undefined) {
    result["probeId"] = probeId;
  }

  return result as unknown as ProbeMonitorResponse;
}

describe("ProbeReportIdentity.readNamedProbe", () => {
  test("names no probe when the value is absent, null or empty", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(ProbeReportIdentity.readNamedProbe(value)).toEqual({
        kind: "none",
      });
    }
  });

  test("reads an ObjectID, a string and an ObjectID as JSON writes it, lower-cased", () => {
    const expected: NamedProbe = {
      kind: "probe",
      probeId: SENDER.toString(),
    };

    expect(ProbeReportIdentity.readNamedProbe(SENDER)).toEqual(expected);
    expect(ProbeReportIdentity.readNamedProbe(SENDER.toString())).toEqual(
      expected,
    );
    expect(ProbeReportIdentity.readNamedProbe(asJson(SENDER))).toEqual(
      expected,
    );
    expect(
      ProbeReportIdentity.readNamedProbe(SENDER.toString().toUpperCase()),
    ).toEqual(expected);
    expect(
      ProbeReportIdentity.readNamedProbe({
        _type: "ObjectID",
        value: `  ${SENDER.toString().toUpperCase()}  `,
      }),
    ).toEqual(expected);
  });

  test("anything else that is there is unreadable, never no probe", () => {
    for (const value of [
      42,
      true,
      [SENDER.toString()],
      { value: SENDER.toString() },
      { _type: "ObjectID" },
      { _type: "ObjectID", value: 42 },
      { _type: "DateTime", value: SENDER.toString() },
    ]) {
      expect(ProbeReportIdentity.readNamedProbe(value)).toEqual({
        kind: "unreadable",
      });
    }
  });
});

describe("ProbeReportIdentity.isResultOf", () => {
  test("a result that names its sender, in any form, is the sender's", () => {
    for (const named of [
      SENDER,
      SENDER.toString(),
      SENDER.toString().toUpperCase(),
      asJson(SENDER),
    ]) {
      expect(ProbeReportIdentity.isResultOf(makeResult(named), SENDER)).toBe(
        true,
      );
    }
  });

  test("a result that names no probe is the sender's", () => {
    expect(ProbeReportIdentity.isResultOf(makeResult(), SENDER)).toBe(true);
    expect(ProbeReportIdentity.isResultOf(makeResult(null), SENDER)).toBe(
      true,
    );
    expect(ProbeReportIdentity.isResultOf(makeResult(""), SENDER)).toBe(true);
  });

  test("a result that names another probe, in any form, is not", () => {
    for (const named of [
      OTHER,
      OTHER.toString(),
      OTHER.toString().toUpperCase(),
      asJson(OTHER),
    ]) {
      expect(ProbeReportIdentity.isResultOf(makeResult(named), SENDER)).toBe(
        false,
      );
    }
  });

  test("a result whose probe cannot be read is not", () => {
    for (const named of [42, [SENDER.toString()], { id: SENDER.toString() }]) {
      expect(ProbeReportIdentity.isResultOf(makeResult(named), SENDER)).toBe(
        false,
      );
    }
  });

  test("the sender is compared whatever case it authenticated in", () => {
    const shouted: ObjectID = new ObjectID(SENDER.toString().toUpperCase());

    expect(
      ProbeReportIdentity.isResultOf(makeResult(SENDER.toString()), shouted),
    ).toBe(true);
    expect(
      ProbeReportIdentity.isResultOf(makeResult(OTHER.toString()), shouted),
    ).toBe(false);
  });

  test("nothing at all names no probe", () => {
    expect(ProbeReportIdentity.isResultOf(undefined, SENDER)).toBe(true);
    expect(ProbeReportIdentity.isResultOf(null, SENDER)).toBe(true);
  });
});

describe("ProbeReportIdentity.bindResultToSender", () => {
  test("writes the sender into a result that names no probe", () => {
    const result: ProbeMonitorResponse = makeResult();

    const bound: ProbeMonitorResponse = ProbeReportIdentity.bindResultToSender(
      result,
      SENDER,
    );

    expect(bound).toBe(result);
    expect(result.probeId).toBeInstanceOf(ObjectID);
    expect(result.probeId.toString()).toBe(SENDER.toString());
  });

  test("keeps a result that names its sender as the sender's, lower-cased", () => {
    const result: ProbeMonitorResponse = makeResult(
      SENDER.toString().toUpperCase(),
    );

    ProbeReportIdentity.bindResultToSender(
      result,
      new ObjectID(SENDER.toString().toUpperCase()),
    );

    expect(result.probeId).toBeInstanceOf(ObjectID);
    expect(result.probeId.toString()).toBe(SENDER.toString());
  });

  test("refuses a result that names another probe, and leaves it as it was", () => {
    const result: ProbeMonitorResponse = makeResult(asJson(OTHER));
    const before: string = JSON.stringify(result);

    expect(() => {
      ProbeReportIdentity.bindResultToSender(result, SENDER);
    }).toThrow(new BadDataException(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE));

    expect(JSON.stringify(result)).toBe(before);
  });

  test("refuses a result whose probe cannot be read", () => {
    expect(() => {
      ProbeReportIdentity.bindResultToSender(makeResult([OTHER]), SENDER);
    }).toThrow(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE);
  });

  test("a result on the wire keeps the wire's form once bound", () => {
    // What the route queues: the probe's JSON, the sender written into it.
    const wire: JSONObject = JSON.parse(
      JSON.stringify(makeResult(asJson(SENDER))),
    ) as JSONObject;

    ProbeReportIdentity.bindResultToSender(wire, SENDER);

    // Queued as JSON, it reads back exactly as the probe wrote it.
    expect(JSON.parse(JSON.stringify(wire))["probeId"]).toEqual(
      asJson(SENDER),
    );

    // ...and the worker deserializes it to the sender's ObjectID.
    const deserialized: ProbeMonitorResponse = JSONFunctions.deserialize(
      JSON.parse(JSON.stringify(wire)) as JSONObject,
    ) as unknown as ProbeMonitorResponse;

    expect(deserialized.probeId).toBeInstanceOf(ObjectID);
    expect(deserialized.probeId.toString()).toBe(SENDER.toString());
  });
});

describe("ProbeReportIdentity.readSender", () => {
  test("reads the probe a queued job was written down for", () => {
    for (const value of [
      SENDER.toString(),
      SENDER.toString().toUpperCase(),
      asJson(SENDER),
      SENDER,
    ]) {
      const sender: ObjectID = ProbeReportIdentity.readSender(value);

      expect(sender).toBeInstanceOf(ObjectID);
      expect(sender.toString()).toBe(SENDER.toString());
    }
  });

  test("a job that does not say who sent it is refused, never guessed", () => {
    for (const value of [
      undefined,
      null,
      "",
      "not-a-uuid",
      "some-probe",
      42,
      { _type: "ObjectID", value: "not-a-uuid" },
      [SENDER.toString()],
    ]) {
      expect(() => {
        ProbeReportIdentity.readSender(value);
      }).toThrow(new BadDataException(REPORTING_PROBE_NOT_KNOWN_MESSAGE));
    }
  });
});

describe("ProbeReportIdentity.normalize", () => {
  test("an id is compared and stored lower-cased, its value unchanged", () => {
    const normalized: ObjectID = ProbeReportIdentity.normalize(
      new ObjectID(` ${SENDER.toString().toUpperCase()} `),
    );

    expect(normalized).toBeInstanceOf(ObjectID);
    expect(normalized.toString()).toBe(SENDER.toString());
  });
});
