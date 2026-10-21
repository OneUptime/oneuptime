import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import { TemplateVariable } from "../../../Types/Template/TemplateVariable";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES,
  INCIDENT_EPISODE_TEMPLATE_STATIC_VARIABLES,
} from "../../../Utils/Episode/EpisodeTemplateVariables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../Server/Utils/Logger");

/*
 * A grouping rule's episode title and description templates are filled in
 * from the incident (or alert) that opens the episode - its title,
 * description, first monitor's name and severity - and written again, with
 * the new count, each time one joins or leaves.
 *
 *   - Every value goes in exactly as written. A string replacement reads
 *     "$&", "$`", "$'" and "$1" in it as patterns: the alert engine wrote an
 *     alert titled "Price $& up" into its episode as "Price  up", and a title
 *     holding "$`" copied the template's text before it into itself.
 *   - Written again, the title and description read as they did when the
 *     episode opened, but for the count. The engines stored the templates
 *     with a variable the first one had no value for still in them, and only
 *     the count is filled in again: ": Checkout failing (1)" became
 *     "{{monitorName}}: Checkout failing (2)" as soon as a second incident
 *     joined. An episode stored that way reads right again the next time one
 *     joins.
 *
 * The engines' and episode services' reads and writes are stand-ins; what
 * they write is theirs.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000001d1",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-000000000101",
);
const RULE_ID: ObjectID = new ObjectID("0195d1e2-0000-4000-8000-0000000001b1");
const EPISODE_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000001e1",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000001a1",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "0195d1e2-0000-4000-8000-0000000001c1",
);

type AnyFunction = (...args: Array<unknown>) => unknown;

type Episode = IncidentEpisode | AlertEpisode;

type Rule = IncidentGroupingRule | AlertGroupingRule;

// What the record that opens the episode holds: a value left out, it has none of.
interface RecordValues {
  title?: string | undefined;
  description?: string | undefined;
  monitorName?: string | undefined;
  severityName?: string | undefined;
}

interface Templates {
  title?: string | undefined;
  description?: string | undefined;
}

// What writing the episode again sets: a field left out stays as it was.
interface Rewrite {
  title?: string | undefined;
  description?: string | undefined;
}

// A rule's variables, written as its templates use them.
interface Variables {
  title: string;
  description: string;
  monitorName: string;
  severity: string;
  count: string;
  // The other kind's count, which this kind's templates do not offer.
  otherCount: string;
}

interface EngineCase {
  noun: string;
  engineFile: string;
  variables: Variables;
  staticVariables: ReadonlyArray<TemplateVariable>;
  engine: Record<string, AnyFunction>;
  episodeService: unknown;
  memberService: unknown;
  feedService: unknown;
  feedMethod: string;
  recountMethod: string;
  newRecord: (values: RecordValues) => Incident | Alert;
  newRule: (templates: Templates) => Rule;
  newEpisode: () => Episode;
}

function newMonitor(name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.name = name;
  return monitor;
}

const ENGINES: Array<EngineCase> = [
  {
    noun: "incident",
    engineFile: "IncidentGroupingEngineService.ts",
    variables: {
      title: "{{incidentTitle}}",
      description: "{{incidentDescription}}",
      monitorName: "{{monitorName}}",
      severity: "{{incidentSeverity}}",
      count: "{{incidentCount}}",
      otherCount: "{{alertCount}}",
    },
    staticVariables: INCIDENT_EPISODE_TEMPLATE_STATIC_VARIABLES,
    engine: IncidentGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    episodeService: IncidentEpisodeService,
    memberService: IncidentEpisodeMemberService,
    feedService: IncidentEpisodeFeedService,
    feedMethod: "createIncidentEpisodeFeedItem",
    recountMethod: "updateIncidentCount",
    newRecord: (values: RecordValues): Incident => {
      const incident: Incident = new Incident();
      incident.id = RECORD_ID;
      incident.projectId = PROJECT_ID;

      if (values.title !== undefined) {
        incident.title = values.title;
      }

      if (values.description !== undefined) {
        incident.description = values.description;
      }

      if (values.monitorName !== undefined) {
        incident.monitors = [newMonitor(values.monitorName)];
      }

      if (values.severityName !== undefined) {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity.id = SEVERITY_ID;
        severity.name = values.severityName;
        incident.incidentSeverity = severity;
        incident.incidentSeverityId = SEVERITY_ID;
      }

      return incident;
    },
    newRule: (templates: Templates): IncidentGroupingRule => {
      const rule: IncidentGroupingRule = new IncidentGroupingRule();
      rule.id = RULE_ID;
      rule.projectId = PROJECT_ID;
      rule.name = "Checkout incidents";

      if (templates.title !== undefined) {
        rule.episodeTitleTemplate = templates.title;
      }

      if (templates.description !== undefined) {
        rule.episodeDescriptionTemplate = templates.description;
      }

      return rule;
    },
    newEpisode: (): IncidentEpisode => {
      return new IncidentEpisode();
    },
  },
  {
    noun: "alert",
    engineFile: "AlertGroupingEngineService.ts",
    variables: {
      title: "{{alertTitle}}",
      description: "{{alertDescription}}",
      monitorName: "{{monitorName}}",
      severity: "{{alertSeverity}}",
      count: "{{alertCount}}",
      otherCount: "{{incidentCount}}",
    },
    staticVariables: ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES,
    engine: AlertGroupingEngineService as unknown as Record<
      string,
      AnyFunction
    >,
    episodeService: AlertEpisodeService,
    memberService: AlertEpisodeMemberService,
    feedService: AlertEpisodeFeedService,
    feedMethod: "createAlertEpisodeFeedItem",
    recountMethod: "updateAlertCount",
    newRecord: (values: RecordValues): Alert => {
      const alert: Alert = new Alert();
      alert.id = RECORD_ID;
      alert.projectId = PROJECT_ID;

      if (values.title !== undefined) {
        alert.title = values.title;
      }

      if (values.description !== undefined) {
        alert.description = values.description;
      }

      if (values.monitorName !== undefined) {
        alert.monitor = newMonitor(values.monitorName);
        alert.monitorId = MONITOR_ID;
      }

      if (values.severityName !== undefined) {
        const severity: AlertSeverity = new AlertSeverity();
        severity.id = SEVERITY_ID;
        severity.name = values.severityName;
        alert.alertSeverity = severity;
        alert.alertSeverityId = SEVERITY_ID;
      }

      return alert;
    },
    newRule: (templates: Templates): AlertGroupingRule => {
      const rule: AlertGroupingRule = new AlertGroupingRule();
      rule.id = RULE_ID;
      rule.projectId = PROJECT_ID;
      rule.name = "Checkout alerts";

      if (templates.title !== undefined) {
        rule.episodeTitleTemplate = templates.title;
      }

      if (templates.description !== undefined) {
        rule.episodeDescriptionTemplate = templates.description;
      }

      return rule;
    },
    newEpisode: (): AlertEpisode => {
      return new AlertEpisode();
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ENGINES)(
  "the $noun grouping engine's episode templates",
  (engine: EngineCase) => {
    const variables: Variables = engine.variables;

    let episodes: Array<Episode> = [];

    beforeEach(() => {
      episodes = [];

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
        .mockResolvedValue(undefined as never);
    });

    // Opens an episode for a record holding `values`, as its rule's first match.
    async function openEpisode(
      values: RecordValues,
      templates: Templates,
    ): Promise<Episode> {
      const created: unknown = await engine.engine["createNewEpisode"]!.call(
        engine.engine,
        engine.newRecord(values),
        engine.newRule(templates),
        "grouping-key",
      );

      expect(created).not.toBeNull();
      expect(episodes).toHaveLength(1);
      return episodes[0]!;
    }

    /*
     * Writes the episode's title and description again, as when a member
     * joins or leaves and the episode then has `count`.
     */
    async function writeAgain(
      episode: Episode,
      count: number,
    ): Promise<Rewrite> {
      jest
        .spyOn(engine.memberService as Record<string, AnyFunction>, "countBy")
        .mockResolvedValue(new PositiveNumber(count) as never);
      jest
        .spyOn(
          engine.episodeService as Record<string, AnyFunction>,
          "findOneById",
        )
        .mockResolvedValue(episode as never);

      const updates: Array<Rewrite> = [];
      jest
        .spyOn(
          engine.episodeService as Record<string, AnyFunction>,
          "updateOneById",
        )
        .mockImplementation((async (data: { data: Rewrite }): Promise<void> => {
          updates.push(data.data);
        }) as never);

      await (
        engine.episodeService as Record<
          string,
          (episodeId: ObjectID) => Promise<void>
        >
      )[engine.recountMethod]!(EPISODE_ID);

      expect(updates).toHaveLength(1);
      return updates[0]!;
    }

    /*
     * The title and description the engine writes for a record holding
     * `values` when the episode has `count` - as it does, at 1, when the
     * episode opens.
     */
    function writtenAt(
      values: RecordValues,
      templates: Templates,
      count: number,
    ): Rewrite {
      const record: Incident | Alert = engine.newRecord(values);
      const templateValues: unknown = engine.engine[
        "getEpisodeTemplateValues"
      ]!.call(engine.engine, record);

      return {
        title: engine.engine["generateEpisodeTitle"]!.call(
          engine.engine,
          record,
          engine.newRule(templates),
          templateValues,
          count,
        ) as string,
        description: engine.engine["generateEpisodeDescription"]!.call(
          engine.engine,
          templateValues,
          templates.description,
          count,
        ) as string | undefined,
      };
    }

    describe("every value goes in exactly as written", () => {
      test.each(["$&", "$`", "$'", "$1", "$$"])(
        "a value holding %s - when the episode opens, and written again",
        async (pattern: string) => {
          const values: RecordValues = {
            title: `Price ${pattern} up`,
            description: `Checkout ${pattern} slow`,
            monitorName: `api ${pattern} server`,
            severityName: `Sev ${pattern}`,
          };
          const title: string = `[${values.severityName}] ${values.title} on ${values.monitorName}`;
          const description: string = `${values.description} - ${values.title}`;

          const episode: Episode = await openEpisode(values, {
            title: `[${variables.severity}] ${variables.title} on ${variables.monitorName} (${variables.count})`,
            description: `${variables.description} - ${variables.title}`,
          });

          expect(episode.title).toBe(`${title} (1)`);
          expect(episode.description).toBe(description);
          expect(episode.titleTemplate).toBe(`${title} (${variables.count})`);
          expect(episode.descriptionTemplate).toBe(description);

          const rewrite: Rewrite = await writeAgain(episode, 3);

          expect(rewrite.title).toBe(`${title} (3)`);
          expect(rewrite.description).toBe(description);
        },
      );
    });

    describe(`written again as ${engine.noun}s join, it reads as it opened, but for the count`, () => {
      test(`a variable the first ${engine.noun} has no value for is left out then too`, async () => {
        const episode: Episode = await openEpisode(
          { title: "Checkout failing" },
          {
            title: `${variables.monitorName}: ${variables.title} (${variables.count})`,
            description: `${variables.description}Opened by ${variables.title} [${variables.severity}]`,
          },
        );

        expect(episode.title).toBe(": Checkout failing (1)");
        expect(episode.titleTemplate).toBe(
          `: Checkout failing (${variables.count})`,
        );
        expect(episode.description).toBe("Opened by Checkout failing []");
        expect(episode.descriptionTemplate).toBe(
          "Opened by Checkout failing []",
        );

        const rewrite: Rewrite = await writeAgain(episode, 2);

        expect(rewrite.title).toBe(": Checkout failing (2)");
        expect(rewrite.description).toBe("Opened by Checkout failing []");
      });

      test(`a variable no ${engine.noun} has, and the other kind's count, are left out then too`, async () => {
        const episode: Episode = await openEpisode(
          { title: "Checkout failing", monitorName: "api" },
          {
            title: `${variables.title}{{region}} (${variables.count} ${variables.otherCount})`,
          },
        );

        expect(episode.title).toBe("Checkout failing (1 )");
        expect(episode.titleTemplate).toBe(
          `Checkout failing (${variables.count} )`,
        );

        const rewrite: Rewrite = await writeAgain(episode, 5);

        expect(rewrite.title).toBe("Checkout failing (5 )");
      });

      test('a title that comes out empty reads "Untitled Episode" then too', async () => {
        const episode: Episode = await openEpisode(
          { title: "Checkout failing" },
          { title: variables.monitorName },
        );

        expect(episode.title).toBe("Untitled Episode");

        const rewrite: Rewrite = await writeAgain(episode, 2);

        expect(rewrite.title ?? episode.title).toBe("Untitled Episode");
      });

      describe.each([
        [
          "with every value",
          {
            title: "Checkout failing",
            description: "Card payments time out",
            monitorName: "api",
            severityName: "Critical",
          },
        ],
        [
          "with no monitor",
          {
            title: "Checkout failing",
            description: "Card payments time out",
            severityName: "Critical",
          },
        ],
        [
          "with no description",
          {
            title: "Checkout failing",
            monitorName: "api",
            severityName: "Critical",
          },
        ],
        [
          "with no severity",
          {
            title: "Checkout failing",
            description: "Card payments time out",
            monitorName: "api",
          },
        ],
        ["with nothing but a title", { title: "Checkout failing" }],
        [
          "whose title holds a placeholder of its own",
          { title: "Disk {{mount}} full", monitorName: "db" },
        ],
      ])(
        `opened by an ${engine.noun} %s`,
        (_label: string, values: RecordValues) => {
          test.each([
            [
              "every variable",
              {
                title: `[${variables.severity}] ${variables.title} on ${variables.monitorName} (${variables.count})`,
                description: `${variables.description}\n\nFirst: ${variables.title} on ${variables.monitorName}`,
              },
            ],
            [
              "no count",
              {
                title: `${variables.monitorName}: ${variables.title}`,
                description: variables.description,
              },
            ],
            [
              `a variable no ${engine.noun} has`,
              {
                title: `{{region}}${variables.title} (${variables.count})`,
                description: `{{runbook}}${variables.description}`,
              },
            ],
            [
              "triple braces",
              {
                title: `{${variables.title}} ({${variables.count}})`,
                description: `{${variables.monitorName}}`,
              },
            ],
            [
              "the count twice",
              {
                title: `${variables.count}: ${variables.title} - ${variables.count} so far`,
                description: variables.count,
              },
            ],
          ])(
            "and a template with %s, stores only the count and reads the same at any count",
            async (_templateLabel: string, templates: Templates) => {
              const episode: Episode = await openEpisode(values, templates);

              for (const stored of [
                episode.titleTemplate,
                episode.descriptionTemplate,
              ]) {
                expect(
                  (stored || "").split(variables.count).join(""),
                ).not.toMatch(/\{\{[^}]+\}\}/);
              }

              const opened: Rewrite = writtenAt(values, templates, 1);

              expect(episode.title).toBe(opened.title);
              expect(episode.description).toBe(opened.description);

              for (const count of [1, 4, 12]) {
                const rewrite: Rewrite = await writeAgain(episode, count);
                const expected: Rewrite = writtenAt(values, templates, count);

                expect(rewrite.title ?? episode.title).toBe(expected.title);
                expect(rewrite.description ?? episode.description).toBe(
                  expected.description,
                );
              }
            },
          );
        },
      );
    });

    describe("an episode opened before its templates kept only the count", () => {
      test(`clears what its first ${engine.noun} had no value for, written again`, async () => {
        const episode: Episode = engine.newEpisode();
        episode.title = ": Checkout failing (1)";
        episode.titleTemplate = `${variables.monitorName}: Checkout failing (${variables.count})`;
        episode.descriptionTemplate = `${variables.description}Card payments time out`;

        const rewrite: Rewrite = await writeAgain(episode, 3);

        expect(rewrite.title).toBe(": Checkout failing (3)");
        expect(rewrite.description).toBe("Card payments time out");
      });

      test('reads "Untitled Episode" when nothing else is left of its title', async () => {
        const episode: Episode = engine.newEpisode();
        episode.title = "Untitled Episode";
        episode.titleTemplate = variables.monitorName;

        const rewrite: Rewrite = await writeAgain(episode, 2);

        expect(rewrite.title).toBe("Untitled Episode");
      });
    });
  },
);

describe.each(ENGINES)(
  "the $noun grouping engine's template substitution",
  (engine: EngineCase) => {
    const source: string = fs
      .readFileSync(
        path.resolve(__dirname, "../../../Server/Services", engine.engineFile),
        "utf8",
      )
      .replace(/\s+/g, "");

    test.each(
      engine.staticVariables.map((variable: TemplateVariable): string => {
        return variable.name;
      }),
    )(
      "puts {{%s}} in literally - once, in the template it stores, which every title is written from",
      (placeholder: string) => {
        const literal: string = `replaceAllLiterally(result,/\\{\\{${placeholder}\\}\\}/g,values.${placeholder},)`;
        const asPattern: string = `result.replace(/\\{\\{${placeholder}\\}\\}/g,values.${placeholder}`;

        expect(source.split(literal).length - 1).toBe(1);
        expect(source).not.toContain(asPattern);
      },
    );
  },
);
