import { describe, expect, test } from "@jest/globals";
import {
  getEmptyTelemetryFieldReadersByKind,
  isAnyTelemetryFieldRead,
  isEveryTelemetryFieldReaderChecked,
  readTelemetryFieldReaders,
  SecurityEventsFieldNeed,
  SecurityEventsTelemetrySource,
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldPart,
  TelemetryFieldReaderKind,
  TelemetryFieldReaderList,
  TelemetryFieldReaders,
  TelemetryFieldUse,
} from "../../../Types/Telemetry/TelemetryFieldReaders";

/*
 * WHAT READS A LOG'S OR A SPAN'S FIELDS, AS THE PAGE READS THE SERVER'S
 * ANSWER (#10433).
 *
 * The lookup's answer crosses the wire before Scrub It's dialog, the scrub
 * rule form and a rule's Enable draw it (readTelemetryFieldReaders). Read
 * defensively: a kind the answer does not say was checked is drawn as
 * unchecked - never as "nothing reads it" - a reader with no id it could be
 * opened by is left out, and words the page does not know are dropped.
 */

const MONITOR_ID: string = "7c7c7c7c-0000-4000-8000-0000000000c3";

describe("reading the lookup's answer", () => {
  test("a whole answer reads back as it was sent", () => {
    const sent: TelemetryFieldReaders = {
      kinds: getEmptyTelemetryFieldReadersByKind(true),
      securityEvents: {
        isChecked: true,
        sources: [SecurityEventsTelemetrySource.Logs],
        loses: [SecurityEventsFieldNeed.ClientAddresses],
      },
    };

    sent.kinds[TelemetryFieldReaderKind.Dashboard] = {
      readers: [
        {
          id: MONITOR_ID,
          name: "Support",
          widgets: [{ id: "w1", title: "Sign-ups", type: "LogChart" }],
          reads: [
            {
              part: TelemetryFieldPart.Attributes,
              key: "user.email",
              use: TelemetryFieldUse.GroupBy,
            },
          ],
        },
      ],
      hiddenCount: 2,
      isChecked: true,
    };
    sent.kinds[TelemetryFieldReaderKind.SavedView] = {
      readers: [
        {
          id: MONITOR_ID,
          name: "Emails",
          list: TelemetryFieldReaderList.Logs,
          reads: [
            { part: TelemetryFieldPart.Body, use: TelemetryFieldUse.Search },
          ],
        },
      ],
      hiddenCount: 0,
      isChecked: true,
    };

    expect(readTelemetryFieldReaders(JSON.parse(JSON.stringify(sent)))).toEqual(
      sent,
    );
  });

  test.each([undefined, null, "nonsense", 42, [], {}])(
    "an answer it cannot read (%p) is every kind unchecked, never nothing read",
    (answer: unknown) => {
      const read: TelemetryFieldReaders = readTelemetryFieldReaders(answer);

      for (const kind of TELEMETRY_FIELD_READER_KINDS) {
        expect(read.kinds[kind]).toEqual({
          readers: [],
          hiddenCount: 0,
          isChecked: false,
        });
      }

      expect(read.securityEvents).toEqual({
        isChecked: false,
        sources: [],
        loses: [],
      });
      expect(isEveryTelemetryFieldReaderChecked(read)).toBe(false);
      expect(isAnyTelemetryFieldRead(read)).toBe(false);
    },
  );

  test("a reader with no id to open it by, or no name, is left out; words it does not know are dropped", () => {
    const read: TelemetryFieldReaders = readTelemetryFieldReaders({
      kinds: {
        Monitor: {
          isChecked: true,
          hiddenCount: -3,
          readers: [
            { id: "not-an-id", name: "Bad id", reads: [] },
            { id: MONITOR_ID, reads: [] },
            {
              id: MONITOR_ID,
              name: "Sign-ups",
              list: "somewhere",
              reads: [
                { part: "attributes", key: "user.email", use: "filter" },
                { part: "headers", key: "x", use: "filter" },
                { part: "body", use: "explode" },
                { part: "body", key: "", use: "search" },
              ],
            },
          ],
        },
      },
      securityEvents: {
        isChecked: true,
        sources: ["logs", "metrics"],
        loses: ["userNames", "passwords"],
      },
    });

    expect(read.kinds[TelemetryFieldReaderKind.Monitor]).toEqual({
      readers: [
        {
          id: MONITOR_ID,
          name: "Sign-ups",
          reads: [
            {
              part: TelemetryFieldPart.Attributes,
              key: "user.email",
              use: TelemetryFieldUse.Filter,
            },
            { part: TelemetryFieldPart.Body, use: TelemetryFieldUse.Search },
          ],
        },
      ],
      hiddenCount: 0,
      isChecked: true,
    });
    // The kinds it does not mention were not checked.
    expect(read.kinds[TelemetryFieldReaderKind.Dashboard].isChecked).toBe(
      false,
    );
    expect(read.securityEvents).toEqual({
      isChecked: true,
      sources: [SecurityEventsTelemetrySource.Logs],
      loses: [SecurityEventsFieldNeed.UserNames],
    });
    expect(isAnyTelemetryFieldRead(read)).toBe(true);
  });

  test("a count of readers the person cannot see is read only as a whole number above nothing", () => {
    for (const [hiddenCount, expected] of [
      [3, 3],
      [0, 0],
      [-1, 0],
      [1.5, 0],
      ["3", 0],
    ] as Array<[unknown, number]>) {
      expect(
        readTelemetryFieldReaders({
          kinds: { SLO: {}, ServiceLevelObjective: { hiddenCount } },
        }).kinds[TelemetryFieldReaderKind.ServiceLevelObjective].hiddenCount,
      ).toBe(expected);
    }
  });
});
