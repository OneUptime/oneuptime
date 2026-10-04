import {
  ALERT_EVENT_MEASUREMENTS,
  EVENT_MEASUREMENT_SETTLE_DELAYS_IN_MS,
  EVENT_MEASUREMENT_SOURCES,
  EVENT_MEASUREMENT_TICK_INTERVAL_IN_MS,
  EventMeasurementDisplay,
  EventMeasurementListRequest,
  EventMeasurementReading,
  EventMeasurementSource,
  EventMeasurementState,
  EventMeasurementTone,
  INCIDENT_EVENT_MEASUREMENTS,
  MEASUREMENT_UNIT_PLURALS,
  SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
  formatEventMeasurementDuration,
  getEventMeasurementDefinitionsRequest,
  getEventMeasurementDisplay,
  getEventMeasurementReadings,
  getEventMeasurementRefreshKey,
  getEventMeasurementSettleDelay,
  getEventMeasurementValuesRequest,
  getLatestEventMeasurementComputedAt,
  haveEventMeasurementsCaughtUp,
  roundMeasurementAmount,
  shouldEventMeasurementsTick,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/EventMeasurements";
import {
  MEASUREMENT_PAGE_COPY,
  MEASUREMENT_VALUE_COPY,
  MeasurementValues,
  getMeasurementSetupText,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup";
import { getMeasurementsHelpMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementHelp";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import AlertMeasurementValue from "../../../Models/DatabaseModels/AlertMeasurementValue";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import IncidentMeasurementValue from "../../../Models/DatabaseModels/IncidentMeasurementValue";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementValue from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import MeasurementStatus from "../../../Types/Measurement/MeasurementStatus";
import MeasurementUnit from "../../../Types/Measurement/MeasurementUnit";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { MeasurementDomain } from "../../../Utils/Measurement/MeasurementMoments";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What an incident's, an alert's or a maintenance event's page shows of its
 * own measurements (Utils/Measurement/EventMeasurements): what the card asks
 * the API for, how a stored value reads - a number in the measurement's own
 * unit, or one state in plain words - and how a duration is written. The
 * card itself is drawn in EventMeasurementsCard.test.tsx.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

type ReadLocaleFunction = (code: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  code: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  );
};

type TranslatorForFunction = (code: string) => Translator;

const translatorFor: TranslatorForFunction = (code: string): Translator => {
  const strings: Record<string, string> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    return strings[text];
  }, code);
};

const ENGLISH: Translator = translatorFor("en");

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");

const MINUTE_IN_MS: number = 60 * 1000;

type MinutesAgoFunction = (minutes: number) => Date;

const minutesAgo: MinutesAgoFunction = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * MINUTE_IN_MS);
};

const MEASUREMENT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_MEASUREMENT_ID: string = "22222222-2222-4222-8222-222222222222";

interface SourceCase {
  label: string;
  source: EventMeasurementSource;
  measurementModel: { new (): BaseModel };
  valueModel: { new (): BaseModel };
  showOnViewColumn: string;
  eventIdColumn: string;
  measurementIdColumn: string;
  // The domain's own viewer role, which may read the event's page.
  viewer: Permission;
}

const SOURCES: Array<SourceCase> = [
  {
    label: "incident",
    source: INCIDENT_EVENT_MEASUREMENTS,
    measurementModel: IncidentMeasurement,
    valueModel: IncidentMeasurementValue,
    showOnViewColumn: "showOnIncidentView",
    eventIdColumn: "incidentId",
    measurementIdColumn: "incidentMeasurementId",
    viewer: Permission.IncidentViewer,
  },
  {
    label: "alert",
    source: ALERT_EVENT_MEASUREMENTS,
    measurementModel: AlertMeasurement,
    valueModel: AlertMeasurementValue,
    showOnViewColumn: "showOnAlertView",
    eventIdColumn: "alertId",
    measurementIdColumn: "alertMeasurementId",
    viewer: Permission.AlertViewer,
  },
  {
    label: "scheduled maintenance",
    source: SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
    measurementModel: ScheduledMaintenanceMeasurement,
    valueModel: ScheduledMaintenanceMeasurementValue,
    showOnViewColumn: "showOnScheduledMaintenanceView",
    eventIdColumn: "scheduledMaintenanceId",
    measurementIdColumn: "scheduledMaintenanceMeasurementId",
    viewer: Permission.ScheduledMaintenanceViewer,
  },
];

// The top-level columns a select names (a relation's own select aside).
type SelectedColumnsFunction = (
  select: Record<string, unknown>,
) => Array<string>;

const selectedColumns: SelectedColumnsFunction = (
  select: Record<string, unknown>,
): Array<string> => {
  return Object.keys(select);
};

describe.each(SOURCES)(
  "the $label measurements an event's page reads",
  (entry: SourceCase) => {
    test("come from the domain's own definitions and values", () => {
      expect(entry.source.measurementModel).toBe(entry.measurementModel);
      expect(entry.source.valueModel).toBe(entry.valueModel);
      expect(entry.source.showOnViewColumn).toBe(entry.showOnViewColumn);
      expect(entry.source.eventIdColumn).toBe(entry.eventIdColumn);
      expect(entry.source.measurementIdColumn).toBe(entry.measurementIdColumn);
      expect(EVENT_MEASUREMENT_SOURCES[entry.source.domain]).toBe(entry.source);
    });

    test("the switch is a real column, on by default as the server has it", () => {
      const model: BaseModel = new entry.measurementModel();
      const column: { type?: TableColumnType; defaultValue?: unknown } =
        model.getTableColumnMetadata(entry.showOnViewColumn) as {
          type?: TableColumnType;
          defaultValue?: unknown;
        };

      expect(column).toBeTruthy();
      expect(column.type).toBe(TableColumnType.Boolean);
      expect(column.defaultValue).toBe(true);
    });

    test("asks only for the enabled measurements shown on event pages, in their order", () => {
      const request: EventMeasurementListRequest =
        getEventMeasurementDefinitionsRequest(entry.source);

      expect(request.query).toEqual({
        isEnabled: true,
        [entry.showOnViewColumn]: true,
      });
      expect(request.sort).toEqual({ order: SortOrder.Ascending });
      expect(request.select).toEqual(
        expect.objectContaining({
          _id: true,
          name: true,
          unit: true,
          backfillRequestedAt: true,
          [entry.source.form.start.anchorType]: true,
          [entry.source.form.end.anchorType]: true,
          [entry.source.form.start.stateRole]: true,
          [entry.source.form.end.stateRole]: true,
          [entry.source.form.start.occurrence]: true,
          [entry.source.form.end.occurrence]: true,
          // A picked state reads as its name: "Mitigated".
          [entry.source.form.start.state]: { name: true },
          [entry.source.form.end.state]: { name: true },
        }),
      );
    });

    test("asks for this event's values only", () => {
      const eventId: ObjectID = new ObjectID(
        "33333333-3333-4333-8333-333333333333",
      );
      const request: EventMeasurementListRequest =
        getEventMeasurementValuesRequest({
          source: entry.source,
          eventId: eventId,
        });

      expect(request.query).toEqual({ [entry.eventIdColumn]: eventId });
      expect(request.select).toEqual({
        _id: true,
        [entry.measurementIdColumn]: true,
        status: true,
        statusMessage: true,
        startedAt: true,
        endedAt: true,
        valueInSeconds: true,
        computedAt: true,
      });
    });

    /*
     * One column the reader may not read fails the whole request, and the
     * card then draws nothing: every column asked for must exist and be
     * readable by whoever may read the event's page.
     */
    test.each([
      ["definitions", "measurementModel"],
      ["values", "valueModel"],
    ])(
      "every %s column it selects exists and a viewer may read it",
      (_label: string, modelKey: string) => {
        const model: BaseModel =
          modelKey === "measurementModel"
            ? new entry.measurementModel()
            : new entry.valueModel();
        const request: EventMeasurementListRequest =
          modelKey === "measurementModel"
            ? getEventMeasurementDefinitionsRequest(entry.source)
            : getEventMeasurementValuesRequest({
                source: entry.source,
                eventId: ObjectID.generate(),
              });

        for (const column of selectedColumns(request.select)) {
          if (column === "_id") {
            continue;
          }

          expect({ column, exists: model.hasColumn(column) }).toEqual({
            column,
            exists: true,
          });

          const access: ColumnAccessControl | null =
            model.getColumnAccessControlFor(column);

          for (const permission of [Permission.Viewer, entry.viewer]) {
            expect({
              column,
              permission,
              readable: Boolean(access?.read.includes(permission)),
            }).toEqual({ column, permission, readable: true });
          }
        }

        // The table itself, too.
        for (const permission of [Permission.Viewer, entry.viewer]) {
          expect(model.getReadPermissions()).toContain(permission);
        }

        for (const column of Object.keys(request.query)) {
          expect({ column, exists: model.hasColumn(column) }).toEqual({
            column,
            exists: true,
          });
        }
      },
    );
  },
);

/*
 * A measurement as the API hands it back, for an incident: Declared →
 * Acknowledged unless a test says otherwise.
 */
type MeasurementFunction = (
  overrides?: Record<string, unknown>,
) => MeasurementValues;

const incidentMeasurement: MeasurementFunction = (
  overrides?: Record<string, unknown>,
): MeasurementValues => {
  return {
    _id: MEASUREMENT_ID,
    name: "Time to acknowledge",
    unit: "seconds",
    startAnchorType: "Declared At",
    endAnchorType: "State Role Entered",
    endIncidentStateRole: "Acknowledged",
    ...(overrides || {}),
  };
};

type ValueFunction = (overrides?: Record<string, unknown>) => MeasurementValues;

const incidentValue: ValueFunction = (
  overrides?: Record<string, unknown>,
): MeasurementValues => {
  return {
    incidentMeasurementId: new ObjectID(MEASUREMENT_ID),
    status: MeasurementStatus.Recorded,
    startedAt: minutesAgo(19),
    endedAt: minutesAgo(16),
    valueInSeconds: 180,
    computedAt: minutesAgo(16),
    ...(overrides || {}),
  };
};

type ReadOneFunction = (data: {
  measurement?: MeasurementValues;
  value?: MeasurementValues | null;
  isEventOver?: boolean;
  now?: Date;
}) => EventMeasurementReading;

const readOne: ReadOneFunction = (data: {
  measurement?: MeasurementValues;
  value?: MeasurementValues | null;
  isEventOver?: boolean;
  now?: Date;
}): EventMeasurementReading => {
  const readings: Array<EventMeasurementReading> = getEventMeasurementReadings({
    source: INCIDENT_EVENT_MEASUREMENTS,
    measurements: [data.measurement || incidentMeasurement()],
    values: data.value === null ? [] : [data.value || incidentValue()],
    isEventOver: Boolean(data.isEventOver),
    now: data.now || NOW,
  });

  expect(readings).toHaveLength(1);

  return readings[0]!;
};

describe("how a stored value reads", () => {
  test("Recorded is the duration, in the measurement's own unit", () => {
    const reading: EventMeasurementReading = readOne({
      measurement: incidentMeasurement({ unit: "Hours" }),
    });

    expect(reading.state).toBe(EventMeasurementState.Recorded);
    expect(reading.valueInSeconds).toBe(180);
    // A unit typed by hand reads as the unit it spells.
    expect(reading.unit).toBe(MeasurementUnit.Hours);
    expect(reading.name).toBe("Time to acknowledge");
    expect(reading.measurementId).toBe(MEASUREMENT_ID);
  });

  test("a unit nobody can read as one is seconds, the number the value is", () => {
    expect(
      readOne({ measurement: incidentMeasurement({ unit: "fortnights" }) })
        .unit,
    ).toBe(MeasurementUnit.Seconds);
    expect(
      readOne({ measurement: incidentMeasurement({ unit: undefined }) }).unit,
    ).toBe(MeasurementUnit.Seconds);
  });

  test("Recorded with no number is not shown as a zero", () => {
    expect(
      readOne({ value: incidentValue({ valueInSeconds: null }) }).state,
    ).toBe(EventMeasurementState.NotWorkedOut);
  });

  test("Not Applicable is not measured, with the server's reason", () => {
    const reading: EventMeasurementReading = readOne({
      value: incidentValue({
        status: MeasurementStatus.NotApplicable,
        valueInSeconds: null,
        endedAt: null,
        statusMessage: "Mitigated was skipped",
      }),
    });

    expect(reading.state).toBe(EventMeasurementState.NotMeasured);
    expect(reading.reason).toBe("Mitigated was skipped");
    expect(reading.valueInSeconds).toBeUndefined();
  });

  test("Invalid ends before it starts, with the server's reason", () => {
    const reading: EventMeasurementReading = readOne({
      value: incidentValue({
        status: MeasurementStatus.Invalid,
        valueInSeconds: null,
        statusMessage: "The acknowledged state precedes Declared At by 17m",
      }),
    });

    expect(reading.state).toBe(EventMeasurementState.EndsBeforeStart);
    expect(reading.reason).toBe(
      "The acknowledged state precedes Declared At by 17m",
    );
  });

  test("no value yet is not worked out yet", () => {
    expect(readOne({ value: null }).state).toBe(
      EventMeasurementState.NotWorkedOut,
    );
  });

  test("a value of another measurement is not this one's", () => {
    expect(
      readOne({
        value: incidentValue({
          incidentMeasurementId: new ObjectID(OTHER_MEASUREMENT_ID),
        }),
      }).state,
    ).toBe(EventMeasurementState.NotWorkedOut);
  });

  /*
   * The server marks a measurement for working out again when its start,
   * end, unit or Enabled switch changes, and cannot tell those apart. The
   * unit and the switch leave every stored duration right, so a value is
   * shown until the server has worked it out again, as its chart is.
   */
  test("a value worked out before the measurement last changed is still shown", () => {
    const reading: EventMeasurementReading = readOne({
      measurement: incidentMeasurement({
        unit: "hours",
        backfillRequestedAt: minutesAgo(5),
      }),
      value: incidentValue({ computedAt: minutesAgo(16) }),
    });

    expect(reading.state).toBe(EventMeasurementState.Recorded);
    expect(reading.valueInSeconds).toBe(180);
    expect(reading.unit).toBe(MeasurementUnit.Hours);
  });

  describe("Pending", () => {
    const pending: ValueFunction = (
      overrides?: Record<string, unknown>,
    ): MeasurementValues => {
      return incidentValue({
        status: MeasurementStatus.Pending,
        endedAt: null,
        valueInSeconds: null,
        statusMessage: "The acknowledged state has not been reached yet",
        ...(overrides || {}),
      });
    };

    test("a clock that has started is running, from when it started", () => {
      const reading: EventMeasurementReading = readOne({ value: pending() });

      expect(reading.state).toBe(EventMeasurementState.Running);
      expect(reading.startedAt?.getTime()).toBe(minutesAgo(19).getTime());
      // A running clock needs no reason: it says how long so far.
      expect(reading.reason).toBeUndefined();
    });

    test("a clock that starts at a planned time still ahead has not started yet, and starts when it comes", () => {
      const scheduledStart: Date = new Date(NOW.getTime() + 2 * 60 * 60000);

      type ReadMaintenanceFunction = (now: Date) => EventMeasurementReading;

      const readMaintenance: ReadMaintenanceFunction = (
        now: Date,
      ): EventMeasurementReading => {
        return getEventMeasurementReadings({
          source: SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
          measurements: [
            {
              _id: MEASUREMENT_ID,
              name: "Start delay",
              startAnchorType: "Scheduled Starts At",
              endAnchorType: "State Role Entered",
              endScheduledMaintenanceStateRole: "Ongoing",
            },
          ],
          values: [
            {
              scheduledMaintenanceMeasurementId: MEASUREMENT_ID,
              status: MeasurementStatus.Pending,
              startedAt: scheduledStart,
            },
          ],
          isEventOver: false,
          now: now,
        })[0]!;
      };

      const before: EventMeasurementReading = readMaintenance(NOW);

      expect(before.state).toBe(EventMeasurementState.NotStarted);
      expect(before.startedAt?.getTime()).toBe(scheduledStart.getTime());
      expect(shouldEventMeasurementsTick([before])).toBe(true);

      expect(
        readMaintenance(new Date(scheduledStart.getTime() + MINUTE_IN_MS))
          .state,
      ).toBe(EventMeasurementState.Running);
    });

    /*
     * Only a planned time can lie ahead. A start the server recorded has
     * happened, even when the reader's clock is behind the server's.
     */
    test("a recorded start is running even when the reader's clock is behind", () => {
      const reading: EventMeasurementReading = readOne({
        value: pending({ startedAt: new Date(NOW.getTime() + 90 * 1000) }),
      });

      expect(reading.state).toBe(EventMeasurementState.Running);
      expect(
        getEventMeasurementDisplay({
          reading: reading,
          translator: ENGLISH,
          now: NOW,
        }).text,
      ).toBe("Running for less than a minute");
    });

    test("a clock whose start has not happened has not started yet", () => {
      const reading: EventMeasurementReading = readOne({
        measurement: incidentMeasurement({
          name: "Time to postmortem",
          startAnchorType: "State Role Entered",
          startIncidentStateRole: "Resolved",
          endAnchorType: "Postmortem Posted At",
          endIncidentStateRole: null,
        }),
        value: pending({
          startedAt: null,
          statusMessage: "The resolved state has not been reached yet",
        }),
      });

      expect(reading.state).toBe(EventMeasurementState.NotStarted);
      // The summary says where it starts; no reason is needed.
      expect(reading.reason).toBeUndefined();
      expect(shouldEventMeasurementsTick([reading])).toBe(false);
    });

    test("an end that has happened with a start never recorded says why", () => {
      const reading: EventMeasurementReading = readOne({
        measurement: incidentMeasurement({
          name: "Time to detect",
          startAnchorType: "Impact Started At",
          endAnchorType: "Declared At",
          endIncidentStateRole: null,
        }),
        value: pending({
          startedAt: null,
          endedAt: minutesAgo(19),
          statusMessage: "Impact Started At has not been recorded yet",
        }),
      });

      expect(reading.state).toBe(EventMeasurementState.NotStarted);
      expect(reading.reason).toBe(
        "Impact Started At has not been recorded yet",
      );
    });

    /*
     * The server leaves an unreached state Pending forever: a resolved
     * incident can be reopened. On the page of an event that is over it is
     * not a clock running since the incident was declared.
     */
    test("an event that is over never reached a state it waited for", () => {
      const reading: EventMeasurementReading = readOne({
        value: pending(),
        isEventOver: true,
      });

      expect(reading.state).toBe(EventMeasurementState.NotReached);
      expect(shouldEventMeasurementsTick([reading])).toBe(false);
    });

    test("nor a state you pick", () => {
      expect(
        readOne({
          measurement: incidentMeasurement({
            name: "Time to mitigate",
            endAnchorType: "State Entered",
            endIncidentStateRole: null,
            endIncidentState: { name: "Mitigated" },
          }),
          value: pending(),
          isEventOver: true,
        }).state,
      ).toBe(EventMeasurementState.NotReached);
    });

    test("nor a start state, when neither end came", () => {
      expect(
        readOne({
          measurement: incidentMeasurement({
            name: "Acknowledged to resolved",
            startAnchorType: "State Role Entered",
            startIncidentStateRole: "Acknowledged",
            endAnchorType: "State Role Entered",
            endIncidentStateRole: "Resolved",
          }),
          value: pending({ startedAt: null }),
          isEventOver: true,
        }).state,
      ).toBe(EventMeasurementState.NotReached);
    });

    test("but a moment that comes after the end still can: the postmortem clock runs on", () => {
      const reading: EventMeasurementReading = readOne({
        measurement: incidentMeasurement({
          name: "Time to postmortem",
          startAnchorType: "State Role Entered",
          startIncidentStateRole: "Resolved",
          endAnchorType: "Postmortem Posted At",
          endIncidentStateRole: null,
        }),
        value: pending({ startedAt: minutesAgo(8) }),
        isEventOver: true,
      });

      expect(reading.state).toBe(EventMeasurementState.Running);
      expect(reading.startedAt?.getTime()).toBe(minutesAgo(8).getTime());
    });

    test("and an impact start recorded later can still start one", () => {
      expect(
        readOne({
          measurement: incidentMeasurement({
            name: "Time to detect",
            startAnchorType: "Impact Started At",
            endAnchorType: "Declared At",
            endIncidentStateRole: null,
          }),
          value: pending({ startedAt: null, endedAt: minutesAgo(19) }),
          isEventOver: true,
        }).state,
      ).toBe(EventMeasurementState.NotStarted);
    });

    test("an open event's unreached state is still running", () => {
      expect(readOne({ value: pending(), isEventOver: false }).state).toBe(
        EventMeasurementState.Running,
      );
    });
  });

  test("keeps the order the measurements came in, and skips one with no id", () => {
    const readings: Array<EventMeasurementReading> =
      getEventMeasurementReadings({
        source: INCIDENT_EVENT_MEASUREMENTS,
        measurements: [
          incidentMeasurement({ _id: OTHER_MEASUREMENT_ID, name: "Second" }),
          incidentMeasurement({ _id: undefined, name: "No id" }),
          incidentMeasurement({ name: "First" }),
        ],
        values: [
          incidentValue(),
          incidentValue({
            incidentMeasurementId: new ObjectID(OTHER_MEASUREMENT_ID),
            status: MeasurementStatus.NotApplicable,
          }),
        ],
        isEventOver: false,
        now: NOW,
      });

    expect(
      readings.map((reading: EventMeasurementReading): string => {
        return `${reading.name}: ${reading.state}`;
      }),
    ).toEqual([
      `Second: ${EventMeasurementState.NotMeasured}`,
      `First: ${EventMeasurementState.Recorded}`,
    ]);
  });

  test("reads an alert's and a maintenance event's values by their own columns", () => {
    for (const source of [
      ALERT_EVENT_MEASUREMENTS,
      SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
    ]) {
      const readings: Array<EventMeasurementReading> =
        getEventMeasurementReadings({
          source: source,
          measurements: [{ _id: MEASUREMENT_ID, name: "Start delay" }],
          values: [
            {
              [source.measurementIdColumn]: MEASUREMENT_ID,
              status: MeasurementStatus.Recorded,
              valueInSeconds: 600,
            },
          ],
          isEventOver: false,
          now: NOW,
        });

      expect(readings[0]!.state).toBe(EventMeasurementState.Recorded);
      expect(readings[0]!.valueInSeconds).toBe(600);
    }
  });
});

describe("how a duration is written", () => {
  type FormatFunction = (
    seconds: number,
    unit?: MeasurementUnit,
    isRunning?: boolean,
  ) => string;

  const format: FormatFunction = (
    seconds: number,
    unit: MeasurementUnit = MeasurementUnit.Seconds,
    isRunning: boolean = false,
  ): string => {
    return formatEventMeasurementDuration({
      seconds,
      unit,
      translator: ENGLISH,
      isRunning,
    });
  };

  test.each([
    [0, "0 seconds"],
    [1, "1 second"],
    [45, "45 seconds"],
    [60, "1 minute"],
    [119, "1 minute"],
    [252, "4 minutes"],
    [3600, "1 hour"],
    [3900, "1 hour, 5 minutes"],
    [90000, "1 day, 1 hour"],
    [2 * 86400 + 3 * 3600 + 4 * 60, "2 days, 3 hours, 4 minutes"],
  ])(
    "Automatic reads like the page's other timings: %d seconds is %s",
    (seconds: number, text: string) => {
      expect(format(seconds)).toBe(text);
    },
  );

  test("a running clock under a minute is less than a minute: it moves every 30 seconds", () => {
    expect(format(45, MeasurementUnit.Seconds, true)).toBe(
      "less than a minute",
    );
    expect(format(600, MeasurementUnit.Seconds, true)).toBe("10 minutes");
  });

  test.each([
    [252, MeasurementUnit.Minutes, "4.2 minutes"],
    [60, MeasurementUnit.Minutes, "1 minute"],
    [5400, MeasurementUnit.Hours, "1.5 hours"],
    [3600, MeasurementUnit.Hours, "1 hour"],
    [600, MeasurementUnit.Hours, "0.2 hours"],
    [2 * 86400, MeasurementUnit.Days, "2 days"],
    [30, MeasurementUnit.Days, "0.00035 days"],
    [0, MeasurementUnit.Hours, "0 hours"],
  ])(
    "a pinned unit reads in that unit: %d seconds in %s is %s",
    (seconds: number, unit: MeasurementUnit, text: string) => {
      expect(format(seconds, unit)).toBe(text);
    },
  );

  test("nothing negative or not a number is written", () => {
    expect(format(-30)).toBe("0 seconds");
    expect(format(Number.NaN)).toBe("0 seconds");
    expect(format(Number.POSITIVE_INFINITY, MeasurementUnit.Hours)).toBe(
      "0 hours",
    );
  });

  test("rounds a pinned amount to one decimal, or two significant figures when that is all there is", () => {
    expect(roundMeasurementAmount(4.2)).toBe(4.2);
    expect(roundMeasurementAmount(4.26)).toBe(4.3);
    expect(roundMeasurementAmount(0.05)).toBe(0.1);
    expect(roundMeasurementAmount(0.0347)).toBe(0.035);
    expect(roundMeasurementAmount(0)).toBe(0);
    expect(roundMeasurementAmount(-1)).toBe(0);
  });

  test("in the reader's language, the parts joined the way the language does", () => {
    const german: Translator = translatorFor("de");

    expect(
      formatEventMeasurementDuration({
        seconds: 3900,
        unit: MeasurementUnit.Seconds,
        translator: german,
      }),
    ).toBe("1 Stunde, 5 Minuten");
    expect(
      formatEventMeasurementDuration({
        seconds: 5400,
        unit: MeasurementUnit.Hours,
        translator: german,
      }),
    ).toBe("1,5 Stunden");
    expect(
      formatEventMeasurementDuration({
        seconds: 30,
        unit: MeasurementUnit.Seconds,
        translator: german,
        isRunning: true,
      }),
    ).toBe("weniger als eine Minute");
  });

  test("uses the Dashboard's shared duration keys, both forms in English", () => {
    const english: Record<string, string> = readLocale("en");

    for (const template of Object.values(MEASUREMENT_UNIT_PLURALS)) {
      expect(english[template.other]).toBe(template.other);
      expect(english[`${template.other}_one`]).toBe(template.one);
    }
  });
});

describe("what a row says", () => {
  type DisplayFunction = (
    reading: Partial<EventMeasurementReading>,
    translator?: Translator,
  ) => EventMeasurementDisplay;

  const display: DisplayFunction = (
    reading: Partial<EventMeasurementReading>,
    translator: Translator = ENGLISH,
  ): EventMeasurementDisplay => {
    return getEventMeasurementDisplay({
      reading: {
        measurementId: MEASUREMENT_ID,
        name: "Time to mitigate",
        measurement: incidentMeasurement(),
        unit: MeasurementUnit.Seconds,
        state: EventMeasurementState.NotWorkedOut,
        ...reading,
      },
      translator: translator,
      now: NOW,
    });
  };

  test("a number stands out", () => {
    expect(
      display({
        state: EventMeasurementState.Recorded,
        valueInSeconds: 3900,
      }),
    ).toEqual({
      text: "1 hour, 5 minutes",
      tone: EventMeasurementTone.Value,
    });
  });

  test("a running clock says how long so far, in its unit", () => {
    expect(
      display({
        state: EventMeasurementState.Running,
        startedAt: minutesAgo(12),
      }),
    ).toEqual({
      text: "Running for 12 minutes",
      tone: EventMeasurementTone.Value,
    });
    expect(
      display({
        state: EventMeasurementState.Running,
        startedAt: minutesAgo(90),
        unit: MeasurementUnit.Hours,
      }).text,
    ).toBe("Running for 1.5 hours");
    expect(
      display({
        state: EventMeasurementState.Running,
        startedAt: new Date(NOW.getTime() - 20 * 1000),
      }).text,
    ).toBe("Running for less than a minute");
  });

  test.each([
    [
      EventMeasurementState.NotStarted,
      "Not started yet",
      EventMeasurementTone.State,
    ],
    [
      EventMeasurementState.NotReached,
      "Not reached",
      EventMeasurementTone.State,
    ],
    [
      EventMeasurementState.NotMeasured,
      "Not measured",
      EventMeasurementTone.State,
    ],
    [
      EventMeasurementState.EndsBeforeStart,
      "Ends before it starts",
      EventMeasurementTone.Warning,
    ],
  ])(
    "%s says %s",
    (
      state: EventMeasurementState,
      text: string,
      tone: EventMeasurementTone,
    ) => {
      expect(
        display({ state: state, reason: "Why, in the server's words" }),
      ).toEqual(
        state === EventMeasurementState.NotReached
          ? { text, tone }
          : { text, tone, reason: "Why, in the server's words" },
      );
    },
  );

  test("not worked out yet says where it comes from", () => {
    expect(display({ state: EventMeasurementState.NotWorkedOut })).toEqual({
      text: "Not worked out yet",
      tone: EventMeasurementTone.State,
      reason: "OneUptime works it out in the background.",
    });
  });

  test("in the reader's language", () => {
    const german: Translator = translatorFor("de");

    expect(
      display(
        { state: EventMeasurementState.Running, startedAt: minutesAgo(12) },
        german,
      ).text,
    ).toBe("Läuft bereits 12 Minuten");
    expect(
      display({ state: EventMeasurementState.NotReached }, german).text,
    ).toBe("Nicht erreicht");
  });
});

describe("the page's clock", () => {
  test("moves while a measurement is running, every 30 seconds like the page's other live durations", () => {
    const reading: EventMeasurementReading = readOne({
      value: incidentValue({
        status: MeasurementStatus.Pending,
        endedAt: null,
        valueInSeconds: null,
      }),
    });

    expect(shouldEventMeasurementsTick([reading])).toBe(true);
    expect(shouldEventMeasurementsTick([readOne({})])).toBe(false);
    expect(shouldEventMeasurementsTick([])).toBe(false);
    expect(EVENT_MEASUREMENT_TICK_INTERVAL_IN_MS).toBe(30 * 1000);
  });

  test("reads again when what the values are worked out from changes, and only then", () => {
    const created: { _id: string; startsAt: Date } = {
      _id: "a1",
      startsAt: minutesAgo(19),
    };
    const acknowledged: { _id: string; startsAt: Date } = {
      _id: "a2",
      startsAt: minutesAgo(16),
    };
    const declaredAt: Date = minutesAgo(19);

    const key: string = getEventMeasurementRefreshKey({
      timeline: [created, acknowledged],
      times: [declaredAt],
    });

    // The same timeline and times, read again into new objects: the same key.
    expect(
      getEventMeasurementRefreshKey({
        timeline: [
          { ...created, startsAt: new Date(created.startsAt.getTime()) },
          { ...acknowledged },
        ],
        times: [new Date(declaredAt.getTime())],
      }),
    ).toBe(key);
    // A state change adds an entry.
    expect(
      getEventMeasurementRefreshKey({
        timeline: [created, acknowledged, { _id: "a3", startsAt: NOW }],
        times: [declaredAt],
      }),
    ).not.toBe(key);
    // An entry's time corrected moves the values too.
    expect(
      getEventMeasurementRefreshKey({
        timeline: [created, { ...acknowledged, startsAt: minutesAgo(17) }],
        times: [declaredAt],
      }),
    ).not.toBe(key);
    // So does the event's own time: declared earlier.
    expect(
      getEventMeasurementRefreshKey({
        timeline: [created, acknowledged],
        times: [minutesAgo(25)],
      }),
    ).not.toBe(key);
    // Entries without ids still tell themselves apart by time.
    expect(
      getEventMeasurementRefreshKey({
        timeline: [{ startsAt: minutesAgo(19) }],
      }),
    ).not.toBe(
      getEventMeasurementRefreshKey({
        timeline: [{ startsAt: minutesAgo(18) }],
      }),
    );
  });

  test("a maintenance event's key follows its current state and its planned window", () => {
    const window: Array<Date> = [minutesAgo(-60), minutesAgo(-120)];
    const key: string = getEventMeasurementRefreshKey({
      currentStateId: new ObjectID("44444444-4444-4444-8444-444444444441"),
      times: window,
    });

    expect(
      getEventMeasurementRefreshKey({
        currentStateId: "44444444-4444-4444-8444-444444444441",
        times: window.map((time: Date): Date => {
          return new Date(time.getTime());
        }),
      }),
    ).toBe(key);
    expect(
      getEventMeasurementRefreshKey({
        currentStateId: "44444444-4444-4444-8444-444444444442",
        times: window,
      }),
    ).not.toBe(key);
    // Rescheduled: the window moved, the state did not.
    expect(
      getEventMeasurementRefreshKey({
        currentStateId: "44444444-4444-4444-8444-444444444441",
        times: [minutesAgo(-90), minutesAgo(-150)],
      }),
    ).not.toBe(key);
  });

  /*
   * The server works an event's values out after a state change is saved,
   * not before its response, and stamps every one with a new computedAt.
   * After a change the card reads until every value is newer than the
   * newest one it had: two server times, never the reader's clock.
   */
  test("knows when the values read after a change are the server's new ones", () => {
    const before: Array<MeasurementValues> = [
      incidentValue({ computedAt: minutesAgo(16) }),
      incidentValue({ computedAt: minutesAgo(12) }),
    ];
    const since: Date | undefined = getLatestEventMeasurementComputedAt(before);

    expect(since?.getTime()).toBe(minutesAgo(12).getTime());

    // The same values again: not yet.
    expect(haveEventMeasurementsCaughtUp({ values: before, since })).toBe(
      false,
    );
    // One worked out again, one not: not yet.
    expect(
      haveEventMeasurementsCaughtUp({
        values: [
          incidentValue({ computedAt: NOW }),
          incidentValue({ computedAt: minutesAgo(12) }),
        ],
        since,
      }),
    ).toBe(false);
    // Every one worked out after the change (as ISO strings, too).
    expect(
      haveEventMeasurementsCaughtUp({
        values: [
          incidentValue({ computedAt: NOW }),
          incidentValue({ computedAt: NOW.toISOString() }),
        ],
        since,
      }),
    ).toBe(true);
    // A value with no time cannot be shown to be new.
    expect(
      haveEventMeasurementsCaughtUp({
        values: [incidentValue({ computedAt: null })],
        since,
      }),
    ).toBe(false);
    // Nothing read before: nothing to wait for.
    expect(
      haveEventMeasurementsCaughtUp({ values: before, since: undefined }),
    ).toBe(true);
    expect(getLatestEventMeasurementComputedAt([])).toBeUndefined();
  });

  test("waits a little longer each time, and then stops waiting", () => {
    expect(EVENT_MEASUREMENT_SETTLE_DELAYS_IN_MS).toEqual([
      3000, 6000, 12000, 24000,
    ]);
    expect(getEventMeasurementSettleDelay(0)).toBe(3000);
    expect(getEventMeasurementSettleDelay(3)).toBe(24000);
    expect(getEventMeasurementSettleDelay(4)).toBeNull();
  });
});

describe("the words", () => {
  test("every page says what its card and its switch are for, in its own words", () => {
    for (const domain of Object.values(MeasurementDomain)) {
      const copy: (typeof MEASUREMENT_PAGE_COPY)[MeasurementDomain] =
        MEASUREMENT_PAGE_COPY[domain];

      expect(copy.eventCardDescription).toMatch(
        /^Your team's measurements, worked out for this /,
      );
      expect(copy.showOnViewTitle).toMatch(/^Show on .+ pages$/);
      // Names the card the switch puts it on.
      expect(copy.showOnViewDescription).toContain(
        `the ${MEASUREMENT_VALUE_COPY.cardTitle} card`,
      );
    }
  });

  test("are all collected for the locale files", () => {
    const text: Array<string> = getMeasurementSetupText();

    for (const value of Object.values(MEASUREMENT_VALUE_COPY)) {
      expect(text).toContain(value);
    }
  });

  test("the help says where each event's numbers show, and that the switch is on", () => {
    for (const domain of Object.values(MeasurementDomain)) {
      const markdown: string = getMeasurementsHelpMarkdown(domain);

      expect(markdown).toContain(
        `in a **${MEASUREMENT_VALUE_COPY.cardTitle}** card`,
      );
      expect(markdown).toContain(
        "page shows it (it does, unless you turn that off)",
      );
    }
  });
});
