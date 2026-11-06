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
import { OnCallRulesPaging } from "../../../Server/Utils/OnCall/OnCallRulePageAs";
import AiFirstResponderEligibility from "../../../Server/Utils/AI/FirstResponder/AiFirstResponderEligibility";
import ObjectID from "../../../Types/ObjectID";
import OnCallPageAs from "../../../Types/OnCallDutyPolicy/OnCallPageAs";
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
 * AN ON-CALL RULE PAGES ITS POLICIES AS RESPONDERS OR AS OBSERVERS
 * (OnCallPageAs, OnCallRulePageAs).
 *
 * Every alert, incident and episode rule engine adds the responder policies
 * a new record matches to the record, as it always has, and hands the
 * observer policies back beside it: the record's service pages each by a
 * run of its own that pages as observers. A record two rules page the same
 * policy for pages it as responders, and a policy the record has already
 * responds to it - it is not paged again as observers. Holds apply to both.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000001",
);
const POLICY_A: string = "6c000000-0000-4000-8000-00000000000a";
const POLICY_B: string = "6c000000-0000-4000-8000-00000000000b";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

interface EngineCase {
  label: string;
  newRule: () => BaseModel;
  newRecord: () => BaseModel;
  ruleService: { findBy: unknown };
  recordService: { getRepository: unknown };
  stubFeed: () => jest.SpiedFunction<(...args: Array<unknown>) => unknown>;
  apply: (record: BaseModel) => Promise<OnCallRulesPaging>;
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

function spyFeed(
  service: unknown,
  method: string,
): jest.SpiedFunction<(...args: Array<unknown>) => unknown> {
  return jest
    .spyOn(service as never, method as never)
    .mockResolvedValue(undefined as never) as unknown as jest.SpiedFunction<
    (...args: Array<unknown>) => unknown
  >;
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
    stubFeed: () => {
      return spyFeed(IncidentFeedService, "createIncidentFeedItem");
    },
    apply: (record: BaseModel): Promise<OnCallRulesPaging> => {
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
    stubFeed: () => {
      return spyFeed(AlertFeedService, "createAlertFeedItem");
    },
    apply: (record: BaseModel): Promise<OnCallRulesPaging> => {
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
    stubFeed: () => {
      return spyFeed(
        IncidentEpisodeFeedService,
        "createIncidentEpisodeFeedItem",
      );
    },
    apply: (record: BaseModel): Promise<OnCallRulesPaging> => {
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
    stubFeed: () => {
      return spyFeed(AlertEpisodeFeedService, "createAlertEpisodeFeedItem");
    },
    apply: (record: BaseModel): Promise<OnCallRulesPaging> => {
      return AlertEpisodeOnCallRuleEngineService.applyRulesToEpisode(
        record as AlertEpisode,
      );
    },
  },
];

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

function policyIdsOf(record: BaseModel): Array<string> {
  return (
    (record.getColumnValue("onCallDutyPolicies") as
      | Array<OnCallDutyPolicy>
      | undefined) || []
  ).map((item: OnCallDutyPolicy): string => {
    return item.id?.toString() || "";
  });
}

describe.each(ENGINES)("$label", (engine: EngineCase) => {
  let attached: Array<string> = [];
  let feed: jest.SpiedFunction<(...args: Array<unknown>) => unknown>;

  function rule(data: {
    name: string;
    policyIds: Array<string>;
    pageAs?: OnCallPageAs | undefined;
    hours?: RestrictionTimes | undefined;
  }): BaseModel {
    const item: BaseModel = engine.newRule();
    item.id = ObjectID.generate();
    item.setColumnValue("name", data.name);
    item.setColumnValue(
      "onCallDutyPolicies",
      data.policyIds.map((id: string): OnCallDutyPolicy => {
        return policy(id);
      }),
    );

    if (data.pageAs) {
      item.setColumnValue("pageAs", data.pageAs);
    }

    if (data.hours) {
      item.setColumnValue("whenToPage", OnCallRuleWhenToPage.WorkingHours);
      item.setColumnValue("workingHours", data.hours);
      item.setColumnValue("workingHoursTimezone", "UTC");
    }

    return item;
  }

  function stubRules(
    rules: Array<BaseModel>,
  ): jest.SpiedFunction<(...args: Array<unknown>) => unknown> {
    return jest
      .spyOn(engine.ruleService as never, "findBy" as never)
      .mockResolvedValue(rules as never) as unknown as jest.SpiedFunction<
      (...args: Array<unknown>) => unknown
    >;
  }

  function feedMarkdown(): string {
    const call: Array<unknown> | undefined = feed.mock.calls[0];

    return String(
      (call?.[0] as { feedInfoInMarkdown?: string } | undefined)
        ?.feedInfoInMarkdown || "",
    );
  }

  beforeEach(() => {
    attached = [];

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
                    add: async (ids: unknown): Promise<void> => {
                      attached.push(
                        ...(Array.isArray(ids) ? ids : [ids]).map(
                          (id: unknown): string => {
                            return String(id);
                          },
                        ),
                      );
                    },
                  };
                },
              };
            },
          };
        },
      } as never);

    const named: Array<OnCallDutyPolicy> = [
      [POLICY_A, "Platform on-call"],
      [POLICY_B, "Oversight on-call"],
    ].map(([id, name]: Array<string>): OnCallDutyPolicy => {
      const item: OnCallDutyPolicy = policy(id!);
      item.name = name!;
      return item;
    });

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue(named as never);

    feed = engine.stubFeed();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads what each rule pages as along with the rest of it", async () => {
    const findBy: jest.SpiedFunction<(...args: Array<unknown>) => unknown> =
      stubRules([]);

    await engine.apply(engine.newRecord());

    const select: Record<string, unknown> = (
      findBy.mock.calls[0] as unknown as Array<{
        select: Record<string, unknown>;
      }>
    )[0]!.select;

    expect(select["pageAs"]).toBe(true);
  });

  test("a rule that pages responders adds its policies to the record, as rules always have", async () => {
    stubRules([rule({ name: "Platform", policyIds: [POLICY_A] })]);

    const record: BaseModel = engine.newRecord();
    const paging: OnCallRulesPaging = await engine.apply(record);

    expect(paging.addedPolicyIds).toEqual([POLICY_A]);
    expect(paging.observerPolicyIds).toEqual([]);
    expect(policyIdsOf(record)).toEqual([POLICY_A]);
    expect(attached).toEqual([POLICY_A]);
  });

  test("a rule set to Responders reads as one with nothing set", async () => {
    stubRules([
      rule({
        name: "Platform",
        policyIds: [POLICY_A],
        pageAs: OnCallPageAs.Responders,
      }),
    ]);

    const paging: OnCallRulesPaging = await engine.apply(engine.newRecord());

    expect(paging.addedPolicyIds).toEqual([POLICY_A]);
    expect(paging.observerPolicyIds).toEqual([]);
  });

  test("a rule that pages observers hands its policies back, and leaves the record's own policies alone", async () => {
    stubRules([
      rule({
        name: "Sev 1: oversight observes",
        policyIds: [POLICY_B],
        pageAs: OnCallPageAs.Observers,
      }),
    ]);

    const record: BaseModel = engine.newRecord();
    const paging: OnCallRulesPaging = await engine.apply(record);

    expect(paging.observerPolicyIds).toEqual([POLICY_B]);
    expect(paging.addedPolicyIds).toEqual([]);
    // Its on-call policies are the ones that respond to it.
    expect(policyIdsOf(record)).toEqual([]);
    expect(attached).toEqual([]);
  });

  test("responders and observers side by side: each policy as its rule says", async () => {
    stubRules([
      rule({ name: "Platform", policyIds: [POLICY_A] }),
      rule({
        name: "Oversight observes",
        policyIds: [POLICY_B],
        pageAs: OnCallPageAs.Observers,
      }),
    ]);

    const record: BaseModel = engine.newRecord();
    const paging: OnCallRulesPaging = await engine.apply(record);

    expect(paging.addedPolicyIds).toEqual([POLICY_A]);
    expect(paging.observerPolicyIds).toEqual([POLICY_B]);
    expect(policyIdsOf(record)).toEqual([POLICY_A]);
  });

  test.each([
    ["the observer rule first", true],
    ["the responder rule first", false],
  ])(
    "a policy one rule pages as observers and another as responders pages responders (%s)",
    async (_name: string, observerFirst: boolean) => {
      const observerRule: BaseModel = rule({
        name: "Oversight observes",
        policyIds: [POLICY_A],
        pageAs: OnCallPageAs.Observers,
      });
      const responderRule: BaseModel = rule({
        name: "Oversight responds",
        policyIds: [POLICY_A],
      });

      stubRules(
        observerFirst
          ? [observerRule, responderRule]
          : [responderRule, observerRule],
      );

      const paging: OnCallRulesPaging = await engine.apply(engine.newRecord());

      expect(paging.addedPolicyIds).toEqual([POLICY_A]);
      expect(paging.observerPolicyIds).toEqual([]);
    },
  );

  test("a policy the record has already responds to it: it is not paged again as observers", async () => {
    stubRules([
      rule({
        name: "Oversight observes",
        policyIds: [POLICY_A],
        pageAs: OnCallPageAs.Observers,
      }),
    ]);

    const record: BaseModel = engine.newRecord();
    record.setColumnValue("onCallDutyPolicies", [policy(POLICY_A)]);

    const paging: OnCallRulesPaging = await engine.apply(record);

    expect(paging.observerPolicyIds).toEqual([]);
    expect(paging.addedPolicyIds).toEqual([]);
    expect(feed).not.toHaveBeenCalled();
  });

  test("an observer rule that pages only during working hours holds its policy, as a responder rule would", async () => {
    stubRules([
      rule({
        name: "Oversight observes in hours",
        policyIds: [POLICY_B],
        pageAs: OnCallPageAs.Observers,
        hours: dailyWindow(Date.now() + 2 * HOUR, Date.now() + 3 * HOUR),
      }),
    ]);

    const paging: OnCallRulesPaging = await engine.apply(engine.newRecord());

    expect(paging.observerPolicyIds).toEqual([POLICY_B]);
    expect([...paging.holds.keys()]).toEqual([POLICY_B]);
    expect(
      paging.holds.get(POLICY_B)!.pagingStartsAt.getTime(),
    ).toBeGreaterThan(Date.now());
  });

  test("the feed names the policies it attached and the ones it pages as observers", async () => {
    stubRules([
      rule({ name: "Platform", policyIds: [POLICY_A] }),
      rule({
        name: "Oversight observes",
        policyIds: [POLICY_B],
        pageAs: OnCallPageAs.Observers,
      }),
    ]);

    await engine.apply(engine.newRecord());

    expect(feed).toHaveBeenCalledTimes(1);

    const markdown: string = feedMarkdown();

    expect(markdown).toContain("Attached the following on-call policy to the");
    expect(markdown).toContain("- Platform on-call");
    expect(markdown).toContain(
      "Paging the following on-call policy as observers",
    );
    expect(markdown).toContain("- Oversight on-call");
    // The two lists, in that order.
    expect(markdown.indexOf("Platform on-call")).toBeLessThan(
      markdown.indexOf("Oversight on-call"),
    );
  });

  test("a feed that only pages observers says nothing was attached", async () => {
    stubRules([
      rule({
        name: "Oversight observes",
        policyIds: [POLICY_B],
        pageAs: OnCallPageAs.Observers,
      }),
    ]);

    await engine.apply(engine.newRecord());

    const markdown: string = feedMarkdown();

    expect(markdown).not.toContain("Attached the following");
    expect(markdown).toContain("as observers");
    expect(markdown).toContain("- Oversight on-call");
  });
});

describe("incident on-call rules that run again on a change (IncidentRulesOnChange)", () => {
  let feed: jest.SpiedFunction<(...args: Array<unknown>) => unknown>;

  beforeEach(() => {
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { OnCallDutyPolicy: [POLICY_A, POLICY_B] },
    });

    jest.spyOn(IncidentService, "getRepository").mockReturnValue({
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

    const named: OnCallDutyPolicy = policy(POLICY_A);
    named.name = "Oversight on-call";

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([named] as never);

    feed = spyFeed(IncidentFeedService, "createIncidentFeedItem");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function incident(): Incident {
    return withProject(new Incident());
  }

  test("its feed says the rule now matches the incident, and why", async () => {
    const item: IncidentOnCallRule = new IncidentOnCallRule();
    item.id = ObjectID.generate();
    item.name = "Sev 1: oversight observes";
    item.onCallDutyPolicies = [policy(POLICY_A)];
    item.pageAs = OnCallPageAs.Observers;

    jest
      .spyOn(IncidentOnCallRuleService, "findBy")
      .mockResolvedValue([item] as never);

    await IncidentOnCallRuleEngineService.applyRulesToIncident(
      incident(),
      "its severity changed",
    );

    const markdown: string = String(
      (feed.mock.calls[0]?.[0] as { feedInfoInMarkdown?: string })
        .feedInfoInMarkdown,
    );

    expect(markdown).toContain(
      "The incident now matches it: its severity changed.",
    );
  });

  test("a rule set to After OneUptime AI pages right away: OneUptime AI responds first to new incidents only", async () => {
    const item: IncidentOnCallRule = new IncidentOnCallRule();
    item.id = ObjectID.generate();
    item.name = "Sev 1 after AI";
    item.onCallDutyPolicies = [policy(POLICY_A)];
    item.whenToPage = OnCallRuleWhenToPage.AfterOneUptimeAI;

    jest
      .spyOn(IncidentOnCallRuleService, "findBy")
      .mockResolvedValue([item] as never);

    const decide: jest.SpiedFunction<
      typeof AiFirstResponderEligibility.decideForIncident
    > = jest.spyOn(AiFirstResponderEligibility, "decideForIncident");

    const paging: OnCallRulesPaging =
      await IncidentOnCallRuleEngineService.applyRulesToIncident(
        incident(),
        "its labels changed",
      );

    expect(decide).not.toHaveBeenCalled();
    expect(paging.addedPolicyIds).toEqual([POLICY_A]);
    expect(paging.holds.size).toBe(0);
  });
});
