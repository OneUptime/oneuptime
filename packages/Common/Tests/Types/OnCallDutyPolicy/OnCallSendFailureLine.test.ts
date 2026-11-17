import { describe, expect, test } from "@jest/globals";
import {
  getNotificationServiceAnswerLine,
  getNotificationServiceNotReachedLine,
  getOnCallCustomChannelSendFailedMessage,
  getOnCallSendFailedMessage,
  getOnCallWorkspaceDirectMessageFailedMessage,
  getOnCallWorkspaceSendFailedMessage,
  getWorkspaceAccountNotConnectedLine,
  getWorkspaceProjectNotConnectedLine,
  isNotificationServiceRefusal,
  isOnCallWorkspaceChannel,
  ON_CALL_CUSTOM_CHANNEL_FALLBACK_NAME,
  OnCallSendFailedChannel,
  readNotificationServiceAnswerLine,
  readNotificationServiceNotReachedLine,
  readOnCallSendFailedLine,
  readWorkspaceNotConnectedLine,
} from "../../../Types/OnCallDutyPolicy/OnCallSendFailureLine";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";
import {
  getProjectBalanceMessageNotSentReason,
  readProjectBalanceMessageNotSentReason,
} from "../../../Utils/Project/ProjectBalance";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";

/*
 * ISSUE #7550: THE LINES A PAGE'S MESSAGE SAYS WHEN IT WAS NOT SENT, IN
 * ONEUPTIME'S OWN WORDS - WRITTEN, AND READ BACK.
 *
 * Each line is written by the builder its writer uses (the Notification
 * service's answer, a request that never reached it, a send that failed
 * with no words, a workspace that is not connected) and reads word for
 * word as it was written before - operators grep their logs for these, and
 * rows in a database today hold them. Every line a builder writes is read
 * back into what it says, and nothing else is.
 */

describe("the English lines, word for word as they were written before", () => {
  test("a send that failed with no words of its own, by channel", () => {
    const lines: Record<OnCallSendFailedChannel, string> = {
      [OnCallPageChannel.Email]: "Error sending email.",
      [OnCallPageChannel.SMS]: "Error sending SMS.",
      [OnCallPageChannel.WhatsApp]: "Error sending WhatsApp message.",
      [OnCallPageChannel.Telegram]: "Error sending Telegram message.",
      [OnCallPageChannel.Webhook]: "Error sending webhook.",
      [OnCallPageChannel.Call]: "Error making call.",
      [OnCallPageChannel.Push]: "Error sending push notification.",
    };

    for (const [channel, line] of Object.entries(lines)) {
      expect(
        getOnCallSendFailedMessage(channel as OnCallSendFailedChannel),
      ).toBe(line);
    }
  });

  test("a workspace's message, by the workspace's name as people read it", () => {
    expect(
      getOnCallWorkspaceSendFailedMessage(
        getWorkspaceTypeDisplayName(WorkspaceType.MicrosoftTeams),
      ),
    ).toBe("Error sending Microsoft Teams message.");
    expect(
      getOnCallWorkspaceDirectMessageFailedMessage(
        getWorkspaceTypeDisplayName(WorkspaceType.Slack),
      ),
    ).toBe("Failed to send Slack direct message.");
    expect(
      getWorkspaceAccountNotConnectedLine(
        getWorkspaceTypeDisplayName(WorkspaceType.Mattermost),
      ),
    ).toBe(
      "This account is not connected to Mattermost. Please go to User Settings and connect the account.",
    );
    expect(
      getWorkspaceProjectNotConnectedLine(
        getWorkspaceTypeDisplayName(WorkspaceType.Slack),
      ),
    ).toBe(
      "This project is not connected to Slack. Please go to Project Settings and connect the account.",
    );
  });

  test("a custom channel's, by its name - or the custom channel, with none", () => {
    expect(getOnCallCustomChannelSendFailedMessage("Ops bridge")).toBe(
      "Error sending to Ops bridge.",
    );
    expect(getOnCallCustomChannelSendFailedMessage(undefined)).toBe(
      "Error sending to the custom channel.",
    );
    expect(getOnCallCustomChannelSendFailedMessage("")).toBe(
      `Error sending to ${ON_CALL_CUSTOM_CHANNEL_FALLBACK_NAME}.`,
    );
  });

  test("the Notification service's error answer: refused, or answered with an error, with its words", () => {
    expect(
      getNotificationServiceAnswerLine({
        statusCode: 400,
        words: "Email ana@ is not in valid format.",
      }),
    ).toBe(
      "The Notification service refused to send this (HTTP 400): Email ana@ is not in valid format.",
    );
    expect(
      getNotificationServiceAnswerLine({ statusCode: 404, words: "" }),
    ).toBe("The Notification service refused to send this (HTTP 404).");
    expect(
      getNotificationServiceAnswerLine({
        statusCode: 500,
        words: "Server Error",
      }),
    ).toBe(
      "The Notification service answered with an error (HTTP 500), so this may not have been sent: Server Error.",
    );
    expect(
      getNotificationServiceAnswerLine({ statusCode: null, words: "" }),
    ).toBe(
      "The Notification service answered with an error, so this may not have been sent.",
    );
    // Words that end a sentence already keep their own mark.
    expect(
      getNotificationServiceAnswerLine({
        statusCode: 502,
        words: "Bad gateway!",
      }),
    ).toBe(
      "The Notification service answered with an error (HTTP 502), so this may not have been sent: Bad gateway!",
    );
    expect(
      getNotificationServiceAnswerLine({ statusCode: 413, words: "Too long…" }),
    ).toBe(
      "The Notification service refused to send this (HTTP 413): Too long…",
    );
  });

  test("a request that never reached the Notification service", () => {
    expect(getNotificationServiceNotReachedLine("ECONNREFUSED")).toBe(
      "Could not reach the Notification service to send this (ECONNREFUSED).",
    );
  });

  test("only a 4xx is a refusal", () => {
    expect(isNotificationServiceRefusal(400)).toBe(true);
    expect(isNotificationServiceRefusal(499)).toBe(true);
    expect(isNotificationServiceRefusal(399)).toBe(false);
    expect(isNotificationServiceRefusal(500)).toBe(false);
    expect(isNotificationServiceRefusal(null)).toBe(false);
    expect(isNotificationServiceRefusal(undefined)).toBe(false);
  });
});

// Words that already end a sentence keep their own mark.
const SENTENCE_END_MARK: RegExp = /[.!?…]$/;

describe("every line a builder writes reads back into what it says", () => {
  test("an error answer, every shape of it", () => {
    for (const statusCode of [null, 400, 403, 422, 499, 500, 502, 503]) {
      for (const words of ["", "Server Error.", "Bad: gateway (twice)"]) {
        const line: string = getNotificationServiceAnswerLine({
          statusCode: statusCode,
          words: words,
        });
        const expectedWords: string = words
          ? SENTENCE_END_MARK.test(words)
            ? words
            : `${words}.`
          : "";

        expect([line, readNotificationServiceAnswerLine(line)]).toEqual([
          line,
          {
            isRefused: isNotificationServiceRefusal(statusCode),
            ...(statusCode !== null ? { statusCode: statusCode } : {}),
            ...(expectedWords ? { words: expectedWords } : {}),
          },
        ]);
      }
    }
  });

  test("a not-reached line gives its code back, and nothing else is one", () => {
    expect(
      readNotificationServiceNotReachedLine(
        getNotificationServiceNotReachedLine("ENOTFOUND"),
      ),
    ).toBe("ENOTFOUND");
    expect(
      readNotificationServiceNotReachedLine(
        "Could not reach the Notification service to send this ().",
      ),
    ).toBeNull();
    expect(
      readNotificationServiceNotReachedLine("Error sending SMS."),
    ).toBeNull();
    expect(readNotificationServiceNotReachedLine(null)).toBeNull();
  });

  test("a failed send, on its own channel only", () => {
    for (const channel of [
      OnCallPageChannel.Email,
      OnCallPageChannel.SMS,
      OnCallPageChannel.WhatsApp,
      OnCallPageChannel.Telegram,
      OnCallPageChannel.Webhook,
      OnCallPageChannel.Call,
      OnCallPageChannel.Push,
    ] as Array<OnCallSendFailedChannel>) {
      expect(
        readOnCallSendFailedLine({
          statusMessage: getOnCallSendFailedMessage(channel),
          channel: channel,
        }),
      ).toEqual({});

      for (const other of Object.values(OnCallPageChannel)) {
        if (other === channel) {
          continue;
        }

        expect([
          channel,
          other,
          readOnCallSendFailedLine({
            statusMessage: getOnCallSendFailedMessage(channel),
            channel: other,
          }),
        ]).toEqual([channel, other, null]);
      }
    }

    for (const workspace of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ]) {
      const name: string = getWorkspaceTypeDisplayName(workspace);

      expect(isOnCallWorkspaceChannel(name as OnCallPageChannel)).toBe(true);

      for (const line of [
        getOnCallWorkspaceSendFailedMessage(name),
        getOnCallWorkspaceDirectMessageFailedMessage(name),
      ]) {
        expect(
          readOnCallSendFailedLine({
            statusMessage: line,
            channel: name as OnCallPageChannel,
          }),
        ).toEqual({});
      }
    }

    expect(
      readOnCallSendFailedLine({
        statusMessage: getOnCallCustomChannelSendFailedMessage("PagerBridge"),
        channel: OnCallPageChannel.CustomChannel,
      }),
    ).toEqual({ name: "PagerBridge" });
    expect(
      readOnCallSendFailedLine({
        statusMessage: getOnCallCustomChannelSendFailedMessage(null),
        channel: OnCallPageChannel.CustomChannel,
      }),
    ).toEqual({});
    expect(
      readOnCallSendFailedLine({
        statusMessage: "Error sending SMS.",
        channel: null,
      }),
    ).toBeNull();
  });

  test("a workspace that is not connected: whose connection it is", () => {
    for (const workspace of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ]) {
      const name: string = getWorkspaceTypeDisplayName(workspace);

      expect(
        readWorkspaceNotConnectedLine({
          statusMessage: getWorkspaceProjectNotConnectedLine(name),
          channel: name as OnCallPageChannel,
        }),
      ).toEqual({ isProjectConnection: true });
      expect(
        readWorkspaceNotConnectedLine({
          statusMessage: getWorkspaceAccountNotConnectedLine(name),
          channel: name as OnCallPageChannel,
        }),
      ).toEqual({ isProjectConnection: false });
    }

    // Not a workspace's row.
    expect(
      readWorkspaceNotConnectedLine({
        statusMessage: getWorkspaceProjectNotConnectedLine("Slack"),
        channel: OnCallPageChannel.SMS,
      }),
    ).toBeNull();
  });

  test("a balance that could not pay for a message, by its channel", () => {
    for (const channel of Object.values(ProjectNotificationChannel)) {
      expect(
        readProjectBalanceMessageNotSentReason({
          statusMessage: getProjectBalanceMessageNotSentReason({
            channel: channel,
            balanceInUSDCents: 0,
            costInUSDCents: 10,
          }),
          channel: channel,
        }),
      ).toEqual({ isUsedUp: true });
      expect(
        readProjectBalanceMessageNotSentReason({
          statusMessage: getProjectBalanceMessageNotSentReason({
            channel: channel,
            balanceInUSDCents: 5,
            costInUSDCents: 120,
          }),
          channel: channel,
        }),
      ).toEqual({
        isUsedUp: false,
        balance: "0.05\u00A0USD",
        cost: "1.20\u00A0USD",
      });
    }

    expect(
      readProjectBalanceMessageNotSentReason({
        statusMessage: "This project's balance is used up.",
        channel: ProjectNotificationChannel.SMS,
      }),
    ).toBeNull();
  });
});
