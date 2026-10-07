import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * AN UPDATE NEVER DECIDES A NOTIFICATION FROM A "NOTIFY SUBSCRIBERS" FLAG.
 *
 * The notify flags (shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
 * ...OnEventCreated, ...OnEpisodeCreated, ...OnNoteCreated,
 * shouldStatusPageSubscribersBeNotified) are choices made when a record is
 * created. Their create hooks turn them into the 'created' message's status.
 * An incident's notifySubscribersOnPostmortemPublished is read by the job
 * that sends the postmortem notification, which an update queues when it
 * publishes the postmortem (IncidentPostmortemPublication), so no update hook
 * decides that notification from it either.
 * Their update hooks used to do the same, so an update that merely carried
 * the flag - a workflow or a master-key client writing the whole record
 * back - queued the message again and every subscriber got it twice.
 *
 * An update hook may still read a flag (an incident update reads it as the
 * update leaves it to decide whether publishing may announce the incident),
 * but no update hook writes a notification status from a flag the update
 * carries. This reads every service's onBeforeUpdate and onUpdateSuccess,
 * and every method of the same class they call, for an `if` (or `?:`) on
 * `updateBy.data.should...Notified...` that writes a
 * `subscriberNotificationStatus...` column, and for such a column assigned
 * a value worked out from that flag.
 */

// packages/Common/Tests/Server/Services -> packages/Common/Server/Services
const SERVICES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

const UPDATE_HOOKS: Array<string> = ["onBeforeUpdate", "onUpdateSuccess"];

/*
 * A notify flag read off the update's payload: the "should ... be notified"
 * flags, and an incident's notifySubscribersOnPostmortemPublished. That one
 * may be changed on update (it is Notify Subscribers on the Edit Postmortem
 * form), but the postmortem's notification is queued when an update
 * publishes the postmortem, whatever it says, and the send job reads it
 * (IncidentPostmortemPublication).
 */
const FLAG_ON_PAYLOAD: RegExp =
  /\b(?:updateBy|onUpdate\.updateBy)\.data(?:\.|\[\s*["'])(?:should\w*Notified\w*|notifySubscribers\w*)/;

// A write of a notification status column.
const STATUS_COLUMN: RegExp = /^subscriberNotificationStatus\w*$/;

export interface FlagDecidedStatus {
  file: string;
  line: number;
  method: string;
  text: string;
}

function methodsOf(
  classNode: ts.ClassDeclaration,
): Map<string, ts.MethodDeclaration> {
  const methods: Map<string, ts.MethodDeclaration> = new Map();

  for (const member of classNode.members) {
    if (
      ts.isMethodDeclaration(member) &&
      member.name &&
      ts.isIdentifier(member.name)
    ) {
      methods.set(member.name.text, member);
    }
  }

  return methods;
}

// The update hooks, and every method of the class they reach through `this.x(`.
function reachableFromUpdateHooks(
  methods: Map<string, ts.MethodDeclaration>,
): Array<ts.MethodDeclaration> {
  const seen: Set<string> = new Set();
  const queue: Array<string> = UPDATE_HOOKS.filter((name: string) => {
    return methods.has(name);
  });

  while (queue.length > 0) {
    const name: string = queue.shift()!;

    if (seen.has(name)) {
      continue;
    }

    seen.add(name);

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        methods.has(node.expression.name.text)
      ) {
        queue.push(node.expression.name.text);
      }

      ts.forEachChild(node, visit);
    };

    visit(methods.get(name)!);
  }

  return [...seen].map((name: string) => {
    return methods.get(name)!;
  });
}

// The status columns a branch assigns to, under any object.
function statusColumnsWritten(branch: ts.Node): Array<string> {
  const columns: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target: ts.Expression = node.left;
      let name: string | null = null;

      if (ts.isPropertyAccessExpression(target)) {
        name = target.name.text;
      } else if (
        ts.isElementAccessExpression(target) &&
        ts.isStringLiteralLike(target.argumentExpression)
      ) {
        name = target.argumentExpression.text;
      }

      if (name && STATUS_COLUMN.test(name)) {
        columns.push(name);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(branch);

  return columns;
}

export function findFlagDecidedStatuses(
  fileName: string,
  sourceText: string,
): Array<FlagDecidedStatus> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const found: Array<FlagDecidedStatus> = [];

  const visitClass: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      for (const method of reachableFromUpdateHooks(methodsOf(node))) {
        const methodName: string = (method.name as ts.Identifier).text;

        const visit: (inner: ts.Node) => void = (inner: ts.Node): void => {
          let condition: ts.Expression | null = null;
          let branches: Array<ts.Node> = [];

          if (ts.isIfStatement(inner)) {
            condition = inner.expression;
            branches = [inner.thenStatement];

            if (inner.elseStatement) {
              branches.push(inner.elseStatement);
            }
          } else if (ts.isConditionalExpression(inner)) {
            condition = inner.condition;
            branches = [inner.whenTrue, inner.whenFalse];
          }

          // A status column assigned a value worked out from the flag.
          if (
            ts.isBinaryExpression(inner) &&
            inner.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            statusColumnsWritten(inner).length > 0 &&
            FLAG_ON_PAYLOAD.test(
              inner.right.getText(source).replace(/\s+/g, ""),
            )
          ) {
            found.push({
              file: fileName,
              line:
                source.getLineAndCharacterOfPosition(inner.getStart(source))
                  .line + 1,
              method: methodName,
              text: `${inner.left
                .getText(source)
                .replace(/\s+/g, " ")} is worked out from the flag`,
            });
          }

          if (
            condition &&
            FLAG_ON_PAYLOAD.test(condition.getText(source).replace(/\s+/g, ""))
          ) {
            const written: Array<string> = branches.flatMap(
              (branch: ts.Node) => {
                return statusColumnsWritten(branch);
              },
            );

            if (written.length > 0) {
              found.push({
                file: fileName,
                line:
                  source.getLineAndCharacterOfPosition(inner.getStart(source))
                    .line + 1,
                method: methodName,
                text: `if (${condition
                  .getText(source)
                  .replace(/\s+/g, " ")}) writes ${written.join(", ")}`,
              });
            }
          }

          ts.forEachChild(inner, visit);
        };

        visit(method);
      }
    }

    ts.forEachChild(node, visitClass);
  };

  visitClass(source);

  return found;
}

describe("NotifyFlagNeverQueuesOnUpdateGuard", () => {
  test("no service's update hooks write a notification status from a notify flag the update carries", () => {
    const found: Array<FlagDecidedStatus> = [];

    for (const entry of fs.readdirSync(SERVICES_DIR)) {
      if (!entry.endsWith(".ts")) {
        continue;
      }

      const fullPath: string = path.join(SERVICES_DIR, entry);

      found.push(
        ...findFlagDecidedStatuses(entry, fs.readFileSync(fullPath, "utf-8")),
      );
    }

    expect(
      found.map((item: FlagDecidedStatus): string => {
        return `${item.file}:${item.line} ${item.method}: ${item.text}`;
      }),
    ).toEqual([]);
  });

  test("it reads the services it is meant to: the three that used to do it are there", () => {
    for (const file of [
      "IncidentService.ts",
      "ScheduledMaintenanceService.ts",
      "StatusPageAnnouncementService.ts",
    ]) {
      expect(fs.existsSync(path.join(SERVICES_DIR, file))).toBe(true);
    }
  });

  describe("the detector itself", () => {
    test("finds the mapping the update hooks used to make", () => {
      const found: Array<FlagDecidedStatus> = findFlagDecidedStatuses(
        "Old.ts",
        `
class Service {
  protected override async onBeforeUpdate(updateBy: any): Promise<any> {
    if (updateBy.data.shouldStatusPageSubscribersBeNotified !== undefined) {
      if (updateBy.data.shouldStatusPageSubscribersBeNotified === false) {
        updateBy.data.subscriberNotificationStatus = "Skipped";
      } else if (updateBy.data.shouldStatusPageSubscribersBeNotified === true) {
        updateBy.data.subscriberNotificationStatus = "Pending";
      }
    }
    return { updateBy, carryForward: null };
  }
}
`,
      );

      expect(found.length).toBeGreaterThan(0);
      expect(found[0]!.method).toBe("onBeforeUpdate");
      expect(found[0]!.text).toContain("subscriberNotificationStatus");
    });

    test("follows the hook into the class's own helpers", () => {
      const found: Array<FlagDecidedStatus> = findFlagDecidedStatuses(
        "Helper.ts",
        `
class Service {
  protected override async onBeforeUpdate(updateBy: any): Promise<any> {
    this.mapFlag(updateBy);
    return { updateBy, carryForward: null };
  }

  private mapFlag(updateBy: any): void {
    updateBy.data["subscriberNotificationStatusOnEventScheduled"] =
      updateBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated
        ? "Pending"
        : "Skipped";
  }
}
`,
      );

      // A value worked out from the flag counts like a branch on it.
      expect(found).toHaveLength(1);
      expect(found[0]!.method).toBe("mapFlag");

      const branched: Array<FlagDecidedStatus> = findFlagDecidedStatuses(
        "Helper.ts",
        `
class Service {
  protected override async onBeforeUpdate(updateBy: any): Promise<any> {
    this.mapFlag(updateBy);
    return { updateBy, carryForward: null };
  }

  private mapFlag(updateBy: any): void {
    if (updateBy.data.shouldStatusPageSubscribersBeNotifiedOnEventCreated) {
      updateBy.data["subscriberNotificationStatusOnEventScheduled"] = "Pending";
    }
  }
}
`,
      );

      expect(branched).toHaveLength(1);
      expect(branched[0]!.method).toBe("mapFlag");
    });

    test("finds a postmortem notification decided from Notify Subscribers", () => {
      const found: Array<FlagDecidedStatus> = findFlagDecidedStatuses(
        "Postmortem.ts",
        `
class Service {
  protected override async onBeforeUpdate(updateBy: any): Promise<any> {
    if (updateBy.data.notifySubscribersOnPostmortemPublished) {
      updateBy.data.subscriberNotificationStatusOnPostmortemPublished = "Pending";
    }
    return { updateBy, carryForward: null };
  }
}
`,
      );

      expect(found).toHaveLength(1);
      expect(found[0]!.text).toContain(
        "subscriberNotificationStatusOnPostmortemPublished",
      );

      const fromPayloadIndex: Array<FlagDecidedStatus> =
        findFlagDecidedStatuses(
          "Postmortem.ts",
          `
class Service {
  protected override async onUpdateSuccess(onUpdate: any): Promise<any> {
    onUpdate.updateBy.data["subscriberNotificationStatusOnPostmortemPublished"] =
      onUpdate.updateBy.data["notifySubscribersOnPostmortemPublished"]
        ? "Pending"
        : "Skipped";
    return onUpdate;
  }
}
`,
        );

      expect(fromPayloadIndex).toHaveLength(1);
      expect(fromPayloadIndex[0]!.method).toBe("onUpdateSuccess");
    });

    test("leaves the create hooks alone: a create decides its message from the flag", () => {
      expect(
        findFlagDecidedStatuses(
          "Create.ts",
          `
class Service {
  protected override async onBeforeCreate(createBy: any): Promise<any> {
    if (createBy.data.shouldStatusPageSubscribersBeNotified === false) {
      createBy.data.subscriberNotificationStatus = "Skipped";
    }
    return { createBy, carryForward: null };
  }
}
`,
        ),
      ).toEqual([]);
    });

    test("leaves an update that only reads the flag alone", () => {
      expect(
        findFlagDecidedStatuses(
          "Reads.ts",
          `
class Service {
  protected override async onBeforeUpdate(updateBy: any): Promise<any> {
    const flag: unknown =
      updateBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated;
    if (updateBy.miscDataProps?.resend) {
      updateBy.data.subscriberNotificationStatusOnIncidentCreated = "Pending";
    }
    return { updateBy, carryForward: flag };
  }
}
`,
        ),
      ).toEqual([]);
    });
  });
});
