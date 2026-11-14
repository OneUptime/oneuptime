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
import ToolApprovalCard, {
  argsPreview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import {
  getActionArgumentParts,
  MAX_ARGUMENT_VALUE_LENGTH,
  TOOL_ARGUMENT_LABELS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import ResourceCardWidget from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ResourceCardWidget";
import WidgetBuilder from "../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_PLURAL_SENTENCES,
  AI_ACTION_TERM_WORDS,
  AI_ACTION_TITLES,
  aiActionCardFact,
  aiActionList,
  aiActionResourceByName,
  aiActionSentence,
  aiActionTerm,
  describeAIActionWords,
  isKnownAIActionCardWords,
} from "../../../Types/AI/AIActionWords";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
} from "../../../Types/AI/AIChatTypes";
import { createTranslator, PluralTemplate } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * ASK AI'S CARDS, READ AT A GLANCE (fu-ask-ai-polish's UI review).
 *
 * The approval card is where a person decides, and the card an action
 * leaves is what they read back:
 *
 *   - The approval card ran its arguments together on one line cut at two:
 *     a public status update's note was cut at 80 characters, and its
 *     "Notify subscribers: Yes" fell off the end on a phone - never seen
 *     before the update was approved. Each argument is now a line of its
 *     own (a name and its value, wrapping to four lines), read whole up to
 *     MAX_ARGUMENT_VALUE_LENGTH, in the card's own face rather than
 *     monospace: a note is prose.
 *   - The card an action leaves set each fact beside its name on every
 *     width: on a phone a German name ("Betroffene Ressourcen") left the
 *     value a third of the card. Its facts stack under their names below
 *     22rem, and the names are gray-500, readable on the card's green.
 *   - Starting a playbook said "Steps: 4 steps" under its line, the word
 *     twice and nothing to act on: the card says which playbook started,
 *     and that the steps needing approval wait on the case.
 */

const DE: Record<string, string> = readDashboardLocale("de");

const NOTE: string =
  "We have found the cause of the slow checkouts and are rolling out a fix. Payments are not affected, and orders placed in the last hour will go through.";

function statusUpdateAction(): AIChatToolAction {
  const words: {
    title: ReturnType<typeof aiActionSentence>;
    namedArguments: Array<string>;
  } = {
    title: aiActionSentence(AI_ACTION_TITLES.postIncidentStatusUpdate, {
      incident: "INC-42",
    }),
    namedArguments: ["incidentId"],
  };
  const english: { title: string; description?: string | undefined } =
    describeAIActionWords(words);

  return {
    id: "call-status",
    toolName: "post_incident_status_update",
    title: english.title,
    words,
    arguments: {
      incidentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      note: NOTE,
      notifySubscribers: true,
    },
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Pending,
  };
}

function renderCard(toolActions: Array<AIChatToolAction>): void {
  render(
    <ToolApprovalCard
      toolActions={toolActions}
      interactive={true}
      isSubmitting={false}
      onRespond={(): void => {}}
    />,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { de: { translation: DE } },
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

describe("the approval card's arguments, a line each", () => {
  test("each argument is a row of its own: its name, then its value", () => {
    renderCard([statusUpdateAction()]);

    const list: HTMLElement = screen.getByTestId("tool-approval-arguments");
    expect(list.tagName).toBe("DL");

    const rows: Array<HTMLElement> = within(list).getAllByTestId(
      "tool-approval-argument",
    );
    expect(
      rows.map((row: HTMLElement): string => {
        return row.textContent || "";
      }),
    ).toEqual([`Status update: ${NOTE}`, "Notify subscribers: Yes"]);

    for (const row of rows) {
      expect(row.tagName).toBe("DIV");
      expect(
        within(row).getByTestId("tool-approval-argument-label").tagName,
      ).toBe("DT");
      expect(
        within(row).getByTestId("tool-approval-argument-value").tagName,
      ).toBe("DD");
    }
  });

  test("whether subscribers hear of a public update has a row of its own, never the end of a cut line", () => {
    renderCard([statusUpdateAction()]);

    const notify: HTMLElement = screen
      .getAllByTestId("tool-approval-argument")
      .find((row: HTMLElement): boolean => {
        return (row.textContent || "").startsWith("Notify subscribers");
      })!;

    expect(notify).toBeDefined();
    // Clamped on its own, after the note's own row.
    expect(notify.className).toContain("line-clamp-4");
    expect(notify.className).toContain("break-words");
    expect(notify.previousElementSibling).toHaveTextContent(NOTE);
    expect(
      screen.getByTestId("tool-approval-arguments").className,
    ).not.toContain("line-clamp");
  });

  test("a note is read whole: never cut at 80 characters", () => {
    expect(NOTE.length).toBeGreaterThan(80);
    renderCard([statusUpdateAction()]);

    const value: HTMLElement = screen.getAllByTestId(
      "tool-approval-argument-value",
    )[0]!;
    expect(value.textContent).toBe(NOTE);
    expect(value.textContent).not.toContain("…");
  });

  test("a very long value is cut at the limit, with an ellipsis", () => {
    const long: string = "x".repeat(MAX_ARGUMENT_VALUE_LENGTH * 3);
    const parts: Array<{ value: string }> = getActionArgumentParts(
      { description: long },
      {},
      createTranslator(undefined),
    );

    expect(parts[0]!.value).toBe(`${"x".repeat(MAX_ARGUMENT_VALUE_LENGTH)}…`);
    // What a screen reader reads of a pull request's description, at most.
    expect(MAX_ARGUMENT_VALUE_LENGTH).toBeGreaterThanOrEqual(300);
  });

  test("no argument is in monospace: a note is prose", () => {
    renderCard([
      statusUpdateAction(),
      {
        id: "call-commit",
        toolName: "commit_code_to_branch",
        title: "Commit 1 file to fix/checkout",
        arguments: {
          branchName: "fix/checkout",
          commitMessage: "fix: release the pool after a failover",
          changes: [{ filePath: "src/a.ts", content: "a" }],
        },
        isMutation: true,
        requiresApproval: true,
        status: AIChatToolActionStatus.Pending,
      },
    ]);

    for (const list of screen.getAllByTestId("tool-approval-arguments")) {
      expect(list.querySelector(".font-mono")).toBeNull();
      expect(list.innerHTML).not.toContain("font-mono");
    }
  });

  test("names in grey, values darker: the value is what is approved", () => {
    renderCard([statusUpdateAction()]);

    for (const label of screen.getAllByTestId("tool-approval-argument-label")) {
      expect(label).toHaveClass("text-gray-500");
    }

    for (const value of screen.getAllByTestId("tool-approval-argument-value")) {
      expect(value).toHaveClass("text-gray-700");
    }
  });

  test("in German, each row is named in German", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    renderCard([statusUpdateAction()]);

    expect(
      screen
        .getAllByTestId("tool-approval-argument")
        .map((row: HTMLElement): string => {
          return row.textContent || "";
        }),
    ).toEqual([
      `${DE["Status update"]}: ${NOTE}`,
      `${DE["Notify subscribers"]}: ${DE["Yes"]}`,
    ]);

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  /*
   * A public status update's text is the update itself: beside a private
   * note on the same card, two rows read "Note:". It is named as the card
   * it leaves names it.
   */
  test("a public update's text is named Status update, a private note Note", () => {
    renderCard([
      statusUpdateAction(),
      {
        id: "call-note",
        toolName: "create_incident_note",
        title: "Add private internal note to incident INC-42",
        arguments: {
          incidentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          note: "Restarted pgbouncer.",
        },
        isMutation: true,
        requiresApproval: true,
        status: AIChatToolActionStatus.Pending,
      },
    ]);

    expect(
      screen
        .getAllByTestId("tool-approval-argument-label")
        .map((label: HTMLElement): string => {
          return label.textContent || "";
        }),
    ).toEqual(["Status update:", "Notify subscribers:", "Incident:", "Note:"]);
  });

  test("a tool's own names are worded in every Dashboard language", () => {
    for (const labels of Object.values(TOOL_ARGUMENT_LABELS)) {
      for (const label of Object.values(labels)) {
        for (const language of DASHBOARD_LANGUAGES) {
          expect({
            language,
            label,
            worded: isWordedInDashboardLocale(label, language),
          }).toEqual({ language, label, worded: true });
        }
      }
    }
  });

  test("written on one line, as text, they are still set apart", () => {
    expect(
      argsPreview(
        { note: "Rolled back.", notifySubscribers: false },
        {},
        dashboardTranslator("de"),
      ),
    ).toBe(
      `${DE["Note"]}: Rolled back.  ·  ${DE["Notify subscribers"]}: ${DE["No"]}`,
    );
  });
});

describe("the card an action leaves: its facts beside their names, or under them", () => {
  function linkedAlertCard(): AIChatWidget {
    return {
      ...WidgetBuilder.actionCard({
        title: "Alert created",
        heading: "ALT-12 · Disk on payments-db filling up",
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.alert),
          line: [
            aiActionSentence(AI_ACTION_CARD_LINES.severity, {
              severity: "High",
            }),
          ],
          facts: [
            aiActionCardFact(
              AI_ACTION_CARD_FACTS.affectedResources,
              aiActionList([
                aiActionResourceByName({
                  noun: "database server",
                  name: "payments-db",
                }),
              ]),
            ),
            aiActionCardFact(
              AI_ACTION_CARD_FACTS.description,
              "Disk use went from 71% to 88% in six hours.",
            ),
          ],
        },
      }),
      id: "W1",
    };
  }

  test("each fact is its name and its value, kept together", () => {
    render(<ResourceCardWidget widget={linkedAlertCard()} />);

    const facts: HTMLElement = screen.getByTestId(
      "ai-chat-resource-card-facts",
    );
    expect(facts.tagName).toBe("DL");

    const pairs: Array<HTMLElement> = within(facts).getAllByTestId(
      "ai-chat-resource-card-fact",
    );
    expect(
      pairs.map((pair: HTMLElement): Array<string> => {
        return [
          within(pair).getByTestId("ai-chat-resource-card-fact-label")
            .textContent || "",
          within(pair).getByTestId("ai-chat-resource-card-fact-value")
            .textContent || "",
        ];
      }),
    ).toEqual([
      ["Affected resources", 'database server "payments-db"'],
      ["Description", "Disk use went from 71% to 88% in six hours."],
    ]);
  });

  test("beside their names from 22rem of card, under them on a phone", () => {
    render(<ResourceCardWidget widget={linkedAlertCard()} />);

    const facts: HTMLElement = screen.getByTestId(
      "ai-chat-resource-card-facts",
    );

    // The card's text is the size container its facts are laid out by.
    expect(facts.parentElement!.className).toContain(
      "[container-type:inline-size]",
    );
    // Stacked by default: one pair under the other, each name over its value.
    expect(facts.className).toContain("space-y-1.5");
    expect(facts.className.split(" ")).not.toContain("grid");
    // Two columns where the card has room.
    expect(facts.className).toContain("[@container(min-width:22rem)]:grid");
    /*
     * The names take at most 40% of the card, and wrap there: a long
     * name never leaves the values a narrow column (issue #7175).
     */
    expect(facts.className).toContain(
      "[@container(min-width:22rem)]:grid-cols-[fit-content(40%)_minmax(0,1fr)]",
    );
    expect(facts.className).not.toContain("grid-cols-[auto");
    for (const label of within(facts).getAllByTestId(
      "ai-chat-resource-card-fact-label",
    )) {
      expect(label.className).toContain("break-words");
      expect(label.className).toContain("min-w-0");
    }
    // A value takes up to four lines: an escalation rule's sentence whole.
    for (const value of within(facts).getAllByTestId(
      "ai-chat-resource-card-fact-value",
    )) {
      expect(value.className).toContain("line-clamp-4");
      expect(value.className).not.toContain("line-clamp-2");
    }

    for (const pair of within(facts).getAllByTestId(
      "ai-chat-resource-card-fact",
    )) {
      // Its own box when stacked; its name and value grid cells beside.
      expect(pair.className).toBe("[@container(min-width:22rem)]:contents");
    }
  });

  test("a fact's name reads on the card's green: gray-500, never gray-400", () => {
    const { container } = render(
      <ResourceCardWidget widget={linkedAlertCard()} />,
    );

    for (const label of screen.getAllByTestId(
      "ai-chat-resource-card-fact-label",
    )) {
      expect(label).toHaveClass("text-gray-500");
    }

    expect(container.innerHTML).not.toContain("text-gray-400");
  });
});

describe("a playbook's card says which started, not how many steps", () => {
  test("no fact of the card counts steps", () => {
    expect(Object.keys(AI_ACTION_CARD_FACTS)).not.toContain("steps");
    expect(AI_ACTION_TERM_WORDS).toContain(AI_ACTION_CARD_FACTS.note);
    expect(
      AI_ACTION_PLURAL_SENTENCES.some((plural: PluralTemplate): boolean => {
        return plural.other === "{{count}} steps";
      }),
    ).toBe(false);
  });

  test("a card saved with a step count reads as the English it stores", () => {
    expect(
      isKnownAIActionCardWords({
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.securityCase),
        facts: [{ label: aiActionTerm("Steps"), value: "4 steps" }],
      }),
    ).toBe(false);
  });

  test("the step count's own key is gone from the Dashboard's words", () => {
    for (const language of ["en", "de", "fa", "ja"]) {
      expect(
        Object.keys(readDashboardLocale(language)).includes("{{count}} step"),
      ).toBe(false);
    }
  });
});
