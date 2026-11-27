import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Issue #11235: every App server posts the Slack and Microsoft Teams
 * messages another App server held for a new record's Created message and
 * was killed before posting - from what that server stored of them in
 * Valkey, in their turn and once (WorkspaceCreatedMessageFirst).
 *
 * - App/Index.ts starts it, once, with the rule service's poster of stored
 *   messages: without it, no server takes over a killed server's messages,
 *   and those messages are lost as they were before.
 * - It starts once Valkey is connected and the queue workers start: those
 *   are started only once every datastore is reached and the schema this
 *   code needs is there, and posting a message reads the rules and the
 *   workspace's tokens from the database.
 *
 * Read from the source with comments removed, so prose cannot satisfy it.
 */

const INDEX_PATH: string = path.join(__dirname, "../../Index.ts");

function code(filePath: string): string {
  const source: string = fs.readFileSync(filePath, "utf8");
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    path.basename(filePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
}

function indexOfOnly(haystack: string, needle: string): number {
  const first: number = haystack.indexOf(needle);
  expect({ needle, found: first >= 0 }).toEqual({ needle, found: true });
  expect({
    needle,
    unique: haystack.indexOf(needle, first + 1) === -1,
  }).toEqual({ needle, unique: true });
  return first;
}

describe("App/Index.ts starts taking over the held messages of a killed App server", () => {
  const source: string = code(INDEX_PATH);
  const START: string = "WorkspaceCreatedMessageFirst.takeOverForStoppedServers(";

  test("once, posting each with the rule service's poster of stored messages", () => {
    const start: number = indexOfOnly(source, START);
    const call: string = source.slice(start, source.indexOf("});", start));

    expect(call).toContain(
      "WorkspaceNotificationRuleService.postStoredWorkspaceMarkdownNotification(stored)",
    );
  });

  test("once Valkey is connected and the queue workers start", () => {
    const valkey: number = indexOfOnly(source, "await Redis.connect();");
    const workers: number = indexOfOnly(
      source,
      "QueueWorker.startProcessingJobs();",
    );
    const start: number = indexOfOnly(source, START);

    expect(valkey).toBeLessThan(start);
    expect(workers).toBeLessThan(start);
  });

  test("inside the App's init, which a failure stops", () => {
    const init: number = indexOfOnly(
      source,
      "const init: PromiseVoidFunction = async (): Promise<void> => {",
    );
    const failed: number = indexOfOnly(source, 'logger.error("App Init Failed:"');
    const start: number = indexOfOnly(source, START);

    expect(init).toBeLessThan(start);
    expect(start).toBeLessThan(failed);
  });

  test("with what it starts imported from Common", () => {
    expect(source).toContain(
      'import WorkspaceCreatedMessageFirst from "Common/Server/Utils/Workspace/WorkspaceCreatedMessageFirst";',
    );
    expect(source).toContain(
      'import WorkspaceNotificationRuleService from "Common/Server/Services/WorkspaceNotificationRuleService";',
    );
  });
});
