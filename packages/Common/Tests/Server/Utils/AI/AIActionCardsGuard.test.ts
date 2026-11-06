import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import RunbookService from "../../../../Server/Services/RunbookService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookService from "../../../../Server/Services/SecurityPlaybookService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import {
  AI_ACTION_PLURAL_SENTENCES,
  AI_ACTION_SENTENCES,
  AI_ACTION_TERM_WORDS,
  AIActionSentence,
  AIActionSentenceValue,
  describeAIActionSentence,
  getAIActionPluralTemplate,
  isAIActionList,
  isAIActionTerm,
  isKnownAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { PluralTemplate } from "../../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";

/*
 * NO AI ACTION SHIPS A CARD THE READER CANNOT READ.
 *
 * Before OneUptime AI changes anything, the approval card says what it
 * will do - its title, and a line about what it names - and keeps it as a
 * line of the answer once it ran. The server builds every one of those as
 * a sentence of Types/AI/AIActionWords, which the Dashboard says in the
 * reader's language. So:
 *
 *   - every write tool of the toolbox has a title (the card would
 *     otherwise name the tool: "create_incident");
 *   - every title it builds and every line its prepare writes, for a call
 *     that names records and for one that names none, is a sentence the
 *     Dashboard trusts (isKnownAIActionSentence) - a tool that hands the
 *     card free English text fails here;
 *   - and every sentence, plural and word those are made of is worded in
 *     each of the sixteen Dashboard languages, with its placeholders.
 *
 * A new write tool, or a new sentence, that skips any of it fails this
 * suite, not a German reader.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("abababab-abab-4bab-8bab-abababababab");
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECORD_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// One call that names every record a write tool can name, by real IDs.
const NAMING_CALL: JSONObject = {
  title: "Checkout down",
  description: "p95 above 2s for 10 minutes.",
  severityName: "High",
  incidentId: RECORD_ID,
  alertId: RECORD_ID,
  onCallDutyPolicyId: RECORD_ID,
  runbookId: RECORD_ID,
  securityCaseId: RECORD_ID,
  securityPlaybookId: RECORD_ID,
  note: "Rolled back the deploy.",
  branchName: "fix/checkout",
  commitMessage: "fix: checkout",
  changes: [{ filePath: "src/checkout.ts", content: "x" }],
};

// Asked on host test01's page, as a person of the project.
const ON_A_HOST_PAGE: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
  pageContext: {
    type: AIChatPageContextType.Resource,
    resourceType: AIResourceType.Host,
    entityId: HOST_ID,
    entityTitle: "test01",
  },
};

function writeTools(): Array<ObservabilityTool> {
  return AIToolbox.getTools().filter((tool: ObservabilityTool): boolean => {
    return Boolean(tool.isMutation);
  });
}

// Every record a prepare reads, as the person reads it.
function stubTheReads(): void {
  const host: Host = new Host();
  host._id = HOST_ID;
  host.name = "test01";
  (host as unknown as { isArchived: boolean }).isArchived = false;
  jest.spyOn(HostService, "findBy").mockResolvedValue([host] as never);

  const severity: AlertSeverity = new AlertSeverity();
  severity._id = ObjectID.generate().toString();
  severity.name = "High";
  severity.order = 1;
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([severity] as never);

  const incident: Incident = new Incident();
  incident._id = RECORD_ID;
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);

  const alert: Alert = new Alert();
  alert._id = RECORD_ID;
  alert.alertNumber = 7;
  alert.alertNumberWithPrefix = "ALR-7";
  jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);

  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = RECORD_ID;
  securityCase.caseNumber = 3;
  securityCase.caseNumberWithPrefix = "CASE-3";
  jest
    .spyOn(SecurityCaseService, "findOneById")
    .mockResolvedValue(securityCase);

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy._id = RECORD_ID;
  policy.name = "Checkout on-call";
  jest.spyOn(OnCallDutyPolicyService, "findOneById").mockResolvedValue(policy);

  const runbook: Runbook = new Runbook();
  runbook._id = RECORD_ID;
  runbook.name = "Restart checkout";
  jest.spyOn(RunbookService, "findOneById").mockResolvedValue(runbook);

  const playbook: SecurityPlaybook = new SecurityPlaybook();
  playbook._id = RECORD_ID;
  playbook.name = "Contain host";
  jest
    .spyOn(SecurityPlaybookService, "findOneById")
    .mockResolvedValue(playbook);
}

beforeEach(() => {
  stubTheReads();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const LETTER: RegExp = /\p{L}/u;
const PLACEHOLDER: RegExp = /\{\{[^}]*\}\}/g;

/*
 * Whether a template has words of its own: one that has none ("{{kind}}
 * {{name}}") takes the reader's words for its values, in every language.
 */
function hasWordsOfItsOwn(template: string): boolean {
  return LETTER.test(template.replace(PLACEHOLDER, ""));
}

// Every sentence a card says, the ones inside a list's items included.
function everySentenceOf(sentence: AIActionSentence): Array<AIActionSentence> {
  const sentences: Array<AIActionSentence> = [sentence];

  for (const value of Object.values(sentence.values || {})) {
    const filling: AIActionSentenceValue = value;

    if (isAIActionList(filling)) {
      for (const item of filling.list) {
        sentences.push(...everySentenceOf(item));
      }
    }
  }

  return sentences;
}

function everyTermOf(sentence: AIActionSentence): Array<string> {
  return everySentenceOf(sentence).flatMap(
    (each: AIActionSentence): Array<string> => {
      return Object.values(each.values || {})
        .filter(isAIActionTerm)
        .map((value: { term: string }): string => {
          return value.term;
        });
    },
  );
}

// The keys a sentence is looked up by: its template, and a plural's "one".
function keysOf(sentence: AIActionSentence): Array<string> {
  const plural: PluralTemplate | undefined = getAIActionPluralTemplate(
    sentence.template,
  );

  return plural ? [plural.other, `${plural.other}_one`] : [sentence.template];
}

// What the cards of every write tool say, for a call naming records and one naming none.
async function everyCardSentence(): Promise<
  Array<{ tool: string; sentence: AIActionSentence }>
> {
  const said: Array<{ tool: string; sentence: AIActionSentence }> = [];

  for (const tool of writeTools()) {
    for (const call of [NAMING_CALL, {}]) {
      said.push({ tool: tool.name, sentence: tool.buildActionTitle!(call) });

      if (tool.prepareMutation) {
        const prepared: PreparedMutation = await tool.prepareMutation(
          { ...call },
          ON_A_HOST_PAGE,
        );

        if (prepared.title) {
          said.push({ tool: tool.name, sentence: prepared.title });
        }

        for (const line of prepared.description || []) {
          said.push({ tool: tool.name, sentence: line });
        }
      }
    }
  }

  return said;
}

describe("every write tool names its action on the card", () => {
  test("there are write tools to check", () => {
    expect(writeTools().length).toBeGreaterThanOrEqual(19);
  });

  test.each(
    AIToolbox.getTools()
      .filter((tool: ObservabilityTool): boolean => {
        return Boolean(tool.isMutation);
      })
      .map((tool: ObservabilityTool): string => {
        return tool.name;
      }),
  )("%s has a title", (name: string) => {
    expect(typeof AIToolbox.getToolByName(name)!.buildActionTitle).toBe(
      "function",
    );
  });
});

describe("every card says sentences the Dashboard words", () => {
  test("each title and each line of each write tool is one of the module's sentences", async () => {
    const said: Array<{ tool: string; sentence: AIActionSentence }> =
      await everyCardSentence();

    expect(said.length).toBeGreaterThan(40);

    for (const entry of said) {
      expect({
        tool: entry.tool,
        template: entry.sentence.template,
        isKnown: isKnownAIActionSentence(entry.sentence),
      }).toEqual({
        tool: entry.tool,
        template: entry.sentence.template,
        isKnown: true,
      });
    }
  });

  test("the English a card keeps fills every placeholder", async () => {
    for (const entry of await everyCardSentence()) {
      const english: string = describeAIActionSentence(entry.sentence);

      expect(english.trim().length).toBeGreaterThan(0);
      expect(english).not.toContain("{{");
    }
  });

  test("a call that names records gets them named on its card by the number or the name the person knows", async () => {
    const titles: Array<string> = [];

    for (const tool of writeTools()) {
      if (!tool.prepareMutation) {
        continue;
      }

      const prepared: PreparedMutation = await tool.prepareMutation(
        { ...NAMING_CALL },
        ON_A_HOST_PAGE,
      );

      if (prepared.title) {
        titles.push(describeAIActionSentence(prepared.title));
      }
    }

    for (const title of titles) {
      expect(title).not.toContain(RECORD_ID);
    }

    /*
     * A number bare, a name in quotes - and a page or a run names the
     * incident it is for too.
     */
    expect(titles).toEqual(
      expect.arrayContaining([
        "Acknowledge incident INC-42",
        "Resolve alert ALR-7",
        "Link incident INC-42 to affected resources",
        'Page on-call policy "Checkout on-call" for incident INC-42',
        'Run runbook "Restart checkout" for incident INC-42',
        "Add a note to security case CASE-3",
        'Run playbook "Contain host" on security case CASE-3',
      ]),
    );
  });

  test("every word a card puts in a sentence is one of the module's terms", async () => {
    for (const entry of await everyCardSentence()) {
      for (const term of everyTermOf(entry.sentence)) {
        expect(AI_ACTION_TERM_WORDS).toContain(term);
      }
    }
  });
});

describe("every sentence and word a card is made of is worded in every Dashboard language", () => {
  const english: Record<string, string> = readDashboardLocale("en");

  const sentenceKeys: Array<[string, string]> = [
    ...AI_ACTION_SENTENCES.filter((template: string): boolean => {
      return hasWordsOfItsOwn(template);
    }).map((template: string): [string, string] => {
      return [template, template];
    }),
    ...AI_ACTION_PLURAL_SENTENCES.flatMap(
      (plural: PluralTemplate): Array<[string, string]> => {
        return [
          [plural.other, plural.other],
          [`${plural.other}_one`, plural.one],
        ];
      },
    ),
    ...AI_ACTION_TERM_WORDS.map((term: string): [string, string] => {
      return [term, term];
    }),
  ];

  test.each(sentenceKeys)(
    "English holds %s as itself",
    (key: string, value: string) => {
      expect(english[key]).toBe(value);
    },
  );

  describe.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);

    test.each(sentenceKeys)(
      "words %s, with its placeholders",
      (key: string, value: string) => {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
        expect(placeholdersOf(words[key]!)).toEqual(placeholdersOf(value));
      },
    );
  });

  test("every sentence a write tool's card says is among them", async () => {
    const declared: Set<string> = new Set(
      sentenceKeys.map((entry: [string, string]): string => {
        return entry[0];
      }),
    );

    for (const entry of await everyCardSentence()) {
      for (const sentence of everySentenceOf(entry.sentence)) {
        for (const key of keysOf(sentence)) {
          if (hasWordsOfItsOwn(key)) {
            expect(declared.has(key)).toBe(true);
          }
        }
      }
    }
  });
});
