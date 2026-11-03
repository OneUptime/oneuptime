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
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AIActionCardWords,
  aiActionSentence,
  aiActionTerm,
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
