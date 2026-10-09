/*
 * Pins MicrosoftTeamsReplies: how the Microsoft Teams bot answers, and the
 * rule it answers by - an inbound message gets one answer, and an answer that
 * cannot be sent never turns into a second one.
 *
 * Issue #4111: in Teams, "create incident" and "create maintenance" answered
 * "Sorry, I encountered an error processing your request. Please try again
 * later.", and every such bubble showed up twice, while "show scheduled
 * maintenance" worked. The two forms listed every monitor, label and on-call
 * policy of the project, so Teams refused them with HTTP 413
 * MessageSizeTooBig ("Message size too large."). And the bot replied with the
 * error and then rethrew it: the adapter answered Teams with HTTP 500, Teams
 * delivered the same message again, and the error was posted a second time.
 *
 * Covered here:
 * - sendBestEffort / deleteBestEffort: a reply, or the removal of a submitted
 *   form, is tried once and waited for; a failure is logged and swallowed,
 *   never retried and never followed by another bubble.
 * - sendCardWithinSizeLimit: the form goes out at 40 KiB, and only a "too
 *   large" refusal moves on to 20 KiB and then to a card without the lists; a
 *   card identical to the one just refused (at whichever budget) is not sent
 *   again; any other error, including one building a smaller card, and the
 *   last "too large" reach the caller; each refusal is logged as a warning
 *   naming that card's size and budget.
 * - describeError: the one line the log gets for an error: a Bot Framework
 *   error with its status and Teams' code, and a OneUptime exception by its
 *   class (they all keep Error's name, so the class comes from the
 *   constructor).
 * - logFailure: that line after a summary of what failed, then the error
 *   itself, which keeps its stack and class - except for a Bot Framework HTTP
 *   error, whose status and code say it all.
 * - getUserFacingErrorMessage: which errors are worded for the user, and the
 *   fixed reply for a submit that references a record the project does not
 *   have: the reference check's own message names the other project's
 *   record, which is not for the chat.
 * - getDashboardLink / getAccountNotLinkedMessage: the links the bot hands
 *   out (never changing the dashboard URL they start from), and what the bot
 *   says when the dashboard URL is not known.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Activity, TurnContext } from "botbuilder";
import fs from "fs";
import type { Mock, SpyInstance } from "jest-mock";
import path from "path";
import vm from "vm";
import type DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import type DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReferenceException,
} from "../../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../../../../../Server/Utils/Logger";
import { MicrosoftTeamsAccountNotLinkedException } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
  MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ServerException from "../../../../../Types/Exception/ServerException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const USER_SETTINGS_ROUTE: string =
  "/user-settings/microsoft-teams-integration";

/*
 * A submit that references another project's severity (a tampered submit), or
 * one deleted since the form was sent, and what the reference check says
 * about each: the same words, echoing the id sent - never the record's name.
 */
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);
const OTHER_PROJECT_SEVERITY_ID: string =
  "cfc2f04f-79cb-4344-8c54-dafe5e3a290c";
const OTHER_PROJECT_SEVERITY_NAME: string = "Sev 1 - Acme Corp";
const DELETED_SEVERITY_ID: string = "9c0ba0b3-2f8e-4c02-a8d5-6a4d2f5b9c11";
const OTHER_PROJECT_REFERENCE_MESSAGE: string = `This incident references records that are not in this project: Incident Severity "${OTHER_PROJECT_SEVERITY_ID}". Please pick values from this project and try again.`;
const DELETED_REFERENCE_MESSAGE: string = `This incident references records that are not in this project: Incident Severity "${DELETED_SEVERITY_ID}". Please pick values from this project and try again.`;

const FIRST_BUDGET_IN_BYTES: number = 40 * 1024;
const SECOND_BUDGET_IN_BYTES: number = 20 * 1024;
const LAST_BUDGET_IN_BYTES: number = 0;

type SendActivity = (reply: string | Partial<Activity>) => Promise<unknown>;
type DeleteActivity = (activityId: string) => Promise<void>;
type BuildCard = (budgetInBytes: number) => JSONObject;

interface FakeTurn {
  turnContext: TurnContext;
  sendActivity: Mock<SendActivity>;
  deleteActivity: Mock<DeleteActivity>;
}

interface CardAttachment {
  contentType: string;
  content: JSONObject;
}

interface CardActivity {
  attachments: Array<CardAttachment>;
}

interface RestErrorOptions {
  message: string;
  statusCode?: number | undefined;
  code?: string | undefined;
  responseStatus?: number | undefined;
}

// Teams' answer to a call, held back until the test lets it through.
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolvePromise: () => void = (): void => {
    return undefined;
  };
  const promise: Promise<void> = new Promise<void>(
    (resolve: () => void): void => {
      resolvePromise = resolve;
    },
  );

  return {
    promise: promise,
    resolve: (): void => {
      resolvePromise();
    },
  };
}

// Lets every promise that can settle now settle (real timers throughout).
async function waitForPendingWork(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

// A conversation in which Teams accepts every reply and every removal.
function buildFakeTurn(): FakeTurn {
  const sendActivity: Mock<SendActivity> = jest.fn<SendActivity>(
    async (): Promise<unknown> => {
      return { id: "reply-activity-id" };
    },
  );
  const deleteActivity: Mock<DeleteActivity> = jest.fn<DeleteActivity>(
    async (): Promise<void> => {
      return undefined;
    },
  );

  return {
    turnContext: {
      activity: { id: "inbound-activity-id", type: "message" },
      sendActivity: sendActivity,
      deleteActivity: deleteActivity,
    } as unknown as TurnContext,
    sendActivity: sendActivity,
    deleteActivity: deleteActivity,
  };
}

/*
 * What the Bot Framework connector throws (@azure/core-rest-pipeline's
 * RestError): an Error named "RestError" with code and statusCode of its own,
 * the parsed error body as details, and the response as a NON-enumerable
 * property.
 */
function buildRestError(options: RestErrorOptions): Error {
  const error: Error = new Error(options.message);
  error.name = "RestError";

  Object.assign(error, {
    code: options.code,
    statusCode: options.statusCode,
  });

  if (options.code) {
    Object.assign(error, {
      details: { error: { code: options.code, message: options.message } },
    });
  }

  Object.defineProperty(error, "response", {
    value:
      options.responseStatus === undefined
        ? undefined
        : { status: options.responseStatus },
    enumerable: false,
  });

  return error;
}

// Teams refusing a bot message as too large, as the connector reports it.
function buildMessageTooLargeError(): Error {
  return buildRestError({
    message: "Message size too large.",
    statusCode: 413,
    code: "MessageSizeTooBig",
    responseStatus: 413,
  });
}

// Teams refusing a reply because the bot is no longer in the conversation.
function buildNotInRosterError(): Error {
  return buildRestError({
    message: "The bot is not part of the conversation roster.",
    statusCode: 403,
    code: "BotNotInConversationRoster",
    responseStatus: 403,
  });
}

// A card that says which budget it was built for, so sends can be told apart.
function buildCardForBudget(budgetInBytes: number): JSONObject {
  return {
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: `Built for a budget of ${budgetInBytes} bytes`,
      },
    ],
  };
}

function mockBuildCard(build: BuildCard): Mock<BuildCard> {
  return jest.fn<BuildCard>(build);
}

function getBudgetsBuiltFor(buildCard: Mock<BuildCard>): Array<number> {
  return buildCard.mock.calls.map((call: Parameters<BuildCard>): number => {
    return call[0];
  });
}

function getSentActivities(fake: FakeTurn): Array<CardActivity> {
  return fake.sendActivity.mock.calls.map(
    (call: Parameters<SendActivity>): CardActivity => {
      return call[0] as unknown as CardActivity;
    },
  );
}

function getSentCards(fake: FakeTurn): Array<JSONObject> {
  return getSentActivities(fake).map((activity: CardActivity): JSONObject => {
    const attachment: CardAttachment | undefined = activity.attachments[0];

    if (!attachment) {
      throw new Error("A card activity was sent without an attachment.");
    }

    return attachment.content;
  });
}

/*
 * Teams as it behaved in #4111: a message over its limit is refused with
 * HTTP 413 MessageSizeTooBig, anything smaller is posted.
 */
function refuseMessagesOver(fake: FakeTurn, limitInBytes: number): void {
  fake.sendActivity.mockImplementation(
    async (reply: string | Partial<Activity>): Promise<unknown> => {
      const sizeInBytes: number = MicrosoftTeamsMessageSize.getSizeInBytes(
        typeof reply === "string" ? reply : (reply as unknown as JSONObject),
      );

      if (sizeInBytes > limitInBytes) {
        throw buildMessageTooLargeError();
      }

      return { id: "reply-activity-id" };
    },
  );
}

/*
 * A "create incident" form for a project with `monitorCount` monitors: as
 * many monitor choices as the budget holds, and none at a budget of 0.
 */
function buildMonitorFormBuilder(monitorCount: number): BuildCard {
  return (budgetInBytes: number): JSONObject => {
    const choices: Array<JSONObject> = [];
    const card: JSONObject = {
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        { type: "TextBlock", text: "Create a new incident", weight: "Bolder" },
        {
          type: "Input.Text",
          id: "incidentTitle",
          label: "Title",
          isRequired: true,
        },
        {
          type: "Input.ChoiceSet",
          id: "incidentMonitors",
          label: "Monitors",
          isMultiSelect: true,
          choices: choices,
        },
      ],
      actions: [{ type: "Action.Submit", title: "Create incident" }],
    };

    let sizeInBytes: number = MicrosoftTeamsMessageSize.getSizeInBytes(card);

    for (let index: number = 0; index < monitorCount; index++) {
      const choice: JSONObject = {
        title: `Monitor ${index}`,
        value: `monitor-${index}`,
      };
      // One more choice costs its JSON, plus a comma after the first.
      const costInBytes: number =
        MicrosoftTeamsMessageSize.getSizeInBytes(choice) +
        (choices.length > 0 ? 2 : 0);

      if (sizeInBytes + costInBytes > budgetInBytes) {
        break;
      }

      choices.push(choice);
      sizeInBytes += costInBytes;
    }

    return card;
  };
}

function getMonitorChoiceCount(card: JSONObject): number {
  const body: Array<JSONObject> = card["body"] as Array<JSONObject>;
  const choiceSet: JSONObject | undefined = body.find(
    (element: JSONObject): boolean => {
      return element["id"] === "incidentMonitors";
    },
  );

  return ((choiceSet?.["choices"] as Array<JSONObject> | undefined) || [])
    .length;
}

function getLoggedMessages(
  spy: SpyInstance<typeof logger.error>,
): Array<string> {
  return spy.mock.calls.map((call: Parameters<typeof logger.error>): string => {
    return String(call[0]);
  });
}

let errorLogSpy: SpyInstance<typeof logger.error>;
let warnLogSpy: SpyInstance<typeof logger.warn>;
let debugLogSpy: SpyInstance<typeof logger.debug>;

beforeEach((): void => {
  errorLogSpy = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  warnLogSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  debugLogSpy = jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsReplies.sendBestEffort", () => {
  test("sends a text reply once and returns true", async () => {
    const fake: FakeTurn = buildFakeTurn();

    const sent: boolean = await MicrosoftTeamsReplies.sendBestEffort(
      fake.turnContext,
      "✅ Incident created successfully!",
    );

    expect(sent).toBe(true);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(fake.sendActivity).toHaveBeenCalledWith(
      "✅ Incident created successfully!",
    );
    expect(errorLogSpy).not.toHaveBeenCalled();
  });

  test("sends an activity, such as an invoke response, as it is", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const invokeResponse: Partial<Activity> = {
      type: "invokeResponse",
      value: { status: 200 },
    };

    const sent: boolean = await MicrosoftTeamsReplies.sendBestEffort(
      fake.turnContext,
      invokeResponse,
    );

    expect(sent).toBe(true);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(fake.sendActivity.mock.calls[0]?.[0]).toBe(invokeResponse);
  });

  test("returns false and logs one error line when Teams refuses the reply, instead of throwing", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockRejectedValue(buildNotInRosterError());

    await expect(
      MicrosoftTeamsReplies.sendBestEffort(
        fake.turnContext,
        "Sorry, something went wrong in OneUptime while handling that message.",
      ),
    ).resolves.toBe(false);

    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(getLoggedMessages(errorLogSpy)).toEqual([
      "Could not send a Microsoft Teams reply: RestError 403 BotNotInConversationRoster: The bot is not part of the conversation roster.",
    ]);
  });

  test("tries a refused reply once: no retry, so no second bubble (#4111)", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockRejectedValue(buildMessageTooLargeError());

    const sent: boolean = await MicrosoftTeamsReplies.sendBestEffort(
      fake.turnContext,
      "x".repeat(60 * 1024),
    );

    expect(sent).toBe(false);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(getLoggedMessages(errorLogSpy)).toEqual([
      "Could not send a Microsoft Teams reply: RestError 413 MessageSizeTooBig: Message size too large.",
    ]);
  });

  test("swallows a rejection that carries no Error at all", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockRejectedValueOnce("socket closed");
    fake.sendActivity.mockRejectedValueOnce(undefined);

    await expect(
      MicrosoftTeamsReplies.sendBestEffort(fake.turnContext, "first"),
    ).resolves.toBe(false);
    await expect(
      MicrosoftTeamsReplies.sendBestEffort(fake.turnContext, "second"),
    ).resolves.toBe(false);

    // One try per reply.
    expect(fake.sendActivity).toHaveBeenCalledTimes(2);
    expect(getLoggedMessages(errorLogSpy)).toEqual([
      "Could not send a Microsoft Teams reply: socket closed",
      "Could not send a Microsoft Teams reply: undefined",
    ]);
  });

  test("swallows a sendActivity that throws before returning a promise", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockImplementation((): Promise<unknown> => {
      throw new Error("The turn context has been revoked.");
    });

    await expect(
      MicrosoftTeamsReplies.sendBestEffort(fake.turnContext, "hello"),
    ).resolves.toBe(false);

    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(getLoggedMessages(errorLogSpy)).toEqual([
      "Could not send a Microsoft Teams reply: Error: The turn context has been revoked.",
    ]);
  });

  test("resolves only once Teams has taken the reply, so a caller's next step comes after it", async () => {
    /*
     * The create handlers send the confirmation and only then remove the
     * submitted form; that order holds only if this waits for Teams.
     */
    const fake: FakeTurn = buildFakeTurn();
    const teamsAnswer: Deferred = createDeferred();
    fake.sendActivity.mockImplementation(async (): Promise<unknown> => {
      await teamsAnswer.promise;
      return { id: "reply-activity-id" };
    });
    let settled: boolean = false;

    const sending: Promise<boolean> = MicrosoftTeamsReplies.sendBestEffort(
      fake.turnContext,
      "✅ Incident created successfully!",
    ).then((sent: boolean): boolean => {
      settled = true;
      return sent;
    });

    await waitForPendingWork();
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    teamsAnswer.resolve();
    await expect(sending).resolves.toBe(true);
    expect(settled).toBe(true);
  });
});

describe("MicrosoftTeamsReplies.deleteBestEffort", () => {
  test("removes the activity with the given id", async () => {
    const fake: FakeTurn = buildFakeTurn();

    await expect(
      MicrosoftTeamsReplies.deleteBestEffort(
        fake.turnContext,
        "submitted-form-activity-id",
      ),
    ).resolves.toBeUndefined();

    expect(fake.deleteActivity).toHaveBeenCalledTimes(1);
    expect(fake.deleteActivity).toHaveBeenCalledWith(
      "submitted-form-activity-id",
    );
  });

  test("does nothing without an id to remove", async () => {
    const fake: FakeTurn = buildFakeTurn();

    await MicrosoftTeamsReplies.deleteBestEffort(fake.turnContext, undefined);
    await MicrosoftTeamsReplies.deleteBestEffort(fake.turnContext, "");

    expect(fake.deleteActivity).not.toHaveBeenCalled();
    expect(fake.sendActivity).not.toHaveBeenCalled();
    expect(debugLogSpy).not.toHaveBeenCalled();
  });

  test("swallows a failed removal and logs it at debug only: the record already exists", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.deleteActivity.mockRejectedValue(
      buildRestError({
        message: "The bot may not delete this message.",
        statusCode: 403,
        code: "Forbidden",
        responseStatus: 403,
      }),
    );

    await expect(
      MicrosoftTeamsReplies.deleteBestEffort(
        fake.turnContext,
        "submitted-form-activity-id",
      ),
    ).resolves.toBeUndefined();

    expect(fake.deleteActivity).toHaveBeenCalledTimes(1);
    expect(getLoggedMessages(debugLogSpy)).toEqual([
      "Could not remove a submitted Microsoft Teams card: RestError 403 Forbidden: The bot may not delete this message.",
    ]);
    // No error line, and no bubble contradicting the success reply.
    expect(errorLogSpy).not.toHaveBeenCalled();
    expect(fake.sendActivity).not.toHaveBeenCalled();
  });

  test("swallows a deleteActivity that throws before returning a promise", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.deleteActivity.mockImplementation((): Promise<void> => {
      throw new Error("The turn context has been revoked.");
    });

    await expect(
      MicrosoftTeamsReplies.deleteBestEffort(fake.turnContext, "activity-id"),
    ).resolves.toBeUndefined();

    expect(getLoggedMessages(debugLogSpy)).toEqual([
      "Could not remove a submitted Microsoft Teams card: Error: The turn context has been revoked.",
    ]);
    expect(errorLogSpy).not.toHaveBeenCalled();
    expect(fake.sendActivity).not.toHaveBeenCalled();
  });

  test("resolves only once Teams has answered the removal, so the turn does not end before it", async () => {
    /*
     * Bot Framework revokes the turn context as soon as the turn ends
     * (BotAdapter.runMiddleware), so a removal still under way then can fail
     * and leave the submitted form behind.
     */
    const fake: FakeTurn = buildFakeTurn();
    const teamsAnswer: Deferred = createDeferred();
    fake.deleteActivity.mockImplementation(async (): Promise<void> => {
      await teamsAnswer.promise;
    });
    let settled: boolean = false;

    const removing: Promise<void> = MicrosoftTeamsReplies.deleteBestEffort(
      fake.turnContext,
      "submitted-form-activity-id",
    ).then((): void => {
      settled = true;
    });

    await waitForPendingWork();
    expect(fake.deleteActivity).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    teamsAnswer.resolve();
    await removing;
    expect(settled).toBe(true);
  });
});

describe("MicrosoftTeamsReplies.sendCardWithinSizeLimit", () => {
  test("the attachment content type is the adaptive card media type", () => {
    expect(MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE).toBe(
      "application/vnd.microsoft.card.adaptive",
    );
  });

  test("sends the card built for the first budget, as an adaptive card attachment, when Teams accepts it", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).resolves.toBeUndefined();

    expect(getBudgetsBuiltFor(buildCard)).toEqual([FIRST_BUDGET_IN_BYTES]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(fake.sendActivity.mock.calls[0]?.[0]).toStrictEqual({
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: buildCardForBudget(FIRST_BUDGET_IN_BYTES),
        },
      ],
    });
    // The card goes out as built: the very object buildCard returned.
    expect(getSentCards(fake)[0]).toBe(buildCard.mock.results[0]?.value);
    expect(warnLogSpy).not.toHaveBeenCalled();
    expect(errorLogSpy).not.toHaveBeenCalled();
  });

  test("after a 413, builds the card again for the next, smaller budget and sends that", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockRejectedValueOnce(buildMessageTooLargeError());
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).resolves.toBeUndefined();

    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
    ]);
    expect(getSentCards(fake)).toEqual([
      buildCardForBudget(FIRST_BUDGET_IN_BYTES),
      buildCardForBudget(SECOND_BUDGET_IN_BYTES),
    ]);
    for (const activity of getSentActivities(fake)) {
      expect(activity.attachments).toHaveLength(1);
      expect(activity.attachments[0]?.contentType).toBe(
        MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
      );
    }
  });

  test("tries 40 KiB, then 20 KiB, then the card without lists, while Teams keeps refusing", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity
      .mockRejectedValueOnce(buildMessageTooLargeError())
      .mockRejectedValueOnce(buildMessageTooLargeError());
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await MicrosoftTeamsReplies.sendCardWithinSizeLimit({
      turnContext: fake.turnContext,
      buildCard: buildCard,
    });

    expect(MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
      LAST_BUDGET_IN_BYTES,
    ]);
    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
      LAST_BUDGET_IN_BYTES,
    ]);
    expect(getSentCards(fake)).toEqual([
      buildCardForBudget(FIRST_BUDGET_IN_BYTES),
      buildCardForBudget(SECOND_BUDGET_IN_BYTES),
      buildCardForBudget(LAST_BUDGET_IN_BYTES),
    ]);
  });

  test("does not send again a card identical to the one just refused, even when built as a new object", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockRejectedValueOnce(buildMessageTooLargeError());
    /*
     * A small project: its whole form fits in 20 KiB already, so the 20 KiB
     * build is the same card as the 40 KiB one. Only the card without lists
     * differs.
     */
    const buildCard: Mock<BuildCard> = mockBuildCard(
      (budgetInBytes: number): JSONObject => {
        return buildCardForBudget(
          budgetInBytes === LAST_BUDGET_IN_BYTES
            ? LAST_BUDGET_IN_BYTES
            : FIRST_BUDGET_IN_BYTES,
        );
      },
    );

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).resolves.toBeUndefined();

    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
      LAST_BUDGET_IN_BYTES,
    ]);
    expect(getSentCards(fake)).toEqual([
      buildCardForBudget(FIRST_BUDGET_IN_BYTES),
      buildCardForBudget(LAST_BUDGET_IN_BYTES),
    ]);
    expect(warnLogSpy).toHaveBeenCalledTimes(1);
  });

  test("does not send the card without lists when it is the 20 KiB card just refused, and throws that refusal", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const refusedAtFirstBudget: Error = buildMessageTooLargeError();
    const refusedAtSecondBudget: Error = buildMessageTooLargeError();
    fake.sendActivity
      .mockRejectedValueOnce(refusedAtFirstBudget)
      .mockRejectedValueOnce(refusedAtSecondBudget);
    /*
     * A form whose fixed part alone is over 20 KiB: at 20 KiB every list is
     * already left off, so the card for the last budget is the 20 KiB card
     * again, while the 40 KiB card still had its lists. The comparison is with
     * the card just refused, not only with the first one.
     */
    const buildCard: Mock<BuildCard> = mockBuildCard(
      (budgetInBytes: number): JSONObject => {
        return buildCardForBudget(
          budgetInBytes === FIRST_BUDGET_IN_BYTES
            ? FIRST_BUDGET_IN_BYTES
            : LAST_BUDGET_IN_BYTES,
        );
      },
    );

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).rejects.toBe(refusedAtSecondBudget);

    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
      LAST_BUDGET_IN_BYTES,
    ]);
    expect(getSentCards(fake)).toEqual([
      buildCardForBudget(FIRST_BUDGET_IN_BYTES),
      buildCardForBudget(LAST_BUDGET_IN_BYTES),
    ]);
    expect(warnLogSpy).toHaveBeenCalledTimes(2);
  });

  test("sends a card once when every budget builds the same card, and throws Teams' refusal", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const refusal: Error = buildMessageTooLargeError();
    fake.sendActivity.mockRejectedValue(refusal);
    const buildCard: Mock<BuildCard> = mockBuildCard((): JSONObject => {
      return buildCardForBudget(FIRST_BUDGET_IN_BYTES);
    });

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).rejects.toBe(refusal);

    expect(buildCard).toHaveBeenCalledTimes(3);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
  });

  test("throws the last refusal when Teams refuses the card at every budget", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const refusals: Array<Error> = [
      buildMessageTooLargeError(),
      buildMessageTooLargeError(),
      buildMessageTooLargeError(),
    ];
    for (const refusal of refusals) {
      fake.sendActivity.mockRejectedValueOnce(refusal);
    }

    const sending: Promise<void> =
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: mockBuildCard(buildCardForBudget),
      });

    await expect(sending).rejects.toBe(refusals[2]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(3);
    expect(warnLogSpy).toHaveBeenCalledTimes(3);
  });

  test("throws any other refusal at once, without trying a smaller budget", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const notInRoster: Error = buildNotInRosterError();
    fake.sendActivity.mockRejectedValue(notInRoster);
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).rejects.toBe(notInRoster);

    expect(getBudgetsBuiltFor(buildCard)).toEqual([FIRST_BUDGET_IN_BYTES]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
    expect(warnLogSpy).not.toHaveBeenCalled();
  });

  test("throws an error that follows a 413 at once, leaving the last budget untried", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const serverError: Error = buildRestError({
      message: "Internal server error.",
      statusCode: 500,
      code: "InternalServerError",
      responseStatus: 500,
    });
    fake.sendActivity
      .mockRejectedValueOnce(buildMessageTooLargeError())
      .mockRejectedValueOnce(serverError);
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).rejects.toBe(serverError);

    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
    ]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(2);
  });

  test("throws an error from building the card as it is, and sends nothing", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const buildError: BadDataException = new BadDataException(
      "Could not build the form.",
    );

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: (): JSONObject => {
          throw buildError;
        },
      }),
    ).rejects.toBe(buildError);

    expect(fake.sendActivity).not.toHaveBeenCalled();
  });

  test("throws an error from building a smaller card as it is, not the 413 before it", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockRejectedValueOnce(buildMessageTooLargeError());
    const buildError: BadDataException = new BadDataException(
      "Could not build the form.",
    );
    const buildCard: Mock<BuildCard> = mockBuildCard(
      (budgetInBytes: number): JSONObject => {
        if (budgetInBytes === FIRST_BUDGET_IN_BYTES) {
          return buildCardForBudget(budgetInBytes);
        }

        throw buildError;
      },
    );

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).rejects.toBe(buildError);

    // The last budget is not tried: only a "too large" refusal moves on.
    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
    ]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
  });

  test("recognises a refusal by its fields: a proxy's bare 413 moves on as well", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity.mockRejectedValueOnce({ response: { status: 413 } });
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).resolves.toBeUndefined();

    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      FIRST_BUDGET_IN_BYTES,
      SECOND_BUDGET_IN_BYTES,
    ]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(2);
    expect(warnLogSpy).toHaveBeenCalledTimes(1);
  });

  test("honours custom budgets, in the order given", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const refusal: Error = buildMessageTooLargeError();
    fake.sendActivity.mockRejectedValue(refusal);
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
        budgetsInBytes: [5000, 1000],
      }),
    ).rejects.toBe(refusal);

    expect(getBudgetsBuiltFor(buildCard)).toEqual([5000, 1000]);
    expect(getSentCards(fake)).toEqual([
      buildCardForBudget(5000),
      buildCardForBudget(1000),
    ]);
  });

  test("a single custom budget is tried once", async () => {
    const fake: FakeTurn = buildFakeTurn();
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await MicrosoftTeamsReplies.sendCardWithinSizeLimit({
      turnContext: fake.turnContext,
      buildCard: buildCard,
      budgetsInBytes: [LAST_BUDGET_IN_BYTES],
    });

    expect(getBudgetsBuiltFor(buildCard)).toEqual([LAST_BUDGET_IN_BYTES]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(1);
  });

  test("an explicit undefined budget list means the default budgets", async () => {
    const fake: FakeTurn = buildFakeTurn();
    fake.sendActivity
      .mockRejectedValueOnce(buildMessageTooLargeError())
      .mockRejectedValueOnce(buildMessageTooLargeError());
    const buildCard: Mock<BuildCard> = mockBuildCard(buildCardForBudget);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
        budgetsInBytes: undefined,
      }),
    ).resolves.toBeUndefined();

    expect(getBudgetsBuiltFor(buildCard)).toEqual([
      ...MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES,
    ]);
    expect(fake.sendActivity).toHaveBeenCalledTimes(3);
  });

  test("logs each 413 as a warning naming that card's size and budget, and logs no error itself", async () => {
    const fake: FakeTurn = buildFakeTurn();
    refuseMessagesOver(fake, 8 * 1024);
    const buildCard: Mock<BuildCard> = mockBuildCard(
      buildMonitorFormBuilder(3000),
    );

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildCard,
      }),
    ).resolves.toBeUndefined();

    const sentSizesInBytes: Array<number> = getSentCards(fake).map(
      (card: JSONObject): number => {
        return MicrosoftTeamsMessageSize.getSizeInBytes(card);
      },
    );
    expect(sentSizesInBytes).toHaveLength(3);
    // The two refused cards differ in size, so each line must name its own.
    expect(sentSizesInBytes[0]).toBeGreaterThan(sentSizesInBytes[1] as number);
    expect(getLoggedMessages(warnLogSpy)).toEqual([
      `Microsoft Teams refused a ${sentSizesInBytes[0]} byte card as too large (budget ${FIRST_BUDGET_IN_BYTES} bytes); trying a smaller one.`,
      `Microsoft Teams refused a ${sentSizesInBytes[1]} byte card as too large (budget ${SECOND_BUDGET_IN_BYTES} bytes); trying a smaller one.`,
    ]);
    // The caller decides what to tell the user, and logs the final failure.
    expect(errorLogSpy).not.toHaveBeenCalled();
  });

  test("#4111: a form Teams refuses at 40 KiB is sent again at 20 KiB, and that one is accepted", async () => {
    const fake: FakeTurn = buildFakeTurn();
    /*
     * Teams refused bot messages well under its documented limit; 30 KiB
     * stands in for that here.
     */
    refuseMessagesOver(fake, 30 * 1024);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildMonitorFormBuilder(3000),
      }),
    ).resolves.toBeUndefined();

    const sentCards: Array<JSONObject> = getSentCards(fake);
    expect(sentCards).toHaveLength(2);

    const refused: JSONObject = sentCards[0] as JSONObject;
    const accepted: JSONObject = sentCards[1] as JSONObject;
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(refused)).toBeGreaterThan(
      30 * 1024,
    );
    expect(
      MicrosoftTeamsMessageSize.getSizeInBytes(refused),
    ).toBeLessThanOrEqual(FIRST_BUDGET_IN_BYTES);
    expect(
      MicrosoftTeamsMessageSize.getSizeInBytes(accepted),
    ).toBeLessThanOrEqual(SECOND_BUDGET_IN_BYTES);
    expect(getMonitorChoiceCount(accepted)).toBeGreaterThan(0);
    expect(getMonitorChoiceCount(accepted)).toBeLessThan(
      getMonitorChoiceCount(refused),
    );
    expect(warnLogSpy).toHaveBeenCalledTimes(1);
    expect(errorLogSpy).not.toHaveBeenCalled();
  });

  test("#4111: when Teams refuses even 20 KiB, the form goes out without the lists", async () => {
    const fake: FakeTurn = buildFakeTurn();
    refuseMessagesOver(fake, 8 * 1024);

    await expect(
      MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: fake.turnContext,
        buildCard: buildMonitorFormBuilder(3000),
      }),
    ).resolves.toBeUndefined();

    const sentCards: Array<JSONObject> = getSentCards(fake);
    expect(sentCards).toHaveLength(3);
    expect(getMonitorChoiceCount(sentCards[2] as JSONObject)).toBe(0);
    expect(warnLogSpy).toHaveBeenCalledTimes(2);
  });
});

interface DescribeErrorCase {
  description: string;
  error: unknown;
  expected: string;
}

// An Error subclass that leaves Error's name as it is, as OneUptime's do.
class FormBuildError extends Error {}

const DESCRIBE_ERROR_CASES: Array<DescribeErrorCase> = [
  {
    description: "the connector's RestError for a message that is too large",
    error: buildMessageTooLargeError(),
    expected: "RestError 413 MessageSizeTooBig: Message size too large.",
  },
  {
    description: "the same RestError as a plain object",
    error: {
      name: "RestError",
      message: "Message size too large.",
      statusCode: 413,
      code: "MessageSizeTooBig",
      details: {
        error: {
          code: "MessageSizeTooBig",
          message: "Message size too large.",
        },
      },
    },
    expected: "RestError 413 MessageSizeTooBig: Message size too large.",
  },
  {
    description: "the same RestError created in another JavaScript realm",
    error: vm.runInNewContext(`
      const error = new Error("Message size too large.");
      error.name = "RestError";
      error.code = "MessageSizeTooBig";
      error.statusCode = 413;
      error;
    `),
    expected: "RestError 413 MessageSizeTooBig: Message size too large.",
  },
  {
    description: "a RestError whose status is only in response.status",
    error: buildRestError({ message: "Forbidden", responseStatus: 403 }),
    expected: "RestError 403: Forbidden",
  },
  {
    description: "a RestError whose code is only in details.error.code",
    error: {
      name: "RestError",
      message: "Message size too large.",
      details: { error: { code: "MessageSizeTooBig" } },
    },
    expected: "RestError MessageSizeTooBig: Message size too large.",
  },
  {
    description: "a RestError that removed the bot from the roster",
    error: buildNotInRosterError(),
    expected:
      "RestError 403 BotNotInConversationRoster: The bot is not part of the conversation roster.",
  },
  {
    description: "a plain Error",
    error: new Error("Something went wrong."),
    expected: "Error: Something went wrong.",
  },
  {
    description: "a TypeError",
    error: new TypeError("card.body is not iterable"),
    expected: "TypeError: card.body is not iterable",
  },
  {
    description: "a Node system error, with its code",
    error: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    expected: "Error ECONNRESET: socket hang up",
  },
  {
    /*
     * OneUptime's exceptions keep Error's name, so the class comes from the
     * constructor; their numeric code is no HTTP status or Teams code.
     */
    description: "a OneUptime exception, by its class and without its code",
    error: new BadDataException("Title is required."),
    expected: "BadDataException: Title is required.",
  },
  {
    description: "a permission refusal, by its class",
    error: new NotAuthorizedException(
      "You do not have permission to create scheduled maintenance events.",
    ),
    expected:
      "NotAuthorizedException: You do not have permission to create scheduled maintenance events.",
  },
  {
    description: "a server exception, by its class",
    error: new ServerException("Database connection lost."),
    expected: "ServerException: Database connection lost.",
  },
  {
    description:
      "a Teams account nobody linked, by its own class rather than BadDataException",
    error: new MicrosoftTeamsAccountNotLinkedException(
      "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
    ),
    expected:
      "MicrosoftTeamsAccountNotLinkedException: No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
  },
  {
    // The log is for operators: it may name the other project's record.
    description: "a reference to another project's record, by its class",
    error: new ProjectScopedReferenceException(OTHER_PROJECT_REFERENCE_MESSAGE),
    expected: `ProjectScopedReferenceException: ${OTHER_PROJECT_REFERENCE_MESSAGE}`,
  },
  {
    description: "any Error subclass that keeps Error's name, by its class",
    error: new FormBuildError("card.body is not iterable"),
    expected: "FormBuildError: card.body is not iterable",
  },
  {
    description: "an error whose own name is not Error, by that name",
    error: Object.assign(new BadDataException("Title is required."), {
      name: "ValidationError",
    }),
    expected: "ValidationError: Title is required.",
  },
  {
    description: "an error of a class with no name, as Error",
    error: new (class extends Error {})("card.body is not iterable"),
    expected: "Error: card.body is not iterable",
  },
  {
    description: "a plain Error from another JavaScript realm, as Error",
    error: vm.runInNewContext(`new Error("Something went wrong.");`),
    expected: "Error: Something went wrong.",
  },
  {
    description: "an object with neither a name nor a message",
    error: {},
    expected: "Error: ",
  },
  {
    description: "an object with only a message, as Error rather than Object",
    error: { message: "Something went wrong." },
    expected: "Error: Something went wrong.",
  },
  {
    description:
      "an object from another JavaScript realm, as Error rather than Object",
    error: vm.runInNewContext(`({ message: "Something went wrong." })`),
    expected: "Error: Something went wrong.",
  },
  {
    description: "an object without a prototype, as Error",
    error: Object.assign(Object.create(null) as Record<string, unknown>, {
      message: "Something went wrong.",
    }),
    expected: "Error: Something went wrong.",
  },
  {
    description: "an object with only a status and a code",
    error: { statusCode: 413, code: "MessageSizeTooBig" },
    expected: "Error 413 MessageSizeTooBig: ",
  },
  {
    description: "an empty name, read as Error",
    error: { name: "", message: "Something went wrong." },
    expected: "Error: Something went wrong.",
  },
  {
    description: "a message that is not a string",
    error: { name: "RestError", message: 42 },
    expected: "RestError: 42",
  },
  {
    description: "a null message",
    error: { name: "RestError", message: null, statusCode: 502 },
    expected: "RestError 502: ",
  },
  {
    description: "a string",
    error: "Teams is unavailable",
    expected: "Teams is unavailable",
  },
  { description: "null", error: null, expected: "null" },
  { description: "undefined", error: undefined, expected: "undefined" },
  { description: "a number", error: 413, expected: "413" },
  { description: "false", error: false, expected: "false" },
];

describe("MicrosoftTeamsReplies.describeError", () => {
  for (const describeErrorCase of DESCRIBE_ERROR_CASES) {
    test(`describes ${describeErrorCase.description}`, () => {
      expect(MicrosoftTeamsReplies.describeError(describeErrorCase.error)).toBe(
        describeErrorCase.expected,
      );
    });
  }
});

// What the create submit logs when an incident could not be created.
const LOG_FAILURE_SUMMARY: string =
  "Could not create an incident from Microsoft Teams";
const LOG_FAILURE_ATTRIBUTES: LogAttributes = {
  projectId: PROJECT_ID.toString(),
};

interface LogFailureCase {
  description: string;
  error: unknown;
  // The first line after the summary: describeError's line.
  described: string;
  // Whether the error itself is logged next, for its stack and class.
  logsTheErrorItself: boolean;
}

const LOG_FAILURE_CASES: Array<LogFailureCase> = [
  {
    description: "a validation failure (BadDataException)",
    error: new BadDataException("Incident title is required."),
    described: "BadDataException: Incident title is required.",
    logsTheErrorItself: true,
  },
  {
    description: "a Teams account nobody linked",
    error: new MicrosoftTeamsAccountNotLinkedException(
      "No OneUptime user linked to this Microsoft Teams user.",
    ),
    described:
      "MicrosoftTeamsAccountNotLinkedException: No OneUptime user linked to this Microsoft Teams user.",
    logsTheErrorItself: true,
  },
  {
    description: "a reference to another project's record",
    error: new ProjectScopedReferenceException(OTHER_PROJECT_REFERENCE_MESSAGE),
    described: `ProjectScopedReferenceException: ${OTHER_PROJECT_REFERENCE_MESSAGE}`,
    logsTheErrorItself: true,
  },
  {
    description: "a TypeError from a bug",
    error: new TypeError("Cannot read properties of undefined (reading 'id')"),
    described: "TypeError: Cannot read properties of undefined (reading 'id')",
    logsTheErrorItself: true,
  },
  {
    description: "a Node system error, whose code is no HTTP status",
    error: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    described: "Error ECONNRESET: socket hang up",
    logsTheErrorItself: true,
  },
  {
    description:
      "a Bot Framework request that never reached Teams, so has no status",
    error: buildRestError({
      message: "getaddrinfo ENOTFOUND smba.trafficmanager.net",
      code: "REQUEST_SEND_ERROR",
    }),
    described:
      "RestError REQUEST_SEND_ERROR: getaddrinfo ENOTFOUND smba.trafficmanager.net",
    logsTheErrorItself: true,
  },
  {
    description: "a thrown string",
    error: "socket closed",
    described: "socket closed",
    logsTheErrorItself: true,
  },
  {
    description: "a rejection with nothing in it",
    error: undefined,
    described: "undefined",
    logsTheErrorItself: true,
  },
  {
    description: "Teams refusing a message as too large (413)",
    error: buildMessageTooLargeError(),
    described: "RestError 413 MessageSizeTooBig: Message size too large.",
    logsTheErrorItself: false,
  },
  {
    description: "Teams refusing a reply in a conversation the bot left (403)",
    error: buildNotInRosterError(),
    described:
      "RestError 403 BotNotInConversationRoster: The bot is not part of the conversation roster.",
    logsTheErrorItself: false,
  },
  {
    description:
      "a RestError whose status is only in its non-enumerable response",
    error: buildRestError({
      message: "Service Unavailable",
      responseStatus: 503,
    }),
    described: "RestError 503: Service Unavailable",
    logsTheErrorItself: false,
  },
  {
    description: "a proxy's bare 413",
    error: { response: { status: 413 } },
    described: "Error 413: ",
    logsTheErrorItself: false,
  },
];

/*
 * The error log's calls, copied into arrays of this realm: jest records them
 * in arrays of its own, which toStrictEqual tells apart from these.
 */
function getErrorLogCalls(): Array<Array<unknown>> {
  return Array.from(
    errorLogSpy.mock.calls,
    (call: Parameters<typeof logger.error>): Array<unknown> => {
      return Array.from(call);
    },
  );
}

// A failure is logged at error level only: nothing at warn or debug.
function expectNothingLoggedBelowError(): void {
  expect(warnLogSpy).not.toHaveBeenCalled();
  expect(debugLogSpy).not.toHaveBeenCalled();
}

describe("MicrosoftTeamsReplies.logFailure", () => {
  for (const logFailureCase of LOG_FAILURE_CASES) {
    test(`${
      logFailureCase.logsTheErrorItself
        ? "logs the line, then the error itself, for"
        : "logs the line alone for"
    } ${logFailureCase.description}`, () => {
      MicrosoftTeamsReplies.logFailure(
        LOG_FAILURE_SUMMARY,
        logFailureCase.error,
        LOG_FAILURE_ATTRIBUTES,
      );

      const line: [string, LogAttributes] = [
        `${LOG_FAILURE_SUMMARY}: ${logFailureCase.described}`,
        LOG_FAILURE_ATTRIBUTES,
      ];

      expect(getErrorLogCalls()).toStrictEqual(
        logFailureCase.logsTheErrorItself
          ? [line, [logFailureCase.error, LOG_FAILURE_ATTRIBUTES]]
          : [line],
      );

      // The same attributes on each line, and the error as it was thrown.
      for (const call of getErrorLogCalls()) {
        expect(call[1]).toBe(LOG_FAILURE_ATTRIBUTES);
      }
      expect(getErrorLogCalls()[1]?.[0]).toBe(
        logFailureCase.logsTheErrorItself ? logFailureCase.error : undefined,
      );
      expectNothingLoggedBelowError();
    });
  }

  test("passes no attributes on when given none, and returns nothing", () => {
    const error: Error = new Error("Something went wrong.");

    expect(
      MicrosoftTeamsReplies.logFailure(
        "Microsoft Teams message activity activity-1 failed",
        error,
      ),
    ).toBeUndefined();

    expect(
      getErrorLogCalls().map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toStrictEqual([
      "Microsoft Teams message activity activity-1 failed: Error: Something went wrong.",
      error,
    ]);
    expect(
      getErrorLogCalls().map((call: Array<unknown>): unknown => {
        return call[1];
      }),
    ).toStrictEqual([undefined, undefined]);
  });
});

interface UserFacingCase {
  description: string;
  error: unknown;
  expected: string | null;
}

const USER_FACING_CASES: Array<UserFacingCase> = [
  {
    description: "a validation failure (BadDataException)",
    error: new BadDataException("Incident title is required."),
    expected: "Incident title is required.",
  },
  {
    description: "a permission refusal (NotAuthorizedException)",
    error: new NotAuthorizedException(
      "You do not have permission to create scheduled maintenance events.",
    ),
    expected:
      "You do not have permission to create scheduled maintenance events.",
  },
  {
    /*
     * What a card action made with the member's own props is refused with
     * when the project's plan does not include it - theirs to read.
     */
    description: "a plan the project is not on (PaymentRequiredException)",
    error: new PaymentRequiredException(
      "Please upgrade your plan to use this feature.",
    ),
    expected: "Please upgrade your plan to use this feature.",
  },
  {
    description: "a PaymentRequiredException with an empty message",
    error: new PaymentRequiredException(""),
    expected: null,
  },
  {
    description:
      "a Teams account nobody linked (a BadDataException of its own type)",
    error: new MicrosoftTeamsAccountNotLinkedException(
      "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
    ),
    expected:
      "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
  },
  {
    description:
      "a reference to another project's record, whose message names that record",
    error: new ProjectScopedReferenceException(OTHER_PROJECT_REFERENCE_MESSAGE),
    expected: MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE,
  },
  {
    description:
      "a reference to a record deleted since the form was sent, whose message echoes its id",
    error: new ProjectScopedReferenceException(DELETED_REFERENCE_MESSAGE),
    expected: MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE,
  },
  {
    description: "a reference check with an empty message",
    error: new ProjectScopedReferenceException(""),
    expected: MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE,
  },
  {
    /*
     * The fixed text goes by the reference check's own type, not by the
     * words: only that check writes these, and it throws its own type.
     */
    description:
      "any other BadDataException, even one worded like the reference check",
    error: new BadDataException(OTHER_PROJECT_REFERENCE_MESSAGE),
    expected: OTHER_PROJECT_REFERENCE_MESSAGE,
  },
  {
    description: "a plain Error, whose text is for operators",
    error: new Error("connect ECONNREFUSED 10.0.0.5:5432"),
    expected: null,
  },
  {
    description: "a server exception",
    error: new ServerException("Database connection lost."),
    expected: null,
  },
  {
    description: "a Bot Framework RestError",
    error: buildMessageTooLargeError(),
    expected: null,
  },
  {
    description: "a plain object with a message",
    error: { message: "Incident title is required." },
    expected: null,
  },
  {
    description: "a plain object that only claims to be a BadDataException",
    error: { name: "BadDataException", message: "Incident title is required." },
    expected: null,
  },
  {
    description: "a BadDataException with an empty message",
    error: new BadDataException(""),
    expected: null,
  },
  {
    description: "a NotAuthorizedException with an empty message",
    error: new NotAuthorizedException(""),
    expected: null,
  },
  {
    description: "a string",
    error: "Incident title is required.",
    expected: null,
  },
  { description: "null", error: null, expected: null },
  { description: "undefined", error: undefined, expected: null },
];

function describeUserFacingAnswer(expected: string | null): string {
  if (expected === null) {
    return "is null for";
  }

  if (expected === MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE) {
    return "answers the fixed text for";
  }

  return "shows the message of";
}

describe("MicrosoftTeamsReplies.getUserFacingErrorMessage", () => {
  for (const userFacingCase of USER_FACING_CASES) {
    test(`${describeUserFacingAnswer(userFacingCase.expected)} ${userFacingCase.description}`, () => {
      expect(
        MicrosoftTeamsReplies.getUserFacingErrorMessage(userFacingCase.error),
      ).toBe(userFacingCase.expected);
    });
  }
});

/*
 * Just what the reference check calls on a service: the model, for its tenant
 * and name columns, and findBy, which answers with the records given.
 */
function buildSeverityLookup(
  found: Array<IncidentSeverity>,
): DatabaseService<DatabaseBaseModel> {
  return {
    getModel: (): IncidentSeverity => {
      return new IncidentSeverity();
    },
    findBy: async (): Promise<Array<IncidentSeverity>> => {
      return found;
    },
  } as unknown as DatabaseService<DatabaseBaseModel>;
}

// What the reference check throws for an incident with this severity.
async function catchReferenceCheckError(data: {
  severityId: string;
  found: Array<IncidentSeverity>;
}): Promise<unknown> {
  try {
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: PROJECT_ID,
      subject: "incident",
      references: [
        {
          modelName: "Incident Severity",
          id: data.severityId,
          service: buildSeverityLookup(data.found),
        },
      ],
    });
  } catch (error) {
    return error;
  }

  throw new Error("The reference check accepted the severity.");
}

describe("MicrosoftTeamsReplies: a submit that references a record the project does not have", () => {
  test("is answered with fixed text that names no record", () => {
    expect(MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE).toBe(
      "One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.",
    );
  });

  test("never names another project's record, in the reply or in the reference check's message", async () => {
    const otherProjectSeverity: IncidentSeverity = new IncidentSeverity();
    otherProjectSeverity._id = OTHER_PROJECT_SEVERITY_ID;
    otherProjectSeverity.name = OTHER_PROJECT_SEVERITY_NAME;
    otherProjectSeverity.projectId = OTHER_PROJECT_ID;

    const error: unknown = await catchReferenceCheckError({
      severityId: OTHER_PROJECT_SEVERITY_ID,
      found: [otherProjectSeverity],
    });

    /*
     * The check's own type, and a BadDataException with the check's message,
     * which echoes the id and never the other project's record.
     */
    expect(error).toBeInstanceOf(ProjectScopedReferenceException);
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(OTHER_PROJECT_REFERENCE_MESSAGE);
    expect((error as Error).message).not.toContain(OTHER_PROJECT_SEVERITY_NAME);

    const reply: string | null =
      MicrosoftTeamsReplies.getUserFacingErrorMessage(error);

    expect(reply).toBe(MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE);
    expect(reply).not.toContain(OTHER_PROJECT_SEVERITY_NAME);
    expect(reply).not.toContain(OTHER_PROJECT_SEVERITY_ID);

    // The log, which is for operators, still says which id it was.
    expect(MicrosoftTeamsReplies.describeError(error)).toBe(
      `ProjectScopedReferenceException: ${OTHER_PROJECT_REFERENCE_MESSAGE}`,
    );
  });

  test("does not echo the id of a record that no longer exists", async () => {
    const error: unknown = await catchReferenceCheckError({
      severityId: DELETED_SEVERITY_ID,
      found: [],
    });

    expect(error).toBeInstanceOf(ProjectScopedReferenceException);
    expect((error as Error).message).toBe(DELETED_REFERENCE_MESSAGE);

    const reply: string | null =
      MicrosoftTeamsReplies.getUserFacingErrorMessage(error);

    expect(reply).toBe(MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE);
    expect(reply).not.toContain(DELETED_SEVERITY_ID);
  });
});

function stubDashboardUrl(
  dashboardUrl: string,
): SpyInstance<typeof DatabaseConfig.getDashboardUrl> {
  return jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(dashboardUrl));
}

function stubDashboardUrlUnavailable(
  error: Error,
): SpyInstance<typeof DatabaseConfig.getDashboardUrl> {
  return jest.spyOn(DatabaseConfig, "getDashboardUrl").mockRejectedValue(error);
}

describe("MicrosoftTeamsReplies.getDashboardLink", () => {
  test("builds <dashboard>/<projectId><route>", async () => {
    const getDashboardUrlSpy: SpyInstance<
      typeof DatabaseConfig.getDashboardUrl
    > = stubDashboardUrl(DASHBOARD_URL);

    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/incidents/create",
      }),
    ).resolves.toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/incidents/create`,
    );
    expect(getDashboardUrlSpy).toHaveBeenCalledTimes(1);
  });

  test("links below the project for any route, such as the maintenance form", async () => {
    stubDashboardUrl(DASHBOARD_URL);

    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/scheduled-maintenance-events/create",
      }),
    ).resolves.toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/create`,
    );
  });

  test("does not double the slash when the dashboard URL ends with one", async () => {
    stubDashboardUrl(`${DASHBOARD_URL}/`);

    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/incidents/create",
      }),
    ).resolves.toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/incidents/create`,
    );
  });

  test("keeps a self-hosted dashboard's protocol and port", async () => {
    stubDashboardUrl("http://oneuptime.internal:8080/dashboard");

    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/incidents/create",
      }),
    ).resolves.toBe(
      `http://oneuptime.internal:8080/dashboard/${PROJECT_ID.toString()}/incidents/create`,
    );
  });

  test("leaves the dashboard URL it is handed as it was, so one link never carries another's route", async () => {
    /*
     * URL.addRoute changes the URL it is called on. The link is built on a
     * copy, so a URL object handed out more than once stays the dashboard's.
     */
    const dashboardUrl: URL = URL.fromString(DASHBOARD_URL);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(dashboardUrl);

    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/incidents/create",
      }),
    ).resolves.toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/incidents/create`,
    );
    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/scheduled-maintenance-events/create",
      }),
    ).resolves.toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/create`,
    );
    expect(dashboardUrl.toString()).toBe(DASHBOARD_URL);
  });

  test("is null when the dashboard URL cannot be read, and says so at debug level only", async () => {
    const lookupError: Error = new Error("HOST is not configured.");
    stubDashboardUrlUnavailable(lookupError);

    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/incidents/create",
      }),
    ).resolves.toBeNull();

    expect(debugLogSpy).toHaveBeenCalledWith(
      "Could not build a OneUptime dashboard link",
    );
    expect(debugLogSpy).toHaveBeenCalledWith(lookupError);
    expect(errorLogSpy).not.toHaveBeenCalled();
  });

  test("is null when looking the dashboard URL up throws before returning a promise", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockImplementation((): Promise<URL> => {
        throw new Error("HOST is not configured.");
      });

    await expect(
      MicrosoftTeamsReplies.getDashboardLink({
        projectId: PROJECT_ID,
        route: "/incidents/create",
      }),
    ).resolves.toBeNull();
  });

  describe("with the dashboard URL OneUptime is configured with", () => {
    const originalHost: string | undefined = process.env["HOST"];
    const originalProtocol: string | undefined = process.env["HTTP_PROTOCOL"];

    afterEach((): void => {
      if (originalHost === undefined) {
        delete process.env["HOST"];
      } else {
        process.env["HOST"] = originalHost;
      }

      if (originalProtocol === undefined) {
        delete process.env["HTTP_PROTOCOL"];
      } else {
        process.env["HTTP_PROTOCOL"] = originalProtocol;
      }
    });

    test("links into /dashboard on the configured host and protocol", async () => {
      process.env["HOST"] = "status.example.com";
      process.env["HTTP_PROTOCOL"] = "https";

      await expect(
        MicrosoftTeamsReplies.getDashboardLink({
          projectId: PROJECT_ID,
          route: "/incidents/create",
        }),
      ).resolves.toBe(
        `https://status.example.com/dashboard/${PROJECT_ID.toString()}/incidents/create`,
      );
    });

    test("uses http when HTTP_PROTOCOL is not https", async () => {
      process.env["HOST"] = "oneuptime.local";
      delete process.env["HTTP_PROTOCOL"];

      await expect(
        MicrosoftTeamsReplies.getDashboardLink({
          projectId: PROJECT_ID,
          route: USER_SETTINGS_ROUTE,
        }),
      ).resolves.toBe(
        `http://oneuptime.local/dashboard/${PROJECT_ID.toString()}${USER_SETTINGS_ROUTE}`,
      );
    });

    test("keeps a port given in HOST, as a self-hosted install may have", async () => {
      process.env["HOST"] = "oneuptime.internal:8080";
      process.env["HTTP_PROTOCOL"] = "http";

      await expect(
        MicrosoftTeamsReplies.getDashboardLink({
          projectId: PROJECT_ID,
          route: "/incidents/create",
        }),
      ).resolves.toBe(
        `http://oneuptime.internal:8080/dashboard/${PROJECT_ID.toString()}/incidents/create`,
      );
    });
  });
});

describe("MicrosoftTeamsReplies.getAccountNotLinkedMessage", () => {
  test("links to the user's Microsoft Teams settings in the project", async () => {
    stubDashboardUrl(DASHBOARD_URL);

    await expect(
      MicrosoftTeamsReplies.getAccountNotLinkedMessage({
        projectId: PROJECT_ID,
        purpose: "create incidents from Microsoft Teams",
      }),
    ).resolves.toBe(
      `To create incidents from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in [OneUptime → User Settings → Microsoft Teams](https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration), then try again.`,
    );
  });

  test("reads as a sentence for the AI assistant as well", async () => {
    // What "ask" answers a Teams user whose account is not connected yet.
    stubDashboardUrl(DASHBOARD_URL);

    await expect(
      MicrosoftTeamsReplies.getAccountNotLinkedMessage({
        projectId: PROJECT_ID,
        purpose: "ask OneUptime questions from Microsoft Teams",
      }),
    ).resolves.toBe(
      `To ask OneUptime questions from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in [OneUptime → User Settings → Microsoft Teams](https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration), then try again.`,
    );
  });

  test("says where to go in words when the dashboard URL is not known", async () => {
    stubDashboardUrlUnavailable(new Error("HOST is not configured."));

    const message: string =
      await MicrosoftTeamsReplies.getAccountNotLinkedMessage({
        projectId: PROJECT_ID,
        purpose: "create scheduled maintenance events from Microsoft Teams",
      });

    expect(message).toBe(
      "To create scheduled maintenance events from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in OneUptime under User Settings → Microsoft Teams, then try again.",
    );
    expect(message).not.toContain("](");
  });

  test("links to a page the dashboard really has", async () => {
    /*
     * A real cross-file check: the bot's link is only useful if the Dashboard
     * still serves /dashboard/<projectId>/user-settings/microsoft-teams-integration.
     */
    stubDashboardUrl(DASHBOARD_URL);
    const message: string =
      await MicrosoftTeamsReplies.getAccountNotLinkedMessage({
        projectId: PROJECT_ID,
        purpose: "use OneUptime from Microsoft Teams",
      });
    expect(message).toContain(
      `/dashboard/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration)`,
    );

    const routeMapSource: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "../../../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, "");

    expect(routeMapSource).toContain(
      '[PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION]:"microsoft-teams-integration"',
    );
    expect(routeMapSource).toContain(
      "`/dashboard/${RouteParams.ProjectID}/user-settings/${UserSettingsRoutePath[PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION]}`",
    );
  });
});
