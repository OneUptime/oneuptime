import { describe, expect, test } from "@jest/globals";
import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import { buildPageContextSection } from "../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import { QueryAlertsTool } from "../../../Server/Utils/AI/Toolbox/AlertTools";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";

/*
 * Ask AI renders the suggested prompt cards in PageContextUtil.getSuggestions
 * as first-class buttons: one click sends that exact question. Nothing in the
 * type system ties a card to a capability the model actually has, and the two
 * halves live in different packages — the deck in the dashboard bundle, the
 * per-page capability claim the server injects into the system prompt in
 * Common/Server.
 *
 * Issue #3552 is what that gap looks like in production. The incidents list
 * offered "Active incidents — Which incidents are currently active or
 * unresolved?", while the page guidance summarised the very tool that answers
 * it as "query_incidents (recent incidents, or one by incidentId)". The tool
 * itself had always supported state="active"; the prompt described it as
 * narrower than it was, and the model dutifully paraphrased the prompt back at
 * the user: it had no way to list active incidents and needed an incidentId.
 * The product shipped a button that made the assistant deny the feature.
 *
 * These tests are the structural guard for that whole class of bug: a card the
 * model has not been told it can answer.
 */

// Valid-shaped ids so entity contexts route through the entity guidance.
const ENTITY_ID: string = "0f10509d-6656-4a08-b957-235fd4e8c52e";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

/*
 * Tool names are the one thing every page guidance must carry — snake_case
 * identifiers like query_incidents or log_histogram. Guidance that names no
 * tool tells the model nothing it can act on.
 */
const TOOL_NAME_REGEX: RegExp = /\b[a-z]+(?:_[a-z]+)+\b/;

// A card's question is either a question or a complete instruction.
const COMPLETE_SENTENCE_REGEX: RegExp = /^[A-Z].*[?.]$/;

// Card matchers, as named constants so they read as intent rather than syntax.
const MENTIONS_AN_INCIDENT: RegExp = /incident/i;
const ASKS_FOR_UNFINISHED_WORK: RegExp = /\b(active|unresolved|open)\b/i;
const MENTIONS_A_SOURCE: RegExp = /monitor|source/i;

/*
 * The card title is rendered on a single line in a half-width grid cell, so it
 * has to stay short — this is a layout constraint, not a copy preference.
 */
const MAX_TITLE_LENGTH: number = 32;

const ALL_PAGE_CONTEXT_TYPES: Array<AIChatPageContextType> = Object.values(
  AIChatPageContextType,
);

function buildContext(type: AIChatPageContextType): DashboardPageContext {
  const isEntity: boolean = AIChatPageContextHelper.isEntityType(type);

  return {
    type: type,
    noun: "thing",
    chipLabel: "Thing",
    icon: IconProp.Alert,
    isEntity: isEntity,
    ...(isEntity
      ? {
          entityId: type === AIChatPageContextType.Trace ? TRACE_ID : ENTITY_ID,
        }
      : {}),
  };
}

function getDeck(type: AIChatPageContextType): Array<SuggestedQuestion> {
  return PageContextUtil.getSuggestions(buildContext(type));
}

function getGuidance(type: AIChatPageContextType): string {
  return buildPageContextSection(buildContext(type));
}

const TYPES_WITH_A_DECK: Array<AIChatPageContextType> =
  ALL_PAGE_CONTEXT_TYPES.filter((type: AIChatPageContextType): boolean => {
    return getDeck(type).length > 0;
  });

// test.each rows have to be tuples, so wrap each type in a one-column row.
const DECK_ROWS: Array<[AIChatPageContextType]> = TYPES_WITH_A_DECK.map(
  (type: AIChatPageContextType): [AIChatPageContextType] => {
    return [type];
  },
);

describe("Ask AI suggested prompts are backed by capabilities the model is told about", () => {
  /*
   * The exact pairing #3552 broke, asserted as one invariant because that is
   * what it is: the card is only honest if the guidance names the argument
   * that answers it. Either half alone passes happily while the product lies
   * to the user.
   *
   * Fails on the pre-fix prompt, which said "recent incidents, or one by
   * incidentId" and never mentioned state="active".
   */
  test('the incidents list offers an "active incidents" card AND its guidance names state="active"', () => {
    const deck: Array<SuggestedQuestion> = getDeck(
      AIChatPageContextType.IncidentsList,
    );

    const activeIncidentsCard: SuggestedQuestion | undefined = deck.find(
      (suggestion: SuggestedQuestion): boolean => {
        return (
          MENTIONS_AN_INCIDENT.test(suggestion.question) &&
          ASKS_FOR_UNFINISHED_WORK.test(suggestion.question)
        );
      },
    );

    expect(activeIncidentsCard).toBeDefined();

    const guidance: string = getGuidance(AIChatPageContextType.IncidentsList);

    expect(guidance).toContain("query_incidents");
    expect(guidance).toContain('state="active"');

    /*
     * The exact regression: describing query_incidents as only "recent
     * incidents, or one by incidentId" is the sentence the model paraphrased
     * back as "I have no tool for that, give me an incidentId".
     */
    expect(guidance).not.toContain("recent incidents, or one by incidentId");
  });

  /*
   * Three list pages lead with a "what is broken RIGHT NOW" card, and each
   * needs a different argument to answer it. The narrow-capability-claim bug
   * was identical on all three, so pin all three rather than only the one the
   * issue happened to be filed against.
   *
   * All three rows fail on the pre-fix prompt, which named the tool but none
   * of these arguments.
   */
  test.each<[AIChatPageContextType, RegExp, string]>([
    [
      AIChatPageContextType.IncidentsList,
      /\b(active|unresolved)\b/i,
      'state="active"',
    ],
    [AIChatPageContextType.AlertsList, /\b(open|active)\b/i, 'state="active"'],
    [
      AIChatPageContextType.MonitorsList,
      /not operational|right now/i,
      "problemsOnly=true",
    ],
  ])(
    "%s: the guidance names the argument its right-now card depends on",
    (
      type: AIChatPageContextType,
      cardQuestion: RegExp,
      affordance: string,
    ): void => {
      const deck: Array<SuggestedQuestion> = getDeck(type);

      const rightNowCard: SuggestedQuestion | undefined = deck.find(
        (suggestion: SuggestedQuestion): boolean => {
          return cardQuestion.test(suggestion.question);
        },
      );

      expect(rightNowCard).toBeDefined();
      expect(getGuidance(type)).toContain(affordance);
    },
  );

  /*
   * Every page that offers cards must also give the model page-scoped
   * guidance. A page with a deck and an empty section is the same defect as
   * #3552 in a different place: the user is invited to ask, and the model is
   * told nothing about where the answer lives. Guard — both halves have always
   * been populated for every type, and this keeps the next page from shipping
   * with only one of them.
   */
  test("every page context type is either silent or offers both cards and guidance", () => {
    expect(TYPES_WITH_A_DECK.length).toBeGreaterThan(0);

    const typesMissingGuidance: Array<AIChatPageContextType> =
      TYPES_WITH_A_DECK.filter((type: AIChatPageContextType): boolean => {
        return getGuidance(type).trim().length === 0;
      });

    expect(typesMissingGuidance).toEqual([]);
  });

  /*
   * Guidance that names no tool is guidance the model cannot act on — it can
   * only fall back to "I don't have a way to do that", which is exactly the
   * user-visible symptom of #3552. Guard.
   */
  test.each<[AIChatPageContextType]>(DECK_ROWS)(
    "%s guidance names at least one tool",
    (type: AIChatPageContextType): void => {
      expect(getGuidance(type)).toMatch(TOOL_NAME_REGEX);
    },
  );

  /*
   * Card hygiene. The question string is sent verbatim to the model when the
   * card is clicked, so a blank or fragmentary one is a broken button; the
   * title is the card's only label and ChatHomeView keys the rendered list by
   * it, so duplicates within a deck collide as React keys. Guard.
   */
  test.each<[AIChatPageContextType]>(DECK_ROWS)(
    "%s cards are well formed and uniquely titled",
    (type: AIChatPageContextType): void => {
      const deck: Array<SuggestedQuestion> = getDeck(type);

      for (const suggestion of deck) {
        expect(suggestion.title.trim().length).toBeGreaterThan(0);
        expect(suggestion.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
        expect(suggestion.question.trim()).toMatch(COMPLETE_SENTENCE_REGEX);
      }

      const titles: Array<string> = deck.map(
        (suggestion: SuggestedQuestion): string => {
          return suggestion.title;
        },
      );

      expect(new Set(titles).size).toBe(titles.length);
    },
  );

  /*
   * The alerts deck's "Noisiest source" card asks which monitor generates the
   * most alerts. Answering it needs the originating monitor on every alert
   * row — without it the model can only guess a source from alert titles, or
   * say it cannot tell. The card is only honest once query_alerts both returns
   * that column and says so in its description, since the description is what
   * the model reads when deciding whether the question is answerable.
   *
   * Fails on the pre-fix tool, whose description never mentioned the monitor.
   */
  test('the alerts deck\'s "noisiest source" card is backed by monitor data in query_alerts', () => {
    const deck: Array<SuggestedQuestion> = getDeck(
      AIChatPageContextType.AlertsList,
    );

    const noisiestSourceCard: SuggestedQuestion | undefined = deck.find(
      (suggestion: SuggestedQuestion): boolean => {
        return MENTIONS_A_SOURCE.test(suggestion.question);
      },
    );

    expect(noisiestSourceCard).toBeDefined();

    const description: string = QueryAlertsTool.description;

    expect(description).toMatch(/\bmonitor\b/i);

    /*
     * The monitor has to be something the tool RETURNS, not something the
     * caller filters by — that distinction is what makes the card answerable.
     * Asserted structurally rather than by word order, so a copy edit to the
     * description does not fail this test.
     */
    const properties: JSONObject =
      (QueryAlertsTool.inputSchema["properties"] as JSONObject | undefined) ||
      {};

    expect(properties["monitor"]).toBeUndefined();
    expect(properties["monitorId"]).toBeUndefined();
  });
});
