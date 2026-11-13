import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import {
  DrawnResourceCard,
  getDrawnResourceCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ResourceCardWords";
import WidgetBuilder from "../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  describeLinkingCard,
  describeNewRecordCard,
  NewRecordStart,
} from "../../../Server/Utils/AI/Toolbox/NewRecords";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  aiActionCardFact,
  AIActionCardWords,
  aiActionSentence,
  aiActionTerm,
  withCurrentAIActionCardLines,
} from "../../../Types/AI/AIActionWords";
import { AiAffectedResourceKind } from "../../../Types/AI/AiAffectedResources";
import {
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE CARD A WRITE LEAVES, IN THE READER'S LANGUAGE (#5623's follow-up).
 *
 * Under an answer, the card an action left said what it made in the
 * server's English - "INCIDENT", "Severity: High", "Affected resources",
 * 'host "test01"' - in the middle of a German or Persian page. The card now
 * stores its kind, its line and its facts as the module's terms and
 * sentences (WidgetBuilder.actionCard), and the Dashboard says them in the
 * reader's language: the record's number and title, a host's name and the
 * note the model wrote stay as written. A card saved before it had words,
 * or with words the module does not know, reads as its stored English,
 * each fact once.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");
const JA: Record<string, string> = readDashboardLocale("ja");

const INCIDENT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fill(
  words: Record<string, string>,
  key: string,
  values: Record<string, string>,
): string {
  let text: string = words[key]!;

  expect({ key, worded: Boolean(text) }).toEqual({ key, worded: true });

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name]!);
  }

  return text;
}

// The card create_incident leaves for an incident written up after the fact.
function declaredCard(): AIChatWidget {
  return {
    ...WidgetBuilder.actionCard({
      title: "Incident created",
      heading: "INC-42 · Checkout down",
      words: describeNewRecordCard({
        kind: AI_ACTION_CARD_KINDS.incident,
        severityName: "SEV2",
        start: NewRecordStart.Resolved,
        linked: [
          {
            kind: AiAffectedResourceKind.Host,
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "test01",
          },
          {
            kind: AiAffectedResourceKind.KubernetesCluster,
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            name: "prod",
          },
        ],
        description: "Checkout was down for 20 minutes.",
      }),
      link: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: INCIDENT_ID },
      },
    }),
    id: "W1",
  };
}

// A card as a conversation saved before cards had words keeps it.
function savedBeforeWords(): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.ResourceCard,
    title: "Alert created",
    data: {
      resourceType: "Alert",
      heading: "ALT-12 · High memory usage on test01",
      subheading: "Severity: High",
      fields: [
        { label: "Number", value: "ALT-12" },
        { label: "Severity", value: "High" },
        { label: "Affected resources", value: 'host "test01"' },
      ],
    },
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      ja: { translation: JA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

describe("the card's English, as the exports print it and an English reader reads it", () => {
  beforeAll(async () => {
    await inLanguage("en");
  });

  test("the kind, the line and the facts, from its words", () => {
    render(<WidgetRenderer widgets={[declaredCard()]} />);

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      "Incident",
    );
    expect(
      screen.getByTestId("ai-chat-resource-card-heading"),
    ).toHaveTextContent("INC-42 · Checkout down");
    expect(screen.getByTestId("ai-chat-resource-card-line")).toHaveTextContent(
      "Severity: SEV2 · Started resolved",
    );

    const labels: Array<string> = screen
      .getAllByTestId("ai-chat-resource-card-fact-label")
      .map((label: HTMLElement): string => {
        return label.textContent || "";
      });
    expect(labels).toEqual(["Affected resources", "Description"]);
    expect(
      screen.getAllByTestId("ai-chat-resource-card-fact-value")[0],
    ).toHaveTextContent('host "test01", Kubernetes cluster "prod"');
  });

  test("the English it stores beside its words says the same", () => {
    const card: AIChatWidget = declaredCard();

    expect(card.data.resourceType).toBe("Incident");
    expect(card.data.subheading).toBe("Severity: SEV2 · Started resolved");
    expect(card.data.fields).toEqual([
      {
        label: "Affected resources",
        value: 'host "test01", Kubernetes cluster "prod"',
      },
      { label: "Description", value: "Checkout was down for 20 minutes." },
    ]);
  });
});

describe("in German", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  test("every word of the card is German; the number, the title and the names stay as written", () => {
    render(<WidgetRenderer widgets={[declaredCard()]} />);

    const card: HTMLElement = screen.getByTestId("ai-chat-resource-card");

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      DE["Incident"]!,
    );
    expect(
      withoutIsolateMarks(
        screen.getByTestId("ai-chat-resource-card-line").textContent || "",
      ),
    ).toBe(
      `${fill(DE, "Severity: {{severity}}", { severity: "SEV2" })} · ${DE["Started resolved"]}`,
    );

    const labels: Array<string> = within(card)
      .getAllByTestId("ai-chat-resource-card-fact-label")
      .map((label: HTMLElement): string => {
        return label.textContent || "";
      });
    expect(labels).toEqual([DE["Affected resources"], DE["Description"]]);

    // The host's kind in German, its name as written.
    const resources: string = withoutIsolateMarks(
      within(card).getAllByTestId("ai-chat-resource-card-fact-value")[0]!
        .textContent || "",
    );
    expect(resources).toContain('"test01"');
    expect(resources).toContain('"prod"');
    expect(resources).toContain(
      dashboardTranslator("de").translateTerm("host", { inSentence: true }),
    );

    // The note the model wrote is data.
    expect(card).toHaveTextContent("Checkout was down for 20 minutes.");

    for (const english of [
      "Severity:",
      "Started resolved",
      "Affected resources",
    ]) {
      expect(card.textContent).not.toContain(english);
    }

    // Open names what it opens, in German.
    expect(
      within(card).getByRole("button", {
        name: fill(DE, "Open {{name}}", { name: "INC-42 · Checkout down" }),
      }),
    ).toBeInTheDocument();
  });

  test("a card saved before cards had words reads as its English, each fact once", () => {
    render(<WidgetRenderer widgets={[savedBeforeWords()]} />);

    const card: HTMLElement = screen.getByTestId("ai-chat-resource-card");
    expect(card).toHaveTextContent("Severity: High");
    expect(card).toHaveTextContent("Affected resources");
    // Said by the heading and the line under it: not again under them.
    expect(within(card).queryByText("Number")).not.toBeInTheDocument();
  });

  test("words the module does not know - another kind, a fact named otherwise, another sentence - read as the stored English", () => {
    const tampered: Array<AIActionCardWords> = [
      { kind: aiActionTerm("Hacked") },
      {
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
        facts: [{ label: aiActionTerm("Password"), value: "x" }],
      },
      {
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
        line: [{ template: "Click {{here}}", values: { here: "x" } }],
      },
    ];

    for (const words of tampered) {
      const widget: AIChatWidget = declaredCard();
      widget.data.words = words;

      const drawn: DrawnResourceCard = getDrawnResourceCard(
        widget,
        dashboardTranslator("de"),
      );

      expect(drawn.isWorded).toBe(false);
      expect(drawn.kind).toBe("Incident");
      expect(
        drawn.line.map((sentence: { text: string }): string => {
          return sentence.text;
        }),
      ).toEqual(["Severity: SEV2 · Started resolved"]);
    }
  });
});

describe("in Persian, right to left", () => {
  beforeAll(async () => {
    await inLanguage("fa");
  });

  test("the line reads right to left, its values set apart; the heading reads the way its letters do", () => {
    render(
      <WidgetRenderer
        widgets={[
          {
            ...WidgetBuilder.actionCard({
              title: "Incident acknowledged",
              heading: "INC-42 · Checkout down",
              words: {
                kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
                line: [aiActionSentence(AI_ACTION_CARD_LINES.nowAcknowledged)],
              },
            }),
            id: "W1",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      FA["Incident"]!,
    );

    const line: HTMLElement = screen.getByTestId("ai-chat-resource-card-line");
    expect(line.querySelector("bdi")).toHaveAttribute("dir", "rtl");
    expect(line).toHaveTextContent(FA["Now acknowledged"]!);

    // The English title, an isolate read left to right in a Persian page.
    expect(
      screen.getByTestId("ai-chat-resource-card-heading").querySelector("bdi"),
    ).toHaveAttribute("dir", "ltr");
  });
});

describe("in Japanese", () => {
  beforeAll(async () => {
    await inLanguage("ja");
  });

  test("the resources linked are listed the way Japanese lists them", () => {
    render(
      <WidgetRenderer
        widgets={[
          {
            ...WidgetBuilder.actionCard({
              title: "Affected resources linked",
              heading: "INC-42 · Checkout down",
              words: describeLinkingCard({
                kind: AI_ACTION_CARD_KINDS.incident,
                added: [
                  {
                    kind: AiAffectedResourceKind.Host,
                    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    name: "test01",
                  },
                  {
                    kind: AiAffectedResourceKind.Host,
                    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                    name: "test02",
                  },
                ],
                alreadyLinked: [],
              }),
            }),
            id: "W1",
          },
        ]}
      />,
    );

    const line: string = withoutIsolateMarks(
      screen.getByTestId("ai-chat-resource-card-line").textContent || "",
    );
    expect(line).toContain("、");
    expect(line).not.toContain(", ");
    expect(line).not.toContain("Linked to");
  });
});

/*
 * A PRIVATE NOTE'S CARD SAVED WHEN ITS LINE SAID A TEAM (#7595).
 *
 * The card create_incident_note and create_alert_note left said "Private
 * note added, for your team only", which read as one of OneUptime's Teams.
 * The line is now its record's - "only for people who can see the
 * incident" - and no locale file words the old one. A conversation saved
 * before keeps the old line in its card's words: the card reads as its
 * record's line now, in the reader's language, not as the English it
 * stored.
 */
describe("a private note's card saved when its line said a team", () => {
  const RETIRED_LINE: string = "Private note added, for your team only";

  // The card a note tool left before the line was reworded.
  function savedNoteCard(
    kind: string,
    line: string = RETIRED_LINE,
  ): AIChatWidget {
    return {
      ...WidgetBuilder.actionCard({
        title: "Internal note added",
        heading: "INC-42 · Checkout down",
        words: {
          kind: aiActionTerm(kind),
          line: [aiActionSentence(line)],
          facts: [
            aiActionCardFact(
              AI_ACTION_CARD_FACTS.note,
              "Rolled back the deploy.",
            ),
          ],
        },
      }),
      id: "W1",
    };
  }

  function drawnLine(widget: AIChatWidget, language: string): Array<string> {
    return getDrawnResourceCard(widget, dashboardTranslator(language)).line.map(
      (sentence: { text: string }): string => {
        return withoutIsolateMarks(sentence.text);
      },
    );
  }

  test("as it was saved: its English says the old line, which no file words any more", () => {
    const card: AIChatWidget = savedNoteCard(AI_ACTION_CARD_KINDS.incident);

    expect(card.data.subheading).toBe(RETIRED_LINE);
    expect(Object.values(AI_ACTION_CARD_LINES)).not.toContain(RETIRED_LINE);
    expect(readDashboardLocale("en")[RETIRED_LINE]).toBeUndefined();
    expect(DE[RETIRED_LINE]).toBeUndefined();
  });

  test("an incident's reads as the incident's line, an alert's as the alert's, in German", () => {
    const incident: DrawnResourceCard = getDrawnResourceCard(
      savedNoteCard(AI_ACTION_CARD_KINDS.incident),
      dashboardTranslator("de"),
    );

    expect(incident.isWorded).toBe(true);
    expect(incident.kind).toBe(DE["Incident"]);
    expect(
      drawnLine(savedNoteCard(AI_ACTION_CARD_KINDS.incident), "de"),
    ).toEqual([DE[AI_ACTION_CARD_LINES.privateNoteAddedToIncident]]);
    expect(drawnLine(savedNoteCard(AI_ACTION_CARD_KINDS.alert), "de")).toEqual([
      DE[AI_ACTION_CARD_LINES.privateNoteAddedToAlert],
    ]);
    expect(DE[AI_ACTION_CARD_LINES.privateNoteAddedToIncident]).toContain(
      "den Vorfall",
    );
    expect(DE[AI_ACTION_CARD_LINES.privateNoteAddedToAlert]).toContain(
      "die Warnung",
    );
  });

  test("on the page, in German: no English, no team", async () => {
    await inLanguage("de");
    render(
      <WidgetRenderer
        widgets={[savedNoteCard(AI_ACTION_CARD_KINDS.incident)]}
      />,
    );

    const line: string = withoutIsolateMarks(
      screen.getByTestId("ai-chat-resource-card-line").textContent || "",
    );

    expect(line).toBe(DE[AI_ACTION_CARD_LINES.privateNoteAddedToIncident]);
    expect(line).not.toContain("Team");
    expect(screen.getByTestId("ai-chat-resource-card")).not.toHaveTextContent(
      "for your team only",
    );
  });

  test("in English, the record's line, never the team", () => {
    expect(
      drawnLine(savedNoteCard(AI_ACTION_CARD_KINDS.incident), "en"),
    ).toEqual(["Private note added, only for people who can see the incident"]);
    expect(drawnLine(savedNoteCard(AI_ACTION_CARD_KINDS.alert), "en")).toEqual([
      "Private note added, only for people who can see the alert",
    ]);
  });

  test("only the old line of a note's card reads anew; anything else is as stored", () => {
    // Another kind's card never held the line: it reads as stored.
    const runbook: AIChatWidget = savedNoteCard(AI_ACTION_CARD_KINDS.runbook);
    expect(getDrawnResourceCard(runbook, dashboardTranslator("de"))).toEqual(
      expect.objectContaining({ isWorded: false, kind: "Runbook" }),
    );
    expect(drawnLine(runbook, "de")).toEqual([RETIRED_LINE]);

    // The old line filled with values is not a line the tools wrote.
    const filled: AIChatWidget = savedNoteCard(AI_ACTION_CARD_KINDS.incident);
    filled.data.words!.line = [
      aiActionSentence(RETIRED_LINE, { incident: "INC-42" }),
    ];
    expect(
      getDrawnResourceCard(filled, dashboardTranslator("de")).isWorded,
    ).toBe(false);

    // A card whose words are the module's today is left as it is.
    const current: AIActionCardWords = savedNoteCard(
      AI_ACTION_CARD_KINDS.incident,
      AI_ACTION_CARD_LINES.privateNoteAddedToIncident,
    ).data.words!;
    expect(withCurrentAIActionCardLines(current)).toBe(current);

    // Not a card's words at all: as stored.
    for (const value of [undefined, null, "line", { line: "x" }, { kind: 1 }]) {
      expect(withCurrentAIActionCardLines(value)).toBe(value);
    }
  });

  test("the card's stored words are left as saved: a copy reads anew", () => {
    const card: AIChatWidget = savedNoteCard(AI_ACTION_CARD_KINDS.alert);
    const saved: string = JSON.stringify(card.data.words);

    getDrawnResourceCard(card, dashboardTranslator("de"));

    expect(JSON.stringify(card.data.words)).toBe(saved);
  });
});
