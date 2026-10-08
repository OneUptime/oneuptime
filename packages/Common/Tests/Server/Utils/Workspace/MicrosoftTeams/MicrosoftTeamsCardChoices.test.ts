import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../../Server/Services/LabelService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import MicrosoftTeamsCardChoices, {
  MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH,
  MICROSOFT_TEAMS_MAX_LABEL_CHOICES,
  MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
  MICROSOFT_TEAMS_MAX_MONITOR_STATUS_CHOICES,
  MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES,
  MICROSOFT_TEAMS_MAX_SEVERITY_CHOICES,
  MicrosoftTeamsCardChoice,
  MicrosoftTeamsCardChoiceList,
  MicrosoftTeamsFittedCard,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import { MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";

/*
 * Pins MicrosoftTeamsCardChoices: the choice lists behind the Microsoft Teams
 * bot's "create incident" and "create maintenance" forms.
 *
 * Issue #4111: in Teams, both commands answered "Sorry, I encountered an
 * error processing your request. Please try again later." (twice), while
 * "show scheduled maintenance" worked. The two forms listed every monitor,
 * label and on-call policy of the project (up to 10,000 of each) as
 * Input.ChoiceSet choices, and Teams refused the card as too large (HTTP 413
 * MessageSizeTooBig). The lists are now read in name order up to a cap,
 * shortened until the card fits a size budget, and whatever is left off is
 * named on the card so the user knows to add it in OneUptime.
 *
 * Covered here:
 *
 * - toChoices: rows to { title, value } choices, skipping rows without a
 *   name or id, trimming names and cutting long ones to 80 characters with an
 *   ellipsis. The cut never splits an emoji (it goes through
 *   truncateToLength): a name cut where an emoji sits loses the whole emoji,
 *   never just half of it, which was a reported production bug.
 * - fitCardToBudget: builds the card once when it fits; otherwise shortens
 *   the longest trimmable list by a quarter (at least by one) until it fits,
 *   taking turns between lists of the same length. A budget of 0 or less
 *   leaves every trimmable list off up front and builds the card once, instead
 *   of shortening the lists step by step to nothing. Lists that must be shown
 *   whole are never shortened, a card that cannot fit is reported as such,
 *   10,000 choices take few rebuilds at each budget the bot tries, and
 *   buildCard always gets the first choices of each list together with the
 *   list's real total. Every fitting here is also checked for what must always
 *   hold: the card returned is the last one built, the counts returned are the
 *   ones it shows, every earlier card was over the budget, and fitsBudget
 *   matches the card's size as measured here. A fitting that stops converging
 *   fails its own test at once instead of crashing the run (MAX_CARD_BUILDS).
 * - getNotShownNote: the line under a list the card could not show in full.
 * - The card elements both forms share: buildNoteElement (the small print),
 *   buildNotShownNoteElement (that line as an element, or null) and
 *   buildCreateInOneUptimeAction (the button to the dashboard).
 * - The fetchers: what each one reads (the project, _id and name only, the
 *   order, the cap, as root), that the total is counted only when the cap was
 *   reached, and that rows become choices the way toChoices makes them, in the
 *   order they were read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
);

/*
 * The member a card is for, as getProjectMemberProps resolves them: every
 * list is read with their own props, so it offers only what they may read.
 */
const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5e000000-0000-4000-8000-0000000000aa"),
  tenantId: PROJECT_ID,
};

const INCIDENT_ADD_LATER_HINT: string =
  "You can add them to the incident in OneUptime after it is created.";

// Only whole characters: no half of a surrogate pair on its own.
const WELL_FORMED_UTF16: RegExp =
  /^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;

// A row as the fetchers read it: an id and a name, either of which may be off.
type NamedRow = {
  _id?: string | undefined;
  name?: string | undefined;
};

type Lists<TKey extends string> = Record<TKey, MicrosoftTeamsCardChoiceList>;

afterEach(() => {
  jest.restoreAllMocks();
});

function padded(index: number): string {
  return String(index).padStart(5, "0");
}

// A distinct, well-formed id per row.
function rowId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/*
 * Choices that are all the same size, so a card grows by the same number of
 * bytes with every choice it shows.
 */
function makeChoices(
  prefix: string,
  count: number,
): Array<MicrosoftTeamsCardChoice> {
  const choices: Array<MicrosoftTeamsCardChoice> = [];

  for (let index: number = 0; index < count; index++) {
    choices.push({
      title: `${prefix} ${padded(index)}`,
      value: `${prefix}-${padded(index)}`,
    });
  }

  return choices;
}

// Choices as toChoices makes them for long names: 80 characters and a UUID.
function makeLongChoices(
  prefix: string,
  count: number,
): Array<MicrosoftTeamsCardChoice> {
  const choices: Array<MicrosoftTeamsCardChoice> = [];

  for (let index: number = 0; index < count; index++) {
    choices.push({
      title: `${prefix} ${padded(index)} `.padEnd(79, "x") + "…",
      value: rowId(index),
    });
  }

  return choices;
}

function listOf(
  count: number,
  prefix: string,
  totalCount?: number,
): MicrosoftTeamsCardChoiceList {
  return {
    choices: makeChoices(prefix, count),
    totalCount: totalCount ?? count,
  };
}

// A stand-in for an adaptive card: one ChoiceSet per list, with its total.
function buildTestCard<TKey extends string>(shown: Lists<TKey>): JSONObject {
  const body: Array<JSONObject> = [];

  for (const key of Object.keys(shown) as Array<TKey>) {
    body.push({
      type: "Input.ChoiceSet",
      id: key,
      choices: shown[key].choices,
      totalCount: shown[key].totalCount,
    });
  }

  return { type: "AdaptiveCard", version: "1.5", body: body };
}

/*
 * Teams' measure, computed here independently of MicrosoftTeamsMessageSize:
 * the JSON of the card as UTF-16, two bytes a code unit.
 */
function sizeInBytes(card: JSONObject): number {
  return JSON.stringify(card).length * 2;
}

// The size of the test card showing the first counts[key] of each list.
function sizeShowing<TKey extends string>(
  lists: Lists<TKey>,
  counts: Record<TKey, number>,
): number {
  const shown: Lists<TKey> = {} as Lists<TKey>;

  for (const key of Object.keys(lists) as Array<TKey>) {
    shown[key] = {
      choices: lists[key].choices.slice(0, counts[key]),
      totalCount: lists[key].totalCount,
    };
  }

  return sizeInBytes(buildTestCard(shown));
}

/*
 * More cards than any fitting in this file needs (emptying three lists of
 * 10,000 takes 91). Past it the recorder throws, so a fitCardToBudget that no
 * longer converges, or shortens one choice at a time, fails its own test at
 * once. Without the limit such a regression runs the synchronous fitting loop
 * until the process runs out of memory (the recorder keeps every card): jest's
 * timeout cannot stop a loop, and the crash names no test.
 */
const MAX_CARD_BUILDS: number = 500;

/*
 * A budget above 0 that no card fits: the fitting shortens every trimmable
 * list step by step, all the way to nothing. A budget of 0 would leave the
 * lists off in one go instead, so it cannot show the steps.
 */
const NO_CARD_FITS_BUDGET_IN_BYTES: number = 1;

// Every card fitCardToBudget had built, and what it handed buildCard each time.
interface CardBuilds<TKey extends string> {
  buildCard: (shown: Lists<TKey>) => JSONObject;
  shown: Array<Lists<TKey>>;
  cards: Array<JSONObject>;
}

function recordCardBuilds<TKey extends string>(): CardBuilds<TKey> {
  const shown: Array<Lists<TKey>> = [];
  const cards: Array<JSONObject> = [];

  return {
    shown: shown,
    cards: cards,
    buildCard: (lists: Lists<TKey>): JSONObject => {
      if (cards.length >= MAX_CARD_BUILDS) {
        throw new Error(
          `fitCardToBudget asked for more than ${MAX_CARD_BUILDS} cards: it is not converging.`,
        );
      }

      const card: JSONObject = buildTestCard(lists);
      shown.push(lists);
      cards.push(card);
      return card;
    },
  };
}

interface FitRun<TKey extends string> {
  result: MicrosoftTeamsFittedCard<TKey>;
  builds: CardBuilds<TKey>;
}

/*
 * Runs fitCardToBudget with a recording buildCard, then checks what must hold
 * for any lists and budget: the card returned is the last one built, the
 * counts returned are the ones that card shows, every card built before it
 * was over the budget (the fitting stops at the first card that fits), and
 * fitsBudget says whether the card returned is within the budget, measured
 * here rather than by MicrosoftTeamsMessageSize.
 */
function fit<TKey extends string>(data: {
  lists: Lists<TKey>;
  trimmableKeys: ReadonlyArray<TKey>;
  budgetInBytes: number;
}): FitRun<TKey> {
  const builds: CardBuilds<TKey> = recordCardBuilds<TKey>();

  const result: MicrosoftTeamsFittedCard<TKey> =
    MicrosoftTeamsCardChoices.fitCardToBudget<TKey>({
      lists: data.lists,
      trimmableKeys: data.trimmableKeys,
      budgetInBytes: data.budgetInBytes,
      buildCard: builds.buildCard,
    });

  const lastShown: Lists<TKey> | undefined =
    builds.shown[builds.shown.length - 1];
  expect(lastShown).toBeDefined();
  expect(result.card).toBe(builds.cards[builds.cards.length - 1]);

  const countsInLastCard: Record<TKey, number> = {} as Record<TKey, number>;

  for (const key of Object.keys(data.lists) as Array<TKey>) {
    countsInLastCard[key] = lastShown![key].choices.length;
  }

  expect(result.shownCounts).toStrictEqual(countsInLastCard);

  for (const card of builds.cards.slice(0, -1)) {
    expect(sizeInBytes(card)).toBeGreaterThan(data.budgetInBytes);
  }

  expect(result.fitsBudget).toBe(
    sizeInBytes(result.card) <= data.budgetInBytes,
  );

  return { result: result, builds: builds };
}

// How many choices of each list every build showed, in the order of keys.
function countsPerBuild<TKey extends string>(
  builds: CardBuilds<TKey>,
  keys: ReadonlyArray<TKey>,
): Array<Array<number>> {
  return builds.shown.map((lists: Lists<TKey>): Array<number> => {
    return keys.map((key: TKey): number => {
      return lists[key].choices.length;
    });
  });
}

describe("MicrosoftTeamsCardChoices.toChoices", () => {
  test("turns each row into a choice titled by its name and valued by its id, in row order", () => {
    expect(
      MicrosoftTeamsCardChoices.toChoices([
        { _id: rowId(1), name: "Payments API" },
        { _id: rowId(2), name: "Checkout API" },
        { _id: rowId(3), name: "Auth API" },
      ]),
    ).toStrictEqual([
      { title: "Payments API", value: rowId(1) },
      { title: "Checkout API", value: rowId(2) },
      { title: "Auth API", value: rowId(3) },
    ]);
  });

  test("gives no choices for no rows", () => {
    expect(MicrosoftTeamsCardChoices.toChoices([])).toStrictEqual([]);
  });

  test("skips a row whose name is missing, empty or only whitespace", () => {
    expect(
      MicrosoftTeamsCardChoices.toChoices([
        { _id: rowId(1) },
        { _id: rowId(2), name: undefined },
        { _id: rowId(3), name: null as unknown as string },
        { _id: rowId(4), name: "" },
        { _id: rowId(5), name: "   " },
        { _id: rowId(6), name: "\t\n " },
        { _id: rowId(7), name: "Checkout API" },
      ]),
    ).toStrictEqual([{ title: "Checkout API", value: rowId(7) }]);
  });

  test("skips a row whose id is missing or empty", () => {
    expect(
      MicrosoftTeamsCardChoices.toChoices([
        { name: "No id" },
        { _id: undefined, name: "Undefined id" },
        { _id: null as unknown as string, name: "Null id" },
        { _id: "", name: "Empty id" },
        { _id: rowId(5), name: "Checkout API" },
      ]),
    ).toStrictEqual([{ title: "Checkout API", value: rowId(5) }]);
  });

  test("trims the whitespace around a name and keeps the whitespace inside it", () => {
    expect(
      MicrosoftTeamsCardChoices.toChoices([
        { _id: rowId(1), name: "  Checkout API \n" },
        { _id: rowId(2), name: "Checkout  API  (EU)" },
      ]),
    ).toStrictEqual([
      { title: "Checkout API", value: rowId(1) },
      { title: "Checkout  API  (EU)", value: rowId(2) },
    ]);
  });

  test("keeps a name of exactly 80 characters as it is", () => {
    const name: string = "abcdefghij".repeat(8);
    expect(name).toHaveLength(80);
    expect(MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH).toBe(80);

    const [choice]: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices([{ _id: rowId(1), name: name }]);

    expect(choice).toStrictEqual({ title: name, value: rowId(1) });
  });

  test("cuts a longer name to its first 79 characters and an ellipsis, 80 in all", () => {
    // 81 characters, and 100 (the most a monitor name column holds).
    const names: Array<string> = [
      "abcdefghij".repeat(8) + "k",
      "abcdefghij".repeat(10),
    ];

    const choices: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices(
        names.map((name: string, index: number): NamedRow => {
          return { _id: rowId(index), name: name };
        }),
      );

    expect(choices).toStrictEqual([
      { title: "abcdefghij".repeat(7) + "abcdefghi…", value: rowId(0) },
      { title: "abcdefghij".repeat(7) + "abcdefghi…", value: rowId(1) },
    ]);

    for (const choice of choices) {
      expect(choice.title).toHaveLength(80);
    }
  });

  test("measures a name after trimming it", () => {
    const name: string = "abcdefghij".repeat(8);

    const [choice]: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices([
        { _id: rowId(1), name: `   ${name}  \n` },
      ]);

    expect(choice).toStrictEqual({ title: name, value: rowId(1) });
  });

  test("keeps a whole emoji that ends right at the cut", () => {
    // The emoji is the 78th and 79th code units, the last two the cut keeps.
    const name: string = "a".repeat(77) + "🚀" + " and the rest of the name";

    const [choice]: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices([{ _id: rowId(1), name: name }]);

    expect(choice!.title).toBe("a".repeat(77) + "🚀…");
    expect(choice!.title).toHaveLength(80);
    expect(choice!.title).toMatch(WELL_FORMED_UTF16);
  });

  test("does not leave half of an emoji before the ellipsis", () => {
    /*
     * The emoji is the 79th and 80th code units, so a cut after 79 code
     * units splits it. A lone surrogate is not a character: it shows as a
     * replacement mark in the dropdown, and it is not valid Unicode for the
     * service that receives the card. MicrosoftTeamsMessageSize.fitTextToBudget
     * keeps text replies free of it for the same reason.
     *
     * A reported production bug: toChoices kept the emoji's first half. It
     * now cuts with truncateToLength, which drops that half.
     */
    const name: string = "a".repeat(78) + "🚀" + " and the rest of the name";

    const [choice]: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices([{ _id: rowId(1), name: name }]);

    expect(choice!.title).toMatch(WELL_FORMED_UTF16);

    // Only the broken half goes: everything before the emoji is kept.
    expect(choice!.title).toBe("a".repeat(78) + "…");
  });

  test("cuts a name made only of emoji after the last whole one that fits", () => {
    // 50 emoji, 100 code units: 79 of them hold 39 emoji and half of the 40th.
    const name: string = "🚀".repeat(50);

    const [choice]: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices([{ _id: rowId(1), name: name }]);

    expect(choice!.title).toBe("🚀".repeat(39) + "…");
    expect(choice!.title).toMatch(WELL_FORMED_UTF16);
  });

  test("reads an id that is an ObjectID through its toString", () => {
    const id: ObjectID = new ObjectID(rowId(42));
    const monitor: Monitor = new Monitor(new ObjectID(rowId(43)));
    monitor.name = "Checkout API";

    expect(
      MicrosoftTeamsCardChoices.toChoices([
        { _id: id as unknown as string, name: "Payments API" },
        monitor,
      ]),
    ).toStrictEqual([
      { title: "Payments API", value: rowId(42) },
      { title: "Checkout API", value: rowId(43) },
    ]);
  });
});

describe("MicrosoftTeamsCardChoices.fitCardToBudget", () => {
  test("builds the card once, with every choice and every total, when it already fits", () => {
    type Key = "severities" | "monitors" | "labels";
    const lists: Lists<Key> = {
      severities: listOf(4, "s"),
      monitors: listOf(12, "m"),
      labels: listOf(3, "l"),
    };

    const run: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: 40 * 1024,
    });

    expect(run.builds.cards).toHaveLength(1);
    expect(run.builds.shown[0]).toStrictEqual(lists);
    expect(run.result.card).toBe(run.builds.cards[0]);
    expect(run.result.fitsBudget).toBe(true);
    expect(run.result.shownCounts).toStrictEqual({
      severities: 4,
      monitors: 12,
      labels: 3,
    });
  });

  test("measures the card as Teams does: a card exactly at the budget fits, one byte over is shortened", () => {
    type Key = "monitors";

    // ASCII, an accent and an emoji: UTF-16 code units, not UTF-8 bytes or characters.
    const lists: Lists<Key> = {
      monitors: {
        choices: makeChoices("m", 19).concat([
          { title: "Café 🚀 checkout", value: rowId(19) },
        ]),
        totalCount: 20,
      },
    };
    const fullSize: number = sizeShowing(lists, { monitors: 20 });

    const atBudget: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors"],
      budgetInBytes: fullSize,
    });

    expect(atBudget.builds.cards).toHaveLength(1);
    expect(atBudget.result.fitsBudget).toBe(true);
    expect(atBudget.result.shownCounts).toStrictEqual({ monitors: 20 });

    const overBudget: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors"],
      budgetInBytes: fullSize - 1,
    });

    expect(countsPerBuild(overBudget.builds, ["monitors"])).toStrictEqual([
      [20],
      [15],
    ]);
    expect(overBudget.result.fitsBudget).toBe(true);
    expect(overBudget.result.shownCounts).toStrictEqual({ monitors: 15 });
  });

  test("shortens the longest trimmable list first, whatever order the lists are named in", () => {
    type Key = "labels" | "monitors";
    const lists: Lists<Key> = {
      labels: listOf(10, "l"),
      monitors: listOf(100, "m"),
    };
    const budget: number = sizeShowing(lists, { labels: 10, monitors: 75 });
    const orders: Array<Array<Key>> = [
      ["labels", "monitors"],
      ["monitors", "labels"],
    ];

    for (const trimmableKeys of orders) {
      const run: FitRun<Key> = fit<Key>({
        lists: lists,
        trimmableKeys: trimmableKeys,
        budgetInBytes: budget,
      });

      expect(countsPerBuild(run.builds, ["labels", "monitors"])).toStrictEqual([
        [10, 100],
        [10, 75],
      ]);
      expect(run.result.shownCounts).toStrictEqual({
        labels: 10,
        monitors: 75,
      });
      expect(run.result.fitsBudget).toBe(true);
    }
  });

  test("shortens a list by a quarter at a time, and by at least one", () => {
    type Key = "monitors";

    // No card fits, so the list is shortened step by step to nothing.
    const run: FitRun<Key> = fit<Key>({
      lists: { monitors: listOf(100, "m") },
      trimmableKeys: ["monitors"],
      budgetInBytes: NO_CARD_FITS_BUDGET_IN_BYTES,
    });

    expect(countsPerBuild(run.builds, ["monitors"]).flat()).toStrictEqual([
      100, 75, 56, 42, 31, 23, 17, 12, 9, 6, 4, 3, 2, 1, 0,
    ]);
    expect(run.result.fitsBudget).toBe(false);
  });

  test("shortens a long list alone until it is no longer the longest, then the lists take turns", () => {
    type Key = "monitors" | "labels";

    /*
     * No card fits, so both lists are shortened all the way; a tie goes to
     * the list named first.
     */
    const run: FitRun<Key> = fit<Key>({
      lists: { monitors: listOf(40, "m"), labels: listOf(10, "l") },
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: NO_CARD_FITS_BUDGET_IN_BYTES,
    });

    expect(countsPerBuild(run.builds, ["monitors", "labels"])).toStrictEqual([
      [40, 10],
      [30, 10],
      [22, 10],
      [16, 10],
      [12, 10],
      [9, 10],
      [9, 7],
      [6, 7],
      [6, 5],
      [4, 5],
      [4, 3],
      [3, 3],
      [2, 3],
      [2, 2],
      [1, 2],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });

  test("two lists of the same length take turns and end the same length, whichever is named first", () => {
    type Key = "monitors" | "labels";
    const lists: Lists<Key> = {
      monitors: listOf(100, "a"),
      labels: listOf(100, "b"),
    };
    const budget: number = sizeShowing(lists, { monitors: 56, labels: 56 });

    const monitorsFirst: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: budget,
    });

    expect(
      countsPerBuild(monitorsFirst.builds, ["monitors", "labels"]),
    ).toStrictEqual([
      [100, 100],
      [75, 100],
      [75, 75],
      [56, 75],
      [56, 56],
    ]);
    expect(monitorsFirst.result.shownCounts).toStrictEqual({
      monitors: 56,
      labels: 56,
    });
    expect(monitorsFirst.result.fitsBudget).toBe(true);

    const labelsFirst: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["labels", "monitors"],
      budgetInBytes: budget,
    });

    expect(
      countsPerBuild(labelsFirst.builds, ["monitors", "labels"]),
    ).toStrictEqual([
      [100, 100],
      [100, 75],
      [75, 75],
      [75, 56],
      [56, 56],
    ]);
    expect(labelsFirst.result.shownCounts).toStrictEqual({
      monitors: 56,
      labels: 56,
    });
  });

  test("never shortens a list that is not trimmable, even when it is the longest", () => {
    type Key = "severities" | "monitors" | "labels";
    const lists: Lists<Key> = {
      severities: listOf(300, "s"),
      monitors: listOf(40, "m"),
      labels: listOf(10, "l"),
    };

    const run: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: sizeShowing(lists, {
        severities: 300,
        monitors: 9,
        labels: 10,
      }),
    });

    expect(
      countsPerBuild(run.builds, ["severities", "monitors", "labels"]),
    ).toStrictEqual([
      [300, 40, 10],
      [300, 30, 10],
      [300, 22, 10],
      [300, 16, 10],
      [300, 12, 10],
      [300, 9, 10],
    ]);
    expect(run.result.shownCounts).toStrictEqual({
      severities: 300,
      monitors: 9,
      labels: 10,
    });
    expect(run.result.fitsBudget).toBe(true);
  });

  test("fits by leaving every trimmable list off when only that is small enough", () => {
    type Key = "severities" | "monitors" | "labels";
    const lists: Lists<Key> = {
      severities: listOf(300, "s"),
      monitors: listOf(40, "m"),
      labels: listOf(10, "l"),
    };
    const budget: number = sizeShowing(lists, {
      severities: 300,
      monitors: 0,
      labels: 0,
    });

    const run: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: budget,
    });

    expect(run.result.shownCounts).toStrictEqual({
      severities: 300,
      monitors: 0,
      labels: 0,
    });
    expect(run.result.fitsBudget).toBe(true);
    expect(sizeInBytes(run.result.card)).toBe(budget);
  });

  test("says the card does not fit when the lists it must show are too big on their own", () => {
    type Key = "severities" | "monitors" | "labels";
    const lists: Lists<Key> = {
      severities: listOf(300, "s"),
      monitors: listOf(40, "m"),
      labels: listOf(10, "l"),
    };

    const run: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes:
        sizeShowing(lists, { severities: 300, monitors: 0, labels: 0 }) - 2,
    });

    expect(run.result.fitsBudget).toBe(false);
    expect(run.result.shownCounts).toStrictEqual({
      severities: 300,
      monitors: 0,
      labels: 0,
    });

    // The card returned is the smallest one, built last; nothing is built after it.
    const counts: Array<Array<number>> = countsPerBuild(run.builds, [
      "severities",
      "monitors",
      "labels",
    ]);
    expect(run.result.card).toBe(run.builds.cards[run.builds.cards.length - 1]);
    expect(counts[counts.length - 1]).toStrictEqual([300, 0, 0]);
    expect(counts[counts.length - 2]).not.toStrictEqual([300, 0, 0]);

    for (const buildCounts of counts) {
      expect(buildCounts[0]).toBe(300);
    }
  });

  test("with no trimmable list, builds an oversized card once and says it does not fit", () => {
    type Key = "severities" | "monitors";
    const lists: Lists<Key> = {
      severities: listOf(5, "s"),
      monitors: listOf(50, "m"),
    };

    // A budget of 0 or less has nothing to leave off either.
    for (const budget of [64, 0, -1]) {
      const run: FitRun<Key> = fit<Key>({
        lists: lists,
        trimmableKeys: [],
        budgetInBytes: budget,
      });

      expect(run.builds.cards).toHaveLength(1);
      expect(run.builds.shown[0]).toStrictEqual(lists);
      expect(run.result.card).toBe(run.builds.cards[0]);
      expect(run.result.fitsBudget).toBe(false);
      expect(run.result.shownCounts).toStrictEqual({
        severities: 5,
        monitors: 50,
      });
    }
  });

  test("never picks a trimmable list that is already empty: with nothing to shorten, an oversized card is built once", () => {
    /*
     * A project with no monitors and no labels. There is nothing to take off
     * the card, so the fitting must stop at once rather than "shorten" an
     * empty list below zero, which would never end.
     */
    type Key = "severities" | "monitors" | "labels";
    const lists: Lists<Key> = {
      severities: listOf(300, "s"),
      monitors: listOf(0, "m"),
      labels: listOf(0, "l"),
    };

    const run: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: 64,
    });

    expect(run.builds.cards).toHaveLength(1);
    expect(run.builds.shown[0]).toStrictEqual(lists);
    expect(run.result.fitsBudget).toBe(false);
    expect(run.result.shownCounts).toStrictEqual({
      severities: 300,
      monitors: 0,
      labels: 0,
    });
  });

  /*
   * Budget 0 is the last one the bot tries, after Teams refused the card
   * twice. The trimmable lists are left off up front, so the card is built
   * once: the card with every choice, the biggest of all, is never built, and
   * no list is shortened step by step to nothing first.
   */
  test.each([0, -1, -40 * 1024])(
    "budget %i leaves every trimmable list off up front, in one build, keeps the others whole and keeps each list's total",
    (budget: number) => {
      type Key =
        | "severities"
        | "monitors"
        | "monitorStatuses"
        | "labels"
        | "onCallDutyPolicies";
      const lists: Lists<Key> = {
        severities: listOf(4, "s"),
        monitors: listOf(250, "m", 10000),
        monitorStatuses: listOf(3, "st"),
        labels: listOf(100, "l", 500),
        onCallDutyPolicies: listOf(7, "p"),
      };

      const run: FitRun<Key> = fit<Key>({
        lists: lists,
        trimmableKeys: ["monitors", "labels", "onCallDutyPolicies"],
        budgetInBytes: budget,
      });

      expect(run.builds.cards).toHaveLength(1);
      expect(run.builds.shown[0]).toStrictEqual({
        severities: lists.severities,
        monitors: { choices: [], totalCount: 10000 },
        monitorStatuses: lists.monitorStatuses,
        labels: { choices: [], totalCount: 500 },
        onCallDutyPolicies: { choices: [], totalCount: 7 },
      });
      expect(run.result.card).toBe(run.builds.cards[0]);

      // No card is 0 bytes, so even the smallest one is over this budget.
      expect(run.result.fitsBudget).toBe(false);
      expect(run.result.shownCounts).toStrictEqual({
        severities: 4,
        monitors: 0,
        monitorStatuses: 3,
        labels: 0,
        onCallDutyPolicies: 0,
      });
    },
  );

  test("takes few builds for 10,000 monitors at each budget the bot tries, stops at the first card that fits, and ends within it", () => {
    type Key =
      | "severities"
      | "monitors"
      | "monitorStatuses"
      | "labels"
      | "onCallDutyPolicies";
    const lists: Lists<Key> = {
      severities: { choices: makeLongChoices("Severity", 5), totalCount: 5 },
      monitors: {
        choices: makeLongChoices("Monitor", 10000),
        totalCount: 10000,
      },
      monitorStatuses: {
        choices: makeLongChoices("Status", 5),
        totalCount: 5,
      },
      labels: { choices: makeLongChoices("Label", 500), totalCount: 500 },
      onCallDutyPolicies: {
        choices: makeLongChoices("Policy", 200),
        totalCount: 200,
      },
    };

    // The last budget, 0, leaves the lists off; the tests above cover it.
    const budgets: Array<number> =
      MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES.filter(
        (budget: number): boolean => {
          return budget > 0;
        },
      );
    expect(budgets).toContain(40 * 1024);

    for (const budget of budgets) {
      const run: FitRun<Key> = fit<Key>({
        lists: lists,
        trimmableKeys: ["monitors", "labels", "onCallDutyPolicies"],
        budgetInBytes: budget,
      });

      // One choice at a time would take thousands of builds.
      expect(run.builds.cards.length).toBeLessThan(100);
      expect(run.result.fitsBudget).toBe(true);
      expect(sizeInBytes(run.result.card)).toBeLessThanOrEqual(budget);
      expect(run.result.card).toBe(
        run.builds.cards[run.builds.cards.length - 1],
      );

      for (const card of run.builds.cards.slice(0, -1)) {
        expect(sizeInBytes(card)).toBeGreaterThan(budget);
      }

      for (const shown of run.builds.shown) {
        expect(shown.severities.choices).toHaveLength(5);
        expect(shown.monitorStatuses.choices).toHaveLength(5);
      }

      // Every trimmable list still offers some choices at this budget.
      expect(run.result.shownCounts.monitors).toBeGreaterThan(0);
      expect(run.result.shownCounts.labels).toBeGreaterThan(0);
      expect(run.result.shownCounts.onCallDutyPolicies).toBeGreaterThan(0);
    }
  });

  test("empties three lists of 10,000 choices in fewer than 100 builds", () => {
    type Key = "monitors" | "labels" | "onCallDutyPolicies";
    const lists: Lists<Key> = {
      monitors: listOf(10000, "m"),
      labels: listOf(10000, "l"),
      onCallDutyPolicies: listOf(10000, "p"),
    };
    const trimmableKeys: Array<Key> = [
      "monitors",
      "labels",
      "onCallDutyPolicies",
    ];

    const run: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: trimmableKeys,
      budgetInBytes: NO_CARD_FITS_BUDGET_IN_BYTES,
    });

    expect(run.builds.cards.length).toBeLessThan(100);
    expect(run.result.shownCounts).toStrictEqual({
      monitors: 0,
      labels: 0,
      onCallDutyPolicies: 0,
    });

    // Budget 0 gets to that same card in a single build.
    const atZero: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: trimmableKeys,
      budgetInBytes: 0,
    });

    expect(atZero.builds.cards).toHaveLength(1);
    expect(atZero.result.shownCounts).toStrictEqual(run.result.shownCounts);
    expect(atZero.result.card).toStrictEqual(run.result.card);
  });

  test("hands buildCard the first choices of every list, in order, with the list's own total", () => {
    type Key = "severities" | "monitors" | "labels";
    const keys: Array<Key> = ["severities", "monitors", "labels"];
    const lists: Lists<Key> = {
      severities: listOf(4, "s"),
      monitors: listOf(250, "m", 10000),
      labels: listOf(100, "l", 500),
    };

    const run: FitRun<Key> = fit<Key>({
      lists: lists,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: 8 * 1024,
    });

    expect(run.builds.shown.length).toBeGreaterThan(1);

    for (const shown of run.builds.shown) {
      expect(Object.keys(shown)).toStrictEqual(keys);

      for (const key of keys) {
        const shownChoices: Array<MicrosoftTeamsCardChoice> =
          shown[key].choices;

        expect(shown[key].totalCount).toBe(lists[key].totalCount);
        expect(shownChoices).toStrictEqual(
          lists[key].choices.slice(0, shownChoices.length),
        );

        shownChoices.forEach(
          (choice: MicrosoftTeamsCardChoice, index: number): void => {
            expect(choice).toBe(lists[key].choices[index]);
          },
        );
      }
    }
  });

  test("leaves the lists it was given as they were, so the same choices can be fitted to the next budget", () => {
    type Key = "severities" | "monitors" | "labels";
    const newLists: () => Lists<Key> = (): Lists<Key> => {
      return {
        severities: listOf(4, "s"),
        monitors: listOf(250, "m", 10000),
        labels: listOf(100, "l", 500),
      };
    };
    const lists: Lists<Key> = newLists();
    const untouched: Lists<Key> = newLists();

    for (const budget of [40 * 1024, 20 * 1024, 0, 20 * 1024]) {
      const reused: FitRun<Key> = fit<Key>({
        lists: lists,
        trimmableKeys: ["monitors", "labels"],
        budgetInBytes: budget,
      });

      expect(lists).toStrictEqual(untouched);

      const fresh: FitRun<Key> = fit<Key>({
        lists: newLists(),
        trimmableKeys: ["monitors", "labels"],
        budgetInBytes: budget,
      });

      expect(reused.result.shownCounts).toStrictEqual(fresh.result.shownCounts);
      expect(reused.result.card).toStrictEqual(fresh.result.card);
    }
  });

  test("gives the same card every time for the same lists and budget", () => {
    type Key = "severities" | "monitors" | "labels" | "onCallDutyPolicies";
    const keys: Array<Key> = [
      "severities",
      "monitors",
      "labels",
      "onCallDutyPolicies",
    ];
    const lists: Lists<Key> = {
      severities: listOf(4, "s"),
      monitors: listOf(250, "m", 3000),
      labels: listOf(100, "l", 100),
      onCallDutyPolicies: listOf(60, "p"),
    };

    const runs: Array<FitRun<Key>> = [1, 2].map((): FitRun<Key> => {
      return fit<Key>({
        lists: lists,
        trimmableKeys: ["monitors", "labels", "onCallDutyPolicies"],
        budgetInBytes: 12 * 1024,
      });
    });

    expect(countsPerBuild(runs[1]!.builds, keys)).toStrictEqual(
      countsPerBuild(runs[0]!.builds, keys),
    );
    expect(runs[1]!.result.shownCounts).toStrictEqual(
      runs[0]!.result.shownCounts,
    );
    expect(JSON.stringify(runs[1]!.result.card)).toBe(
      JSON.stringify(runs[0]!.result.card),
    );
  });
});

describe("MicrosoftTeamsCardChoices.getNotShownNote", () => {
  function noteFor(data: {
    shown: number;
    totalCount: number;
    pluralNoun?: string;
    addLaterHint?: string;
  }): string | null {
    return MicrosoftTeamsCardChoices.getNotShownNote({
      list: {
        choices: makeChoices("m", data.shown),
        totalCount: data.totalCount,
      },
      pluralNoun: data.pluralNoun ?? "monitors",
      addLaterHint: data.addLaterHint ?? INCIDENT_ADD_LATER_HINT,
    });
  }

  test("is null when the card shows every record", () => {
    expect(noteFor({ shown: 3, totalCount: 3 })).toBeNull();
    expect(noteFor({ shown: 250, totalCount: 250 })).toBeNull();
  });

  test("is null when the project has none", () => {
    expect(noteFor({ shown: 0, totalCount: 0 })).toBeNull();
  });

  test("says how many of how many are shown, by name, when some are", () => {
    expect(noteFor({ shown: 40, totalCount: 250 })).toBe(
      "Showing the first 40 of 250 monitors, by name. You can add them to the incident in OneUptime after it is created.",
    );
    expect(noteFor({ shown: 250, totalCount: 10000 })).toBe(
      "Showing the first 250 of 10000 monitors, by name. You can add them to the incident in OneUptime after it is created.",
    );
  });

  test("says there are too many to list when none are shown", () => {
    expect(noteFor({ shown: 0, totalCount: 250 })).toBe(
      "This project has 250 monitors, too many to list in Microsoft Teams. You can add them to the incident in OneUptime after it is created.",
    );
  });

  test("takes a total below the number shown as complete", () => {
    // Records deleted between reading the list and counting it.
    expect(noteFor({ shown: 250, totalCount: 240 })).toBeNull();
    expect(noteFor({ shown: 3, totalCount: 0 })).toBeNull();
  });

  test("uses the noun and the hint it is given", () => {
    expect(
      noteFor({
        shown: 1,
        totalCount: 2,
        pluralNoun: "on-call policies",
        addLaterHint:
          "You can add them to the event in OneUptime after it is created.",
      }),
    ).toBe(
      "Showing the first 1 of 2 on-call policies, by name. You can add them to the event in OneUptime after it is created.",
    );
  });
});

describe("MicrosoftTeamsCardChoices card elements", () => {
  /*
   * The small print and the dashboard button of both forms. The incident and
   * the maintenance form each had a copy of the note element; both now build
   * them here, so the two forms look the same.
   */
  function noteElement(text: string): JSONObject {
    return {
      type: "TextBlock",
      text: text,
      wrap: true,
      isSubtle: true,
      size: "Small",
      spacing: "Small",
    };
  }

  test("buildNoteElement is small, subtle text that wraps, with the text exactly as given", () => {
    for (const text of [
      "Start and end times are in America/New_York.",
      "Showing the first 40 of 250 monitors, by name. _Markdown_ and 🚀 stay as they are.",
    ]) {
      expect(MicrosoftTeamsCardChoices.buildNoteElement(text)).toStrictEqual(
        noteElement(text),
      );
    }
  });

  test("buildNotShownNoteElement is the note element for a list shown in part", () => {
    expect(
      MicrosoftTeamsCardChoices.buildNotShownNoteElement({
        list: { choices: makeChoices("m", 40), totalCount: 250 },
        pluralNoun: "monitors",
        addLaterHint: INCIDENT_ADD_LATER_HINT,
      }),
    ).toStrictEqual(
      noteElement(
        "Showing the first 40 of 250 monitors, by name. You can add them to the incident in OneUptime after it is created.",
      ),
    );
  });

  test("buildNotShownNoteElement is the note element for a list left off", () => {
    expect(
      MicrosoftTeamsCardChoices.buildNotShownNoteElement({
        list: { choices: [], totalCount: 10000 },
        pluralNoun: "labels",
        addLaterHint:
          "You can add them to the event in OneUptime after it is created.",
      }),
    ).toStrictEqual(
      noteElement(
        "This project has 10000 labels, too many to list in Microsoft Teams. You can add them to the event in OneUptime after it is created.",
      ),
    );
  });

  test("buildNotShownNoteElement is null when the card shows every record, or the project has none", () => {
    const lists: Array<MicrosoftTeamsCardChoiceList> = [
      { choices: makeChoices("m", 3), totalCount: 3 },
      { choices: [], totalCount: 0 },
      // Records deleted between reading the list and counting it.
      { choices: makeChoices("m", 250), totalCount: 240 },
    ];

    for (const list of lists) {
      expect(
        MicrosoftTeamsCardChoices.buildNotShownNoteElement({
          list: list,
          pluralNoun: "monitors",
          addLaterHint: INCIDENT_ADD_LATER_HINT,
        }),
      ).toBeNull();
    }
  });

  test("buildNotShownNoteElement says exactly what getNotShownNote says, whenever it says anything", () => {
    for (const shown of [0, 1, 40, 250]) {
      for (const totalCount of [0, 1, 40, 250, 10000]) {
        const data: {
          list: MicrosoftTeamsCardChoiceList;
          pluralNoun: string;
          addLaterHint: string;
        } = {
          list: { choices: makeChoices("m", shown), totalCount: totalCount },
          pluralNoun: "on-call policies",
          addLaterHint: INCIDENT_ADD_LATER_HINT,
        };
        const note: string | null =
          MicrosoftTeamsCardChoices.getNotShownNote(data);

        expect(
          MicrosoftTeamsCardChoices.buildNotShownNoteElement(data),
        ).toStrictEqual(note === null ? null : noteElement(note));
      }
    }
  });

  test("buildCreateInOneUptimeAction is a button that opens the URL it is given", () => {
    for (const url of [
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/incidents/create`,
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/create`,
    ]) {
      expect(
        MicrosoftTeamsCardChoices.buildCreateInOneUptimeAction(url),
      ).toStrictEqual({
        type: "Action.OpenUrl",
        title: "Create in OneUptime",
        url: url,
      });
    }
  });
});

/*
 * The two reads a fetcher makes, as the tests stub them. Each service is the
 * same object under this type, so a spy on it replaces the service's method.
 */
interface ChoiceReads {
  findBy: (findBy: unknown) => Promise<Array<DatabaseBaseModel>>;
  countBy: (countBy: unknown) => Promise<PositiveNumber>;
}

interface ReadSpies {
  findBy: SpyInstance<ChoiceReads["findBy"]>;
  countBy: SpyInstance<ChoiceReads["countBy"]>;
}

interface FetcherCase {
  method: string;
  pluralNoun: string;
  reads: ChoiceReads;
  newModel: () => DatabaseBaseModel;
  fetch: (projectId: ObjectID) => Promise<MicrosoftTeamsCardChoiceList>;
  sort: JSONObject;
  cap: number;
  // Filters the fetcher adds to the project scope, if any.
  extraQuery?: JSONObject | undefined;
}

function toModels(
  newModel: () => DatabaseBaseModel,
  rows: Array<NamedRow>,
): Array<DatabaseBaseModel> {
  return rows.map((row: NamedRow): DatabaseBaseModel => {
    const model: DatabaseBaseModel = newModel();

    if (row._id !== undefined) {
      model._id = row._id;
    }

    if (row.name !== undefined) {
      model.setValue("name", row.name);
    }

    return model;
  });
}

function rowsNamed(count: number, noun: string): Array<NamedRow> {
  const rows: Array<NamedRow> = [];

  for (let index: number = 0; index < count; index++) {
    rows.push({ _id: rowId(index), name: `${noun} ${padded(index)}` });
  }

  return rows;
}

function choicesFor(rows: Array<NamedRow>): Array<MicrosoftTeamsCardChoice> {
  return rows.map((row: NamedRow): MicrosoftTeamsCardChoice => {
    return { title: row.name!, value: row._id! };
  });
}

function stubReads(
  fetcher: FetcherCase,
  data: { rows: Array<NamedRow>; count?: number },
): ReadSpies {
  return {
    findBy: jest
      .spyOn(fetcher.reads, "findBy")
      .mockResolvedValue(toModels(fetcher.newModel, data.rows)),
    countBy: jest
      .spyOn(fetcher.reads, "countBy")
      .mockResolvedValue(new PositiveNumber(data.count ?? data.rows.length)),
  };
}

/*
 * The one argument a spy was called with. jest-mock records the calls in
 * arrays of its own realm, so the argument is compared rather than the list
 * of calls (toStrictEqual also compares constructors).
 */
function onlyArgumentOf(spy: SpyInstance<(data: unknown) => unknown>): unknown {
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0]![0];
}

function expectedFindBy(fetcher: FetcherCase): Record<string, unknown> {
  return {
    query: { projectId: PROJECT_ID, ...(fetcher.extraQuery || {}) },
    select: { _id: true, name: true },
    sort: fetcher.sort,
    limit: fetcher.cap,
    skip: 0,
    props: MEMBER_PROPS,
  };
}

// Lists the card may shorten: read by name, and counted when the cap is hit.
const COUNTED_FETCHERS: Array<FetcherCase> = [
  {
    method: "getMonitorChoices",
    pluralNoun: "monitors",
    reads: MonitorService as unknown as ChoiceReads,
    newModel: (): DatabaseBaseModel => {
      return new Monitor();
    },
    fetch: (projectId: ObjectID): Promise<MicrosoftTeamsCardChoiceList> => {
      return MicrosoftTeamsCardChoices.getMonitorChoices(
        projectId,
        MEMBER_PROPS,
      );
    },
    sort: { name: SortOrder.Ascending },
    cap: 250,
  },
  {
    method: "getLabelChoices",
    pluralNoun: "labels",
    reads: LabelService as unknown as ChoiceReads,
    newModel: (): DatabaseBaseModel => {
      return new Label();
    },
    fetch: (projectId: ObjectID): Promise<MicrosoftTeamsCardChoiceList> => {
      return MicrosoftTeamsCardChoices.getLabelChoices(projectId, MEMBER_PROPS);
    },
    sort: { name: SortOrder.Ascending },
    cap: 100,
  },
  {
    method: "getOnCallDutyPolicyChoices",
    pluralNoun: "on-call policies",
    reads: OnCallDutyPolicyService as unknown as ChoiceReads,
    newModel: (): DatabaseBaseModel => {
      return new OnCallDutyPolicy();
    },
    fetch: (projectId: ObjectID): Promise<MicrosoftTeamsCardChoiceList> => {
      return MicrosoftTeamsCardChoices.getOnCallDutyPolicyChoices(
        projectId,
        MEMBER_PROPS,
      );
    },
    sort: { name: SortOrder.Ascending },
    cap: 100,
    /*
     * Archived policies page no one, so the card neither offers them nor
     * counts them in "showing the first 100 of N".
     */
    extraQuery: { isArchived: false },
  },
];

// A list read in an order of its own, which the card must keep.
interface OrderedFetcherCase extends FetcherCase {
  // Names as the database returns them in that order: not by name.
  namesInReadOrder: Array<string>;
}

// Lists the card always shows whole: read in their own order, never counted.
const UNCOUNTED_FETCHERS: Array<OrderedFetcherCase> = [
  {
    method: "getIncidentSeverityChoices",
    pluralNoun: "incident severities",
    reads: IncidentSeverityService as unknown as ChoiceReads,
    newModel: (): DatabaseBaseModel => {
      return new IncidentSeverity();
    },
    fetch: (projectId: ObjectID): Promise<MicrosoftTeamsCardChoiceList> => {
      return MicrosoftTeamsCardChoices.getIncidentSeverityChoices(
        projectId,
        MEMBER_PROPS,
      );
    },
    sort: { order: SortOrder.Ascending },
    cap: 50,
    namesInReadOrder: ["Critical", "Major", "Minor", "Low"],
  },
  {
    method: "getMonitorStatusChoices",
    pluralNoun: "monitor statuses",
    reads: MonitorStatusService as unknown as ChoiceReads,
    newModel: (): DatabaseBaseModel => {
      return new MonitorStatus();
    },
    fetch: (projectId: ObjectID): Promise<MicrosoftTeamsCardChoiceList> => {
      return MicrosoftTeamsCardChoices.getMonitorStatusChoices(
        projectId,
        MEMBER_PROPS,
      );
    },
    sort: { priority: SortOrder.Ascending },
    cap: 50,
    namesInReadOrder: ["Operational", "Degraded", "Offline"],
  },
];

// 100 characters, the most a name column holds, and the title it becomes.
const LONG_NAME: string = "abcdefghij".repeat(10);
const LONG_NAME_TITLE: string = "abcdefghij".repeat(7) + "abcdefghi…";

describe("MicrosoftTeamsCardChoices fetchers", () => {
  test("read at most 250 monitors, 100 labels, 100 on-call policies, 50 severities and 50 monitor statuses", () => {
    expect(MICROSOFT_TEAMS_MAX_MONITOR_CHOICES).toBe(250);
    expect(MICROSOFT_TEAMS_MAX_LABEL_CHOICES).toBe(100);
    expect(MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES).toBe(100);
    expect(MICROSOFT_TEAMS_MAX_SEVERITY_CHOICES).toBe(50);
    expect(MICROSOFT_TEAMS_MAX_MONITOR_STATUS_CHOICES).toBe(50);
  });

  for (const fetcher of COUNTED_FETCHERS) {
    describe(fetcher.method, () => {
      test(`reads the project's ${fetcher.pluralNoun} once: _id and name, by name, at most ${fetcher.cap}, as the member the card is for`, async () => {
        const rows: Array<NamedRow> = rowsNamed(3, fetcher.pluralNoun);
        const spies: ReadSpies = stubReads(fetcher, { rows: rows });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(onlyArgumentOf(spies.findBy)).toStrictEqual(
          expectedFindBy(fetcher),
        );
        expect(spies.countBy).not.toHaveBeenCalled();
        expect(list).toStrictEqual({
          choices: choicesFor(rows),
          totalCount: 3,
        });
      });

      test(`counts the project's ${fetcher.pluralNoun} when the cap was reached, and takes that as the total`, async () => {
        const rows: Array<NamedRow> = rowsNamed(
          fetcher.cap,
          fetcher.pluralNoun,
        );
        const spies: ReadSpies = stubReads(fetcher, {
          rows: rows,
          count: 1234,
        });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(onlyArgumentOf(spies.findBy)).toStrictEqual(
          expectedFindBy(fetcher),
        );
        expect(onlyArgumentOf(spies.countBy)).toStrictEqual({
          query: { projectId: PROJECT_ID, ...(fetcher.extraQuery || {}) },
          props: MEMBER_PROPS,
        });
        expect(list.choices).toStrictEqual(choicesFor(rows));
        expect(list.totalCount).toBe(1234);
      });

      test("does not count when one fewer than the cap was read", async () => {
        const rows: Array<NamedRow> = rowsNamed(
          fetcher.cap - 1,
          fetcher.pluralNoun,
        );
        const spies: ReadSpies = stubReads(fetcher, {
          rows: rows,
          count: 1234,
        });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(spies.countBy).not.toHaveBeenCalled();
        expect(list.choices).toHaveLength(fetcher.cap - 1);
        expect(list.totalCount).toBe(fetcher.cap - 1);
      });

      test("makes choices as toChoices does (no nameless rows, names trimmed, long ones cut), while the total still counts every record read", async () => {
        const rows: Array<NamedRow> = [
          { _id: rowId(1), name: "Alpha" },
          { _id: rowId(2), name: "" },
          { _id: rowId(3), name: "   " },
          { _id: rowId(4) },
          { _id: rowId(5), name: "  Beta  " },
          { _id: rowId(6), name: LONG_NAME },
        ];
        const spies: ReadSpies = stubReads(fetcher, { rows: rows });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(spies.countBy).not.toHaveBeenCalled();
        expect(list).toStrictEqual({
          choices: [
            { title: "Alpha", value: rowId(1) },
            { title: "Beta", value: rowId(5) },
            { title: LONG_NAME_TITLE, value: rowId(6) },
          ],
          totalCount: 6,
        });
      });

      test("judges the cap on the rows read, so it still counts when some of them had no name", async () => {
        /*
         * As many rows as the cap, one of them without a name: fewer choices
         * than the cap, but the read was cut off, so there may be more.
         */
        const rows: Array<NamedRow> = rowsNamed(
          fetcher.cap,
          fetcher.pluralNoun,
        );
        rows[0] = { _id: rowId(0) };
        const spies: ReadSpies = stubReads(fetcher, {
          rows: rows,
          count: 1234,
        });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(onlyArgumentOf(spies.countBy)).toStrictEqual({
          query: { projectId: PROJECT_ID, ...(fetcher.extraQuery || {}) },
          props: MEMBER_PROPS,
        });
        expect(list.choices).toStrictEqual(choicesFor(rows.slice(1)));
        expect(list.totalCount).toBe(1234);
      });

      test("offers none of the list to a member who may not read it, or whose plan does not include it", async () => {
        for (const refusal of [
          new NotAuthorizedException("You do not have permissions to read it."),
          new PaymentRequiredException("Not on your plan."),
        ]) {
          jest.restoreAllMocks();

          const spies: ReadSpies = stubReads(fetcher, { rows: [] });
          spies.findBy.mockRejectedValue(refusal);

          expect(await fetcher.fetch(PROJECT_ID)).toStrictEqual({
            choices: [],
            totalCount: 0,
          });
          expect(spies.countBy).not.toHaveBeenCalled();
        }
      });

      test("a count refused for the member counts none, and the card still shows what was read", async () => {
        const rows: Array<NamedRow> = rowsNamed(
          fetcher.cap,
          fetcher.pluralNoun,
        );
        const spies: ReadSpies = stubReads(fetcher, { rows: rows });
        spies.countBy.mockRejectedValue(
          new NotAuthorizedException("You do not have permissions to read it."),
        );

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(list.choices).toStrictEqual(choicesFor(rows));
        expect(list.totalCount).toBe(0);
        // The note under the list takes the larger of the two: nothing is said to be left off.
        expect(
          MicrosoftTeamsCardChoices.getNotShownNote({
            list: list,
            pluralNoun: fetcher.pluralNoun,
            addLaterHint: "",
          }),
        ).toBeNull();
      });

      test("fails when the list or its count cannot be read", async () => {
        stubReads(fetcher, { rows: [] }).findBy.mockRejectedValue(
          new Error("connection refused"),
        );

        await expect(fetcher.fetch(PROJECT_ID)).rejects.toThrow(
          "connection refused",
        );

        jest.restoreAllMocks();

        stubReads(fetcher, {
          rows: rowsNamed(fetcher.cap, fetcher.pluralNoun),
        }).countBy.mockRejectedValue(new Error("count timed out"));

        await expect(fetcher.fetch(PROJECT_ID)).rejects.toThrow(
          "count timed out",
        );
      });
    });
  }

  for (const fetcher of UNCOUNTED_FETCHERS) {
    describe(fetcher.method, () => {
      test(`reads the project's ${fetcher.pluralNoun} once: _id and name, in their own order, at most ${fetcher.cap}, as the member the card is for`, async () => {
        const rows: Array<NamedRow> = rowsNamed(4, fetcher.pluralNoun);
        const spies: ReadSpies = stubReads(fetcher, { rows: rows });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(onlyArgumentOf(spies.findBy)).toStrictEqual(
          expectedFindBy(fetcher),
        );
        expect(spies.countBy).not.toHaveBeenCalled();
        expect(list).toStrictEqual({
          choices: choicesFor(rows),
          totalCount: 4,
        });
      });

      test("never counts, even when the cap was reached: the total is the choices read", async () => {
        const rows: Array<NamedRow> = rowsNamed(
          fetcher.cap,
          fetcher.pluralNoun,
        );
        const spies: ReadSpies = stubReads(fetcher, {
          rows: rows,
          count: 1234,
        });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(spies.countBy).not.toHaveBeenCalled();
        expect(list.choices).toStrictEqual(choicesFor(rows));
        expect(list.totalCount).toBe(fetcher.cap);
      });

      test("keeps the rows in the order they were read, not by name", async () => {
        const names: Array<string> = fetcher.namesInReadOrder;

        // The premise: sorting these by name would change their order.
        const byName: Array<string> = [...names].sort(
          (left: string, right: string): number => {
            return left.localeCompare(right);
          },
        );
        expect(byName).not.toStrictEqual(names);

        const rows: Array<NamedRow> = names.map(
          (name: string, index: number): NamedRow => {
            return { _id: rowId(index), name: name };
          },
        );
        stubReads(fetcher, { rows: rows });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(list).toStrictEqual({
          choices: choicesFor(rows),
          totalCount: names.length,
        });
      });

      test("makes choices as toChoices does (no nameless rows, names trimmed, long ones cut), and the total is the choices kept", async () => {
        const rows: Array<NamedRow> = [
          { _id: rowId(1), name: "Critical" },
          { _id: rowId(2), name: " " },
          { _id: rowId(3) },
          { _id: rowId(4), name: " Minor\n" },
          { _id: rowId(5), name: LONG_NAME },
        ];
        stubReads(fetcher, { rows: rows });

        const list: MicrosoftTeamsCardChoiceList =
          await fetcher.fetch(PROJECT_ID);

        expect(list).toStrictEqual({
          choices: [
            { title: "Critical", value: rowId(1) },
            { title: "Minor", value: rowId(4) },
            { title: LONG_NAME_TITLE, value: rowId(5) },
          ],
          totalCount: 3,
        });
      });

      test("fails when the list cannot be read", async () => {
        stubReads(fetcher, { rows: [] }).findBy.mockRejectedValue(
          new Error("connection refused"),
        );

        await expect(fetcher.fetch(PROJECT_ID)).rejects.toThrow(
          "connection refused",
        );
      });
    });
  }
});
