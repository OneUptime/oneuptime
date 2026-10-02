import { describe, expect, test } from "@jest/globals";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE HANDSHAKE BETWEEN A TEMPLATE AND THE CODE THAT SENDS IT.
 *
 * A template that paints `incidentSeverity` in its colour reads
 * `incidentSeverityColor` and `incidentSeverityTextColor`. Nothing fails
 * when the sender forgets to set them: the row just renders neutral, and the
 * email quietly looks the way it did before the colours existed. So this
 * reads the TypeScript of every sender in the Workers and Common/Server,
 * finds the templates it sends (EmailTemplateType.X), works out which colour
 * pairs those templates read, and requires the sender to build each of them
 * with EmailColorUtil.getTemplateVariables - the only place colours are
 * sanitised - and to select `color` on every severity and state relation it
 * reads a name from.
 *
 * It also forbids the shortcut this replaced: a sender reading
 * `.color?.toString()` straight into a variable puts a project's raw colour
 * string into a style attribute.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const TEMPLATES_DIR: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Notification",
  "Templates",
);

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Workers"),
  path.join(PACKAGES_DIR, "Common", "Server"),
];

/*
 * Built by EmailRollupRenderer from the queue, not by a sender; pinned by
 * NotificationRollupTemplate.test.ts and EmailRollupRenderer.test.ts.
 */
const TEMPLATES_BUILT_ELSEWHERE: Array<string> = ["NotificationRollup.hbs"];

// Relations a sender reads a severity, state or status name from.
const NAMED_RELATIONS: Array<string> = [
  "currentIncidentState",
  "incidentSeverity",
  "currentAlertState",
  "alertSeverity",
  "currentScheduledMaintenanceState",
  "currentMonitorStatus",
  "incidentState",
  "alertState",
  "scheduledMaintenanceState",
  "monitorStatus",
];

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", "build", "dist", "Tests"].includes(entry.name)) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, callback);
  });
}

// Every EmailTemplateType.X the code (not its comments) refers to.
function templatesSentBy(sourceFile: ts.SourceFile): Set<string> {
  const templates: Set<string> = new Set<string>();

  visit(sourceFile, (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "EmailTemplateType"
    ) {
      const member: string = node.name.text;
      const value: string | undefined = (
        EmailTemplateType as unknown as Record<string, string>
      )[member];

      if (value) {
        templates.add(value);
      }
    }
  });

  return templates;
}

// The names passed to EmailColorUtil.getTemplateVariables("<name>", ...).
function colourPairsBuiltBy(sourceFile: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  visit(sourceFile, (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "EmailColorUtil" &&
      node.expression.name.text === "getTemplateVariables"
    ) {
      const first: ts.Expression | undefined = node.arguments[0];

      if (first && ts.isStringLiteralLike(first)) {
        names.add(first.text);
      }
    }
  });

  return names;
}

/*
 * The colour pairs a template reads: its coloured detail rows and list
 * items, and the transitions it includes.
 */
function colourPairsReadBy(template: string): Set<string> {
  const source: string = fs.readFileSync(
    path.join(TEMPLATES_DIR, template),
    "utf8",
  );
  const names: Set<string> = new Set<string>();

  for (const match of source.matchAll(/\bcolor=(\w+)Color\b/g)) {
    names.add(match[1]!);
  }

  // A list item's dot; its `...TextColor` fallback check is the same pair.
  for (const match of source.matchAll(/\{\{#if this\.(\w+)Color\}\}/g)) {
    if (!match[1]!.endsWith("Text")) {
      names.add(match[1]!);
    }
  }

  if (source.includes("{{> StateTransition")) {
    names.add("currentState");
    names.add("previousState");
  }

  if (source.includes("{{> StatusTransition")) {
    names.add("currentStatus");
    names.add("previousStatus");
  }

  return names;
}

// Relation selects that read a name without its colour.
function namedSelectsWithoutColour(sourceFile: ts.SourceFile): Array<string> {
  const missing: Array<string> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (
      !ts.isPropertyAssignment(node) ||
      !ts.isIdentifier(node.name) ||
      !NAMED_RELATIONS.includes(node.name.text)
    ) {
      return;
    }

    let initializer: ts.Expression = node.initializer;

    if (ts.isAsExpression(initializer)) {
      initializer = initializer.expression;
    }

    if (!ts.isObjectLiteralExpression(initializer)) {
      return;
    }

    const keys: Array<string> = initializer.properties
      .filter((property: ts.ObjectLiteralElementLike): boolean => {
        return (
          ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
        );
      })
      .map((property: ts.ObjectLiteralElementLike): string => {
        return ((property as ts.PropertyAssignment).name as ts.Identifier).text;
      });

    if (keys.includes("name") && !keys.includes("color")) {
      const line: number =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      missing.push(`${node.name.text} (line ${line})`);
    }
  });

  return missing;
}

interface Sender {
  file: string;
  relativePath: string;
  sourceFile: ts.SourceFile;
  templates: Array<string>;
  colourPairs: Set<string>;
}

const SENDERS: Array<Sender> = [];

for (const directory of SCAN_DIRS) {
  for (const file of listSourceFiles(directory)) {
    const source: string = fs.readFileSync(file, "utf8");

    if (!source.includes("EmailTemplateType.")) {
      continue;
    }

    const sourceFile: ts.SourceFile = parse(file);
    const templates: Array<string> = Array.from(templatesSentBy(sourceFile))
      .filter((template: string): boolean => {
        return !TEMPLATES_BUILT_ELSEWHERE.includes(template);
      })
      .sort();
    const colourPairs: Set<string> = new Set<string>();

    for (const template of templates) {
      for (const name of colourPairsReadBy(template)) {
        colourPairs.add(name);
      }
    }

    if (colourPairs.size === 0) {
      continue;
    }

    SENDERS.push({
      file: file,
      relativePath: path.relative(PACKAGES_DIR, file),
      sourceFile: sourceFile,
      templates: templates,
      colourPairs: colourPairs,
    });
  }
}

describe("the senders of coloured templates", () => {
  test("are all found: every owner, on-call and subscriber family", () => {
    const found: Array<string> = SENDERS.map((sender: Sender): string => {
      return sender.relativePath;
    });

    // A sample from every family, so a broken scan cannot pass vacuously.
    for (const expected of [
      "App/FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification.ts",
      "App/FeatureSet/Workers/Jobs/AlertOwners/SendStateChangeNotification.ts",
      "App/FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendAlertAddedNotification.ts",
      "App/FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendIncidentAddedNotification.ts",
      "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendUnresolvedReminderNotification.ts",
      "App/FeatureSet/Workers/Jobs/MonitorOwners/SendStatusChangeNotification.ts",
      "App/FeatureSet/Workers/Jobs/IncidentMembers/SendMemberAddedNotification.ts",
      "App/FeatureSet/Workers/Jobs/IncidentSla/CheckSlaBreaches.ts",
      "App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
      "Common/Server/Services/UserNotificationRuleService.ts",
      "Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder.ts",
    ]) {
      expect(found).toContain(expected);
    }

    expect(SENDERS.length).toBeGreaterThanOrEqual(38);
  });
});

describe.each(
  SENDERS.map((sender: Sender): [string, Sender] => {
    return [sender.relativePath, sender];
  }),
)("%s", (_relativePath: string, sender: Sender) => {
  test("builds every colour pair its templates read, through EmailColorUtil", () => {
    const built: Set<string> = colourPairsBuiltBy(sender.sourceFile);

    for (const name of sender.colourPairs) {
      expect({
        template: sender.templates,
        pair: name,
        built: built.has(name),
      }).toEqual({ template: sender.templates, pair: name, built: true });
    }
  });

  test("selects the colour wherever it reads a severity, state or status name", () => {
    expect(namedSelectsWithoutColour(sender.sourceFile)).toEqual([]);
  });

  test("never puts a raw colour string into a template variable", () => {
    const source: string = fs.readFileSync(sender.file, "utf8");

    expect(source).not.toMatch(/\.color\??\.toString\(\)/);
  });
});

describe("the alert-created severity badge", () => {
  const sender: Sender | undefined = SENDERS.find((candidate: Sender) => {
    return candidate.templates.includes(
      EmailTemplateType.AlertOwnerResourceCreated,
    );
  });

  test("gets both of its colours from one sanitised pair, with the slate fallback", () => {
    const source: string = fs.readFileSync(sender!.file, "utf8");

    expect(source).toContain("EmailColorUtil.getColorPair(");
    expect(source).toContain("severityColor: severityColors.color");
    expect(source).toContain("severityTextColor: severityColors.textColor");
    expect(source).toMatch(/color: "#64748b",\s*textColor: "#64748b"/);
  });
});

describe("the analysis itself", () => {
  test("reads the colour pairs of a template with rows, lists and a transition", () => {
    expect(
      Array.from(
        colourPairsReadBy(EmailTemplateType.AlertEpisodeOwnerAlertAdded),
      ).sort(),
    ).toEqual(["alertSeverity", "currentState"]);
    expect(
      Array.from(
        colourPairsReadBy(EmailTemplateType.IncidentOwnerStateChanged),
      ).sort(),
    ).toEqual(["currentState", "incidentSeverity", "previousState"]);
    expect(
      Array.from(
        colourPairsReadBy(EmailTemplateType.MonitorOwnerStatusChanged),
      ).sort(),
    ).toEqual(["currentStatus", "previousStatus"]);
  });

  test("sees a select that reads a name but not its colour", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "example.ts",
      [
        "const a = { select: { incidentSeverity: { name: true } } };",
        "const b = { select: { currentAlertState: { name: true, color: true } } };",
        "const c = { select: { currentIncidentState: { name: true } as Select<IncidentState> } };",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    expect(namedSelectsWithoutColour(sourceFile)).toEqual([
      "incidentSeverity (line 1)",
      "currentIncidentState (line 3)",
    ]);
  });

  test("ignores template names that only appear in comments", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "example.ts",
      "// sends EmailTemplateType.IncidentOwnerAdded\nconst x = EmailTemplateType.AlertOwnerAdded;",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    expect(Array.from(templatesSentBy(sourceFile))).toEqual([
      EmailTemplateType.AlertOwnerAdded,
    ]);
  });
});
