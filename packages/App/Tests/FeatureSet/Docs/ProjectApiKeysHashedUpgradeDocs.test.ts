import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import { getResetApiKeyRoute } from "Common/Types/ApiKey/ApiKeyShownOnce";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says a project's API keys are stored hashed and
 * shown once (#8902), and say how they end (#8903) - held to the code that
 * makes it true.
 *
 * The note (installation/upgrading, "Other changes in 15": OneUptime 15
 * brought it) sits right after the note on the master API key, which was
 * hashed the same way first (#8901), and every translation carries it in the
 * English note's place,
 * with the English note's code and the key list's path as the reader's
 * Dashboard draws it. What it claims is what the code does:
 *
 *   - the upgrade hashes the keys there are: the HashProjectApiKeys data
 *     migration runs after the schema migration that widens the column;
 *   - the key list shows a new key once, and each key's hint in its place;
 *     the key's page has Reset API Key;
 *   - nothing reads a key back: the column has no reader, and the create's
 *     answer is the only one that holds it (shownOnce);
 *   - `POST /api-key/:id/reset-key` is the route ApiKeyAPI registers;
 *   - Terraform keeps `api_key` from the create, and an imported key and
 *     the `oneuptime_api_key` data source have none, as the provider says;
 *   - rolled back, the schema migration gives each hashed key a new one.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**A project's API keys are stored hashed, and each is shown only when it is made.**";
// The note before it: the master API key, hashed first (#8901).
const PREVIOUS_LEAD: string =
  "**The master API key is stored hashed, and shown only when it is made.**";
// The note after it.
const NEXT_LEAD: string =
  "**What is done about a private record follows its owners too";

// The major version whose "Other changes in" list carries the note.
const MAJOR: number = 15;

const KEY_LIST_PATH: Array<string> = [
  "Project Settings",
  "Advanced",
  "API Keys",
];

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en", MAJOR);
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return item.startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on a project's API keys", () => {
  it("is a note of the 14 → 15 changes, once, right after the note on the master API key", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return item.includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      ENGLISH_ITEMS[NOTE_INDEX - 1]!.startsWith(`- ${PREVIOUS_LEAD}`),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says the upgrade hashes the keys there are, as a data migration does after the column is widened", () => {
    const dataMigrations: string = source(
      "packages/App/FeatureSet/Workers/DataMigrations/Index.ts",
    );
    const schemaMigrations: string = source(
      "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );

    expect(dataMigrations).toContain("new HashProjectApiKeys(),");
    expect(dataMigrations.indexOf("new HashMasterApiKey(),")).toBeLessThan(
      dataMigrations.indexOf("new HashProjectApiKeys(),"),
    );
    expect(schemaMigrations).toContain("ApiKeyHashedColumn1809181200000,");
    expect(ENGLISH_NOTE).toContain(
      "Now only its hash is stored, and the upgrade hashes the keys you have: the scripts, integrations and Terraform configurations that sign in with them keep working, with no change.",
    );
  });

  it("names the key list as the Dashboard draws it, which shows a new key once and how each key ends", () => {
    const keys: string = source(
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/APIKeys.tsx",
    );
    const view: string = source(
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView.tsx",
    );

    expect(keys).toContain("<ShownOnceSecretModal");
    expect(keys).toContain(
      "<ApiKeyHint hint={item.apiKeyHint} isSmall={true} />",
    );
    expect(view).toContain("<ResetApiKeyCard");
    expect(ENGLISH_NOTE).toContain(
      `**${KEY_LIST_PATH.join(" → ")}** shows a new key once, when it is created or reset, to copy then, and says how each key ends in its place.`,
    );
  });

  it("says nothing reads a key back, as the key column has no reader and only the create answers it", () => {
    const apiKey: ApiKey = new ApiKey();
    const column: TableColumnMetadata = apiKey.getTableColumnMetadata("apiKey");

    expect(column.shownOnce).toBe(true);
    expect(apiKey.getColumnAccessControlFor("apiKey")?.read).toEqual([]);
    expect(apiKey.getColumnAccessControlFor("apiKey")?.create).toEqual([]);
    expect(ENGLISH_NOTE).toContain(
      "The API no longer reads a key back: the create answers it once",
    );
  });

  it("names the reset route ApiKeyAPI registers", () => {
    const api: string = source("packages/Common/Server/API/ApiKeyAPI.ts");

    expect(new ApiKey().getCrudApiPath()?.toString()).toBe("/api-key");
    expect(api).toContain(
      "`${new this.entityType().getCrudApiPath()?.toString()}/:id/${RESET_API_KEY_PATH}`",
    );
    expect(inlineCode(ENGLISH_NOTE)).toContain(
      `POST ${getResetApiKeyRoute(":id")}`,
    );
  });

  it("says what Terraform keeps, and what an imported key and the data source have, as the provider does", () => {
    const parser: string = source(
      "Scripts/TerraformProvider/Core/OpenAPIParser.ts",
    );

    // The resource and its attribute, as the provider names them.
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      expect.arrayContaining(["api_key", "oneuptime_api_key"]),
    );
    expect(parser).toContain(
      "Kept in state from the answer to the create: OneUptime never reads it back, so a resource imported into Terraform has none.",
    );
    expect(ENGLISH_NOTE).toContain(
      "upgrade the provider with the server: it keeps `api_key` in state from the create, where an earlier provider clears it at its next refresh, and an imported key, like the `oneuptime_api_key` data source, has none.",
    );
  });

  it("says a rollback gives each key a new one, as the schema migration's down does", () => {
    const migration: string = source(
      "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809181200000-ApiKeyHashedColumn.ts",
    );

    expect(migration).toContain(
      `THEN "apiKey"::uuid ELSE gen_random_uuid() END`,
    );
    expect(ENGLISH_NOTE).toContain(
      "Rolled back to an earlier release, each key is replaced by a new one, shown on its page: give it to whatever used the old one.",
    );
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on a project's API keys",
  (language: string) => {
    const items: Array<string> = otherChangesItems(language, MAJOR);
    const note: string = flattened(items[NOTE_INDEX] || "");

    it("is in the English note's place, under a lead of its own", () => {
      expect(items.length).toBe(ENGLISH_ITEMS.length);
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      expect(
        items.filter((item: string): boolean => {
          return item.includes("`POST /api-key/:id/reset-key`");
        }),
      ).toHaveLength(1);
    });

    it("carries the English note's code", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    });

    it("names the key list as this language's Dashboard draws it", () => {
      for (const segment of KEY_LIST_PATH) {
        const drawn: string = drawnDashboardLabel(language, segment);

        expect({ segment, drawn, named: note.includes(drawn) }).toEqual({
          segment,
          drawn,
          named: true,
        });
      }
    });
  },
);
