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
 *   - the new episode's feed shows the grouping key with the title left out.
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
}

interface RuleOptions {
  titleTemplate?: string | undefined;
  descriptionTemplate?: string | undefined;
  groupByTitle?: boolean | undefined;
  groupBySeverity?: boolean | undefined;
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
  newRecord: (data: {
    isPrivate: boolean | undefined;
    withMonitor: boolean;
  }) => Incident | Alert;
  newRule: (options: RuleOptions) => IncidentGroupingRule | AlertGroupingRule;
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
    newRecord: (data: {
      isPrivate: boolean | undefined;
      withMonitor: boolean;
    }): Incident => {
      const incident: Incident = new Incident();
      incident.id = RECORD_ID;
      incident.projectId = PROJECT_ID;
      incident.title = RECORD_TITLE;
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
      return rule;
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
    newRecord: (data: {
      isPrivate: boolean | undefined;
      withMonitor: boolean;
    }): Alert => {
      const alert: Alert = new Alert();
      alert.id = RECORD_ID;
      alert.projectId = PROJECT_ID;
      alert.title = RECORD_TITLE;
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
      return rule;
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

    jest
      .spyOn(engine.episodeService as Record<string, AnyFunction>, "create")
      .mockImplementation((async (data: {
        data: Episode;
      }): Promise<Episode> => {
        data.data.id = EPISODE_ID;
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
    },
  );
});
