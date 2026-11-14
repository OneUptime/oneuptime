import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * WHAT A PAGE'S SEND DOES WITH A FAILURE, AND WITH AN ANSWER (issues #6873,
 * #7082, #7083).
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
 * a failure that has none. A request the Notification service answered with
 * an error does not throw: its answer is handed back. So every such request
 * hands its answer, first, to whenNotificationRequestAnswers, for the same
 * notification (issue #7083) - but a custom channel's, whose client reads
 * the answer itself (CustomNotificationChannelDeliveryService).
 *
 * Nothing writes a notification's status but OnCallNotificationStatus, at
 * the status and the version read (issue #7082): every sender's result over
 * Sending only (recordSendResult), a provider's report as such
 * (recordProviderReport), the person's acknowledgement and escalation as
 * answers (recordAcknowledgement, recordPassOn) - so an answer is never
 * written over by a send that finished late. The one other write - the
 * settling, once, of the notifications left Sending before the stuck check
 * existed (issue #7085) - is the stuck check's own, over Sending only, in
 * its statement.
 *
 * Read with the TypeScript parser, so a new channel, a handler written
 * inline again, or a write of a notification by id fails here rather than
 * on a person's timeline. ee/ is read when it is there: the open-source
 * build has none.
 */

// packages/Common/Tests/Server/Services -> packages/
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");
// packages/ -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const REQUEST_HANDLER: string = "whenNotificationRequestFails";
const IN_PROCESS_HANDLER: string = "whenSendFails";
const ANSWER_HANDLER: string = "whenNotificationRequestAnswers";

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

/*
 * The requests whose answer the send hands to ANSWER_HANDLER: every request
 * to the Notification service but a custom channel's, whose client reads
 * its own answer, and hands back how it went, not the answer.
 */
const SENDERS_ANSWERED_WHERE_SENT: Array<string> = Object.keys(
  SENDER_HANDLERS,
).filter((sender: string) => {
  return (
    SENDER_HANDLERS[sender] === REQUEST_HANDLER &&
    sender !== "CustomNotificationChannelDeliveryService.send"
  );
});

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

// A write of a row through the service: updateOneById, updateBy, updateOneBy, ...
const UPDATE_METHOD: RegExp = /^update[A-Za-z]*$/;

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "coverage",
  ".git",
];

function read(file: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, file), "utf8");
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
}

function parseAt(fullPath: string): ts.SourceFile {
  return ts.createSourceFile(
    fullPath,
    fs.readFileSync(fullPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
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

// The calls of `<target>.update...(...)` in a file, as `target.method`.
function updatesThrough(source: ts.SourceFile, target: string): Array<string> {
  return everyCall(source)
    .filter((call: ts.CallExpression) => {
      return (
        ts.isPropertyAccessExpression(call.expression) &&
        textOf(call.expression.expression) === target &&
        UPDATE_METHOD.test(call.expression.name.getText())
      );
    })
    .map((call: ts.CallExpression) => {
      return textOf(call.expression);
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

// The module a file imports a name from, as written, or null.
function moduleImportedFrom(
  source: ts.SourceFile,
  name: string,
): string | null {
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element: ts.ImportSpecifier) => {
        return element.name.getText() === name;
      })
    ) {
      return statement.moduleSpecifier.text;
    }
  }

  return null;
}

// The module that writes a notification's status, under packages/.
const NOTIFICATION_STATUS_MODULE: string =
  "Common/Server/Utils/OnCall/OnCallNotificationStatus";

/*
 * Where an import of a file under packages/ leads, under packages/: a
 * relative one from the file's folder, a package's (Common/...) as it is.
 */
function moduleResolvedFrom(file: string, from: string | null): string | null {
  if (from === null) {
    return null;
  }

  if (!from.startsWith(".")) {
    return from;
  }

  return path
    .relative(
      PACKAGES_DIR,
      path.resolve(path.join(PACKAGES_DIR, path.dirname(file)), from),
    )
    .split(path.sep)
    .join("/");
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

// The names of an object literal's properties, sorted.
function propertyNames(literal: ts.ObjectLiteralExpression): Array<string> {
  return literal.properties
    .map((property: ts.ObjectLiteralElementLike) => {
      return property.name?.getText() || "";
    })
    .sort();
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

// The call of `.<method>(...)` made on what `expression` gives, or null.
function methodCalledOn(
  expression: ts.Expression,
  method: string,
): ts.CallExpression | null {
  const parent: ts.Node = expression.parent;

  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === expression &&
    parent.name.getText() === method &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return parent.parent;
  }

  return null;
}

interface PageSend {
  sender: string;
  line: number;
  send: ts.CallExpression;
  // The `.then(...)` the send's answer is handed to, or null.
  thenCall: ts.CallExpression | null;
  // The `.catch(...)` the send - after its `.then`, if any - is handed to, or null.
  catchCall: ts.CallExpression | null;
}

function pageSends(source: ts.SourceFile): Array<PageSend> {
  return everyCall(source)
    .filter((call: ts.CallExpression) => {
      return textOf(call.expression) in SENDER_HANDLERS;
    })
    .map((send: ts.CallExpression): PageSend => {
      const thenCall: ts.CallExpression | null = methodCalledOn(send, "then");

      return {
        sender: textOf(send.expression),
        line: source.getLineAndCharacterOfPosition(send.getStart()).line + 1,
        send: send,
        thenCall: thenCall,
        catchCall: methodCalledOn(thenCall || send, "catch"),
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

// How many sends of a file hand their answer to ANSWER_HANDLER.
function sendsAnsweredWhereSent(pageSendingFile: PageSendingFile): number {
  return Object.entries(pageSendingFile.sends)
    .filter(([sender]: [string, number]) => {
      return SENDERS_ANSWERED_WHERE_SENT.includes(sender);
    })
    .reduce((total: number, [, count]: [string, number]) => {
      return total + count;
    }, 0);
}

/*
 * The source files under a directory, relative to the repository root: no
 * tests, no declarations, nothing built or installed. None when the
 * directory is not there (ee/, on the open-source build).
 */
function sourceFilesUnder(directory: string): Array<string> {
  const fullDirectory: string = path.join(REPOSITORY_ROOT, directory);

  if (!fs.existsSync(fullDirectory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(fullDirectory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.includes(entry.name)) {
      continue;
    }

    const relativePath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(relativePath));
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name)
    ) {
      files.push(relativePath);
    }
  }

  return files;
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
            properties: propertyNames(literal),
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

    test.each(Object.keys(SENDER_HANDLERS))(
      "%s: an error answer is read where it is sent, for the notification it was handed - or by the one who reads it",
      (sender: string) => {
        const isAnsweredWhereSent: boolean =
          SENDERS_ANSWERED_WHERE_SENT.includes(sender);

        for (const send of sends.filter((pageSend: PageSend) => {
          return pageSend.sender === sender;
        })) {
          const where: string = `${file}:${send.line} (${sender})`;

          if (!isAnsweredWhereSent) {
            // A send in this process, or a custom channel's: nothing to hand on.
            expect({ where, then: Boolean(send.thenCall) }).toEqual({
              where,
              then: false,
            });
            continue;
          }

          expect({ where, then: Boolean(send.thenCall) }).toEqual({
            where,
            then: true,
          });

          const thenCall: ts.CallExpression = send.thenCall!;
          const handler: ts.Expression | undefined = thenCall.arguments[0];

          // One argument: a call of the answer handler, never one written inline.
          expect({
            where,
            arguments: thenCall.arguments.length,
            handler:
              handler && ts.isCallExpression(handler)
                ? textOf(handler.expression)
                : textOf(handler || thenCall).substring(0, 60),
          }).toEqual({ where, arguments: 1, handler: ANSWER_HANDLER });

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

          expect({ where, properties: propertyNames(literal) }).toEqual({
            where,
            properties: ["userOnCallLogTimelineId"],
          });

          // The notification the send was handed, and no other.
          expect({
            where,
            notification: textOf(
              propertyOf(literal, "userOnCallLogTimelineId")!.initializer,
            ),
          }).toEqual({ where, notification: notificationSentFor(send.send) });
        }
      },
    );

    test("the handlers are the ones OnCallSendFailure gives, and used for nothing else", () => {
      expect(namesImportedFrom(source, pageSendingFile.handlersFrom)).toEqual(
        [ANSWER_HANDLER, REQUEST_HANDLER, IN_PROCESS_HANDLER].sort(),
      );
      expect(callsOf(source, REQUEST_HANDLER)).toHaveLength(
        sendsHandledBy(pageSendingFile, REQUEST_HANDLER),
      );
      expect(callsOf(source, IN_PROCESS_HANDLER)).toHaveLength(
        sendsHandledBy(pageSendingFile, IN_PROCESS_HANDLER),
      );
      expect(callsOf(source, ANSWER_HANDLER)).toHaveLength(
        sendsAnsweredWhereSent(pageSendingFile),
      );
    });

    test("nothing in it writes a notification by id: its status is written over what it may move on from", () => {
      expect(updatesThrough(source, "UserOnCallLogTimelineService")).toEqual(
        [],
      );
    });
  },
);

describe("what the files are held to", () => {
  test("the rule service's sends: 22 requests to the Notification service, 21 of them answered where sent, 5 sends in this process", () => {
    expect(sendsHandledBy(PAGE_SENDING_FILES[0]!, REQUEST_HANDLER)).toBe(22);
    expect(sendsAnsweredWhereSent(PAGE_SENDING_FILES[0]!)).toBe(21);
    expect(sendsHandledBy(PAGE_SENDING_FILES[0]!, IN_PROCESS_HANDLER)).toBe(5);
  });

  test("a test page's sends: 7 requests to the Notification service, 6 of them answered where sent, 2 sends in this process", () => {
    expect(sendsHandledBy(PAGE_SENDING_FILES[1]!, REQUEST_HANDLER)).toBe(7);
    expect(sendsAnsweredWhereSent(PAGE_SENDING_FILES[1]!)).toBe(6);
    expect(sendsHandledBy(PAGE_SENDING_FILES[1]!, IN_PROCESS_HANDLER)).toBe(2);
  });

  test("the requests answered where sent: every request to the Notification service but a custom channel's", () => {
    expect([...SENDERS_ANSWERED_WHERE_SENT].sort()).toEqual(
      [
        "CallService.makeCall",
        "MailService.sendMail",
        "SmsService.sendSms",
        "TelegramService.sendTelegramMessage",
        "WebhookService.sendWebhook",
        "WhatsAppService.sendWhatsAppMessage",
      ].sort(),
    );
  });
});

describe("a custom channel's client reads its own answer", () => {
  const file: string =
    "Common/Server/Services/CustomNotificationChannelDeliveryService.ts";
  const source: ts.SourceFile = parse(file);

  test("an error answer is written on the notification, once, through OnCallSendFailure", () => {
    expect(callsOf(source, "recordNotificationRequestAnswer")).toHaveLength(1);
    expect(moduleImportedFrom(source, "recordNotificationRequestAnswer")).toBe(
      "../Utils/OnCall/OnCallSendFailure",
    );
    expect(updatesThrough(source, "UserOnCallLogTimelineService")).toEqual([]);
  });

  test("a test is never written: the answer's words go back to whoever tested", () => {
    const answerCall: ts.CallExpression = callsOf(
      source,
      "recordNotificationRequestAnswer",
    )[0]!;

    // Inside `if (data.userOnCallLogTimelineId && !data.isTest)`.
    let node: ts.Node = answerCall;
    let guard: string | null = null;

    while (node.parent && !ts.isSourceFile(node.parent)) {
      node = node.parent;

      if (ts.isIfStatement(node)) {
        guard = textOf(node.expression);
        break;
      }
    }

    expect(guard).toBe("data.userOnCallLogTimelineId&&!data.isTest");
  });
});

/*
 * Every place a send's result, or the person's answer, is written: each
 * through OnCallNotificationStatus, by the function for what it is.
 */
interface StatusWriter {
  file: string;
  // The OnCallNotificationStatus function it writes with, and how often.
  writes: Record<string, number>;
}

const STATUS_WRITERS: Array<StatusWriter> = [
  // The senders' results (recordSendResult): over Sending only.
  {
    file: "App/FeatureSet/Notification/Services/CallService.ts",
    writes: { recordSendResult: 1 },
  },
  {
    file: "App/FeatureSet/Notification/Services/SmsService.ts",
    writes: { recordSendResult: 1 },
  },
  {
    file: "App/FeatureSet/Notification/Services/WhatsAppService.ts",
    writes: { recordSendResult: 1 },
  },
  {
    file: "App/FeatureSet/Notification/Services/MailService.ts",
    writes: { recordSendResult: 2 },
  },
  {
    file: "App/FeatureSet/Notification/Services/TelegramService.ts",
    writes: { recordSendResult: 1 },
  },
  {
    file: "App/FeatureSet/Notification/Services/WebhookService.ts",
    writes: { recordSendResult: 1 },
  },
  {
    file: "Common/Server/Services/PushNotificationService.ts",
    writes: { recordSendResult: 1 },
  },
  {
    file: "Common/Server/Services/WorkspaceUserNotificationService.ts",
    writes: { recordSendResult: 1 },
  },
  // A send refused before it went out (markNotSent).
  {
    file: "Common/Server/Services/UserOnCallLogTimelineService.ts",
    writes: { recordSendResult: 1 },
  },
  // The person's answers: the acknowledge link, a call's 1, a test page's link.
  {
    file: "Common/Server/API/UserOnCallLogTimelineAPI.ts",
    writes: { recordAcknowledgement: 3 },
  },
  // A custom channel's (or a gateway's) Acknowledge.
  {
    file: "Common/Server/Utils/OnCall/CustomChannelActions.ts",
    writes: { recordAcknowledgement: 1 },
  },
  // Escalating the page from a notification.
  {
    file: "Common/Server/Utils/OnCall/OnCallPagePassOn.ts",
    writes: { recordPassOn: 1 },
  },
];

// ee's sender of a custom channel's request, when ee/ is there.
const EE_CUSTOM_CHANNEL_SENDER: string =
  "ee/Server/CustomNotificationChannels/CustomChannelSender.ts";

describe("the results and the answers written on a notification", () => {
  test.each(STATUS_WRITERS)(
    "$file writes through OnCallNotificationStatus, never by id",
    (writer: StatusWriter) => {
      const source: ts.SourceFile = parse(writer.file);

      for (const [writeWith, count] of Object.entries(writer.writes)) {
        expect({ writeWith, calls: callsOf(source, writeWith).length }).toEqual(
          { writeWith, calls: count },
        );
        expect({
          writeWith,
          from: moduleResolvedFrom(
            writer.file,
            moduleImportedFrom(source, writeWith),
          ),
        }).toEqual({ writeWith, from: NOTIFICATION_STATUS_MODULE });
      }

      expect(updatesThrough(source, "UserOnCallLogTimelineService")).toEqual(
        [],
      );
    },
  );

  test("the custom channel's sender (Enterprise Edition) writes its result over Sending only", () => {
    const fullPath: string = path.join(
      REPOSITORY_ROOT,
      EE_CUSTOM_CHANNEL_SENDER,
    );

    if (!fs.existsSync(fullPath)) {
      // The open-source build has no ee/.
      return;
    }

    const source: ts.SourceFile = parseAt(fullPath);

    expect(callsOf(source, "recordSendResult")).toHaveLength(1);
    expect(moduleImportedFrom(source, "recordSendResult")).toBe(
      NOTIFICATION_STATUS_MODULE,
    );
    expect(updatesThrough(source, "UserOnCallLogTimelineService")).toEqual([]);
  });

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
    expect(updatesThrough(source, "UserOnCallLogTimelineService")).toEqual([]);
    expect(read(file)).not.toContain("UserOnCallLogTimelineService");
  });
});

describe("nothing else writes a notification's status (issue #7082)", () => {
  const STATUS_MODULE: string =
    "packages/Common/Server/Utils/OnCall/OnCallNotificationStatus.ts";
  const SETTLE_MODULE: string =
    "packages/Common/Server/Utils/OnCall/OnCallStuckNotifications.ts";

  // Every source file of the server that names the service.
  const files: Array<string> = [
    ...sourceFilesUnder("packages/Common/Server"),
    ...sourceFilesUnder("packages/App"),
    ...sourceFilesUnder("ee"),
  ].filter((file: string) => {
    return fs
      .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
      .includes("UserOnCallLogTimelineService");
  });

  test("the files that name the service are read", () => {
    expect(files).toContain(STATUS_MODULE);
    expect(files).toContain(
      "packages/Common/Server/Services/UserNotificationRuleService.ts",
    );
    expect(files.length).toBeGreaterThan(10);
  });

  test("only OnCallNotificationStatus updates a notification through the service, at the status and the version read", () => {
    const updates: Array<string> = [];

    for (const file of files) {
      for (const update of updatesThrough(
        parseAt(path.join(REPOSITORY_ROOT, file)),
        "UserOnCallLogTimelineService",
      )) {
        updates.push(`${file}: ${update}`);
      }
    }

    expect(updates).toEqual([
      `${STATUS_MODULE}: UserOnCallLogTimelineService.updateOneBy`,
    ]);
  });

  test("only the settling of the notifications left Sending before the stuck check writes to the table itself", () => {
    const repositories: Array<string> = [];

    for (const file of files) {
      const source: ts.SourceFile = parseAt(path.join(REPOSITORY_ROOT, file));

      for (const call of callsOf(
        source,
        "UserOnCallLogTimelineService.getRepository",
      )) {
        repositories.push(
          `${file}:${source.getLineAndCharacterOfPosition(call.getStart()).line + 1}`,
        );
      }
    }

    expect(
      repositories.map((where: string) => {
        return where.split(":")[0];
      }),
    ).toEqual([SETTLE_MODULE]);
  });

  test("the service itself writes no notification of its own, and nor does its API", () => {
    const service: ts.SourceFile = parse(
      "Common/Server/Services/UserOnCallLogTimelineService.ts",
    );
    const api: ts.SourceFile = parse(
      "Common/Server/API/UserOnCallLogTimelineAPI.ts",
    );

    expect(updatesThrough(service, "this")).toEqual([]);
    expect(updatesThrough(service, "super")).toEqual([]);
    expect(updatesThrough(api, "this.service")).toEqual([]);
  });
});
