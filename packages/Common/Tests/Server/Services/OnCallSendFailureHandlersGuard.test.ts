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
 * and hands the send's failure to a .catch; so does a test page
 * (OnCallTestPageDelivery), on each method of the rule. Each .catch once
 * wrote Error on the notification by id, whatever had happened: over a page
 * that had gone out, or that the person had acknowledged meanwhile, so the
 * record's feed said it could not page them.
 *
 * So every send of a page is held here to the handler of its kind
 * (OnCallSendFailure):
 *
 *  - a request to the Notification service: whenNotificationRequestFails,
 *    which reads what failed - never reached it, or no answer;
 *  - a send in this process: whenSendFails;
 *
 * each for the notification the send was handed, with words of its own for
 * a failure that has none. Nothing that sends a page writes a notification
 * by id, the senders' results are written over Sending only (App's
 * CallService, SmsService, WhatsAppService: recordSendResult), and a push's
 * receipt as any provider's report (ExpoPushReceiptService:
 * recordProviderReport).
 *
 * Read with the TypeScript parser, so a new channel, or a handler written
 * inline again, fails here rather than on a person's timeline.
 */

// packages/Common/Tests/Server/Services -> packages/
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");

const REQUEST_HANDLER: string = "whenNotificationRequestFails";
const IN_PROCESS_HANDLER: string = "whenSendFails";

/*
 * Every way a page is sent, by the call that sends it, and the handler of
 * its kind. A new one has to be put here, so whoever adds it decides which
 * kind it is.
 */
const SENDER_HANDLERS: Record<string, string> = {
  "MailService.sendMail": REQUEST_HANDLER,
  "SmsService.sendSms": REQUEST_HANDLER,
  "WhatsAppService.sendWhatsAppMessage": REQUEST_HANDLER,
  "TelegramService.sendTelegramMessage": REQUEST_HANDLER,
  "WebhookService.sendWebhook": REQUEST_HANDLER,
  "CallService.makeCall": REQUEST_HANDLER,
  "CustomNotificationChannelDeliveryService.send": REQUEST_HANDLER,
  "PushNotificationService.sendPushNotification": IN_PROCESS_HANDLER,
  "WorkspaceUserNotificationService.sendDirectMessageToUser":
    IN_PROCESS_HANDLER,
};

interface PageSendingFile {
  file: string;
  // Where it imports the handlers from, as written.
  handlersFrom: string;
  // How many times it sends each way.
  sends: Record<string, number>;
}

// Every way of sending, once: a test page sends once on each method.
const ONCE_EACH: Record<string, number> = {};

for (const sender of Object.keys(SENDER_HANDLERS)) {
  ONCE_EACH[sender] = 1;
}

const PAGE_SENDING_FILES: Array<PageSendingFile> = [
  {
    // deliverNotificationForRule: once for each event type it pages about.
    file: "Common/Server/Services/UserNotificationRuleService.ts",
    handlersFrom: "../Utils/OnCall/OnCallSendFailure",
    sends: {
      "MailService.sendMail": 4,
      "SmsService.sendSms": 4,
      "WhatsAppService.sendWhatsAppMessage": 4,
      "TelegramService.sendTelegramMessage": 4,
      "WebhookService.sendWebhook": 1,
      "CallService.makeCall": 4,
      "CustomNotificationChannelDeliveryService.send": 1,
      "PushNotificationService.sendPushNotification": 4,
      "WorkspaceUserNotificationService.sendDirectMessageToUser": 1,
    },
  },
  {
    // A test page (OnCallTestPage).
    file: "Common/Server/Utils/OnCall/OnCallTestPageDelivery.ts",
    handlersFrom: "./OnCallSendFailure",
    sends: ONCE_EACH,
  },
];

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

// The names a file imports from a module, as written.
function namesImportedFrom(source: ts.SourceFile, from: string): Array<string> {
  const names: Array<string> = [];

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== from
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        names.push(element.name.getText());
      }
    }
  }

  return names.sort();
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
      return textOf(call.expression) in SENDER_HANDLERS;
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

// How many sends of a file are of a handler's kind.
function sendsHandledBy(
  pageSendingFile: PageSendingFile,
  handler: string,
): number {
  return Object.entries(pageSendingFile.sends)
    .filter(([sender]: [string, number]) => {
      return SENDER_HANDLERS[sender] === handler;
    })
    .reduce((total: number, [, count]: [string, number]) => {
      return total + count;
    }, 0);
}

describe.each(PAGE_SENDING_FILES)(
  "$file: every send of a page hands its failure to the handler of its kind",
  (pageSendingFile: PageSendingFile) => {
    const file: string = pageSendingFile.file;
    const source: ts.SourceFile = parse(file);
    const sends: Array<PageSend> = pageSends(source);

    test("every way of sending is there, as often as it pages that way", () => {
      const counted: Record<string, number> = {};

      for (const send of sends) {
        counted[send.sender] = (counted[send.sender] || 0) + 1;
      }

      expect(counted).toEqual(pageSendingFile.sends);
    });

    test.each(Object.keys(SENDER_HANDLERS))(
      "%s: each send is caught by its kind's handler, for the notification it was handed, with words of its own",
      (sender: string) => {
        const expectedHandler: string = SENDER_HANDLERS[sender]!;

        for (const send of sends.filter((pageSend: PageSend) => {
          return pageSend.sender === sender;
        })) {
          const where: string = `${file}:${send.line} (${sender})`;

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
      expect(namesImportedFrom(source, pageSendingFile.handlersFrom)).toEqual(
        [REQUEST_HANDLER, IN_PROCESS_HANDLER].sort(),
      );
      expect(callsOf(source, REQUEST_HANDLER)).toHaveLength(
        sendsHandledBy(pageSendingFile, REQUEST_HANDLER),
      );
      expect(callsOf(source, IN_PROCESS_HANDLER)).toHaveLength(
        sendsHandledBy(pageSendingFile, IN_PROCESS_HANDLER),
      );
    });

    test("nothing in it writes a notification by id: its status is written over what it may move on from", () => {
      expect(
        callsOf(source, "UserOnCallLogTimelineService.updateOneById"),
      ).toEqual([]);
      expect(callsOf(source, "UserOnCallLogTimelineService.updateBy")).toEqual(
        [],
      );
    });
  },
);

describe("what the files are held to", () => {
  test("the rule service's sends: 22 requests to the Notification service, 5 sends in this process", () => {
    expect(sendsHandledBy(PAGE_SENDING_FILES[0]!, REQUEST_HANDLER)).toBe(22);
    expect(sendsHandledBy(PAGE_SENDING_FILES[0]!, IN_PROCESS_HANDLER)).toBe(5);
  });

  test("a test page's sends: 7 requests to the Notification service, 2 sends in this process", () => {
    expect(sendsHandledBy(PAGE_SENDING_FILES[1]!, REQUEST_HANDLER)).toBe(7);
    expect(sendsHandledBy(PAGE_SENDING_FILES[1]!, IN_PROCESS_HANDLER)).toBe(2);
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
