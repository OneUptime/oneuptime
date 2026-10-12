/*
 * The "create incident" and "create maintenance" forms of the Microsoft Teams
 * bot (issue #4111).
 *
 * Both forms used to offer every monitor, label and on-call policy of the
 * project (up to 10,000 of each) as dropdown choices. Teams measures a bot
 * message as UTF-16 and refuses one over about 100 KB, often less, with HTTP
 * 413 MessageSizeTooBig, so a customer with a few hundred monitors got "Sorry,
 * I encountered an error processing your request" instead of a form. The
 * builders now shorten the monitor, label and on-call policy lists until the
 * card fits a size budget. After a 413 the card is built again for the next
 * budget in MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES, down to 0, which
 * leaves those lists off in one go (the card is built once). The card names
 * whatever it left off, and links to the dashboard to create the incident or
 * event there instead.
 *
 * Pinned here, for both forms: the lists are read through the
 * MicrosoftTeamsCardChoices fetchers for the given project, sorted as the
 * card's notes say; a small project gets every choice and nothing more; the
 * input ids and submit action the submit handlers read are unchanged (a form
 * already posted in a chat must still submit after an upgrade); a huge
 * project (10,000 monitors with 100-character names, 500 labels, 200 on-call
 * policies) gets a card within every non-zero budget, whose notes count
 * exactly what it shows and sit right under the list they are about; the
 * severities and monitor statuses are never shortened; the link to the
 * dashboard is offered only when something was left off and there is a URL
 * to offer; budget 0 keeps the required inputs and builds the card once;
 * every card, whatever the project and budget, is a well-formed form
 * (labelled inputs with ids of their own, compact dropdowns that are never
 * empty, notes that wrap, one submit); the notes and the dashboard button are
 * the elements MicrosoftTeamsCardChoices builds for both forms; the title
 * typed after the command is prefilled within the title column's length; the
 * maintenance form names the time zone of whoever asked for it ("Start and
 * end times are in <zone>.", not "your time zone": in a channel, whoever fills
 * the form in may be somewhere else) and carries it to the submit, which reads
 * the times in that zone whatever zone the submitter is in.
 *
 * Text cut to a length must not be cut through an emoji: half of one (a lone
 * UTF-16 surrogate) shows as a broken character. The prefilled title and long
 * list entries are cut with truncateToLength, which keeps whole characters;
 * the tests that say so pin what was a defect.
 */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../../Server/Services/LabelService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions, {
  MicrosoftTeamsNewScheduledMaintenanceFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import MicrosoftTeamsCardChoices, {
  MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH,
  MICROSOFT_TEAMS_MAX_LABEL_CHOICES,
  MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
  MICROSOFT_TEAMS_MAX_MONITOR_STATUS_CHOICES,
  MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES,
  MICROSOFT_TEAMS_MAX_SEVERITY_CHOICES,
  MicrosoftTeamsCardChoice,
  MicrosoftTeamsCardChoiceList,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import MicrosoftTeamsTimezone, {
  MicrosoftTeamsUserTimezone,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsTimezone";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../../../Types/PositiveNumber";

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7c9a2e-1f3b-4c6d-8e9f-0a1b2c3d4e5f",
);

// The member a card is for: every list is read with their own props.
const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7c9a2e-0000-4c6d-8e9f-0a1b2c3d4e60"),
  tenantId: PROJECT_ID,
};

const CREATE_INCIDENT_URL: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/incidents/create`;
const CREATE_MAINTENANCE_URL: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/create`;

const INCIDENT_ADD_LATER_HINT: string =
  "You can add them to the incident in OneUptime after it is created.";
const MAINTENANCE_ADD_LATER_HINT: string =
  "You can add them to the event in OneUptime after it is created.";
const GENERIC_TIMEZONE_NOTE: string =
  "Start and end times are in the time zone Microsoft Teams reports for you, or in UTC if it does not report one.";

// Incident.title is LongText, ScheduledMaintenance.title is ShortText.
const INCIDENT_TITLE_MAX_LENGTH: number = 500;
const MAINTENANCE_TITLE_MAX_LENGTH: number = 100;

const HUGE_MONITOR_COUNT: number = 10000;
const HUGE_LABEL_COUNT: number = 500;
const HUGE_POLICY_COUNT: number = 200;

// The budgets a card is fitted to; 0 (no optional lists) has its own tests.
const NON_ZERO_BUDGETS: Array<number> =
  MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES.filter((budget: number) => {
    return budget > 0;
  });
const FIRST_BUDGET: number = MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!;

type NamedRow = {
  _id: string;
  name: string;
};

function padded(index: number): string {
  return String(index).padStart(5, "0");
}

// A distinct, well-formed id per table and row.
function rowId(table: number, index: number): string {
  return `00000000-0000-4000-8${String(table).padStart(3, "0")}-${String(
    index,
  ).padStart(12, "0")}`;
}

// Rows in name order, as the fetchers read them.
function buildRows(data: {
  table: number;
  count: number;
  nameOf: (index: number) => string;
}): Array<NamedRow> {
  const rows: Array<NamedRow> = [];

  for (let index: number = 1; index <= data.count; index++) {
    rows.push({ _id: rowId(data.table, index), name: data.nameOf(index) });
  }

  return rows;
}

// Exactly 100 UTF-16 units, with an emoji, which Teams counts as two.
function monitorName(index: number): string {
  return `Monitor ${padded(index)} 🌍 checkout-api.eu-west-1.production.example.com / HTTPS health check ${"x".repeat(100)}`.substring(
    0,
    100,
  );
}

/*
 * Longer than a dropdown row, with an emoji right where toChoices cuts such a
 * name: the emoji's first half is the last code unit the cut keeps.
 */
function emojiAtTheCutName(index: number): string {
  return `${"x".repeat(MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH - 2)}🌍 edge ${padded(index)}`;
}

const SEVERITY_ROWS: Array<NamedRow> = buildRows({
  table: 1,
  count: 5,
  nameOf: (index: number): string => {
    return ["Critical", "Major", "Minor", "Warning", "Informational"][
      index - 1
    ]!;
  },
});

const MONITOR_STATUS_ROWS: Array<NamedRow> = buildRows({
  table: 2,
  count: 5,
  nameOf: (index: number): string => {
    return [
      "Operational",
      "Degraded",
      "Partial Outage",
      "Major Outage",
      "Under Maintenance",
    ][index - 1]!;
  },
});

const HUGE_MONITOR_ROWS: Array<NamedRow> = buildRows({
  table: 3,
  count: HUGE_MONITOR_COUNT,
  nameOf: monitorName,
});

const HUGE_LABEL_ROWS: Array<NamedRow> = buildRows({
  table: 4,
  count: HUGE_LABEL_COUNT,
  nameOf: (index: number): string => {
    return `label ${padded(index)}: team-payments/service-tier-1`;
  },
});

const HUGE_POLICY_ROWS: Array<NamedRow> = buildRows({
  table: 5,
  count: HUGE_POLICY_COUNT,
  nameOf: (index: number): string => {
    return `On-call policy ${padded(index)} - Payments primary (EU business hours)`;
  },
});

const SMALL_MONITOR_ROWS: Array<NamedRow> = buildRows({
  table: 6,
  count: 3,
  nameOf: (index: number): string => {
    return ["API", "Checkout", "Website"][index - 1]!;
  },
});

const SMALL_LABEL_ROWS: Array<NamedRow> = buildRows({
  table: 7,
  count: 2,
  nameOf: (index: number): string => {
    return ["backend", "customer-facing"][index - 1]!;
  },
});

const SMALL_POLICY_ROWS: Array<NamedRow> = buildRows({
  table: 8,
  count: 2,
  nameOf: (index: number): string => {
    return ["Primary on-call", "Secondary on-call"][index - 1]!;
  },
});

// Every row as a choice, as the form read them before #4111 (no cap).
function listOf(rows: Array<NamedRow>): MicrosoftTeamsCardChoiceList {
  return {
    choices: rows.map((row: NamedRow): MicrosoftTeamsCardChoice => {
      return { title: row.name, value: row._id };
    }),
    totalCount: rows.length,
  };
}

function emptyList(): MicrosoftTeamsCardChoiceList {
  return { choices: [], totalCount: 0 };
}

function smallIncidentChoices(): MicrosoftTeamsNewIncidentFormChoices {
  return {
    severities: listOf(SEVERITY_ROWS),
    monitors: listOf(SMALL_MONITOR_ROWS),
    monitorStatuses: listOf(MONITOR_STATUS_ROWS),
    labels: listOf(SMALL_LABEL_ROWS),
    onCallDutyPolicies: listOf(SMALL_POLICY_ROWS),
  };
}

function smallMaintenanceChoices(): MicrosoftTeamsNewScheduledMaintenanceFormChoices {
  return {
    monitors: listOf(SMALL_MONITOR_ROWS),
    monitorStatuses: listOf(MONITOR_STATUS_ROWS),
    labels: listOf(SMALL_LABEL_ROWS),
  };
}

function wholeHugeIncidentChoices(): MicrosoftTeamsNewIncidentFormChoices {
  return {
    severities: listOf(SEVERITY_ROWS),
    monitors: listOf(HUGE_MONITOR_ROWS),
    monitorStatuses: listOf(MONITOR_STATUS_ROWS),
    labels: listOf(HUGE_LABEL_ROWS),
    onCallDutyPolicies: listOf(HUGE_POLICY_ROWS),
  };
}

function wholeHugeMaintenanceChoices(): MicrosoftTeamsNewScheduledMaintenanceFormChoices {
  return {
    monitors: listOf(HUGE_MONITOR_ROWS),
    monitorStatuses: listOf(MONITOR_STATUS_ROWS),
    labels: listOf(HUGE_LABEL_ROWS),
  };
}

type FindByArgs = {
  query: { projectId?: unknown };
  select?: unknown;
  sort?: unknown;
  limit: number | PositiveNumber;
  skip: number | PositiveNumber;
  props?: unknown;
};

type CountByArgs = {
  query: { projectId?: unknown };
  props?: unknown;
};

// The two reads the MicrosoftTeamsCardChoices fetchers make of a table.
type RowTable = {
  findBy: (findBy: FindByArgs) => Promise<Array<NamedRow>>;
  countBy: (countBy: CountByArgs) => Promise<PositiveNumber>;
};

// What each table was asked for, read by read.
type ProjectReads = {
  severities: Array<FindByArgs>;
  monitorStatuses: Array<FindByArgs>;
  monitors: Array<FindByArgs>;
  labels: Array<FindByArgs>;
  onCallDutyPolicies: Array<FindByArgs>;
};

function toNumber(value: number | PositiveNumber): number {
  return typeof value === "number" ? value : value.toNumber();
}

function isThisProject(query: { projectId?: unknown }): boolean {
  return String(query.projectId) === PROJECT_ID.toString();
}

/*
 * Stands in for one table of the project: findBy honours skip and limit and
 * countBy counts every row, both for PROJECT_ID only. Returns the findBy
 * reads as they happen.
 */
function serveRows(service: unknown, rows: Array<NamedRow>): Array<FindByArgs> {
  const table: RowTable = service as RowTable;
  const reads: Array<FindByArgs> = [];

  jest
    .spyOn(table, "findBy")
    .mockImplementation(
      async (findBy: FindByArgs): Promise<Array<NamedRow>> => {
        reads.push(findBy);

        if (!isThisProject(findBy.query)) {
          return [];
        }

        const skip: number = toNumber(findBy.skip);

        return rows.slice(skip, skip + toNumber(findBy.limit));
      },
    );

  jest
    .spyOn(table, "countBy")
    .mockImplementation(
      async (countBy: CountByArgs): Promise<PositiveNumber> => {
        return new PositiveNumber(
          isThisProject(countBy.query) ? rows.length : 0,
        );
      },
    );

  return reads;
}

function serveProject(data: {
  monitors: Array<NamedRow>;
  labels: Array<NamedRow>;
  onCallDutyPolicies: Array<NamedRow>;
}): ProjectReads {
  return {
    severities: serveRows(IncidentSeverityService, SEVERITY_ROWS),
    monitorStatuses: serveRows(MonitorStatusService, MONITOR_STATUS_ROWS),
    monitors: serveRows(MonitorService, data.monitors),
    labels: serveRows(LabelService, data.labels),
    onCallDutyPolicies: serveRows(
      OnCallDutyPolicyService,
      data.onCallDutyPolicies,
    ),
  };
}

function serveHugeProject(): ProjectReads {
  return serveProject({
    monitors: HUGE_MONITOR_ROWS,
    labels: HUGE_LABEL_ROWS,
    onCallDutyPolicies: HUGE_POLICY_ROWS,
  });
}

// One read of the table, for this project, of the names and ids alone.
function expectOneRead(data: {
  reads: Array<FindByArgs>;
  sort: JSONObject;
  limit: number;
}): void {
  expect(data.reads).toHaveLength(1);
  expect(data.reads[0]).toMatchObject({
    query: { projectId: PROJECT_ID },
    sort: data.sort,
    limit: data.limit,
    skip: 0,
    props: MEMBER_PROPS,
  });
  expect(data.reads[0]!.select).toEqual({ _id: true, name: true });
}

function bodyOf(card: JSONObject): Array<JSONObject> {
  return card["body"] as Array<JSONObject>;
}

function actionsOf(card: JSONObject): Array<JSONObject> {
  return card["actions"] as Array<JSONObject>;
}

function getActionTypes(card: JSONObject): Array<string> {
  return actionsOf(card).map((action: JSONObject) => {
    return action["type"] as string;
  });
}

function getInput(card: JSONObject, id: string): JSONObject | undefined {
  return bodyOf(card).find((element: JSONObject) => {
    return element["id"] === id;
  });
}

function getInputOrFail(card: JSONObject, id: string): JSONObject {
  const input: JSONObject | undefined = getInput(card, id);

  if (!input) {
    throw new Error(`The card has no input "${id}"`);
  }

  return input;
}

// Each input as "<type> <id>", in card order.
function describeInputs(card: JSONObject): Array<string> {
  return bodyOf(card)
    .filter((element: JSONObject) => {
      return typeof element["id"] === "string";
    })
    .map((element: JSONObject) => {
      return `${element["type"] as string} ${element["id"] as string}`;
    });
}

/*
 * The card from top to bottom, one line per element: "<type> <id>" for an
 * input, "note: <text>" for the small print and "heading: <text>" for the
 * line that names the form.
 */
function layoutOf(card: JSONObject): Array<string> {
  return bodyOf(card).map((element: JSONObject): string => {
    if (typeof element["id"] === "string") {
      return `${element["type"] as string} ${element["id"] as string}`;
    }

    if (element["type"] === "TextBlock") {
      const kind: string = element["isSubtle"] === true ? "note" : "heading";

      return `${kind}: ${element["text"] as string}`;
    }

    return element["type"] as string;
  });
}

function getChoices(
  card: JSONObject,
  id: string,
): Array<MicrosoftTeamsCardChoice> {
  const input: JSONObject | undefined = getInput(card, id);

  return input ? (input["choices"] as Array<MicrosoftTeamsCardChoice>) : [];
}

// The small print on the card: notes about lists, and the time zone.
function getNotes(card: JSONObject): Array<string> {
  return bodyOf(card)
    .filter((element: JSONObject) => {
      return element["type"] === "TextBlock" && element["isSubtle"] === true;
    })
    .map((element: JSONObject) => {
      return element["text"] as string;
    });
}

function getSubmitAction(card: JSONObject): JSONObject {
  const submitActions: Array<JSONObject> = actionsOf(card).filter(
    (action: JSONObject) => {
      return action["type"] === "Action.Submit";
    },
  );

  expect(submitActions).toHaveLength(1);

  return submitActions[0]!;
}

function getSubmitData(card: JSONObject): JSONObject {
  return getSubmitAction(card)["data"] as JSONObject;
}

function getOpenUrlActions(card: JSONObject): Array<JSONObject> {
  return actionsOf(card).filter((action: JSONObject) => {
    return action["type"] === "Action.OpenUrl";
  });
}

/*
 * The buttons under the form: the submit, then "Create in OneUptime" when a
 * URL is expected (null: no such link).
 */
function expectCreateInOneUptimeLink(
  card: JSONObject,
  url: string | null,
): void {
  if (url === null) {
    expect(getActionTypes(card)).toEqual(["Action.Submit"]);
    return;
  }

  expect(getActionTypes(card)).toEqual(["Action.Submit", "Action.OpenUrl"]);
  expect(getOpenUrlActions(card)).toEqual([
    {
      type: "Action.OpenUrl",
      title: "Create in OneUptime",
      url: url,
    },
  ]);
}

function sizeOf(card: JSONObject): number {
  return MicrosoftTeamsMessageSize.getSizeInBytes(card);
}

/*
 * Within the budget as Teams measures a message: in UTF-16 code units, two
 * bytes each. Counted here as well as by getSizeInBytes, which the card
 * builders fit to: a count in UTF-8 bytes, say, would pass a card twice as
 * large as Teams sees it.
 */
function expectWithinBudget(card: JSONObject, budgetInBytes: number): void {
  expect(JSON.stringify(card).length * 2).toBeLessThanOrEqual(budgetInBytes);
  expect(sizeOf(card)).toBeLessThanOrEqual(budgetInBytes);
}

// Text made of whole characters: every surrogate is one half of a pair.
const WHOLE_CHARACTERS_ONLY: RegExp =
  /^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;

function hasHalfAnEmoji(text: string): boolean {
  return !WHOLE_CHARACTERS_ONLY.test(text);
}

// Every text on the card that holds half of an emoji.
function getTextsWithHalfAnEmoji(value: unknown): Array<string> {
  if (typeof value === "string") {
    return hasHalfAnEmoji(value) ? [value] : [];
  }

  const texts: Array<string> = [];

  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      texts.push(...getTextsWithHalfAnEmoji(child));
    }
  }

  return texts;
}

function showingNote(data: {
  shown: number;
  total: number;
  noun: string;
  hint: string;
}): string {
  return `Showing the first ${data.shown} of ${data.total} ${data.noun}, by name. ${data.hint}`;
}

function tooManyNote(data: {
  total: number;
  noun: string;
  hint: string;
}): string {
  return `This project has ${data.total} ${data.noun}, too many to list in Microsoft Teams. ${data.hint}`;
}

/*
 * The zone is the one the form was asked for from, and the times are read in
 * it; it is not "your time zone" to someone else who fills the form in.
 */
function knownTimezoneNote(timezone: string): string {
  return `Start and end times are in ${timezone}.`;
}

// A list the card shortens, and what its note must say.
type ShortenedList = {
  inputId: string;
  list: MicrosoftTeamsCardChoiceList;
  total: number;
  noun: string;
};

/*
 * Each shortened list shows its first choices (the note says "the first N ...,
 * by name"), is still a usable list, and its note gives N as the number of
 * choices actually on the card and the project's total. Returns the notes in
 * card order.
 */
function expectShortenedLists(data: {
  card: JSONObject;
  lists: Array<ShortenedList>;
  hint: string;
}): Array<string> {
  const notes: Array<string> = [];

  for (const shortened of data.lists) {
    const shown: Array<MicrosoftTeamsCardChoice> = getChoices(
      data.card,
      shortened.inputId,
    );

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(shortened.total);
    expect(shown).toEqual(shortened.list.choices.slice(0, shown.length));

    notes.push(
      showingNote({
        shown: shown.length,
        total: shortened.total,
        noun: shortened.noun,
        hint: data.hint,
      }),
    );
  }

  return notes;
}

function expectHugeIncidentCard(data: {
  card: JSONObject;
  choices: MicrosoftTeamsNewIncidentFormChoices;
  budgetInBytes: number;
  // The "Create in OneUptime" link the card offers, or null for none.
  createInOneUptimeUrl: string | null;
}): void {
  const { card, choices, budgetInBytes } = data;

  expect(card["version"]).toBe("1.5");
  expectWithinBudget(card, budgetInBytes);
  // Shortened, not stripped: the card still uses most of its budget.
  expect(sizeOf(card)).toBeGreaterThan(budgetInBytes / 2);

  // Required, so never shortened.
  expect(getChoices(card, "incidentSeverity")).toEqual(
    choices.severities.choices,
  );
  // Shown whole whenever monitors are shown.
  expect(getChoices(card, "monitorStatus")).toEqual(
    choices.monitorStatuses.choices,
  );

  const [monitorsNote, policiesNote, labelsNote]: Array<string> =
    expectShortenedLists({
      card: card,
      hint: INCIDENT_ADD_LATER_HINT,
      lists: [
        {
          inputId: "incidentMonitors",
          list: choices.monitors,
          total: HUGE_MONITOR_COUNT,
          noun: "monitors",
        },
        {
          inputId: "onCallDutyPolicies",
          list: choices.onCallDutyPolicies,
          total: HUGE_POLICY_COUNT,
          noun: "on-call policies",
        },
        {
          inputId: "labels",
          list: choices.labels,
          total: HUGE_LABEL_COUNT,
          noun: "labels",
        },
      ],
    });

  // Each note right under the list it is about.
  expect(layoutOf(card)).toEqual([
    "heading: Create New Incident",
    "Input.Text incidentTitle",
    "Input.Text incidentDescription",
    "Input.ChoiceSet incidentSeverity",
    "Input.ChoiceSet incidentMonitors",
    `note: ${monitorsNote}`,
    "Input.ChoiceSet monitorStatus",
    "Input.ChoiceSet onCallDutyPolicies",
    `note: ${policiesNote}`,
    "Input.ChoiceSet labels",
    `note: ${labelsNote}`,
  ]);

  expectCreateInOneUptimeLink(card, data.createInOneUptimeUrl);
}

function expectHugeMaintenanceCard(data: {
  card: JSONObject;
  choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices;
  budgetInBytes: number;
  timezoneNote: string;
  // The "Create in OneUptime" link the card offers, or null for none.
  createInOneUptimeUrl: string | null;
}): void {
  const { card, choices, budgetInBytes } = data;

  expect(card["version"]).toBe("1.5");
  expectWithinBudget(card, budgetInBytes);
  expect(sizeOf(card)).toBeGreaterThan(budgetInBytes / 2);

  expect(getChoices(card, "monitorStatus")).toEqual(
    choices.monitorStatuses.choices,
  );

  const [monitorsNote, labelsNote]: Array<string> = expectShortenedLists({
    card: card,
    hint: MAINTENANCE_ADD_LATER_HINT,
    lists: [
      {
        inputId: "scheduledMaintenanceMonitors",
        list: choices.monitors,
        total: HUGE_MONITOR_COUNT,
        noun: "monitors",
      },
      {
        inputId: "labels",
        list: choices.labels,
        total: HUGE_LABEL_COUNT,
        noun: "labels",
      },
    ],
  });

  // The time zone just above the dates, each list's note right under it.
  expect(layoutOf(card)).toEqual([
    "heading: Create New Scheduled Maintenance",
    "Input.Text scheduledMaintenanceTitle",
    "Input.Text scheduledMaintenanceDescription",
    `note: ${data.timezoneNote}`,
    "Input.Date startDate",
    "Input.Time startTime",
    "Input.Date endDate",
    "Input.Time endTime",
    "Input.ChoiceSet scheduledMaintenanceMonitors",
    `note: ${monitorsNote}`,
    "Input.ChoiceSet monitorStatus",
    "Input.ChoiceSet labels",
    `note: ${labelsNote}`,
  ]);

  expectCreateInOneUptimeLink(card, data.createInOneUptimeUrl);
}

function shownCounts(card: JSONObject, inputIds: Array<string>): Array<number> {
  return inputIds.map((inputId: string) => {
    return getChoices(card, inputId).length;
  });
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsIncidentActions.getNewIncidentFormChoices", () => {
  test("reads each list through MicrosoftTeamsCardChoices, for the given project", async () => {
    const choices: MicrosoftTeamsNewIncidentFormChoices =
      smallIncidentChoices();

    const spies: Array<ReturnType<typeof jest.spyOn>> = [
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getIncidentSeverityChoices")
        .mockResolvedValue(choices.severities),
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getMonitorChoices")
        .mockResolvedValue(choices.monitors),
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getMonitorStatusChoices")
        .mockResolvedValue(choices.monitorStatuses),
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getLabelChoices")
        .mockResolvedValue(choices.labels),
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getOnCallDutyPolicyChoices")
        .mockResolvedValue(choices.onCallDutyPolicies),
    ];

    const result: MicrosoftTeamsNewIncidentFormChoices =
      await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      );

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
      // Read in the project, as the member the card is for.
      expect(spy).toHaveBeenCalledWith(PROJECT_ID, MEMBER_PROPS);
    }

    // Each list under its own key: a swap would offer monitors as severities.
    expect(result.severities).toBe(choices.severities);
    expect(result.monitors).toBe(choices.monitors);
    expect(result.monitorStatuses).toBe(choices.monitorStatuses);
    expect(result.labels).toBe(choices.labels);
    expect(result.onCallDutyPolicies).toBe(choices.onCallDutyPolicies);
    expect(Object.keys(result).sort()).toEqual([
      "labels",
      "monitorStatuses",
      "monitors",
      "onCallDutyPolicies",
      "severities",
    ]);
  });

  test("fails when a list cannot be read, so the command can say so", async () => {
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getIncidentSeverityChoices")
      .mockResolvedValue(listOf(SEVERITY_ROWS));
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getMonitorChoices")
      .mockResolvedValue(listOf(SMALL_MONITOR_ROWS));
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getMonitorStatusChoices")
      .mockResolvedValue(listOf(MONITOR_STATUS_ROWS));
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getLabelChoices")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getOnCallDutyPolicyChoices")
      .mockResolvedValue(listOf(SMALL_POLICY_ROWS));

    await expect(
      MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      ),
    ).rejects.toThrow("Connection terminated unexpectedly");
  });

  test("reads a huge project as capped lists that still know the project's totals", async () => {
    serveHugeProject();

    const choices: MicrosoftTeamsNewIncidentFormChoices =
      await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      );

    expect(choices.monitors.choices).toHaveLength(
      MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
    );
    expect(choices.monitors.totalCount).toBe(HUGE_MONITOR_COUNT);
    expect(choices.labels.choices).toHaveLength(
      MICROSOFT_TEAMS_MAX_LABEL_CHOICES,
    );
    expect(choices.labels.totalCount).toBe(HUGE_LABEL_COUNT);
    expect(choices.onCallDutyPolicies.choices).toHaveLength(
      MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES,
    );
    expect(choices.onCallDutyPolicies.totalCount).toBe(HUGE_POLICY_COUNT);
    expect(choices.severities.choices).toHaveLength(5);
    expect(choices.monitorStatuses.choices).toHaveLength(5);
  });

  test("reads each list once, capped, sorted as the card says, names and ids only", async () => {
    const reads: ProjectReads = serveHugeProject();

    await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
      PROJECT_ID,
      MEMBER_PROPS,
    );

    // The notes under these three say "Showing the first N of M ..., by name".
    expectOneRead({
      reads: reads.monitors,
      sort: { name: SortOrder.Ascending },
      limit: MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
    });
    expectOneRead({
      reads: reads.labels,
      sort: { name: SortOrder.Ascending },
      limit: MICROSOFT_TEAMS_MAX_LABEL_CHOICES,
    });
    expectOneRead({
      reads: reads.onCallDutyPolicies,
      sort: { name: SortOrder.Ascending },
      limit: MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES,
    });

    // As the project orders them everywhere else.
    expectOneRead({
      reads: reads.severities,
      sort: { order: SortOrder.Ascending },
      limit: MICROSOFT_TEAMS_MAX_SEVERITY_CHOICES,
    });
    expectOneRead({
      reads: reads.monitorStatuses,
      sort: { priority: SortOrder.Ascending },
      limit: MICROSOFT_TEAMS_MAX_MONITOR_STATUS_CHOICES,
    });
  });
});

describe("MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices", () => {
  test("reads the monitor, monitor status and label lists for the given project, and nothing else", async () => {
    const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
      smallMaintenanceChoices();

    const spies: Array<ReturnType<typeof jest.spyOn>> = [
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getMonitorChoices")
        .mockResolvedValue(choices.monitors),
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getMonitorStatusChoices")
        .mockResolvedValue(choices.monitorStatuses),
      jest
        .spyOn(MicrosoftTeamsCardChoices, "getLabelChoices")
        .mockResolvedValue(choices.labels),
    ];
    const severitySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(MicrosoftTeamsCardChoices, "getIncidentSeverityChoices")
      .mockResolvedValue(listOf(SEVERITY_ROWS));
    const policySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(MicrosoftTeamsCardChoices, "getOnCallDutyPolicyChoices")
      .mockResolvedValue(listOf(SMALL_POLICY_ROWS));

    const result: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
      await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      );

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
      // Read in the project, as the member the card is for.
      expect(spy).toHaveBeenCalledWith(PROJECT_ID, MEMBER_PROPS);
    }

    // A maintenance event has no severity and pages no on-call policy.
    expect(severitySpy).not.toHaveBeenCalled();
    expect(policySpy).not.toHaveBeenCalled();

    expect(result.monitors).toBe(choices.monitors);
    expect(result.monitorStatuses).toBe(choices.monitorStatuses);
    expect(result.labels).toBe(choices.labels);
    expect(Object.keys(result).sort()).toEqual([
      "labels",
      "monitorStatuses",
      "monitors",
    ]);
  });

  test("fails when a list cannot be read, so the command can say so", async () => {
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getMonitorChoices")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getMonitorStatusChoices")
      .mockResolvedValue(listOf(MONITOR_STATUS_ROWS));
    jest
      .spyOn(MicrosoftTeamsCardChoices, "getLabelChoices")
      .mockResolvedValue(listOf(SMALL_LABEL_ROWS));

    await expect(
      MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      ),
    ).rejects.toThrow("Connection terminated unexpectedly");
  });

  test("reads a huge project as capped lists that still know the project's totals", async () => {
    const reads: ProjectReads = serveHugeProject();

    const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
      await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      );

    expect(choices.monitors.choices).toHaveLength(
      MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
    );
    expect(choices.monitors.totalCount).toBe(HUGE_MONITOR_COUNT);
    expect(choices.labels.choices).toHaveLength(
      MICROSOFT_TEAMS_MAX_LABEL_CHOICES,
    );
    expect(choices.labels.totalCount).toBe(HUGE_LABEL_COUNT);
    expect(choices.monitorStatuses.choices).toHaveLength(5);

    expect(reads.severities).toEqual([]);
    expect(reads.onCallDutyPolicies).toEqual([]);
  });
});

describe("MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget, small project", () => {
  test.each(NON_ZERO_BUDGETS)(
    "lists every choice within %i bytes, with no notes and no extra link",
    (budget: number) => {
      const choices: MicrosoftTeamsNewIncidentFormChoices =
        smallIncidentChoices();

      const card: JSONObject =
        MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: budget,
          // Nothing is left off, so the link is not offered.
          createInOneUptimeUrl: CREATE_INCIDENT_URL,
        });

      expect(card["type"]).toBe("AdaptiveCard");
      expect(card["version"]).toBe("1.5");
      expect(card["$schema"]).toBe(
        "http://adaptivecards.io/schemas/adaptive-card.json",
      );
      expectWithinBudget(card, budget);

      expect(getChoices(card, "incidentSeverity")).toEqual(
        choices.severities.choices,
      );
      expect(getChoices(card, "incidentMonitors")).toEqual(
        choices.monitors.choices,
      );
      expect(getChoices(card, "monitorStatus")).toEqual(
        choices.monitorStatuses.choices,
      );
      expect(getChoices(card, "onCallDutyPolicies")).toEqual(
        choices.onCallDutyPolicies.choices,
      );
      expect(getChoices(card, "labels")).toEqual(choices.labels.choices);

      expect(getNotes(card)).toEqual([]);
      expect(getOpenUrlActions(card)).toEqual([]);
      expect(getActionTypes(card)).toEqual(["Action.Submit"]);
    },
  );

  test("keeps the input ids and the submit action the submit handler reads", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: smallIncidentChoices(),
        budgetInBytes: FIRST_BUDGET,
      });

    expect(describeInputs(card)).toEqual([
      "Input.Text incidentTitle",
      "Input.Text incidentDescription",
      "Input.ChoiceSet incidentSeverity",
      "Input.ChoiceSet incidentMonitors",
      "Input.ChoiceSet monitorStatus",
      "Input.ChoiceSet onCallDutyPolicies",
      "Input.ChoiceSet labels",
    ]);

    expect(getSubmitAction(card)).toEqual({
      type: "Action.Submit",
      title: "Create Incident",
      data: { action: "SubmitNewIncident" },
    });
    expect(getSubmitData(card)["action"]).toBe(
      MicrosoftTeamsIncidentActionType.SubmitNewIncident,
    );

    // Required inputs; the submit handler refuses a submit without them.
    for (const requiredId of [
      "incidentTitle",
      "incidentDescription",
      "incidentSeverity",
    ]) {
      expect(getInputOrFail(card, requiredId)["isRequired"]).toBe(true);
    }

    // Many ids arrive comma separated; one severity and one status arrive alone.
    for (const multiSelectId of [
      "incidentMonitors",
      "onCallDutyPolicies",
      "labels",
    ]) {
      expect(getInputOrFail(card, multiSelectId)["isMultiSelect"]).toBe(true);
    }
    for (const singleSelectId of ["incidentSeverity", "monitorStatus"]) {
      expect(
        getInputOrFail(card, singleSelectId)["isMultiSelect"],
      ).toBeUndefined();
    }

    expect(getInputOrFail(card, "incidentDescription")["isMultiline"]).toBe(
      true,
    );
  });
});

describe("MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget, small project", () => {
  test.each(NON_ZERO_BUDGETS)(
    "lists every choice within %i bytes, with only the time zone note and no extra link",
    (budget: number) => {
      const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
        smallMaintenanceChoices();

      const card: JSONObject =
        MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: choices,
            budgetInBytes: budget,
            createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
          },
        );

      expect(card["type"]).toBe("AdaptiveCard");
      expect(card["version"]).toBe("1.5");
      expect(card["$schema"]).toBe(
        "http://adaptivecards.io/schemas/adaptive-card.json",
      );
      expectWithinBudget(card, budget);

      expect(getChoices(card, "scheduledMaintenanceMonitors")).toEqual(
        choices.monitors.choices,
      );
      expect(getChoices(card, "monitorStatus")).toEqual(
        choices.monitorStatuses.choices,
      );
      expect(getChoices(card, "labels")).toEqual(choices.labels.choices);

      expect(getNotes(card)).toEqual([GENERIC_TIMEZONE_NOTE]);
      expect(getOpenUrlActions(card)).toEqual([]);
      expect(getActionTypes(card)).toEqual(["Action.Submit"]);
    },
  );

  test("keeps the input ids and the submit action the submit handler reads", () => {
    const card: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: smallMaintenanceChoices(),
          budgetInBytes: FIRST_BUDGET,
        },
      );

    expect(describeInputs(card)).toEqual([
      "Input.Text scheduledMaintenanceTitle",
      "Input.Text scheduledMaintenanceDescription",
      "Input.Date startDate",
      "Input.Time startTime",
      "Input.Date endDate",
      "Input.Time endTime",
      "Input.ChoiceSet scheduledMaintenanceMonitors",
      "Input.ChoiceSet monitorStatus",
      "Input.ChoiceSet labels",
    ]);

    expect(getSubmitAction(card)).toEqual({
      type: "Action.Submit",
      title: "Create Maintenance Event",
      data: { action: "SubmitNewScheduledMaintenance" },
    });
    expect(getSubmitData(card)["action"]).toBe(
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
    );

    for (const requiredId of [
      "scheduledMaintenanceTitle",
      "scheduledMaintenanceDescription",
      "startDate",
      "startTime",
      "endDate",
      "endTime",
    ]) {
      expect(getInputOrFail(card, requiredId)["isRequired"]).toBe(true);
    }

    for (const multiSelectId of ["scheduledMaintenanceMonitors", "labels"]) {
      expect(getInputOrFail(card, multiSelectId)["isMultiSelect"]).toBe(true);
    }
    expect(
      getInputOrFail(card, "monitorStatus")["isMultiSelect"],
    ).toBeUndefined();

    // Nothing incident-only on this form.
    expect(getInput(card, "incidentSeverity")).toBeUndefined();
    expect(getInput(card, "onCallDutyPolicies")).toBeUndefined();
  });

  test("names the time zone right above the start and end inputs", () => {
    const card: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: smallMaintenanceChoices(),
          budgetInBytes: FIRST_BUDGET,
          timezone: "America/New_York",
        },
      );

    const body: Array<JSONObject> = bodyOf(card);
    const startDateIndex: number = body.findIndex((element: JSONObject) => {
      return element["id"] === "startDate";
    });

    expect(startDateIndex).toBeGreaterThan(0);
    expect(body[startDateIndex - 1]).toMatchObject({
      type: "TextBlock",
      text: knownTimezoneNote("America/New_York"),
      wrap: true,
    });
  });
});

describe("the submit data never collides with an input", () => {
  /*
   * Teams merges the Action.Submit data with the input values into one
   * object, so an input named like a data key would overwrite it.
   */
  test("incident form", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: smallIncidentChoices(),
        budgetInBytes: FIRST_BUDGET,
      });

    for (const key of Object.keys(getSubmitData(card))) {
      expect(getInput(card, key)).toBeUndefined();
    }
  });

  test("maintenance form, with the time zone in its data", () => {
    const card: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: smallMaintenanceChoices(),
          budgetInBytes: FIRST_BUDGET,
          timezone: "Europe/Berlin",
        },
      );

    expect(Object.keys(getSubmitData(card)).sort()).toEqual([
      "action",
      "timezone",
    ]);

    for (const key of Object.keys(getSubmitData(card))) {
      expect(getInput(card, key)).toBeUndefined();
    }
  });
});

describe("MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget, huge project (#4111)", () => {
  test.each(NON_ZERO_BUDGETS)(
    "fits %i bytes with the lists as the fetchers read them, and says what it left off",
    async (budget: number) => {
      serveHugeProject();

      const choices: MicrosoftTeamsNewIncidentFormChoices =
        await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
          PROJECT_ID,
          MEMBER_PROPS,
        );

      const card: JSONObject =
        MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: budget,
          initialTitle: "Checkout is down",
          createInOneUptimeUrl: CREATE_INCIDENT_URL,
        });

      expectHugeIncidentCard({
        card: card,
        choices: choices,
        budgetInBytes: budget,
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });
      expect(getInputOrFail(card, "incidentTitle")["value"]).toBe(
        "Checkout is down",
      );
    },
  );

  test.each(NON_ZERO_BUDGETS)(
    "fits %i bytes even when handed every monitor, label and policy of the project",
    (budget: number) => {
      const choices: MicrosoftTeamsNewIncidentFormChoices =
        wholeHugeIncidentChoices();

      const card: JSONObject =
        MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: budget,
          // The longest title the form takes counts against the budget too.
          initialTitle: "t".repeat(INCIDENT_TITLE_MAX_LENGTH),
          createInOneUptimeUrl: CREATE_INCIDENT_URL,
        });

      expectHugeIncidentCard({
        card: card,
        choices: choices,
        budgetInBytes: budget,
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });
    },
  );

  test("the old card, with every choice, is far over what Teams takes", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: wholeHugeIncidentChoices(),
        budgetInBytes: Number.MAX_SAFE_INTEGER,
      });

    expect(getChoices(card, "incidentMonitors")).toHaveLength(
      HUGE_MONITOR_COUNT,
    );
    // Teams refuses a message over about 100 KB.
    expect(sizeOf(card)).toBeGreaterThan(100 * 1024);
  });

  /*
   * No dashboard URL could be built (null), none was given (undefined), or
   * it came out empty: an Action.OpenUrl needs somewhere to go. The card is
   * otherwise the same, and still says what it left off.
   */
  test.each([null, undefined, ""])(
    "offers no Create in OneUptime link without a URL (%p), at any budget",
    async (createInOneUptimeUrl: string | null | undefined) => {
      serveHugeProject();

      const choices: MicrosoftTeamsNewIncidentFormChoices =
        await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
          PROJECT_ID,
          MEMBER_PROPS,
        );

      for (const budget of NON_ZERO_BUDGETS) {
        expectHugeIncidentCard({
          card: MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
            choices: choices,
            budgetInBytes: budget,
            createInOneUptimeUrl: createInOneUptimeUrl,
          }),
          choices: choices,
          budgetInBytes: budget,
          createInOneUptimeUrl: null,
        });
      }

      const budgetZeroCard: JSONObject =
        MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: 0,
          createInOneUptimeUrl: createInOneUptimeUrl,
        });

      expect(getNotes(budgetZeroCard)).toHaveLength(3);
      expectCreateInOneUptimeLink(budgetZeroCard, null);
    },
  );

  test("a smaller budget shows no more of any list and makes a smaller card", () => {
    const choices: MicrosoftTeamsNewIncidentFormChoices =
      wholeHugeIncidentChoices();
    const trimmableIds: Array<string> = [
      "incidentMonitors",
      "onCallDutyPolicies",
      "labels",
    ];

    const cards: Array<JSONObject> =
      MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES.map((budget: number) => {
        return MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: budget,
          createInOneUptimeUrl: CREATE_INCIDENT_URL,
        });
      });

    for (let index: number = 1; index < cards.length; index++) {
      const larger: JSONObject = cards[index - 1]!;
      const smaller: JSONObject = cards[index]!;

      /*
       * A card refused as too large is followed by a smaller one, never by the
       * same card again.
       */
      expect(sizeOf(smaller)).toBeLessThan(sizeOf(larger));

      const largerCounts: Array<number> = shownCounts(larger, trimmableIds);
      const smallerCounts: Array<number> = shownCounts(smaller, trimmableIds);

      smallerCounts.forEach((count: number, listIndex: number) => {
        expect(count).toBeLessThanOrEqual(largerCounts[listIndex]!);
      });
    }
  });

  test("leaves the choices it was given alone, so every budget starts from the same lists", () => {
    const choices: MicrosoftTeamsNewIncidentFormChoices =
      wholeHugeIncidentChoices();
    const before: string = JSON.stringify(choices);

    const build: (budget: number) => JSONObject = (
      budget: number,
    ): JSONObject => {
      return MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices,
        budgetInBytes: budget,
        initialTitle: "Checkout is down",
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });
    };

    const first: JSONObject = build(FIRST_BUDGET);

    for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
      build(budget);
    }

    expect(JSON.stringify(choices)).toBe(before);
    expect(build(FIRST_BUDGET)).toEqual(first);
  });

  test("never shortens the severities, even when they are what makes the card big", () => {
    const severities: MicrosoftTeamsCardChoiceList = listOf(
      buildRows({
        table: 9,
        count: MICROSOFT_TEAMS_MAX_SEVERITY_CHOICES,
        nameOf: (index: number): string => {
          return `Severity ${padded(index)} ${"s".repeat(80)}`.substring(0, 80);
        },
      }),
    );

    for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
      const card: JSONObject =
        MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: { ...wholeHugeIncidentChoices(), severities: severities },
          budgetInBytes: budget,
        });

      expect(getChoices(card, "incidentSeverity")).toEqual(severities.choices);

      if (budget > 0) {
        expectWithinBudget(card, budget);
      }
    }
  });
});

describe("MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget, huge project (#4111)", () => {
  test.each(NON_ZERO_BUDGETS)(
    "fits %i bytes with the lists as the fetchers read them, and says what it left off",
    async (budget: number) => {
      serveHugeProject();

      const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
        await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
          PROJECT_ID,
          MEMBER_PROPS,
        );

      const card: JSONObject =
        MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: choices,
            budgetInBytes: budget,
            initialTitle: "Database upgrade",
            createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
            timezone: "America/New_York",
          },
        );

      expectHugeMaintenanceCard({
        card: card,
        choices: choices,
        budgetInBytes: budget,
        timezoneNote: knownTimezoneNote("America/New_York"),
        createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
      });
      expect(getSubmitData(card)).toEqual({
        action: "SubmitNewScheduledMaintenance",
        timezone: "America/New_York",
      });
      expect(getInputOrFail(card, "scheduledMaintenanceTitle")["value"]).toBe(
        "Database upgrade",
      );
    },
  );

  test.each(NON_ZERO_BUDGETS)(
    "fits %i bytes even when handed every monitor and label of the project",
    (budget: number) => {
      const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
        wholeHugeMaintenanceChoices();

      const card: JSONObject =
        MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: choices,
            budgetInBytes: budget,
            initialTitle: "t".repeat(MAINTENANCE_TITLE_MAX_LENGTH),
            createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
          },
        );

      expectHugeMaintenanceCard({
        card: card,
        choices: choices,
        budgetInBytes: budget,
        timezoneNote: GENERIC_TIMEZONE_NOTE,
        createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
      });
    },
  );

  test.each([null, undefined, ""])(
    "offers no Create in OneUptime link without a URL (%p), at any budget",
    async (createInOneUptimeUrl: string | null | undefined) => {
      serveHugeProject();

      const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
        await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
          PROJECT_ID,
          MEMBER_PROPS,
        );

      for (const budget of NON_ZERO_BUDGETS) {
        expectHugeMaintenanceCard({
          card: MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
            {
              choices: choices,
              budgetInBytes: budget,
              createInOneUptimeUrl: createInOneUptimeUrl,
            },
          ),
          choices: choices,
          budgetInBytes: budget,
          timezoneNote: GENERIC_TIMEZONE_NOTE,
          createInOneUptimeUrl: null,
        });
      }

      const budgetZeroCard: JSONObject =
        MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: choices,
            budgetInBytes: 0,
            createInOneUptimeUrl: createInOneUptimeUrl,
          },
        );

      // The time zone note, then one note per list left off.
      expect(getNotes(budgetZeroCard)).toHaveLength(3);
      expectCreateInOneUptimeLink(budgetZeroCard, null);
    },
  );

  test("a smaller budget shows no more of any list and makes a smaller card", () => {
    const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
      wholeHugeMaintenanceChoices();
    const trimmableIds: Array<string> = [
      "scheduledMaintenanceMonitors",
      "labels",
    ];

    const cards: Array<JSONObject> =
      MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES.map((budget: number) => {
        return MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: choices,
            budgetInBytes: budget,
            createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
          },
        );
      });

    for (let index: number = 1; index < cards.length; index++) {
      const larger: JSONObject = cards[index - 1]!;
      const smaller: JSONObject = cards[index]!;

      expect(sizeOf(smaller)).toBeLessThan(sizeOf(larger));

      const largerCounts: Array<number> = shownCounts(larger, trimmableIds);
      const smallerCounts: Array<number> = shownCounts(smaller, trimmableIds);

      smallerCounts.forEach((count: number, listIndex: number) => {
        expect(count).toBeLessThanOrEqual(largerCounts[listIndex]!);
      });
    }
  });

  test("leaves the choices it was given alone, so every budget starts from the same lists", () => {
    const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
      wholeHugeMaintenanceChoices();
    const before: string = JSON.stringify(choices);

    const build: (budget: number) => JSONObject = (
      budget: number,
    ): JSONObject => {
      return MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: choices,
          budgetInBytes: budget,
          createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
          timezone: "Asia/Kolkata",
        },
      );
    };

    const first: JSONObject = build(FIRST_BUDGET);

    for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
      build(budget);
    }

    expect(JSON.stringify(choices)).toBe(before);
    expect(build(FIRST_BUDGET)).toEqual(first);
  });
});

describe("a list the fetchers read only in part", () => {
  /*
   * 300 monitors with short names: the 250 the fetcher reads fit the first
   * budget whole, yet the card still does not offer every monitor, so it
   * says so and offers the dashboard.
   */
  const MANY_SHORT_MONITOR_ROWS: Array<NamedRow> = buildRows({
    table: 10,
    count: 300,
    nameOf: (index: number): string => {
      return `m${index}`;
    },
  });

  test("incident form: shows every monitor read and counts the project's", async () => {
    serveProject({
      monitors: MANY_SHORT_MONITOR_ROWS,
      labels: SMALL_LABEL_ROWS,
      onCallDutyPolicies: SMALL_POLICY_ROWS,
    });

    const choices: MicrosoftTeamsNewIncidentFormChoices =
      await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      );

    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices,
        budgetInBytes: FIRST_BUDGET,
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });

    expectWithinBudget(card, FIRST_BUDGET);
    expect(getChoices(card, "incidentMonitors")).toHaveLength(
      MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
    );
    expect(getNotes(card)).toEqual([
      showingNote({
        shown: MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
        total: 300,
        noun: "monitors",
        hint: INCIDENT_ADD_LATER_HINT,
      }),
    ]);
    expect(getOpenUrlActions(card)).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Create in OneUptime",
        url: CREATE_INCIDENT_URL,
      },
    ]);
  });

  test("maintenance form: shows every monitor read and counts the project's", async () => {
    serveProject({
      monitors: MANY_SHORT_MONITOR_ROWS,
      labels: SMALL_LABEL_ROWS,
      onCallDutyPolicies: SMALL_POLICY_ROWS,
    });

    const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
      await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
        PROJECT_ID,
        MEMBER_PROPS,
      );

    const card: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: choices,
          budgetInBytes: FIRST_BUDGET,
          createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
        },
      );

    expectWithinBudget(card, FIRST_BUDGET);
    expect(getChoices(card, "scheduledMaintenanceMonitors")).toHaveLength(
      MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
    );
    expect(getNotes(card)).toEqual([
      GENERIC_TIMEZONE_NOTE,
      showingNote({
        shown: MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
        total: 300,
        noun: "monitors",
        hint: MAINTENANCE_ADD_LATER_HINT,
      }),
    ]);
    expect(getOpenUrlActions(card)).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Create in OneUptime",
        url: CREATE_MAINTENANCE_URL,
      },
    ]);
  });
});

describe("budget 0: the form without its optional lists", () => {
  test("incident form keeps title, description and severity and names every list it left off", () => {
    const choices: MicrosoftTeamsNewIncidentFormChoices =
      wholeHugeIncidentChoices();

    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices,
        budgetInBytes: 0,
        initialTitle: "Checkout is down",
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });

    // Each list's note where the list would have been.
    expect(layoutOf(card)).toEqual([
      "heading: Create New Incident",
      "Input.Text incidentTitle",
      "Input.Text incidentDescription",
      "Input.ChoiceSet incidentSeverity",
      `note: ${tooManyNote({
        total: HUGE_MONITOR_COUNT,
        noun: "monitors",
        hint: INCIDENT_ADD_LATER_HINT,
      })}`,
      `note: ${tooManyNote({
        total: HUGE_POLICY_COUNT,
        noun: "on-call policies",
        hint: INCIDENT_ADD_LATER_HINT,
      })}`,
      `note: ${tooManyNote({
        total: HUGE_LABEL_COUNT,
        noun: "labels",
        hint: INCIDENT_ADD_LATER_HINT,
      })}`,
    ]);
    expect(getInputOrFail(card, "incidentTitle")["value"]).toBe(
      "Checkout is down",
    );
    expect(getChoices(card, "incidentSeverity")).toEqual(
      choices.severities.choices,
    );

    expect(getSubmitData(card)).toEqual({ action: "SubmitNewIncident" });
    expectCreateInOneUptimeLink(card, CREATE_INCIDENT_URL);

    // A handful of lines, whatever the size of the project.
    expect(sizeOf(card)).toBeLessThan(8 * 1024);
  });

  test("maintenance form keeps title, description, dates and time zone and names every list it left off", () => {
    const card: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: wholeHugeMaintenanceChoices(),
          budgetInBytes: 0,
          initialTitle: "Database upgrade",
          createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
          timezone: "Australia/Adelaide",
        },
      );

    expect(layoutOf(card)).toEqual([
      "heading: Create New Scheduled Maintenance",
      "Input.Text scheduledMaintenanceTitle",
      "Input.Text scheduledMaintenanceDescription",
      `note: ${knownTimezoneNote("Australia/Adelaide")}`,
      "Input.Date startDate",
      "Input.Time startTime",
      "Input.Date endDate",
      "Input.Time endTime",
      `note: ${tooManyNote({
        total: HUGE_MONITOR_COUNT,
        noun: "monitors",
        hint: MAINTENANCE_ADD_LATER_HINT,
      })}`,
      `note: ${tooManyNote({
        total: HUGE_LABEL_COUNT,
        noun: "labels",
        hint: MAINTENANCE_ADD_LATER_HINT,
      })}`,
    ]);
    expect(getInputOrFail(card, "scheduledMaintenanceTitle")["value"]).toBe(
      "Database upgrade",
    );

    expect(getSubmitData(card)).toEqual({
      action: "SubmitNewScheduledMaintenance",
      timezone: "Australia/Adelaide",
    });
    expectCreateInOneUptimeLink(card, CREATE_MAINTENANCE_URL);
    expect(sizeOf(card)).toBeLessThan(8 * 1024);
  });

  test("a list the project does not have gets no note", () => {
    const incidentCard: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: {
          ...wholeHugeIncidentChoices(),
          labels: emptyList(),
          onCallDutyPolicies: emptyList(),
        },
        budgetInBytes: 0,
      });

    expect(getNotes(incidentCard)).toEqual([
      tooManyNote({
        total: HUGE_MONITOR_COUNT,
        noun: "monitors",
        hint: INCIDENT_ADD_LATER_HINT,
      }),
    ]);

    const maintenanceCard: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: {
            ...wholeHugeMaintenanceChoices(),
            monitors: emptyList(),
          },
          budgetInBytes: 0,
        },
      );

    expect(getNotes(maintenanceCard)).toEqual([
      GENERIC_TIMEZONE_NOTE,
      tooManyNote({
        total: HUGE_LABEL_COUNT,
        noun: "labels",
        hint: MAINTENANCE_ADD_LATER_HINT,
      }),
    ]);
  });

  /*
   * Budget 0 is the last try, after Teams refused the card twice. The lists
   * are left off up front, so each form is built, and measured, once: the
   * card with every choice, the biggest of all, is never built, and no list
   * is shortened step by step to nothing first.
   */
  test("each form is built and measured once, however many choices the project has", () => {
    const sizeSpy: SpyInstance<
      typeof MicrosoftTeamsMessageSize.getSizeInBytes
    > = jest.spyOn(MicrosoftTeamsMessageSize, "getSizeInBytes");

    const incidentCard: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: wholeHugeIncidentChoices(),
        budgetInBytes: 0,
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });
    const maintenanceCard: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: wholeHugeMaintenanceChoices(),
          budgetInBytes: 0,
          createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
          timezone: "Europe/Berlin",
        },
      );

    const measured: Array<string | JSONObject> = sizeSpy.mock.calls.map(
      (call: [value: string | JSONObject]): string | JSONObject => {
        return call[0];
      },
    );

    expect(measured).toHaveLength(2);
    expect(measured[0]).toBe(incidentCard);
    expect(measured[1]).toBe(maintenanceCard);
  });
});

describe("the monitor status list goes with the monitor list", () => {
  test("is left off with the monitors at budget 0", () => {
    const incidentCard: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: smallIncidentChoices(),
        budgetInBytes: 0,
      });

    expect(getInput(incidentCard, "incidentMonitors")).toBeUndefined();
    expect(getInput(incidentCard, "monitorStatus")).toBeUndefined();

    const maintenanceCard: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: smallMaintenanceChoices(),
          budgetInBytes: 0,
        },
      );

    expect(
      getInput(maintenanceCard, "scheduledMaintenanceMonitors"),
    ).toBeUndefined();
    expect(getInput(maintenanceCard, "monitorStatus")).toBeUndefined();
  });

  test("is not offered to a project without monitors", () => {
    const incidentCard: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: { ...smallIncidentChoices(), monitors: emptyList() },
        budgetInBytes: FIRST_BUDGET,
      });

    expect(getInput(incidentCard, "monitorStatus")).toBeUndefined();
    // Nothing was left off, so nothing is said about it.
    expect(getNotes(incidentCard)).toEqual([]);

    const maintenanceCard: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: { ...smallMaintenanceChoices(), monitors: emptyList() },
          budgetInBytes: FIRST_BUDGET,
        },
      );

    expect(getInput(maintenanceCard, "monitorStatus")).toBeUndefined();
    expect(getNotes(maintenanceCard)).toEqual([GENERIC_TIMEZONE_NOTE]);
  });

  test("is not an empty dropdown when the project has no monitor statuses", () => {
    const incidentCard: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: { ...smallIncidentChoices(), monitorStatuses: emptyList() },
        budgetInBytes: FIRST_BUDGET,
      });

    expect(getChoices(incidentCard, "incidentMonitors")).toHaveLength(3);
    expect(getInput(incidentCard, "monitorStatus")).toBeUndefined();

    const maintenanceCard: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: {
            ...smallMaintenanceChoices(),
            monitorStatuses: emptyList(),
          },
          budgetInBytes: FIRST_BUDGET,
        },
      );

    expect(
      getChoices(maintenanceCard, "scheduledMaintenanceMonitors"),
    ).toHaveLength(3);
    expect(getInput(maintenanceCard, "monitorStatus")).toBeUndefined();
  });

  /*
   * Only the monitor, label and on-call policy lists are shortened to fit,
   * and only they get a note saying so. With as many long status names as
   * the fetcher reads, the statuses are the longest list on the card once
   * the others are shortened: a status list shortened with them would drop
   * statuses without a word.
   */
  const LONG_STATUSES: MicrosoftTeamsCardChoiceList = listOf(
    buildRows({
      table: 14,
      count: MICROSOFT_TEAMS_MAX_MONITOR_STATUS_CHOICES,
      nameOf: (index: number): string => {
        return `Status ${padded(index)} ${"s".repeat(80)}`.substring(0, 80);
      },
    }),
  );

  test("is never shortened on the incident form, even when it is what makes the card big", () => {
    const choices: MicrosoftTeamsNewIncidentFormChoices = {
      ...wholeHugeIncidentChoices(),
      monitorStatuses: LONG_STATUSES,
    };

    for (const budget of NON_ZERO_BUDGETS) {
      const card: JSONObject =
        MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: budget,
        });

      expectWithinBudget(card, budget);

      // Monitors are offered at the first budget at least.
      if (budget === FIRST_BUDGET) {
        expect(getChoices(card, "incidentMonitors").length).toBeGreaterThan(0);
      }

      if (getChoices(card, "incidentMonitors").length > 0) {
        expect(getChoices(card, "monitorStatus")).toEqual(
          LONG_STATUSES.choices,
        );
      } else {
        expect(getInput(card, "monitorStatus")).toBeUndefined();
      }

      // A note for each shortened list, none of them about statuses.
      expect(getNotes(card)).toHaveLength(3);
    }
  });

  test("is never shortened on the maintenance form, even when it is what makes the card big", () => {
    const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices = {
      ...wholeHugeMaintenanceChoices(),
      monitorStatuses: LONG_STATUSES,
    };

    for (const budget of NON_ZERO_BUDGETS) {
      const card: JSONObject =
        MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: choices,
            budgetInBytes: budget,
          },
        );

      expectWithinBudget(card, budget);

      if (budget === FIRST_BUDGET) {
        expect(
          getChoices(card, "scheduledMaintenanceMonitors").length,
        ).toBeGreaterThan(0);
      }

      if (getChoices(card, "scheduledMaintenanceMonitors").length > 0) {
        expect(getChoices(card, "monitorStatus")).toEqual(
          LONG_STATUSES.choices,
        );
      } else {
        expect(getInput(card, "monitorStatus")).toBeUndefined();
      }

      // The time zone note, then one note per shortened list.
      expect(getNotes(card)).toHaveLength(3);
    }
  });
});

describe("a project with none of a list", () => {
  /*
   * A dropdown with no choices is no use, and a required one (the severity)
   * could never be submitted. The command answers a project without
   * severities itself, before any card is built.
   */
  test("gets no empty dropdown, no note and no link, on either form", () => {
    const incidentCard: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: {
          severities: emptyList(),
          monitors: emptyList(),
          monitorStatuses: emptyList(),
          labels: emptyList(),
          onCallDutyPolicies: emptyList(),
        },
        budgetInBytes: FIRST_BUDGET,
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });

    expect(describeInputs(incidentCard)).toEqual([
      "Input.Text incidentTitle",
      "Input.Text incidentDescription",
    ]);
    expect(getNotes(incidentCard)).toEqual([]);
    expect(getActionTypes(incidentCard)).toEqual(["Action.Submit"]);

    const maintenanceCard: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices: {
            monitors: emptyList(),
            monitorStatuses: emptyList(),
            labels: emptyList(),
          },
          budgetInBytes: FIRST_BUDGET,
          createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
        },
      );

    expect(describeInputs(maintenanceCard)).toEqual([
      "Input.Text scheduledMaintenanceTitle",
      "Input.Text scheduledMaintenanceDescription",
      "Input.Date startDate",
      "Input.Time startTime",
      "Input.Date endDate",
      "Input.Time endTime",
    ]);
    expect(getNotes(maintenanceCard)).toEqual([GENERIC_TIMEZONE_NOTE]);
    expect(getActionTypes(maintenanceCard)).toEqual(["Action.Submit"]);
  });
});

describe("every card the bot can send is a form Teams can show", () => {
  /*
   * Whatever the project and whichever budget the card was fitted to: every
   * input is labelled (Teams shows a required input's error under its label)
   * and has an id no other input has (the submitted values are keyed by id),
   * the required inputs stay required, every dropdown is the compact kind
   * the form always used and has choices to pick from, the small print
   * wraps instead of being cut at the end of its first line, the submit is
   * the same, and the link to the dashboard follows it when, and only when,
   * a note says a list was left off and there is a URL to offer.
   */
  function expectUsableForm(data: {
    card: JSONObject;
    requiredIds: Array<string>;
    submitAction: string;
    // The URL the card was given for "Create in OneUptime", or null.
    createInOneUptimeUrl: string | null;
  }): void {
    const { card } = data;

    expect(card).toMatchObject({
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
    });

    const inputs: Array<JSONObject> = bodyOf(card).filter(
      (element: JSONObject) => {
        return typeof element["id"] === "string";
      },
    );
    const ids: Array<string> = inputs.map((input: JSONObject) => {
      return input["id"] as string;
    });

    expect(new Set(ids).size).toBe(ids.length);

    for (const input of inputs) {
      expect(String(input["type"]).startsWith("Input.")).toBe(true);
      expect(String(input["label"] || "").trim()).not.toBe("");

      if (input["type"] === "Input.ChoiceSet") {
        const choices: Array<MicrosoftTeamsCardChoice> = input[
          "choices"
        ] as Array<MicrosoftTeamsCardChoice>;

        expect(input["style"]).toBe("compact");
        expect(choices.length).toBeGreaterThan(0);

        for (const choice of choices) {
          expect(choice.title.trim()).not.toBe("");
          expect(choice.value.trim()).not.toBe("");
        }
      }
    }

    for (const requiredId of data.requiredIds) {
      expect(getInputOrFail(card, requiredId)["isRequired"]).toBe(true);
    }

    for (const element of bodyOf(card)) {
      if (element["type"] === "TextBlock" && element["isSubtle"] === true) {
        expect(element["wrap"]).toBe(true);
      }
    }

    expect(getSubmitData(card)["action"]).toBe(data.submitAction);

    const isAnythingLeftOff: boolean = getNotes(card).some((note: string) => {
      return (
        note.startsWith("Showing the first ") ||
        note.startsWith("This project has ")
      );
    });

    expectCreateInOneUptimeLink(
      card,
      isAnythingLeftOff ? data.createInOneUptimeUrl : null,
    );
  }

  test("the incident form", () => {
    const projects: Array<MicrosoftTeamsNewIncidentFormChoices> = [
      smallIncidentChoices(),
      wholeHugeIncidentChoices(),
      {
        severities: listOf(SEVERITY_ROWS),
        monitors: emptyList(),
        monitorStatuses: listOf(MONITOR_STATUS_ROWS),
        labels: emptyList(),
        onCallDutyPolicies: emptyList(),
      },
    ];

    for (const choices of projects) {
      for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
        for (const createInOneUptimeUrl of [CREATE_INCIDENT_URL, null]) {
          expectUsableForm({
            card: MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
              choices: choices,
              budgetInBytes: budget,
              initialTitle: "Checkout is down",
              createInOneUptimeUrl: createInOneUptimeUrl,
            }),
            requiredIds: [
              "incidentTitle",
              "incidentDescription",
              "incidentSeverity",
            ],
            submitAction: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
            createInOneUptimeUrl: createInOneUptimeUrl,
          });
        }
      }
    }
  });

  test("the maintenance form", () => {
    const projects: Array<MicrosoftTeamsNewScheduledMaintenanceFormChoices> = [
      smallMaintenanceChoices(),
      wholeHugeMaintenanceChoices(),
      {
        monitors: emptyList(),
        monitorStatuses: listOf(MONITOR_STATUS_ROWS),
        labels: emptyList(),
      },
    ];

    for (const choices of projects) {
      for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
        for (const createInOneUptimeUrl of [CREATE_MAINTENANCE_URL, null]) {
          expectUsableForm({
            card: MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
              {
                choices: choices,
                budgetInBytes: budget,
                initialTitle: "Database upgrade",
                createInOneUptimeUrl: createInOneUptimeUrl,
                timezone: "Europe/Berlin",
              },
            ),
            requiredIds: [
              "scheduledMaintenanceTitle",
              "scheduledMaintenanceDescription",
              "startDate",
              "startTime",
              "endDate",
              "endTime",
            ],
            submitAction:
              MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
            createInOneUptimeUrl: createInOneUptimeUrl,
          });
        }
      }
    }
  });
});

describe("the notes and the dashboard button are the ones MicrosoftTeamsCardChoices builds", () => {
  /*
   * Both forms build their small print and their "Create in OneUptime"
   * button with the shared MicrosoftTeamsCardChoices helpers (each form used
   * to have a copy of the note element), so the two forms look the same. The
   * note under each list is the one buildNotShownNoteElement makes for that
   * list as the card shows it.
   */
  type NotedList = {
    inputId: string;
    list: MicrosoftTeamsCardChoiceList;
    noun: string;
  };

  function expectSharedElements(data: {
    card: JSONObject;
    // Small print that is not about a list, in card order, above the lists.
    otherNotes: Array<string>;
    // The lists that get a note, in card order.
    lists: Array<NotedList>;
    hint: string;
    createInOneUptimeUrl: string;
  }): void {
    const listNotes: Array<JSONObject> = [];

    for (const noted of data.lists) {
      const note: JSONObject | null =
        MicrosoftTeamsCardChoices.buildNotShownNoteElement({
          list: {
            choices: getChoices(data.card, noted.inputId),
            totalCount: noted.list.totalCount,
          },
          pluralNoun: noted.noun,
          addLaterHint: data.hint,
        });

      // Every list of this project is shortened or left off, so has a note.
      expect(note).not.toBeNull();
      listNotes.push(note!);
    }

    const smallPrint: Array<JSONObject> = bodyOf(data.card).filter(
      (element: JSONObject) => {
        return element["type"] === "TextBlock" && element["isSubtle"] === true;
      },
    );

    expect(smallPrint).toStrictEqual([
      ...data.otherNotes.map((text: string): JSONObject => {
        return MicrosoftTeamsCardChoices.buildNoteElement(text);
      }),
      ...listNotes,
    ]);
    expect(getOpenUrlActions(data.card)).toStrictEqual([
      MicrosoftTeamsCardChoices.buildCreateInOneUptimeAction(
        data.createInOneUptimeUrl,
      ),
    ]);
  }

  test("the incident form, at every budget", () => {
    const choices: MicrosoftTeamsNewIncidentFormChoices =
      wholeHugeIncidentChoices();

    for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
      expectSharedElements({
        card: MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices,
          budgetInBytes: budget,
          createInOneUptimeUrl: CREATE_INCIDENT_URL,
        }),
        otherNotes: [],
        lists: [
          {
            inputId: "incidentMonitors",
            list: choices.monitors,
            noun: "monitors",
          },
          {
            inputId: "onCallDutyPolicies",
            list: choices.onCallDutyPolicies,
            noun: "on-call policies",
          },
          { inputId: "labels", list: choices.labels, noun: "labels" },
        ],
        hint: INCIDENT_ADD_LATER_HINT,
        createInOneUptimeUrl: CREATE_INCIDENT_URL,
      });
    }
  });

  test("the maintenance form, time zone note included, at every budget", () => {
    const choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices =
      wholeHugeMaintenanceChoices();

    for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
      for (const timezone of ["Asia/Kolkata", undefined]) {
        expectSharedElements({
          card: MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
            {
              choices: choices,
              budgetInBytes: budget,
              createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
              timezone: timezone,
            },
          ),
          otherNotes: [
            timezone ? knownTimezoneNote(timezone) : GENERIC_TIMEZONE_NOTE,
          ],
          lists: [
            {
              inputId: "scheduledMaintenanceMonitors",
              list: choices.monitors,
              noun: "monitors",
            },
            { inputId: "labels", list: choices.labels, noun: "labels" },
          ],
          hint: MAINTENANCE_ADD_LATER_HINT,
          createInOneUptimeUrl: CREATE_MAINTENANCE_URL,
        });
      }
    }
  });
});

describe("the title typed after the command", () => {
  type TitleForm = {
    name: string;
    titleInputId: string;
    maxLength: number;
    build: (initialTitle: string | undefined, budget: number) => JSONObject;
  };

  const TITLE_FORMS: Array<TitleForm> = [
    {
      name: "incident",
      titleInputId: "incidentTitle",
      maxLength: INCIDENT_TITLE_MAX_LENGTH,
      build: (initialTitle: string | undefined, budget: number): JSONObject => {
        return MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: smallIncidentChoices(),
          budgetInBytes: budget,
          initialTitle: initialTitle,
        });
      },
    },
    {
      name: "maintenance",
      titleInputId: "scheduledMaintenanceTitle",
      maxLength: MAINTENANCE_TITLE_MAX_LENGTH,
      build: (initialTitle: string | undefined, budget: number): JSONObject => {
        return MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
          {
            choices: smallMaintenanceChoices(),
            budgetInBytes: budget,
            initialTitle: initialTitle,
          },
        );
      },
    },
  ];

  function titleInput(
    form: TitleForm,
    initialTitle: string | undefined,
    budget?: number,
  ): JSONObject {
    return getInputOrFail(
      form.build(initialTitle, budget ?? FIRST_BUDGET),
      form.titleInputId,
    );
  }

  test.each(TITLE_FORMS)(
    "$name: is prefilled, trimmed, at every budget",
    (form: TitleForm) => {
      for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
        expect(
          titleInput(form, "   Checkout is down \n", budget)["value"],
        ).toBe("Checkout is down");
      }
    },
  );

  test.each(TITLE_FORMS)(
    "$name: is cut to what the title column holds, keeping its start",
    (form: TitleForm) => {
      const longTitle: string =
        "a".repeat(form.maxLength) + "b".repeat(form.maxLength);

      expect(titleInput(form, `  ${longTitle}  `)["value"]).toBe(
        "a".repeat(form.maxLength),
      );
      expect(titleInput(form, "a".repeat(form.maxLength))["value"]).toBe(
        "a".repeat(form.maxLength),
      );
    },
  );

  test.each(TITLE_FORMS)(
    "$name: leaves the title empty when nothing was typed after the command",
    (form: TitleForm) => {
      for (const initialTitle of [undefined, "", "   ", "\n\t"]) {
        expect(titleInput(form, initialTitle)).not.toHaveProperty("value");
      }
    },
  );

  test.each(TITLE_FORMS)(
    "$name: the title input is required and limited to what the column holds",
    (form: TitleForm) => {
      for (const initialTitle of [undefined, "Checkout is down"]) {
        expect(titleInput(form, initialTitle)).toMatchObject({
          type: "Input.Text",
          isRequired: true,
          maxLength: form.maxLength,
        });
      }
    },
  );

  /*
   * An emoji is two UTF-16 code units. A cut between them leaves half of it,
   * a lone surrogate: the card carries "\ud83d", Teams shows a broken
   * character at the end of the prefilled title, and a title submitted as it
   * is keeps it as U+FFFD (a lone surrogate cannot be encoded as UTF-8).
   * Both forms cut the title with truncateToLength
   * (Server/Utils/Database/TruncateColumnValue.ts), which drops such a half,
   * as MicrosoftTeamsMessageSize.fitTextToBudget does for replies.
   */
  test.each(TITLE_FORMS)(
    "$name: is not cut through an emoji",
    (form: TitleForm) => {
      const title: string = `${"x".repeat(form.maxLength - 1)}🔧 maintenance window`;

      const value: string = titleInput(form, title)["value"] as string;

      expect(hasHalfAnEmoji(value)).toBe(false);
      expect(value.length).toBeLessThanOrEqual(form.maxLength);
      // The longest start of the title, in whole characters, that fits.
      expect(value).toBe("x".repeat(form.maxLength - 1));
    },
  );

  test.each(TITLE_FORMS)(
    "$name: keeps a whole emoji that ends right at the cut",
    (form: TitleForm) => {
      // The emoji is the last two code units the title column holds.
      const title: string = `${"x".repeat(form.maxLength - 2)}🔧 maintenance window`;

      const value: string = titleInput(form, title)["value"] as string;

      // Only what is past the column goes: the emoji stays.
      expect(value).toBe(`${"x".repeat(form.maxLength - 2)}🔧`);
      expect(value).toHaveLength(form.maxLength);
    },
  );
});

describe("the maintenance form's time zone", () => {
  /*
   * The submit of someone who is somewhere else: Teams names their own zone
   * on the activity (localTimezone and the clientInfo entity), and their
   * local timestamp carries their own UTC offset.
   */
  const SUBMITTED_FROM_AUCKLAND: JSONObject = {
    localTimezone: "Pacific/Auckland",
    entities: [{ type: "clientInfo", timezone: "Pacific/Auckland" }],
    rawLocalTimestamp: "2026-09-29T21:00:00.000+13:00",
  };

  function buildWithTimezone(
    timezone: string | undefined,
    budget?: number,
  ): JSONObject {
    return MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
      {
        choices: smallMaintenanceChoices(),
        budgetInBytes: budget ?? FIRST_BUDGET,
        timezone: timezone,
      },
    );
  }

  // The zone the submit handler reads a submit of this card in.
  function resolveSubmit(
    card: JSONObject,
    activity: JSONObject,
  ): MicrosoftTeamsUserTimezone {
    return MicrosoftTeamsTimezone.resolve({
      activity: activity,
      timezoneFromCard: getSubmitData(card)["timezone"],
    });
  }

  test.each([
    "America/New_York",
    "Asia/Kolkata",
    "Europe/Berlin",
    "Australia/Adelaide",
    "UTC",
  ])(
    "%s is named on the card and carried to the submit, at every budget",
    (timezone: string) => {
      for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
        const card: JSONObject = buildWithTimezone(timezone, budget);

        expect(getNotes(card)[0]).toBe(knownTimezoneNote(timezone));
        expect(getSubmitData(card)).toEqual({
          action: "SubmitNewScheduledMaintenance",
          timezone: timezone,
        });

        /*
         * What the card carries is what the submit handler reads the start
         * and end in, whether the submitting activity names no zone or
         * another one: the card told whoever filled it in that the times are
         * in this zone, and in a channel that may be someone elsewhere.
         */
        for (const activity of [{}, SUBMITTED_FROM_AUCKLAND]) {
          expect(resolveSubmit(card, activity)).toEqual({
            timezone: timezone,
            label: timezone,
          });
        }
      }
    },
  );

  test("a zone with stray spaces is carried trimmed", () => {
    const card: JSONObject = buildWithTimezone("  Europe/Berlin \n");

    expect(getNotes(card)[0]).toBe(knownTimezoneNote("Europe/Berlin"));
    expect(getSubmitData(card)["timezone"]).toBe("Europe/Berlin");
  });

  test.each([
    "Mars/Olympus_Mons",
    "America/Atlantis",
    "not a time zone",
    "GMT+25",
  ])(
    "an unknown zone (%p) gets the generic note, and is neither named nor carried",
    (timezone: string) => {
      for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
        const card: JSONObject = buildWithTimezone(timezone, budget);

        expect(getNotes(card)[0]).toBe(GENERIC_TIMEZONE_NOTE);
        expect(getSubmitData(card)).toEqual({
          action: "SubmitNewScheduledMaintenance",
        });
        expect(JSON.stringify(card)).not.toContain(timezone);

        // As the note says: read in the zone Teams reports for the submitter.
        expect(resolveSubmit(card, SUBMITTED_FROM_AUCKLAND)).toEqual({
          timezone: "Pacific/Auckland",
          label: "Pacific/Auckland",
        });
      }
    },
  );

  test.each([undefined, "", "   "])(
    "no zone (%p) gets the generic note and carries none",
    (timezone: string | undefined) => {
      for (const budget of MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES) {
        const card: JSONObject = buildWithTimezone(timezone, budget);

        expect(getNotes(card)[0]).toBe(GENERIC_TIMEZONE_NOTE);
        expect(getSubmitData(card)).toEqual({
          action: "SubmitNewScheduledMaintenance",
        });

        /*
         * As the note says: read in the zone Teams reports for the
         * submitter, or in UTC when it reports none.
         */
        expect(resolveSubmit(card, SUBMITTED_FROM_AUCKLAND)).toEqual({
          timezone: "Pacific/Auckland",
          label: "Pacific/Auckland",
        });
        expect(resolveSubmit(card, {})).toEqual(MicrosoftTeamsTimezone.UTC);
      }
    },
  );
});

describe("a list entry whose name is cut where an emoji sits", () => {
  /*
   * A name longer than a dropdown row is cut to
   * MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH code units, the last of them "…"
   * (MicrosoftTeamsCardChoices.toChoices, as the fetchers read the lists).
   * Cut between the two halves of an emoji, the row showed a broken character
   * before the "…" (the card carried "\ud83c…"); the cut now keeps whole
   * characters. Pinned here as the user sees it, on both forms.
   */
  function expectCutWholeCharacters(
    card: JSONObject,
    inputIds: Array<string>,
  ): void {
    for (const inputId of inputIds) {
      const titles: Array<string> = getChoices(card, inputId).map(
        (choice: MicrosoftTeamsCardChoice) => {
          return choice.title;
        },
      );

      expect(titles).toHaveLength(3);

      for (const title of titles) {
        // Still cut short, and still the start of the name.
        expect(title.endsWith("…")).toBe(true);
        expect(
          title.startsWith(
            "x".repeat(MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH - 2),
          ),
        ).toBe(true);
      }
    }

    expect(getTextsWithHalfAnEmoji(card)).toEqual([]);
  }

  test("incident form: no half of an emoji in any dropdown", async () => {
    serveProject({
      monitors: buildRows({ table: 11, count: 3, nameOf: emojiAtTheCutName }),
      labels: buildRows({ table: 12, count: 3, nameOf: emojiAtTheCutName }),
      onCallDutyPolicies: buildRows({
        table: 13,
        count: 3,
        nameOf: emojiAtTheCutName,
      }),
    });

    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
          PROJECT_ID,
          MEMBER_PROPS,
        ),
        budgetInBytes: FIRST_BUDGET,
      });

    expectCutWholeCharacters(card, [
      "incidentMonitors",
      "onCallDutyPolicies",
      "labels",
    ]);
  });

  test("maintenance form: no half of an emoji in any dropdown", async () => {
    serveProject({
      monitors: buildRows({ table: 11, count: 3, nameOf: emojiAtTheCutName }),
      labels: buildRows({ table: 12, count: 3, nameOf: emojiAtTheCutName }),
      onCallDutyPolicies: SMALL_POLICY_ROWS,
    });

    const card: JSONObject =
      MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
        {
          choices:
            await MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices(
              PROJECT_ID,
              MEMBER_PROPS,
            ),
          budgetInBytes: FIRST_BUDGET,
        },
      );

    expectCutWholeCharacters(card, ["scheduledMaintenanceMonitors", "labels"]);
  });
});
