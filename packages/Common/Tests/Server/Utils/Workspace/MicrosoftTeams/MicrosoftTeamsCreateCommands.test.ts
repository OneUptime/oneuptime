/** @timezone Asia/Tokyo */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import logger, { LogAttributes } from "../../../../../Server/Utils/Logger";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions, {
  MicrosoftTeamsNewScheduledMaintenanceFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import MicrosoftTeamsCardChoices, {
  MicrosoftTeamsCardChoice,
  MicrosoftTeamsCardChoiceList,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import MicrosoftTeamsCreateCommands, {
  CreateFormText,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../../../Types/Exception/DatabaseNotConnectedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";

/*
 * "create incident" and "create maintenance" typed to the Microsoft Teams bot,
 * through MicrosoftTeamsCreateCommands (issue #4111).
 *
 * A customer on 14.0.8 typed either command and got "Sorry, I encountered an
 * error processing your request. Please try again later." - twice. The forms
 * listed every monitor, label and on-call policy of the project, so Teams
 * refused them with 413 MessageSizeTooBig; the handler replied, rethrew, the
 * adapter answered Teams with HTTP 500, and Teams delivered the message again.
 * Each command now answers a message with exactly ONE reply: the form, or the
 * reason it cannot be shown and what to do instead.
 *
 * The TurnContext here is a fake whose sendActivity records every call and can
 * refuse it the way the Bot Connector does, with a RestError that carries the
 * HTTP status and Teams' error code. Pinned:
 *
 * - The form is filled in as whoever asked for it, in a personal chat, a
 *   channel or a group chat alike: the sender is checked before any list is
 *   read - no AAD object id, no connected account (with the settings link),
 *   not a project member, no permission to create the thing (to declare an
 *   incident, to create a maintenance event; also with the real permission
 *   model deciding) - and a check that itself fails gets a reply of its own.
 *   The lists are then read as the sender, with their own props, so the form
 *   offers only what they may read. In a channel anyone there may submit the
 *   form, and the submit is checked as whoever does.
 * - Lists that cannot be read, and an incident form with no severity to pick,
 *   get a reply instead of a form; the second links the page where incident
 *   severities are added.
 * - The form is exactly the card the production builder makes from the
 *   project's lists, the typed title (cut to fit, never through an emoji),
 *   the dashboard link and the requester's time zone for that budget, so no
 *   list or value can go missing on the way.
 * - A form Teams refuses as too large goes out again smaller, down to no lists
 *   at all; a card no different from the one refused is not sent twice; any
 *   other refusal is answered at once, naming Teams' status and code.
 * - Nothing escapes the handler, not even when Teams refuses the reply too.
 *   A failure is logged call for call, with the project it happened in: a
 *   line that says what failed and why (a OneUptime exception named by its
 *   class), then the error itself for its stack - except a Teams refusal,
 *   whose HTTP status and code the line already names.
 * - The maintenance form names and carries the time zone Teams reports for
 *   whoever asked for it - in a channel, the zone everyone who fills it in is
 *   told to type the times in - and never the server's (this file runs the
 *   server in Asia/Tokyo).
 * - getFormNotAcceptedMessage, branch by branch.
 *
 * Every test counts the sendActivity calls, and the ones that reached the
 * user: one per command, or none when Teams refused that reply as well. A
 * create command never removes a message, so every count also expects no
 * deleteActivity call.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b9f6c1e-4d3a-4e8b-9c7d-1a2b3c4d5e6f",
);
const USER_ID: ObjectID = new ObjectID("7d4e2a91-3c5b-4f6a-8e9d-0b1c2d3e4f5a");

// The sender's Microsoft Entra (AAD) object id, which Teams puts on "from".
const AAD_OBJECT_ID: string = "f3a9c2d1-6b4e-4a7f-9c8d-2e1f0a9b8c7d";

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";

function dashboardLink(route: string): string {
  return `${DASHBOARD_URL}/${PROJECT_ID.toString()}${route}`;
}

const TEAMS_SETTINGS_LINK: string = dashboardLink(
  "/user-settings/microsoft-teams-integration",
);
const CREATE_INCIDENT_LINK: string = dashboardLink("/incidents/create");
const CREATE_MAINTENANCE_LINK: string = dashboardLink(
  "/scheduled-maintenance-events/create",
);
// Where incident severities are added: Incidents → Settings → Incident Severity.
const SEVERITY_SETTINGS_LINK: string = dashboardLink(
  "/incidents/settings/severity",
);
// The member's own permissions, as getProjectMemberProps resolves them.
const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const FIRST_BUDGET: number = MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!;
const SECOND_BUDGET: number = MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[1]!;
const LAST_BUDGET: number = MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[2]!;

const NO_SEVERITIES_OPENING: string =
  "An incident needs a severity, and this project has no incident severities yet.";

type CommandKind = "incident" | "maintenance";

type CreateCommandRequest = Parameters<
  typeof MicrosoftTeamsCreateCommands.handleCreateIncidentCommand
>[0];

interface CommandProfile {
  kind: CommandKind;
  // What the user types to the bot.
  command: string;
  // The wording MicrosoftTeamsCreateCommands keeps for this form.
  form: CreateFormText;
  createLink: string;
  titleInputId: string;
  // The longest title the form takes; a longer typed title is cut to it.
  titleMaxLength: number;
  monitorsInputId: string;
  // Every list the form offers a project that has some of each, in card order.
  choiceSetIds: ReadonlyArray<string>;
  submitAction: string;
  // A title typed after the command, as MicrosoftTeams.ts hands it over.
  typedTitle: string;
  // Every reply the command gives instead of the form, word for word.
  replies: {
    senderUnknown: string;
    accountNotLinked: string;
    accountNotLinkedWithoutLink: string;
    senderCheckFailed: string;
    listsUnreadable: string;
    listsUnreadableWithoutLink: string;
    tooLarge: string;
    tooLargeWithoutLink: string;
    notInRoster: string;
  };
}

const INCIDENT: CommandProfile = {
  kind: "incident",
  command: "create incident",
  form: {
    what: "an incident",
    dashboardRoute: "/incidents/create",
    purpose: "create incidents from Microsoft Teams",
    lists: "monitors, labels and on-call policies",
  },
  createLink: CREATE_INCIDENT_LINK,
  titleInputId: "incidentTitle",
  titleMaxLength: ColumnLength.LongText,
  monitorsInputId: "incidentMonitors",
  choiceSetIds: [
    "incidentSeverity",
    "incidentMonitors",
    "monitorStatus",
    "onCallDutyPolicies",
    "labels",
  ],
  submitAction: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
  typedTitle: "Checkout API returns 502 for EU customers",
  replies: {
    senderUnknown:
      "Sorry, I couldn't tell who sent this message, so I can't open the form to create an incident. Please try again.",
    accountNotLinked: `To create incidents from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in [OneUptime → User Settings → Microsoft Teams](${TEAMS_SETTINGS_LINK}), then try again.`,
    accountNotLinkedWithoutLink:
      "To create incidents from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in OneUptime under User Settings → Microsoft Teams, then try again.",
    senderCheckFailed:
      "Sorry, I couldn't open the form to create an incident because OneUptime could not check your account just now. Please try again in a minute.",
    listsUnreadable: `Sorry, I couldn't open the form to create an incident because OneUptime could not load the lists it needs just now. Please try again in a minute, or create it in OneUptime instead: ${CREATE_INCIDENT_LINK}`,
    listsUnreadableWithoutLink:
      "Sorry, I couldn't open the form to create an incident because OneUptime could not load the lists it needs just now. Please try again in a minute, or create it in OneUptime instead.",
    tooLarge: `Sorry, I couldn't open the form to create an incident: Microsoft Teams refused it as too large, even without the lists of monitors, labels and on-call policies. You can create it in OneUptime instead: ${CREATE_INCIDENT_LINK}`,
    tooLargeWithoutLink:
      "Sorry, I couldn't open the form to create an incident: Microsoft Teams refused it as too large, even without the lists of monitors, labels and on-call policies. You can create it in OneUptime instead.",
    notInRoster: `Sorry, I couldn't open the form to create an incident: Microsoft Teams did not accept it (403 BotNotInConversationRoster). You can create it in OneUptime instead: ${CREATE_INCIDENT_LINK}`,
  },
};

const MAINTENANCE: CommandProfile = {
  kind: "maintenance",
  command: "create maintenance",
  form: {
    what: "a scheduled maintenance event",
    dashboardRoute: "/scheduled-maintenance-events/create",
    purpose: "schedule maintenance from Microsoft Teams",
    lists: "monitors and labels",
  },
  createLink: CREATE_MAINTENANCE_LINK,
  titleInputId: "scheduledMaintenanceTitle",
  titleMaxLength: ColumnLength.ShortText,
  monitorsInputId: "scheduledMaintenanceMonitors",
  choiceSetIds: ["scheduledMaintenanceMonitors", "monitorStatus", "labels"],
  submitAction:
    MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
  typedTitle: "Postgres 16 upgrade",
  replies: {
    senderUnknown:
      "Sorry, I couldn't tell who sent this message, so I can't open the form to create a scheduled maintenance event. Please try again.",
    accountNotLinked: `To schedule maintenance from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in [OneUptime → User Settings → Microsoft Teams](${TEAMS_SETTINGS_LINK}), then try again.`,
    accountNotLinkedWithoutLink:
      "To schedule maintenance from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in OneUptime under User Settings → Microsoft Teams, then try again.",
    senderCheckFailed:
      "Sorry, I couldn't open the form to create a scheduled maintenance event because OneUptime could not check your account just now. Please try again in a minute.",
    listsUnreadable: `Sorry, I couldn't open the form to create a scheduled maintenance event because OneUptime could not load the lists it needs just now. Please try again in a minute, or create it in OneUptime instead: ${CREATE_MAINTENANCE_LINK}`,
    listsUnreadableWithoutLink:
      "Sorry, I couldn't open the form to create a scheduled maintenance event because OneUptime could not load the lists it needs just now. Please try again in a minute, or create it in OneUptime instead.",
    tooLarge: `Sorry, I couldn't open the form to create a scheduled maintenance event: Microsoft Teams refused it as too large, even without the lists of monitors and labels. You can create it in OneUptime instead: ${CREATE_MAINTENANCE_LINK}`,
    tooLargeWithoutLink:
      "Sorry, I couldn't open the form to create a scheduled maintenance event: Microsoft Teams refused it as too large, even without the lists of monitors and labels. You can create it in OneUptime instead.",
    notInRoster: `Sorry, I couldn't open the form to create a scheduled maintenance event: Microsoft Teams did not accept it (403 BotNotInConversationRoster). You can create it in OneUptime instead: ${CREATE_MAINTENANCE_LINK}`,
  },
};

const COMMANDS: ReadonlyArray<CommandProfile> = [INCIDENT, MAINTENANCE];

// ---- The project's lists ----

/*
 * small: a few of everything, far below every budget.
 * big: what the capped fetchers return for a large project - 250 of 1,200
 *   monitors, 100 labels and 100 of 140 on-call policies, every name 80
 *   characters long. Well over the first budget, so each budget gives a
 *   different card.
 * listless: nothing but the required lists, so every budget gives the same
 *   card.
 */
type ChoicesSize = "small" | "big" | "listless";

// A distinct, well-formed id per list and row.
function rowId(list: number, index: number): string {
  return `00000000-0000-4000-8${String(list).padStart(3, "0")}-${String(
    index,
  ).padStart(12, "0")}`;
}

function namedList(
  list: number,
  names: ReadonlyArray<string>,
): MicrosoftTeamsCardChoiceList {
  return {
    choices: names.map(
      (name: string, index: number): MicrosoftTeamsCardChoice => {
        return { title: name, value: rowId(list, index + 1) };
      },
    ),
    totalCount: names.length,
  };
}

function longList(data: {
  list: number;
  noun: string;
  count: number;
  totalCount: number;
}): MicrosoftTeamsCardChoiceList {
  const names: Array<string> = [];

  for (let index: number = 1; index <= data.count; index++) {
    names.push(
      `${data.noun} ${String(index).padStart(4, "0")} · checkout-api.eu-west-1.production.example.com / HTTPS health check`.substring(
        0,
        80,
      ),
    );
  }

  return {
    choices: namedList(data.list, names).choices,
    totalCount: data.totalCount,
  };
}

function emptyList(): MicrosoftTeamsCardChoiceList {
  return { choices: [], totalCount: 0 };
}

function severityList(): MicrosoftTeamsCardChoiceList {
  return namedList(1, ["Critical", "Major", "Minor"]);
}

function monitorStatusList(): MicrosoftTeamsCardChoiceList {
  return namedList(3, ["Operational", "Degraded", "Offline"]);
}

function monitorList(size: ChoicesSize): MicrosoftTeamsCardChoiceList {
  if (size === "big") {
    return longList({ list: 2, noun: "Monitor", count: 250, totalCount: 1200 });
  }

  return size === "small"
    ? namedList(2, ["API", "Checkout", "Website"])
    : emptyList();
}

function labelList(size: ChoicesSize): MicrosoftTeamsCardChoiceList {
  if (size === "big") {
    return longList({ list: 4, noun: "Label", count: 100, totalCount: 100 });
  }

  return size === "small"
    ? namedList(4, ["eu-west-1", "payments"])
    : emptyList();
}

function onCallPolicyList(size: ChoicesSize): MicrosoftTeamsCardChoiceList {
  if (size === "big") {
    return longList({ list: 5, noun: "Policy", count: 100, totalCount: 140 });
  }

  return size === "small" ? namedList(5, ["Primary on-call"]) : emptyList();
}

function incidentChoices(
  size: ChoicesSize,
): MicrosoftTeamsNewIncidentFormChoices {
  return {
    severities: severityList(),
    monitors: monitorList(size),
    monitorStatuses: monitorStatusList(),
    labels: labelList(size),
    onCallDutyPolicies: onCallPolicyList(size),
  };
}

function maintenanceChoices(
  size: ChoicesSize,
): MicrosoftTeamsNewScheduledMaintenanceFormChoices {
  return {
    monitors: monitorList(size),
    monitorStatuses: monitorStatusList(),
    labels: labelList(size),
  };
}

// ---- The form the command must send ----

/*
 * The production card builders, kept before any test spies on them. The
 * command must send exactly what they build from the project's lists, so a
 * list, the typed title, the dashboard link or the time zone that goes missing
 * on the way fails the test, not only a field a test happens to look at.
 */
const buildIncidentForm: typeof MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget =
  MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget.bind(
    MicrosoftTeamsIncidentActions,
  );
const buildMaintenanceForm: typeof MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget =
  MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget.bind(
    MicrosoftTeamsScheduledMaintenanceActions,
  );

function expectedForm(
  profile: CommandProfile,
  data: {
    size: ChoicesSize;
    budgetInBytes: number;
    initialTitle?: string | undefined;
    createInOneUptimeUrl: string | null;
    timezone?: string | undefined;
  },
): JSONObject {
  if (profile.kind === "incident") {
    return buildIncidentForm({
      choices: incidentChoices(data.size),
      budgetInBytes: data.budgetInBytes,
      initialTitle: data.initialTitle,
      createInOneUptimeUrl: data.createInOneUptimeUrl,
    });
  }

  return buildMaintenanceForm({
    choices: maintenanceChoices(data.size),
    budgetInBytes: data.budgetInBytes,
    initialTitle: data.initialTitle,
    createInOneUptimeUrl: data.createInOneUptimeUrl,
    timezone: data.timezone,
  });
}

// ---- A fake Teams ----

/*
 * What Teams does with one sendActivity call: undefined delivers it, anything
 * else is thrown back at the bot, as the Bot Connector's RestError would be.
 */
type TeamsAnswer = (reply: unknown) => unknown;

interface SendAttempt {
  reply: unknown;
  delivered: boolean;
}

interface FakeTeams {
  turnContext: TurnContext;
  // Every sendActivity call, in order, and whether it reached the user.
  attempts: Array<SendAttempt>;
  /*
   * Every deleteActivity call. Recorded rather than refused: a refusal would
   * be swallowed by a best-effort delete, and the test would never know.
   */
  deletions: Array<unknown>;
}

function createFakeTeams(data: {
  activity: JSONObject;
  answer?: TeamsAnswer | undefined;
}): FakeTeams {
  const attempts: Array<SendAttempt> = [];
  const deletions: Array<unknown> = [];

  const turnContext: TurnContext = {
    activity: data.activity,
    sendActivity: async (reply: unknown): Promise<{ id: string }> => {
      const refusal: unknown = data.answer ? data.answer(reply) : undefined;

      attempts.push({ reply: reply, delivered: refusal === undefined });

      if (refusal !== undefined) {
        throw refusal;
      }

      return { id: `reply-${attempts.length}` };
    },
    deleteActivity: async (activityId: unknown): Promise<void> => {
      deletions.push(activityId);
    },
  } as unknown as TurnContext;

  return { turnContext: turnContext, attempts: attempts, deletions: deletions };
}

// What botbuilder's connector throws when Teams refuses a call.
function teamsRefusal(data: {
  statusCode: number;
  code?: string | undefined;
  message: string;
}): Error {
  return Object.assign(new Error(data.message), {
    name: "RestError",
    statusCode: data.statusCode,
    code: data.code,
    details: data.code
      ? { error: { code: data.code, message: data.message } }
      : undefined,
    response: { status: data.statusCode },
  });
}

function messageSizeTooBig(): Error {
  return teamsRefusal({
    statusCode: 413,
    code: "MessageSizeTooBig",
    message: "Message size too large.",
  });
}

function botNotInConversationRoster(): Error {
  return teamsRefusal({
    statusCode: 403,
    code: "BotNotInConversationRoster",
    message: "The bot is not part of the conversation roster.",
  });
}

// A connection Teams dropped: a network error code, no HTTP status.
function connectionReset(): Error {
  return Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
}

function isCardReply(reply: unknown): boolean {
  return (
    typeof reply === "object" &&
    reply !== null &&
    Array.isArray((reply as { attachments?: unknown }).attachments)
  );
}

// Refuses the first `times` cards (every card when not given); text passes.
function refuseCards(data: {
  refusal: () => unknown;
  times?: number | undefined;
}): TeamsAnswer {
  let refusedCards: number = 0;

  return (reply: unknown): unknown => {
    if (!isCardReply(reply)) {
      return undefined;
    }

    if (data.times !== undefined && refusedCards >= data.times) {
      return undefined;
    }

    refusedCards++;
    return data.refusal();
  };
}

function refuseEverything(refusal: () => unknown): TeamsAnswer {
  return (): unknown => {
    return refusal();
  };
}

// ---- Reading what the command sent ----

function deliveredReplies(teams: FakeTeams): Array<unknown> {
  return teams.attempts
    .filter((attempt: SendAttempt) => {
      return attempt.delivered;
    })
    .map((attempt: SendAttempt) => {
      return attempt.reply;
    });
}

/*
 * How many sendActivity calls there were, and how many reached the user. A
 * create command never removes a message (not the user's, not a form), so
 * there is never a deleteActivity call.
 */
function expectSends(
  teams: FakeTeams,
  counts: { attempted: number; delivered: number },
): void {
  expect({
    attempted: teams.attempts.length,
    delivered: deliveredReplies(teams).length,
    deleted: teams.deletions.length,
  }).toEqual({ ...counts, deleted: 0 });
}

function cardOf(reply: unknown): JSONObject {
  expect(isCardReply(reply)).toBe(true);

  const attachments: Array<JSONObject> = (
    reply as { attachments: Array<JSONObject> }
  ).attachments;

  expect(attachments).toHaveLength(1);
  expect(attachments[0]!["contentType"]).toBe(
    MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
  );

  return attachments[0]!["content"] as JSONObject;
}

// Every card the command tried to send, refused or not, in order.
function attemptedCards(teams: FakeTeams): Array<JSONObject> {
  return teams.attempts
    .filter((attempt: SendAttempt) => {
      return isCardReply(attempt.reply);
    })
    .map((attempt: SendAttempt) => {
      return cardOf(attempt.reply);
    });
}

// The one reply that reached the user, which must be a form.
function theDeliveredCard(teams: FakeTeams): JSONObject {
  const delivered: Array<unknown> = deliveredReplies(teams);

  expect(delivered).toHaveLength(1);

  return cardOf(delivered[0]);
}

// The one reply that reached the user, which must be text.
function theDeliveredText(teams: FakeTeams): string {
  const delivered: Array<unknown> = deliveredReplies(teams);

  expect(delivered).toHaveLength(1);
  expect(typeof delivered[0]).toBe("string");

  return delivered[0] as string;
}

function bodyOf(card: JSONObject): Array<JSONObject> {
  return card["body"] as Array<JSONObject>;
}

function inputOf(card: JSONObject, id: string): JSONObject | undefined {
  return bodyOf(card).find((element: JSONObject) => {
    return element["id"] === id;
  });
}

// The ids of the lists (Input.ChoiceSet) on the card, in order.
function choiceSetIdsOf(card: JSONObject): Array<string> {
  return bodyOf(card)
    .filter((element: JSONObject) => {
      return element["type"] === "Input.ChoiceSet";
    })
    .map((element: JSONObject) => {
      return String(element["id"]);
    });
}

function textsOf(card: JSONObject): Array<string> {
  return bodyOf(card)
    .filter((element: JSONObject) => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject) => {
      return String(element["text"]);
    });
}

function actionsOf(card: JSONObject): Array<JSONObject> {
  return card["actions"] as Array<JSONObject>;
}

function submitDataOf(card: JSONObject): JSONObject {
  const submit: JSONObject | undefined = actionsOf(card).find(
    (action: JSONObject) => {
      return action["type"] === "Action.Submit";
    },
  );

  expect(submit).toBeDefined();

  return submit!["data"] as JSONObject;
}

function openUrlsOf(card: JSONObject): Array<string> {
  return actionsOf(card)
    .filter((action: JSONObject) => {
      return action["type"] === "Action.OpenUrl";
    })
    .map((action: JSONObject) => {
      return String(action["url"]);
    });
}

function sizeOf(card: JSONObject): number {
  return MicrosoftTeamsMessageSize.getSizeInBytes(card);
}

function loggedErrors(): string {
  return errorLogSpy.mock.calls
    .map((call: Parameters<typeof logger.error>) => {
      return String(call[0]);
    })
    .join("\n");
}

// What every log call of a create command carries: the project it ran in.
const PROJECT_LOG_ATTRIBUTES: LogAttributes = {
  projectId: PROJECT_ID.toString(),
};

/*
 * Every logger.error call, in order, each with the project it happened in: a
 * string must be the very line, an error the very object that was thrown.
 *
 * A failure goes through MicrosoftTeamsReplies.logFailure: the line that says
 * what failed and why, then the error itself, whose stack and class the line
 * leaves out - unless the error carries an HTTP status, as Teams' RestError
 * does, when the line (which names the status and code) is all there is.
 */
function expectErrorLogs(entries: ReadonlyArray<string | Error>): void {
  expect(errorLogSpy).toHaveBeenCalledTimes(entries.length);

  entries.forEach((entry: string | Error, index: number): void => {
    const call: Parameters<typeof logger.error> =
      errorLogSpy.mock.calls[index]!;

    expect(call[0]).toBe(entry);
    expect(call[1]).toEqual(PROJECT_LOG_ATTRIBUTES);
  });
}

// ---- Running a command ----

let messageCount: number = 0;

/*
 * The message Teams delivers when the command is typed to the bot in a
 * personal (1:1) chat, where the sender is the only one who can submit the
 * form it answers with.
 */
function messageActivity(
  profile: CommandProfile,
  fields?: JSONObject,
): JSONObject {
  messageCount++;

  return {
    type: "message",
    id: `1727611200${String(messageCount).padStart(3, "0")}`,
    text: `${profile.command} ${profile.typedTitle}`,
    from: {
      id: "29:1f2e3d4c5b6a7980",
      name: "Jane Doe",
      aadObjectId: AAD_OBJECT_ID,
    },
    recipient: { id: "28:oneuptime-bot", name: "OneUptime" },
    conversation: {
      id: "a:1x2y3z-personal-chat",
      conversationType: "personal",
      tenantId: "tenant-1",
    },
    channelData: { tenant: { id: "tenant-1" } },
    ...(fields || {}),
  };
}

/*
 * A conversation other people are in, where whoever reads the form may submit
 * it: what its messages carry in place of the personal chat's.
 */
interface SharedConversation {
  name: string;
  fields: JSONObject;
}

const CHANNEL: SharedConversation = {
  name: "channel",
  fields: {
    conversation: {
      id: "19:8f3e2d1c0b9a4e5f6a7b@thread.tacv2;messageid=1727611200000",
      conversationType: "channel",
      tenantId: "tenant-1",
      isGroup: true,
    },
    channelData: {
      tenant: { id: "tenant-1" },
      team: { id: "19:2a3b4c5d6e7f8091a2b3@thread.tacv2", name: "Engineering" },
      channel: { id: "19:8f3e2d1c0b9a4e5f6a7b@thread.tacv2" },
    },
  },
};

const GROUP_CHAT: SharedConversation = {
  name: "group chat",
  fields: {
    conversation: {
      id: "19:6d5c4b3a2f1e0d9c8b7a@thread.v2",
      conversationType: "groupChat",
      tenantId: "tenant-1",
      isGroup: true,
    },
  },
};

const SHARED_CONVERSATIONS: ReadonlyArray<SharedConversation> = [
  CHANNEL,
  GROUP_CHAT,
];

/*
 * The command typed there. The bot only hears a message that @mentions it
 * outside a personal chat; MicrosoftTeams.ts strips the mention before it
 * hands the command over.
 */
function sharedConversationMessage(
  profile: CommandProfile,
  conversation: SharedConversation,
  fields?: JSONObject,
): JSONObject {
  return messageActivity(profile, {
    text: `<at>OneUptime</at> ${profile.command} ${profile.typedTitle}`,
    entities: [
      {
        type: "mention",
        text: "<at>OneUptime</at>",
        mentioned: { id: "28:oneuptime-bot", name: "OneUptime" },
      },
    ],
    ...conversation.fields,
    ...(fields || {}),
  });
}

/*
 * Runs the command the way MicrosoftTeams.ts does: the message's activity is
 * also the TurnContext's. The handler must resolve whatever happens: a throw
 * here became an HTTP 500, and Teams delivered the message a second time.
 */
async function runCommand(data: {
  profile: CommandProfile;
  activity?: JSONObject | undefined;
  answer?: TeamsAnswer | undefined;
  initialTitle?: string | undefined;
}): Promise<FakeTeams> {
  const activity: JSONObject = data.activity || messageActivity(data.profile);
  const teams: FakeTeams = createFakeTeams({
    activity: activity,
    answer: data.answer,
  });

  const request: CreateCommandRequest = {
    turnContext: teams.turnContext,
    activity: activity,
    projectId: PROJECT_ID,
    initialTitle: data.initialTitle,
  };

  await expect(
    data.profile.kind === "incident"
      ? MicrosoftTeamsCreateCommands.handleCreateIncidentCommand(request)
      : MicrosoftTeamsCreateCommands.handleCreateScheduledMaintenanceCommand(
          request,
        ),
  ).resolves.toBeUndefined();

  return teams;
}

// ---- Stubs ----

// The real permission check, kept before any test spies on it.
const realAssertCanCreate: typeof WorkspaceActionAuthorization.assertCanCreate =
  WorkspaceActionAuthorization.assertCanCreate.bind(
    WorkspaceActionAuthorization,
  );

// A member's props as getProjectMemberProps builds them, with these roles.
function memberWith(
  permissions: ReadonlyArray<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        isBlockPermission: false,
        labelIds: [],
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTeamIds: [],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

let senderLookupSpy: SpyInstance<
  typeof MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId
>;
let memberPropsSpy: SpyInstance<
  typeof WorkspaceActionAuthorization.getProjectMemberProps
>;
let assertCanCreateSpy: SpyInstance<
  typeof WorkspaceActionAuthorization.assertCanCreate
>;
let incidentChoicesSpy: SpyInstance<
  typeof MicrosoftTeamsIncidentActions.getNewIncidentFormChoices
>;
let maintenanceChoicesSpy: SpyInstance<
  typeof MicrosoftTeamsScheduledMaintenanceActions.getNewScheduledMaintenanceFormChoices
>;
let dashboardLinkSpy: SpyInstance<
  typeof MicrosoftTeamsReplies.getDashboardLink
>;
let incidentCardSpy: SpyInstance<
  typeof MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget
>;
let maintenanceCardSpy: SpyInstance<
  typeof MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget
>;
let errorLogSpy: SpyInstance<typeof logger.error>;
let warnLogSpy: SpyInstance<typeof logger.warn>;

function giveChoices(profile: CommandProfile, size: ChoicesSize): void {
  if (profile.kind === "incident") {
    incidentChoicesSpy.mockResolvedValue(incidentChoices(size));
    return;
  }

  maintenanceChoicesSpy.mockResolvedValue(maintenanceChoices(size));
}

function failChoices(profile: CommandProfile, error: Error): void {
  if (profile.kind === "incident") {
    incidentChoicesSpy.mockRejectedValue(error);
    return;
  }

  maintenanceChoicesSpy.mockRejectedValue(error);
}

function choicesSpyOf(
  profile: CommandProfile,
): SpyInstance<
  (
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ) => Promise<unknown>
> {
  return (profile.kind === "incident"
    ? incidentChoicesSpy
    : maintenanceChoicesSpy) as unknown as SpyInstance<
    (
      projectId: ObjectID,
      props: DatabaseCommonInteractionProps,
    ) => Promise<unknown>
  >;
}

// The budget of every card the command built, in order.
function budgetsBuilt(profile: CommandProfile): Array<number> {
  const calls: Array<[{ budgetInBytes: number }]> = (
    profile.kind === "incident"
      ? incidentCardSpy.mock.calls
      : maintenanceCardSpy.mock.calls
  ) as Array<[{ budgetInBytes: number }]>;

  return calls.map((call: [{ budgetInBytes: number }]) => {
    return call[0].budgetInBytes;
  });
}

beforeEach((): void => {
  senderLookupSpy = jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(USER_ID);
  memberPropsSpy = jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(MEMBER_PROPS);
  assertCanCreateSpy = jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue(undefined);
  incidentChoicesSpy = jest
    .spyOn(MicrosoftTeamsIncidentActions, "getNewIncidentFormChoices")
    .mockResolvedValue(incidentChoices("small"));
  maintenanceChoicesSpy = jest
    .spyOn(
      MicrosoftTeamsScheduledMaintenanceActions,
      "getNewScheduledMaintenanceFormChoices",
    )
    .mockResolvedValue(maintenanceChoices("small"));
  dashboardLinkSpy = jest
    .spyOn(MicrosoftTeamsReplies, "getDashboardLink")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        route: string;
      }): Promise<string | null> => {
        return `${DASHBOARD_URL}/${data.projectId.toString()}${data.route}`;
      },
    );

  // The real card builders, watched for the budgets they are asked for.
  incidentCardSpy = jest.spyOn(
    MicrosoftTeamsIncidentActions,
    "buildNewIncidentCardForBudget",
  );
  maintenanceCardSpy = jest.spyOn(
    MicrosoftTeamsScheduledMaintenanceActions,
    "buildNewScheduledMaintenanceCardForBudget",
  );

  errorLogSpy = jest.spyOn(logger, "error").mockImplementation((): void => {});
  warnLogSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach((): void => {
  jest.restoreAllMocks();
});

test("these tests count sends against three budgets: 40 KiB, 20 KiB, then no lists", (): void => {
  expect(MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES).toEqual([
    40 * 1024,
    20 * 1024,
    0,
  ]);
  expect(LAST_BUDGET).toBe(0);
});

describe.each(COMMANDS)("$command", (profile: CommandProfile): void => {
  // The builder's form for this command at one budget, with the dashboard link.
  function formFor(
    size: ChoicesSize,
    budgetInBytes: number,
    initialTitle?: string | undefined,
  ): JSONObject {
    return expectedForm(profile, {
      size: size,
      budgetInBytes: budgetInBytes,
      initialTitle: initialTitle,
      createInOneUptimeUrl: profile.createLink,
    });
  }

  describe("the form", (): void => {
    test("sends one form, with the title typed after the command filled in", async (): Promise<void> => {
      const activity: JSONObject = messageActivity(profile);

      const teams: FakeTeams = await runCommand({
        profile: profile,
        activity: activity,
        initialTitle: profile.typedTitle,
      });

      expectSends(teams, { attempted: 1, delivered: 1 });
      const card: JSONObject = theDeliveredCard(teams);

      expect(card["type"]).toBe("AdaptiveCard");
      expect(inputOf(card, profile.titleInputId)).toMatchObject({
        type: "Input.Text",
        isRequired: true,
        value: profile.typedTitle,
      });
      expect(submitDataOf(card)["action"]).toBe(profile.submitAction);
      // Every choice of a small project fits, so there is no dashboard button.
      expect(openUrlsOf(card)).toEqual([]);
      expect(
        (inputOf(card, profile.monitorsInputId)?.["choices"] as
          | Array<JSONObject>
          | undefined)!.map((choice: JSONObject) => {
          return choice["title"];
        }),
      ).toEqual(["API", "Checkout", "Website"]);
      // Every list the project has is offered, whole: the builder's own card.
      expect(choiceSetIdsOf(card)).toEqual(profile.choiceSetIds);
      expect(card).toEqual(formFor("small", FIRST_BUDGET, profile.typedTitle));

      /*
       * The sender is checked as who they are in this project, then the
       * lists are read as them: only what they may read is offered.
       */
      expect(senderLookupSpy).toHaveBeenCalledTimes(1);
      expect(senderLookupSpy).toHaveBeenCalledWith({
        teamsUserId: AAD_OBJECT_ID,
        projectId: PROJECT_ID,
      });
      expect(memberPropsSpy).toHaveBeenCalledTimes(1);
      expect(memberPropsSpy).toHaveBeenCalledWith({
        userId: USER_ID,
        projectId: PROJECT_ID,
      });
      expect(choicesSpyOf(profile)).toHaveBeenCalledTimes(1);
      expect(choicesSpyOf(profile)).toHaveBeenCalledWith(
        PROJECT_ID,
        MEMBER_PROPS,
      );
      expect(memberPropsSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        choicesSpyOf(profile).mock.invocationCallOrder[0]!,
      );
      // ... after the permission its submit needs was asked.
      expect(assertCanCreateSpy).toHaveBeenCalledTimes(1);
      expect(assertCanCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        choicesSpyOf(profile).mock.invocationCallOrder[0]!,
      );

      expect(budgetsBuilt(profile)).toEqual([FIRST_BUDGET]);
      expect(errorLogSpy).not.toHaveBeenCalled();
    });

    test("with nothing typed after the command, the title starts empty", async (): Promise<void> => {
      // MicrosoftTeams.ts passes "" for a bare "create incident" / "create maintenance".
      const teams: FakeTeams = await runCommand({
        profile: profile,
        initialTitle: "",
      });

      expectSends(teams, { attempted: 1, delivered: 1 });
      const title: JSONObject | undefined = inputOf(
        theDeliveredCard(teams),
        profile.titleInputId,
      );

      expect(title).toBeDefined();
      expect(title!["value"]).toBeUndefined();
    });

    test("a title typed longer than the form takes is cut to fit, never through an emoji", async (): Promise<void> => {
      /*
       * The limit falls between the two UTF-16 halves of the emoji. Half an
       * emoji is not a character (Teams would show it as �), so the cut keeps
       * everything before the emoji and none of it.
       */
      const fits: string = "x".repeat(profile.titleMaxLength - 1);
      const typedTitle: string = `${fits}🔥 and more than the form takes`;

      const teams: FakeTeams = await runCommand({
        profile: profile,
        initialTitle: typedTitle,
      });

      expectSends(teams, { attempted: 1, delivered: 1 });
      const card: JSONObject = theDeliveredCard(teams);

      expect(inputOf(card, profile.titleInputId)).toMatchObject({
        type: "Input.Text",
        maxLength: profile.titleMaxLength,
        value: fits,
      });
      expect(card).toEqual(formFor("small", FIRST_BUDGET, typedTitle));
    });

    test("a big project's form fits the first budget and offers the dashboard's create page for what it leaves off", async (): Promise<void> => {
      giveChoices(profile, "big");

      const teams: FakeTeams = await runCommand({
        profile: profile,
        initialTitle: profile.typedTitle,
      });

      expectSends(teams, { attempted: 1, delivered: 1 });
      const card: JSONObject = theDeliveredCard(teams);

      expect(sizeOf(card)).toBeLessThanOrEqual(FIRST_BUDGET);
      expect(openUrlsOf(card)).toEqual([profile.createLink]);
      expect(actionsOf(card)).toContainEqual({
        type: "Action.OpenUrl",
        title: "Create in OneUptime",
        url: profile.createLink,
      });
      expect(inputOf(card, profile.titleInputId)?.["value"]).toBe(
        profile.typedTitle,
      );
      expect(dashboardLinkSpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        route: profile.form.dashboardRoute,
      });
      expect(budgetsBuilt(profile)).toEqual([FIRST_BUDGET]);

      // As many monitors as fit, not none, and the card says how many it left off.
      expect(inputOf(card, profile.monitorsInputId)).toBeDefined();
      expect(
        textsOf(card).some((text: string) => {
          return (
            text.startsWith("Showing the first ") &&
            text.includes(" of 1200 monitors, by name.")
          );
        }),
      ).toBe(true);
      expect(card).toEqual(formFor("big", FIRST_BUDGET, profile.typedTitle));
    });
  });

  // Every message here comes from a personal chat (see messageActivity).
  describe("the sender check, in a personal chat", (): void => {
    test.each([
      { name: "no sender at all", from: undefined },
      { name: "a sender without an AAD object id", from: { id: "29:1f2e" } },
      {
        name: "an empty AAD object id",
        from: { id: "29:1f2e", aadObjectId: "" },
      },
    ])(
      "$name: one reply saying so, and nothing is looked up",
      async (row: {
        name: string;
        from: JSONObject | undefined;
      }): Promise<void> => {
        const activity: JSONObject = messageActivity(profile);
        delete activity["from"];

        if (row.from) {
          activity["from"] = row.from;
        }

        const teams: FakeTeams = await runCommand({
          profile: profile,
          activity: activity,
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        expect(theDeliveredText(teams)).toBe(profile.replies.senderUnknown);
        expect(senderLookupSpy).not.toHaveBeenCalled();
        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(assertCanCreateSpy).not.toHaveBeenCalled();
        expect(choicesSpyOf(profile)).not.toHaveBeenCalled();
        // Worth a warning, not an error: nothing on the server failed.
        expect(warnLogSpy).toHaveBeenCalledTimes(1);
        expect(warnLogSpy).toHaveBeenCalledWith(
          "A Microsoft Teams create command arrived without the sender's AAD object id",
          { projectId: PROJECT_ID.toString() },
        );
        expect(errorLogSpy).not.toHaveBeenCalled();
      },
    );

    test("an account nobody connected yet: one reply with the settings link, no form, no lists read", async (): Promise<void> => {
      senderLookupSpy.mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException(
          "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
        ),
      );

      const teams: FakeTeams = await runCommand({ profile: profile });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(profile.replies.accountNotLinked);
      expect(dashboardLinkSpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        route: "/user-settings/microsoft-teams-integration",
      });
      expect(memberPropsSpy).not.toHaveBeenCalled();
      expect(assertCanCreateSpy).not.toHaveBeenCalled();
      expect(choicesSpyOf(profile)).not.toHaveBeenCalled();
      // Expected, not a server error.
      expect(errorLogSpy).not.toHaveBeenCalled();
    });

    test("an account nobody connected yet, with no dashboard URL known: says where to connect it in words", async (): Promise<void> => {
      senderLookupSpy.mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("No linked user."),
      );
      dashboardLinkSpy.mockResolvedValue(null);

      const teams: FakeTeams = await runCommand({ profile: profile });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(
        profile.replies.accountNotLinkedWithoutLink,
      );
    });

    test("a sender who is not a member of the project: one reply with that message, verbatim", async (): Promise<void> => {
      memberPropsSpy.mockRejectedValue(
        new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        ),
      );

      const teams: FakeTeams = await runCommand({ profile: profile });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(
        "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
      );
      expect(assertCanCreateSpy).not.toHaveBeenCalled();
      expect(choicesSpyOf(profile)).not.toHaveBeenCalled();
      expect(errorLogSpy).not.toHaveBeenCalled();
    });

    test.each([
      {
        name: "looking up the linked account fails (database down)",
        stage: "lookup",
        error: new Error("connect ECONNREFUSED 10.0.0.5:5432"),
        described: "Error: connect ECONNREFUSED 10.0.0.5:5432",
      },
      {
        name: "reading the project membership fails (database down)",
        stage: "membership",
        error: new Error("connect ECONNREFUSED 10.0.0.5:5432"),
        described: "Error: connect ECONNREFUSED 10.0.0.5:5432",
      },
      {
        name: "the account lookup refuses with a BadDataException that is not about a missing link",
        stage: "lookup",
        error: new BadDataException("Invalid workspace user id."),
        // OneUptime's exceptions keep Error's name; the log names their class.
        described: "BadDataException: Invalid workspace user id.",
      },
    ])(
      "$name: one reply that the account could not be checked, and the details go to the log",
      async (row: {
        name: string;
        stage: string;
        error: Error;
        described: string;
      }): Promise<void> => {
        if (row.stage === "lookup") {
          senderLookupSpy.mockRejectedValue(row.error);
        } else {
          memberPropsSpy.mockRejectedValue(row.error);
        }

        const teams: FakeTeams = await runCommand({ profile: profile });

        expectSends(teams, { attempted: 1, delivered: 1 });
        const reply: string = theDeliveredText(teams);
        expect(reply).toBe(profile.replies.senderCheckFailed);
        expect(reply).not.toContain(row.error.message);
        expect(choicesSpyOf(profile)).not.toHaveBeenCalled();
        // No HTTP status, so the error itself follows the line, for its stack.
        expectErrorLogs([
          `Could not check the Microsoft Teams sender of a create command: ${row.described}`,
          row.error,
        ]);
      },
    );
  });

  /*
   * Anyone in a channel or group chat may submit the form, and the submit is
   * checked as whoever does. The form itself is filled in as whoever asked
   * for it: the sender is checked as in a personal chat, and the lists are
   * the ones the sender may read - never the whole project's for everyone
   * there.
   */
  describe("in a channel or group chat", (): void => {
    test.each(SHARED_CONVERSATIONS)(
      "in a $name, the sender is checked and the form posted for everyone there lists what the sender may read",
      async (conversation: SharedConversation): Promise<void> => {
        const teams: FakeTeams = await runCommand({
          profile: profile,
          activity: sharedConversationMessage(profile, conversation),
          initialTitle: profile.typedTitle,
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        expect(theDeliveredCard(teams)).toEqual(
          formFor("small", FIRST_BUDGET, profile.typedTitle),
        );
        expect(senderLookupSpy).toHaveBeenCalledTimes(1);
        expect(memberPropsSpy).toHaveBeenCalledTimes(1);
        expect(assertCanCreateSpy).toHaveBeenCalledTimes(1);
        expect(choicesSpyOf(profile)).toHaveBeenCalledTimes(1);
        expect(choicesSpyOf(profile)).toHaveBeenCalledWith(
          PROJECT_ID,
          MEMBER_PROPS,
        );
        expect(budgetsBuilt(profile)).toEqual([FIRST_BUDGET]);
        expect(warnLogSpy).not.toHaveBeenCalled();
        expect(errorLogSpy).not.toHaveBeenCalled();
      },
    );

    test.each(SHARED_CONVERSATIONS)(
      "in a $name, a sender without a connected account is told where to connect it, and no form is posted",
      async (conversation: SharedConversation): Promise<void> => {
        senderLookupSpy.mockRejectedValue(
          new MicrosoftTeamsAccountNotLinkedException("No linked user."),
        );

        const teams: FakeTeams = await runCommand({
          profile: profile,
          activity: sharedConversationMessage(profile, conversation),
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        expect(theDeliveredText(teams)).toBe(profile.replies.accountNotLinked);
        expect(memberPropsSpy).not.toHaveBeenCalled();
        expect(choicesSpyOf(profile)).not.toHaveBeenCalled();
        expect(errorLogSpy).not.toHaveBeenCalled();
      },
    );

    test.each(SHARED_CONVERSATIONS)(
      "in a $name, a sender who may not create it is told so, and no form is posted",
      async (conversation: SharedConversation): Promise<void> => {
        const refusal: string = `You do not have permission to ${profile.kind === "incident" ? "declare an incident" : "create a scheduled maintenance event"}.`;
        assertCanCreateSpy.mockRejectedValue(new NotAuthorizedException(refusal));

        const teams: FakeTeams = await runCommand({
          profile: profile,
          activity: sharedConversationMessage(profile, conversation),
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        expect(theDeliveredText(teams)).toBe(refusal);
        expect(choicesSpyOf(profile)).not.toHaveBeenCalled();
        expect(errorLogSpy).not.toHaveBeenCalled();
      },
    );

    test.each(SHARED_CONVERSATIONS)(
      "in a $name, a message without the sender's AAD object id gets no form: whose lists it would show is not known",
      async (conversation: SharedConversation): Promise<void> => {
        const teams: FakeTeams = await runCommand({
          profile: profile,
          activity: sharedConversationMessage(profile, conversation, {
            from: { id: "29:1f2e3d4c5b6a7980", name: "Jane Doe" },
          }),
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        expect(theDeliveredText(teams)).toBe(profile.replies.senderUnknown);
        expect(senderLookupSpy).not.toHaveBeenCalled();
        expect(choicesSpyOf(profile)).not.toHaveBeenCalled();
        expect(warnLogSpy).toHaveBeenCalledTimes(1);
        expect(errorLogSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe("the form's lists", (): void => {
    test.each([
      {
        name: "a query that timed out",
        error: new Error("Connection terminated due to connection timeout"),
        described: "Error: Connection terminated due to connection timeout",
      },
      {
        name: "no database connection",
        error: new DatabaseNotConnectedException(),
        // A OneUptime exception, named in the log by its class.
        described: "DatabaseNotConnectedException: Database not connected",
      },
    ])(
      "lists that cannot be read ($name): one reply with the dashboard's create page, and the details go to the log",
      async (row: {
        name: string;
        error: Error;
        described: string;
      }): Promise<void> => {
        failChoices(profile, row.error);

        const teams: FakeTeams = await runCommand({ profile: profile });

        expectSends(teams, { attempted: 1, delivered: 1 });
        const reply: string = theDeliveredText(teams);
        expect(reply).toBe(profile.replies.listsUnreadable);
        expect(reply).not.toContain(row.error.message);
        // No HTTP status, so the error itself follows the line, for its stack.
        expectErrorLogs([
          `Could not load the Microsoft Teams form to create ${profile.form.what}: ${row.described}`,
          row.error,
        ]);
        expect(budgetsBuilt(profile)).toEqual([]);
      },
    );

    test("lists that cannot be read, with no dashboard URL known: the same reply without a link", async (): Promise<void> => {
      failChoices(profile, new Error("Connection terminated"));
      dashboardLinkSpy.mockResolvedValue(null);

      const teams: FakeTeams = await runCommand({ profile: profile });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(
        profile.replies.listsUnreadableWithoutLink,
      );
    });
  });

  describe("a form Teams refuses", (): void => {
    test("413 on the first card: the smaller card for the next budget goes out, and that is the only reply", async (): Promise<void> => {
      giveChoices(profile, "big");

      const teams: FakeTeams = await runCommand({
        profile: profile,
        initialTitle: profile.typedTitle,
        answer: refuseCards({ refusal: messageSizeTooBig, times: 1 }),
      });

      expectSends(teams, { attempted: 2, delivered: 1 });
      const [refused, sent]: Array<JSONObject> = attemptedCards(teams);

      expect(sizeOf(refused!)).toBeLessThanOrEqual(FIRST_BUDGET);
      expect(sizeOf(refused!)).toBeGreaterThan(SECOND_BUDGET);
      expect(sizeOf(sent!)).toBeLessThanOrEqual(SECOND_BUDGET);
      expect(theDeliveredCard(teams)).toEqual(sent);

      // Still the same form: the typed title, the submit, the dashboard button.
      expect(inputOf(sent!, profile.titleInputId)?.["value"]).toBe(
        profile.typedTitle,
      );
      expect(submitDataOf(sent!)["action"]).toBe(profile.submitAction);
      expect(openUrlsOf(sent!)).toEqual([profile.createLink]);
      expect(inputOf(sent!, profile.monitorsInputId)).toBeDefined();

      // Each is the builder's card for its budget, from the same lists and title.
      expect([refused, sent]).toEqual([
        formFor("big", FIRST_BUDGET, profile.typedTitle),
        formFor("big", SECOND_BUDGET, profile.typedTitle),
      ]);
      expect(budgetsBuilt(profile)).toEqual([FIRST_BUDGET, SECOND_BUDGET]);

      // Recovered from, so a warning for the operator and not an error.
      expect(errorLogSpy).not.toHaveBeenCalled();
      expect(warnLogSpy).toHaveBeenCalledTimes(1);
      expect(String(warnLogSpy.mock.calls[0]![0])).toContain(
        `card as too large (budget ${FIRST_BUDGET} bytes); trying a smaller one.`,
      );
    });

    test("413 on a small project's form: the 20 KiB card would be the same, so the card without lists goes out next", async (): Promise<void> => {
      const teams: FakeTeams = await runCommand({
        profile: profile,
        answer: refuseCards({ refusal: messageSizeTooBig, times: 1 }),
      });

      expectSends(teams, { attempted: 2, delivered: 1 });
      const [refused, sent]: Array<JSONObject> = attemptedCards(teams);

      expect(inputOf(refused!, profile.monitorsInputId)).toBeDefined();
      expect(inputOf(sent!, profile.monitorsInputId)).toBeUndefined();
      expect(
        textsOf(sent!).some((text: string) => {
          return text.startsWith(
            "This project has 3 monitors, too many to list in Microsoft Teams.",
          );
        }),
      ).toBe(true);
      expect(openUrlsOf(sent!)).toEqual([profile.createLink]);
      expect(theDeliveredCard(teams)).toEqual(sent);
      expect([refused, sent]).toEqual([
        formFor("small", FIRST_BUDGET),
        formFor("small", LAST_BUDGET),
      ]);

      // The 20 KiB card was built, found identical to the refused one, and skipped.
      expect(budgetsBuilt(profile)).toEqual([
        FIRST_BUDGET,
        SECOND_BUDGET,
        LAST_BUDGET,
      ]);
    });

    test("413 on every card: three ever smaller cards, then one reply that Teams refused it as too large, with the dashboard's create page", async (): Promise<void> => {
      giveChoices(profile, "big");

      const teams: FakeTeams = await runCommand({
        profile: profile,
        answer: refuseCards({ refusal: messageSizeTooBig }),
      });

      expectSends(teams, { attempted: 4, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(profile.replies.tooLarge);

      const cards: Array<JSONObject> = attemptedCards(teams);
      expect(cards).toHaveLength(3);
      expect(sizeOf(cards[0]!)).toBeGreaterThan(sizeOf(cards[1]!));
      expect(sizeOf(cards[1]!)).toBeGreaterThan(sizeOf(cards[2]!));
      // The last one left every list off.
      expect(inputOf(cards[2]!, profile.monitorsInputId)).toBeUndefined();
      expect(inputOf(cards[2]!, "labels")).toBeUndefined();
      expect(cards).toEqual([
        formFor("big", FIRST_BUDGET),
        formFor("big", SECOND_BUDGET),
        formFor("big", LAST_BUDGET),
      ]);
      expect(budgetsBuilt(profile)).toEqual([
        FIRST_BUDGET,
        SECOND_BUDGET,
        LAST_BUDGET,
      ]);
      // The reply is the last thing sent.
      expect(isCardReply(teams.attempts[3]!.reply)).toBe(false);

      /*
       * Teams' refusal carries its HTTP status, which the line names with its
       * code, so the line is all that is logged, not the whole RestError.
       */
      expectErrorLogs([
        `Microsoft Teams did not accept the form to create ${profile.form.what}: RestError 413 MessageSizeTooBig: Message size too large.`,
      ]);
      // Each refused card was worth a warning on the way down.
      expect(warnLogSpy).toHaveBeenCalledTimes(3);
    });

    test("413 on every card, with no dashboard URL known: the too-large reply without a link", async (): Promise<void> => {
      giveChoices(profile, "big");
      dashboardLinkSpy.mockResolvedValue(null);

      const teams: FakeTeams = await runCommand({
        profile: profile,
        answer: refuseCards({ refusal: messageSizeTooBig }),
      });

      expectSends(teams, { attempted: 4, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(profile.replies.tooLargeWithoutLink);
      // With no dashboard URL to point to, no card has the button either.
      expect(
        attemptedCards(teams).every((card: JSONObject) => {
          return openUrlsOf(card).length === 0;
        }),
      ).toBe(true);
      expect(attemptedCards(teams)).toEqual(
        MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES.map(
          (budgetInBytes: number): JSONObject => {
            return expectedForm(profile, {
              size: "big",
              budgetInBytes: budgetInBytes,
              createInOneUptimeUrl: null,
            });
          },
        ),
      );
    });

    test("413 on a card with nothing to shorten: it is not sent again, and the too-large reply follows", async (): Promise<void> => {
      giveChoices(profile, "listless");

      const teams: FakeTeams = await runCommand({
        profile: profile,
        answer: refuseCards({ refusal: messageSizeTooBig }),
      });

      expectSends(teams, { attempted: 2, delivered: 1 });
      expect(attemptedCards(teams)).toEqual([
        formFor("listless", FIRST_BUDGET),
      ]);
      expect(theDeliveredText(teams)).toBe(profile.replies.tooLarge);
      // Each smaller budget was built, found no different, and not sent.
      expect(budgetsBuilt(profile)).toEqual([
        FIRST_BUDGET,
        SECOND_BUDGET,
        LAST_BUDGET,
      ]);
      // One refused card, one warning; the refusal's line is the one error.
      expect(warnLogSpy).toHaveBeenCalledTimes(1);
      expectErrorLogs([
        `Microsoft Teams did not accept the form to create ${profile.form.what}: RestError 413 MessageSizeTooBig: Message size too large.`,
      ]);
    });

    test("403 BotNotInConversationRoster: no smaller card is tried, and one reply names Teams' status and code", async (): Promise<void> => {
      giveChoices(profile, "big");

      const teams: FakeTeams = await runCommand({
        profile: profile,
        answer: refuseCards({ refusal: botNotInConversationRoster }),
      });

      expectSends(teams, { attempted: 2, delivered: 1 });
      expect(attemptedCards(teams)).toEqual([formFor("big", FIRST_BUDGET)]);
      expect(budgetsBuilt(profile)).toEqual([FIRST_BUDGET]);

      const reply: string = theDeliveredText(teams);
      expect(reply).toBe(profile.replies.notInRoster);
      expect(reply).toBe(
        MicrosoftTeamsCreateCommands.getFormNotAcceptedMessage({
          form: profile.form,
          error: botNotInConversationRoster(),
          createInOneUptimeUrl: profile.createLink,
        }),
      );
      expect(reply).not.toContain("roster.");
      // An HTTP refusal: its line, naming the status and code, is all there is.
      expectErrorLogs([
        `Microsoft Teams did not accept the form to create ${profile.form.what}: RestError 403 BotNotInConversationRoster: The bot is not part of the conversation roster.`,
      ]);
      // Not a size problem, so there was nothing smaller to try and no warning.
      expect(warnLogSpy).not.toHaveBeenCalled();
    });

    test("413 on the first card, then a dropped connection on the smaller one: answered at once, without trying the last budget", async (): Promise<void> => {
      giveChoices(profile, "big");
      let cardsSeen: number = 0;
      const droppedConnections: Array<Error> = [];

      const teams: FakeTeams = await runCommand({
        profile: profile,
        answer: (reply: unknown): unknown => {
          if (!isCardReply(reply)) {
            return undefined;
          }

          cardsSeen++;

          if (cardsSeen === 1) {
            return messageSizeTooBig();
          }

          const droppedConnection: Error = connectionReset();
          droppedConnections.push(droppedConnection);
          return droppedConnection;
        },
      });

      expectSends(teams, { attempted: 3, delivered: 1 });
      expect(attemptedCards(teams)).toEqual([
        formFor("big", FIRST_BUDGET),
        formFor("big", SECOND_BUDGET),
      ]);
      expect(budgetsBuilt(profile)).toEqual([FIRST_BUDGET, SECOND_BUDGET]);
      expect(theDeliveredText(teams)).toBe(
        `Sorry, I couldn't open the form to create ${profile.form.what}: Microsoft Teams did not accept it (ECONNRESET). You can create it in OneUptime instead: ${profile.createLink}`,
      );
      /*
       * A dropped connection has a network code but no HTTP status, so the
       * error itself follows the line, for its stack.
       */
      expect(droppedConnections).toHaveLength(1);
      expectErrorLogs([
        `Microsoft Teams did not accept the form to create ${profile.form.what}: Error ECONNRESET: socket hang up`,
        droppedConnections[0]!,
      ]);
    });

    test("a form that cannot be built still gets one reply, with the dashboard's create page, and nothing is thrown", async (): Promise<void> => {
      const builderError: TypeError = new TypeError(
        "Cannot read properties of undefined (reading 'choices')",
      );
      const builderFailure: () => never = (): never => {
        throw builderError;
      };

      if (profile.kind === "incident") {
        incidentCardSpy.mockImplementation(builderFailure);
      } else {
        maintenanceCardSpy.mockImplementation(builderFailure);
      }

      const teams: FakeTeams = await runCommand({ profile: profile });

      expectSends(teams, { attempted: 1, delivered: 1 });
      const reply: string = theDeliveredText(teams);
      expect(
        reply.startsWith(
          `Sorry, I couldn't open the form to create ${profile.form.what}`,
        ),
      ).toBe(true);
      expect(reply.endsWith(profile.createLink)).toBe(true);
      expect(reply).not.toContain("Cannot read properties");
      // Not a size problem, so no smaller card was tried.
      expect(budgetsBuilt(profile)).toEqual([FIRST_BUDGET]);
      /*
       * The operator is told what broke, and in which project, then gets the
       * TypeError itself, with the stack that says where.
       */
      expect(errorLogSpy).toHaveBeenCalledTimes(2);
      expect(errorLogSpy).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(
          ": TypeError: Cannot read properties of undefined (reading 'choices')",
        ),
        PROJECT_LOG_ATTRIBUTES,
      );
      expect(errorLogSpy.mock.calls[1]![0]).toBe(builderError);
      expect(errorLogSpy.mock.calls[1]![1]).toEqual(PROJECT_LOG_ATTRIBUTES);
    });
  });

  describe("a reply Teams refuses too", (): void => {
    interface RefusedReplyCase {
      name: string;
      // Sets the scene and returns the message the command answers.
      arrange: () => JSONObject;
      answer: () => TeamsAnswer;
      attempted: number;
    }

    const REFUSED_REPLY_CASES: ReadonlyArray<RefusedReplyCase> = [
      {
        name: "the reply that the sender is unknown",
        arrange: (): JSONObject => {
          return messageActivity(profile, { from: { id: "29:1f2e" } });
        },
        answer: (): TeamsAnswer => {
          return refuseEverything(botNotInConversationRoster);
        },
        attempted: 1,
      },
      {
        name: "the account-not-linked reply",
        arrange: (): JSONObject => {
          senderLookupSpy.mockRejectedValue(
            new MicrosoftTeamsAccountNotLinkedException("No linked user."),
          );
          return messageActivity(profile);
        },
        answer: (): TeamsAnswer => {
          return refuseEverything(botNotInConversationRoster);
        },
        attempted: 1,
      },
      {
        name: "the not-a-member reply",
        arrange: (): JSONObject => {
          memberPropsSpy.mockRejectedValue(
            new NotAuthorizedException(
              WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
            ),
          );
          return messageActivity(profile);
        },
        answer: (): TeamsAnswer => {
          return refuseEverything(botNotInConversationRoster);
        },
        attempted: 1,
      },
      {
        name: "the could-not-check-your-account reply",
        arrange: (): JSONObject => {
          senderLookupSpy.mockRejectedValue(new Error("ECONNREFUSED"));
          return messageActivity(profile);
        },
        answer: (): TeamsAnswer => {
          return refuseEverything(connectionReset);
        },
        attempted: 1,
      },
      {
        name: "the could-not-read-the-lists reply",
        arrange: (): JSONObject => {
          failChoices(profile, new Error("Connection terminated"));
          return messageActivity(profile);
        },
        answer: (): TeamsAnswer => {
          return refuseEverything(connectionReset);
        },
        attempted: 1,
      },
      {
        name: "the form, and then the did-not-accept reply",
        arrange: (): JSONObject => {
          return messageActivity(profile);
        },
        answer: (): TeamsAnswer => {
          return refuseEverything(botNotInConversationRoster);
        },
        attempted: 2,
      },
      {
        name: "every card, and then the too-large reply",
        arrange: (): JSONObject => {
          giveChoices(profile, "big");
          return messageActivity(profile);
        },
        answer: (): TeamsAnswer => {
          return refuseEverything(messageSizeTooBig);
        },
        attempted: 4,
      },
    ];

    test.each(REFUSED_REPLY_CASES)(
      "Teams refusing $name: nothing reaches the user, nothing is thrown, and the failed send is logged",
      async (row: RefusedReplyCase): Promise<void> => {
        const activity: JSONObject = row.arrange();

        const teams: FakeTeams = await runCommand({
          profile: profile,
          activity: activity,
          answer: row.answer(),
        });

        expectSends(teams, { attempted: row.attempted, delivered: 0 });
        expect(loggedErrors()).toContain(
          "Could not send a Microsoft Teams reply:",
        );
      },
    );
  });
});

describe("create incident", (): void => {
  /*
   * The form is filled in as the member who asked for it, with their own
   * permissions, as the incident form in OneUptime is: the permission to
   * declare an incident is asked before any list is read. (This used to ask
   * for a linked member only, by an earlier product decision, which the
   * maintainer has since changed: a chat form follows the same roles as
   * everywhere else.) The submit asks it again, as whoever submits the form.
   */
  test("asks for the permission to declare an incident, with the member's own props, before reading any list", async (): Promise<void> => {
    const teams: FakeTeams = await runCommand({ profile: INCIDENT });

    expectSends(teams, { attempted: 1, delivered: 1 });
    expect(assertCanCreateSpy).toHaveBeenCalledTimes(1);
    const check: Parameters<
      typeof WorkspaceActionAuthorization.assertCanCreate
    >[0] = assertCanCreateSpy.mock.calls[0]![0];
    expect(check.props).toBe(MEMBER_PROPS);
    expect(check.modelType).toBe(Incident);
    expect(check.action).toBe("declare an incident");
    expect(memberPropsSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      assertCanCreateSpy.mock.invocationCallOrder[0]!,
    );
    expect(assertCanCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      incidentChoicesSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("a linked member the permission model would not let declare an incident is refused in its own words, and gets no form", async (): Promise<void> => {
    assertCanCreateSpy.mockImplementation(realAssertCanCreate);
    const viewer: DatabaseCommonInteractionProps = memberWith([
      Permission.Viewer,
    ]);
    memberPropsSpy.mockResolvedValue(viewer);

    // What the permission model itself says to this member about an incident.
    const refusal: unknown = await realAssertCanCreate({
      props: viewer,
      modelType: Incident,
      action: "declare an incident",
    }).then(
      (): null => {
        return null;
      },
      (error: unknown): unknown => {
        return error;
      },
    );
    expect(refusal).toBeInstanceOf(NotAuthorizedException);

    const teams: FakeTeams = await runCommand({
      profile: INCIDENT,
      initialTitle: INCIDENT.typedTitle,
    });

    expectSends(teams, { attempted: 1, delivered: 1 });
    const reply: string = theDeliveredText(teams);
    expect(reply).toBe((refusal as NotAuthorizedException).message);
    expect(reply.startsWith("You do not have permission to declare an incident.")).toBe(
      true,
    );
    expect(incidentChoicesSpy).not.toHaveBeenCalled();
    expect(errorLogSpy).not.toHaveBeenCalled();
  });

  test.each([
    Permission.IncidentMember,
    Permission.CreateProjectIncident,
    Permission.ProjectMember,
  ])(
    "a member with %s gets the form, its lists read as them",
    async (permission: Permission): Promise<void> => {
      assertCanCreateSpy.mockImplementation(realAssertCanCreate);
      const member: DatabaseCommonInteractionProps = memberWith([permission]);
      memberPropsSpy.mockResolvedValue(member);

      const teams: FakeTeams = await runCommand({ profile: INCIDENT });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(theDeliveredCard(teams)["type"]).toBe("AdaptiveCard");
      expect(incidentChoicesSpy).toHaveBeenCalledWith(PROJECT_ID, member);
    },
  );

  test("offers the severities, which are never shortened, even on the card without lists", async (): Promise<void> => {
    giveChoices(INCIDENT, "big");

    const teams: FakeTeams = await runCommand({
      profile: INCIDENT,
      answer: refuseCards({ refusal: messageSizeTooBig, times: 2 }),
    });

    expectSends(teams, { attempted: 3, delivered: 1 });
    const card: JSONObject = theDeliveredCard(teams);
    expect(inputOf(card, "incidentMonitors")).toBeUndefined();
    expect(inputOf(card, "onCallDutyPolicies")).toBeUndefined();
    expect(
      (inputOf(card, "incidentSeverity")?.["choices"] as Array<JSONObject>).map(
        (choice: JSONObject) => {
          return choice["title"];
        },
      ),
    ).toEqual(["Critical", "Major", "Minor"]);
    expect(card).toEqual(
      expectedForm(INCIDENT, {
        size: "big",
        budgetInBytes: LAST_BUDGET,
        createInOneUptimeUrl: CREATE_INCIDENT_LINK,
      }),
    );
  });

  test("a project without incident severities gets one reply saying so, linking the page where they are added, and no form", async (): Promise<void> => {
    incidentChoicesSpy.mockResolvedValue({
      ...incidentChoices("small"),
      severities: emptyList(),
    });

    const teams: FakeTeams = await runCommand({ profile: INCIDENT });

    expectSends(teams, { attempted: 1, delivered: 1 });
    expect(theDeliveredText(teams)).toBe(
      `${NO_SEVERITIES_OPENING} Add one in OneUptime under [Incidents → Settings → Incident Severity](${SEVERITY_SETTINGS_LINK}), then try again.`,
    );
    // The one link asked for is that page's, not the create page's.
    expect(dashboardLinkSpy).toHaveBeenCalledTimes(1);
    expect(dashboardLinkSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      route: "/incidents/settings/severity",
    });
    expect(incidentCardSpy).not.toHaveBeenCalled();
    expect(errorLogSpy).not.toHaveBeenCalled();
  });

  test("a project without incident severities, with no dashboard URL known: names that page in words", async (): Promise<void> => {
    incidentChoicesSpy.mockResolvedValue({
      ...incidentChoices("small"),
      severities: emptyList(),
    });
    dashboardLinkSpy.mockResolvedValue(null);

    const teams: FakeTeams = await runCommand({ profile: INCIDENT });

    expectSends(teams, { attempted: 1, delivered: 1 });
    expect(theDeliveredText(teams)).toBe(
      `${NO_SEVERITIES_OPENING} Add one in OneUptime under Incidents → Settings → Incident Severity, then try again.`,
    );
    expect(incidentCardSpy).not.toHaveBeenCalled();
  });

  test("a project without incident severities is sent to where severities are added: Incidents → Settings → Incident Severity", async (): Promise<void> => {
    /*
     * Incident severities are managed under Incidents → Settings → Incident
     * Severity (/dashboard/<project>/incidents/settings/severity). Project
     * Settings has no such page; the docs (incidents/settings.md) say
     * incident configuration "does not live in Project Settings".
     */
    incidentChoicesSpy.mockResolvedValue({
      ...incidentChoices("small"),
      severities: emptyList(),
    });

    const teams: FakeTeams = await runCommand({ profile: INCIDENT });

    expectSends(teams, { attempted: 1, delivered: 1 });
    const reply: string = theDeliveredText(teams);
    expect(reply).not.toContain("Project Settings → Incident Severity");
    // Named as the dashboard names it, or linked to the page itself.
    expect(reply).toMatch(
      /Incidents → Settings → Incident Severity|\/incidents\/settings\/severity/,
    );
  });

  test("Teams refusing the no-severities reply: nothing reaches the user and nothing is thrown", async (): Promise<void> => {
    incidentChoicesSpy.mockResolvedValue({
      ...incidentChoices("small"),
      severities: emptyList(),
    });

    const teams: FakeTeams = await runCommand({
      profile: INCIDENT,
      answer: refuseEverything(botNotInConversationRoster),
    });

    expectSends(teams, { attempted: 1, delivered: 0 });
    expect(loggedErrors()).toContain("Could not send a Microsoft Teams reply:");
  });
});

describe("create maintenance", (): void => {
  /*
   * The permission its submit checks is checked first, as the member who
   * asked for the form, wherever they asked (see "in a channel or group
   * chat" above for the shared conversations).
   */
  describe("in a personal chat", (): void => {
    test("asks for the permission its submit needs, with the member's own props, before reading any list", async (): Promise<void> => {
      const teams: FakeTeams = await runCommand({ profile: MAINTENANCE });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(assertCanCreateSpy).toHaveBeenCalledTimes(1);
      const check: Parameters<
        typeof WorkspaceActionAuthorization.assertCanCreate
      >[0] = assertCanCreateSpy.mock.calls[0]![0];
      expect(check.props).toBe(MEMBER_PROPS);
      expect(check.modelType).toBe(ScheduledMaintenance);
      expect(check.action).toBe("create a scheduled maintenance event");
      expect(memberPropsSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        assertCanCreateSpy.mock.invocationCallOrder[0]!,
      );
      expect(assertCanCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        maintenanceChoicesSpy.mock.invocationCallOrder[0]!,
      );
    });

    test("a member without permission to create the event: one reply with that message, verbatim, and no form", async (): Promise<void> => {
      const refusal: string =
        "You do not have permission to create a scheduled maintenance event. You need one of these permissions: Project Owner, Project Admin, Create Scheduled Maintenance.";
      assertCanCreateSpy.mockRejectedValue(new NotAuthorizedException(refusal));

      const teams: FakeTeams = await runCommand({ profile: MAINTENANCE });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(refusal);
      expect(maintenanceChoicesSpy).not.toHaveBeenCalled();
      expect(maintenanceCardSpy).not.toHaveBeenCalled();
      expect(errorLogSpy).not.toHaveBeenCalled();
    });

    test("the permission check itself failing: one reply that the account could not be checked", async (): Promise<void> => {
      const permissionError: Error = new Error(
        "Redis connection lost while reading permissions",
      );
      assertCanCreateSpy.mockRejectedValue(permissionError);

      const teams: FakeTeams = await runCommand({ profile: MAINTENANCE });

      expectSends(teams, { attempted: 1, delivered: 1 });
      expect(theDeliveredText(teams)).toBe(
        MAINTENANCE.replies.senderCheckFailed,
      );
      expect(maintenanceChoicesSpy).not.toHaveBeenCalled();
      // No HTTP status, so the error itself follows the line, for its stack.
      expectErrorLogs([
        "Could not check the Microsoft Teams sender of a create command: Error: Redis connection lost while reading permissions",
        permissionError,
      ]);
    });

    describe("with the real permission model deciding", (): void => {
      beforeEach((): void => {
        assertCanCreateSpy.mockImplementation(realAssertCanCreate);
      });

      test("a read-only member is refused in the permission model's own words, before any list is read", async (): Promise<void> => {
        const viewer: DatabaseCommonInteractionProps = memberWith([
          Permission.Viewer,
        ]);
        memberPropsSpy.mockResolvedValue(viewer);

        // What the permission model itself says to this member about this event.
        const refusal: unknown = await realAssertCanCreate({
          props: viewer,
          modelType: ScheduledMaintenance,
          action: "create a scheduled maintenance event",
        }).then(
          (): null => {
            return null;
          },
          (error: unknown): unknown => {
            return error;
          },
        );
        expect(refusal).toBeInstanceOf(NotAuthorizedException);

        const teams: FakeTeams = await runCommand({ profile: MAINTENANCE });

        expectSends(teams, { attempted: 1, delivered: 1 });
        const reply: string = theDeliveredText(teams);
        expect(reply).toBe((refusal as NotAuthorizedException).message);
        expect(
          reply.startsWith(
            "You do not have permission to create a scheduled maintenance event.",
          ),
        ).toBe(true);
        expect(maintenanceChoicesSpy).not.toHaveBeenCalled();
        expect(errorLogSpy).not.toHaveBeenCalled();
      });

      test.each([
        Permission.ScheduledMaintenanceMember,
        Permission.CreateProjectScheduledMaintenance,
      ])(
        "a member with %s gets the form",
        async (permission: Permission): Promise<void> => {
          memberPropsSpy.mockResolvedValue(memberWith([permission]));

          const teams: FakeTeams = await runCommand({ profile: MAINTENANCE });

          expectSends(teams, { attempted: 1, delivered: 1 });
          expect(theDeliveredCard(teams)).toEqual(
            expectedForm(MAINTENANCE, {
              size: "small",
              budgetInBytes: FIRST_BUDGET,
              createInOneUptimeUrl: CREATE_MAINTENANCE_LINK,
            }),
          );
          expect(assertCanCreateSpy).toHaveBeenCalledTimes(1);
        },
      );
    });
  });

  test("a project with no monitors or labels still gets the form: nothing on it is required from them", async (): Promise<void> => {
    giveChoices(MAINTENANCE, "listless");

    const teams: FakeTeams = await runCommand({ profile: MAINTENANCE });

    expectSends(teams, { attempted: 1, delivered: 1 });
    const card: JSONObject = theDeliveredCard(teams);
    expect(inputOf(card, "scheduledMaintenanceMonitors")).toBeUndefined();
    expect(inputOf(card, "startDate")).toBeDefined();
    expect(inputOf(card, "endTime")).toBeDefined();
    expect(card).toEqual(
      expectedForm(MAINTENANCE, {
        size: "listless",
        budgetInBytes: FIRST_BUDGET,
        createInOneUptimeUrl: CREATE_MAINTENANCE_LINK,
      }),
    );
  });

  describe("the sender's time zone", (): void => {
    const KOLKATA_CLIENT_INFO: JSONObject = {
      type: "clientInfo",
      locale: "en-IN",
      country: "IN",
      platform: "Web",
      timezone: "Asia/Kolkata",
    };

    const GENERIC_ZONE_NOTE: string =
      "Start and end times are in the time zone Microsoft Teams reports for you, or in UTC if it does not report one.";

    test("the server really is in Asia/Tokyo here, so its zone cannot pass for the sender's", (): void => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
        "Asia/Tokyo",
      );
      expect(new Date("2026-09-29T00:00:00.000Z").getTimezoneOffset()).toBe(
        -540,
      );
    });

    test.each([
      {
        name: "localTimezone",
        fields: { localTimezone: "America/New_York" },
        zone: "America/New_York",
      },
      {
        name: "the clientInfo entity, when localTimezone is missing",
        fields: { entities: [KOLKATA_CLIENT_INFO] },
        zone: "Asia/Kolkata",
      },
      {
        name: "localTimezone, over the clientInfo entity",
        fields: {
          localTimezone: "Europe/Berlin",
          entities: [KOLKATA_CLIENT_INFO],
        },
        zone: "Europe/Berlin",
      },
    ])(
      "the zone from $name is named on the form and travels with its submit",
      async (row: {
        name: string;
        fields: JSONObject;
        zone: string;
      }): Promise<void> => {
        const teams: FakeTeams = await runCommand({
          profile: MAINTENANCE,
          activity: messageActivity(MAINTENANCE, row.fields),
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        const card: JSONObject = theDeliveredCard(teams);
        expect(bodyOf(card)).toContainEqual(
          MicrosoftTeamsCardChoices.buildNoteElement(
            `Start and end times are in ${row.zone}.`,
          ),
        );
        /*
         * The zone is named, not called "your time zone": in a channel,
         * whoever fills the form in may be somewhere else.
         */
        expect(JSON.stringify(card)).not.toContain("your time zone");
        expect(submitDataOf(card)).toEqual({
          action:
            MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
          timezone: row.zone,
        });
        expect(maintenanceCardSpy.mock.calls[0]![0].timezone).toBe(row.zone);
        expect(card).toEqual(
          expectedForm(MAINTENANCE, {
            size: "small",
            budgetInBytes: FIRST_BUDGET,
            createInOneUptimeUrl: CREATE_MAINTENANCE_LINK,
            timezone: row.zone,
          }),
        );
      },
    );

    test.each([
      { name: "no zone at all", fields: {} },
      {
        name: "a zone name nobody knows",
        fields: { localTimezone: "Mars/Olympus_Mons" },
      },
      { name: "a zone that is not a name", fields: { localTimezone: 330 } },
      {
        /*
         * iOS has been seen to leave localTimezone out. An offset is not a
         * zone (it knows nothing of daylight saving time), so the form does
         * not name one; the submit reads the times at the offset its own
         * activity carries instead.
         */
        name: "only the UTC offset of the local timestamp",
        fields: {
          localTimestamp: "2026-09-29T14:30:00.000+05:30",
          rawLocalTimestamp: "2026-09-29T14:30:00.000+05:30",
        },
      },
    ])(
      "$name: the form says which zone applies, carries none, and never the server's",
      async (row: { name: string; fields: JSONObject }): Promise<void> => {
        const teams: FakeTeams = await runCommand({
          profile: MAINTENANCE,
          activity: messageActivity(MAINTENANCE, row.fields),
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        const card: JSONObject = theDeliveredCard(teams);
        expect(textsOf(card)).toContain(GENERIC_ZONE_NOTE);
        expect(submitDataOf(card)).toEqual({
          action:
            MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
        });
        expect(JSON.stringify(card)).not.toContain("Asia/Tokyo");
        expect(card).toEqual(
          expectedForm(MAINTENANCE, {
            size: "small",
            budgetInBytes: FIRST_BUDGET,
            createInOneUptimeUrl: CREATE_MAINTENANCE_LINK,
          }),
        );
      },
    );

    test("the smaller card sent after a 413 still names and carries the zone", async (): Promise<void> => {
      giveChoices(MAINTENANCE, "big");

      const teams: FakeTeams = await runCommand({
        profile: MAINTENANCE,
        activity: messageActivity(MAINTENANCE, {
          localTimezone: "America/Los_Angeles",
        }),
        answer: refuseCards({ refusal: messageSizeTooBig, times: 1 }),
      });

      expectSends(teams, { attempted: 2, delivered: 1 });
      const card: JSONObject = theDeliveredCard(teams);
      expect(sizeOf(card)).toBeLessThanOrEqual(SECOND_BUDGET);
      expect(bodyOf(card)).toContainEqual(
        MicrosoftTeamsCardChoices.buildNoteElement(
          "Start and end times are in America/Los_Angeles.",
        ),
      );
      expect(submitDataOf(card)["timezone"]).toBe("America/Los_Angeles");
      expect(attemptedCards(teams)).toEqual(
        [FIRST_BUDGET, SECOND_BUDGET].map(
          (budgetInBytes: number): JSONObject => {
            return expectedForm(MAINTENANCE, {
              size: "big",
              budgetInBytes: budgetInBytes,
              createInOneUptimeUrl: CREATE_MAINTENANCE_LINK,
              timezone: "America/Los_Angeles",
            });
          },
        ),
      );
    });

    test.each(SHARED_CONVERSATIONS)(
      "in a $name, the form names the zone of whoever asked for it, for everyone who may fill it in, and carries it to the submit",
      async (conversation: SharedConversation): Promise<void> => {
        const teams: FakeTeams = await runCommand({
          profile: MAINTENANCE,
          activity: sharedConversationMessage(MAINTENANCE, conversation, {
            localTimezone: "America/New_York",
          }),
        });

        expectSends(teams, { attempted: 1, delivered: 1 });
        const card: JSONObject = theDeliveredCard(teams);
        /*
         * Whoever fills the form in types the times in the zone it names, and
         * the submit reads them in the zone its data carries before the
         * submitter's own (MicrosoftTeamsTimezone.resolve).
         */
        expect(bodyOf(card)).toContainEqual(
          MicrosoftTeamsCardChoices.buildNoteElement(
            "Start and end times are in America/New_York.",
          ),
        );
        expect(JSON.stringify(card)).not.toContain("your time zone");
        expect(submitDataOf(card)).toEqual({
          action:
            MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
          timezone: "America/New_York",
        });
        expect(card).toEqual(
          expectedForm(MAINTENANCE, {
            size: "small",
            budgetInBytes: FIRST_BUDGET,
            createInOneUptimeUrl: CREATE_MAINTENANCE_LINK,
            timezone: "America/New_York",
          }),
        );
      },
    );
  });
});

describe("getFormNotAcceptedMessage", (): void => {
  test.each([
    {
      name: "the connector's RestError (413 MessageSizeTooBig)",
      error: messageSizeTooBig(),
    },
    {
      name: "MessageSizeTooBig only in the Teams error body",
      error: Object.assign(new Error("Message size too large."), {
        details: {
          error: {
            code: "MessageSizeTooBig",
            message: "Message size too large.",
          },
        },
      }),
    },
    {
      name: "MessageSizeTooBig only as the error's code",
      error: Object.assign(new Error("Message size too large."), {
        code: "MessageSizeTooBig",
      }),
    },
    {
      name: "a bare 413 from a proxy in front of the connector",
      error: Object.assign(new Error("Request Entity Too Large"), {
        response: { status: 413 },
      }),
    },
    { name: "a plain object with statusCode 413", error: { statusCode: 413 } },
  ])(
    "$name: Teams refused it as too large, even without the lists",
    (row: { name: string; error: unknown }): void => {
      expect(
        MicrosoftTeamsCreateCommands.getFormNotAcceptedMessage({
          form: INCIDENT.form,
          error: row.error,
          createInOneUptimeUrl: CREATE_INCIDENT_LINK,
        }),
      ).toBe(
        `Sorry, I couldn't open the form to create an incident: Microsoft Teams refused it as too large, even without the lists of monitors, labels and on-call policies. You can create it in OneUptime instead: ${CREATE_INCIDENT_LINK}`,
      );
    },
  );

  test("too large, for the maintenance form: names that form's own lists", (): void => {
    expect(
      MicrosoftTeamsCreateCommands.getFormNotAcceptedMessage({
        form: MAINTENANCE.form,
        error: messageSizeTooBig(),
        createInOneUptimeUrl: CREATE_MAINTENANCE_LINK,
      }),
    ).toBe(MAINTENANCE.replies.tooLarge);
  });

  test("too large, with no dashboard URL known: ends without a link", (): void => {
    expect(
      MicrosoftTeamsCreateCommands.getFormNotAcceptedMessage({
        form: INCIDENT.form,
        error: messageSizeTooBig(),
        createInOneUptimeUrl: null,
      }),
    ).toBe(INCIDENT.replies.tooLargeWithoutLink);
  });

  test.each([
    {
      name: "403 BotNotInConversationRoster",
      error: botNotInConversationRoster(),
      reason: "(403 BotNotInConversationRoster)",
    },
    {
      name: "a status code alone (a proxy's 502 without a Teams body)",
      error: teamsRefusal({ statusCode: 502, message: "Bad Gateway" }),
      reason: "(502)",
    },
    {
      name: "status and code only on response and details",
      error: Object.assign(new Error("Service Unavailable"), {
        response: { status: 503 },
        details: {
          error: { code: "ServiceUnavailable", message: "Try again later." },
        },
      }),
      reason: "(503 ServiceUnavailable)",
    },
    {
      name: "a network error's code alone",
      error: connectionReset(),
      reason: "(ECONNRESET)",
    },
    {
      name: "a blank code",
      error: Object.assign(new Error("Something odd"), { code: "" }),
      reason: null,
    },
    {
      name: "an Error with neither status nor code",
      error: new Error("socket hang up"),
      reason: null,
    },
    { name: "a thrown string", error: "boom", reason: null },
    { name: "undefined", error: undefined, reason: null },
    { name: "null", error: null, reason: null },
  ])(
    "$name: Teams did not accept it, with the status and code it gave",
    (row: { name: string; error: unknown; reason: string | null }): void => {
      const expectedEnd: string = `You can create it in OneUptime instead: ${CREATE_INCIDENT_LINK}`;
      const message: string =
        MicrosoftTeamsCreateCommands.getFormNotAcceptedMessage({
          form: INCIDENT.form,
          error: row.error,
          createInOneUptimeUrl: CREATE_INCIDENT_LINK,
        });

      expect(message).toBe(
        row.reason
          ? `Sorry, I couldn't open the form to create an incident: Microsoft Teams did not accept it ${row.reason}. ${expectedEnd}`
          : `Sorry, I couldn't open the form to create an incident: Microsoft Teams did not accept it. ${expectedEnd}`,
      );
      // The error's own text is for the log, not the user.
      expect(message).not.toContain("socket hang up");
      expect(message).not.toContain("roster.");
      expect(message).not.toContain("Try again later.");
    },
  );

  test("not accepted, for the maintenance form, with no dashboard URL known: ends without a link", (): void => {
    expect(
      MicrosoftTeamsCreateCommands.getFormNotAcceptedMessage({
        form: MAINTENANCE.form,
        error: botNotInConversationRoster(),
        createInOneUptimeUrl: null,
      }),
    ).toBe(
      "Sorry, I couldn't open the form to create a scheduled maintenance event: Microsoft Teams did not accept it (403 BotNotInConversationRoster). You can create it in OneUptime instead.",
    );
  });
});
