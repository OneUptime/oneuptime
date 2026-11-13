import { utmAnalyticsProperties } from "../../../Server/Utils/Marketing/MarketingEventUtil";
import { Service as ProjectMilestoneServiceClass } from "../../../Server/Services/ProjectMilestoneService";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import { GuidedSetupEvents } from "../../../UI/Utils/GuidedSetupEvents";
import { UtmPropertyKeys } from "../../../Types/Marketing/Attribution";
import { JSONObject } from "../../../Types/JSON";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import {
  getSetupApprovedEvent,
  getSetupProposedEvent,
  getSetupTestPageSentEvent,
  takeNewSetupProposal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiSetupEvents";
import {
  COMMON_PRODUCT_EVENT_PROPERTIES,
  PRODUCT_EVENTS,
  ProductEventDefinition,
  ProductEventPropertySpec,
  isForbiddenPropertyName,
} from "../../../Types/Analytics/ProductEvent";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * No analytics event carries a name, an email, an address or text somebody
 * wrote (issue #6830). This scans the code itself: every call that sends a
 * product analytics event - ProductAnalytics.capture / captureForUser on
 * the server, UiAnalytics.capture / captureRevenueEvent and
 * ProductEvents.send in the browser - is found with the TypeScript
 * parser, the property names it can send are read from the object it is
 * handed (spreads, conditionals and the variables it names in the same file
 * followed, and the shared builders called for what they return), and each
 * name is held to isForbiddenPropertyName. A call whose properties cannot be
 * read fails too, so nothing escapes the scan by being indirect.
 */

const REPOSITORY_ROOT: string = path.join(__dirname, "../../../../..");

const SOURCE_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages/Common/Server"),
  path.join(REPOSITORY_ROOT, "packages/Common/UI"),
  path.join(REPOSITORY_ROOT, "packages/App/FeatureSet"),
  // Moved aside in CI's Common Test; scanned wherever it is present.
  path.join(REPOSITORY_ROOT, "ee/Server"),
];

const TYPESCRIPT_FILE: RegExp = /\.(ts|tsx)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;
// A file that may send an event: it calls one of the sending methods.
const SENDS_EVENTS: RegExp =
  /\.(capture|captureForUser|captureRevenueEvent|send)\(/;
// UiAnalytics, Analytics: what the browser sends events through.
const ANALYTICS_RECEIVER: RegExp = /Analytics$/;

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "public",
]);

const SERVER_CAPTURES: Set<string> = new Set<string>([
  "capture",
  "captureForUser",
]);
const BROWSER_CAPTURES: Set<string> = new Set<string>([
  "capture",
  "captureRevenueEvent",
  "send",
]);

// A setup action waiting on its card, for the setup plans' builders below.
const SETUP_ACTION: AIChatToolAction = {
  id: "call-1",
  toolName: "set_up_website_monitoring",
  title: "Set up monitoring for example.com",
  arguments: {},
  isMutation: true,
  requiresApproval: true,
  status: AIChatToolActionStatus.Pending,
};

/*
 * The builders events are made with, and the names they return - read by
 * calling them, so a name added to one is scanned too.
 */
const BUILDER_KEYS: Record<string, () => Array<string>> = {
  utmAnalyticsProperties: (): Array<string> => {
    return Object.keys(utmAnalyticsProperties({}));
  },
  getMilestoneEventProperties: (): Array<string> => {
    return Object.keys(
      ProjectMilestoneServiceClass.getMilestoneEventProperties({
        projectId: "p",
        milestone: ActivationMilestone.FirstMonitorCreated,
        reachedAt: new Date(1000),
        projectCreatedAt: new Date(0),
        planName: "Free",
      }),
    );
  },
  getCommonProperties: (): Array<string> => {
    return [...COMMON_PRODUCT_EVENT_PROPERTIES];
  },
  getStepProperties: (): Array<string> => {
    return Object.keys(
      (
        new GuidedSetupEvents("setup") as unknown as {
          getStepProperties: () => JSONObject;
        }
      ).getStepProperties(),
    );
  },
  // The sign-up page's utm_event: the campaign values the visitor arrived with.
  getUtmParams: (): Array<string> => {
    return [...UtmPropertyKeys];
  },
  // Ask AI's setup plans (#6829): proposed, approved, then tested.
  getSetupProposedEvent: (): Array<string> => {
    return Object.keys(
      getSetupProposedEvent({
        message: {
          status: AIChatMessageStatus.WaitingForApproval,
          toolActions: [SETUP_ACTION],
        },
        permissionMode: "AskForApproval",
      }) || {},
    );
  },
  // The same event, taken once per answer by the panel's poll.
  takeNewSetupProposal: (): Array<string> => {
    return Object.keys(
      takeNewSetupProposal({
        message: {
          id: "a-message",
          status: AIChatMessageStatus.WaitingForApproval,
          toolActions: [SETUP_ACTION],
        },
        seen: new Set<string>(),
        permissionMode: "AskForApproval",
      }) || {},
    );
  },
  getSetupApprovedEvent: (): Array<string> => {
    return Object.keys(
      getSetupApprovedEvent({
        toolActions: [SETUP_ACTION],
        decisions: [{ toolCallId: SETUP_ACTION.id, approved: true }],
      }) || {},
    );
  },
  getSetupTestPageSentEvent: (): Array<string> => {
    return Object.keys(getSetupTestPageSentEvent({ kind: "self" }));
  },
  toProductEventProperties: (): Array<string> => {
    return PRODUCT_EVENTS.flatMap(
      (event: ProductEventDefinition): Array<string> => {
        return event.properties.map((spec: ProductEventPropertySpec) => {
          return spec.name;
        });
      },
    );
  },
};

interface CaptureCall {
  file: string;
  line: number;
  keys: Array<string>;
  unreadable: Array<string>;
}

const sourceFiles: (root: string) => Array<string> = (
  root: string,
): Array<string> => {
  const files: Array<string> = [];

  if (!fs.existsSync(root)) {
    return files;
  }

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(directory, entry.name));
        }
      } else if (
        TYPESCRIPT_FILE.test(entry.name) &&
        !DECLARATION_FILE.test(entry.name)
      ) {
        files.push(path.join(directory, entry.name));
      }
    }
  };

  walk(root);

  return files;
};

const propertyNameOf: (name: ts.PropertyName) => string | null = (
  name: ts.PropertyName,
): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return null;
};

const scanFile: (file: string) => Array<CaptureCall> = (
  file: string,
): Array<CaptureCall> => {
  return scanSource(file, fs.readFileSync(file, "utf8"));
};

const scanSource: (file: string, text: string) => Array<CaptureCall> = (
  file: string,
  text: string,
): Array<CaptureCall> => {
  if (!SENDS_EVENTS.test(text)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // Every `const <name> = <initializer>` and `<name>[...] = ` / `<name>.x = ` in the file.
  const initializers: Map<string, Array<ts.Expression>> = new Map();
  const assignedKeys: Map<string, Array<string>> = new Map();
  // Every object handed over as `properties:` anywhere in the file.
  const propertiesObjects: Array<ts.Expression> = [];

  const collect: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const list: Array<ts.Expression> = initializers.get(node.name.text) || [];
      list.push(node.initializer);
      initializers.set(node.name.text, list);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target: ts.Expression = node.left;
      let owner: string | null = null;
      let key: string | null = null;

      if (
        ts.isElementAccessExpression(target) &&
        ts.isIdentifier(target.expression) &&
        ts.isStringLiteral(target.argumentExpression)
      ) {
        owner = target.expression.text;
        key = target.argumentExpression.text;
      } else if (
        ts.isPropertyAccessExpression(target) &&
        ts.isIdentifier(target.expression)
      ) {
        owner = target.expression.text;
        key = target.name.text;
      }

      if (owner && key) {
        const list: Array<string> = assignedKeys.get(owner) || [];
        list.push(key);
        assignedKeys.set(owner, list);
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyNameOf(node.name) === "properties"
    ) {
      propertiesObjects.push(node.initializer);
    }

    ts.forEachChild(node, collect);
  };

  collect(source);

  const keysOf: (
    expression: ts.Expression,
    seen: Set<string>,
    unreadable: Array<string>,
  ) => Array<string> = (
    expression: ts.Expression,
    seen: Set<string>,
    unreadable: Array<string>,
  ): Array<string> => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression)
    ) {
      return keysOf(expression.expression, seen, unreadable);
    }

    if (ts.isObjectLiteralExpression(expression)) {
      const keys: Array<string> = [];

      for (const property of expression.properties) {
        if (ts.isSpreadAssignment(property)) {
          keys.push(...keysOf(property.expression, seen, unreadable));
        } else if (property.name) {
          const name: string | null = propertyNameOf(property.name);

          if (name) {
            keys.push(name);
          } else {
            unreadable.push(property.getText(source));
          }
        }
      }

      return keys;
    }

    if (ts.isConditionalExpression(expression)) {
      return [
        ...keysOf(expression.whenTrue, seen, unreadable),
        ...keysOf(expression.whenFalse, seen, unreadable),
      ];
    }

    if (ts.isBinaryExpression(expression)) {
      // `data.properties || {}`
      return [
        ...keysOf(expression.left, seen, unreadable),
        ...keysOf(expression.right, seen, unreadable),
      ];
    }

    if (ts.isCallExpression(expression)) {
      const callee: ts.Expression = expression.expression;
      const name: string = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : "";

      if (BUILDER_KEYS[name]) {
        return BUILDER_KEYS[name]!();
      }

      unreadable.push(expression.getText(source));
      return [];
    }

    if (ts.isIdentifier(expression)) {
      const name: string = expression.text;

      if (name === "undefined") {
        return [];
      }

      if (seen.has(name)) {
        return [];
      }

      seen.add(name);

      const declared: Array<ts.Expression> = initializers.get(name) || [];

      if (declared.length > 0) {
        return [
          ...declared.flatMap((initializer: ts.Expression) => {
            return keysOf(initializer, seen, unreadable);
          }),
          ...(assignedKeys.get(name) || []),
        ];
      }

      /*
       * A parameter: what the file hands over as `properties:` elsewhere
       * is what it carries.
       */
      return propertiesObjects.flatMap((object: ts.Expression) => {
        return keysOf(object, seen, unreadable);
      });
    }

    if (ts.isPropertyAccessExpression(expression)) {
      // `data.properties`: a parameter's field, handed over elsewhere in the file.
      return propertiesObjects
        .filter((object: ts.Expression): boolean => {
          return object !== expression;
        })
        .flatMap((object: ts.Expression) => {
          return keysOf(object, seen, unreadable);
        });
    }

    unreadable.push(expression.getText(source));
    return [];
  };

  const calls: Array<CaptureCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const receiver: string = node.expression.expression.text;
      const method: string = node.expression.name.text;
      let propertiesExpression: ts.Expression | null | undefined = undefined;

      if (receiver === "ProductAnalytics" && SERVER_CAPTURES.has(method)) {
        const argument: ts.Expression | undefined = node.arguments[0];

        if (argument && ts.isObjectLiteralExpression(argument)) {
          const property: ts.ObjectLiteralElementLike | undefined =
            argument.properties.find(
              (element: ts.ObjectLiteralElementLike): boolean => {
                return Boolean(
                  element.name && propertyNameOf(element.name) === "properties",
                );
              },
            );

          propertiesExpression =
            property && ts.isPropertyAssignment(property)
              ? property.initializer
              : property && ts.isShorthandPropertyAssignment(property)
                ? property.name
                : null;
        }
      } else if (
        (ANALYTICS_RECEIVER.test(receiver) || receiver === "ProductEvents") &&
        receiver !== "ProductAnalytics" &&
        BROWSER_CAPTURES.has(method) &&
        !(receiver === "ProductEvents" && method !== "send")
      ) {
        propertiesExpression = node.arguments[1] || null;
      }

      if (propertiesExpression !== undefined) {
        const unreadable: Array<string> = [];
        const keys: Array<string> = propertiesExpression
          ? keysOf(propertiesExpression, new Set<string>(), unreadable)
          : [];

        calls.push({
          file: path.relative(REPOSITORY_ROOT, file),
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          keys: keys,
          unreadable: unreadable,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
};

let scanned: Array<CaptureCall> | null = null;

const scanAll: () => Array<CaptureCall> = (): Array<CaptureCall> => {
  if (!scanned) {
    scanned = SOURCE_ROOTS.flatMap((root: string) => {
      return sourceFiles(root);
    }).flatMap(scanFile);
  }

  return scanned;
};

describe("the property names of every analytics event in the code", () => {
  test("the scan finds the calls that send events, server and browser", () => {
    const calls: Array<CaptureCall> = scanAll();
    const files: Set<string> = new Set(
      calls.map((call: CaptureCall): string => {
        return call.file;
      }),
    );

    expect(calls.length).toBeGreaterThanOrEqual(25);

    for (const file of [
      "packages/Common/Server/Services/MonitorService.ts",
      "packages/Common/Server/Services/ProjectService.ts",
      "packages/Common/Server/Services/UserService.ts",
      "packages/Common/Server/Services/ProjectMilestoneService.ts",
      "packages/Common/UI/Utils/ProductEvents.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Home/GettingStarted.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/AIChat/useAiChat.ts",
    ]) {
      expect(files.has(path.join(file))).toBe(true);
    }
  });

  test("every call's properties can be read", () => {
    const unreadable: Array<string> = scanAll()
      .filter((call: CaptureCall): boolean => {
        return call.unreadable.length > 0;
      })
      .map((call: CaptureCall): string => {
        return `${call.file}:${call.line}: ${call.unreadable.join(", ")}`;
      });

    expect(unreadable).toEqual([]);
  });

  test("no event carries a name, an email, an address or text somebody wrote", () => {
    const offenders: Array<string> = [];

    for (const call of scanAll()) {
      for (const key of call.keys) {
        if (isForbiddenPropertyName(key)) {
          offenders.push(`${call.file}:${call.line}: ${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("server/project_created no longer carries the project's name", () => {
    const projectCreated: Array<CaptureCall> = scanAll().filter(
      (call: CaptureCall): boolean => {
        return call.file.endsWith(path.join("Services", "ProjectService.ts"));
      },
    );

    expect(projectCreated.length).toBeGreaterThan(0);

    for (const call of projectCreated) {
      expect(call.keys).not.toContain("project_name");
    }
  });

  test("the scan would catch one: a name in an event's properties is found", () => {
    const fixture: string = path.join(
      __dirname,
      "Fixtures",
      "EventWithPersonalProperty.ts.txt",
    );

    const calls: Array<CaptureCall> = scanSource(
      path.join(__dirname, "Fixtures", "EventWithPersonalProperty.ts"),
      fs.readFileSync(fixture, "utf8"),
    );
    const keys: Array<string> = calls.flatMap((call: CaptureCall) => {
      return call.keys;
    });

    expect(calls).toHaveLength(3);
    expect(keys).toEqual(
      expect.arrayContaining([
        "project_name",
        "owner_email",
        "plan",
        "message_text",
      ]),
    );
    expect(keys.filter(isForbiddenPropertyName).sort()).toEqual(
      ["message_text", "owner_email", "project_name"].sort(),
    );
    // The properties built by a call nobody reviewed cannot be read: a failure.
    expect(
      calls.filter((call: CaptureCall): boolean => {
        return call.unreadable.length > 0;
      }),
    ).toHaveLength(1);
  });
});
