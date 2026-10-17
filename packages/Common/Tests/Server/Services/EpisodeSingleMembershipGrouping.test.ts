import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertGroupingRuleService from "../../../Server/Services/AlertGroupingRuleService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentGroupingRuleService from "../../../Server/Services/IncidentGroupingRuleService";
import { RecordInAnotherEpisodeException } from "../../../Server/Utils/Episode/EpisodeSingleMembershipCheck";
import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertEpisodeMemberAddedBy } from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentEpisodeMemberAddedBy } from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * THE GROUPING RULES AND ONE EPISODE PER RECORD (EpisodeSingleMembership).
 *
 * A grouping rule groups a new incident (or alert) as it is created, and
 * never one that already names an episode. Between its creation and its
 * grouping, though, a workflow or a person can put it in an episode. In a
 * project that allows a record in only one episode, the rule then leaves it
 * where it is: the engine asks, under its rule's lock and before it looks
 * for an episode, whether one holds the record - so no episode is reopened,
 * and none is opened (with its on-call policies paging people), for a
 * record that could not join it. And should the record still be put in
 * another episode between that question and the add, the member's create
 * refuses it (RecordInAnotherEpisodeException), which the engine takes as
 * it takes "already a member": the record stays where it is.
 *
 * The engines' own reads and writes are stand-ins; the decisions are
 * theirs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194e9a1-6a0e-4b00-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0194e9a1-6a0e-4b00-8000-0000000000d1",
);
const RULE_ID: ObjectID = new ObjectID("0194e9a1-6a0e-4b00-8000-0000000000c1");
const HOLDING_EPISODE_ID: ObjectID = new ObjectID(
  "0194e9a1-6a0e-4b00-8000-0000000000e9",
);
const OPEN_EPISODE_ID: ObjectID = new ObjectID(
  "0194e9a1-6a0e-4b00-8000-0000000000e1",
);
const RESOLVED_EPISODE_ID: ObjectID = new ObjectID(
  "0194e9a1-6a0e-4b00-8000-0000000000e2",
);
const NEW_EPISODE_ID: ObjectID = new ObjectID(
  "0194e9a1-6a0e-4b00-8000-0000000000e3",
);

type AnyFunction = (...args: Array<unknown>) => unknown;

interface Engine {
  name: string;
  engine: Record<string, AnyFunction>;
  memberService: Record<string, AnyFunction>;
  ruleService: unknown;
  episodeService: unknown;
  matchMethod: string;
  addMethod: string;
  recordIdKey: "incidentId" | "alertId";
  addedByRule: string;
  newRecord: () => Incident | Alert;
  newRule: () => IncidentGroupingRule | AlertGroupingRule;
  group: (
    record: Incident | Alert,
  ) => Promise<{ grouped: boolean; episodeId?: ObjectID }>;
}

const ENGINES: Array<Engine> = [
  {
    name: "incident",
    engine: IncidentGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    memberService: IncidentEpisodeMemberService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: IncidentGroupingRuleService,
    episodeService: IncidentEpisodeService,
    matchMethod: "doesIncidentMatchRule",
    addMethod: "addIncidentToEpisode",
    recordIdKey: "incidentId",
    addedByRule: IncidentEpisodeMemberAddedBy.Rule,
    newRecord: (): Incident => {
      const incident: Incident = new Incident();
      incident._id = RECORD_ID.toString();
      incident.projectId = PROJECT_ID;
      return incident;
    },
    newRule: (): IncidentGroupingRule => {
      const rule: IncidentGroupingRule = new IncidentGroupingRule();
      rule._id = RULE_ID.toString();
      rule.enableReopenWindow = true;
      rule.reopenWindowMinutes = 30;
      return rule;
    },
    group: (
      record: Incident | Alert,
    ): Promise<{ grouped: boolean; episodeId?: ObjectID }> => {
      return IncidentGroupingEngineService.processIncident(record as Incident);
    },
  },
  {
    name: "alert",
    engine: AlertGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    memberService: AlertEpisodeMemberService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: AlertGroupingRuleService,
    episodeService: AlertEpisodeService,
    matchMethod: "doesAlertMatchRule",
    addMethod: "addAlertToEpisode",
    recordIdKey: "alertId",
    addedByRule: AlertEpisodeMemberAddedBy.Rule,
    newRecord: (): Alert => {
      const alert: Alert = new Alert();
      alert._id = RECORD_ID.toString();
      alert.projectId = PROJECT_ID;
      return alert;
    },
    newRule: (): AlertGroupingRule => {
      const rule: AlertGroupingRule = new AlertGroupingRule();
      rule._id = RULE_ID.toString();
      rule.enableReopenWindow = true;
      rule.reopenWindowMinutes = 30;
      return rule;
    },
    group: (
      record: Incident | Alert,
    ): Promise<{ grouped: boolean; episodeId?: ObjectID }> => {
      return AlertGroupingEngineService.processAlert(record as Alert);
    },
  },
];

// The order things happened in, as the stand-ins saw them.
let steps: Array<string>;

/*
 * The project has one rule. `episodes` says whether an episode of it is
 * open, recently resolved, both or neither; `holding` which episode holds
 * the record - null when none does, or when the project allows several.
 */
function stubEngine(
  engine: Engine,
  data: {
    matches?: boolean;
    holding: ObjectID | null;
    episodes: { open: boolean; recentlyResolved: boolean };
  },
): void {
  jest
    .spyOn(engine.ruleService as Record<string, AnyFunction>, "findBy")
    .mockResolvedValue([engine.newRule()] as never);
  jest
    .spyOn(engine.engine, engine.matchMethod)
    .mockResolvedValue((data.matches !== false) as never);
  jest
    .spyOn(engine.engine, "buildGroupingKey")
    .mockResolvedValue("checkout" as never);
  jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
    steps.push("lock");
    return { key: "checkout" };
  }) as never);
  jest.spyOn(Semaphore, "release").mockImplementation((async () => {
    steps.push("release");
  }) as never);

  jest
    .spyOn(engine.memberService, "findHoldingEpisodeId")
    .mockImplementation((async () => {
      steps.push("holding");
      return data.holding;
    }) as never);

  jest
    .spyOn(engine.engine, "findMatchingActiveEpisode")
    .mockImplementation((async () => {
      steps.push("find open");
      return data.episodes.open ? { id: OPEN_EPISODE_ID } : null;
    }) as never);
  jest
    .spyOn(engine.engine, "findRecentlyResolvedEpisode")
    .mockImplementation((async () => {
      steps.push("find resolved");
      return data.episodes.recentlyResolved
        ? { id: RESOLVED_EPISODE_ID }
        : null;
    }) as never);
  jest
    .spyOn(engine.engine, "createNewEpisode")
    .mockImplementation((async () => {
      steps.push("open");
      return { id: NEW_EPISODE_ID };
    }) as never);
  jest.spyOn(engine.engine, engine.addMethod).mockImplementation((async (
    _record: unknown,
    episodeId: unknown,
  ) => {
    steps.push(`join ${String(episodeId)}`);
  }) as never);
  jest
    .spyOn(
      engine.episodeService as Record<string, AnyFunction>,
      "reopenEpisode",
    )
    .mockImplementation((async () => {
      steps.push("reopen");
    }) as never);
  jest
    .spyOn(
      engine.episodeService as Record<string, AnyFunction>,
      "updateEpisodeSeverity",
    )
    .mockResolvedValue(undefined as never);
}

beforeEach(() => {
  steps = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ENGINES)("the $name grouping engine", (engine: Engine) => {
  test("a record an episode holds already is left in it: nothing is found, reopened or opened for it", async () => {
    stubEngine(engine, {
      holding: HOLDING_EPISODE_ID,
      episodes: { open: true, recentlyResolved: true },
    });

    const result: { grouped: boolean; episodeId?: ObjectID } =
      await engine.group(engine.newRecord());

    expect(result.grouped).toBe(true);
    expect(String(result.episodeId)).toBe(HOLDING_EPISODE_ID.toString());
    // Asked under the rule's lock, which is let go again.
    expect(steps).toEqual(["lock", "holding", "release"]);
  });

  test("it asks about the record itself, in its own project", async () => {
    stubEngine(engine, {
      holding: HOLDING_EPISODE_ID,
      episodes: { open: true, recentlyResolved: false },
    });

    await engine.group(engine.newRecord());

    const asked: Record<string, unknown> = jest.mocked(
      engine.memberService["findHoldingEpisodeId"]!,
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(String(asked["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(asked[engine.recordIdKey])).toBe(RECORD_ID.toString());
  });

  test("a record no episode holds joins its rule's open episode, as before", async () => {
    stubEngine(engine, {
      holding: null,
      episodes: { open: true, recentlyResolved: true },
    });

    const result: { grouped: boolean; episodeId?: ObjectID } =
      await engine.group(engine.newRecord());

    expect(String(result.episodeId)).toBe(OPEN_EPISODE_ID.toString());
    expect(steps).toEqual([
      "lock",
      "holding",
      "find open",
      `join ${OPEN_EPISODE_ID.toString()}`,
      "release",
    ]);
  });

  test("a record no episode holds reopens a recently resolved episode, as before", async () => {
    stubEngine(engine, {
      holding: null,
      episodes: { open: false, recentlyResolved: true },
    });

    await engine.group(engine.newRecord());

    expect(steps).toContain("reopen");
    expect(steps).toContain(`join ${RESOLVED_EPISODE_ID.toString()}`);
  });

  test("a record no episode holds opens a new episode, as before", async () => {
    stubEngine(engine, {
      holding: null,
      episodes: { open: false, recentlyResolved: false },
    });

    const result: { grouped: boolean; episodeId?: ObjectID } =
      await engine.group(engine.newRecord());

    expect(String(result.episodeId)).toBe(NEW_EPISODE_ID.toString());
    expect(steps).toContain("open");
  });

  test("a record no rule matches is not asked about at all", async () => {
    stubEngine(engine, {
      matches: false,
      holding: HOLDING_EPISODE_ID,
      episodes: { open: true, recentlyResolved: true },
    });

    const result: { grouped: boolean } = await engine.group(engine.newRecord());

    expect(result.grouped).toBe(false);
    expect(steps).toEqual([]);
  });
});

describe.each(ENGINES)(
  "the $name grouping engine adding a record to an episode",
  (engine: Engine) => {
    function addToEpisode(): Promise<unknown> {
      return (
        engine.engine[engine.addMethod] as unknown as (
          ...args: Array<unknown>
        ) => Promise<unknown>
      ).call(
        engine.engine,
        engine.newRecord(),
        OPEN_EPISODE_ID,
        engine.addedByRule,
        RULE_ID,
      );
    }

    test("one put in another episode a moment ago stays there: no error", async () => {
      jest
        .spyOn(engine.memberService, "create")
        .mockRejectedValue(
          new RecordInAnotherEpisodeException("in another episode") as never,
        );

      await expect(addToEpisode()).resolves.toBeUndefined();
    });

    test("one in the episode already stays as it is: no error, as before", async () => {
      jest
        .spyOn(engine.memberService, "create")
        .mockRejectedValue(
          new Error("Incident is already a member of this episode") as never,
        );

      await expect(addToEpisode()).resolves.toBeUndefined();
    });

    test("any other failure is still a failure", async () => {
      jest
        .spyOn(engine.memberService, "create")
        .mockRejectedValue(new Error("database hiccup") as never);

      await expect(addToEpisode()).rejects.toThrow("database hiccup");
    });

    test("the member is the rule's, made as OneUptime", async () => {
      jest.spyOn(engine.memberService, "create").mockResolvedValue({} as never);

      await addToEpisode();

      const createBy: Record<string, unknown> = jest.mocked(
        engine.memberService["create"]!,
      ).mock.calls[0]![0] as Record<string, unknown>;
      const data: Record<string, unknown> = createBy["data"] as Record<
        string,
        unknown
      >;

      expect(createBy["props"]).toEqual({ isRoot: true });
      expect(data["addedBy"]).toBe(engine.addedByRule);
      expect(String(data[engine.recordIdKey])).toBe(RECORD_ID.toString());
    });
  },
);
