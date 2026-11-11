import { describe, expect, test } from "@jest/globals";
import { ServerSendingChannel } from "../../../Types/ServerSending/ServerSendingStatus";
import {
  getServerTestSendSentence,
  getServerTestSendTitle,
  MAX_SERVER_TEST_SEND_MESSAGE_LENGTH,
  parseServerTestSendAnswer,
  SERVER_TEST_SEND_CHANNELS,
  SERVER_TEST_SEND_ROUTE,
  SERVER_TEST_SEND_WORDS,
  ServerTestSendAnswer,
  ServerTestSendResult,
  toServerTestSendMessage,
} from "../../../Types/ServerSetup/ServerTestSend";
import {
  fillTemplate,
  getTemplatePlaceholders,
} from "../../../Types/Translator";

/*
 * A TEST SEND, AND WHAT IT ANSWERED, IN WORDS (#6824).
 *
 * "Send test email", "Send test SMS" and "Make test call" each answer one of
 * three things: accepted (by what), refused (and what the provider said),
 * or not set up (and what is missing). The sentence for each fills only the
 * values it names, and what a browser reads back is held to channels and
 * results that exist, the provider's words cut to a length a page can show.
 */

function answer(
  overrides: Partial<ServerTestSendAnswer> = {},
): ServerTestSendAnswer {
  return {
    channel: ServerSendingChannel.Email,
    result: ServerTestSendResult.Accepted,
    to: "ada@example.com",
    sentThrough: "smtp.example.com",
    message: null,
    ...overrides,
  };
}

describe("where and on what", () => {
  test("email, SMS and calls, at /server-test/<channel>", () => {
    expect([...SERVER_TEST_SEND_CHANNELS]).toEqual([
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
    ]);
    expect(SERVER_TEST_SEND_ROUTE).toBe("/server-test");
  });

  test("each button says what it does", () => {
    expect(getServerTestSendTitle(ServerSendingChannel.Email)).toBe(
      "Send test email",
    );
    expect(getServerTestSendTitle(ServerSendingChannel.SMS)).toBe(
      "Send test SMS",
    );
    expect(getServerTestSendTitle(ServerSendingChannel.Call)).toBe(
      "Make test call",
    );
  });
});

describe("what an answer says", () => {
  test("accepted names what took it and where it went; for email, where to look if it does not arrive", () => {
    const email: { template: string; values: Record<string, string> } =
      getServerTestSendSentence(answer());

    expect(fillTemplate(email.template, email.values)).toBe(
      "smtp.example.com accepted the test email to ada@example.com. If it does not arrive, look in the spam folder and in the mail server's logs.",
    );

    const sms: { template: string; values: Record<string, string> } =
      getServerTestSendSentence(
        answer({
          channel: ServerSendingChannel.SMS,
          to: "+14155550100",
          sentThrough: "Twilio",
        }),
      );

    expect(fillTemplate(sms.template, sms.values)).toBe(
      "Twilio accepted the test SMS to +14155550100.",
    );

    const call: { template: string; values: Record<string, string> } =
      getServerTestSendSentence(
        answer({
          channel: ServerSendingChannel.Call,
          to: "+14155550100",
          sentThrough: "sms.example.com",
        }),
      );

    expect(fillTemplate(call.template, call.values)).toBe(
      "sms.example.com accepted the test call to +14155550100.",
    );
  });

  test("refused says what the provider said", () => {
    const refused: { template: string; values: Record<string, string> } =
      getServerTestSendSentence(
        answer({
          result: ServerTestSendResult.Refused,
          message: "535 5.7.8 Username and Password not accepted",
        }),
      );

    expect(fillTemplate(refused.template, refused.values)).toBe(
      "smtp.example.com refused it: 535 5.7.8 Username and Password not accepted",
    );
  });

  test("not set up says nothing was sent, and what is missing", () => {
    const notSetUp: { template: string; values: Record<string, string> } =
      getServerTestSendSentence(
        answer({
          result: ServerTestSendResult.NotSetUp,
          sentThrough: null,
          message: "SMTP: the Port is not set under Settings > Emails.",
        }),
      );

    expect(fillTemplate(notSetUp.template, notSetUp.values)).toBe(
      "Nothing was sent: SMTP: the Port is not set under Settings > Emails.",
    );
  });

  test("with no provider or reason, the sentence still reads whole", () => {
    const refused: { template: string; values: Record<string, string> } =
      getServerTestSendSentence(
        answer({
          result: ServerTestSendResult.Refused,
          sentThrough: null,
          message: null,
        }),
      );

    expect(fillTemplate(refused.template, refused.values)).toBe(
      "The provider refused it: No reason was given.",
    );
  });

  test("every sentence fills exactly the values it is handed", () => {
    for (const channel of SERVER_TEST_SEND_CHANNELS) {
      for (const result of Object.values(ServerTestSendResult)) {
        const sentence: { template: string; values: Record<string, string> } =
          getServerTestSendSentence(answer({ channel, result }));

        expect(getTemplatePlaceholders(sentence.template).sort()).toEqual(
          Object.keys(sentence.values).sort(),
        );
      }
    }

    for (const template of Object.values(SERVER_TEST_SEND_WORDS)) {
      for (const placeholder of getTemplatePlaceholders(template)) {
        expect(["sentThrough", "to", "reason"]).toContain(placeholder);
      }
    }
  });
});

describe("read back in a browser", () => {
  test("an answer reads back whole", () => {
    const sent: ServerTestSendAnswer = answer({
      result: ServerTestSendResult.Refused,
      message: "421 Try again later",
    });

    expect(parseServerTestSendAnswer(JSON.parse(JSON.stringify(sent)))).toEqual(
      sent,
    );
  });

  test("anything that is not an answer reads as none", () => {
    for (const value of [
      null,
      "accepted",
      [],
      {},
      { channel: "push", result: "accepted" },
      { channel: "email", result: "delivered" },
    ]) {
      expect(parseServerTestSendAnswer(value)).toBeNull();
    }
  });

  test("the provider's words are cut to what a page shows, and blank reads as none", () => {
    const long: string = "x".repeat(MAX_SERVER_TEST_SEND_MESSAGE_LENGTH * 3);

    expect(toServerTestSendMessage(long)).toHaveLength(
      MAX_SERVER_TEST_SEND_MESSAGE_LENGTH,
    );
    expect(toServerTestSendMessage("   ")).toBeNull();
    expect(toServerTestSendMessage(3)).toBeNull();
    expect(
      parseServerTestSendAnswer({
        channel: "sms",
        result: "refused",
        to: 4,
        message: long,
      }),
    ).toEqual({
      channel: ServerSendingChannel.SMS,
      result: ServerTestSendResult.Refused,
      to: "",
      sentThrough: null,
      message: "x".repeat(MAX_SERVER_TEST_SEND_MESSAGE_LENGTH),
    });
  });
});
