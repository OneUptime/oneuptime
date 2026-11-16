// UX rule: Docs/ux/README.md#lists
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A phone's card keeps what a list is read for.
 *
 * On a phone the shared table draws each row as a card, and a card leaves
 * out every column marked hideOnMobile (Table, TableRow). That is how a
 * list keeps its cards short: labels, owners, a second date. But two core
 * lists left out the one fact people open them for (#9011):
 *
 *   - the incidents' card drew the number, title, state and duration, and
 *     never the severity, while the alerts' card draws its severity under
 *     its state;
 *   - the maintenance events' card drew the title, state and duration, and
 *     never when the event starts.
 *
 * This holds the core lists' phone cards to the facts people triage by.
 * It reads each list's `columns={[...]}` - the App suite runs in plain Node
 * with no renderer - and fails when a column below is missing (renamed: say
 * which column took its place here) or is marked hideOnMobile.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

interface PhoneCard {
  // Relative to the Dashboard's src.
  file: string;
  // The column titles its phone card must draw.
  keeps: Array<string>;
  why: string;
}

const PHONE_CARDS: Array<PhoneCard> = [
  {
    file: "Components/Incident/IncidentsTable.tsx",
    keeps: ["Incident Number", "Title", "State", "Severity"],
    why: "How bad an incident is, and where it stands, decide who opens it first.",
  },
  {
    file: "Components/Alert/AlertsTable.tsx",
    keeps: ["Alert Number", "Title", "State", "Severity"],
    why: "As for an incident: an alert is triaged by its state and severity.",
  },
  {
    file: "Components/IncidentEpisode/IncidentEpisodesTable.tsx",
    keeps: ["State", "Severity"],
    why: "An episode groups incidents, and is triaged as one is.",
  },
  {
    file: "Components/AlertEpisode/AlertEpisodesTable.tsx",
    keeps: ["State", "Severity"],
    why: "An episode groups alerts, and is triaged as one is.",
  },
  {
    file: "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
    keeps: ["Title", "Current State", "Starts At"],
    why: "When it starts is what a maintenance event is read for; Duration says how long.",
  },
  {
    file: "Components/Monitor/MonitorTable.tsx",
    keeps: ["Name", "Monitor Status"],
    why: "A monitor is read for whether it is up.",
  },
];

interface ColumnFound {
  title: string;
  hiddenOnPhones: boolean;
}

function stringValueOf(
  property: ts.ObjectLiteralElementLike,
  name: string,
): string | null {
  if (
    !ts.isPropertyAssignment(property) ||
    property.name.getText() !== name ||
    !ts.isStringLiteralLike(property.initializer)
  ) {
    return null;
  }

  return property.initializer.text;
}

function isTrue(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        property.name.getText() === name &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword
      );
    },
  );
}

// The columns a file's `columns={[...]}` attributes hand its table.
function columnsOf(file: string): Array<ColumnFound> {
  const text: string = fs.readFileSync(file, "utf8");
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const columns: Array<ColumnFound> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === "columns" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isArrayLiteralExpression(node.initializer.expression)
    ) {
      for (const element of node.initializer.expression.elements) {
        if (!ts.isObjectLiteralExpression(element)) {
          continue;
        }

        const title: string | null =
          element.properties
            .map((property: ts.ObjectLiteralElementLike) => {
              return stringValueOf(property, "title");
            })
            .find((value: string | null): boolean => {
              return value !== null;
            }) || null;

        if (title !== null) {
          columns.push({
            title,
            hiddenOnPhones: isTrue(element, "hideOnMobile"),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return columns;
}

describe("A phone's card keeps what a list is read for", () => {
  test.each(PHONE_CARDS)(
    "$file draws $keeps on a phone",
    (card: PhoneCard): void => {
      const columns: Array<ColumnFound> = columnsOf(
        path.join(DASHBOARD_SOURCE, card.file),
      );

      // The parse found the list's columns at all.
      expect(columns.length).toBeGreaterThan(card.keeps.length);

      for (const title of card.keeps) {
        const matching: Array<ColumnFound> = columns.filter(
          (column: ColumnFound): boolean => {
            return column.title === title;
          },
        );

        expect({ title, found: matching.length > 0 }).toEqual({
          title,
          found: true,
        });

        expect({
          title,
          hiddenOnPhones: matching.some((column: ColumnFound): boolean => {
            return column.hiddenOnPhones;
          }),
          why: card.why,
        }).toEqual({ title, hiddenOnPhones: false, why: card.why });
      }
    },
  );

  test("still sees a column marked hideOnMobile, so a pass means something", () => {
    // Every core list folds its labels and owners off a phone's card.
    const columns: Array<ColumnFound> = columnsOf(
      path.join(DASHBOARD_SOURCE, "Components/Incident/IncidentsTable.tsx"),
    );

    expect(
      columns.find((column: ColumnFound): boolean => {
        return column.title === "Labels";
      })?.hiddenOnPhones,
    ).toBe(true);
  });

  test("the incidents' and the alerts' cards agree on severity", () => {
    const severityOnPhones: (file: string) => boolean = (
      file: string,
    ): boolean => {
      return columnsOf(path.join(DASHBOARD_SOURCE, file)).some(
        (column: ColumnFound): boolean => {
          return column.title === "Severity" && !column.hiddenOnPhones;
        },
      );
    };

    expect(severityOnPhones("Components/Incident/IncidentsTable.tsx")).toBe(
      severityOnPhones("Components/Alert/AlertsTable.tsx"),
    );
  });
});
