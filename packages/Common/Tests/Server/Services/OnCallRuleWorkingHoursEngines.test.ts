import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOnCallRule from "../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOnCallRule from "../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOnCallRuleService from "../../../Server/Services/AlertEpisodeOnCallRuleService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOnCallRuleService from "../../../Server/Services/IncidentEpisodeOnCallRuleService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import { OnCallRulePagingHold } from "../../../Server/Utils/OnCall/OnCallRulePagingHold";
import ObjectID from "../../../Types/ObjectID";
import { ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE RULE ENGINES HAND BACK WHEN THE POLICIES THEY ADD MAY PAGE.
 *
 * Every alert, incident and episode on-call rule engine merges the policies
 * of the rules a new record matches, and hands back the holds of the ones a
 * rule that pages only during working hours added outside its hours: the
 * record's service passes each to executePolicy, which creates the run
 * waiting (OnCallDutyPolicyRunWait). A rule that pages right away, a rule
 * inside its hours, a policy a right-away rule pages too, and a policy the
 * record had before its rules ran: none of them is held.
 *
 * The hours here are a daily window that opens two hours from now on UTC's
 * clock - or one that opened an hour ago - so the answers hold whenever the
 * suite runs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000001",
);
const POLICY_A: string = "6b000000-0000-4000-8000-00000000000a";
const POLICY_B: string = "6b000000-0000-4000-8000-00000000000b";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

interface EngineCase {
  label: string;
  newRule: () => BaseModel;
  newRecord: () => BaseModel;
  ruleService: { findBy: unknown };
  recordService: { getRepository: unknown };
  stubFeed: () => void;
  apply: (record: BaseModel) => Promise<Map<string, OnCallRulePagingHold>>;
}

function policy(id: string): OnCallDutyPolicy {
  const item: OnCallDutyPolicy = new OnCallDutyPolicy();
  item._id = id;
  return item;
}

function withProject<T extends BaseModel>(record: T): T {
  record.id = ObjectID.generate();
  record.setColumnValue("projectId", PROJECT_ID);
  record.setColumnValue("onCallDutyPolicies", []);
  return record;
}

const ENGINES: Array<EngineCase> = [
  {
    label: "incident on-call rules",
    newRule: (): BaseModel => {
      return new IncidentOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new Incident());
    },
    ruleService: IncidentOnCallRuleService,
    recordService: IncidentService,
    stubFeed: (): void => {
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<Map<string, OnCallRulePagingHold>> => {
      return IncidentOnCallRuleEngineService.applyRulesToIncident(
        record as Incident,
      );
    },
  },
  {
    label: "alert on-call rules",
    newRule: (): BaseModel => {
      return new AlertOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new Alert());
    },
    ruleService: AlertOnCallRuleService,
    recordService: AlertService,
    stubFeed: (): void => {
      jest
        .spyOn(AlertFeedService, "createAlertFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<Map<string, OnCallRulePagingHold>> => {
      return AlertOnCallRuleEngineService.applyRulesToAlert(record as Alert);
    },
  },
  {
    label: "incident episode on-call rules",
    newRule: (): BaseModel => {
      return new IncidentEpisodeOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new IncidentEpisode());
    },
    ruleService: IncidentEpisodeOnCallRuleService,
    recordService: IncidentEpisodeService,
    stubFeed: (): void => {
      jest
        .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<Map<string, OnCallRulePagingHold>> => {
      return IncidentEpisodeOnCallRuleEngineService.applyRulesToEpisode(
        record as IncidentEpisode,
      );
    },
  },
  {
    label: "alert episode on-call rules",
    newRule: (): BaseModel => {
      return new AlertEpisodeOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new AlertEpisode());
    },
    ruleService: AlertEpisodeOnCallRuleService,
    recordService: AlertEpisodeService,
    stubFeed: (): void => {
      jest
        .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<Map<string, OnCallRulePagingHold>> => {
      return AlertEpisodeOnCallRuleEngineService.applyRulesToEpisode(
        record as AlertEpisode,
      );
    },
  },
];

// A whole minute: the hours are minute-precise.
function floorToMinute(time: number): number {
  return Math.floor(time / MINUTE) * MINUTE;
}

// A daily window from one moment's time of day to another's, on UTC's clock.
function dailyWindow(from: number, to: number): RestrictionTimes {
  const hours: RestrictionTimes = new RestrictionTimes();
  hours.restictionType = RestrictionType.Daily;
  hours.dayRestrictionTimes = {
    startTime: new Date(floorToMinute(from)),
    endTime: new Date(floorToMinute(to)),
  };
  return hours;
}

describe.each(ENGINES)("$label", (engine: EngineCase) => {
  function rule(data: {
    policyIds: Array<string>;
    whenToPage?: OnCallRuleWhenToPage | undefined;
    hours?: RestrictionTimes | undefined;
  }): BaseModel {
    const item: BaseModel = engine.newRule();
    item.id = ObjectID.generate();
    item.setColumnValue("name", "Page the platform rota");
    item.setColumnValue(
      "onCallDutyPolicies",
      data.policyIds.map((id: string): OnCallDutyPolicy => {
        return policy(id);
      }),
    );

    if (data.whenToPage) {
      item.setColumnValue("whenToPage", data.whenToPage);
    }

    if (data.hours) {
      item.setColumnValue("workingHours", data.hours);
      item.setColumnValue("workingHoursTimezone", "UTC");
    }

    return item;
  }

  // Hours that open two hours from now.
  function laterToday(): RestrictionTimes {
    return dailyWindow(Date.now() + 2 * HOUR, Date.now() + 3 * HOUR);
  }

  // Hours that opened an hour ago and close in an hour.
  function now(): RestrictionTimes {
    return dailyWindow(Date.now() - HOUR, Date.now() + HOUR);
  }

  function stubRules(rules: Array<BaseModel>): jest.SpiedFunction<() => void> {
    return jest
      .spyOn(engine.ruleService as never, "findBy" as never)
      .mockResolvedValue(rules as never) as unknown as jest.SpiedFunction<
      () => void
    >;
  }

  beforeEach(() => {
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { OnCallDutyPolicy: [POLICY_A, POLICY_B] },
    });

    jest
      .spyOn(engine.recordService as never, "getRepository" as never)
      .mockReturnValue({
        createQueryBuilder: () => {
          return {
            relation: () => {
              return {
                of: () => {
                  return {
                    add: async (): Promise<void> => {
                      return;
                    },
                  };
                },
              };
            },
          };
        },
      } as never);

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([] as never);
    engine.stubFeed();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads when each rule pages along with the rest of it", async () => {
    const findBy: jest.SpiedFunction<() => void> = stubRules([]);

    await engine.apply(engine.newRecord());

    const select: Record<string, unknown> = (
      findBy.mock.calls[0] as unknown as Array<{
        select: Record<string, unknown>;
      }>
    )[0]!.select;

    expect(select["whenToPage"]).toBe(true);
    expect(select["workingHours"]).toBe(true);
    expect(select["workingHoursTimezone"]).toBe(true);
  });

  test("a working-hours rule matched outside its hours holds its policies until they begin", async () => {
    const expected: number = floorToMinute(Date.now() + 2 * HOUR);
    stubRules([
      rule({
        policyIds: [POLICY_A],
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        hours: laterToday(),
      }),
    ]);

    const holds: Map<string, OnCallRulePagingHold> = await engine.apply(
      engine.newRecord(),
    );

    expect([...holds.keys()]).toEqual([POLICY_A]);
    expect(holds.get(POLICY_A)!.pagingStartsAt.getTime()).toBe(expected);
    expect(holds.get(POLICY_A)!.waitingStatusMessage).toMatch(
      new RegExp(
        `^${ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START}paging starts at \\d{2}:\\d{2}`,
      ),
    );
  });

  test("a working-hours rule matched inside its hours pages right away", async () => {
    stubRules([
      rule({
        policyIds: [POLICY_A],
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        hours: now(),
      }),
    ]);

    const holds: Map<string, OnCallRulePagingHold> = await engine.apply(
      engine.newRecord(),
    );

    expect(holds.size).toBe(0);
  });

  test("a right-away rule holds nothing, as rules never did", async () => {
    stubRules([
      rule({
        policyIds: [POLICY_A],
        whenToPage: OnCallRuleWhenToPage.RightAway,
      }),
      rule({ policyIds: [POLICY_B] }),
    ]);

    const record: BaseModel = engine.newRecord();
    const holds: Map<string, OnCallRulePagingHold> = await engine.apply(record);

    expect(holds.size).toBe(0);
    expect(
      (
        (record.getColumnValue("onCallDutyPolicies") as Array<BaseModel>) || []
      ).map((item: BaseModel): string => {
        return item.id!.toString();
      }),
    ).toEqual([POLICY_A, POLICY_B]);
  });

  test("a policy a right-away rule pages too pages right away", async () => {
    stubRules([
      rule({
        policyIds: [POLICY_A, POLICY_B],
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        hours: laterToday(),
      }),
      rule({
        policyIds: [POLICY_B],
        whenToPage: OnCallRuleWhenToPage.RightAway,
      }),
    ]);

    const holds: Map<string, OnCallRulePagingHold> = await engine.apply(
      engine.newRecord(),
    );

    expect([...holds.keys()]).toEqual([POLICY_A]);
  });

  test("a policy the record had before its rules ran pages as it always has", async () => {
    stubRules([
      rule({
        policyIds: [POLICY_A],
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        hours: laterToday(),
      }),
    ]);

    const record: BaseModel = engine.newRecord();
    record.setColumnValue("onCallDutyPolicies", [policy(POLICY_A)]);

    const holds: Map<string, OnCallRulePagingHold> = await engine.apply(record);

    expect(holds.size).toBe(0);
  });
});
