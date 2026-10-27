import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceMessagePayload, {
  WorkspaceCheckboxBlock,
  WorkspaceDatePickerBlock,
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceDropdownOptionGroup,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspaceNumberInputBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadHeader,
  WorkspacePayloadImage,
  WorkspacePayloadInlineImage,
  WorkspacePayloadMarkdown,
  WorkspacePayloadMenu,
  WorkspacePayloadMenuOption,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import SlackOverflowMenu from "./SlackOverflowMenu";
import logger, { LogAttributes } from "../../Logger";
import Dictionary from "../../../../Types/Dictionary";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceChannelToCreate,
  WorkspaceMessageLocation,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import SlackifyMarkdown from "slackify-markdown";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import OneUptimeDate from "../../../../Types/Date";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import SSRFProtection from "../../SSRFProtection";
import ChatInlineImages from "../../../../Utils/Markdown/ChatInlineImages";
import WorkspaceInlineImages from "../WorkspaceInlineImages";
import WorkspaceMessageTime from "../WorkspaceMessageTime";
import SlackInlineImages from "./SlackInlineImages";
import { cutToLength } from "../../../../Utils/Markdown/OverLongText";
import {
  SLOW_MARKDOWN_MAX_INLINE_WORK,
  SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  SlowMarkdownLimits,
  holdBackSlowMarkdown,
} from "../../../../Utils/Markdown/SlowMarkdown";
import { replacePipeTables } from "../../../../Utils/Markdown/PipeTables";

// What conversations.create answers for a name a channel has already.
export const SLACK_CHANNEL_NAME_TAKEN_ERROR: string = "name_taken";

/*
 * What slackify reads a "%" that starts no escape as (see
 * getSlackifySafeMarkdown), and what encodeURI makes of it in an address.
 */
const SLACKIFY_PERCENT_STAND_IN: string = "\uE007";
const ENCODED_PERCENT_STAND_IN: string = encodeURI(SLACKIFY_PERCENT_STAND_IN);

const isHexDigit: (code: number) => boolean = (code: number): boolean => {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
};

// Markdown slackify cannot fail on, and how to put back what was changed.
export interface SlackifySafeMarkdown {
  markdown: string;
  restore: (slackText: string) => string;
}

/*
 * `markdown` with nothing slackify-markdown throws on (see
 * SlackUtil.slackify): every "%" that is not the start of an escape ("%2F")
 * becomes a stand-in, and every half of a surrogate pair standing alone
 * becomes U+FFFD. `restore` turns the stand-in back into "%" - "%25" where
 * slackify encoded the address it is in, as "%" is written in an address.
 * Markdown with none of these comes back as it is. Scanned with a loop: the
 * text can be long.
 */
export const getSlackifySafeMarkdown: (
  markdown: string,
) => SlackifySafeMarkdown = (markdown: string): SlackifySafeMarkdown => {
  const unchanged: SlackifySafeMarkdown = {
    markdown: markdown,
    restore: (slackText: string): string => {
      return slackText;
    },
  };

  let safe: string = "";
  let copiedUpTo: number = 0;
  let hasStandIn: boolean = false;

  for (let index: number = 0; index < markdown.length; index++) {
    const code: number = markdown.charCodeAt(index);
    let replacement: string | null = null;

    if (code === 0x25) {
      if (
        !isHexDigit(markdown.charCodeAt(index + 1)) ||
        !isHexDigit(markdown.charCodeAt(index + 2))
      ) {
        replacement = SLACKIFY_PERCENT_STAND_IN;
        hasStandIn = true;
      }
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next: number = markdown.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
      } else {
        replacement = "\uFFFD";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      replacement = "\uFFFD";
    }

    if (replacement !== null) {
      safe += markdown.slice(copiedUpTo, index) + replacement;
      copiedUpTo = index + 1;
    }
  }

  if (copiedUpTo === 0) {
    return unchanged;
  }

  safe += markdown.slice(copiedUpTo);

  /*
   * An address that already held the stand-in's escape would be read back
   * wrongly: leave the "%" as it was, and let slackify fail on it.
   */
  if (
    hasStandIn &&
    markdown.toUpperCase().indexOf(ENCODED_PERCENT_STAND_IN) !== -1
  ) {
    return unchanged;
  }

  return {
    markdown: safe,
    restore: (slackText: string): string => {
      if (!hasStandIn) {
        return slackText;
      }

      return slackText
        .split(ENCODED_PERCENT_STAND_IN)
        .join("%25")
        .split(SLACKIFY_PERCENT_STAND_IN)
        .join("%");
    },
  };
};

// Markdown as slackify is given it (see SlackUtil.cutMarkdown).
export interface CutMarkdown {
  text: string;
  // Whether it was cut: Slack is then told the text goes on.
  isCutShort: boolean;
}

export default class SlackUtil extends WorkspaceBase {
  /*
   * Block Kit limits. A section's text may be at most 3000 characters, a
   * message may carry at most 50 blocks and a modal view at most 100. Going
   * over any of them makes Slack reject the whole message (invalid_blocks),
   * not just the offending block.
   */
  public static readonly SECTION_TEXT_MAX_LENGTH: number = 3000;
  // The most a header block's text can be.
  public static readonly HEADER_TEXT_MAX_LENGTH: number = 150;
  public static readonly MAX_BLOCKS_PER_MESSAGE: number = 50;
  public static readonly MAX_BLOCKS_PER_MODAL: number = 100;

  /*
   * How many sections one markdown payload may expand into — about 30,000
   * characters, several times the longest incident or alert body we send.
   * The 50-block ceiling alone would allow 150,000, but Slack also rejects a
   * message whose blocks are too long overall (msg_blocks_too_long) without
   * documenting where that starts, and text that long is better read in
   * OneUptime anyway.
   */
  public static readonly MAX_SECTIONS_PER_MARKDOWN_BLOCK: number = 10;

  // Ends the last section of a markdown payload that did not fit.
  public static readonly TRUNCATED_SECTION_NOTE: string =
    "\n\n_… (truncated — see OneUptime for the full text)_";

  /*
   * The most Markdown slackify is given at once: one section more than a
   * markdown payload can show (MAX_SECTIONS_PER_MARKDOWN_BLOCK sections of
   * SECTION_TEXT_MAX_LENGTH characters). slackify takes time that grows
   * with the square of a long line, and ran out of stack on one of a few
   * megabytes - and a description can carry a response body or a log of
   * many megabytes. Text longer than this is cut first, at a line break
   * where there is one, and ends with TRUNCATED_SECTION_NOTE: Slack could
   * never show the rest.
   */
  public static readonly MARKDOWN_MAX_LENGTH: number =
    (SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK + 1) *
    SlackUtil.SECTION_TEXT_MAX_LENGTH;

  /*
   * What slackify is given at most once the Markdown is cut
   * (Utils/Markdown/SlowMarkdown): its time grew with the square of a run of
   * emphasis or brackets, of one paragraph's lines (a paragraph of 16,000
   * lines took 4 s) and length (32 KB of web addresses on one line took
   * three quarters of a second), and of the blocks of a message. So a block
   * with a paragraph or list item of more than 256 lines or 4,096
   * characters, more than 2,048 lines in all, and the content of fenced
   * code are held back and written back as text. A list of short items is
   * read in good time, however long.
   */
  public static readonly SLOW_MARKDOWN_LIMITS: SlowMarkdownLimits = {
    maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK,
    maxRunLines: Number.POSITIVE_INFINITY,
    maxLines: 2048,
    maxUnitLines: 256,
    maxUnitLength: 4096,
    maxNestingDepth: SLOW_MARKDOWN_MAX_NESTING_DEPTH,
    maxCellsPerLine: 128,
    holdBackCodeBlockContent: true,
    countUrlLiterals: true,
    countWordUnderscores: true,
  };

  // Closes and reopens a ``` code block that a section boundary cuts through.
  private static readonly CODE_FENCE: string = "```";
  private static readonly CODE_FENCE_CLOSE: string = "\n```";
  private static readonly CODE_FENCE_REOPEN: string = "```\n";

  public static isValidSlackIncomingWebhookUrl(
    incomingWebhookUrl: URL | string,
  ): boolean {
    /*
     * Host AND path prefix. The host check is what stops SSRF; the "/services/"
     * prefix is what makes this tighter than a bare domain pin. Both are read
     * off the WHATWG parser via getBareHostname, so a "#"/"?" in the string
     * cannot make an attacker host look like a Slack one.
     */
    if (
      SSRFProtection.getBareHostname(incomingWebhookUrl) !== "hooks.slack.com"
    ) {
      return false;
    }

    return incomingWebhookUrl
      .toString()
      .startsWith("https://hooks.slack.com/services/");
  }

  /*
   * A Slack user's name, and the email address Slack has for them when the
   * app may read it (the users:read.email scope; an app installed before it
   * was asked for has no email to give). Null when Slack answers nothing.
   * One try, no retries: a person waits for it.
   */
  @CaptureSpan()
  public static async getUserProfile(data: {
    authToken: string;
    userId: string;
  }): Promise<{ name: string; email: string } | null> {
    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/users.info"),
          data: {
            user: data.userId,
          },
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
        });

      if (
        response instanceof HTTPErrorResponse ||
        (response.jsonData as JSONObject)?.["ok"] !== true
      ) {
        return null;
      }

      const user: JSONObject =
        ((response.jsonData as JSONObject)["user"] as JSONObject) || {};
      const profile: JSONObject = (user["profile"] as JSONObject) || {};

      const name: string =
        [
          profile["display_name"],
          profile["real_name"],
          user["real_name"],
          user["name"],
        ]
          .map((value: unknown): string => {
            return typeof value === "string" ? value.trim() : "";
          })
          .find((value: string): boolean => {
            return value.length > 0;
          }) || "";

      const email: string =
        typeof profile["email"] === "string"
          ? (profile["email"] as string).trim()
          : "";

      return { name: name, email: email };
    } catch (err) {
      logger.debug("Slack did not tell who a user is.");
      logger.debug(err);
      return null;
    }
  }

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<string | null> {
    const usernameLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "Getting username from user ID with data:",
      usernameLogAttributes,
    );
    logger.debug(data, usernameLogAttributes);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString("https://slack.com/api/users.info"),
        data: {
          user: data.userId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for getting user info:",
      usernameLogAttributes,
    );
    logger.debug(response, usernameLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", usernameLogAttributes);
      logger.error(response, usernameLogAttributes);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", usernameLogAttributes);
      logger.error(response.jsonData, usernameLogAttributes);
      return null;
    }

    if (
      !((response.jsonData as JSONObject)?.["user"] as JSONObject)?.["name"]
    ) {
      logger.error("Invalid response from Slack API:", usernameLogAttributes);
      logger.error(response.jsonData, usernameLogAttributes);
      return null;
    }

    const username: string = (
      (response.jsonData as JSONObject)["user"] as JSONObject
    )["name"] as string;

    logger.debug("Username obtained:", usernameLogAttributes);
    logger.debug(username, usernameLogAttributes);
    return username;
  }

  @CaptureSpan()
  public static override async showModalToUser(data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    const modalLogAttributes: LogAttributes = { triggerId: data.triggerId };

    logger.debug("Showing modal to user with data:", modalLogAttributes);
    logger.debug(data, modalLogAttributes);

    const modalJson: JSONObject = this.getModalBlock({
      payloadModalBlock: data.modalBlock,
    });

    logger.debug("Modal JSON generated:", modalLogAttributes);
    logger.debug(JSON.stringify(modalJson, null, 2), modalLogAttributes);

    // use view.open API to show modal
    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: URL.fromString("https://slack.com/api/views.open"),
        data: {
          trigger_id: data.triggerId,
          view: modalJson,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      },
    );

    if (result instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", modalLogAttributes);
      logger.error(result, modalLogAttributes);
      throw result;
    }

    if ((result.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", modalLogAttributes);
      logger.error(result.jsonData, modalLogAttributes);
      const messageFromSlack: string = (result.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Modal shown to user successfully.", modalLogAttributes);
  }

  /*
   * A form shown in place of the modal `viewId` is open in: the form a
   * request opens once its person has chosen its project in that modal
   * (SlackProjectChoice), which views.open could not open over it.
   */
  @CaptureSpan()
  public static async replaceModal(data: {
    authToken: string;
    viewId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    await SlackUtil.updateView({
      authToken: data.authToken,
      viewId: data.viewId,
      view: this.getModalBlock({
        payloadModalBlock: data.modalBlock,
      }),
    });
  }

  // The most a modal's title holds.
  public static readonly MODAL_TITLE_MAX_LENGTH: number = 24;

  /*
   * A message shown in a modal that only closes: the answer to a press that
   * has no channel to answer in - a global shortcut - opened where the
   * person is. `triggerId` is the press's, good for three seconds. With
   * `viewId`, the message takes the place of the modal of that id instead:
   * one a project was chosen in (SlackProjectChoice).
   */
  @CaptureSpan()
  public static async showMessageInModal(data: {
    authToken: string;
    triggerId: string;
    title: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    viewId?: string | undefined;
  }): Promise<void> {
    const title: string =
      data.title.length > SlackUtil.MODAL_TITLE_MAX_LENGTH
        ? data.title.substring(0, SlackUtil.MODAL_TITLE_MAX_LENGTH - 1) + "…"
        : data.title;

    const view: JSONObject = {
      type: "modal",
      title: {
        type: "plain_text",
        text: title,
      },
      close: {
        type: "plain_text",
        text: "Close",
      },
      blocks: this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: data.messageBlocks,
        maxBlocks: SlackUtil.MAX_BLOCKS_PER_MODAL,
      }),
    };

    if (data.viewId) {
      return await SlackUtil.updateView({
        authToken: data.authToken,
        viewId: data.viewId,
        view: view,
      });
    }

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: URL.fromString("https://slack.com/api/views.open"),
        data: {
          trigger_id: data.triggerId,
          view: view,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 1,
          retryOnlyOnRetryableErrors: true,
        },
      },
    );

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    if ((result.jsonData as JSONObject)?.["ok"] !== true) {
      throw new BadRequestException(
        "Error from Slack " +
          String((result.jsonData as JSONObject)?.["error"] || ""),
      );
    }
  }

  /*
   * views.update: `view` in place of the open view `viewId`. Throws when
   * Slack refuses it - a view that has been closed since, say.
   */
  private static async updateView(data: {
    authToken: string;
    viewId: string;
    view: JSONObject;
  }): Promise<void> {
    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: URL.fromString("https://slack.com/api/views.update"),
        data: {
          view_id: data.viewId,
          view: data.view,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 1,
          retryOnlyOnRetryableErrors: true,
        },
      },
    );

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    if ((result.jsonData as JSONObject)?.["ok"] !== true) {
      throw new BadRequestException(
        "Error from Slack " +
          String((result.jsonData as JSONObject)?.["error"] || ""),
      );
    }
  }

  /*
   * A message only `userId` sees, in the channel - in the thread `threadTs`,
   * when given - where they are: Slack shows it under "Only visible to you".
   * `text` is what its notification shows.
   */
  @CaptureSpan()
  public static async sendEphemeralMessageToChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    threadTs?: string | undefined;
    text?: string | undefined;
  }): Promise<void> {
    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: data.messageBlocks,
      },
    );

    const requestData: JSONObject = {
      channel: data.channelId,
      user: data.userId,
      blocks: blocks,
    };

    if (data.threadTs) {
      requestData["thread_ts"] = data.threadTs;
    }

    if (data.text) {
      requestData["text"] = this.getNotificationText(data.text);
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/chat.postEphemeral"),
        data: requestData,
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API for ephemeral message:", {
        channelId: data.channelId,
      } as LogAttributes);
      logger.error(response, { channelId: data.channelId } as LogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API for ephemeral message:", {
        channelId: data.channelId,
      } as LogAttributes);
      logger.error(response.jsonData, {
        channelId: data.channelId,
      } as LogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Ephemeral message sent successfully.", {
      channelId: data.channelId,
    } as LogAttributes);
  }

  /*
   * Whether `url` is a response_url Slack hands out: https on
   * hooks.slack.com, read off the WHATWG parser (SSRFProtection), so a "#"
   * or "?" in it cannot make another host look like Slack's.
   */
  public static isSlackResponseUrl(url: string | undefined): boolean {
    if (!url) {
      return false;
    }

    return SSRFProtection.isUrlOnAllowedDomain(url, ["hooks.slack.com"]);
  }

  /*
   * Answers a press - a button, a slash command - through the response_url
   * Slack handed with it: a message only the person who pressed sees, where
   * they pressed it ("Only visible to you"), never replacing the message the
   * button is on. Works whether or not OneUptime is in that channel, for
   * thirty minutes and five answers per press. Throws when Slack refuses it
   * (an expired or used address).
   */
  @CaptureSpan()
  public static async sendEphemeralResponse(data: {
    responseUrl: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    text?: string | undefined;
  }): Promise<void> {
    if (!this.isSlackResponseUrl(data.responseUrl)) {
      throw new BadDataException("Not a Slack response URL.");
    }

    const requestData: JSONObject = {
      response_type: "ephemeral",
      replace_original: false,
      blocks: this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: data.messageBlocks,
      }),
    };

    if (data.text) {
      requestData["text"] = this.getNotificationText(data.text);
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString(data.responseUrl),
        data: requestData,
        headers: {
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 1,
          retryOnlyOnRetryableErrors: true,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    // Slack answers {"ok": false, "error": "expired_url"} for an address it no longer takes.
    const body: unknown = response.jsonData;

    if (
      body &&
      typeof body === "object" &&
      (body as JSONObject)["ok"] === false
    ) {
      throw new BadRequestException(
        "Error from Slack " + String((body as JSONObject)["error"] || ""),
      );
    }
  }

  /*
   * Puts `messageBlocks` in place of the message a button was pressed on,
   * through the press's response_url: a message only the person sees, or
   * one the app posted in their direct messages - the question of which
   * project, once a project is chosen (SlackProjectChoice). Throws when
   * Slack refuses it.
   */
  @CaptureSpan()
  public static async replaceMessageAtResponseUrl(data: {
    responseUrl: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    text?: string | undefined;
  }): Promise<void> {
    if (!this.isSlackResponseUrl(data.responseUrl)) {
      throw new BadDataException("Not a Slack response URL.");
    }

    const requestData: JSONObject = {
      replace_original: true,
      blocks: this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: data.messageBlocks,
      }),
    };

    if (data.text) {
      requestData["text"] = this.getNotificationText(data.text);
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString(data.responseUrl),
        data: requestData,
        headers: {
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 1,
          retryOnlyOnRetryableErrors: true,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const body: unknown = response.jsonData;

    if (
      body &&
      typeof body === "object" &&
      (body as JSONObject)["ok"] === false
    ) {
      throw new BadRequestException(
        "Error from Slack " + String((body as JSONObject)["error"] || ""),
      );
    }
  }

  @CaptureSpan()
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    /*
     * What the notification of the direct message says (Slack's top-level
     * `text`): a direct message notifies, so it says something readable.
     */
    text?: string | undefined;
  }): Promise<void> {
    // Send direct message to user

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: data.messageBlocks,
      },
    );

    await this.sendPayloadBlocksToChannel({
      authToken: data.authToken,
      workspaceChannel: {
        id: data.workspaceUserId,
        name: "",
        workspaceType: WorkspaceType.Slack,
      },
      blocks: blocks,
      text: data.text,
    });
  }

  @CaptureSpan()
  public static override async archiveChannels(data: {
    userId: string;
    channelIds: Array<string>;
    authToken: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
    projectId: ObjectID;
  }): Promise<void> {
    if (data.sendMessageBeforeArchiving) {
      await this.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          channelNames: [],
          channelIds: data.channelIds,
          messageBlocks: [data.sendMessageBeforeArchiving],
          workspaceType: WorkspaceType.Slack,
        },
        authToken: data.authToken,
        userId: data.userId,
        projectId: data.projectId,
      });
    }

    const archiveLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug("Archiving channels with data:", archiveLogAttributes);
    logger.debug(data, archiveLogAttributes);

    for (const channelId of data.channelIds) {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString("https://slack.com/api/conversations.archive"),
          data: {
            channel: channelId,
          },
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      logger.debug(
        "Response from Slack API for archiving channel:",
        archiveLogAttributes,
      );
      logger.debug(response, archiveLogAttributes);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:", archiveLogAttributes);
        logger.error(response, archiveLogAttributes);
        throw response;
      }

      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error("Invalid response from Slack API:", archiveLogAttributes);
        logger.error(response.jsonData, archiveLogAttributes);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }
    }

    logger.debug("Channels archived successfully.", archiveLogAttributes);
  }

  @CaptureSpan()
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    const joinLogAttributes: LogAttributes = { channelId: data.channelId };

    logger.debug("Joining channel with data:", joinLogAttributes);
    logger.debug(data, joinLogAttributes);

    // Join channel
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.join"),
        data: {
          channel: data.channelId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for joining channel:",
      joinLogAttributes,
    );
    logger.debug(response, joinLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", joinLogAttributes);
      logger.error(response, joinLogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", joinLogAttributes);
      logger.error(response.jsonData, joinLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Channel joined successfully with data:", joinLogAttributes);
    logger.debug(data, joinLogAttributes);
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    // check if already in channel.
    const isUserInChannel: boolean = await this.isUserInChannel({
      authToken: data.authToken,
      channelId: data.channelId,
      userId: data.workspaceUserId,
    });

    if (isUserInChannel) {
      logger.debug("User already in channel.", {
        channelId: data.channelId,
      } as LogAttributes);
      return;
    }

    const inviteByIdLogAttributes: LogAttributes = {
      channelId: data.channelId,
    };

    logger.debug(
      "Inviting user to channel with data:",
      inviteByIdLogAttributes,
    );
    logger.debug(data, inviteByIdLogAttributes);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.invite"),
        data: {
          channel: data.channelId,
          users: data.workspaceUserId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for inviting user:",
      inviteByIdLogAttributes,
    );
    logger.debug(response, inviteByIdLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", inviteByIdLogAttributes);
      logger.error(response, inviteByIdLogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", inviteByIdLogAttributes);
      logger.error(response.jsonData, inviteByIdLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug(
      "User invited to channel successfully.",
      inviteByIdLogAttributes,
    );
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
    projectId: ObjectID;
  }): Promise<void> {
    if (data.channelName && data.channelName.startsWith("#")) {
      // trim # from channel name
      data.channelName = data.channelName.substring(1);
    }

    logger.debug("Inviting user to channel with data:", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      projectId: data.projectId?.toString(),
    } as LogAttributes);

    const channelId: string = (
      await this.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      })
    ).id;

    return this.inviteUserToChannelByChannelId({
      authToken: data.authToken,
      channelId: channelId,
      workspaceUserId: data.workspaceUserId,
    });
  }

  @CaptureSpan()
  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceChannel>> {
    const createChLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "Creating channels if they do not exist with data:",
      createChLogAttributes,
    );
    logger.debug(data, createChLogAttributes);

    const workspaceChannels: Array<WorkspaceChannel> = [];

    for (let channelName of data.channelNames) {
      /*
       * Normalize channel name: replace spaces with hyphens, then strip
       * any characters not valid in Slack channel names.
       */
      channelName = channelName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-_]/g, "");

      // Check if channel exists using optimized method
      const existingChannel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: channelName,
          projectId: data.projectId,
        });

      if (existingChannel) {
        logger.debug(
          `Channel ${channelName} already exists.`,
          createChLogAttributes,
        );
        workspaceChannels.push(existingChannel);
        continue;
      }

      logger.debug(
        `Channel ${channelName} does not exist. Creating channel.`,
        createChLogAttributes,
      );
      const channel: WorkspaceChannel = await this.createChannel({
        authToken: data.authToken,
        channelName: channelName,
        projectId: data.projectId,
      });

      if (channel) {
        logger.debug(
          `Channel ${channelName} created successfully.`,
          createChLogAttributes,
        );
        workspaceChannels.push(channel);
      }
    }

    logger.debug("Channels created or found:", createChLogAttributes);
    logger.debug(workspaceChannels, createChLogAttributes);
    return workspaceChannels;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    const getChNameLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "Getting workspace channel ID from channel name with data:",
      getChNameLogAttributes,
    );
    logger.debug(data, getChNameLogAttributes);

    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });

    if (!channel) {
      logger.error("Channel not found.", getChNameLogAttributes);
      throw new BadDataException("Channel not found.");
    }

    logger.debug("Workspace channel obtained:", getChNameLogAttributes);
    logger.debug(channel, getChNameLogAttributes);

    return channel;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    const getChIdLogAttributes: LogAttributes = { channelId: data.channelId };

    logger.debug(
      "Getting workspace channel from channel ID with data:",
      getChIdLogAttributes,
    );
    logger.debug(data, getChIdLogAttributes);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString("https://slack.com/api/conversations.info"),
        data: {
          channel: data.channelId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for getting channel info:",
      getChIdLogAttributes,
    );
    logger.debug(response, getChIdLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", getChIdLogAttributes);
      logger.error(response, getChIdLogAttributes);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", getChIdLogAttributes);
      logger.error(response.jsonData, getChIdLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      logger.error("Invalid response from Slack API:", getChIdLogAttributes);
      logger.error(response.jsonData, getChIdLogAttributes);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
      id: data.channelId,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Workspace channel obtained:", getChIdLogAttributes);
    logger.debug(channel, getChIdLogAttributes);
    return channel;
  }

  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
    projectId: ObjectID;
  }): Promise<Dictionary<WorkspaceChannel>> {
    const getAllChLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "Getting all workspace channels with data:",
      getAllChLogAttributes,
    );
    logger.debug(data, getAllChLogAttributes);

    const channels: Dictionary<WorkspaceChannel> = {};
    let cursor: string | undefined = undefined;
    const maxPages: number = 100;
    let pageCount: number = 0;
    const localChannelCache: Dictionary<any> = {};

    do {
      const requestBody: JSONObject = {
        limit: 999,
        types: "public_channel,private_channel",
        exclude_archived: true,
      };

      if (cursor) {
        requestBody["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.list"),
          data: requestBody,
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:", getAllChLogAttributes);
        logger.error(response, getAllChLogAttributes);
        throw response;
      }

      // check for ok response
      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error("Invalid response from Slack API:", getAllChLogAttributes);
        logger.error(response.jsonData, getAllChLogAttributes);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }

      for (const channel of (response.jsonData as JSONObject)[
        "channels"
      ] as Array<JSONObject>) {
        if (!channel["id"] || !channel["name"]) {
          continue;
        }

        const channelObj: WorkspaceChannel = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
        };

        channels[channel["name"].toString()] = channelObj;

        // Add to local cache
        const normalizedName: string = channel["name"].toString().toLowerCase();
        localChannelCache[normalizedName] = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
          lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
        };
      }

      cursor = (
        (response.jsonData as JSONObject)["response_metadata"] as JSONObject
      )?.["next_cursor"] as string;
      pageCount++;
    } while (cursor && pageCount < maxPages);

    // Update cache in bulk
    try {
      await this.updateChannelsInCache({
        projectId: data.projectId,
        channelCache: localChannelCache,
      });
    } catch (error) {
      logger.error("Error bulk updating channel cache:", getAllChLogAttributes);
      logger.error(error, getAllChLogAttributes);
      // Don't fail the request if caching fails
    }

    logger.debug("All workspace channels obtained:", getAllChLogAttributes);
    return channels;
  }

  private static async updateChannelsInCache(data: {
    projectId: ObjectID;
    channelCache: Dictionary<WorkspaceChannel>;
  }): Promise<void> {
    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth) {
      logger.debug("No project auth found, cannot update cache", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      return;
    }

    const miscData: any = projectAuth.miscData || {};
    const channelCache: any = miscData.channelCache || {};

    // Update the cache
    Object.assign(channelCache, data.channelCache);

    // Update miscData
    miscData.channelCache = channelCache;

    // Save back to database
    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId: data.projectId,
      workspaceType: WorkspaceType.Slack,
      authToken: projectAuth.authToken,
      workspaceProjectId: projectAuth.workspaceProjectId,
      miscData: miscData,
    });

    logger.debug("Channel cache updated successfully", {
      projectId: data.projectId?.toString(),
    } as LogAttributes);
  }

  @CaptureSpan()
  public static async getChannelFromCache(data: {
    projectId: ObjectID;
    channelName: string;
  }): Promise<WorkspaceChannel | null> {
    const cacheGetLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "Getting channel from cache with data:",
      cacheGetLogAttributes,
    );
    logger.debug(data, cacheGetLogAttributes);

    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth || !projectAuth.miscData) {
      logger.debug(
        "No project auth found or no misc data",
        cacheGetLogAttributes,
      );
      return null;
    }

    const miscData: any = projectAuth.miscData;
    const channelCache: any = miscData.channelCache;

    if (!channelCache || !channelCache[data.channelName]) {
      logger.debug("Channel not found in cache", cacheGetLogAttributes);
      return null;
    }

    const cachedChannelData: WorkspaceChannel = channelCache[
      data.channelName
    ] as WorkspaceChannel;
    const channel: WorkspaceChannel = {
      id: cachedChannelData.id,
      name: cachedChannelData.name,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Channel found in cache:", cacheGetLogAttributes);
    logger.debug(channel, cacheGetLogAttributes);
    return channel;
  }
  @CaptureSpan()
  public static async updateChannelCache(data: {
    projectId: ObjectID;
    channelName: string;
    channel: WorkspaceChannel;
  }): Promise<void> {
    const cacheUpdateLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug("Updating channel cache with data:", cacheUpdateLogAttributes);
    logger.debug(data, cacheUpdateLogAttributes);

    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth) {
      logger.debug(
        "No project auth found, cannot update cache",
        cacheUpdateLogAttributes,
      );
      return;
    }

    const miscData: any = projectAuth.miscData || {};
    const channelCache: any = miscData.channelCache || {};

    // Update the cache
    channelCache[data.channelName] = {
      id: data.channel.id,
      name: data.channel.name,
      lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
    };

    // Update miscData
    miscData.channelCache = channelCache;

    // Save back to database
    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId: data.projectId,
      workspaceType: WorkspaceType.Slack,
      authToken: projectAuth.authToken,
      workspaceProjectId: projectAuth.workspaceProjectId,
      miscData: miscData,
    });

    logger.debug(
      "Channel cache updated successfully",
      cacheUpdateLogAttributes,
    );
  }

  @CaptureSpan()
  public static async getWorkspaceChannelByName(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel | null> {
    const getByNameLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug(
      "Getting workspace channel by name with data:",
      getByNameLogAttributes,
    );
    logger.debug(data, getByNameLogAttributes);

    // Normalize channel name
    let normalizedChannelName: string = data.channelName;
    if (normalizedChannelName && normalizedChannelName.startsWith("#")) {
      normalizedChannelName = normalizedChannelName.substring(1);
    }
    normalizedChannelName = normalizedChannelName.toLowerCase();

    // Try to get from cache first
    try {
      const cachedChannel: WorkspaceChannel | null =
        await this.getChannelFromCache({
          projectId: data.projectId,
          channelName: normalizedChannelName,
        });
      if (cachedChannel) {
        logger.debug("Channel found in cache:", getByNameLogAttributes);
        logger.debug(cachedChannel, getByNameLogAttributes);
        return cachedChannel;
      }
    } catch (error) {
      logger.error(
        "Error getting channel from cache, falling back to API:",
        getByNameLogAttributes,
      );
      logger.error(error, getByNameLogAttributes);
    }

    let cursor: string | undefined = undefined;
    const maxPages: number = 500;
    let pageCount: number = 0;
    const localChannelCache: Dictionary<any> = {};

    do {
      const requestBody: JSONObject = {
        limit: 999, // Use smaller limit for faster searches
        types: "public_channel,private_channel",
        exclude_archived: true,
      };

      if (cursor) {
        requestBody["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.list"),
          data: requestBody,
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:", getByNameLogAttributes);
        logger.error(response, getByNameLogAttributes);
        throw response;
      }

      // check for ok response
      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error(
          "Invalid response from Slack API:",
          getByNameLogAttributes,
        );
        logger.error(response.jsonData, getByNameLogAttributes);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }

      logger.debug(
        "Searching for " + normalizedChannelName,
        getByNameLogAttributes,
      );
      logger.debug(
        "Searching channels in current page...",
        getByNameLogAttributes,
      );
      logger.debug(
        JSON.stringify((response.jsonData as JSONObject)["channels"], null, 2),
        getByNameLogAttributes,
      );

      for (const channel of (response.jsonData as JSONObject)[
        "channels"
      ] as Array<JSONObject>) {
        if (!channel["id"] || !channel["name"]) {
          continue;
        }

        const channelObj: WorkspaceChannel = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
        };

        // Add to local cache
        const normalizedName: string = channel["name"].toString().toLowerCase();
        localChannelCache[normalizedName] = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
          lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
        };

        const channelName: string = (channel["name"] as string).toLowerCase();
        if (channelName === normalizedChannelName) {
          logger.debug("Channel found:", getByNameLogAttributes);
          logger.debug(channel, getByNameLogAttributes);

          // Update cache before returning
          try {
            await this.updateChannelsInCache({
              projectId: data.projectId,
              channelCache: localChannelCache,
            });
          } catch (error) {
            logger.error(
              "Error bulk updating channel cache:",
              getByNameLogAttributes,
            );
            logger.error(error, getByNameLogAttributes);
            // Don't fail the request if caching fails
          }

          return channelObj;
        }
      }

      cursor = (
        (response.jsonData as JSONObject)["response_metadata"] as JSONObject
      )?.["next_cursor"] as string;
      pageCount++;
    } while (cursor && pageCount < maxPages);

    // Update cache even if channel not found
    try {
      await this.updateChannelsInCache({
        projectId: data.projectId,
        channelCache: localChannelCache,
      });
    } catch (error) {
      logger.error(
        "Error bulk updating channel cache:",
        getByNameLogAttributes,
      );
      logger.error(error, getByNameLogAttributes);
      // Don't fail the request if caching fails
    }

    logger.debug("Channel not found:", getByNameLogAttributes);
    return null;
  }

  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    return {
      type: "divider",
    };
  }

  @CaptureSpan()
  public static getValuesFromView(data: {
    view: JSONObject;
  }): Dictionary<string | number | Array<string | number> | Date> {
    logger.debug("Getting values from view with data:", {} as LogAttributes);
    logger.debug(JSON.stringify(data, null, 2), {} as LogAttributes);

    const slackView: JSONObject = data.view;
    const values: Dictionary<string | number | Array<string | number> | Date> =
      {};

    if (!slackView["state"] || !(slackView["state"] as JSONObject)["values"]) {
      return {};
    }

    for (const valueId in (slackView["state"] as JSONObject)[
      "values"
    ] as JSONObject) {
      for (const blockId in (
        (slackView["state"] as JSONObject)["values"] as JSONObject
      )[valueId] as JSONObject) {
        const valueObject: JSONObject = (
          (slackView["state"] as JSONObject)["values"] as JSONObject
        )[valueId] as JSONObject;
        const value: JSONObject = valueObject[blockId] as JSONObject;
        values[blockId] = value["value"] as string | number;

        if ((value["selected_option"] as JSONObject)?.["value"]) {
          values[blockId] = (value["selected_option"] as JSONObject)?.[
            "value"
          ] as string;
        }

        if (Array.isArray(value["selected_options"])) {
          values[blockId] = (
            value["selected_options"] as Array<JSONObject>
          ).map((option: JSONObject) => {
            return option["value"] as string | number;
          });
        }

        // if date picker
        if (value["selected_date_time"]) {
          values[blockId] = OneUptimeDate.fromUnixTimestamp(
            value["selected_date_time"] as number,
          );
        }

        // A date picker's day, as Slack gives it: "2026-10-15".
        if (typeof value["selected_date"] === "string") {
          values[blockId] = value["selected_date"] as string;
        }
      }
    }

    logger.debug("Values obtained from view:", {} as LogAttributes);
    logger.debug(values, {} as LogAttributes);

    return values;
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<boolean> {
    // if channel name starts with #, remove it
    if (data.channelName && data.channelName.startsWith("#")) {
      data.channelName = data.channelName.substring(1);
    }

    // convert channel name to lowercase
    data.channelName = data.channelName.toLowerCase();

    // Check if channel exists using optimized method
    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });

    return channel !== null;
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
    userId: string;
    projectId: ObjectID;
  }): Promise<WorkspaceSendMessageResponse> {
    const sendMsgLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug("Sending message to Slack with data:", sendMsgLogAttributes);
    logger.debug(data, sendMsgLogAttributes);

    /*
     * A screenshot in the message's Markdown is shown as an image of its own,
     * where the Markdown had it (WorkspaceInlineImages). Until it is uploaded
     * it is its alt text, which is also what is posted when it cannot be.
     */
    const messageBlocks: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks(
        data.workspaceMessagePayload.messageBlocks,
        { repeatLinkDefinitions: true },
      );

    const blocksWithoutImages: Array<JSONObject> =
      this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: messageBlocks,
      });

    let blocks: Array<JSONObject> = blocksWithoutImages;

    logger.debug(
      "Blocks generated from workspace message payload:",
      sendMsgLogAttributes,
    );
    logger.debug(blocks, sendMsgLogAttributes);

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    // Resolve channel names efficiently
    for (let channelName of data.workspaceMessagePayload.channelNames) {
      if (channelName && channelName.startsWith("#")) {
        // trim # from channel name
        channelName = channelName.substring(1);
      }

      const channel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: channelName,
          projectId: data.projectId,
        });

      if (channel) {
        workspaceChannelsToPostTo.push(channel);
      } else {
        logger.debug(
          `Channel ${channelName} does not exist.`,
          sendMsgLogAttributes,
        );
      }
    }

    // add channel ids.
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        // Get the channel info including name from channel ID
        const channel: WorkspaceChannel =
          await this.getWorkspaceChannelFromChannelId({
            authToken: data.authToken,
            channelId: channelId,
          });

        workspaceChannelsToPostTo.push(channel);
      } catch (err) {
        logger.error(
          `Error getting channel info for channel ID ${channelId}:`,
          sendMsgLogAttributes,
        );
        logger.error(err, sendMsgLogAttributes);

        // Fallback: create channel object with empty name if API call fails
        const channel: WorkspaceChannel = {
          id: channelId,
          name: channelId,
          workspaceType: WorkspaceType.Slack,
        };

        workspaceChannelsToPostTo.push(channel);
      }
    }

    /*
     * A channel the message is not for: the one a note it repeats was
     * saved from (WorkspaceMessagePayload.exceptChannelIds) - named here
     * by its name too, so it is left out once the name is resolved.
     */
    const exceptChannelIds: Array<string> =
      data.workspaceMessagePayload.exceptChannelIds || [];

    if (exceptChannelIds.length > 0) {
      for (
        let index: number = workspaceChannelsToPostTo.length - 1;
        index >= 0;
        index--
      ) {
        if (exceptChannelIds.includes(workspaceChannelsToPostTo[index]!.id)) {
          workspaceChannelsToPostTo.splice(index, 1);
        }
      }
    }

    logger.debug("Channel IDs to post to:", sendMsgLogAttributes);
    logger.debug(workspaceChannelsToPostTo, sendMsgLogAttributes);

    const workspaspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.Slack,
      errors: [],
    };

    const inlineImages: Array<WorkspacePayloadInlineImage> =
      WorkspaceInlineImages.getInlineImages(messageBlocks);

    if (inlineImages.length > 0 && workspaceChannelsToPostTo.length > 0) {
      const uploadedImages: Map<string, string> =
        await SlackInlineImages.uploadImages({
          authToken: data.authToken,
          images: inlineImages,
        });

      if (uploadedImages.size > 0) {
        blocks = this.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: messageBlocks,
          uploadedImages: uploadedImages,
        });
      }
    }

    for (const channel of workspaceChannelsToPostTo) {
      try {
        if (data.userId) {
          // check if the user is in the channel.
          const isUserInChannel: boolean = await this.isUserInChannel({
            authToken: data.authToken,
            channelId: channel.id,
            userId: data.userId,
          });

          if (!isUserInChannel) {
            // add user to the channel
            await this.joinChannel({
              authToken: data.authToken,
              channelId: channel.id,
            });
          }
        }

        let lastThread: WorkspaceThread | undefined;

        try {
          lastThread = await this.sendBlocksToChannel({
            authToken: data.authToken,
            workspaceChannel: channel,
            blocks: blocks,
            text: data.workspaceMessagePayload.text,
          });
        } catch (error) {
          /*
           * Slack refuses the whole message when it cannot show one of its
           * image blocks (invalid_blocks). A message with an uploaded image
           * that went out in one post is posted again with each image as
           * its alt text, so the message itself is not lost.
           */
          if (
            blocks === blocksWithoutImages ||
            blocks.length > SlackUtil.MAX_BLOCKS_PER_MESSAGE ||
            !WorkspaceBase.getSendErrorMessage(error).includes("invalid_blocks")
          ) {
            throw error;
          }

          logger.warn(
            `Slack refused a message with images in channel ${channel.id}; posting it with each image as its alt text.`,
            sendMsgLogAttributes,
          );

          lastThread = await this.sendBlocksToChannel({
            authToken: data.authToken,
            workspaceChannel: channel,
            blocks: blocksWithoutImages,
            text: data.workspaceMessagePayload.text,
          });
        }

        if (lastThread) {
          workspaspaceMessageResponse.threads.push(lastThread);
        }

        logger.debug(
          `Message sent to channel ID ${channel.id} successfully.`,
          sendMsgLogAttributes,
        );
      } catch (e) {
        logger.error(
          `Error sending message to channel ID ${channel.id}:`,
          sendMsgLogAttributes,
        );
        logger.error(e, sendMsgLogAttributes);
        workspaspaceMessageResponse.errors!.push({
          channel: channel,
          error: WorkspaceBase.getSendErrorMessage(e),
        });
      }
    }

    logger.debug("Message sent successfully.", sendMsgLogAttributes);
    logger.debug(workspaspaceMessageResponse, sendMsgLogAttributes);

    return workspaspaceMessageResponse;
  }

  /*
   * Posts the blocks to the channel: in one message, or in several of at
   * most MAX_BLOCKS_PER_MESSAGE blocks each. The last one's thread.
   */
  private static async sendBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
    // What each message's notification shows (WorkspaceMessagePayload.text).
    text?: string | undefined;
  }): Promise<WorkspaceThread | undefined> {
    const maxBlocksPerMessage: number = SlackUtil.MAX_BLOCKS_PER_MESSAGE;

    if (data.blocks.length <= maxBlocksPerMessage) {
      return await this.sendPayloadBlocksToChannel(data);
    }

    let lastThread: WorkspaceThread | undefined;

    for (
      let index: number = 0;
      index < data.blocks.length;
      index += maxBlocksPerMessage
    ) {
      lastThread = await this.sendPayloadBlocksToChannel({
        authToken: data.authToken,
        workspaceChannel: data.workspaceChannel,
        blocks: data.blocks.slice(index, index + maxBlocksPerMessage),
        text: data.text,
      });
    }

    return lastThread;
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
    /*
     * Plain text: what a push notification, a message preview or a screen
     * reader shows of the blocks (Slack's top-level `text`).
     */
    text?: string | undefined;
  }): Promise<WorkspaceThread> {
    const payloadBlocksLogAttributes: LogAttributes = {
      channelId: data.workspaceChannel?.id,
    };

    logger.debug(
      "Sending payload blocks to channel with data:",
      payloadBlocksLogAttributes,
    );
    logger.debug(JSON.stringify(data, null, 2), payloadBlocksLogAttributes);

    const requestData: JSONObject = {
      channel: data.workspaceChannel.id,
      blocks: data.blocks,
      unfurl_links: false,
    };

    if (data.text) {
      requestData["text"] = this.getNotificationText(data.text);
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/chat.postMessage"),
        data: requestData,
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for sending message:",
      payloadBlocksLogAttributes,
    );
    logger.debug(response, payloadBlocksLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error(
        "Error response from Slack API:",
        payloadBlocksLogAttributes,
      );
      logger.error(response, payloadBlocksLogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error(
        "Invalid response from Slack API:",
        payloadBlocksLogAttributes,
      );
      logger.error(response.jsonData, payloadBlocksLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug(
      "Payload blocks sent to channel successfully.",
      payloadBlocksLogAttributes,
    );

    return {
      channel: data.workspaceChannel,
      threadId: (response.jsonData as JSONObject)["ts"] as string,
    };
  }

  /*
   * Edits a message the bot posted (chat.update). The blocks are built as a
   * new message's are; the message keeps its place in the channel, and an
   * edit notifies nobody. `text` is what a notification or a screen reader
   * shows of it.
   */
  @CaptureSpan()
  public static override async updateMessage(data: {
    authToken: string;
    projectId: ObjectID;
    location: WorkspaceMessageLocation;
    messageId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    text?: string | undefined;
  }): Promise<void> {
    const updateLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
      channelId: data.location.channelId,
    };

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: data.messageBlocks,
      },
    );

    const requestData: JSONObject = {
      channel: data.location.channelId,
      ts: data.messageId,
      blocks: blocks,
    };

    if (data.text) {
      requestData["text"] = this.getNotificationText(data.text);
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/chat.update"),
        data: requestData,
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      logger.error(
        "Error response from Slack API when updating a message:",
        updateLogAttributes,
      );
      logger.error(response, updateLogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;

      logger.error(
        `Slack refused to update a message: ${messageFromSlack}`,
        updateLogAttributes,
      );

      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }
  }

  /*
   * A message's top-level `text`, from the plain text it was given: what a
   * notification shows. Slack reads "&", "<" and ">" in it as it reads them
   * in a message, so they are escaped (escapeSlackText): a name such as
   * "<!channel>" in it would otherwise notify the whole channel.
   */
  public static getNotificationText(text: string): string {
    return this.escapeSlackText(text);
  }

  /*
   * Slack answers message_not_found when the message was deleted: posting a
   * new one is the only way to show what it said.
   */
  public static override isMessageGoneError(error: unknown): boolean {
    return WorkspaceBase.getSendErrorMessage(error).includes(
      "message_not_found",
    );
  }

  @CaptureSpan()
  public static async sendMessageToThread(data: {
    authToken: string;
    channelId: string;
    threadTs: string;
    text: string;
    /*
     * Leave the message's links without a preview: a short answer whose
     * link goes to OneUptime gains nothing from a card about OneUptime.
     */
    withoutLinkPreviews?: boolean | undefined;
  }): Promise<string | undefined> {
    const threadLogAttributes: LogAttributes = { channelId: data.channelId };

    logger.debug("Sending message to thread with data:", threadLogAttributes);
    logger.debug(data, threadLogAttributes);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/chat.postMessage"),
        data: {
          channel: data.channelId,
          thread_ts: data.threadTs,
          text: data.text,
          ...(data.withoutLinkPreviews
            ? { unfurl_links: false, unfurl_media: false }
            : {}),
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for sending thread message:",
      threadLogAttributes,
    );
    logger.debug(response, threadLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", threadLogAttributes);
      logger.error(response, threadLogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", threadLogAttributes);
      logger.error(response.jsonData, threadLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Thread message sent successfully.", threadLogAttributes);

    // The message's own ts: what removes or edits it.
    const ts: unknown = (response.jsonData as JSONObject)?.["ts"];

    return typeof ts === "string" && ts ? ts : undefined;
  }

  /*
   * Removes a message the app posted (chat.delete, which chat:write
   * allows): the "Looking into it…" that stood in for an answer, once the
   * answer is posted. Never throws: the answer is there either way.
   */
  @CaptureSpan()
  public static async deleteMessageBestEffort(data: {
    authToken: string;
    channelId: string;
    ts: string;
  }): Promise<boolean> {
    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString("https://slack.com/api/chat.delete"),
          data: {
            channel: data.channelId,
            ts: data.ts,
          },
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/json",
          },
        });

      if (
        response instanceof HTTPErrorResponse ||
        (response.jsonData as JSONObject)?.["ok"] !== true
      ) {
        logger.debug("Slack did not remove a message of the app's.", {
          channelId: data.channelId,
        });
        return false;
      }

      return true;
    } catch (err) {
      logger.debug("Could not remove a message of the app's.", {
        channelId: data.channelId,
      });
      logger.debug(err);
      return false;
    }
  }

  /*
   * A message as Slack hands it over - its text, blocks, files, author and
   * ts - found by its ts in its channel, or in a thread of it
   * (getMessageDetailsByTimestamp). Null when Slack has no such message.
   */
  @CaptureSpan()
  public static async getMessage(data: {
    authToken: string;
    channelId: string;
    messageTs: string;
  }): Promise<JSONObject | null> {
    return (
      (await this.findMessageByTimestamp({
        ...data,
        apiMethod: "conversations.history",
      })) ||
      (await this.findMessageByTimestamp({
        ...data,
        apiMethod: "conversations.replies",
      }))
    );
  }

  /*
   * The name Slack shows for a person - their display name, else their full
   * name, else their handle - and whether they are a bot. Null when Slack
   * does not say (an unknown user, a user of another workspace in a shared
   * channel, a refusal).
   */
  @CaptureSpan()
  public static async getUserDisplayName(data: {
    authToken: string;
    userId: string;
  }): Promise<{ name: string; isBot: boolean } | null> {
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString("https://slack.com/api/users.info"),
        data: {
          user: data.userId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 1,
        },
      });

    if (
      response instanceof HTTPErrorResponse ||
      (response.jsonData as JSONObject)?.["ok"] !== true
    ) {
      logger.debug("Slack did not say who a user is.");
      return null;
    }

    const user: JSONObject | undefined = (response.jsonData as JSONObject)[
      "user"
    ] as JSONObject | undefined;
    const profile: JSONObject | undefined = user?.["profile"] as
      | JSONObject
      | undefined;

    const name: string =
      [
        profile?.["display_name"],
        profile?.["real_name"],
        user?.["real_name"],
        user?.["name"],
      ]
        .map((value: unknown): string => {
          return typeof value === "string" ? value.trim() : "";
        })
        .find((value: string): boolean => {
          return value.length > 0;
        }) || "";

    if (!name) {
      return null;
    }

    return { name: name, isBot: user?.["is_bot"] === true };
  }

  @CaptureSpan()
  public static async getMessageByTimestamp(data: {
    authToken: string;
    channelId: string;
    messageTs: string;
  }): Promise<string | null> {
    const message: { text: string; threadTs: string | null } | null =
      await this.getMessageDetailsByTimestamp(data);

    return message ? message.text : null;
  }

  /*
   * The text of a message, and the ts of the thread it belongs to (null for a
   * message that is not in a thread).
   *
   * conversations.history only returns top-level messages, so a reply in a
   * thread — where most of an incident's discussion happens — is not in it.
   * Those are read with conversations.replies, which accepts the ts of any
   * message in a thread.
   */
  @CaptureSpan()
  public static async getMessageDetailsByTimestamp(data: {
    authToken: string;
    channelId: string;
    messageTs: string;
  }): Promise<{ text: string; threadTs: string | null } | null> {
    const fromHistory: JSONObject | null = await this.findMessageByTimestamp({
      ...data,
      apiMethod: "conversations.history",
    });

    const message: JSONObject | null =
      fromHistory ||
      (await this.findMessageByTimestamp({
        ...data,
        apiMethod: "conversations.replies",
      }));

    const text: string | undefined = message?.["text"] as string | undefined;

    if (!message || !text) {
      return null;
    }

    return {
      text: text,
      threadTs: (message["thread_ts"] as string | undefined) || null,
    };
  }

  private static async findMessageByTimestamp(data: {
    authToken: string;
    channelId: string;
    messageTs: string;
    apiMethod: "conversations.history" | "conversations.replies";
  }): Promise<JSONObject | null> {
    const getMsgLogAttributes: LogAttributes = { channelId: data.channelId };

    logger.debug(
      `Getting message by timestamp from ${data.apiMethod} with data:`,
      getMsgLogAttributes,
    );
    logger.debug(data, getMsgLogAttributes);

    const requestData: JSONObject = {
      channel: data.channelId,
      latest: data.messageTs,
      oldest: data.messageTs,
      inclusive: true,
      limit: 1,
    };

    if (data.apiMethod === "conversations.replies") {
      /*
       * Slack puts the thread's parent first whatever the bounds, so leave
       * room for it next to the reply we are after.
       */
      requestData["ts"] = data.messageTs;
      requestData["limit"] = 10;
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString(`https://slack.com/api/${data.apiMethod}`),
        data: requestData,
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for getting message:",
      getMsgLogAttributes,
    );
    logger.debug(response, getMsgLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", getMsgLogAttributes);
      logger.error(response, getMsgLogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", getMsgLogAttributes);
      logger.error(response.jsonData, getMsgLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    const messages: Array<JSONObject> = (response.jsonData as JSONObject)?.[
      "messages"
    ] as Array<JSONObject>;

    const message: JSONObject | undefined = (messages || []).find(
      (candidate: JSONObject) => {
        return !candidate["ts"] || candidate["ts"] === data.messageTs;
      },
    );

    if (!message) {
      logger.debug(
        `No message found for timestamp in ${data.apiMethod}.`,
        getMsgLogAttributes,
      );
      return null;
    }

    logger.debug("Message retrieved:", getMsgLogAttributes);
    logger.debug(message["text"], getMsgLogAttributes);

    return message;
  }

  /*
   * Fetches the replies of a Slack thread (oldest-first, as Slack returns them)
   * using the bot token. Used by the AI Ops threaded follow-up feature to build
   * conversation history for the observability assistant.
   */
  @CaptureSpan()
  public static async getThreadReplies(data: {
    authToken: string;
    channelId: string;
    threadTs: string;
  }): Promise<
    Array<{
      user?: string | undefined;
      bot_id?: string | undefined;
      text?: string | undefined;
      ts?: string | undefined;
      subtype?: string | undefined;
    }>
  > {
    const getRepliesLogAttributes: LogAttributes = {
      channelId: data.channelId,
    };

    logger.debug("Getting thread replies with data:", getRepliesLogAttributes);
    logger.debug(data, getRepliesLogAttributes);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.replies"),
        data: {
          channel: data.channelId,
          ts: data.threadTs,
          limit: 50,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for getting thread replies:",
      getRepliesLogAttributes,
    );
    logger.debug(response, getRepliesLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:", getRepliesLogAttributes);
      logger.error(response, getRepliesLogAttributes);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:", getRepliesLogAttributes);
      logger.error(response.jsonData, getRepliesLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    const messages: Array<JSONObject> =
      ((response.jsonData as JSONObject)?.["messages"] as Array<JSONObject>) ||
      [];

    return messages.map((message: JSONObject) => {
      return {
        user: message["user"] as string | undefined,
        bot_id: message["bot_id"] as string | undefined,
        text: message["text"] as string | undefined,
        ts: message["ts"] as string | undefined,
        subtype: message["subtype"] as string | undefined,
      };
    });
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    logger.debug("Getting buttons block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const elements: Array<JSONObject> = data.payloadButtonsBlock.buttons.map(
      (button: WorkspaceMessagePayloadButton) => {
        return this.getButtonBlock({ payloadButtonBlock: button });
      },
    );

    // The actions fewer people need: an overflow menu (⋯) after the buttons.
    if (
      data.payloadButtonsBlock.menuButtons &&
      data.payloadButtonsBlock.menuButtons.length > 0
    ) {
      elements.push(
        SlackOverflowMenu.getElement(data.payloadButtonsBlock.menuButtons),
      );
    }

    const buttonsBlock: JSONObject = {
      type: "actions",
      elements: elements,
    };

    logger.debug("Buttons block generated:", {} as LogAttributes);
    logger.debug(buttonsBlock, {} as LogAttributes);
    return buttonsBlock;
  }

  /*
   * Whether conversations.create refused a channel's name because a channel
   * has it already: one in use, or an archived one - Slack keeps an archived
   * channel's name. The channel can then be created under another name.
   */
  public static override isChannelNameTakenError(error: unknown): boolean {
    return (
      WorkspaceBase.getSendErrorMessage(error) ===
      `Error from Slack ${SLACK_CHANNEL_NAME_TAKEN_ERROR}`
    );
  }

  /*
   * The name Slack creates a channel by: Slack only allows lowercase
   * letters, numbers, hyphens, and underscores, so the name is lower-cased
   * and all other characters (including #) are removed. "#Incidents -INC-9"
   * is created as "incidents-inc-9".
   */
  public static getChannelNameToCreate(channelName: string): string {
    return channelName.toLowerCase().replace(/[^a-z0-9\-_]/g, "");
  }

  /*
   * Names Slack creates by the same name are one channel: asked to create
   * it a second time, Slack answers name_taken.
   */
  public static override isSameChannelToCreate(
    channel: WorkspaceChannelToCreate,
    otherChannel: WorkspaceChannelToCreate,
  ): boolean {
    return (
      this.getChannelNameToCreate(channel.channelName) ===
      this.getChannelNameToCreate(otherChannel.channelName)
    );
  }

  @CaptureSpan()
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
    isPrivate?: boolean;
  }): Promise<WorkspaceChannel> {
    /*
     * As Slack creates it (getChannelNameToCreate). A rule's channel arrives
     * named so already (WorkspaceChannelName), and no longer than Slack's
     * 80 characters.
     */
    data.channelName = this.getChannelNameToCreate(data.channelName);

    const createChannelLogAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    logger.debug("Creating channel with data:", createChannelLogAttributes);
    logger.debug(data, createChannelLogAttributes);

    const createChannelPayload: JSONObject = {
      name: data.channelName,
    };

    if (data.isPrivate) {
      createChannelPayload["is_private"] = true;
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.create"),
        data: createChannelPayload,
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug(
      "Response from Slack API for creating channel:",
      createChannelLogAttributes,
    );
    logger.debug(response, createChannelLogAttributes);

    if (response instanceof HTTPErrorResponse) {
      logger.error(
        "Error response from Slack API:",
        createChannelLogAttributes,
      );
      logger.error(response, createChannelLogAttributes);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error(
        "Invalid response from Slack API:",
        createChannelLogAttributes,
      );
      logger.error(response.jsonData, createChannelLogAttributes);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["id"] ||
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      logger.error(
        "Invalid response from Slack API:",
        createChannelLogAttributes,
      );
      logger.error(response.jsonData, createChannelLogAttributes);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      id: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "id"
      ] as string,
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Channel created successfully:", createChannelLogAttributes);
    logger.debug(channel, createChannelLogAttributes);

    // Cache the created channel
    try {
      const localCache: Dictionary<any> = {};
      localCache[data.channelName] = {
        id: channel.id,
        name: channel.name,
        workspaceType: WorkspaceType.Slack,
        lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
      };
      await this.updateChannelsInCache({
        projectId: data.projectId,
        channelCache: localCache,
      });
    } catch (error) {
      logger.error(
        "Error caching created channel:",
        createChannelLogAttributes,
      );
      logger.error(error, createChannelLogAttributes);
      // Don't fail the creation if caching fails
    }

    return channel;
  }

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    logger.debug("Getting header block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    /*
     * Slack refuses a whole message whose header is over 150 characters:
     * a longer one is cut, between whole characters, and ends with "…".
     */
    const headerText: string =
      data.payloadHeaderBlock.text.length > SlackUtil.HEADER_TEXT_MAX_LENGTH
        ? cutToLength(
            data.payloadHeaderBlock.text,
            SlackUtil.HEADER_TEXT_MAX_LENGTH - 1,
          ) + "…"
        : data.payloadHeaderBlock.text;

    const headerBlock: JSONObject = {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText,
      },
    };

    logger.debug("Header block generated:", {} as LogAttributes);
    logger.debug(headerBlock, {} as LogAttributes);
    return headerBlock;
  }

  @CaptureSpan()
  public static override getCheckboxBlock(data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    logger.debug("Getting checkbox block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const checkboxBlock: JSONObject = {
      type: "input",
      element: {
        type: "checkboxes",
        action_id: data.payloadCheckboxBlock.blockId,
        options: [
          {
            text: {
              type: "plain_text",
              text: data.payloadCheckboxBlock.label,
            },
            value: "value",
          },
        ],
        initial_options: data.payloadCheckboxBlock.initialValue
          ? [
              {
                text: {
                  type: "plain_text",
                  text: data.payloadCheckboxBlock.label,
                },
                value: "value",
              },
            ]
          : undefined,
      },
      label: {
        type: "plain_text",
        text: data.payloadCheckboxBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadCheckboxBlock.description) {
      checkboxBlock["hint"] = {
        type: "plain_text",
        text: data.payloadCheckboxBlock.description,
      };
    }

    logger.debug("Checkbox block generated:", {} as LogAttributes);
    logger.debug(checkboxBlock, {} as LogAttributes);
    return checkboxBlock;
  }

  @CaptureSpan()
  public static override getDateTimePickerBlock(data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    logger.debug(
      "Getting date time picker block with data:",
      {} as LogAttributes,
    );
    logger.debug(data, {} as LogAttributes);

    /*
     * The moment it opens on: a Date, or the ISO time initialValue gives.
     * Slack's date and time picker takes it as the seconds since 1970 - it
     * has no initial_date, which only its date picker takes.
     */
    const initialDateTime: Date | undefined =
      data.payloadDateTimePickerBlock.initialDateTime ||
      (data.payloadDateTimePickerBlock.initialValue
        ? new Date(data.payloadDateTimePickerBlock.initialValue)
        : undefined);

    const dateTimePickerBlock: JSONObject = {
      type: "input",
      // Named, so a form's submission can be answered at this field.
      block_id: data.payloadDateTimePickerBlock.blockId,
      optional: data.payloadDateTimePickerBlock.optional || false,
      element: {
        type: "datetimepicker",
        action_id: data.payloadDateTimePickerBlock.blockId,
        initial_date_time:
          initialDateTime && !isNaN(initialDateTime.getTime())
            ? Math.floor(initialDateTime.getTime() / 1000)
            : undefined,
      },
      label: {
        type: "plain_text",
        text: data.payloadDateTimePickerBlock.label,
      },
    };

    if (data.payloadDateTimePickerBlock.description) {
      dateTimePickerBlock["hint"] = {
        type: "plain_text",
        text: data.payloadDateTimePickerBlock.description,
      };
    }

    logger.debug("Date time picker block generated:", {} as LogAttributes);
    logger.debug(dateTimePickerBlock, {} as LogAttributes);
    return dateTimePickerBlock;
  }

  /*
   * A calendar day (WorkspaceDatePickerBlock): Slack's date picker, which
   * gives the day back as "2026-10-15" (getValuesFromView).
   */
  @CaptureSpan()
  public static override getDatePickerBlock(data: {
    payloadDatePickerBlock: WorkspaceDatePickerBlock;
  }): JSONObject {
    const block: WorkspaceDatePickerBlock = data.payloadDatePickerBlock;

    const element: JSONObject = {
      type: "datepicker",
      action_id: block.blockId,
    };

    if (block.initialDate) {
      element["initial_date"] = block.initialDate;
    }

    if (block.placeholder) {
      element["placeholder"] = {
        type: "plain_text",
        text: block.placeholder,
      };
    }

    const datePickerBlock: JSONObject = {
      type: "input",
      block_id: block.blockId,
      optional: block.optional || false,
      element: element,
      label: {
        type: "plain_text",
        text: block.label,
      },
    };

    if (block.description) {
      datePickerBlock["hint"] = {
        type: "plain_text",
        text: block.description,
      };
    }

    return datePickerBlock;
  }

  /*
   * A number (WorkspaceNumberInputBlock): Slack's number input, which takes
   * nothing but a number - a decimal point included - and gives back what
   * was typed, as text.
   */
  @CaptureSpan()
  public static override getNumberInputBlock(data: {
    payloadNumberInputBlock: WorkspaceNumberInputBlock;
  }): JSONObject {
    const block: WorkspaceNumberInputBlock = data.payloadNumberInputBlock;

    const element: JSONObject = {
      type: "number_input",
      is_decimal_allowed: true,
      action_id: block.blockId,
    };

    if (block.initialValue) {
      element["initial_value"] = block.initialValue;
    }

    if (block.placeholder) {
      element["placeholder"] = {
        type: "plain_text",
        text: block.placeholder,
      };
    }

    const numberInputBlock: JSONObject = {
      type: "input",
      block_id: block.blockId,
      optional: block.optional || false,
      element: element,
      label: {
        type: "plain_text",
        text: block.label,
      },
    };

    if (block.description) {
      numberInputBlock["hint"] = {
        type: "plain_text",
        text: block.description,
      };
    }

    return numberInputBlock;
  }

  @CaptureSpan()
  public static override getTextAreaBlock(data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    logger.debug("Getting text area block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const optional: boolean = data.payloadTextAreaBlock.optional || false;

    const textAreaBlock: JSONObject = {
      type: "input",
      // Named, so a form's submission can be answered at this field.
      block_id: data.payloadTextAreaBlock.blockId,
      optional: optional,
      element: {
        type: "plain_text_input",
        multiline: true,
        action_id: data.payloadTextAreaBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextAreaBlock.placeholder,
        },
        initial_value: data.payloadTextAreaBlock.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.payloadTextAreaBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadTextAreaBlock.description) {
      textAreaBlock["hint"] = {
        type: "plain_text",
        text: data.payloadTextAreaBlock.description,
      };
    }

    logger.debug("Text area block generated:", {} as LogAttributes);
    logger.debug(textAreaBlock, {} as LogAttributes);
    return textAreaBlock;
  }

  @CaptureSpan()
  public static override getTextBoxBlock(data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    logger.debug("Getting text box block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const optional: boolean = data.payloadTextBoxBlock.optional || false;

    const textBoxBlock: JSONObject = {
      type: "input",
      // Named, so a form's submission can be answered at this field.
      block_id: data.payloadTextBoxBlock.blockId,
      optional: optional,
      element: {
        type: "plain_text_input",
        action_id: data.payloadTextBoxBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextBoxBlock.placeholder,
        },
        initial_value: data.payloadTextBoxBlock.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.payloadTextBoxBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadTextBoxBlock.description) {
      textBoxBlock["hint"] = {
        type: "plain_text",
        text: data.payloadTextBoxBlock.description,
      };
    }

    logger.debug("Text box block generated:", {} as LogAttributes);
    logger.debug(textBoxBlock, {} as LogAttributes);
    return textBoxBlock;
  }

  @CaptureSpan()
  public static override getImageBlock(data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    logger.debug("Getting image block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const imageBlock: JSONObject = {
      type: "image",
      image_url: data.payloadImageBlock.imageUrl.toString(),
      alt_text: data.payloadImageBlock.altText,
    };

    logger.debug("Image block generated:", {} as LogAttributes);
    logger.debug(imageBlock, {} as LogAttributes);
    return imageBlock;
  }

  @CaptureSpan()
  public static override getDropdownBlock(data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    logger.debug("Getting dropdown block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const optional: boolean = data.payloadDropdownBlock.optional || false;

    const isMiltiSelect: boolean =
      data.payloadDropdownBlock.multiSelect || false;

    const toOption: (option: DropdownOption) => JSONObject = (
      option: DropdownOption,
    ): JSONObject => {
      return {
        text: {
          type: "plain_text",
          text: option.label,
        },
        value: option.value,
      };
    };

    const optionGroups: Array<WorkspaceDropdownOptionGroup> = (
      data.payloadDropdownBlock.optionGroups || []
    ).filter((group: WorkspaceDropdownOptionGroup): boolean => {
      return group.options.length > 0;
    });

    /*
     * A single select's pick as it opens. Slack takes it only as one of the
     * options, text and all - an option with another text than its value
     * (a severity's name and its id) is found by its value. A value no
     * option has is left out: the select opens with nothing picked.
     */
    const initialOption: DropdownOption | undefined = data.payloadDropdownBlock
      .initialValue
      ? [
          ...data.payloadDropdownBlock.options,
          ...optionGroups.flatMap(
            (group: WorkspaceDropdownOptionGroup): Array<DropdownOption> => {
              return group.options;
            },
          ),
        ].find((option: DropdownOption): boolean => {
          return (
            option.value.toString() === data.payloadDropdownBlock.initialValue
          );
        })
      : undefined;

    const element: JSONObject = {
      type: isMiltiSelect ? "multi_static_select" : "static_select",
      action_id: data.payloadDropdownBlock.blockId,
      placeholder: {
        type: "plain_text",
        text: data.payloadDropdownBlock.placeholder,
      },
      initial_option:
        !isMiltiSelect && initialOption ? toOption(initialOption) : undefined,
    };

    // Slack takes options, or groups of them: never both.
    if (optionGroups.length > 0) {
      element["option_groups"] = optionGroups.map(
        (group: WorkspaceDropdownOptionGroup): JSONObject => {
          return {
            label: {
              type: "plain_text",
              text: group.label,
            },
            options: group.options.map(toOption),
          };
        },
      );
    } else {
      element["options"] = data.payloadDropdownBlock.options.map(toOption);
    }

    /*
     * A multi-select's picks as it opens: each the option itself, as Slack
     * requires - an option no list holds is left out.
     */
    if (isMiltiSelect && data.payloadDropdownBlock.initialValues?.length) {
      const allOptions: Array<DropdownOption> = [
        ...data.payloadDropdownBlock.options,
        ...optionGroups.flatMap(
          (group: WorkspaceDropdownOptionGroup): Array<DropdownOption> => {
            return group.options;
          },
        ),
      ];

      const initialOptions: Array<JSONObject> = [];

      for (const value of data.payloadDropdownBlock.initialValues) {
        const option: DropdownOption | undefined = allOptions.find(
          (candidate: DropdownOption): boolean => {
            return candidate.value === value;
          },
        );

        if (option) {
          initialOptions.push(toOption(option));
        }
      }

      if (initialOptions.length > 0) {
        element["initial_options"] = initialOptions;
      }
    }

    const dropdownBlock: JSONObject = {
      type: "input",
      // Named, so a form's submission can be answered at this field.
      block_id: data.payloadDropdownBlock.blockId,
      optional: optional,
      element: element,

      label: {
        type: "plain_text",
        text: data.payloadDropdownBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadDropdownBlock.description) {
      dropdownBlock["hint"] = {
        type: "plain_text",
        text: data.payloadDropdownBlock.description,
      };
    }

    logger.debug("Dropdown block generated:", {} as LogAttributes);
    logger.debug(dropdownBlock, {} as LogAttributes);
    return dropdownBlock;
  }

  @CaptureSpan()
  public static override getModalBlock(data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    logger.debug("Getting modal block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const modalBlock: JSONObject = {
      type: "modal",
      title: {
        type: "plain_text",
        text: data.payloadModalBlock.title,
      },
      callback_id: data.payloadModalBlock.actionId,
      private_metadata: data.payloadModalBlock.actionValue,
      submit: {
        type: "plain_text",
        text: data.payloadModalBlock.submitButtonTitle,
      },
      close: {
        type: "plain_text",
        text: data.payloadModalBlock.cancelButtonTitle,
      },
      blocks: this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: data.payloadModalBlock.blocks,
        // A view takes twice as many blocks as a message.
        maxBlocks: SlackUtil.MAX_BLOCKS_PER_MODAL,
      }),
    };

    logger.debug("Modal block generated:", {} as LogAttributes);
    logger.debug(modalBlock, {} as LogAttributes);
    return modalBlock;
  }

  @CaptureSpan()
  public static override getBlocksFromWorkspaceMessagePayload(data: {
    messageBlocks: Array<WorkspaceMessageBlock>;
    /*
     * The most blocks the result may hold. Defaults to a message's limit;
     * a modal view passes its own.
     */
    maxBlocks?: number | undefined;
    /*
     * The Slack files the message's inline images were uploaded as, by the
     * image's base64 (SlackInlineImages.uploadImages). An inline image with
     * none is shown as its alt text, or not at all when the text before it
     * has that already.
     */
    uploadedImages?: Map<string, string> | undefined;
  }): Array<JSONObject> {
    const maxBlocks: number =
      data.maxBlocks ?? SlackUtil.MAX_BLOCKS_PER_MESSAGE;

    const messageBlocks: Array<WorkspaceMessageBlock> = [];

    for (const messageBlock of data.messageBlocks) {
      if (messageBlock._type !== "WorkspacePayloadInlineImage") {
        messageBlocks.push(messageBlock);
        continue;
      }

      const inlineImage: WorkspacePayloadInlineImage =
        messageBlock as WorkspacePayloadInlineImage;

      if (data.uploadedImages?.has(inlineImage.image.base64)) {
        messageBlocks.push(inlineImage);
      } else if (inlineImage.fallbackMarkdown) {
        const fallback: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: inlineImage.fallbackMarkdown,
        };

        messageBlocks.push(fallback);
      }
    }

    /*
     * A markdown payload is the one block whose size we do not control: it
     * carries whatever the incident or alert says, root cause included, and
     * a section holds at most 3000 characters. So here it may expand into
     * several consecutive sections (see getMarkdownBlocks). Every other
     * block type still goes through the base class one block at a time, so
     * it renders exactly as before — one block, or none for an unknown type.
     *
     * The extra sections must not take the message past maxBlocks, or Slack
     * rejects all of it. So the other blocks are rendered first, every
     * markdown payload is counted for the one section it always had, and
     * only what is left of the budget is handed out as extra sections, in
     * message order, so the body a caller puts first is the last thing to
     * be cut short. A message that is already at the limit keeps one
     * section per markdown payload, exactly as many blocks as before.
     */
    const renderedBlocks: Array<Array<JSONObject> | null> = [];
    let blockCountBeforeSplitting: number = 0;

    for (const messageBlock of messageBlocks) {
      if (messageBlock._type === "WorkspacePayloadMarkdown") {
        // Rendered in the second pass, once the budget is known.
        renderedBlocks.push(null);
        blockCountBeforeSplitting += 1;
        continue;
      }

      if (messageBlock._type === "WorkspacePayloadInlineImage") {
        const inlineImage: WorkspacePayloadInlineImage =
          messageBlock as WorkspacePayloadInlineImage;

        renderedBlocks.push([
          SlackInlineImages.getImageBlock({
            fileId: data.uploadedImages!.get(inlineImage.image.base64)!,
            altText: inlineImage.altText,
          }),
        ]);
        blockCountBeforeSplitting += 1;
        continue;
      }

      const otherBlocks: Array<JSONObject> =
        super.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: [messageBlock],
        });

      renderedBlocks.push(otherBlocks);
      blockCountBeforeSplitting += otherBlocks.length;
    }

    let spareBlocks: number = Math.max(
      0,
      maxBlocks - blockCountBeforeSplitting,
    );

    const blocks: Array<JSONObject> = [];

    /*
     * The pieces of a markdown block split around its images share the
     * sections that block may take: each piece still gets one.
     */
    const sectionsLeftBySplitBlock: Map<WorkspaceMessageBlock, number> =
      new Map<WorkspaceMessageBlock, number>();

    for (let index: number = 0; index < messageBlocks.length; index++) {
      // Empty, not null, for a block of an unknown type — it stays dropped.
      const rendered: Array<JSONObject> | null = renderedBlocks[index] ?? null;

      if (rendered !== null) {
        blocks.push(...rendered);
        continue;
      }

      const splitFrom: WorkspaceMessageBlock | undefined =
        WorkspaceInlineImages.getSplitFrom(messageBlocks[index]!);
      const sectionsLeft: number = splitFrom
        ? sectionsLeftBySplitBlock.get(splitFrom) ??
          SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK
        : SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK;

      const sections: Array<JSONObject> = this.getMarkdownBlocks({
        payloadMarkdownBlock: messageBlocks[index] as WorkspacePayloadMarkdown,
        maxSections: 1 + Math.min(spareBlocks, Math.max(0, sectionsLeft - 1)),
      });

      if (splitFrom) {
        sectionsLeftBySplitBlock.set(
          splitFrom,
          Math.max(0, sectionsLeft - sections.length),
        );
      }

      spareBlocks -= sections.length - 1;
      blocks.push(...sections);
    }

    return blocks;
  }

  /*
   * One section block. Text over Slack's limit cannot be split here, so it
   * is cut short with a note instead of being sent as a block Slack would
   * reject; messages go through getBlocksFromWorkspaceMessagePayload, which
   * splits it across sections. Text within the limit renders as it always
   * has.
   */
  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    logger.debug("Getting markdown block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const markdownBlock: JSONObject = this.getMarkdownBlocks({
      payloadMarkdownBlock: data.payloadMarkdownBlock,
      maxSections: 1,
    })[0]!;

    logger.debug("Markdown block generated:", {} as LogAttributes);
    logger.debug(markdownBlock, {} as LogAttributes);
    return markdownBlock;
  }

  /*
   * Small, muted text under a message: a context block, whose one element
   * is the Markdown as a section would say it (getMarkdownBlock), within
   * the same 3000 characters.
   */
  @CaptureSpan()
  public static override getContextBlock(data: {
    payloadContextBlock: WorkspacePayloadContext;
  }): JSONObject {
    const section: JSONObject = this.getMarkdownBlock({
      payloadMarkdownBlock: {
        _type: "WorkspacePayloadMarkdown",
        text: data.payloadContextBlock.text,
      },
    });

    return {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ((section["text"] as JSONObject)["text"] as string) || " ",
        },
      ],
    };
  }

  /*
   * A markdown payload as consecutive section blocks, each within Slack's
   * 3000-character limit. Text that fits is one section, byte for byte what
   * a markdown payload has always rendered to (empty text included).
   */
  @CaptureSpan()
  public static getMarkdownBlocks(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
    // Defaults to MAX_SECTIONS_PER_MARKDOWN_BLOCK.
    maxSections?: number | undefined;
  }): Array<JSONObject> {
    /*
     * Slack shows no image whose address is a data: URL - a screenshot in a
     * description - and would get its base64 as a link: each becomes its
     * alt text here. sendMessage shows them as images of their own before
     * a markdown block gets here (WorkspaceInlineImages).
     */
    const markdown: CutMarkdown = this.cutMarkdown(
      data.payloadMarkdownBlock.text
        ? ChatInlineImages.toText(data.payloadMarkdownBlock.text)
        : "",
      // One section more than this payload may take.
      (Math.min(
        Math.max(
          1,
          data.maxSections ?? SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
        ),
        SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
      ) +
        1) *
        SlackUtil.SECTION_TEXT_MAX_LENGTH,
    );

    /*
     * A moment the Markdown names in each reader's own time - written as
     * Microsoft Teams reads it - becomes a Slack date here, once the
     * conversion can no longer escape its "<" (WorkspaceMessageTime).
     */
    const text: string = markdown.text
      ? WorkspaceMessageTime.toSlack(this.slackify(markdown.text))
      : "";

    const sectionTexts: Array<string> = this.splitSectionText({
      text: text,
      maxSections: data.maxSections,
      isCutShort: markdown.isCutShort,
    });

    if (sectionTexts.length > 1) {
      logger.debug(
        `Markdown block of ${text.length} characters split into ${sectionTexts.length} sections.`,
        {} as LogAttributes,
      );
    }

    const sections: Array<JSONObject> = sectionTexts.map(
      (sectionText: string): JSONObject => {
        return {
          type: "section",
          text: {
            type: "mrkdwn",
            text: sectionText,
          },
        };
      },
    );

    // A menu beside the text (the Home's Switch project): its first section's.
    if (data.payloadMarkdownBlock.menu && sections[0]) {
      SlackUtil.addMenu({
        section: sections[0],
        menu: data.payloadMarkdownBlock.menu,
      });
    }

    return sections;
  }

  // The most options Slack's static select takes.
  public static readonly MAX_MENU_OPTIONS: number = 100;

  // The most characters an option's text, or a select's placeholder, holds.
  public static readonly MENU_OPTION_TEXT_MAX_LENGTH: number = 75;

  // The most characters an option's value, or a block's id, holds.
  private static readonly MENU_OPTION_VALUE_MAX_LENGTH: number = 150;
  private static readonly BLOCK_ID_MAX_LENGTH: number = 255;

  /*
   * A section with a menu beside its text (WorkspacePayloadMenu): Slack's
   * static select as the section's accessory, which Slack posts as soon as
   * an option is chosen. Each option's text is cut to what Slack takes, and
   * at most MAX_MENU_OPTIONS are listed. A menu with no option to list, or
   * one Slack would refuse, is left out: the text stands on its own.
   */
  private static addMenu(data: {
    section: JSONObject;
    menu: WorkspacePayloadMenu;
  }): void {
    const options: Array<JSONObject> = data.menu.options
      .filter((option: WorkspacePayloadMenuOption): boolean => {
        return (
          Boolean(option.label.trim()) &&
          Boolean(option.value) &&
          option.value.length <= SlackUtil.MENU_OPTION_VALUE_MAX_LENGTH
        );
      })
      .slice(0, SlackUtil.MAX_MENU_OPTIONS)
      .map((option: WorkspacePayloadMenuOption): JSONObject => {
        return {
          text: {
            type: "plain_text",
            text: SlackUtil.cutPlainText(
              option.label.trim(),
              SlackUtil.MENU_OPTION_TEXT_MAX_LENGTH,
            ),
            emoji: true,
          },
          value: option.value,
        };
      });

    if (options.length === 0 || !data.menu.actionId) {
      return;
    }

    data.section["accessory"] = {
      type: "static_select",
      action_id: data.menu.actionId,
      placeholder: {
        type: "plain_text",
        text: SlackUtil.cutPlainText(
          data.menu.placeholder,
          SlackUtil.MENU_OPTION_TEXT_MAX_LENGTH,
        ),
        emoji: true,
      },
      options: options,
    };

    if (
      data.menu.blockId &&
      data.menu.blockId.length <= SlackUtil.BLOCK_ID_MAX_LENGTH
    ) {
      data.section["block_id"] = data.menu.blockId;
    }
  }

  /*
   * Plain text cut to `maxLength` characters, ending with "…" when cut -
   * never between the two halves of an emoji (cutToLength).
   */
  private static cutPlainText(text: string, maxLength: number): string {
    return text.length > maxLength
      ? `${cutToLength(text, maxLength - 1).trimEnd()}…`
      : text;
  }

  /*
   * Splits slackified text into section texts of at most
   * SECTION_TEXT_MAX_LENGTH characters, at the least disruptive places
   * available:
   *
   *   1. between paragraphs (a blank line),
   *   2. between list items, keeping an item together with the indented
   *      bullets under it,
   *   3. between lines,
   *   4. and only inside a line that is on its own longer than the limit,
   *      preferring a space there.
   *
   * The text between two sections is the newlines they were split at and
   * nothing else, so the sections read back in order give every line of the
   * original. A section that ends inside a ``` code block closes it and the
   * next one reopens it.
   *
   * Beyond maxSections the rest is dropped and the last section ends with
   * TRUNCATED_SECTION_NOTE. Text that fits is returned as it is.
   */
  public static splitSectionText(data: {
    text: string;
    // Defaults to MAX_SECTIONS_PER_MARKDOWN_BLOCK; never less than one.
    maxSections?: number | undefined;
    /*
     * The text was cut short before it got here (cutMarkdown): its last
     * section ends with TRUNCATED_SECTION_NOTE even when the rest fits.
     */
    isCutShort?: boolean | undefined;
  }): Array<string> {
    const maxLength: number = SlackUtil.SECTION_TEXT_MAX_LENGTH;

    if (data.text.length <= maxLength && !data.isCutShort) {
      return [data.text];
    }

    const maxSections: number = Math.max(
      1,
      data.maxSections ?? SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
    );

    /*
     * Any piece may need to reopen a code block at its start and close one
     * at its end, so when the text has code blocks every piece leaves room
     * for both.
     */
    const pieceMaxLength: number = data.text.includes(SlackUtil.CODE_FENCE)
      ? maxLength -
        SlackUtil.CODE_FENCE_REOPEN.length -
        SlackUtil.CODE_FENCE_CLOSE.length
      : maxLength;

    let pieces: Array<string> = this.splitTextAtBoundaries(
      data.text,
      pieceMaxLength,
    );

    if (pieces.length === 0) {
      // Nothing but whitespace — there is nothing to show.
      return [""];
    }

    const isTruncated: boolean =
      pieces.length > maxSections || data.isCutShort === true;

    if (isTruncated) {
      pieces = pieces.slice(0, maxSections);

      /*
       * Shorten the last piece until the note fits after it, with the same
       * boundary preferences — whole paragraphs, items or lines where it
       * can.
       */
      const lastPiece: string = pieces[pieces.length - 1] || "";

      pieces[pieces.length - 1] =
        this.splitTextAtBoundaries(
          lastPiece,
          pieceMaxLength - SlackUtil.TRUNCATED_SECTION_NOTE.length,
        )[0] || "";
    }

    const sections: Array<string> = [];
    let isInsideCodeBlock: boolean = false;

    for (let index: number = 0; index < pieces.length; index++) {
      const piece: string = pieces[index] || "";
      const isLastPiece: boolean = index === pieces.length - 1;

      let section: string = isInsideCodeBlock
        ? SlackUtil.CODE_FENCE_REOPEN + piece
        : piece;

      // An odd number of fences opens or closes a code block.
      const fenceCount: number = piece.split(SlackUtil.CODE_FENCE).length - 1;

      if (fenceCount % 2 === 1) {
        isInsideCodeBlock = !isInsideCodeBlock;
      }

      /*
       * The last piece of text that was not truncated ends where the
       * original ends, so a code block still open there was never closed
       * and is left alone.
       */
      if (isInsideCodeBlock && (!isLastPiece || isTruncated)) {
        section += SlackUtil.CODE_FENCE_CLOSE;
      }

      if (isLastPiece && isTruncated) {
        section += SlackUtil.TRUNCATED_SECTION_NOTE;
      }

      sections.push(section);
    }

    return sections;
  }

  /*
   * Pieces of at most maxLength characters, split at the boundaries listed
   * on splitSectionText. Each piece is trimmed of the newlines it was split
   * at; a piece with nothing but whitespace is dropped.
   */
  private static splitTextAtBoundaries(
    text: string,
    maxLength: number,
  ): Array<string> {
    const pieces: Array<string> = this.packSectionPieces({
      units: text.split("\n\n"),
      separator: "\n\n",
      maxLength: maxLength,
      splitOversizedUnit: (paragraph: string): Array<string> => {
        return this.packSectionPieces({
          units: this.groupIndentedLines(paragraph),
          separator: "\n",
          maxLength: maxLength,
          splitOversizedUnit: (lineGroup: string): Array<string> => {
            return this.packSectionPieces({
              units: lineGroup.split("\n"),
              separator: "\n",
              maxLength: maxLength,
              splitOversizedUnit: (line: string): Array<string> => {
                return this.hardCutLine(line, maxLength);
              },
            });
          },
        });
      },
    });

    return pieces
      .map((piece: string): string => {
        return this.trimLineBreaks(piece);
      })
      .filter((piece: string): boolean => {
        return piece.trim().length > 0;
      });
  }

  /*
   * The text without the line breaks it starts and ends with. A loop from
   * each end, not /^[\r\n]+|[\r\n]+$/g: that pattern is tried again from
   * every line break of a run that does not reach the end, so its time grew
   * with the square of the run.
   */
  public static trimLineBreaks(text: string): string {
    let start: number = 0;
    let end: number = text.length;

    while (start < end && SlackUtil.isLineBreak(text.charAt(start))) {
      start++;
    }

    while (end > start && SlackUtil.isLineBreak(text.charAt(end - 1))) {
      end--;
    }

    return text.substring(start, end);
  }

  private static isLineBreak(character: string): boolean {
    return character === "\n" || character === "\r";
  }

  /*
   * Greedily joins units with the separator into pieces of at most
   * maxLength. A unit that does not fit next to the piece being built
   * starts a new piece rather than being broken up; only a unit longer than
   * maxLength on its own is broken, by splitOversizedUnit. The last of its
   * parts stays open, so the unit after it can still join it.
   */
  private static packSectionPieces(data: {
    units: Array<string>;
    separator: string;
    maxLength: number;
    splitOversizedUnit: (unit: string) => Array<string>;
  }): Array<string> {
    const pieces: Array<string> = [];

    // null until the first unit, so an empty unit still keeps its separator.
    let currentPiece: string | null = null;

    for (const unit of data.units) {
      if (currentPiece !== null) {
        const joined: string = currentPiece + data.separator + unit;

        if (joined.length <= data.maxLength) {
          currentPiece = joined;
          continue;
        }

        pieces.push(currentPiece);
        currentPiece = null;
      }

      if (unit.length <= data.maxLength) {
        currentPiece = unit;
        continue;
      }

      const parts: Array<string> = data.splitOversizedUnit(unit);

      pieces.push(...parts.slice(0, -1));
      currentPiece = parts[parts.length - 1] ?? null;
    }

    if (currentPiece !== null) {
      pieces.push(currentPiece);
    }

    return pieces;
  }

  /*
   * The lines of a paragraph, with every indented line attached to the line
   * above it. slackify-markdown indents a nested bullet under its list item
   * — the Affected Resources list puts a resource's namespace, workload and
   * node there — so a split between groups never strands those bullets at
   * the top of the next section, away from the item they describe.
   */
  private static groupIndentedLines(paragraph: string): Array<string> {
    const groups: Array<string> = [];

    for (const line of paragraph.split("\n")) {
      const isIndented: boolean = line.startsWith(" ") || line.startsWith("\t");
      const lastGroupIndex: number = groups.length - 1;

      if (isIndented && lastGroupIndex >= 0) {
        groups[lastGroupIndex] = (groups[lastGroupIndex] || "") + "\n" + line;
        continue;
      }

      groups.push(line);
    }

    return groups;
  }

  /*
   * Cuts a single line longer than maxLength. Each cut is made after the
   * last space that still leaves the piece at least half full, so words stay
   * whole where the line has spaces, and never between the two halves of a
   * surrogate pair (an emoji), which would leave both pieces invalid.
   */
  private static hardCutLine(line: string, maxLength: number): Array<string> {
    const pieces: Array<string> = [];
    let rest: string = line;

    while (rest.length > maxLength) {
      let cutAt: number = maxLength;

      const lastSpaceIndex: number = rest.lastIndexOf(" ", maxLength - 1);

      if (lastSpaceIndex + 1 >= Math.ceil(maxLength / 2)) {
        cutAt = lastSpaceIndex + 1;
      } else {
        const charCodeBeforeCut: number = rest.charCodeAt(cutAt - 1);

        if (charCodeBeforeCut >= 0xd800 && charCodeBeforeCut <= 0xdbff) {
          cutAt -= 1;
        }
      }

      pieces.push(rest.slice(0, cutAt));
      rest = rest.slice(cutAt);
    }

    pieces.push(rest);

    return pieces;
  }

  @CaptureSpan()
  public static override async isUserInChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    const members: Array<string> = [];

    const isInChannelLogAttributes: LogAttributes = {
      channelId: data.channelId,
    };

    logger.debug(
      "Checking if user is in channel with data:",
      isInChannelLogAttributes,
    );
    logger.debug(data, isInChannelLogAttributes);

    let cursor: string | undefined = undefined;

    do {
      // check if the user is in the channel, return true if they are, false if they are not

      const requestBody: JSONObject = {
        channel: data.channelId,
        limit: 999,
      };

      if (cursor) {
        requestBody["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.members"),
          data: requestBody,
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      logger.debug(
        "Response from Slack API for getting channel members:",
        isInChannelLogAttributes,
      );
      logger.debug(response, isInChannelLogAttributes);

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          "Error response from Slack API:",
          isInChannelLogAttributes,
        );
        logger.error(response, isInChannelLogAttributes);
        throw response;
      }

      // check for ok response

      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error(
          "Invalid response from Slack API:",
          isInChannelLogAttributes,
        );
        logger.error(response.jsonData, isInChannelLogAttributes);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }

      // check if the user is in the channel
      const membersOnThisPage: Array<string> = (
        response.jsonData as JSONObject
      )["members"] as Array<string>;

      members.push(...membersOnThisPage);

      cursor = (
        (response.jsonData as JSONObject)["response_metadata"] as JSONObject
      )?.["next_cursor"] as string;
    } while (cursor);

    if (members.includes(data.userId)) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    logger.debug("Getting button block with data:", {} as LogAttributes);
    logger.debug(data, {} as LogAttributes);

    const buttonBlock: JSONObject = {
      type: "button",
      text: {
        type: "plain_text",
        text: data.payloadButtonBlock.title,
        emoji: true,
      },
      /*
       * Slack refuses a button whose value is empty: a button that carries
       * nothing - the Home's Declare incident - is sent without one.
       */
      value: data.payloadButtonBlock.value || undefined,
      action_id: data.payloadButtonBlock.actionId,
      url: data.payloadButtonBlock.url
        ? data.payloadButtonBlock.url.toString()
        : undefined,
    };

    if (data.payloadButtonBlock.isPrimary) {
      buttonBlock["style"] = "primary";
    }

    logger.debug("Button block generated:", {} as LogAttributes);
    logger.debug(buttonBlock, {} as LogAttributes);
    return buttonBlock;
  }

  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug(
      "Sending message to channel via incoming webhook with data:",
      {} as LogAttributes,
    );
    logger.debug(data, {} as LogAttributes);

    /*
     * Enforced at the sink, not only at the callers: this URL reaches here from
     * workflow arguments and from status page subscribers, and a caller that
     * forgets the pin is an SSRF from the API server.
     */
    if (!SlackUtil.isValidSlackIncomingWebhookUrl(data.url)) {
      throw new BadDataException(
        "Slack Webhook URL must start with https://hooks.slack.com/services/",
      );
    }

    /*
     * Slack refuses a whole message with a section over 3000 characters,
     * so a longer text goes as several sections (splitSectionText) - and,
     * like any markdown payload, ends with a note when it does not fit in
     * them. A text that fits is the one section it always was.
     */
    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
      await API.post({
        url: data.url,
        data: {
          blocks: this.splitSectionText({ text: `${data.text}` }).map(
            (sectionText: string): JSONObject => {
              return {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: sectionText,
                },
              };
            },
          ),
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
          /*
           * The host is pinned to hooks.slack.com, but do not let a redirect
           * from it bounce this request to an internal address.
           */
          doNotFollowRedirects: true,
        },
      });

    logger.debug(
      "Response from Slack API for sending message via webhook:",
      {} as LogAttributes,
    );
    logger.debug(apiResult, {} as LogAttributes);
    return apiResult;
  }

  /*
   * Markdown as Slack's mrkdwn (slackify-markdown), in time linear in its
   * length: the blocks slackify would take too long to read, and the
   * content of fenced code, are held back first (SLOW_MARKDOWN_LIMITS) and
   * written back where slackify put them - escaped as Slack reads text
   * ("&", "<" and ">"), a line on each line.
   *
   * And whatever the text, it converts: slackify reads every link's address
   * with decodeURIComponent and encodeURI, which throw on a "%" that starts
   * no escape and on half an emoji ("URI malformed") - a response body with
   * "100%" in an address was enough, and the message was never sent. Such a
   * "%" goes through slackify as a stand-in character and comes back as it
   * was ("%25" where slackify encoded the address), half an emoji goes
   * through as U+FFFD, and should slackify still fail, the message is sent
   * as its text (getSlackifySafeMarkdown).
   *
   * A hard break is a line break (withoutHardBreakSpaces).
   */
  public static slackify(givenMarkdown: string): string {
    if (!givenMarkdown) {
      return "";
    }

    const markdown: string = SlackUtil.withoutHardBreakSpaces(givenMarkdown);
    const held: Array<string> = [];

    // Read with indexOf: the text can be long.
    const putBack: (value: string, escape: boolean) => string = (
      value: string,
      escape: boolean,
    ): string => {
      let restored: string = "";
      let restoredUpTo: number = 0;

      for (
        let open: number = value.indexOf("\uE005");
        open !== -1;
        open = value.indexOf("\uE005", restoredUpTo)
      ) {
        const close: number = value.indexOf("\uE006", open + 1);

        if (close === -1) {
          break;
        }

        const heldText: string =
          held[Number(value.slice(open + 1, close))] ?? "";

        restored +=
          value.slice(restoredUpTo, open) +
          (escape ? SlackUtil.escapeSlackText(heldText) : heldText);
        restoredUpTo = close + 1;
      }

      return restored + value.slice(restoredUpTo);
    };

    const hold: (text: string) => string = (text: string): string => {
      held.push(putBack(text, false));

      return `\uE005${held.length - 1}\uE006`;
    };

    /*
     * Token characters already in the Markdown - and the stand-in for a
     * "%" - are held back as they are.
     */
    let withoutTokens: string = markdown;

    if (
      markdown.indexOf("\uE005") !== -1 ||
      markdown.indexOf("\uE006") !== -1 ||
      markdown.indexOf(SLACKIFY_PERCENT_STAND_IN) !== -1
    ) {
      withoutTokens = "";
      let copiedUpTo: number = 0;

      for (let index: number = 0; index < markdown.length; index++) {
        const code: number = markdown.charCodeAt(index);

        if (code === 0xe005 || code === 0xe006 || code === 0xe007) {
          withoutTokens +=
            markdown.slice(copiedUpTo, index) + hold(markdown.charAt(index));
          copiedUpTo = index + 1;
        }
      }

      withoutTokens += markdown.slice(copiedUpTo);
    }

    let markdownToRead: string = holdBackSlowMarkdown(
      withoutTokens,
      { holdLines: hold, holdCode: hold },
      SlackUtil.SLOW_MARKDOWN_LIMITS,
    );

    if (held.length === 0) {
      // Nothing was held back: slackify reads the Markdown as it is.
      markdownToRead = markdown;
    }

    const safe: SlackifySafeMarkdown = getSlackifySafeMarkdown(markdownToRead);
    let text: string;

    try {
      text = SlackifyMarkdown(safe.markdown);
    } catch (error) {
      logger.warn(
        `Slack could not convert a message's Markdown (${markdown.length} characters), and it is sent as text: ${error instanceof Error ? error.message : String(error)}`,
      );

      return SlackUtil.escapeSlackText(markdown);
    }

    text = safe.restore(text);

    return held.length > 0 ? putBack(text, true) : text;
  }

  /*
   * Markdown whose hard breaks - two spaces at the end of a line, how a
   * note keeps the lines of an email reply, a form answer or a chat message
   * (FormSubmissionNote, ChatMessageMarkdown) - are plain line breaks.
   * slackify writes a hard break the way Markdown does, a backslash before
   * the line break, and Slack showed that backslash at the end of each
   * line. Slack breaks the line at every line break, so the spaces come off
   * and the line break left does the same. One pass over the lines.
   */
  public static withoutHardBreakSpaces(markdown: string): string {
    if (markdown.indexOf("  \n") === -1) {
      return markdown;
    }

    const lines: Array<string> = markdown.split("\n");

    return lines
      .map((line: string, index: number): string => {
        return index < lines.length - 1 && line.endsWith("  ")
          ? line.trimEnd()
          : line;
      })
      .join("\n");
  }

  // Text as Slack shows it: "&", "<" and ">" escaped, nothing else changed.
  public static escapeSlackText(text: string): string {
    return text
      .split("&")
      .join("&amp;")
      .split("<")
      .join("&lt;")
      .split(">")
      .join("&gt;");
  }

  /**
   * Converts markdown tables to a Slack-friendly format.
   * Since Slack's mrkdwn doesn't support tables, we convert them to
   * a row-by-row format with bold headers. Tables are found in one pass over
   * the lines (Utils/Markdown/PipeTables).
   */
  private static convertMarkdownTablesToSlackFormat(markdown: string): string {
    return replacePipeTables(markdown, (lines: Array<string>): string => {
      // Parse header row
      const headerLine: string = lines[0] || "";
      const headers: Array<string> = headerLine
        .split("|")
        .map((cell: string) => {
          return cell.trim();
        })
        .filter((cell: string) => {
          return cell.length > 0;
        });

      /*
       * Skip separator line (line with dashes)
       * Find data rows (skip header and separator)
       */
      const dataRows: Array<string> = lines.slice(2);
      const formattedRows: Array<string> = [];

      for (let rowIndex: number = 0; rowIndex < dataRows.length; rowIndex++) {
        const row: string = dataRows[rowIndex] || "";
        const cells: Array<string> = row
          .split("|")
          .map((cell: string) => {
            return cell.trim();
          })
          .filter((cell: string) => {
            return cell.length > 0;
          });

        if (cells.length === 0) {
          continue;
        }

        const rowParts: Array<string> = [];
        for (let cellIndex: number = 0; cellIndex < cells.length; cellIndex++) {
          const header: string =
            headers[cellIndex] || `Column ${cellIndex + 1}`;
          const value: string = cells[cellIndex] || "";
          rowParts.push(`*${header}:* ${value}`);
        }

        if (dataRows.length > 1) {
          formattedRows.push(`_Row ${rowIndex + 1}_\n${rowParts.join("\n")}`);
        } else {
          formattedRows.push(rowParts.join("\n"));
        }
      }

      return formattedRows.join("\n\n");
    });
  }

  @CaptureSpan()
  public static convertMarkdownToSlackRichText(markdown: string): string {
    /*
     * An incoming webhook cannot upload a file, so an image whose address
     * is a data: URL - a screenshot in a description - is its alt text.
     */
    const markdownWithoutInlineImages: CutMarkdown = this.cutMarkdown(
      ChatInlineImages.toText(markdown),
    );

    // First convert tables to Slack-friendly format
    const markdownWithConvertedTables: string =
      this.convertMarkdownTablesToSlackFormat(markdownWithoutInlineImages.text);
    const text: string = this.slackify(markdownWithConvertedTables);

    return markdownWithoutInlineImages.isCutShort
      ? text.trimEnd() + SlackUtil.TRUNCATED_SECTION_NOTE
      : text;
  }

  /*
   * `markdown`, cut to `maxLength` characters (MARKDOWN_MAX_LENGTH unless
   * said) when it is longer - at a line break where there is one near the
   * end (cutToLength). Shorter Markdown is returned as it is.
   */
  public static cutMarkdown(
    markdown: string,
    maxLength: number = SlackUtil.MARKDOWN_MAX_LENGTH,
  ): CutMarkdown {
    if (markdown.length <= maxLength) {
      return { text: markdown, isCutShort: false };
    }

    return {
      text: cutToLength(markdown, maxLength),
      isCutShort: true,
    };
  }

  @CaptureSpan()
  public static async getChannelMessages(params: {
    channelId: string;
    authToken: string;
    limit?: number;
    oldestTimestamp?: Date;
  }): Promise<
    Array<{
      messageId: string;
      text: string;
      userId?: string;
      username?: string;
      timestamp: Date;
      isBot: boolean;
    }>
  > {
    const messages: Array<{
      messageId: string;
      text: string;
      userId?: string;
      username?: string;
      timestamp: Date;
      isBot: boolean;
    }> = [];
    let cursor: string | undefined = undefined;
    const maxMessages: number = params.limit || 1000;
    const maxPages: number = 10;
    let pageCount: number = 0;

    do {
      const requestData: JSONObject = {
        channel: params.channelId,
        limit: Math.min(200, maxMessages - messages.length),
      };

      if (cursor) {
        requestData["cursor"] = cursor;
      }

      if (params.oldestTimestamp) {
        requestData["oldest"] = (
          params.oldestTimestamp.getTime() / 1000
        ).toString();
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.history"),
          data: requestData,
          headers: {
            Authorization: `Bearer ${params.authToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API for channel history:", {
          channelId: params.channelId,
        } as LogAttributes);
        logger.error(response, {
          channelId: params.channelId,
        } as LogAttributes);
        break;
      }

      const jsonData: JSONObject = response.jsonData as JSONObject;

      if (jsonData["ok"] !== true) {
        logger.error("Invalid response from Slack API for channel history:", {
          channelId: params.channelId,
        } as LogAttributes);
        logger.error(jsonData, {
          channelId: params.channelId,
        } as LogAttributes);
        break;
      }

      const slackMessages: Array<JSONObject> =
        (jsonData["messages"] as Array<JSONObject>) || [];

      for (const msg of slackMessages) {
        // Skip bot messages if they're from the OneUptime bot (app messages)
        const isBot: boolean =
          Boolean(msg["bot_id"]) || msg["subtype"] === "bot_message";

        // Extract text, handling attachments and blocks
        let text: string = (msg["text"] as string) || "";

        // If there are attachments, append their text
        const attachments: Array<JSONObject> | undefined = msg[
          "attachments"
        ] as Array<JSONObject> | undefined;
        if (attachments && Array.isArray(attachments)) {
          for (const attachment of attachments) {
            if (attachment && attachment["text"]) {
              text += "\n" + (attachment["text"] as string);
            }
            if (attachment && attachment["fallback"]) {
              text += "\n" + (attachment["fallback"] as string);
            }
          }
        }

        // Skip empty messages
        if (!text.trim()) {
          continue;
        }

        const timestamp: Date = msg["ts"]
          ? new Date(parseFloat(msg["ts"] as string) * 1000)
          : new Date();

        messages.push({
          messageId: msg["ts"] as string,
          text: text,
          userId: msg["user"] as string,
          username: msg["username"] as string,
          timestamp: timestamp,
          isBot: isBot,
        });
      }

      cursor = (jsonData["response_metadata"] as JSONObject)?.[
        "next_cursor"
      ] as string;
      pageCount++;
    } while (cursor && messages.length < maxMessages && pageCount < maxPages);

    logger.debug(
      `Retrieved ${messages.length} messages from Slack channel ${params.channelId}`,
      { channelId: params.channelId } as LogAttributes,
    );

    // Reverse to get chronological order (Slack returns newest first)
    messages.reverse();

    return messages;
  }
}
