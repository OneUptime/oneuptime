import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionMonitorMeasureReader, {
  ENTITY_FINGERPRINT_LIMIT,
  ExceptionMonitorMeasures,
} from "../../../../Server/Utils/Monitor/ExceptionMonitorMeasures";
import ExceptionMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import FindBy from "../../../../Server/Types/AnalyticsDatabase/FindBy";
import logger from "../../../../Server/Utils/Logger";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import ExceptionMonitorResponse from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../../Types/Monitor/MonitorStepExceptionMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import type { SpyInstance } from "jest-mock";

/*
 * What an Exceptions monitor reads beyond its count, with the databases
 * mocked: nothing more for a plain count; new and regressed exceptions as
 * exception groups with the monitor's filters and the window - for a
 * monitor scoped to infrastructure entities, among the groups of the
 * window's occurrences from them; the usual count as the window's own
 * occurrence query moved to the day before; and the criteria and the
 * status timeline reading each.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const UNTIL: Date = new Date("2026-10-30T12:00:00.000Z");

interface CountCall {
  query: Record<string, unknown>;
}

let groupCalls: Array<CountCall>;
let occurrenceCalls: Array<CountCall>;
let groupCounts: Array<number>;
let previousOccurrences: number;
// The fingerprints the window's occurrences carry, as the grouped read returns them.
let occurrenceFingerprints: Array<string>;
let fingerprintReads: Array<FindBy<ExceptionInstance>>;

function stepWith(checkOns: Array<CheckOn>): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorType: MonitorType.Exceptions,
    monitorName: "Checkout",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    ...instance.data!,
    filters: checkOns.map((checkOn: CheckOn) => {
      return { checkOn, filterType: FilterType.GreaterThan, value: 0 };
    }),
  };
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [instance] };
  step.setMonitorCriteria(criteria);
  return step;
}

function config(
  overrides: Partial<MonitorStepExceptionMonitor> = {},
): MonitorStepExceptionMonitor {
  return {
    ...MonitorStepExceptionMonitorUtil.getDefault(),
    telemetryServiceIds: [SERVICE_ID],
    exceptionTypes: ["TypeError"],
    environments: ["production"],
    message: "cart",
    lastXSecondsOfExceptions: 300,
    ...overrides,
  };
}

async function read(
  checkOns: Array<CheckOn>,
  overrides: Partial<MonitorStepExceptionMonitor> = {},
  exceptionCount: number = 40,
): Promise<ExceptionMonitorMeasures> {
  return await ExceptionMonitorMeasureReader.read({
    projectId: PROJECT_ID,
    monitorStep: stepWith(checkOns),
    config: config(overrides),
    countQuery: {
      projectId: PROJECT_ID,
      time: new InBetween(new Date(UNTIL.getTime() - 300000), UNTIL),
    },
    exceptionCount,
    evaluateUntil: UNTIL,
  });
}

beforeEach(() => {
  groupCalls = [];
  occurrenceCalls = [];
  fingerprintReads = [];
  groupCounts = [2, 1];
  previousOccurrences = 2880;
  occurrenceFingerprints = ["fp-a", "fp-b"];

  jest.spyOn(TelemetryExceptionService, "countBy").mockImplementation((async (
    args: CountCall,
  ) => {
    groupCalls.push({ query: args.query });
    return new PositiveNumber(groupCounts.shift() || 0);
  }) as never);
  jest.spyOn(ExceptionInstanceService, "countBy").mockImplementation((async (
    args: CountCall,
  ) => {
    occurrenceCalls.push({ query: args.query });
    return new PositiveNumber(previousOccurrences);
  }) as never);
  jest.spyOn(ExceptionInstanceService, "findBy").mockImplementation((async (
    args: FindBy<ExceptionInstance>,
  ) => {
    fingerprintReads.push(args);
    return occurrenceFingerprints.map(
      (fingerprint: string): ExceptionInstance => {
        const row: ExceptionInstance = new ExceptionInstance();
        row.fingerprint = fingerprint;
        return row;
      },
    );
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExceptionMonitorMeasureReader.read", () => {
  test("a plain count reads nothing more", async () => {
    expect(await read([CheckOn.ExceptionCount])).toEqual({});
    expect(groupCalls).toHaveLength(0);
    expect(occurrenceCalls).toHaveLength(0);
    expect(fingerprintReads).toHaveLength(0);
  });

  test("new exceptions: open groups first seen in the window, with the monitor's filters", async () => {
    groupCounts = [3];
    const measures: ExceptionMonitorMeasures = await read([
      CheckOn.NewExceptionCount,
    ]);

    expect(measures).toEqual({ newExceptionCount: 3 });
    expect(groupCalls).toHaveLength(1);

    const query: Record<string, unknown> = groupCalls[0]!.query;
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["primaryEntityId"]).toEqual(new Includes([SERVICE_ID]));
    expect(query["exceptionType"]).toEqual(new Includes(["TypeError"]));
    expect(query["environment"]).toEqual(new Includes(["production"]));
    expect(query["message"]).toEqual(new Search("cart"));
    expect(query["isResolved"]).toBe(false);
    expect(query["isArchived"]).toBe(false);
    expect(JSON.stringify(query["firstSeenAt"])).toContain(
      "2026-10-30T11:55:00.000Z",
    );
    expect(JSON.stringify(query["firstSeenAt"])).toContain(
      "2026-10-30T12:00:00.000Z",
    );
  });

  test("regressed exceptions: groups that came back in the window and are still open", async () => {
    groupCounts = [1];
    const measures: ExceptionMonitorMeasures = await read(
      [CheckOn.RegressedExceptionCount],
      { includeResolved: true },
    );

    expect(measures).toEqual({ regressedExceptionCount: 1 });

    const query: Record<string, unknown> = groupCalls[0]!.query;
    expect(JSON.stringify(query["regressedAt"])).toContain(
      "2026-10-30T11:55:00.000Z",
    );
    // Resolved again since: fixed, whatever the monitor counts.
    expect(query["isResolved"]).toBe(false);
  });

  test("counting resolved and archived exceptions too leaves the status out of a new-exception query", async () => {
    await read([CheckOn.NewExceptionCount], {
      includeResolved: true,
      includeArchived: true,
    });

    expect("isResolved" in groupCalls[0]!.query).toBe(false);
    expect("isArchived" in groupCalls[0]!.query).toBe(false);
  });

  test("the increase: the window's own query over the day before, per window", async () => {
    // 2880 in the day before: 10 per five minutes; 40 now is 300% above.
    const measures: ExceptionMonitorMeasures = await read([
      CheckOn.ExceptionCountIncreasePercent,
    ]);

    expect(measures).toEqual({
      exceptionCountBaseline: 10,
      exceptionCountIncreasePercent: 300,
    });
    expect(occurrenceCalls).toHaveLength(1);

    const time: InBetween<Date> = occurrenceCalls[0]!.query[
      "time"
    ] as InBetween<Date>;
    expect(new Date(time.startValue).toISOString()).toBe(
      "2026-10-29T11:55:00.000Z",
    );
    expect(new Date(time.endValue).toISOString()).toBe(
      "2026-10-30T11:55:00.000Z",
    );
    // The rest of the window's query is kept.
    expect(occurrenceCalls[0]!.query["projectId"]).toBe(PROJECT_ID);
  });

  test("all three, read together", async () => {
    groupCounts = [2, 1];
    const measures: ExceptionMonitorMeasures = await read([
      CheckOn.NewExceptionCount,
      CheckOn.RegressedExceptionCount,
      CheckOn.ExceptionCountIncreasePercent,
    ]);

    expect(measures.newExceptionCount).toBe(2);
    expect(measures.regressedExceptionCount).toBe(1);
    expect(measures.exceptionCountIncreasePercent).toBe(300);
  });
});

/*
 * THE INFRASTRUCTURE ENTITY FILTER.
 *
 * An entity is a property of each occurrence, not of the exception group.
 * So a monitor scoped to entities counts the new and regressed exceptions
 * among the groups of the occurrences it counts in its window: their
 * fingerprints are read from ClickHouse first, and only those groups are
 * counted in Postgres. A monitor without the filter reads exactly what it
 * did before.
 */
describe("the infrastructure entity filter on new and regressed exceptions", () => {
  const HOST: string = "host:web-1";

  // The window's own occurrence query, as the worker builds it.
  function countQueryOf(
    overrides: Partial<MonitorStepExceptionMonitor>,
  ): Record<string, unknown> {
    return {
      ...MonitorStepExceptionMonitorUtil.toAnalyticsQuery(
        config(overrides),
        UNTIL,
      ),
      projectId: PROJECT_ID,
      fingerprint: new IncludesNone(["resolved-fp"]),
    };
  }

  async function readScoped(
    checkOns: Array<CheckOn>,
    overrides: Partial<MonitorStepExceptionMonitor> = { entityKeys: [HOST] },
  ): Promise<ExceptionMonitorMeasures> {
    return await ExceptionMonitorMeasureReader.read({
      projectId: PROJECT_ID,
      monitorStep: stepWith(checkOns),
      config: config(overrides),
      countQuery: countQueryOf(overrides),
      exceptionCount: 40,
      evaluateUntil: UNTIL,
    });
  }

  test("without one, nothing more is read and the groups are queried as before", async () => {
    for (const entityKeys of [undefined, []]) {
      groupCalls = [];
      groupCounts = [3, 1];

      expect(
        await readScoped(
          [CheckOn.NewExceptionCount, CheckOn.RegressedExceptionCount],
          { entityKeys },
        ),
      ).toEqual({ newExceptionCount: 3, regressedExceptionCount: 1 });

      for (const call of groupCalls) {
        expect("fingerprint" in call.query).toBe(false);
      }
    }

    expect(fingerprintReads).toHaveLength(0);
  });

  test("new exceptions are counted among the groups of the window's occurrences from the entities", async () => {
    groupCounts = [1];

    expect(await readScoped([CheckOn.NewExceptionCount])).toEqual({
      newExceptionCount: 1,
    });

    expect(groupCalls).toHaveLength(1);
    const query: Record<string, unknown> = groupCalls[0]!.query;
    expect(query["fingerprint"]).toEqual(new Includes(["fp-a", "fp-b"]));
    // The rest of the group query is what it was.
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["primaryEntityId"]).toEqual(new Includes([SERVICE_ID]));
    expect(query["exceptionType"]).toEqual(new Includes(["TypeError"]));
    expect(query["isResolved"]).toBe(false);
    expect(query["isArchived"]).toBe(false);
    expect(JSON.stringify(query["firstSeenAt"])).toContain(
      "2026-10-30T11:55:00.000Z",
    );
  });

  test("the fingerprints are the occurrences the monitor counts in its window, each once, read as root", async () => {
    await readScoped([CheckOn.NewExceptionCount]);

    expect(fingerprintReads).toHaveLength(1);
    const read: FindBy<ExceptionInstance> = fingerprintReads[0]!;
    const query: Record<string, unknown> = read.query as Record<
      string,
      unknown
    >;

    // The window's own occurrence query: its entities with every other filter.
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["entityKeys"]).toEqual(new Includes([HOST]));
    expect(query["primaryEntityId"]).toEqual(new Includes([SERVICE_ID]));
    expect(query["environment"]).toEqual(new Includes(["production"]));
    expect(query["exceptionType"]).toEqual(new Includes(["TypeError"]));
    expect(query["message"]).toEqual(new Search("cart"));
    expect(query["fingerprint"]).toEqual(new IncludesNone(["resolved-fp"]));

    const time: InBetween<Date> = query["time"] as InBetween<Date>;
    expect(new Date(time.startValue).toISOString()).toBe(
      "2026-10-30T11:55:00.000Z",
    );
    expect(new Date(time.endValue).toISOString()).toBe(
      "2026-10-30T12:00:00.000Z",
    );

    expect(read.groupBy).toEqual({ fingerprint: true });
    expect(read.select).toEqual({ fingerprint: true });
    expect(read.sort).toEqual({ fingerprint: SortOrder.Ascending });
    expect(read.limit).toBe(ENTITY_FINGERPRINT_LIMIT);
    expect(read.skip).toBe(0);
    expect(read.props).toEqual({ isRoot: true });
  });

  test("the window is the monitor's own, whatever time the count query carries", async () => {
    await ExceptionMonitorMeasureReader.read({
      projectId: PROJECT_ID,
      monitorStep: stepWith([CheckOn.NewExceptionCount]),
      config: config({ entityKeys: [HOST], lastXSecondsOfExceptions: 600 }),
      // A count query without a window: the read still keeps to the monitor's.
      countQuery: { projectId: PROJECT_ID, entityKeys: new Includes([HOST]) },
      exceptionCount: 0,
      evaluateUntil: UNTIL,
    });

    const time: InBetween<Date> = (
      fingerprintReads[0]!.query as Record<string, unknown>
    )["time"] as InBetween<Date>;
    expect(new Date(time.startValue).toISOString()).toBe(
      "2026-10-30T11:50:00.000Z",
    );
    expect(new Date(time.endValue).toISOString()).toBe(
      "2026-10-30T12:00:00.000Z",
    );
  });

  test("regressed exceptions too, from the same one read", async () => {
    groupCounts = [2, 1];

    expect(
      await readScoped([
        CheckOn.NewExceptionCount,
        CheckOn.RegressedExceptionCount,
      ]),
    ).toEqual({ newExceptionCount: 2, regressedExceptionCount: 1 });

    expect(fingerprintReads).toHaveLength(1);
    expect(groupCalls).toHaveLength(2);

    const regressed: Record<string, unknown> = groupCalls.find(
      (call: CountCall): boolean => {
        return "regressedAt" in call.query;
      },
    )!.query;
    expect(regressed["fingerprint"]).toEqual(new Includes(["fp-a", "fp-b"]));
    expect(regressed["isResolved"]).toBe(false);
  });

  test("no occurrence from the entities in the window: none new, none regressed, and no group is read", async () => {
    occurrenceFingerprints = [];

    expect(
      await readScoped([
        CheckOn.NewExceptionCount,
        CheckOn.RegressedExceptionCount,
      ]),
    ).toEqual({ newExceptionCount: 0, regressedExceptionCount: 0 });
    expect(groupCalls).toHaveLength(0);
  });

  test("a fingerprint read twice, or blank, is asked about once", async () => {
    occurrenceFingerprints = ["fp-a", "", "fp-a", "fp-c"];

    await readScoped([CheckOn.NewExceptionCount]);

    expect(groupCalls[0]!.query["fingerprint"]).toEqual(
      new Includes(["fp-a", "fp-c"]),
    );
  });

  test("the usual count is the window's count moved back, the entities with it, and reads no fingerprints", async () => {
    const measures: ExceptionMonitorMeasures = await readScoped([
      CheckOn.ExceptionCountIncreasePercent,
    ]);

    expect(measures.exceptionCountIncreasePercent).toBe(300);
    expect(fingerprintReads).toHaveLength(0);
    expect(occurrenceCalls[0]!.query["entityKeys"]).toEqual(
      new Includes([HOST]),
    );
  });

  test("at the limit it says so, and counts among the fingerprints it read", async () => {
    occurrenceFingerprints = Array.from(
      { length: ENTITY_FINGERPRINT_LIMIT },
      (_value: unknown, index: number): string => {
        return `fp-${index}`;
      },
    );
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    await readScoped([CheckOn.NewExceptionCount]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(
      (groupCalls[0]!.query["fingerprint"] as Includes).values,
    ).toHaveLength(ENTITY_FINGERPRINT_LIMIT);
  });

  test("below the limit it says nothing", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    await readScoped([CheckOn.NewExceptionCount]);

    expect(warn).not.toHaveBeenCalled();
  });

  test("a read that fails fails the measure, as the window's own count would", async () => {
    jest
      .spyOn(ExceptionInstanceService, "findBy")
      .mockRejectedValue(new Error("ClickHouse is away") as never);

    await expect(readScoped([CheckOn.NewExceptionCount])).rejects.toThrow(
      "ClickHouse is away",
    );
    expect(groupCalls).toHaveLength(0);
  });
});

/*
 * A SEEDED SWEEP: random projects of exception groups and their
 * occurrences, on random hosts and services, at random times around the
 * window, some resolved, regressed or archived; and random monitors, with
 * or without an entity filter. Both databases are played by the world: the
 * occurrence read keeps the occurrences its query names (project, window,
 * services, entities, the resolved and archived left out), and the group
 * count the groups its query names. Whatever the shape, each monitor reads
 * the new and regressed exceptions a model of every group and occurrence
 * says it should.
 */
describe("a seeded sweep of entity-scoped and unscoped monitors", () => {
  interface Group {
    fingerprint: string;
    serviceId: ObjectID;
    firstSeenAt: Date;
    regressedAt: Date | null;
    isResolved: boolean;
    isArchived: boolean;
  }

  interface Occurrence {
    fingerprint: string;
    serviceId: ObjectID;
    entityKeys: Array<string>;
    time: Date;
  }

  const SERVICES: Array<ObjectID> = [
    new ObjectID("70000000-0000-4000-8000-000000000001"),
    new ObjectID("70000000-0000-4000-8000-000000000002"),
  ];
  const HOSTS: Array<string> = ["host:a", "host:b", "host:c", "pod:d"];

  // The two dates of a Raw "between" condition (QueryHelper.inBetween).
  function windowOf(condition: unknown): [number, number] {
    const values: Array<unknown> = Object.values(
      (condition as { objectLiteralParameters: Record<string, unknown> })
        .objectLiteralParameters,
    );

    return [
      new Date(values[0] as Date).getTime(),
      new Date(values[1] as Date).getTime(),
    ];
  }

  function within(value: Date | null, window: [number, number]): boolean {
    return (
      value !== null &&
      value.getTime() >= window[0] &&
      value.getTime() <= window[1]
    );
  }

  function idsOf(values: unknown): Array<string> {
    return ((values as Includes).values as Array<unknown>).map(
      (value: unknown): string => {
        return String(value);
      },
    );
  }

  test("every monitor counts what the model says", async () => {
    const random: SeededRandom = seededRandom(5440);
    const minute: number = 60 * 1000;
    // How often the sweep met the cases it is for, so it cannot pass on nothing.
    let scopedRounds: number = 0;
    let narrowedRounds: number = 0;
    let countedRounds: number = 0;

    for (let round: number = 0; round < 300; round++) {
      const at: (minutesAgo: number) => Date = (minutesAgo: number): Date => {
        return new Date(UNTIL.getTime() - minutesAgo * minute);
      };

      const groups: Array<Group> = [];
      const occurrences: Array<Occurrence> = [];
      const groupCount: number = 1 + random(10);

      for (let index: number = 0; index < groupCount; index++) {
        const isResolved: boolean = random(4) === 0;
        const group: Group = {
          fingerprint: `fp-${round}-${index}`,
          serviceId: SERVICES[random(SERVICES.length)]!,
          // Up to an hour ago: before, at the edges of, and inside the window.
          firstSeenAt: at(random(61)),
          regressedAt: random(3) === 0 ? at(random(61)) : null,
          isResolved,
          isArchived: random(6) === 0,
        };
        groups.push(group);

        const occurrenceCount: number = random(4);

        for (let draw: number = 0; draw < occurrenceCount; draw++) {
          const hosts: Array<string> = HOSTS.filter((): boolean => {
            return random(3) === 0;
          });
          occurrences.push({
            fingerprint: group.fingerprint,
            serviceId: group.serviceId,
            entityKeys: hosts,
            time: at(random(61)),
          });
        }
      }

      const monitor: Partial<MonitorStepExceptionMonitor> = {
        telemetryServiceIds: random(2) === 0 ? [] : [SERVICES[random(2)]!],
        exceptionTypes: [],
        environments: [],
        message: "",
        entityKeys:
          random(3) === 0
            ? []
            : HOSTS.filter((): boolean => {
                return random(2) === 0;
              }),
        includeResolved: random(3) === 0,
        includeArchived: random(3) === 0,
        lastXSecondsOfExceptions: [60, 300, 600, 1800][random(4)]!,
      };
      const monitorConfig: MonitorStepExceptionMonitor = config(monitor);

      // The worker's count query: the window's occurrences, resolved and archived left out.
      const excluded: Array<string> = groups
        .filter((group: Group): boolean => {
          return (
            (!monitorConfig.includeResolved && group.isResolved) ||
            (!monitorConfig.includeArchived && group.isArchived)
          );
        })
        .map((group: Group): string => {
          return group.fingerprint;
        });
      const countQuery: Record<string, unknown> = {
        ...MonitorStepExceptionMonitorUtil.toAnalyticsQuery(
          monitorConfig,
          UNTIL,
        ),
        projectId: PROJECT_ID,
        ...(excluded.length > 0
          ? { fingerprint: new IncludesNone(excluded) }
          : {}),
      };

      jest.spyOn(ExceptionInstanceService, "findBy").mockImplementation((async (
        args: FindBy<ExceptionInstance>,
      ) => {
        const query: Record<string, unknown> = args.query as Record<
          string,
          unknown
        >;
        const time: InBetween<Date> = query["time"] as InBetween<Date>;
        const kept: Array<string> = [];

        for (const occurrence of occurrences) {
          const inWindow: boolean =
            occurrence.time.getTime() >= new Date(time.startValue).getTime() &&
            occurrence.time.getTime() <= new Date(time.endValue).getTime();
          const inService: boolean =
            !query["primaryEntityId"] ||
            idsOf(query["primaryEntityId"]).includes(
              occurrence.serviceId.toString(),
            );
          const onEntity: boolean =
            !query["entityKeys"] ||
            occurrence.entityKeys.some((key: string): boolean => {
              return idsOf(query["entityKeys"]).includes(key);
            });
          const notLeftOut: boolean =
            !query["fingerprint"] ||
            !(
              (query["fingerprint"] as IncludesNone).values as Array<string>
            ).includes(occurrence.fingerprint);

          if (inWindow && inService && onEntity && notLeftOut) {
            kept.push(occurrence.fingerprint);
          }
        }

        return Array.from(new Set(kept)).map(
          (fingerprint: string): ExceptionInstance => {
            const row: ExceptionInstance = new ExceptionInstance();
            row.fingerprint = fingerprint;
            return row;
          },
        );
      }) as never);

      jest
        .spyOn(TelemetryExceptionService, "countBy")
        .mockImplementation((async (args: CountCall) => {
          const query: Record<string, unknown> = args.query;

          const counted: Array<Group> = groups.filter(
            (group: Group): boolean => {
              return (
                query["projectId"] === PROJECT_ID &&
                (!query["primaryEntityId"] ||
                  idsOf(query["primaryEntityId"]).includes(
                    group.serviceId.toString(),
                  )) &&
                (query["isResolved"] === undefined ||
                  group.isResolved === query["isResolved"]) &&
                (query["isArchived"] === undefined ||
                  group.isArchived === query["isArchived"]) &&
                (!query["fingerprint"] ||
                  idsOf(query["fingerprint"]).includes(group.fingerprint)) &&
                (!query["firstSeenAt"] ||
                  within(group.firstSeenAt, windowOf(query["firstSeenAt"]))) &&
                (!query["regressedAt"] ||
                  within(group.regressedAt, windowOf(query["regressedAt"])))
              );
            },
          );

          return new PositiveNumber(counted.length);
        }) as never);

      const measures: ExceptionMonitorMeasures =
        await ExceptionMonitorMeasureReader.read({
          projectId: PROJECT_ID,
          monitorStep: stepWith([
            CheckOn.NewExceptionCount,
            CheckOn.RegressedExceptionCount,
          ]),
          config: monitorConfig,
          countQuery,
          exceptionCount: 0,
          evaluateUntil: UNTIL,
        });

      // The model.
      const window: [number, number] = [
        UNTIL.getTime() - monitorConfig.lastXSecondsOfExceptions * 1000,
        UNTIL.getTime(),
      ];
      const scoped: boolean = (monitorConfig.entityKeys || []).length > 0;
      const reached: Set<string> = new Set(
        occurrences
          .filter((occurrence: Occurrence): boolean => {
            return (
              within(occurrence.time, window) &&
              (monitorConfig.telemetryServiceIds.length === 0 ||
                monitorConfig.telemetryServiceIds
                  .map((id: ObjectID): string => {
                    return id.toString();
                  })
                  .includes(occurrence.serviceId.toString())) &&
              occurrence.entityKeys.some((key: string): boolean => {
                return (monitorConfig.entityKeys || []).includes(key);
              }) &&
              !excluded.includes(occurrence.fingerprint)
            );
          })
          .map((occurrence: Occurrence): string => {
            return occurrence.fingerprint;
          }),
      );
      const candidates: Array<Group> = groups.filter(
        (group: Group): boolean => {
          return (
            (monitorConfig.telemetryServiceIds.length === 0 ||
              monitorConfig.telemetryServiceIds[0]!.toString() ===
                group.serviceId.toString()) &&
            (monitorConfig.includeResolved || !group.isResolved) &&
            (monitorConfig.includeArchived || !group.isArchived) &&
            (!scoped || reached.has(group.fingerprint))
          );
        },
      );

      const expected: ExceptionMonitorMeasures = {
        newExceptionCount: candidates.filter((group: Group): boolean => {
          return within(group.firstSeenAt, window);
        }).length,
        regressedExceptionCount: candidates.filter((group: Group): boolean => {
          return within(group.regressedAt, window) && !group.isResolved;
        }).length,
      };

      expect({ round, measures }).toEqual({ round, measures: expected });

      // What the same monitor would count without its entity filter.
      const unscoped: number = groups.filter((group: Group): boolean => {
        return (
          (monitorConfig.telemetryServiceIds.length === 0 ||
            monitorConfig.telemetryServiceIds[0]!.toString() ===
              group.serviceId.toString()) &&
          (monitorConfig.includeResolved || !group.isResolved) &&
          (monitorConfig.includeArchived || !group.isArchived) &&
          within(group.firstSeenAt, window)
        );
      }).length;

      scopedRounds += scoped ? 1 : 0;
      narrowedRounds +=
        scoped && expected.newExceptionCount! < unscoped ? 1 : 0;
      countedRounds +=
        expected.newExceptionCount! + expected.regressedExceptionCount! > 0
          ? 1
          : 0;

      jest.restoreAllMocks();
    }

    expect(scopedRounds).toBeGreaterThan(100);
    expect(narrowedRounds).toBeGreaterThan(20);
    expect(countedRounds).toBeGreaterThan(50);
  });
});

describe("the criteria and the status timeline", () => {
  function response(
    overrides: Partial<ExceptionMonitorResponse> = {},
  ): ExceptionMonitorResponse {
    return {
      projectId: PROJECT_ID,
      exceptionCount: 40,
      exceptionQuery: {},
      monitorId: ObjectID.generate(),
      newExceptionCount: 2,
      regressedExceptionCount: 1,
      exceptionCountBaseline: 10,
      exceptionCountIncreasePercent: 300,
      ...overrides,
    };
  }

  function filter(checkOn: CheckOn, value: number): CriteriaFilter {
    return { checkOn, filterType: FilterType.GreaterThan, value };
  }

  test.each([
    [CheckOn.ExceptionCount, 39, true],
    [CheckOn.NewExceptionCount, 0, true],
    [CheckOn.NewExceptionCount, 2, false],
    [CheckOn.RegressedExceptionCount, 0, true],
    [CheckOn.ExceptionCountIncreasePercent, 200, true],
    [CheckOn.ExceptionCountIncreasePercent, 300, false],
  ])(
    "%s greater than %s matches: %s",
    async (checkOn: CheckOn, value: number, matches: boolean) => {
      const message: string | null =
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(),
          criteriaFilter: filter(checkOn, value),
        });

      expect(Boolean(message)).toBe(matches);
    },
  );

  test("a response from before the measures were read reads 0 for them", async () => {
    const message: string | null =
      await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: PROJECT_ID,
          exceptionCount: 40,
          exceptionQuery: {},
          monitorId: ObjectID.generate(),
        } as ExceptionMonitorResponse,
        criteriaFilter: filter(CheckOn.NewExceptionCount, 0),
      });

    expect(message).toBe(null);
  });

  test("another check is not an exception measure", () => {
    expect(
      ExceptionMonitorCriteria.getMeasuredValue(response(), CheckOn.LogCount),
    ).toBe(null);
  });

  test("the status timeline says what was seen, for each", () => {
    const describe: (checkOn: CheckOn) => string | null = (
      checkOn: CheckOn,
    ): string | null => {
      return MonitorCriteriaObservationBuilder.describeExceptionCountObservation(
        { dataToProcess: response(), checkOn },
      );
    };

    expect(describe(CheckOn.ExceptionCount)).toBe("Exception count was 40.");
    expect(describe(CheckOn.NewExceptionCount)).toBe(
      "2 exceptions were seen for the first time in the window.",
    );
    expect(describe(CheckOn.RegressedExceptionCount)).toBe(
      "1 resolved exception came back in the window.",
    );
    expect(describe(CheckOn.ExceptionCountIncreasePercent)).toBe(
      "Exception count was 40, 300% above the usual 10 per window over the day before.",
    );
  });
});
