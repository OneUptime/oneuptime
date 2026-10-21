import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AlertEpisodeOnCallRuleEngineService from "../../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertOnCallRuleEngineService from "../../../../Server/Services/AlertOnCallRuleEngineService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeOnCallRuleEngineService from "../../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentOnCallRuleEngineService from "../../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import WaitingRunsOnRecordChange from "../../../../Server/Utils/OnCall/WaitingRunsOnRecordChange";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A RECORD THAT CHANGED, AND ITS RUNS WAITING FOR WORKING HOURS
 * (WaitingRunsOnRecordChange).
 *
 * A P3 alert raised at 02:00 waits for 09:00 on a working-hours rule. Raised
 * to P1 at 03:00, it now matches the P1 rule, which pages right away: its
 * waiting run starts paging now, and says why. Nothing else moves: a run no
 * rule pages now goes on waiting, a record acknowledged or resolved and a
 * run of an archived policy are the worker's to end, and a run the worker
 * starts first is started once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000002");
const PLATFORM: string = "6a000000-0000-4000-8000-0000000000a1";
const PAYMENTS: string = "6a000000-0000-4000-8000-0000000000a2";

function waitingRun(data: {
  id: string;
  policyId: string;
  isArchived?: boolean | undefined;
}): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = new ObjectID(data.id);
  run.projectId = PROJECT_ID;
  run.status = OnCallDutyPolicyStatus.Waiting;
  run.onCallDutyPolicyId = new ObjectID(data.policyId);
  run.triggeredByAlertId = RECORD_ID;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.isArchived = data.isArchived === true;
  run.onCallDutyPolicy = policy;

  return run;
}

const PLATFORM_RUN: OnCallDutyPolicyExecutionLog = waitingRun({
  id: "6a000000-0000-4000-8000-0000000000b1",
  policyId: PLATFORM,
});
const PAYMENTS_RUN: OnCallDutyPolicyExecutionLog = waitingRun({
  id: "6a000000-0000-4000-8000-0000000000b2",
  policyId: PAYMENTS,
});

interface StartCall {
  run: OnCallDutyPolicyExecutionLog;
  now: Date;
  startedEarlyReason?: string | undefined;
}

interface World {
  findQueries: Array<Record<string, unknown>>;
  starts: Array<StartCall>;
  matched: Array<unknown>;
}

/*
 * The runs the record has waiting, whether it is handled, and which policies
 * its matching rules page now - for each kind of record alike.
 */
function stubWorld(data: {
  runs: Array<OnCallDutyPolicyExecutionLog>;
  isHandled?: boolean | undefined;
  pagingNow?: Map<string, Array<string>> | undefined;
  claimWins?: boolean | undefined;
}): World {
  const world: World = { findQueries: [], starts: [], matched: [] };

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<OnCallDutyPolicyExecutionLog>> => {
      world.findQueries.push(findBy.query);
      return data.runs;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "startWaitingRun")
    .mockImplementation((async (call: StartCall): Promise<boolean> => {
      world.starts.push(call);
      return data.claimWins !== false;
    }) as never);

  const pagingNow: Map<string, Array<string>> =
    data.pagingNow || new Map<string, Array<string>>();

  const engines: Array<unknown> = [
    AlertOnCallRuleEngineService,
    IncidentOnCallRuleEngineService,
    AlertEpisodeOnCallRuleEngineService,
    IncidentEpisodeOnCallRuleEngineService,
  ];

  for (const engine of engines) {
    jest
      .spyOn(
        engine as typeof AlertOnCallRuleEngineService,
        "getPoliciesPagingNow",
      )
      .mockImplementation((async (
        record: unknown,
      ): Promise<Map<string, Array<string>>> => {
        world.matched.push(record);
        return pagingNow;
      }) as never);
  }

  const handled: boolean = data.isHandled === true;

  jest
    .spyOn(AlertService, "isAlertAcknowledged")
    .mockResolvedValue(handled as never);
  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockResolvedValue(handled as never);
  jest
    .spyOn(AlertEpisodeService, "isEpisodeAcknowledged")
    .mockResolvedValue(handled as never);
  jest
    .spyOn(IncidentEpisodeService, "isEpisodeAcknowledged")
    .mockResolvedValue(handled as never);

  const withId: <T extends { id?: ObjectID | null; projectId?: ObjectID }>(
    record: T,
  ) => T = <T extends { id?: ObjectID | null; projectId?: ObjectID }>(
    record: T,
  ): T => {
    record.id = RECORD_ID;
    record.projectId = PROJECT_ID;
    return record;
  };

  jest
    .spyOn(AlertService, "findOneById")
    .mockResolvedValue(withId(new Alert()) as never);
  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(withId(new Incident()) as never);
  jest
    .spyOn(AlertEpisodeService, "findOneById")
    .mockResolvedValue(withId(new AlertEpisode()) as never);
  jest
    .spyOn(IncidentEpisodeService, "findOneById")
    .mockResolvedValue(withId(new IncidentEpisode()) as never);

  return world;
}

function pagesNow(policyId: string, ruleNames: Array<string>) {
  return new Map<string, Array<string>>([[policyId, ruleNames]]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a record that changed while some of its runs wait", () => {
  let before: number;

  beforeEach(() => {
    before = Date.now();
  });

  test("an alert raised to a severity a right-away rule pages: its waiting run pages now, and says why", async () => {
    const world: World = stubWorld({
      runs: [PLATFORM_RUN],
      pagingNow: pagesNow(PLATFORM, ["P1 alerts"]),
    });

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(1);

    expect(world.starts).toHaveLength(1);
    expect(world.starts[0]!.run).toBe(PLATFORM_RUN);
    expect(world.starts[0]!.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(world.starts[0]!.startedEarlyReason).toBe(
      'The alert now matches on-call rule "P1 alerts", which pages right away.',
    );
  });

  test("reads only the record's own runs that wait", async () => {
    const world: World = stubWorld({ runs: [PLATFORM_RUN] });

    await WaitingRunsOnRecordChange.startForAlert(RECORD_ID);

    expect(world.findQueries).toEqual([
      {
        triggeredByAlertId: RECORD_ID,
        status: OnCallDutyPolicyStatus.Waiting,
      },
    ]);
  });

  test.each([
    [
      "an incident",
      "triggeredByIncidentId",
      (id: ObjectID): Promise<number> => {
        return WaitingRunsOnRecordChange.startForIncident(id);
      },
      "The incident now matches on-call rule",
    ],
    [
      "an alert episode",
      "triggeredByAlertEpisodeId",
      (id: ObjectID): Promise<number> => {
        return WaitingRunsOnRecordChange.startForAlertEpisode(id);
      },
      "The alert episode now matches on-call rule",
    ],
    [
      "an incident episode",
      "triggeredByIncidentEpisodeId",
      (id: ObjectID): Promise<number> => {
        return WaitingRunsOnRecordChange.startForIncidentEpisode(id);
      },
      "The incident episode now matches on-call rule",
    ],
  ])(
    "%s does the same, by its own runs and in its own words",
    async (
      _label: string,
      runColumn: string,
      start: (id: ObjectID) => Promise<number>,
      words: string,
    ) => {
      const world: World = stubWorld({
        runs: [PLATFORM_RUN],
        pagingNow: pagesNow(PLATFORM, ["SEV1"]),
      });

      await expect(start(RECORD_ID)).resolves.toBe(1);

      expect(world.findQueries[0]).toEqual({
        [runColumn]: RECORD_ID,
        status: OnCallDutyPolicyStatus.Waiting,
      });
      expect(world.starts[0]!.startedEarlyReason).toBe(
        `${words} "SEV1", which pages right away.`,
      );
    },
  );

  test("of two waiting runs, only the one whose policy a rule pages now starts", async () => {
    const world: World = stubWorld({
      runs: [PLATFORM_RUN, PAYMENTS_RUN],
      pagingNow: pagesNow(PAYMENTS, ["Payments P1", "Everything critical"]),
    });

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(1);

    expect(world.starts.map((call: StartCall): unknown => call.run)).toEqual([
      PAYMENTS_RUN,
    ]);
    expect(world.starts[0]!.startedEarlyReason).toBe(
      'The alert now matches on-call rules "Payments P1" and "Everything critical", which page right away.',
    );
  });

  test("a change no right-away rule matches: every run goes on waiting", async () => {
    const world: World = stubWorld({ runs: [PLATFORM_RUN] });

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(0);

    expect(world.matched).toHaveLength(1);
    expect(world.starts).toEqual([]);
  });

  test("a record with no run waiting: nothing is read or matched", async () => {
    const world: World = stubWorld({ runs: [] });

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(0);

    expect(world.matched).toEqual([]);
    expect(AlertService.findOneById).not.toHaveBeenCalled();
    expect(AlertService.isAlertAcknowledged).not.toHaveBeenCalled();
  });

  test("a record acknowledged or resolved needs nobody: its runs are the worker's to end", async () => {
    const world: World = stubWorld({
      runs: [PLATFORM_RUN],
      isHandled: true,
      pagingNow: pagesNow(PLATFORM, ["P1 alerts"]),
    });

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(0);

    expect(world.matched).toEqual([]);
    expect(world.starts).toEqual([]);
  });

  test("a run whose policy was archived is the worker's to end, unpaged", async () => {
    const world: World = stubWorld({
      runs: [
        waitingRun({
          id: "6a000000-0000-4000-8000-0000000000b3",
          policyId: PLATFORM,
          isArchived: true,
        }),
      ],
      pagingNow: pagesNow(PLATFORM, ["P1 alerts"]),
    });

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(0);

    expect(world.starts).toEqual([]);
  });

  test("a run the worker starts first is not started again: the claim decides", async () => {
    const world: World = stubWorld({
      runs: [PLATFORM_RUN],
      pagingNow: pagesNow(PLATFORM, ["P1 alerts"]),
      claimWins: false,
    });

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(0);

    // Asked once; the claim was lost, so it paged nobody twice.
    expect(world.starts).toHaveLength(1);
  });

  test("a run that fails to start is logged, and the others still start", async () => {
    stubWorld({
      runs: [PLATFORM_RUN, PAYMENTS_RUN],
      pagingNow: new Map<string, Array<string>>([
        [PLATFORM, ["P1 alerts"]],
        [PAYMENTS, ["P1 alerts"]],
      ]),
    });

    let calls: number = 0;
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "startWaitingRun")
      .mockImplementation((async (): Promise<boolean> => {
        calls++;

        if (calls === 1) {
          throw new Error("The database went away.");
        }

        return true;
      }) as never);

    await expect(
      WaitingRunsOnRecordChange.startForAlert(RECORD_ID),
    ).resolves.toBe(1);
    expect(calls).toBe(2);
  });
});

describe("whether an update changed what on-call rules read", () => {
  const nothing: { textColumns: []; labels: false; enableReminders: false } = {
    textColumns: [],
    labels: false,
    enableReminders: false,
  };

  test.each([
    ["the severity", { isSeverityChanged: true }],
    ["the labels", { fieldChanges: { ...nothing, labels: true } }],
    ["the title", { fieldChanges: { ...nothing, textColumns: ["title"] } }],
    [
      "the description",
      { fieldChanges: { ...nothing, textColumns: ["description"] } },
    ],
    ["the monitors", { isMonitorChanged: true }],
  ])("%s: yes", (_label: string, change: Record<string, unknown>) => {
    expect(
      WaitingRunsOnRecordChange.isRuleInputChanged({
        isSeverityChanged: false,
        fieldChanges: nothing,
        isMonitorChanged: false,
        ...change,
      } as never),
    ).toBe(true);
  });

  test("the root cause, the remediation notes or the reminders switch alone: no", () => {
    expect(
      WaitingRunsOnRecordChange.isRuleInputChanged({
        isSeverityChanged: false,
        fieldChanges: {
          textColumns: ["rootCause", "remediationNotes"],
          labels: false,
          enableReminders: true,
        } as never,
        isMonitorChanged: false,
      }),
    ).toBe(false);
  });

  test("nothing changed - every field written back as it was: no", () => {
    expect(
      WaitingRunsOnRecordChange.isRuleInputChanged({
        isSeverityChanged: false,
        fieldChanges: nothing,
        isMonitorChanged: false,
      }),
    ).toBe(false);
  });

  test("an episode's update that writes its severity, labels, title or description: yes; anything else: no", () => {
    const severityKeys: Array<string> = ["alertSeverityId", "alertSeverity"];

    for (const key of [
      "alertSeverityId",
      "alertSeverity",
      "labels",
      "title",
      "description",
    ]) {
      expect(
        WaitingRunsOnRecordChange.isRuleInputWritten({
          written: { [key]: "x" },
          severityKeys: severityKeys,
        }),
      ).toBe(true);
    }

    expect(
      WaitingRunsOnRecordChange.isRuleInputWritten({
        written: { rootCause: "x", isVisibleOnStatusPage: true },
        severityKeys: severityKeys,
      }),
    ).toBe(false);
  });
});
