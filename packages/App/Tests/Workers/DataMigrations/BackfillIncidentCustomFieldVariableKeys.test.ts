import { beforeEach, describe, expect, test } from "@jest/globals";
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import logger from "Common/Server/Utils/Logger";
import BackfillIncidentCustomFieldVariableKeys from "../../../FeatureSet/Workers/DataMigrations/BackfillIncidentCustomFieldVariableKeys";
import fs from "fs";
import path from "path";

/*
 * An incident custom field created by a pod still on the previous version,
 * after the schema migration that added template keys had committed, has no
 * key - and only a create assigns one. This data migration gives such fields
 * the key the schema migration gave every field that existed then.
 *
 * Pinned here: it is registered after everything before it, runs the schema
 * migration's own backfill against the database, fills only fields without
 * a key, and lets a failure reach the runner. The backfill itself is pinned
 * by AddIncidentCustomFieldCreateAndNotificationSettingsMigration.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "BackfillIncidentCustomFieldVariableKeys";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

interface FakeRow {
  _id: string;
  projectId: string;
  name: string | null;
  variableKey: string | null;
}

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

// The database, as the backfill's two statements see it.
function fakeManager(rows: Array<FakeRow>): {
  query: jest.Mock;
} {
  return {
    query: jest.fn(async (sql: string, parameters?: Array<string>) => {
      if (sql.startsWith("SELECT")) {
        return rows.map((row: FakeRow): FakeRow => {
          return { ...row };
        });
      }

      // UPDATE ... FROM (VALUES ($1, $2), ...) ... AND "variableKey" IS NULL
      for (let i: number = 0; i < (parameters || []).length; i += 2) {
        const row: FakeRow | undefined = rows.find((item: FakeRow) => {
          return item._id === parameters![i];
        });

        if (row && row.variableKey === null) {
          row.variableKey = parameters![i + 1]!;
        }
      }

      return [];
    }),
  };
}

describe("BackfillIncidentCustomFieldVariableKeys", () => {
  const migration: BackfillIncidentCustomFieldVariableKeys =
    new BackfillIncidentCustomFieldVariableKeys();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated once in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    // The runner decides what to run by position: appended after the rest.
    test("was appended after the subscriber backfill", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(
        instantiations.indexOf(
          "BackfillStatusPageSubscriberUnsubscribeColumns",
        ) + 1,
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("migrate", () => {
    test("gives a key to a field without one, keeping the keys the project already has", async () => {
      const rows: Array<FakeRow> = [
        {
          _id: "20000000-0000-4000-8000-000000000001",
          projectId: PROJECT_ID,
          name: "Affected Location",
          variableKey: "affected_location",
        },
        {
          // Created by a pod on the previous version, after the migration.
          _id: "20000000-0000-4000-8000-000000000002",
          projectId: PROJECT_ID,
          name: "Affected Location",
          variableKey: null,
        },
      ];
      const manager: { query: jest.Mock } = fakeManager(rows);
      jest
        .spyOn(IncidentCustomFieldService, "getRepository")
        .mockReturnValue({ manager: manager } as never);

      await migration.migrate();

      expect(rows[0]!.variableKey).toBe("affected_location");
      expect(rows[1]!.variableKey).toBe("affected_location_2");

      // Only an empty key is filled, re-checked by the UPDATE itself.
      const update: string = String(manager.query.mock.calls[1]![0]);
      expect(update).toContain('"variableKey" IS NULL');

      const info: jest.Mock = logger.info as unknown as jest.Mock;
      expect(String(info.mock.calls[0]![0])).toContain("gave 1 ");
    });

    test("changes nothing when every field has a key", async () => {
      const manager: { query: jest.Mock } = fakeManager([
        {
          _id: "20000000-0000-4000-8000-000000000001",
          projectId: PROJECT_ID,
          name: "Region",
          variableKey: "region",
        },
      ]);
      jest
        .spyOn(IncidentCustomFieldService, "getRepository")
        .mockReturnValue({ manager: manager } as never);

      await migration.migrate();

      // The read only.
      expect(manager.query).toHaveBeenCalledTimes(1);
    });

    test("a failure reaches the runner, so it is not recorded as done", async () => {
      jest.spyOn(IncidentCustomFieldService, "getRepository").mockReturnValue({
        manager: {
          query: jest.fn(async () => {
            throw new Error("canceling statement due to lock timeout");
          }),
        },
      } as never);

      await expect(migration.migrate()).rejects.toThrow(
        "canceling statement due to lock timeout",
      );
    });
  });
});
