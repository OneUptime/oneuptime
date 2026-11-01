import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import logger from "../../../../Server/Utils/Logger";
import OnCallPersonPageAnswer from "../../../../Server/Utils/OnCall/OnCallPersonPageAnswer";
import OnCallAcknowledgementTimeout, {
  CLOCK_RUN_SELECT,
  OnCallPageAgainOutcome,
  OnCallPageAgainResult,
  OnCallTimeoutRecordKind,
  OnCallTimeoutRecordState,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE ACKNOWLEDGEMENT TIMEOUT FOR EVERY KIND OF RECORD (OnCallAcknowledgementTimeout).
 *
 * Incidents and incident episodes walk the project's incident states;
 * alerts and alert episodes its alert states. Each kind is read through its
 * own service, its own state timeline and its own column on a run. These
 * hold every kind to the same rule, and every entry point to never throwing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000002",
);
const POLICY_A: ObjectID = new ObjectID("7a000000-0000-4000-8000-0000000000a1");
const POLICY_B: ObjectID = new ObjectID("7a000000-0000-4000-8000-0000000000b1");
const ANA: ObjectID = new ObjectID("7a000000-0000-4000-8000-0000000000c1");

const CREATED: string = "7a000000-0000-4000-8000-0000000000d1";
const ACKNOWLEDGED: string = "7a000000-0000-4000-8000-0000000000d2";
const RESOLVED: string = "7a000000-0000-4000-8000-0000000000d3";

const NOW: Date = new Date("2026-10-22T03:00:00.000Z");

function incidentStates(): Array<IncidentState> {
  return [
    [CREATED, 1, "isCreatedState"],
    [ACKNOWLEDGED, 2, "isAcknowledgedState"],
    [RESOLVED, 3, "isResolvedState"],
  ].map(([id, order, flag]: Array<string | number>) => {
    const row: IncidentState = new IncidentState();
    row.id = new ObjectID(id as string);
    row.order = order as number;
    (row as unknown as Record<string, boolean>)[flag as string] = true;
    return row;
  });
}

function alertStates(): Array<AlertState> {
  return [
    [CREATED, 1, "isCreatedState"],
    [ACKNOWLEDGED, 2, "isAcknowledgedState"],
    [RESOLVED, 3, "isResolvedState"],
  ].map(([id, order, flag]: Array<string | number>) => {
    const row: AlertState = new AlertState();
    row.id = new ObjectID(id as string);
    row.order = order as number;
    (row as unknown as Record<string, boolean>)[flag as string] = true;
    return row;
  });
}

interface KindCase {
  kind: OnCallTimeoutRecordKind;
  runColumn: string;
  // Hands the record back in a state: as its own service reads it.
  readRecord: (stateId: string | null) => void;
  readTimeline: (rows: Array<{ stateId: string; userId: ObjectID }>) => void;
  timelineService: unknown;
  usesAlertStates: boolean;
}

const KINDS: Array<KindCase> = [
  {
    kind: "incident",
    runColumn: "triggeredByIncidentId",
    usesAlertStates: false,
    timelineService: IncidentStateTimelineService,
    readRecord: (stateId: string | null): void => {
      jest
        .spyOn(IncidentService, "findOneById")
        .mockImplementation((async () => {
          const record: Incident = new Incident();
          record.projectId = PROJECT_ID;
          if (stateId) {
            record.currentIncidentStateId = new ObjectID(stateId);
          }
          return record;
        }) as never);
    },
    readTimeline: (
      rows: Array<{ stateId: string; userId: ObjectID }>,
    ): void => {
      jest
        .spyOn(IncidentStateTimelineService, "findBy")
        .mockImplementation((async () => {
          return rows.map(
            (row: { stateId: string; userId: ObjectID }, index: number) => {
              return {
                incidentStateId: new ObjectID(row.stateId),
                startsAt: new Date(NOW.getTime() + index * 1000),
                createdByUserId: row.userId,
              };
            },
          );
        }) as never);
    },
  },
  {
    kind: "alert",
    runColumn: "triggeredByAlertId",
    usesAlertStates: true,
    timelineService: AlertStateTimelineService,
    readRecord: (stateId: string | null): void => {
      jest.spyOn(AlertService, "findOneById").mockImplementation((async () => {
        const record: Alert = new Alert();
        record.projectId = PROJECT_ID;
        if (stateId) {
          record.currentAlertStateId = new ObjectID(stateId);
        }
        return record;
      }) as never);
    },
    readTimeline: (
      rows: Array<{ stateId: string; userId: ObjectID }>,
    ): void => {
      jest
        .spyOn(AlertStateTimelineService, "findBy")
        .mockImplementation((async () => {
          return rows.map(
            (row: { stateId: string; userId: ObjectID }, index: number) => {
              return {
                alertStateId: new ObjectID(row.stateId),
                startsAt: new Date(NOW.getTime() + index * 1000),
                createdByUserId: row.userId,
              };
            },
          );
        }) as never);
    },
  },
  {
    kind: "incident episode",
    runColumn: "triggeredByIncidentEpisodeId",
    usesAlertStates: false,
    timelineService: IncidentEpisodeStateTimelineService,
    readRecord: (stateId: string | null): void => {
      jest
        .spyOn(IncidentEpisodeService, "findOneById")
        .mockImplementation((async () => {
          const record: IncidentEpisode = new IncidentEpisode();
          record.projectId = PROJECT_ID;
          if (stateId) {
            record.currentIncidentStateId = new ObjectID(stateId);
          }
          return record;
        }) as never);
    },
    readTimeline: (
      rows: Array<{ stateId: string; userId: ObjectID }>,
    ): void => {
      jest
        .spyOn(IncidentEpisodeStateTimelineService, "findBy")
        .mockImplementation((async () => {
          return rows.map(
            (row: { stateId: string; userId: ObjectID }, index: number) => {
              return {
                incidentStateId: new ObjectID(row.stateId),
                startsAt: new Date(NOW.getTime() + index * 1000),
                createdByUserId: row.userId,
              };
            },
          );
        }) as never);
    },
  },
  {
    kind: "alert episode",
    runColumn: "triggeredByAlertEpisodeId",
    usesAlertStates: true,
    timelineService: AlertEpisodeStateTimelineService,
    readRecord: (stateId: string | null): void => {
      jest
        .spyOn(AlertEpisodeService, "findOneById")
        .mockImplementation((async () => {
          const record: AlertEpisode = new AlertEpisode();
          record.projectId = PROJECT_ID;
          if (stateId) {
            record.currentAlertStateId = new ObjectID(stateId);
          }
          return record;
        }) as never);
    },
    readTimeline: (
      rows: Array<{ stateId: string; userId: ObjectID }>,
    ): void => {
      jest
        .spyOn(AlertEpisodeStateTimelineService, "findBy")
        .mockImplementation((async () => {
          return rows.map(
            (row: { stateId: string; userId: ObjectID }, index: number) => {
              return {
                alertStateId: new ObjectID(row.stateId),
                startsAt: new Date(NOW.getTime() + index * 1000),
                createdByUserId: row.userId,
              };
            },
          );
        }) as never);
    },
  },
];

let incidentStatesRead: number = 0;
let alertStatesRead: number = 0;

beforeEach(() => {
  incidentStatesRead = 0;
  alertStatesRead = 0;

  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockImplementation((async () => {
      incidentStatesRead++;
      return incidentStates();
    }) as never);

  jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockImplementation((async () => {
      alertStatesRead++;
      return alertStates();
    }) as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));
});

afterEach(() => {
  jest.restoreAllMocks();
});

function policy(
  minutes: number | null,
  isArchived: boolean = false,
): OnCallDutyPolicy {
  const row: OnCallDutyPolicy = new OnCallDutyPolicy();
  row.isArchived = isArchived;
  (row as unknown as Record<string, unknown>)[
    "acknowledgementTimeoutInMinutes"
  ] = minutes;
  return row;
}

function runOf(data: {
  id: string;
  policyId: ObjectID;
  column: string;
  minutes: number | null;
  createdMinutesAgo: number;
  clockStartedAt?: Date | undefined;
  pageAgainNumber?: number | undefined;
}): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = new ObjectID(data.id);
  run.projectId = PROJECT_ID;
  run.onCallDutyPolicyId = data.policyId;
  (run as unknown as Record<string, unknown>)[data.column] = RECORD_ID;
  run.createdAt = new Date(NOW.getTime() - data.createdMinutesAgo * 60 * 1000);
  run.onCallDutyPolicy = policy(data.minutes);
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;

  if (data.clockStartedAt) {
    run.acknowledgementTimeoutStartedAt = data.clockStartedAt;
  }

  if (data.pageAgainNumber) {
    run.pageAgainNumber = data.pageAgainNumber;
  }

  return run;
}

describe.each(KINDS)(
  "a $kind's state, read for the clock",
  (kindCase: KindCase) => {
    test("acknowledged, not resolved", async () => {
      kindCase.readRecord(ACKNOWLEDGED);

      const state: OnCallTimeoutRecordState | null =
        await OnCallAcknowledgementTimeout.readRecordState({
          kind: kindCase.kind,
          recordId: RECORD_ID,
        });

      expect(state).toEqual({ isAcknowledged: true, isResolved: false });
    });

    test("resolved counts as acknowledged too, and as resolved", async () => {
      kindCase.readRecord(RESOLVED);

      expect(
        await OnCallAcknowledgementTimeout.readRecordState({
          kind: kindCase.kind,
          recordId: RECORD_ID,
        }),
      ).toEqual({ isAcknowledged: true, isResolved: true });
    });

    test("created: neither", async () => {
      kindCase.readRecord(CREATED);

      expect(
        await OnCallAcknowledgementTimeout.readRecordState({
          kind: kindCase.kind,
          recordId: RECORD_ID,
        }),
      ).toEqual({ isAcknowledged: false, isResolved: false });
    });

    test("read with its own list of states", async () => {
      kindCase.readRecord(ACKNOWLEDGED);

      await OnCallAcknowledgementTimeout.readRecordState({
        kind: kindCase.kind,
        recordId: RECORD_ID,
      });

      expect({ incident: incidentStatesRead, alert: alertStatesRead }).toEqual(
        kindCase.usesAlertStates
          ? { incident: 0, alert: 1 }
          : { incident: 1, alert: 0 },
      );
    });

    test("a record that is gone has no state", async () => {
      const services: Record<string, unknown> = {
        incident: IncidentService,
        alert: AlertService,
        "incident episode": IncidentEpisodeService,
        "alert episode": AlertEpisodeService,
      };

      jest
        .spyOn(services[kindCase.kind] as never, "findOneById" as never)
        .mockImplementation((async () => {
          return null;
        }) as never);

      expect(
        await OnCallAcknowledgementTimeout.readRecordState({
          kind: kindCase.kind,
          recordId: RECORD_ID,
        }),
      ).toBeNull();
    });

    test("a new acknowledgement starts the clock on its runs, found by its own column", async () => {
      const findBy: SpyInstance<
        typeof OnCallDutyPolicyExecutionLogService.findBy
      > = jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
        .mockImplementation((async (data: {
          query: Record<string, unknown>;
        }) => {
          if (data.query["onCallDutyPolicyId"] instanceof ObjectID) {
            return [
              runOf({
                id: "7a000000-0000-4000-8000-000000000101",
                policyId: POLICY_A,
                column: kindCase.runColumn,
                minutes: 30,
                createdMinutesAgo: 5,
              }),
            ];
          }

          return [
            runOf({
              id: "7a000000-0000-4000-8000-000000000101",
              policyId: POLICY_A,
              column: kindCase.runColumn,
              minutes: 30,
              createdMinutesAgo: 5,
            }),
          ];
        }) as never);

      const started: SpyInstance<
        typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
      > = jest
        .spyOn(
          OnCallDutyPolicyExecutionLogService,
          "startAcknowledgementTimeoutClock",
        )
        .mockResolvedValue(undefined);

      await OnCallAcknowledgementTimeout.onRecordStateChanged({
        kind: kindCase.kind,
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
        stateId: new ObjectID(ACKNOWLEDGED),
        previousStateId: new ObjectID(CREATED),
      });

      expect(findBy.mock.calls[0]![0].query).toHaveProperty(
        kindCase.runColumn,
        RECORD_ID,
      );
      expect(started).toHaveBeenCalledTimes(1);
      expect(started.mock.calls[0]![0].startedAt).toEqual(NOW);
    });

    test("who acknowledged it last is read off its own state timeline", async () => {
      const BOB: ObjectID = new ObjectID(
        "7a000000-0000-4000-8000-0000000000c2",
      );

      kindCase.readRecord(ACKNOWLEDGED);
      kindCase.readTimeline([
        { stateId: CREATED, userId: BOB },
        { stateId: ACKNOWLEDGED, userId: ANA },
      ]);

      const run: OnCallDutyPolicyExecutionLog = runOf({
        id: "7a000000-0000-4000-8000-000000000101",
        policyId: POLICY_A,
        column: kindCase.runColumn,
        minutes: 30,
        createdMinutesAgo: 60,
        clockStartedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
      });

      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
        .mockImplementation((async () => {
          return [run];
        }) as never);
      jest
        .spyOn(
          OnCallDutyPolicyExecutionLogService,
          "stopAcknowledgementTimeoutClock",
        )
        .mockResolvedValue(true);

      const startPageAgain: SpyInstance<
        typeof OnCallDutyPolicyExecutionLogService.startPageAgain
      > = jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "startPageAgain")
        .mockResolvedValue(ObjectID.generate());

      const result: OnCallPageAgainResult =
        await OnCallAcknowledgementTimeout.pageAgainIfDue({
          run: run,
          now: NOW,
        });

      expect(result.outcome).toBe(OnCallPageAgainOutcome.PagedAgain);
      expect(startPageAgain.mock.calls[0]![0]).toMatchObject({
        recordKind: kindCase.kind,
        acknowledgedByUserId: ANA,
        pageAgainNumber: 1,
        minutes: 30,
        [kindCase.runColumn]: RECORD_ID,
      });

      expect(
        (kindCase.timelineService as { findBy: unknown }).findBy,
      ).toHaveBeenCalled();
    });
  },
);

/*
 * An incident's or an alert's state change is handed on to the pages people
 * asked for (OnCallPersonPageAnswer), with who changed it and where the
 * record stands in its new state, read with the states the clock reads.
 */
describe.each(KINDS)(
  "a $kind's state change, handed on to the person's pages",
  (kindCase: KindCase) => {
    const isHandedOn: boolean =
      kindCase.kind === "incident" || kindCase.kind === "alert";

    test.each([
      [
        "acknowledged",
        ACKNOWLEDGED,
        { isAcknowledged: true, isResolved: false },
      ],
      ["resolved", RESOLVED, { isAcknowledged: true, isResolved: true }],
      [
        "back to created",
        CREATED,
        { isAcknowledged: false, isResolved: false },
      ],
    ] as Array<
      [string, string, { isAcknowledged: boolean; isResolved: boolean }]
    >)(
      "%s",
      async (
        _name: string,
        stateId: string,
        standing: { isAcknowledged: boolean; isResolved: boolean },
      ) => {
        const answered: SpyInstance<
          typeof OnCallPersonPageAnswer.onRecordStateChanged
        > = jest
          .spyOn(OnCallPersonPageAnswer, "onRecordStateChanged")
          .mockResolvedValue(0);
        jest
          .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
          .mockResolvedValue([] as never);

        await OnCallAcknowledgementTimeout.onRecordStateChanged({
          kind: kindCase.kind,
          recordId: RECORD_ID,
          projectId: PROJECT_ID,
          stateId: new ObjectID(stateId),
          previousStateId: new ObjectID(ACKNOWLEDGED),
          changedByUserId: ANA,
        });

        if (!isHandedOn) {
          // An episode has no pages a person asked for.
          expect(answered).not.toHaveBeenCalled();
          return;
        }

        expect(answered).toHaveBeenCalledTimes(1);
        expect(answered.mock.calls[0]![0]).toEqual({
          kind: kindCase.kind,
          recordId: RECORD_ID,
          projectId: PROJECT_ID,
          changedByUserId: ANA,
          ...standing,
        });
      },
    );
  },
);

describe("a record resolved", () => {
  test("stops every running clock of the record, and starts none", async () => {
    const armed: Array<OnCallDutyPolicyExecutionLog> = [
      runOf({
        id: "7a000000-0000-4000-8000-000000000101",
        policyId: POLICY_A,
        column: "triggeredByIncidentId",
        minutes: 30,
        createdMinutesAgo: 30,
        clockStartedAt: new Date(NOW.getTime() - 60 * 1000),
      }),
      runOf({
        id: "7a000000-0000-4000-8000-000000000102",
        policyId: POLICY_B,
        column: "triggeredByIncidentId",
        minutes: 15,
        createdMinutesAgo: 30,
        clockStartedAt: new Date(NOW.getTime() - 2 * 60 * 1000),
      }),
    ];

    const findBy: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.findBy
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockImplementation((async () => {
        return armed;
      }) as never);

    const stopped: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.stopAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "stopAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(true);

    const started: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "startAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(undefined);

    await OnCallAcknowledgementTimeout.onRecordStateChanged({
      kind: "incident",
      recordId: RECORD_ID,
      projectId: PROJECT_ID,
      stateId: new ObjectID(RESOLVED),
      previousStateId: new ObjectID(ACKNOWLEDGED),
    });

    // Only the runs whose clock runs are read.
    expect(Object.keys(findBy.mock.calls[0]![0].query).sort()).toEqual(
      ["acknowledgementTimeoutStartedAt", "triggeredByIncidentId"].sort(),
    );

    expect(
      stopped.mock.calls.map(
        (
          call: Array<{ executionLogId: ObjectID; expectedStartedAt: Date }>,
        ) => {
          return [
            call[0]!.executionLogId.toString(),
            call[0]!.expectedStartedAt.toISOString(),
          ];
        },
      ),
    ).toEqual([
      [
        armed[0]!.id!.toString(),
        armed[0]!.acknowledgementTimeoutStartedAt!.toISOString(),
      ],
      [
        armed[1]!.id!.toString(),
        armed[1]!.acknowledgementTimeoutStartedAt!.toISOString(),
      ],
    ]);
    expect(started).not.toHaveBeenCalled();
  });

  test("resolved straight from created: no clock starts for it", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockImplementation((async () => {
        return [];
      }) as never);
    const started: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "startAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(undefined);

    await OnCallAcknowledgementTimeout.onRecordStateChanged({
      kind: "alert",
      recordId: RECORD_ID,
      projectId: PROJECT_ID,
      stateId: new ObjectID(RESOLVED),
      previousStateId: new ObjectID(CREATED),
    });

    expect(started).not.toHaveBeenCalled();
  });
});

describe("every policy that paged about the record keeps a clock of its own", () => {
  test("two policies: each starts one, on its own latest run", async () => {
    const runs: Array<OnCallDutyPolicyExecutionLog> = [
      runOf({
        id: "7a000000-0000-4000-8000-000000000101",
        policyId: POLICY_A,
        column: "triggeredByIncidentId",
        minutes: 30,
        createdMinutesAgo: 20,
      }),
      runOf({
        id: "7a000000-0000-4000-8000-000000000102",
        policyId: POLICY_A,
        column: "triggeredByIncidentId",
        minutes: 30,
        createdMinutesAgo: 10,
      }),
      runOf({
        id: "7a000000-0000-4000-8000-000000000201",
        policyId: POLICY_B,
        column: "triggeredByIncidentId",
        minutes: 15,
        createdMinutesAgo: 20,
      }),
    ];

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockImplementation((async (data: { query: Record<string, unknown> }) => {
        const policyId: unknown = data.query["onCallDutyPolicyId"];

        if (policyId instanceof ObjectID) {
          return runs
            .filter((run: OnCallDutyPolicyExecutionLog) => {
              return run.onCallDutyPolicyId!.toString() === policyId.toString();
            })
            .sort(
              (
                a: OnCallDutyPolicyExecutionLog,
                b: OnCallDutyPolicyExecutionLog,
              ) => {
                return b.createdAt!.getTime() - a.createdAt!.getTime();
              },
            );
        }

        return runs;
      }) as never);

    const started: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "startAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(undefined);

    await OnCallAcknowledgementTimeout.onRecordStateChanged({
      kind: "incident",
      recordId: RECORD_ID,
      projectId: PROJECT_ID,
      stateId: new ObjectID(ACKNOWLEDGED),
      previousStateId: new ObjectID(CREATED),
    });

    expect(
      started.mock.calls
        .map((call: Array<{ executionLogId: ObjectID }>) => {
          return call[0]!.executionLogId.toString();
        })
        .sort(),
    ).toEqual(
      [
        "7a000000-0000-4000-8000-000000000102",
        "7a000000-0000-4000-8000-000000000201",
      ].sort(),
    );
  });

  test("a policy that does not page again, or is archived, starts none", async () => {
    const off: OnCallDutyPolicyExecutionLog = runOf({
      id: "7a000000-0000-4000-8000-000000000101",
      policyId: POLICY_A,
      column: "triggeredByIncidentId",
      minutes: null,
      createdMinutesAgo: 20,
    });
    const archived: OnCallDutyPolicyExecutionLog = runOf({
      id: "7a000000-0000-4000-8000-000000000201",
      policyId: POLICY_B,
      column: "triggeredByIncidentId",
      minutes: 30,
      createdMinutesAgo: 20,
    });
    archived.onCallDutyPolicy = policy(30, true);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockImplementation((async () => {
        return [off, archived];
      }) as never);

    const started: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "startAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(undefined);

    await OnCallAcknowledgementTimeout.onRecordStateChanged({
      kind: "incident",
      recordId: RECORD_ID,
      projectId: PROJECT_ID,
      stateId: new ObjectID(ACKNOWLEDGED),
      previousStateId: new ObjectID(CREATED),
    });

    expect(started).not.toHaveBeenCalled();
  });

  test("a record's first state, acknowledged already, starts the clock too", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockImplementation((async () => {
        return [
          runOf({
            id: "7a000000-0000-4000-8000-000000000101",
            policyId: POLICY_A,
            column: "triggeredByIncidentId",
            minutes: 30,
            createdMinutesAgo: 1,
          }),
        ];
      }) as never);

    const started: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "startAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(undefined);

    await OnCallAcknowledgementTimeout.onRecordStateChanged({
      kind: "incident",
      recordId: RECORD_ID,
      projectId: PROJECT_ID,
      stateId: new ObjectID(ACKNOWLEDGED),
    });

    expect(started).toHaveBeenCalledTimes(1);
  });
});

describe("never throws", () => {
  test("a state change whose states cannot be read is logged and stands", async () => {
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockImplementation((async () => {
        throw new Error("connection reset");
      }) as never);

    await expect(
      OnCallAcknowledgementTimeout.onRecordStateChanged({
        kind: "incident",
        recordId: RECORD_ID,
        projectId: PROJECT_ID,
        stateId: new ObjectID(ACKNOWLEDGED),
        previousStateId: new ObjectID(CREATED),
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });

  test("an answered page whose run cannot be read is logged, and the answer stands", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockImplementation((async () => {
        throw new Error("connection reset");
      }) as never);

    await expect(
      OnCallAcknowledgementTimeout.onPageAcknowledged({
        executionLogId: ObjectID.generate(),
        acknowledgedAt: NOW,
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });

  test("a worker tick that cannot read the clocks pages nobody, and says so", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findAllBy")
      .mockImplementation((async () => {
        throw new Error("connection reset");
      }) as never);

    await expect(OnCallAcknowledgementTimeout.run(NOW)).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("one clock that fails does not stop the others", async () => {
    const broken: OnCallDutyPolicyExecutionLog = runOf({
      id: "7a000000-0000-4000-8000-000000000101",
      policyId: POLICY_A,
      column: "triggeredByIncidentId",
      minutes: 30,
      createdMinutesAgo: 60,
      clockStartedAt: new Date(NOW.getTime() - 40 * 60 * 1000),
    });
    const notDue: OnCallDutyPolicyExecutionLog = runOf({
      id: "7a000000-0000-4000-8000-000000000201",
      policyId: POLICY_B,
      column: "triggeredByAlertId",
      minutes: 30,
      createdMinutesAgo: 60,
      clockStartedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    });

    const findAllBy: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.findAllBy
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findAllBy")
      .mockImplementation((async () => {
        return [broken, notDue];
      }) as never);

    jest.spyOn(IncidentService, "findOneById").mockImplementation((async () => {
      throw new Error("connection reset");
    }) as never);

    const results: Array<OnCallPageAgainResult> =
      await OnCallAcknowledgementTimeout.run(NOW);

    expect(results).toEqual([
      { runId: notDue.id, outcome: OnCallPageAgainOutcome.NotDue },
    ]);

    // The worker reads only the running clocks, with what it needs of each.
    expect(findAllBy.mock.calls[0]![0].select).toEqual(CLOCK_RUN_SELECT);
    expect(Object.keys(findAllBy.mock.calls[0]![0].query)).toEqual([
      "acknowledgementTimeoutStartedAt",
    ]);
  });
});

describe("whether a page again is over for its people", () => {
  test("answered: over, whatever its record", async () => {
    await expect(
      OnCallAcknowledgementTimeout.getPageAgainOverReason({
        run: { pageAgainNumber: 1, acknowledgedAt: NOW },
        kind: "alert",
        recordId: RECORD_ID,
      }),
    ).resolves.toBe("this page again is acknowledged");
  });

  test("its record resolved: over", async () => {
    KINDS[1]!.readRecord(RESOLVED);

    await expect(
      OnCallAcknowledgementTimeout.getPageAgainOverReason({
        run: { pageAgainNumber: 1 },
        kind: "alert",
        recordId: RECORD_ID,
      }),
    ).resolves.toBe("alert is resolved");
  });

  test("its record gone: over", async () => {
    jest.spyOn(AlertService, "findOneById").mockImplementation((async () => {
      return null;
    }) as never);

    await expect(
      OnCallAcknowledgementTimeout.getPageAgainOverReason({
        run: { pageAgainNumber: 1 },
        kind: "alert",
        recordId: RECORD_ID,
      }),
    ).resolves.toBe("alert is deleted");
  });

  test("its record acknowledged, as it was all along: not over", async () => {
    KINDS[1]!.readRecord(ACKNOWLEDGED);

    await expect(
      OnCallAcknowledgementTimeout.getPageAgainOverReason({
        run: { pageAgainNumber: 1 },
        kind: "alert",
        recordId: RECORD_ID,
      }),
    ).resolves.toBeNull();
  });
});

describe("the record a run pages about", () => {
  test("is read off the run's own column, each kind", () => {
    const columns: Record<string, OnCallTimeoutRecordKind> = {
      triggeredByIncidentId: "incident",
      triggeredByAlertId: "alert",
      triggeredByIncidentEpisodeId: "incident episode",
      triggeredByAlertEpisodeId: "alert episode",
    };

    for (const [column, kind] of Object.entries(columns)) {
      expect(
        OnCallAcknowledgementTimeout.getRunRecord({ [column]: RECORD_ID }),
      ).toEqual({ kind: kind, recordId: RECORD_ID });
    }

    expect(OnCallAcknowledgementTimeout.getRunRecord({})).toBeNull();
  });
});

describe("an answered page of a run whose policy does not page again", () => {
  test("starts no clock", async () => {
    const run: OnCallDutyPolicyExecutionLog = runOf({
      id: "7a000000-0000-4000-8000-000000000101",
      policyId: POLICY_A,
      column: "triggeredByIncidentId",
      minutes: null,
      createdMinutesAgo: 10,
    });

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockImplementation((async () => {
        return run;
      }) as never);

    const started: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "startAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(undefined);

    await OnCallAcknowledgementTimeout.onPageAcknowledged({
      executionLogId: run.id!,
      acknowledgedAt: NOW,
    });

    expect(started).not.toHaveBeenCalled();
  });

  test("a direct page - no policy - starts none either", async () => {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.id = ObjectID.generate();
    run.triggeredByIncidentId = RECORD_ID;
    run.status = OnCallDutyPolicyStatus.Completed;

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockImplementation((async () => {
        return run;
      }) as never);

    const started: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "startAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(undefined);

    await OnCallAcknowledgementTimeout.onPageAcknowledged({
      executionLogId: run.id!,
      acknowledgedAt: NOW,
    });

    expect(started).not.toHaveBeenCalled();
  });
});
