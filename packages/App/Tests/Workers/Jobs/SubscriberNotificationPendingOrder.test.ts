import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The incident and episode subscriber jobs send one notification at a time
 * and wait for it to finish before the next. They must read their Pending
 * notifications oldest first: the default order (DatabaseService.findBy) is
 * newest first, so an incident that went Investigating then Resolved within
 * a minute would tell subscribers "Resolved", then "Investigating" - which
 * reads as the incident reopening. Before these jobs waited for each send,
 * both went out within milliseconds and the order hardly showed.
 *
 * Checked on the TypeScript AST: every find call of a job whose query asks
 * for Pending notifications and whose select reads the row's version (the
 * rows it goes on to claim) sorts by createdAt ascending.
 */

const JOBS_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Workers",
  "Jobs",
);

const JOB_FILES: Array<string> = [
  "Incident/SendNotificationToSubscribers.ts",
  "Incident/SendPostmortemNotificationToSubscribers.ts",
  "IncidentStateTimeline/SendNotificationToSubscribers.ts",
  "IncidentPublicNote/SendNotificationToSubscribers.ts",
  "IncidentEpisode/SendNotificationToSubscribers.ts",
  "IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
  "IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
];

interface PendingRead {
  file: string;
  line: number;
  sort: string | null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property.initializer;
    }
  }

  return undefined;
}

// The find calls that read the Pending notifications a job goes on to claim.
function pendingReads(file: string): Array<PendingRead> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(JOBS_DIR, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  const reads: Array<PendingRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["findBy", "findAllBy"].includes(node.expression.name.getText()) &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const argument: ts.ObjectLiteralExpression = node.arguments[0];
      const query: ts.Expression | undefined = objectProperty(
        argument,
        "query",
      );
      const select: ts.Expression | undefined = objectProperty(
        argument,
        "select",
      );

      if (
        query
          ?.getText()
          .includes("StatusPageSubscriberNotificationStatus.Pending") &&
        select &&
        ts.isObjectLiteralExpression(select) &&
        objectProperty(select, "version")
      ) {
        const sort: ts.Expression | undefined = objectProperty(
          argument,
          "sort",
        );

        reads.push({
          file: file,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          sort: sort ? sort.getText().replace(/\s+/g, " ") : null,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return reads;
}

describe("the subscriber jobs read their Pending notifications oldest first", () => {
  test("every job has a Pending read to check", () => {
    for (const file of JOB_FILES) {
      expect(pendingReads(file).length).toBeGreaterThan(0);
    }

    // The note jobs read posted and updated notes separately.
    expect(
      pendingReads("IncidentPublicNote/SendNotificationToSubscribers.ts"),
    ).toHaveLength(2);
    expect(
      pendingReads(
        "IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
      ),
    ).toHaveLength(2);
  });

  test.each(JOB_FILES)("%s sorts by createdAt ascending", (file: string) => {
    for (const read of pendingReads(file)) {
      expect(`${read.file}:${read.line} ${read.sort}`).toBe(
        `${read.file}:${read.line} { createdAt: SortOrder.Ascending, }`,
      );
    }
  });
});
