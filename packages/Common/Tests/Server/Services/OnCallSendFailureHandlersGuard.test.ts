import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * WHAT A PAGE'S SEND DOES WITH A FAILURE (issue #6873).
 *
 * deliverNotificationForRule sends each notification of a page without
 * waiting for it - an email, an SMS, a call, a WhatsApp or Telegram message,
 * a webhook or a custom channel's request, through the Notification service;
 * a push or a Slack, Microsoft Teams or Mattermost message, in this process -
 * and hands the send's failure to a .catch. Each .catch once wrote Error on
 * the notification by id, whatever had happened: over a page that had gone
 * out, or that the person had acknowledged meanwhile, so the record's feed
 * said it could not page them.
 *
 * So every send of a page is held here to the handler of its kind
 * (OnCallSendFailure):
 *
 *  - a request to the Notification service: whenNotificationRequestFails,
 *    which reads what failed - never reached it, or no answer;
 *  - a send in this process: whenSendFails;
 *
 * each for the notification the send was handed, with words of its own for
 * a failure that has none. Nothing in the service writes a notification by
 * id, the senders' results are written over Sending only (App's CallService,
 * SmsService, WhatsAppService: recordSendResult), and a push's receipt as
 * any provider's report (ExpoPushReceiptService: recordProviderReport).
 *
 * Read with the TypeScript parser, so a new channel, or a handler written
 * inline again, fails here rather than on a person's timeline.
 */

// packages/Common/Tests/Server/Services -> packages/
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");

const RULE_SERVICE: string =
  "Common/Server/Services/UserNotificationRuleService.ts";

const REQUEST_HANDLER: string = "whenNotificationRequestFails";
const IN_PROCESS_HANDLER: string = "whenSendFails";

interface PageSender {
  handler: string;
  // How many times deliverNotificationForRule sends this way: one per event type.
  sends: number;
}

/*
 * Every way a page is sent, by the call that sends it. A new one has to be
 * put here, so whoever adds it decides which kind it is.
 */
const PAGE_SENDERS: Record<string, PageSender> = {
  "MailService.sendMail": { handler: REQUEST_HANDLER, sends: 4 },
  "SmsService.sendSms": { handler: REQUEST_HANDLER, sends: 4 },
  "WhatsAppService.sendWhatsAppMessage": { handler: REQUEST_HANDLER, sends: 4 },
  "TelegramService.sendTelegramMessage": { handler: REQUEST_HANDLER, sends: 4 },
  "WebhookService.sendWebhook": { handler: REQUEST_HANDLER, sends: 1 },
  "CallService.makeCall": { handler: REQUEST_HANDLER, sends: 4 },
  "CustomNotificationChannelDeliveryService.send": {
    handler: REQUEST_HANDLER,
    sends: 1,
  },
  "PushNotificationService.sendPushNotification": {
    handler: IN_PROCESS_HANDLER,
    sends: 4,
  },
  "WorkspaceUserNotificationService.sendDirectMessageToUser": {
    handler: IN_PROCESS_HANDLER,
    sends: 1,
  },
};

const WHITE_SPACE_RUN: RegExp = /\s+/g;

function read(file: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, file), "utf8");
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
}

function textOf(node: ts.Node): string {
  return node.getText().replace(WHITE_SPACE_RUN, "");
}

function everyCall(source: ts.SourceFile): Array<ts.CallExpression> {
  const calls: Array<ts.CallExpression> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      calls.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

// The calls of `<callee>(...)`, as written, in a file.
function callsOf(
  source: ts.SourceFile,
  callee: string,
): Array<ts.CallExpression> {
  return everyCall(source).filter((call: ts.CallExpression) => {
    return textOf(call.expression) === callee;
  });
}

// A property of an object literal, by name, or null.
function propertyOf(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  for (const property of literal.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property;
    }
  }

  return null;
}

// The notification a send was handed: its options' userOnCallLogTimelineId.
function notificationSentFor(send: ts.CallExpression): string | null {
  for (const argument of send.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) {
      continue;
    }

    const property: ts.PropertyAssignment | null = propertyOf(
      argument,
      "userOnCallLogTimelineId",
    );

    if (property) {
      return textOf(property.initializer);
    }
  }

  return null;
}

interface PageSend {
  sender: string;
  line: number;
  send: ts.CallExpression;
  // The `.catch(...)` the send is handed to, or null.
  catchCall: ts.CallExpression | null;
}

function pageSends(source: ts.SourceFile): Array<PageSend> {
  return everyCall(source)
    .filter((call: ts.CallExpression) => {
      return textOf(call.expression) in PAGE_SENDERS;
    })
    .map((send: ts.CallExpression): PageSend => {
      const parent: ts.Node = send.parent;
      const catchCall: ts.CallExpression | null =
        ts.isPropertyAccessExpression(parent) &&
        parent.name.getText() === "catch" &&
        ts.isCallExpression(parent.parent)
          ? parent.parent
          : null;

      return {
        sender: textOf(send.expression),
        line: source.getLineAndCharacterOfPosition(send.getStart()).line + 1,
        send: send,
        catchCall: catchCall,
      };
    });
}

describe("every send of a page hands its failure to the handler of its kind", () => {
  const source: ts.SourceFile = parse(RULE_SERVICE);
  const sends: Array<PageSend> = pageSends(source);

  test("every way of sending is there, as often as there are event types for it", () => {
    const counted: Record<string, number> = {};

    for (const send of sends) {
      counted[send.sender] = (counted[send.sender] || 0) + 1;
    }

    const expected: Record<string, number> = {};

    for (const [sender, pageSender] of Object.entries(PAGE_SENDERS)) {
      expected[sender] = pageSender.sends;
    }

    expect(counted).toEqual(expected);
  });

  test.each(Object.keys(PAGE_SENDERS))(
    "%s: each send is caught by its kind's handler, for the notification it was handed, with words of its own",
    (sender: string) => {
      const expectedHandler: string = PAGE_SENDERS[sender]!.handler;

      for (const send of sends.filter((pageSend: PageSend) => {
        return pageSend.sender === sender;
      })) {
        const where: string = `${RULE_SERVICE}:${send.line} (${sender})`;

        expect({ where, caught: Boolean(send.catchCall) }).toEqual({
          where,
          caught: true,
        });

        const catchCall: ts.CallExpression = send.catchCall!;

        expect({ where, arguments: catchCall.arguments.length }).toEqual({
          where,
          arguments: 1,
        });

        const handler: ts.Expression = catchCall.arguments[0]!;

        // A call of the handler - never a function written inline again.
        expect({
          where,
          handler: ts.isCallExpression(handler)
            ? textOf(handler.expression)
            : textOf(handler).substring(0, 60),
        }).toEqual({ where, handler: expectedHandler });

        const handlerCall: ts.CallExpression = handler as ts.CallExpression;
        const options: ts.Expression | undefined = handlerCall.arguments[0];

        expect({
          where,
          options:
            handlerCall.arguments.length === 1 &&
            Boolean(options && ts.isObjectLiteralExpression(options)),
        }).toEqual({ where, options: true });

        const literal: ts.ObjectLiteralExpression =
          options as ts.ObjectLiteralExpression;

        expect({
          where,
          properties: literal.properties
            .map((property: ts.ObjectLiteralElementLike) => {
              return property.name?.getText() || "";
            })
            .sort(),
        }).toEqual({
          where,
          properties: ["fallbackStatusMessage", "userOnCallLogTimelineId"],
        });

        // The notification the send was handed, and no other.
        const notification: string | null = notificationSentFor(send.send);

        expect({ where, notification }).toEqual({
          where,
          notification: textOf(
            propertyOf(literal, "userOnCallLogTimelineId")!.initializer,
          ),
        });
        expect(notification).not.toBeNull();

        // Words of its own: a string that names the channel.
        const fallback: ts.Expression = propertyOf(
          literal,
          "fallbackStatusMessage",
        )!.initializer;

        expect({
          where,
          fallback:
            (ts.isStringLiteral(fallback) && fallback.text.length > 0) ||
            ts.isTemplateExpression(fallback),
        }).toEqual({ where, fallback: true });
      }
    },
  );

  test("the handlers are the ones OnCallSendFailure gives, and used for nothing else", () => {
    const text: string = read(RULE_SERVICE);

    expect(text).toMatch(
      /import \{\s*whenNotificationRequestFails,\s*whenSendFails,\s*\} from "\.\.\/Utils\/OnCall\/OnCallSendFailure";/,
    );
    expect(callsOf(source, REQUEST_HANDLER)).toHaveLength(22);
    expect(callsOf(source, IN_PROCESS_HANDLER)).toHaveLength(5);
  });

  test("nothing in the service writes a notification by id: its status is written over what it may move on from", () => {
    expect(
      callsOf(source, "UserOnCallLogTimelineService.updateOneById"),
    ).toEqual([]);
    expect(callsOf(source, "UserOnCallLogTimelineService.updateBy")).toEqual(
      [],
    );
  });
});

describe("the results and reports written after a send", () => {
  test.each([
    "App/FeatureSet/Notification/Services/CallService.ts",
    "App/FeatureSet/Notification/Services/SmsService.ts",
    "App/FeatureSet/Notification/Services/WhatsAppService.ts",
  ])(
    "%s writes the send's result over Sending only (recordSendResult), never by id",
    (file: string) => {
      const source: ts.SourceFile = parse(file);

      expect(callsOf(source, "recordSendResult").length).toBeGreaterThan(0);
      expect(
        callsOf(source, "UserOnCallLogTimelineService.updateOneById"),
      ).toEqual([]);
      expect(read(file)).toContain(
        'from "Common/Server/Utils/OnCall/OnCallNotificationStatus";',
      );
    },
  );

  test("App's CallService writes Sent for a call that went out, and Error for one that did not", () => {
    const source: ts.SourceFile = parse(
      "App/FeatureSet/Notification/Services/CallService.ts",
    );
    const results: Array<string> = callsOf(source, "recordSendResult").map(
      (call: ts.CallExpression) => {
        return textOf(call);
      },
    );

    expect(results).toEqual([
      expect.stringContaining("isSent:callLog.status===CallStatus.Success"),
    ]);
  });

  test("a push's receipt is written as a provider's report (recordProviderReport), never by query of its own", () => {
    const file: string = "Common/Server/Services/ExpoPushReceiptService.ts";
    const source: ts.SourceFile = parse(file);

    expect(callsOf(source, "recordProviderReport")).toHaveLength(1);
    expect(callsOf(source, "UserOnCallLogTimelineService.updateOneBy")).toEqual(
      [],
    );
    expect(read(file)).not.toContain("UserOnCallLogTimelineService");
  });
});
