import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY PAGE THE NOTIFICATION SERVICE DELIBERATELY DOES NOT SEND SAYS SO ON
 * THE PERSON'S ON-CALL TIMELINE - FOR GOOD.
 *
 * An on-call page writes a "Sending ..." row on the person's on-call
 * timeline first; the Notification service records how it went. Its early
 * returns - the project's balance cannot pay for the message, the project
 * has the channel turned off, the project is gone - used to skip that
 * update, so the row said "Sending" for ever. Each now records the row as
 * not sent, with the reason (UserOnCallLogTimelineService.markNotSent);
 * NotificationNotSentOnCallTimeline drives every one of them.
 *
 * This keeps a skip added later from forgetting it: in the call, WhatsApp
 * and Telegram senders, every return before the provider is asked to send
 * is right after a markNotSent; the SMS sender returns its reason instead,
 * and sendSms hands every reason to markNotSent.
 *
 * Since every channel reports how each send went (5980a21b7db), a sender
 * runs inside NotificationDeliveryMetrics.measureDispatch: WhatsApp and
 * Telegram send in a method of their own (sendWhatsAppMessage,
 * sendTelegramMessage), and a skip also counts the send as not sent
 * (dispatch.markNotSent()) between the timeline's markNotSent and its return.
 * That still is right after the timeline's markNotSent; the counter alone is
 * not (2026-11-10).
 */

const SERVICES: string = path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Services",
);

function sourceOf(file: string): ts.SourceFile {
  const fullPath: string = path.join(SERVICES, file);

  return ts.createSourceFile(
    fullPath,
    fs.readFileSync(fullPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function findMethod(source: ts.SourceFile, name: string): ts.MethodDeclaration {
  let found: ts.MethodDeclaration | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  if (!found) {
    throw new Error(`No method ${name} in ${source.fileName}`);
  }

  return found;
}

function isMarkNotSent(statement: ts.Statement | undefined): boolean {
  return Boolean(
    statement &&
      ts.isExpressionStatement(statement) &&
      statement
        .getText()
        .startsWith("await UserOnCallLogTimelineService.markNotSent("),
  );
}

// The delivery metrics' own not-sent count: dispatch.markNotSent();
function isDispatchMarkNotSent(statement: ts.Statement | undefined): boolean {
  return Boolean(
    statement &&
      ts.isExpressionStatement(statement) &&
      statement.getText() === "dispatch.markNotSent();",
  );
}

/*
 * Whether the statement at `index` comes right after the timeline's
 * markNotSent: directly, or with only the dispatch's not-sent count between.
 */
function isRightAfterMarkNotSent(
  statements: ts.NodeArray<ts.Statement>,
  index: number,
): boolean {
  if (isMarkNotSent(statements[index - 1])) {
    return true;
  }

  return (
    isDispatchMarkNotSent(statements[index - 1]) &&
    isMarkNotSent(statements[index - 2])
  );
}

interface EarlyReturn {
  line: number;
  isAfterMarkNotSent: boolean;
}

/*
 * The returns of `method` that come before the provider is asked to send
 * (the first `providerCall` in its text), and whether each comes right
 * after a markNotSent in its block.
 */
function earlyReturnsOf(
  source: ts.SourceFile,
  method: ts.MethodDeclaration,
  providerCall: string,
): Array<EarlyReturn> {
  const providerAt: number = method.getText().indexOf(providerCall);

  expect(providerAt).toBeGreaterThan(-1);

  const providerPosition: number = method.getStart() + providerAt;
  const returns: Array<EarlyReturn> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isBlock(node)) {
      node.statements.forEach((statement: ts.Statement, index: number) => {
        if (
          ts.isReturnStatement(statement) &&
          statement.getStart() < providerPosition
        ) {
          returns.push({
            line:
              source.getLineAndCharacterOfPosition(statement.getStart()).line +
              1,
            isAfterMarkNotSent: isRightAfterMarkNotSent(node.statements, index),
          });
        }
      });
    }

    // Callbacks are not the sender's own returns.
    if (
      node !== method &&
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    ) {
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(method);

  return returns;
}

describe("the senders that return nothing record every skip on the timeline", () => {
  test.each([
    // [file, sender, the call that asks the provider to send, skips]
    ["CallService.ts", "makeCallInternal", "client.calls.create(", 3],
    ["WhatsAppService.ts", "sendWhatsAppMessage", "API.post<JSONObject>(", 2],
    ["TelegramService.ts", "sendTelegramMessage", "API.post<JSONObject>(", 3],
  ])(
    "%s: every return before the provider is right after a markNotSent",
    (file: string, sender: string, providerCall: string, skips: number) => {
      const source: ts.SourceFile = sourceOf(file);
      const returns: Array<EarlyReturn> = earlyReturnsOf(
        source,
        findMethod(source, sender),
        providerCall,
      );

      // The skips this file has today: project gone, channel off, balance.
      expect(returns).toHaveLength(skips);
      expect(
        returns.filter((earlyReturn: EarlyReturn) => {
          return !earlyReturn.isAfterMarkNotSent;
        }),
      ).toEqual([]);
    },
  );
});

describe("the SMS sender", () => {
  test("its internal sender returns the reason of every skip, and never writes the timeline itself", () => {
    const source: ts.SourceFile = sourceOf("SmsService.ts");
    const internal: string = findMethod(source, "sendSmsInternal").getText();

    expect(internal).not.toContain("markNotSent(");
    expect(
      internal.split("return smsLog.statusMessage!;").length - 1,
    ).toBeGreaterThanOrEqual(3);
  });

  test("sendSms hands every reason to markNotSent, once", () => {
    const source: ts.SourceFile = sourceOf("SmsService.ts");
    const send: string = findMethod(source, "sendSms").getText();

    expect(
      send.split("UserOnCallLogTimelineService.markNotSent(").length - 1,
    ).toBe(1);
    // The delivery metrics count the same skip as not sent, once.
    expect(send.split("dispatch.markNotSent()").length - 1).toBe(1);
    expect(send).toMatch(
      /if \(notSentReason !== null\) \{\s*dispatch\.markNotSent\(\);\s*await UserOnCallLogTimelineService\.markNotSent\(\{\s*userOnCallLogTimelineId: options\.userOnCallLogTimelineId,\s*reason: notSentReason,/,
    );
  });
});

describe("the reader, on a sender's shapes", () => {
  function returnsOf(body: string): Array<EarlyReturn> {
    const source: ts.SourceFile = ts.createSourceFile(
      "Sender.ts",
      `class Sender {\n  private static async send(): Promise<void> {\n${body}\n    await API.post<JSONObject>({});\n  }\n}\n`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    return earlyReturnsOf(
      source,
      findMethod(source, "send"),
      "API.post<JSONObject>(",
    );
  }

  const timeline: string =
    "await UserOnCallLogTimelineService.markNotSent({ userOnCallLogTimelineId: id, reason: why });";

  test("takes a return right after the timeline's markNotSent", () => {
    expect(
      returnsOf(`if (off) {\n${timeline}\nreturn;\n}`).map(
        (earlyReturn: EarlyReturn): boolean => {
          return earlyReturn.isAfterMarkNotSent;
        },
      ),
    ).toEqual([true]);
  });

  test("takes the dispatch's not-sent count between the timeline's markNotSent and the return", () => {
    expect(
      returnsOf(
        `if (off) {\n${timeline}\ndispatch.markNotSent();\nreturn;\n}`,
      ).map((earlyReturn: EarlyReturn): boolean => {
        return earlyReturn.isAfterMarkNotSent;
      }),
    ).toEqual([true]);
  });

  test("does not take the dispatch's count alone, or anything else between", () => {
    expect(
      returnsOf(
        [
          "if (off) {\ndispatch.markNotSent();\nreturn;\n}",
          `if (gone) {\n${timeline}\nlogger.error(why);\nreturn;\n}`,
          "if (poor) {\nreturn;\n}",
        ].join("\n"),
      ).map((earlyReturn: EarlyReturn): boolean => {
        return earlyReturn.isAfterMarkNotSent;
      }),
    ).toEqual([false, false, false]);
  });

  test("leaves out the returns of callbacks, which are not the sender's own", () => {
    expect(
      returnsOf(
        "items.forEach((item: string): void => {\nif (!item) {\nreturn;\n}\n});",
      ),
    ).toEqual([]);
  });
});
