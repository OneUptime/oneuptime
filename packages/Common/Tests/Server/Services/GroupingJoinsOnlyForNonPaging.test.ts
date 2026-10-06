import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertGroupingRuleService from "../../../Server/Services/AlertGroupingRuleService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentGroupingRuleService from "../../../Server/Services/IncidentGroupingRuleService";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
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
 * GROUPING NEVER OPENS AN EPISODE FOR A RECORD THAT PAGES NOBODY.
 *
 * An episode a grouping rule opens starts in the created state and runs its
 * own on-call policies; one it reopens goes back to the created state. So an
 * incident or alert created already acknowledged (Common/Utils/
 * StartingStage), which pages nobody, is grouped with mayOpenEpisode: false:
 *
 *   - it joins an episode of its rule that is open, as any record does;
 *   - with none open, it stays on its own - a recently resolved episode is
 *     not reopened for it, and no new episode is opened for it.
 *
 * Without the option - every other caller, and every live record - a rule
 * reopens and opens episodes exactly as before.
 *
 * The engines' own reads and writes are stand-ins; the decision is theirs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000d1",
);
const RULE_ID: ObjectID = new ObjectID("0193c0de-5a7e-4abc-8def-0000000000c1");
const OPEN_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000e1",
);
const RESOLVED_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000e2",
);
const NEW_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000e3",
);

type AnyFunction = (...args: Array<unknown>) => unknown;

interface Engine {
  name: string;
  engine: Record<string, AnyFunction>;
  ruleService: unknown;
  episodeService: unknown;
  matchMethod: string;
  addMethod: string;
  newRecord: () => Incident | Alert;
  newRule: () => IncidentGroupingRule | AlertGroupingRule;
  group: (
    record: Incident | Alert,
    options?: { mayOpenEpisode?: boolean | undefined },
  ) => Promise<{ grouped: boolean; episodeId?: ObjectID }>;
}

const ENGINES: Array<Engine> = [
  {
    name: "an incident",
    engine: IncidentGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: IncidentGroupingRuleService,
    episodeService: IncidentEpisodeService,
    matchMethod: "doesIncidentMatchRule",
    addMethod: "addIncidentToEpisode",
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
      options?: { mayOpenEpisode?: boolean | undefined },
    ): Promise<{ grouped: boolean; episodeId?: ObjectID }> => {
      return options
        ? IncidentGroupingEngineService.processIncident(
            record as Incident,
            options,
          )
        : IncidentGroupingEngineService.processIncident(record as Incident);
    },
  },
  {
    name: "an alert",
    engine: AlertGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: AlertGroupingRuleService,
    episodeService: AlertEpisodeService,
    matchMethod: "doesAlertMatchRule",
    addMethod: "addAlertToEpisode",
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
      options?: { mayOpenEpisode?: boolean | undefined },
    ): Promise<{ grouped: boolean; episodeId?: ObjectID }> => {
      return options
        ? AlertGroupingEngineService.processAlert(record as Alert, options)
        : AlertGroupingEngineService.processAlert(record as Alert);
    },
  },
];

interface Seen {
  joined: Array<string>;
  reopened: Array<string>;
  opened: number;
}

let seen: Seen;

/*
 * The project has one rule that matches, and - as `episodes` says - an open
 * episode of it, a recently resolved one, both or neither.
 */
function stubEngine(
  engine: Engine,
  episodes: { open: boolean; recentlyResolved: boolean },
): void {
  jest
    .spyOn(engine.ruleService as Record<string, AnyFunction>, "findBy")
    .mockResolvedValue([engine.newRule()] as never);
  jest
    .spyOn(engine.engine, engine.matchMethod)
    .mockResolvedValue(true as never);
  jest
    .spyOn(engine.engine, "buildGroupingKey")
    .mockResolvedValue("checkout" as never);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({ key: "checkout" } as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

  jest
    .spyOn(engine.engine, "findMatchingActiveEpisode")
    .mockImplementation((async () => {
      return episodes.open ? { id: OPEN_EPISODE_ID } : null;
    }) as never);
  jest
    .spyOn(engine.engine, "findRecentlyResolvedEpisode")
    .mockImplementation((async () => {
      return episodes.recentlyResolved ? { id: RESOLVED_EPISODE_ID } : null;
    }) as never);
  jest
    .spyOn(engine.engine, "createNewEpisode")
    .mockImplementation((async () => {
      seen.opened++;
      return { id: NEW_EPISODE_ID };
    }) as never);
  jest.spyOn(engine.engine, engine.addMethod).mockImplementation((async (
    _record: unknown,
    episodeId: unknown,
  ) => {
    seen.joined.push(String(episodeId));
  }) as never);
  jest
    .spyOn(
      engine.episodeService as Record<string, AnyFunction>,
      "reopenEpisode",
    )
    .mockImplementation((async (episodeId: unknown) => {
      seen.reopened.push(String(episodeId));
    }) as never);
}

beforeEach(() => {
  seen = { joined: [], reopened: [], opened: 0 };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ENGINES)(
  "$name that pages nobody (mayOpenEpisode: false)",
  (engine: Engine) => {
    test("joins its rule's open episode, as any record does", async () => {
      stubEngine(engine, { open: true, recentlyResolved: true });

      const result: { grouped: boolean; episodeId?: ObjectID } =
        await engine.group(engine.newRecord(), { mayOpenEpisode: false });

      expect(result.grouped).toBe(true);
      expect(String(result.episodeId)).toBe(OPEN_EPISODE_ID.toString());
      expect(seen.joined).toEqual([OPEN_EPISODE_ID.toString()]);
      expect(seen.reopened).toEqual([]);
      expect(seen.opened).toBe(0);
    });

    test("with no open episode, a recently resolved one is not reopened for it", async () => {
      stubEngine(engine, { open: false, recentlyResolved: true });

      const result: { grouped: boolean } = await engine.group(
        engine.newRecord(),
        { mayOpenEpisode: false },
      );

      expect(result.grouped).toBe(false);
      expect(seen.reopened).toEqual([]);
      expect(seen.joined).toEqual([]);
      expect(seen.opened).toBe(0);
    });

    test("with no episode at all, none is opened for it: it stays on its own", async () => {
      stubEngine(engine, { open: false, recentlyResolved: false });

      const result: { grouped: boolean } = await engine.group(
        engine.newRecord(),
        { mayOpenEpisode: false },
      );

      expect(result.grouped).toBe(false);
      expect(seen.opened).toBe(0);
      expect(seen.joined).toEqual([]);
    });
  },
);

describe.each(ENGINES)(
  "$name that pages (no option, or mayOpenEpisode: true) is grouped as before",
  (engine: Engine) => {
    test.each([
      ["no option", undefined],
      ["mayOpenEpisode: true", { mayOpenEpisode: true }],
    ] as Array<[string, { mayOpenEpisode?: boolean } | undefined]>)(
      "%s: a recently resolved episode is reopened for it",
      async (
        _name: string,
        options: { mayOpenEpisode?: boolean } | undefined,
      ) => {
        stubEngine(engine, { open: false, recentlyResolved: true });

        const result: { grouped: boolean; episodeId?: ObjectID } =
          await engine.group(engine.newRecord(), options);

        expect(result.grouped).toBe(true);
        expect(seen.reopened).toEqual([RESOLVED_EPISODE_ID.toString()]);
        expect(seen.joined).toEqual([RESOLVED_EPISODE_ID.toString()]);
        expect(seen.opened).toBe(0);
      },
    );

    test.each([
      ["no option", undefined],
      ["mayOpenEpisode: true", { mayOpenEpisode: true }],
    ] as Array<[string, { mayOpenEpisode?: boolean } | undefined]>)(
      "%s: with no episode at all, a new one is opened for it",
      async (
        _name: string,
        options: { mayOpenEpisode?: boolean } | undefined,
      ) => {
        stubEngine(engine, { open: false, recentlyResolved: false });

        const result: { grouped: boolean; episodeId?: ObjectID } =
          await engine.group(engine.newRecord(), options);

        expect(result.grouped).toBe(true);
        expect(String(result.episodeId)).toBe(NEW_EPISODE_ID.toString());
        expect(seen.opened).toBe(1);
        expect(seen.joined).toEqual([NEW_EPISODE_ID.toString()]);
      },
    );
  },
);
