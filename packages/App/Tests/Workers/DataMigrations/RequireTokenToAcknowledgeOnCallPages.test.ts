import PostgresDatabase from "Common/Server/Infrastructure/PostgresDatabase";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import logger from "Common/Server/Utils/Logger";
import { ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME } from "Common/Server/Utils/OnCall/OnCallAcknowledgeLink";
import RequireTokenToAcknowledgeOnCallPages from "../../../FeatureSet/Workers/DataMigrations/RequireTokenToAcknowledgeOnCallPages";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * RequireTokenToAcknowledgeOnCallPages records when this server was
 * upgraded to on-call links that carry the page's own token (#10025): the
 * runner writes its row in the DataMigrations table as it runs it, and
 * OnCallAcknowledgeLink reads the moment from there. A link without a
 * token acknowledges a page sent before that moment, for a week after it
 * was sent. Here:
 *
 *   1. it carries the name OnCallAcknowledgeLink reads it by;
 *   2. it is registered once, before the slot
 *      BackfillIncidentCallTranscriptSignInAccount keeps just before the
 *      last one, AddAuditLogMcpClientColumns';
 *   3. it changes no data, and says what it records; rollback changes
 *      nothing either.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// The migrations Index.ts registers, in order, its comments left out.
function registeredMigrations(): Array<string> {
  const index: string = fs
    .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

let infoSpy: jest.SpyInstance;

beforeEach(() => {
  infoSpy = jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RequireTokenToAcknowledgeOnCallPages", () => {
  test("carries the name OnCallAcknowledgeLink reads the upgrade by", () => {
    expect(new RequireTokenToAcknowledgeOnCallPages().name).toBe(
      ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME,
    );
    expect(ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME).toBe(
      "RequireTokenToAcknowledgeOnCallPages",
    );
  });

  test("is registered once, before the two slots at the end that others keep", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === "RequireTokenToAcknowledgeOnCallPages";
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered[registered.length - 2]).toBe(
      "BackfillIncidentCallTranscriptSignInAccount",
    );
    expect(
      registered.indexOf("RequireTokenToAcknowledgeOnCallPages"),
    ).toBeLessThan(registered.length - 2);
    // Its import is the one Index.ts registers.
    expect(
      fs.readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8"),
    ).toContain(
      'import RequireTokenToAcknowledgeOnCallPages from "./RequireTokenToAcknowledgeOnCallPages";',
    );
  });

  test("changes no data: it reads and writes nothing, and says what its run records", async () => {
    const dataSource: jest.SpyInstance = jest.spyOn(
      PostgresDatabase,
      "getDataSource",
    );
    const findSpy: jest.SpyInstance = jest.spyOn(
      DataMigrationService,
      "findOneBy",
    );
    const createSpy: jest.SpyInstance = jest.spyOn(
      DataMigrationService,
      "create",
    );

    await new RequireTokenToAcknowledgeOnCallPages().migrate();

    expect(dataSource).not.toHaveBeenCalled();
    expect(findSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]![0])).toBe(
      "RequireTokenToAcknowledgeOnCallPages: on-call links acknowledge with the page's own token from now on. A link sent before now without one acknowledges its page for a week after the page was sent.",
    );
  });

  test("rollback changes nothing either", async () => {
    await expect(
      new RequireTokenToAcknowledgeOnCallPages().rollback(),
    ).resolves.toBeUndefined();
  });
});
