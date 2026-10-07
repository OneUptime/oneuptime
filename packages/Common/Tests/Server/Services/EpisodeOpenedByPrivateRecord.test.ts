import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertGroupingRuleService from "../../../Server/Services/AlertGroupingRuleService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentGroupingRuleService from "../../../Server/Services/IncidentGroupingRuleService";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

jest.mock("../../../Server/Utils/Logger");

/*
 * AN EPISODE NEVER SHOWS THE TITLE OF THE PRIVATE INCIDENT OR ALERT THAT
 * OPENED IT.
 *
 * A grouping rule writes the episode it opens from the first incident (or
 * alert) it matches - and the episode is not private, even when that record
 * is. A private record is seen only by its owners and the project's owners
 * and admins, while whoever can see the episode reads its title and
 * description, in its Slack / Microsoft Teams channels too, and every
 * notification about the episode carries its title. So when the record that
 * opens an episode is private:
 *
 *   - with no title template, the episode is named after the record's
 *     monitor, or else after its rule - never after the record's title;
 *   - {{incidentTitle}} and {{incidentDescription}} ({{alertTitle}} and
 *     {{alertDescription}}) read "Private incident" ("Private alert"), in the
 *     title and description and in the templates stored to write them again
 *     as records join - so no later re-render brings the title back;
 *   - its monitor's name and its severity, which are the project's, are
 *     filled in as for any record;
 *   - the new episode's feed shows the grouping key with the title left out;
 *   - the episode is stored with the title in its grouping key hashed - the
 *     key is read with the episode too - and grouping is as it was: every
 *     record with the same title, private or not, still joins it, as they
 *     join an episode opened before titles were hashed, and a private and a
 *     public one arriving together take the same lock, so they never open
 *     two episodes between them.
 *
 * A record that is not private writes the episode exactly as before.
 *
 * The engines' reads and writes are stand-ins; what they write is theirs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000000d1",
);
const RULE_ID: ObjectID = new ObjectID("0195d1e2-0000-4000-8000-0000000000b1");
const EPISODE_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000000e1",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000000a1",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000000c1",
);
// An episode opened before titles were hashed.
const EARLIER_EPISODE_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000000e0",
);
// The records that come after the first.
const LATER_RECORD_IDS: Array<ObjectID> = [
  new ObjectID("0195d1e2-0000-4000-8000-0000000000d2"),
  new ObjectID("0195d1e2-0000-4000-8000-0000000000d3"),
];

const RULE_NAME: string = "Customer data alarms";
const MONITOR_NAME: string = "API Server";
const SEVERITY_NAME: string = "Critical";

const RECORD_TITLE: string =
  "Northwind payroll export 2024 copied to a public bucket";
const RECORD_DESCRIPTION: string =
  "Northwind's HR lead found the payroll file in the bucket at 09:12.";
// The title as a rule that groups by title keys episodes by it.
const RECORD_TITLE_IN_KEY: string =
  "title:northwind payroll export X copied to a public bucket";
// The same title as the key reads it: only the number differs.
const SAME_TITLE_ANOTHER_NUMBER: string =
  "Northwind payroll export 2025 copied to a public bucket";
const ANOTHER_TITLE: string = "Checkout is slow";

// The title in a key, hashed: the name, and an HMAC in hex.
const HASHED_TITLE_IN_KEY: string = "titleHmac:[0-9a-f]{64}";

// Anything that gives the record's title or description away.
const RECORD_TEXT: RegExp = /northwind|payroll/i;

type AnyFunction = (...args: Array<unknown>) => unknown;

type Episode = IncidentEpisode | AlertEpisode;

interface FeedItem {
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
}

interface GroupingResult {
  grouped: boolean;
  episodeId?: ObjectID;
  isNewEpisode?: boolean;
  wasReopened?: boolean;
}

interface RuleOptions {
  titleTemplate?: string | undefined;
  descriptionTemplate?: string | undefined;
  groupByTitle?: boolean | undefined;
  groupBySeverity?: boolean | undefined;
  reopenWindowMinutes?: number | undefined;
}

interface RecordData {
  isPrivate: boolean | undefined;
  withMonitor: boolean;
  // RECORD_ID and RECORD_TITLE unless given.
  id?: ObjectID | undefined;
  title?: string | undefined;
}

interface EngineCase {
  noun: string;
  // What a private record's title and description read in a template.
  privateValue: string;
  // The title as the new episode's feed shows a private record's key.
  privateTitleInKey: string;
  // A title and a description template using every variable the rule offers.
  titleTemplate: string;
  descriptionTemplate: string;
  // The count the episode service fills in again as records join.
  countVariable: string;
  engine: Record<string, AnyFunction>;
  ruleService: unknown;
  episodeService: unknown;
  memberService: unknown;
  feedService: unknown;
  feedMethod: string;
  matchMethod: string;
  addMethod: string;
  recountMethod: string;
  newRecord: (data: RecordData) => Incident | Alert;
  newRule: (options: RuleOptions) => IncidentGroupingRule | AlertGroupingRule;
  newEpisode: () => Episode;
  process: (record: Incident | Alert) => Promise<GroupingResult>;
}

const ENGINES: Array<EngineCase> = [
  {
    noun: "incident",
    privateValue: "Private incident",
    privateTitleInKey: "title:(private incident)",
    titleTemplate:
      "[{{incidentSeverity}}] {{incidentTitle}} on {{monitorName}} ({{incidentCount}})",
    descriptionTemplate:
      "{{incidentDescription}}\n\nFirst incident: {{incidentTitle}}",
    countVariable: "{{incidentCount}}",
    engine: IncidentGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: IncidentGroupingRuleService,
    episodeService: IncidentEpisodeService,
    memberService: IncidentEpisodeMemberService,
    feedService: IncidentEpisodeFeedService,
    feedMethod: "createIncidentEpisodeFeedItem",
    matchMethod: "doesIncidentMatchRule",
    addMethod: "addIncidentToEpisode",
    recountMethod: "updateIncidentCount",
    newRecord: (data: RecordData): Incident => {
      const incident: Incident = new Incident();
      incident.id = data.id || RECORD_ID;
      incident.projectId = PROJECT_ID;
      incident.title = data.title || RECORD_TITLE;
      incident.description = RECORD_DESCRIPTION;
      incident.incidentSeverityId = SEVERITY_ID;

      const severity: IncidentSeverity = new IncidentSeverity();
      severity.id = SEVERITY_ID;
      severity.name = SEVERITY_NAME;
      incident.incidentSeverity = severity;

      if (data.isPrivate !== undefined) {
        incident.isPrivate = data.isPrivate;
      }

      if (data.withMonitor) {
        const monitor: Monitor = new Monitor();
        monitor.id = MONITOR_ID;
        monitor.name = MONITOR_NAME;
        incident.monitors = [monitor];
      }

      return incident;
    },
    newRule: (options: RuleOptions): IncidentGroupingRule => {
      const rule: IncidentGroupingRule = new IncidentGroupingRule();
      rule.id = RULE_ID;
      rule.projectId = PROJECT_ID;
      rule.name = RULE_NAME;

      if (options.titleTemplate) {
        rule.episodeTitleTemplate = options.titleTemplate;
      }

      if (options.descriptionTemplate) {
        rule.episodeDescriptionTemplate = options.descriptionTemplate;
      }

      rule.groupByIncidentTitle = options.groupByTitle === true;
      rule.groupBySeverity = options.groupBySeverity === true;

      if (options.reopenWindowMinutes) {
        rule.enableReopenWindow = true;
        rule.reopenWindowMinutes = options.reopenWindowMinutes;
      }

      return rule;
    },
    newEpisode: (): IncidentEpisode => {
      const episode: IncidentEpisode = new IncidentEpisode();
      episode.projectId = PROJECT_ID;
      episode.incidentGroupingRuleId = RULE_ID;
      return episode;
    },
    process: (record: Incident | Alert): Promise<GroupingResult> => {
      return IncidentGroupingEngineService.processIncident(record as Incident);
    },
  },
  {
    noun: "alert",
    privateValue: "Private alert",
    privateTitleInKey: "title:(private alert)",
    titleTemplate:
      "[{{alertSeverity}}] {{alertTitle}} on {{monitorName}} ({{alertCount}})",
    descriptionTemplate: "{{alertDescription}}\n\nFirst alert: {{alertTitle}}",
    countVariable: "{{alertCount}}",
    engine: AlertGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    ruleService: AlertGroupingRuleService,
    episodeService: AlertEpisodeService,
    memberService: AlertEpisodeMemberService,
    feedService: AlertEpisodeFeedService,
    feedMethod: "createAlertEpisodeFeedItem",
    matchMethod: "doesAlertMatchRule",
    addMethod: "addAlertToEpisode",
    recountMethod: "updateAlertCount",
    newRecord: (data: RecordData): Alert => {
      const alert: Alert = new Alert();
      alert.id = data.id || RECORD_ID;
      alert.projectId = PROJECT_ID;
      alert.title = data.title || RECORD_TITLE;
      alert.description = RECORD_DESCRIPTION;
      alert.alertSeverityId = SEVERITY_ID;

      const severity: AlertSeverity = new AlertSeverity();
      severity.id = SEVERITY_ID;
      severity.name = SEVERITY_NAME;
      alert.alertSeverity = severity;

      if (data.isPrivate !== undefined) {
        alert.isPrivate = data.isPrivate;
      }

      if (data.withMonitor) {
        const monitor: Monitor = new Monitor();
        monitor.id = MONITOR_ID;
        monitor.name = MONITOR_NAME;
        alert.monitor = monitor;
        alert.monitorId = MONITOR_ID;
      }

      return alert;
    },
    newRule: (options: RuleOptions): AlertGroupingRule => {
      const rule: AlertGroupingRule = new AlertGroupingRule();
      rule.id = RULE_ID;
      rule.projectId = PROJECT_ID;
      rule.name = RULE_NAME;

      if (options.titleTemplate) {
        rule.episodeTitleTemplate = options.titleTemplate;
      }

      if (options.descriptionTemplate) {
        rule.episodeDescriptionTemplate = options.descriptionTemplate;
      }

      rule.groupByAlertTitle = options.groupByTitle === true;
      rule.groupBySeverity = options.groupBySeverity === true;

      if (options.reopenWindowMinutes) {
        rule.enableReopenWindow = true;
        rule.reopenWindowMinutes = options.reopenWindowMinutes;
      }

      return rule;
    },
    newEpisode: (): AlertEpisode => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.projectId = PROJECT_ID;
      episode.alertGroupingRuleId = RULE_ID;
      return episode;
    },
    process: (record: Incident | Alert): Promise<GroupingResult> => {
      return AlertGroupingEngineService.processAlert(record as Alert);
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ENGINES)("the $noun grouping engine", (engine: EngineCase) => {
  let episodes: Array<Episode> = [];
  let feed: Array<FeedItem> = [];

  beforeEach(() => {
    episodes = [];
    feed = [];
    let created: number = 0;

    jest
      .spyOn(engine.episodeService as Record<string, AnyFunction>, "create")
      .mockImplementation((async (data: {
        data: Episode;
      }): Promise<Episode> => {
        // The first episode the engine opens is EPISODE_ID.
        data.data.id = created === 0 ? EPISODE_ID : ObjectID.generate();
        created++;
        episodes.push(data.data);
        return data.data;
      }) as never);

    jest
      .spyOn(
        engine.feedService as Record<string, AnyFunction>,
        engine.feedMethod,
      )
      .mockImplementation((async (item: FeedItem): Promise<void> => {
        feed.push(item);
      }) as never);
  });

  // The grouping key the engine builds for the record under the rule.
  async function buildGroupingKey(
    record: Incident | Alert,
    rule: IncidentGroupingRule | AlertGroupingRule,
  ): Promise<string> {
    return (await engine.engine["buildGroupingKey"]!.call(
      engine.engine,
      record,
      rule,
    )) as string;
  }

  // Opens an episode for the record as its rule's first match.
  async function openEpisode(data: {
    isPrivate: boolean | undefined;
    withMonitor?: boolean | undefined;
    rule?: RuleOptions | undefined;
  }): Promise<Episode> {
    const record: Incident | Alert = engine.newRecord({
      isPrivate: data.isPrivate,
      withMonitor: data.withMonitor !== false,
    });
    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule(
      data.rule || {},
    );

    const created: unknown = await engine.engine["createNewEpisode"]!.call(
      engine.engine,
      record,
      rule,
      await buildGroupingKey(record, rule),
    );

    expect(created).not.toBeNull();
    expect(episodes).toHaveLength(1);
    return episodes[0]!;
  }

  // What everyone who can see the episode reads of it, as it is written.
  function readableText(episode: Episode): Array<string> {
    const texts: Array<string | undefined> = [
      episode.title,
      episode.description,
      episode.titleTemplate,
      episode.descriptionTemplate,
      episode.groupingKey,
    ];

    for (const item of feed) {
      texts.push(item.feedInfoInMarkdown, item.moreInformationInMarkdown);
    }

    return texts.filter((text: string | undefined): text is string => {
      return Boolean(text);
    });
  }

  function expectNoRecordText(texts: Array<string>): void {
    for (const text of texts) {
      expect(text).not.toMatch(RECORD_TEXT);
    }
  }

  describe(`opened by a private ${engine.noun}`, () => {
    test("with no title template and no monitor, is named after its rule - not the title", async () => {
      const episode: Episode = await openEpisode({
        isPrivate: true,
        withMonitor: false,
      });

      expect(episode.title).toBe(RULE_NAME);
      expect(episode.description).toBeUndefined();
      expect(episode.titleTemplate).toBeUndefined();
      expect(episode.descriptionTemplate).toBeUndefined();
      expectNoRecordText(readableText(episode));
    });

    test("with no title template, is still named after its monitor", async () => {
      const episode: Episode = await openEpisode({ isPrivate: true });

      expect(episode.title).toBe(MONITOR_NAME);
      expectNoRecordText(readableText(episode));
    });

    test(`fills its title and description in as "${engine.privateValue}", and the rest as for any ${engine.noun}`, async () => {
      const episode: Episode = await openEpisode({
        isPrivate: true,
        rule: {
          titleTemplate: engine.titleTemplate,
          descriptionTemplate: engine.descriptionTemplate,
        },
      });

      expect(episode.title).toBe(
        `[${SEVERITY_NAME}] ${engine.privateValue} on ${MONITOR_NAME} (1)`,
      );
      expect(episode.description).toBe(
        `${engine.privateValue}\n\nFirst ${engine.noun}: ${engine.privateValue}`,
      );
      expectNoRecordText(readableText(episode));
    });

    test("stores templates with no trace of it, keeping the count to fill in later", async () => {
      const episode: Episode = await openEpisode({
        isPrivate: true,
        rule: {
          titleTemplate: engine.titleTemplate,
          descriptionTemplate: engine.descriptionTemplate,
        },
      });

      expect(episode.titleTemplate).toBe(
        `[${SEVERITY_NAME}] ${engine.privateValue} on ${MONITOR_NAME} (${engine.countVariable})`,
      );
      expect(episode.descriptionTemplate).toBe(
        `${engine.privateValue}\n\nFirst ${engine.noun}: ${engine.privateValue}`,
      );
    });

    test(`the title written again as more ${engine.noun}s join never brings it back`, async () => {
      const episode: Episode = await openEpisode({
        isPrivate: true,
        rule: {
          titleTemplate: engine.titleTemplate,
          descriptionTemplate: engine.descriptionTemplate,
        },
      });

      jest
        .spyOn(engine.memberService as Record<string, AnyFunction>, "countBy")
        .mockResolvedValue(new PositiveNumber(3) as never);
      jest
        .spyOn(
          engine.episodeService as Record<string, AnyFunction>,
          "findOneById",
        )
        .mockResolvedValue(episode as never);

      const updates: Array<{ title?: string; description?: string }> = [];
      jest
        .spyOn(
          engine.episodeService as Record<string, AnyFunction>,
          "updateOneById",
        )
        .mockImplementation((async (data: {
          data: { title?: string; description?: string };
        }): Promise<void> => {
          updates.push(data.data);
        }) as never);

      await (
        engine.episodeService as Record<
          string,
          (episodeId: ObjectID) => Promise<void>
        >
      )[engine.recountMethod]!(EPISODE_ID);

      expect(updates).toHaveLength(1);
      expect(updates[0]!.title).toBe(
        `[${SEVERITY_NAME}] ${engine.privateValue} on ${MONITOR_NAME} (3)`,
      );
      expect(updates[0]!.description).toBe(
        `${engine.privateValue}\n\nFirst ${engine.noun}: ${engine.privateValue}`,
      );
    });

    test("the new episode's feed shows a key grouped by title with the title left out", async () => {
      const episode: Episode = await openEpisode({
        isPrivate: true,
        rule: { groupByTitle: true, groupBySeverity: true },
      });

      expect(feed).toHaveLength(1);
      expect(feed[0]!.moreInformationInMarkdown).toContain(
        `**Grouping Key:** severity:${SEVERITY_ID.toString()}|${engine.privateTitleInKey}\n\n`,
      );
      expectNoRecordText(readableText(episode));
    });

    test("is stored with the title in its grouping key hashed, and the rest of the key as built", async () => {
      const episode: Episode = await openEpisode({
        isPrivate: true,
        rule: { groupByTitle: true, groupBySeverity: true },
      });

      expect(episode.groupingKey).toMatch(
        new RegExp(
          `^severity:${SEVERITY_ID.toString()}\\|${HASHED_TITLE_IN_KEY}$`,
        ),
      );
      expect(episode.groupingKey).not.toContain(RECORD_TITLE_IN_KEY);
      expect(episode.groupingKey).not.toMatch(RECORD_TEXT);
    });

    test(`from the engine's entry point: the private ${engine.noun} it is handed opens an episode without its title`, async () => {
      const record: Incident | Alert = engine.newRecord({
        isPrivate: true,
        withMonitor: false,
      });
      const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule({
        titleTemplate: engine.titleTemplate,
        descriptionTemplate: engine.descriptionTemplate,
        groupByTitle: true,
      });

      jest
        .spyOn(engine.ruleService as Record<string, AnyFunction>, "findBy")
        .mockResolvedValue([rule] as never);
      jest
        .spyOn(engine.engine, engine.matchMethod)
        .mockResolvedValue(true as never);
      jest
        .spyOn(Semaphore, "lock")
        .mockResolvedValue({ key: "grouping" } as never);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
      jest
        .spyOn(engine.engine, "findMatchingActiveEpisode")
        .mockResolvedValue(null as never);

      const joined: Array<string> = [];
      jest.spyOn(engine.engine, engine.addMethod).mockImplementation((async (
        _record: unknown,
        episodeId: unknown,
      ): Promise<void> => {
        joined.push(String(episodeId));
      }) as never);

      const result: GroupingResult = await engine.process(record);

      expect(result.grouped).toBe(true);
      expect(result.isNewEpisode).toBe(true);
      expect(result.episodeId?.toString()).toBe(EPISODE_ID.toString());
      expect(joined).toEqual([EPISODE_ID.toString()]);
      expect(episodes).toHaveLength(1);
      expect(episodes[0]!.title).toBe(
        `[${SEVERITY_NAME}] ${engine.privateValue} on  (1)`,
      );
      expectNoRecordText(readableText(episodes[0]!));
    });
  });

  describe.each([
    ["not marked private", undefined],
    ["marked not private", false],
  ])(
    `opened by a ${engine.noun} %s`,
    (_label: string, isPrivate: boolean | undefined) => {
      test("with no title template and no monitor, is named after its title, as before", async () => {
        const episode: Episode = await openEpisode({
          isPrivate: isPrivate,
          withMonitor: false,
        });

        expect(episode.title).toBe(RECORD_TITLE.substring(0, 50));
      });

      test("with no title template, is named after its monitor, as before", async () => {
        const episode: Episode = await openEpisode({ isPrivate: isPrivate });

        expect(episode.title).toBe(MONITOR_NAME);
      });

      test("fills its title and description into the templates, as before", async () => {
        const episode: Episode = await openEpisode({
          isPrivate: isPrivate,
          rule: {
            titleTemplate: engine.titleTemplate,
            descriptionTemplate: engine.descriptionTemplate,
          },
        });

        expect(episode.title).toBe(
          `[${SEVERITY_NAME}] ${RECORD_TITLE} on ${MONITOR_NAME} (1)`,
        );
        expect(episode.titleTemplate).toBe(
          `[${SEVERITY_NAME}] ${RECORD_TITLE} on ${MONITOR_NAME} (${engine.countVariable})`,
        );
        expect(episode.description).toBe(
          `${RECORD_DESCRIPTION}\n\nFirst ${engine.noun}: ${RECORD_TITLE}`,
        );
        expect(episode.descriptionTemplate).toBe(episode.description);
      });

      test("the new episode's feed shows a key grouped by title as it is, as before", async () => {
        await openEpisode({
          isPrivate: isPrivate,
          rule: { groupByTitle: true, groupBySeverity: true },
        });

        expect(feed).toHaveLength(1);
        expect(feed[0]!.moreInformationInMarkdown).toContain(
          `**Grouping Key:** severity:${SEVERITY_ID.toString()}|${RECORD_TITLE_IN_KEY}\n\n`,
        );
      });

      test("is stored with its grouping key as built, as before", async () => {
        const episode: Episode = await openEpisode({
          isPrivate: isPrivate,
          rule: { groupByTitle: true, groupBySeverity: true },
        });

        expect(episode.groupingKey).toBe(
          `severity:${SEVERITY_ID.toString()}|${RECORD_TITLE_IN_KEY}`,
        );
      });
    },
  );

  /*
   * Records that come after the first: grouped from the engine's entry point,
   * against the episodes stored so far. The engine's lookup is answered from
   * `episodes` by the grouping keys it asks for; the lock is held as Valkey
   * holds it, by one caller per key at a time.
   */
  describe(`${engine.noun}s with the same title, later`, () => {
    let rule: IncidentGroupingRule | AlertGroupingRule;
    let locks: Array<string> = [];
    let joined: Array<{ record: string; episode: string }> = [];
    let reopened: Array<string> = [];

    // The grouping keys a lookup asks for: one, or QueryHelper.any's list.
    function keysAskedFor(condition: unknown): Array<string> {
      if (typeof condition === "string") {
        return [condition];
      }

      const operator: FindOperator<unknown> =
        condition as FindOperator<unknown>;
      expect(operator.getSql?.("key")).toMatch(/^\(key IN \(:\.\.\.\w+\)\)$/);
      return Object.values(
        operator.objectLiteralParameters || {},
      )[0] as Array<string>;
    }

    beforeEach(() => {
      rule = engine.newRule({ groupByTitle: true });
      locks = [];
      joined = [];
      reopened = [];

      jest
        .spyOn(engine.ruleService as Record<string, AnyFunction>, "findBy")
        .mockImplementation((async (): Promise<unknown> => {
          return [rule];
        }) as never);
      jest
        .spyOn(engine.engine, engine.matchMethod)
        .mockResolvedValue(true as never);

      const held: Map<string, Promise<void>> = new Map();
      jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
        key: string;
        namespace: string;
      }): Promise<unknown> => {
        locks.push(data.key);

        const name: string = `${data.namespace}-${data.key}`;
        const previous: Promise<void> = held.get(name) || Promise.resolve();
        let release: () => void = (): void => {};
        const holding: Promise<void> = new Promise<void>(
          (resolve: () => void): void => {
            release = resolve;
          },
        );
        held.set(
          name,
          previous.then((): Promise<void> => {
            return holding;
          }),
        );

        await previous;
        return { release: release };
      }) as never);
      jest.spyOn(Semaphore, "release").mockImplementation((async (mutex: {
        release: () => void;
      }): Promise<void> => {
        mutex.release();
      }) as never);

      jest
        .spyOn(
          engine.episodeService as Record<string, AnyFunction>,
          "findOneBy",
        )
        .mockImplementation((async (data: {
          query: Record<string, unknown>;
        }): Promise<Episode | null> => {
          const keys: Array<string> = keysAskedFor(data.query["groupingKey"]);
          const resolved: boolean = data.query["resolvedAt"] !== null;

          const found: Array<Episode> = episodes.filter(
            (episode: Episode): boolean => {
              return (
                keys.includes(episode.groupingKey || "") &&
                Boolean(episode.resolvedAt) === resolved
              );
            },
          );

          return found[found.length - 1] || null;
        }) as never);

      jest.spyOn(engine.engine, engine.addMethod).mockImplementation((async (
        record: Incident | Alert,
        episodeId: ObjectID,
      ): Promise<void> => {
        joined.push({
          record: record.id!.toString(),
          episode: episodeId.toString(),
        });
      }) as never);
      jest
        .spyOn(
          engine.episodeService as Record<string, AnyFunction>,
          "updateEpisodeSeverity",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(
          engine.episodeService as Record<string, AnyFunction>,
          "reopenEpisode",
        )
        .mockImplementation((async (episodeId: ObjectID): Promise<void> => {
          reopened.push(episodeId.toString());
          for (const episode of episodes) {
            if (episode.id?.toString() === episodeId.toString()) {
              (episode as { resolvedAt?: Date | undefined }).resolvedAt =
                undefined;
            }
          }
        }) as never);
    });

    function group(data: {
      isPrivate: boolean;
      id?: ObjectID | undefined;
      title?: string | undefined;
    }): Promise<GroupingResult> {
      return engine.process(
        engine.newRecord({
          isPrivate: data.isPrivate,
          withMonitor: false,
          id: data.id,
          title: data.title,
        }),
      );
    }

    // An episode stored before titles were hashed: its key as built.
    function storeEarlierEpisode(data: { resolvedAt?: Date }): void {
      const episode: Episode = engine.newEpisode();
      episode.id = EARLIER_EPISODE_ID;
      episode.groupingKey = RECORD_TITLE_IN_KEY;
      if (data.resolvedAt) {
        episode.resolvedAt = data.resolvedAt;
      }
      episodes.push(episode);
    }

    function expectJoined(
      result: GroupingResult,
      episodeId: ObjectID,
      recordId: ObjectID,
    ): void {
      expect(result.grouped).toBe(true);
      expect(result.isNewEpisode).toBe(false);
      expect(result.episodeId?.toString()).toBe(episodeId.toString());
      expect(joined).toContainEqual({
        record: recordId.toString(),
        episode: episodeId.toString(),
      });
    }

    test(`one that is not private, and another private one, join the episode a private ${engine.noun} opened`, async () => {
      const opened: GroupingResult = await group({ isPrivate: true });

      expect(opened.isNewEpisode).toBe(true);
      expect(episodes[0]!.groupingKey).not.toMatch(RECORD_TEXT);

      expectJoined(
        await group({
          isPrivate: false,
          id: LATER_RECORD_IDS[0],
          title: SAME_TITLE_ANOTHER_NUMBER,
        }),
        EPISODE_ID,
        LATER_RECORD_IDS[0]!,
      );
      expectJoined(
        await group({ isPrivate: true, id: LATER_RECORD_IDS[1] }),
        EPISODE_ID,
        LATER_RECORD_IDS[1]!,
      );
      expect(episodes).toHaveLength(1);
    });

    test(`a private one joins the episode an ${engine.noun} that is not private opened`, async () => {
      await group({ isPrivate: false });

      expect(episodes[0]!.groupingKey).toBe(RECORD_TITLE_IN_KEY);

      expectJoined(
        await group({ isPrivate: true, id: LATER_RECORD_IDS[0] }),
        EPISODE_ID,
        LATER_RECORD_IDS[0]!,
      );
      expect(episodes).toHaveLength(1);
    });

    test("an episode opened before titles were hashed - stored with the title as it reads - is still joined, by private ones and others alike", async () => {
      storeEarlierEpisode({});

      expectJoined(
        await group({ isPrivate: true }),
        EARLIER_EPISODE_ID,
        RECORD_ID,
      );
      expectJoined(
        await group({
          isPrivate: false,
          id: LATER_RECORD_IDS[0],
          title: SAME_TITLE_ANOTHER_NUMBER,
        }),
        EARLIER_EPISODE_ID,
        LATER_RECORD_IDS[0]!,
      );
      expect(episodes).toHaveLength(1);
    });

    test("one resolved recently, opened before titles were hashed, is reopened for a private one", async () => {
      rule = engine.newRule({ groupByTitle: true, reopenWindowMinutes: 30 });
      storeEarlierEpisode({ resolvedAt: new Date() });

      const result: GroupingResult = await group({ isPrivate: true });

      expect(result.wasReopened).toBe(true);
      expect(result.episodeId?.toString()).toBe(EARLIER_EPISODE_ID.toString());
      expect(reopened).toEqual([EARLIER_EPISODE_ID.toString()]);
      expect(joined).toEqual([
        {
          record: RECORD_ID.toString(),
          episode: EARLIER_EPISODE_ID.toString(),
        },
      ]);
      expect(episodes).toHaveLength(1);
    });

    test("one with another title opens an episode of its own", async () => {
      await group({ isPrivate: true });
      const other: GroupingResult = await group({
        isPrivate: false,
        id: LATER_RECORD_IDS[0],
        title: ANOTHER_TITLE,
      });

      expect(other.isNewEpisode).toBe(true);
      expect(other.episodeId?.toString()).not.toBe(EPISODE_ID.toString());
      expect(episodes).toHaveLength(2);
    });

    test("a private one and one that is not take the same lock: the one taken before titles were hashed", async () => {
      await group({ isPrivate: true });
      await group({ isPrivate: false, id: LATER_RECORD_IDS[0] });

      const lockKey: string = `${PROJECT_ID.toString()}-${RULE_ID.toString()}-${RECORD_TITLE_IN_KEY}`;
      expect(locks).toEqual([lockKey, lockKey]);
    });

    test("a private one and one that is not, arriving together, open one episode between them", async () => {
      const results: Array<GroupingResult> = await Promise.all([
        group({ isPrivate: true }),
        group({
          isPrivate: false,
          id: LATER_RECORD_IDS[0],
          title: SAME_TITLE_ANOTHER_NUMBER,
        }),
      ]);

      expect(episodes).toHaveLength(1);
      expect(
        results.map((result: GroupingResult): string | undefined => {
          return result.episodeId?.toString();
        }),
      ).toEqual([EPISODE_ID.toString(), EPISODE_ID.toString()]);
      expect(
        results.filter((result: GroupingResult): boolean => {
          return result.isNewEpisode === true;
        }),
      ).toHaveLength(1);
    });
  });
});
