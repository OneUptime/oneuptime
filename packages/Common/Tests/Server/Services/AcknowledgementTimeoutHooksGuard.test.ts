import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * WHERE AN ACKNOWLEDGEMENT TIMEOUT'S CLOCK HEARS OF AN ACKNOWLEDGEMENT.
 *
 * The clock of a policy that pages again (OnCallAcknowledgementTimeout)
 * starts at a new acknowledgement and stops at a resolve - from wherever
 * the record's state changed: the Dashboard, the mobile app, Slack or
 * Microsoft Teams, the API, a workflow, an answered page. Every one of those
 * writes a row of the record's state timeline, so every state timeline
 * service tells the clock once the change is saved - for the record's
 * current state only: a back-dated row (it has an end) changes neither. And
 * an answered page of a page again, whose record was acknowledged all along,
 * tells it through the acknowledge hook.
 *
 * Read from the services' source with the TypeScript parser, so a new state
 * timeline, or a refactor that drops the call or its condition, fails here
 * rather than silently never paging again.
 */

const SERVICES_DIR: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);

const WHITE_SPACE_RUN: RegExp = /\s+/g;
const PROJECT_ID_OF_THE_CHANGE: RegExp = /^createdItem\.projectId!?$/;
const PAGED_RECORD_STATE_TIMELINE: RegExp =
  /^(Incident|Alert|IncidentEpisode|AlertEpisode)StateTimelineService\.ts$/;

interface StateTimelineHook {
  file: string;
  kind: string;
  recordColumn: string;
  stateColumn: string;
}

const STATE_TIMELINES: Array<StateTimelineHook> = [
  {
    file: "IncidentStateTimelineService.ts",
    kind: "incident",
    recordColumn: "incidentId",
    stateColumn: "incidentStateId",
  },
  {
    file: "AlertStateTimelineService.ts",
    kind: "alert",
    recordColumn: "alertId",
    stateColumn: "alertStateId",
  },
  {
    file: "IncidentEpisodeStateTimelineService.ts",
    kind: "incident episode",
    recordColumn: "incidentEpisodeId",
    stateColumn: "incidentStateId",
  },
  {
    file: "AlertEpisodeStateTimelineService.ts",
    kind: "alert episode",
    recordColumn: "alertEpisodeId",
    stateColumn: "alertStateId",
  },
];

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(SERVICES_DIR, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

// Every call of `OnCallAcknowledgementTimeout.<method>(...)` in a file.
function findCalls(
  source: ts.SourceFile,
  method: string,
): Array<ts.CallExpression> {
  const calls: Array<ts.CallExpression> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method &&
      node.expression.expression.getText(source) ===
        "OnCallAcknowledgementTimeout"
    ) {
      calls.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

// The method a node sits in.
function enclosingMethodName(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isMethodDeclaration(current) && current.name) {
      return current.name.getText();
    }

    current = current.parent;
  }

  return "";
}

// The conditions of every `if` a node sits in, innermost first.
function enclosingConditions(
  node: ts.Node,
  source: ts.SourceFile,
): Array<string> {
  const conditions: Array<string> = [];
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isIfStatement(current)) {
      conditions.push(current.expression.getText(source));
    }

    current = current.parent;
  }

  return conditions;
}

// The text of each property of the call's one object argument.
function argumentProperties(
  call: ts.CallExpression,
  source: ts.SourceFile,
): Record<string, string> {
  const argument: ts.Expression | undefined = call.arguments[0];
  const properties: Record<string, string> = {};

  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return properties;
  }

  for (const property of argument.properties) {
    if (ts.isPropertyAssignment(property)) {
      properties[property.name.getText(source)] = property.initializer
        .getText(source)
        .replace(WHITE_SPACE_RUN, " ");
    }
  }

  return properties;
}

describe.each(STATE_TIMELINES)(
  "$file tells the acknowledgement timeout of a state change",
  (hook: StateTimelineHook) => {
    const source: ts.SourceFile = parse(hook.file);
    const calls: Array<ts.CallExpression> = findCalls(
      source,
      "onRecordStateChanged",
    );

    test("once, once the change is saved", () => {
      expect(calls).toHaveLength(1);
      expect(enclosingMethodName(calls[0]!)).toBe("onCreateSuccess");
    });

    test("for the record's current state only: never a back-dated row", () => {
      const conditions: Array<string> = enclosingConditions(calls[0]!, source);

      expect(
        conditions.some((condition: string) => {
          return condition.startsWith("!createdItem.endsAt");
        }),
      ).toBe(true);
    });

    test("names the record's kind, the record, the new state and the state it moved from", () => {
      const properties: Record<string, string> = argumentProperties(
        calls[0]!,
        source,
      );

      expect(properties["kind"]).toBe(`"${hook.kind}"`);
      expect(properties["recordId"]).toBe(`createdItem.${hook.recordColumn}`);
      expect(properties["stateId"]).toBe(`createdItem.${hook.stateColumn}`);
      expect(properties["previousStateId"]).toBe(
        `onCreate.carryForward.statusTimelineBeforeThisStatus?.${hook.stateColumn}`,
      );
      expect(properties["projectId"]).toMatch(PROJECT_ID_OF_THE_CHANGE);
    });

    test("is awaited, so the clock is started before the change is answered", () => {
      expect(ts.isAwaitExpression(calls[0]!.parent)).toBe(true);
    });

    /*
     * Who changed it: an incident's or an alert's author, paged about it by
     * a page a person asked for, answers their page by acknowledging it
     * (OnCallPersonPageAnswer). An episode has no such pages.
     */
    test("names who changed it - the change's author, else the caller - for an incident or an alert", () => {
      const properties: Record<string, string> = argumentProperties(
        calls[0]!,
        source,
      );

      if (hook.kind === "incident" || hook.kind === "alert") {
        expect(properties["changedByUserId"]).toBe(
          "createdItem.createdByUserId || onCreate.createBy.props.userId",
        );
      } else {
        expect(properties["changedByUserId"]).toBeUndefined();
      }
    });
  },
);

describe("an acknowledged page tells the acknowledgement timeout", () => {
  const source: ts.SourceFile = parse("UserOnCallLogTimelineService.ts");
  const calls: Array<ts.CallExpression> = findCalls(
    source,
    "onPageAcknowledged",
  );

  test("once, from the one place a page is acknowledged, which the acknowledge hook calls", () => {
    expect(calls).toHaveLength(1);
    expect(enclosingMethodName(calls[0]!)).toBe("acknowledgePage");
    expect(ts.isAwaitExpression(calls[0]!.parent)).toBe(true);

    // The hook acknowledges each answered page through it.
    const viaHook: Array<ts.CallExpression> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "this.acknowledgePage"
      ) {
        viaHook.push(node);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    expect(viaHook).toHaveLength(1);
    expect(enclosingMethodName(viaHook[0]!)).toBe("onUpdateSuccess");
  });

  test("after the record itself is acknowledged, with the moment it was answered", () => {
    const text: string = source.getFullText();

    const acknowledgesRecord: number = text.indexOf(
      "IncidentEpisodeService.acknowledgeEpisode(",
    );
    const tellsTheClock: number = calls[0]!.getStart(source);

    expect(acknowledgesRecord).toBeGreaterThan(-1);
    expect(tellsTheClock).toBeGreaterThan(acknowledgesRecord);

    const properties: Record<string, string> = argumentProperties(
      calls[0]!,
      source,
    );

    expect(properties["executionLogId"]).toBe(
      "page.onCallDutyPolicyExecutionLogId",
    );
    expect(properties["acknowledgedAt"]).toBe("page.acknowledgedAt");
  });
});

describe("no other state timeline is left out", () => {
  test("every *StateTimelineService of a record an on-call policy pages about tells the clock", () => {
    const pagedRecordTimelines: Array<string> = fs
      .readdirSync(SERVICES_DIR)
      .filter((file: string) => {
        return PAGED_RECORD_STATE_TIMELINE.test(file);
      })
      .sort();

    expect(pagedRecordTimelines).toEqual(
      STATE_TIMELINES.map((hook: StateTimelineHook) => {
        return hook.file;
      }).sort(),
    );
  });
});
