import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ONLY A PERSON AT THE BUILDER STARTS A WORKFLOW THAT IS TURNED OFF.
 *
 * "Why do I have to enable a workflow in order to test run it?" A run that
 * carries startedByUserId goes ahead while the workflow is off, as a test
 * run (QueueWorkflow.addWorkflowToQueue). That is right for the two routes
 * behind the Builder's Run Workflow and Run just this step, which set it to
 * the signed-in caller they have just checked. Anywhere else it would be a
 * hole in what off means: a webhook, a schedule, a OneUptime event, an
 * incoming email or another workflow's Execute Workflow step passing a
 * person would start a workflow somebody turned off on purpose.
 *
 * So this reads every way a run is asked for - each call to
 * addWorkflowToQueue, executeWorkflow or scheduleWorkflow, and each value
 * declared as an ExecuteWorkflowType - in the workflow service and in
 * Common's server code (and ee/'s, when it is there), and holds the
 * startedByUserId among them to those two routes, each setting it from the
 * caller's own props.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const SCANNED_DIRECTORIES: Array<string> = [
  "packages/App/FeatureSet/Workflow",
  "packages/Common/Server",
  "ee",
].filter((directory: string): boolean => {
  return fs.existsSync(path.join(REPOSITORY_ROOT, directory));
});

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
]);

const RUN_REQUESTS: ReadonlySet<string> = new Set<string>([
  "addWorkflowToQueue",
  "executeWorkflow",
  "scheduleWorkflow",
]);

const RUN_REQUEST_TYPE: string = "ExecuteWorkflowType";

const PERSON_PROPERTY: string = "startedByUserId";

// The check that the caller may run this workflow, or this one step of it.
const RUN_ACCESS_CHECK: RegExp =
  /WorkflowRunAccess\.assertMayRun(?:Workflow|Step)\(/;

// The two routes behind the Builder, and what each sets the person from.
const ALLOWED_STARTERS: ReadonlyArray<{ file: string; value: string }> = [
  {
    file: "packages/App/FeatureSet/Workflow/API/Manual.ts",
    value: "databaseProps.userId",
  },
  {
    file: "packages/App/FeatureSet/Workflow/API/RunStep.ts",
    value: "databaseProps.userId",
  },
];

interface RunRequest {
  file: string;
  // The call or the declared type it was found at.
  site: string;
  // The startedByUserId it passes, as written; null when it passes none.
  person: string | null;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listSourceFiles(path.join(directory, entry.name)));
      }

      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.")
    ) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return null;
}

function personOf(
  literal: ts.ObjectLiteralExpression,
  file: ts.SourceFile,
): string | null {
  for (const property of literal.properties) {
    const name: ts.PropertyName | undefined = property.name;

    if (!name || !ts.isIdentifier(name) || name.text !== PERSON_PROPERTY) {
      continue;
    }

    if (ts.isPropertyAssignment(property)) {
      return property.initializer.getText(file);
    }

    // { startedByUserId } and anything else that names it.
    return property.getText(file);
  }

  return null;
}

// Every run asked for in one source text.
function findRunRequests(source: string, fileName: string): Array<RunRequest> {
  const file: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const requests: Array<RunRequest> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name: string | null = calleeName(node.expression);

      if (name && RUN_REQUESTS.has(name)) {
        for (const argument of node.arguments) {
          if (ts.isObjectLiteralExpression(argument)) {
            requests.push({
              file: fileName,
              site: `${name}(...)`,
              person: personOf(argument, file),
            });
          }
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      node.type.getText(file) === RUN_REQUEST_TYPE &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      requests.push({
        file: fileName,
        site: `: ${RUN_REQUEST_TYPE}`,
        person: personOf(node.initializer, file),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return requests;
}

const RUN_REQUESTS_FOUND: Array<RunRequest> = SCANNED_DIRECTORIES.flatMap(
  (directory: string): Array<RunRequest> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, directory)).flatMap(
      (file: string): Array<RunRequest> => {
        return findRunRequests(
          fs.readFileSync(file, "utf8"),
          path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
        );
      },
    );
  },
);

describe("who may hand the queue a person", () => {
  test("the scan sees every way a run is asked for, so the rule below is not vacuous", () => {
    const files: Array<string> = Array.from(
      new Set(
        RUN_REQUESTS_FOUND.map((request: RunRequest): string => {
          return request.file;
        }),
      ),
    );

    expect(files).toEqual(
      expect.arrayContaining([
        // The Builder's two routes.
        "packages/App/FeatureSet/Workflow/API/Manual.ts",
        "packages/App/FeatureSet/Workflow/API/RunStep.ts",
        // Another workflow's Execute Workflow step.
        "packages/App/FeatureSet/Workflow/Services/RunWorkflow.ts",
        "packages/Common/Server/Types/Workflow/Components/Workflow.ts",
        // The triggers.
        "packages/Common/Server/Types/Workflow/Components/Webhook.ts",
        "packages/Common/Server/Types/Workflow/Components/Schedule.ts",
        "packages/Common/Server/Types/Workflow/Components/IncomingEmail.ts",
        "packages/Common/Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel.ts",
      ]),
    );
    expect(RUN_REQUESTS_FOUND.length).toBeGreaterThanOrEqual(8);
  });

  test("only the Builder's Run Workflow and Run just this step pass a person", () => {
    const withPerson: Array<string> = RUN_REQUESTS_FOUND.filter(
      (request: RunRequest): boolean => {
        return request.person !== null;
      },
    ).map((request: RunRequest): string => {
      return request.file;
    });

    expect(withPerson.sort()).toEqual(
      ALLOWED_STARTERS.map((starter: { file: string }): string => {
        return starter.file;
      }).sort(),
    );
  });

  test.each(ALLOWED_STARTERS)(
    "$file sets the person from the caller it checked",
    (starter: { file: string; value: string }) => {
      const requests: Array<RunRequest> = RUN_REQUESTS_FOUND.filter(
        (request: RunRequest): boolean => {
          return request.file === starter.file && request.person !== null;
        },
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]!.person).toBe(starter.value);

      // ...after the checks that make databaseProps.userId a member's.
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, starter.file),
        "utf8",
      );
      const memberCheck: number = source.indexOf(
        "CommonAPI.assertAuthenticatedProjectMember(databaseProps)",
      );
      const accessCheck: number = source.search(RUN_ACCESS_CHECK);
      const queued: number = source.indexOf(
        `${PERSON_PROPERTY}: ${starter.value}`,
      );

      expect(memberCheck).toBeGreaterThan(-1);
      expect(accessCheck).toBeGreaterThan(memberCheck);
      expect(queued).toBeGreaterThan(accessCheck);
    },
  );
});

describe("the scan itself", () => {
  test("catches a trigger that passes a person, however it asks", () => {
    const requests: Array<RunRequest> = findRunRequests(
      `
        const run: ExecuteWorkflowType = { workflowId, returnValues: {}, startedByUserId: userId };
        await props.executeWorkflow({ workflowId, returnValues: {}, startedByUserId });
        await QueueWorkflow.addWorkflowToQueue({ workflowId, returnValues: {}, startedByUserId: req.body.user });
        await this.scheduleWorkflow({ workflowId, returnValues: {} }, "* * * * *");
      `,
      "Example.ts",
    );

    expect(
      requests.map((request: RunRequest): string | null => {
        return request.person;
      }),
    ).toEqual(["userId", "startedByUserId", "req.body.user", null]);
  });

  test("ignores a person named anywhere else", () => {
    expect(
      findRunRequests(
        `
          runLog.startedByUserId = userId;
          const select = { startedByUserId: true };
          await WorkflowLogService.create({ data: { startedByUserId: userId } });
        `,
        "Example.ts",
      ),
    ).toEqual([]);
  });
});
