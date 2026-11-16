import RealtimeMetrics, {
  BeforeWriteDecisionOutcome,
} from "../../../../Server/Utils/Realtime/RealtimeMetrics";
import AppMetrics from "../../../../Server/Utils/Telemetry/AppMetrics";
import {
  TelemetryCounter,
  TelemetryHistogram,
} from "../../../../Server/Utils/Telemetry";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * What a write waits for on account of live updates, measured (#8964): how
 * long each decision of who could read its records took, and how it ended,
 * and how many decisions an update did not need. Each by the table and the
 * kind of write, and nothing else: a measurement never names a record, a
 * project or a person, and never fails the write it measures.
 */

interface Recorded {
  value: number;
  attributes: Record<string, unknown>;
}

function fakeHistogram(): {
  histogram: TelemetryHistogram;
  recorded: Array<Recorded>;
} {
  const recorded: Array<Recorded> = [];

  return {
    recorded: recorded,
    histogram: {
      record: (value: number, attributes?: Record<string, unknown>): void => {
        recorded.push({ value: value, attributes: attributes || {} });
      },
    } as unknown as TelemetryHistogram,
  };
}

function fakeCounter(): { counter: TelemetryCounter; added: Array<Recorded> } {
  const added: Array<Recorded> = [];

  return {
    added: added,
    counter: {
      add: (value: number, attributes?: Record<string, unknown>): void => {
        added.push({ value: value, attributes: attributes || {} });
      },
    } as unknown as TelemetryCounter,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a decision of who could read a write's records", () => {
  test("is recorded with how long it took, by table, kind of write and outcome", () => {
    const { histogram, recorded } = fakeHistogram();
    jest
      .spyOn(AppMetrics, "getRealtimeBeforeWriteDecisionDuration")
      .mockReturnValue(histogram);

    RealtimeMetrics.recordBeforeWriteDecision({
      tableName: "Incident",
      eventType: ModelEventType.Update,
      outcome: BeforeWriteDecisionOutcome.SomeoneCouldRead,
      durationInMs: 12,
    });

    expect(recorded).toEqual([
      {
        value: 12,
        attributes: {
          "oneuptime.realtime.table": "Incident",
          "oneuptime.realtime.event_type": ModelEventType.Update,
          "oneuptime.realtime.outcome": "someone_could_read",
        },
      },
    ]);
  });

  test("a clock that went back is recorded as no wait, never a negative one", () => {
    const { histogram, recorded } = fakeHistogram();
    jest
      .spyOn(AppMetrics, "getRealtimeBeforeWriteDecisionDuration")
      .mockReturnValue(histogram);

    RealtimeMetrics.recordBeforeWriteDecision({
      tableName: "Monitor",
      eventType: ModelEventType.Delete,
      outcome: BeforeWriteDecisionOutcome.NobodyCouldRead,
      durationInMs: -3,
    });

    expect(recorded[0]!.value).toBe(0);
  });

  test("its outcomes are a few fixed words", () => {
    expect(Object.values(BeforeWriteDecisionOutcome).sort()).toEqual(
      ["failed", "nobody_could_read", "someone_could_read", "timed_out"].sort(),
    );
  });

  test("a histogram that cannot be had never fails the write", () => {
    jest
      .spyOn(AppMetrics, "getRealtimeBeforeWriteDecisionDuration")
      .mockImplementation((): never => {
        throw new Error("No meter.");
      });

    expect(() => {
      RealtimeMetrics.recordBeforeWriteDecision({
        tableName: "Incident",
        eventType: ModelEventType.Update,
        outcome: BeforeWriteDecisionOutcome.Failed,
        durationInMs: 1,
      });
    }).not.toThrow();
  });
});

describe("the decisions an update did not need", () => {
  test("are counted, one per project, by table and kind of write", () => {
    const { counter, added } = fakeCounter();
    jest
      .spyOn(AppMetrics, "getRealtimeBeforeWriteDecisionsSkipped")
      .mockReturnValue(counter);

    RealtimeMetrics.recordBeforeWriteDecisionsSkipped({
      tableName: "Monitor",
      eventType: ModelEventType.Update,
      decisions: 2,
    });

    expect(added).toEqual([
      {
        value: 2,
        attributes: {
          "oneuptime.realtime.table": "Monitor",
          "oneuptime.realtime.event_type": ModelEventType.Update,
        },
      },
    ]);
  });

  test("none is no count at all", () => {
    const { counter, added } = fakeCounter();
    jest
      .spyOn(AppMetrics, "getRealtimeBeforeWriteDecisionsSkipped")
      .mockReturnValue(counter);

    RealtimeMetrics.recordBeforeWriteDecisionsSkipped({
      tableName: "Monitor",
      eventType: ModelEventType.Update,
      decisions: 0,
    });

    expect(added).toEqual([]);
  });

  test("a counter that cannot be had never fails the write", () => {
    jest
      .spyOn(AppMetrics, "getRealtimeBeforeWriteDecisionsSkipped")
      .mockImplementation((): never => {
        throw new Error("No meter.");
      });

    expect(() => {
      RealtimeMetrics.recordBeforeWriteDecisionsSkipped({
        tableName: "Monitor",
        eventType: ModelEventType.Update,
        decisions: 1,
      });
    }).not.toThrow();
  });
});
