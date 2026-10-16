import logger from "Common/Server/Utils/Logger";
import WorkspaceUserAuthTokenService from "Common/Server/Services/WorkspaceUserAuthTokenService";
import RemoveChatAccountLinksNotMadeBySignIn from "../../../FeatureSet/Workers/DataMigrations/RemoveChatAccountLinksNotMadeBySignIn";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * RemoveChatAccountLinksNotMadeBySignIn removes, once, the Slack and
 * Microsoft Teams account links people wrote through the API before only
 * the sign-ins could write one - with the notification methods made from
 * them. The walk itself is WorkspaceUserAuthTokenService
 * .removeLinksNotMadeBySignIn, held by the Common suite
 * WorkspaceUserAuthTokenLinksNotMadeBySignIn on real deletes and hooks.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs the walk once and says what it removed;
 *   3. a failure to walk at all is not swallowed: the runner stops the chain
 *      and the migration runs again;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "RemoveChatAccountLinksNotMadeBySignIn";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// The migrations as Index.ts registers them, in order.
const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

describe("RemoveChatAccountLinksNotMadeBySignIn", () => {
  let infoLogs: Array<string>;

  beforeEach(() => {
    infoLogs = [];

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });

  test("has the name it is recorded under", () => {
    expect(new RemoveChatAccountLinksNotMadeBySignIn().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("walks the links once and says what it removed", async () => {
    const walk: SpyInstance<
      typeof WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn
    > = jest
      .spyOn(WorkspaceUserAuthTokenService, "removeLinksNotMadeBySignIn")
      .mockResolvedValue({
        removedLinkCount: 4,
        removedSlackMethodCount: 2,
        removedMicrosoftTeamsMethodCount: 1,
        failedLinkCount: 1,
      });

    await new RemoveChatAccountLinksNotMadeBySignIn().migrate();

    expect(walk).toHaveBeenCalledTimes(1);

    const log: string = infoLogs.join("\n");

    expect(log).toContain(
      "removed 4 Slack or Microsoft Teams account link(s) no sign-in made",
    );
    expect(log).toContain(
      "with 2 Slack and 1 Microsoft Teams notification method(s) made from them",
    );
    expect(log).toContain("1 could not be removed");
  });

  test("nothing to remove: it says so", async () => {
    jest
      .spyOn(WorkspaceUserAuthTokenService, "removeLinksNotMadeBySignIn")
      .mockResolvedValue({
        removedLinkCount: 0,
        removedSlackMethodCount: 0,
        removedMicrosoftTeamsMethodCount: 0,
        failedLinkCount: 0,
      });

    await new RemoveChatAccountLinksNotMadeBySignIn().migrate();

    expect(infoLogs.join("\n")).toContain(
      "removed 0 Slack or Microsoft Teams account link(s)",
    );
  });

  test("a failure to walk stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(WorkspaceUserAuthTokenService, "removeLinksNotMadeBySignIn")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new RemoveChatAccountLinksNotMadeBySignIn().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    const walk: SpyInstance<
      typeof WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn
    > = jest.spyOn(WorkspaceUserAuthTokenService, "removeLinksNotMadeBySignIn");

    await new RemoveChatAccountLinksNotMadeBySignIn().rollback();

    expect(walk).not.toHaveBeenCalled();
  });
});
