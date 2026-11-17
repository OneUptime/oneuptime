import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import PresentedKeysInPlace, {
  PresentedKeyProtection,
  PresentedKeyTarget,
} from "../../../FeatureSet/Workers/Utils/PresentedKeysInPlace";
import { inlineCode } from "./DocsTranslationChecks";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import {
  flattened,
  otherChangesItems,
  sectionAtEnglishPlace,
} from "./UpgradingDocsNotes";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import { SETTLE_PERIOD_MS } from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import { getTableColumn } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says the keys and tokens presented to OneUptime are
 * encrypted, and SCIM bearer tokens stored hashed and shown once (#9012) -
 * held to the code that makes it true.
 *
 * The note (installation/upgrading, "Other changes in 16": OneUptime 16
 * brought it) is the first of them, before the note on OneUptime AI's code
 * work about a private record, and every translation carries it in the
 * English note's place, with the English note's code and Reset Bearer Token as the
 * reader's Dashboard draws it. What it claims is what the code does:
 *
 *   - it names every key the upgrade protects: one phrase for each column
 *     the PresentedKeys:ProtectAtRest job protects, and only SCIM's are
 *     hashed;
 *   - nobody reads a SCIM bearer token back: its column has no reader, so a
 *     read that selects it is refused, and it is kept as its hash;
 *   - the upgrade changes no key and writes the lookup hashes
 *     (HashPresentedKeysForLookup, after the schema migrations that keep
 *     every key), and the Workers job protects the keys a day later;
 *   - the steps for 16 name the status page SCIM resource an earlier
 *     Terraform provider fails on, and `bearerToken` among the reads
 *     refused, in every language.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**The keys presented to OneUptime are encrypted, and SCIM bearer tokens are stored hashed and shown only when they are made.**";
// The note after it: OneUptime AI's code work about a private record (#9188).
const NEXT_LEAD: string =
  "**OneUptime AI's code work about a private incident or alert follows its owners too.**";

// The major version whose "Other changes in" list carries the note.
const MAJOR: number = 16;

const RESET_BEARER_TOKEN: string = "Reset Bearer Token";

// How the note names each column the job protects.
const NAMED_AS: Record<string, string> = {
  "Probe.key": "A probe's, a Runner's and an AI agent's key",
  "Runner.key": "A probe's, a Runner's and an AI agent's key",
  "AIAgent.key": "A probe's, a Runner's and an AI agent's key",
  "TelemetryIngestionKey.secretKey": "telemetry ingestion keys",
  "IoTDeviceCredential.secretKey": "IoT device secrets",
  "Monitor.serverMonitorSecretKey": "a monitor's secret keys",
  "Monitor.incomingRequestSecretKey": "a monitor's secret keys",
  "Monitor.incomingEmailSecretKey": "a monitor's secret keys",
  "Workflow.webhookSecretKey": "workflow and runbook webhook keys",
  "Workflow.incomingEmailSecretKey": "a workflow's email key",
  "Runbook.webhookSecretKey": "workflow and runbook webhook keys",
  "StatusPage.embeddedOverallStatusToken": "status page embed tokens",
  "DataProduct.badgeToken": "data product badge tokens",
  "StatusPageSubscriber.unsubscribeToken": "subscribers' unsubscribe tokens",
  "ProjectSCIM.bearerToken": "A SCIM bearer token is stored as its hash",
  "StatusPageSCIM.bearerToken": "A SCIM bearer token is stored as its hash",
};

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// The numbered steps of "What you need to do for 16", each on one line.
function stepsFor16(language: string): Array<string> {
  return sectionAtEnglishPlace(language, "What you need to do for 16")
    .split(/\n(?=\d+\. )/)
    .slice(1)
    .map((step: string): string => {
      return flattened(step);
    });
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en", MAJOR);
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on the keys presented to OneUptime", () => {
  it("is a note of the 15 → 16 changes, once, the first of them", () => {
    expect(NOTE_INDEX).toBe(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("names every key the upgrade protects, and only SCIM's are hashed", () => {
    const targets: Array<PresentedKeyTarget> =
      PresentedKeysInPlace.getTargets();
    const names: Array<string> = targets.map(
      (target: PresentedKeyTarget): string => {
        return `${target.tableName}.${target.column}`;
      },
    );

    // A column protected now and not named here fails: say it in the note.
    expect([...names].sort()).toEqual(Object.keys(NAMED_AS).sort());

    for (const name of names) {
      expect({ name, named: ENGLISH_NOTE.includes(NAMED_AS[name]!) }).toEqual({
        name,
        named: true,
      });
    }

    expect(
      targets
        .filter((target: PresentedKeyTarget): boolean => {
          return target.protection === PresentedKeyProtection.Hash;
        })
        .map((target: PresentedKeyTarget): string => {
          return target.tableName;
        })
        .sort(),
    ).toEqual(["ProjectSCIM", "StatusPageSCIM"]);
    expect(ENGLISH_NOTE).toContain(
      "Now each is stored encrypted, and the pages that show one show it as before.",
    );
  });

  it("says nobody reads a SCIM bearer token back, as its column has no reader and keeps only its hash", () => {
    for (const model of [
      new ProjectSCIM(),
      new StatusPageSCIM(),
    ] as Array<BaseModel>) {
      expect(model.getColumnAccessControlFor("bearerToken")?.read).toEqual([]);
      expect(getTableColumn(model, "bearerToken")?.type).toBe(
        TableColumnType.HashedString,
      );
      expect(getTableColumn(model, "bearerToken")?.presentedKey).toBe(true);
    }

    expect(ENGLISH_NOTE).toContain(
      "and the API answers it only to the create and refuses a read whose `select` names `bearerToken`.",
    );
    expect(ENGLISH_NOTE).toContain(`**${RESET_BEARER_TOKEN}**`);

    for (const page of [
      "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx",
      "ee/Dashboard/Identity/Pages/StatusPages/SCIM.tsx",
    ]) {
      if (!fs.existsSync(path.join(REPO_ROOT, page))) {
        continue;
      }

      expect(source(page)).toContain(`title: "${RESET_BEARER_TOKEN}"`);
      expect(source(page)).toContain("<ShownOnceSecretModal");
    }
  });

  it("says the upgrade keeps every key and protects it a day later, in Workers", () => {
    const dataMigrations: string = source(
      "packages/App/FeatureSet/Workers/DataMigrations/Index.ts",
    );
    const schemaMigrations: string = source(
      "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
    );
    const workers: string = source("packages/App/FeatureSet/Workers/Index.ts");
    const job: string = source(
      "packages/App/FeatureSet/Workers/Jobs/PresentedKeys/ProtectAtRest.ts",
    );

    expect(dataMigrations).toContain("new HashPresentedKeysForLookup(),");

    for (const migration of [
      "PresentedKeysEncryptedColumns1809182900000,",
      "StatusPageEmbedTokenEncryptedColumn1809182910000,",
      "StatusPageSubscriberTokenEncryptedColumn1809182920000,",
      "MonitorKeysEncryptedColumns1809182930000,",
      "PresentedKeyLookupHashIndexes1809182940000,",
    ]) {
      expect(schemaMigrations).toContain(migration);
    }

    expect(workers).toContain(`import "./Jobs/PresentedKeys/ProtectAtRest";`);
    expect(job).toContain(`"PresentedKeys:ProtectAtRest"`);
    expect(SETTLE_PERIOD_MS).toBe(24 * 60 * 60 * 1000);
    expect(ENGLISH_NOTE).toContain(
      "The upgrade keeps every key as it was and adds the hash it is looked up by, so servers of the earlier release still running during the upgrade keep checking keys; a day later, Workers encrypt or hash the keys stored before, in place.",
    );
    expect(ENGLISH_NOTE).toContain(
      "A key made or reset during that day is stored protected at once, and a server of the earlier release refuses it until it is replaced.",
    );
  });

  it("says the steps for 16: the earlier provider fails on status page SCIM, and a read of `bearerToken` is refused", () => {
    const steps: Array<string> = stepsFor16("en");

    expect(steps[0]).toContain(
      "`terraform plan` fails on every `oneuptime_status_page_scim`",
    );
    expect(steps[1]).toContain(
      "A read whose `select` names a SCIM connection's `bearerToken` is refused",
    );

    // The provider's name for it: the spec's tag, as the generator names resources.
    expect(new StatusPageSCIM().singularName).toBe("Status Page SCIM");
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on the keys presented to OneUptime",
  (language: string) => {
    const items: Array<string> = otherChangesItems(language, MAJOR);
    const note: string = flattened(items[NOTE_INDEX] || "");

    it("is in the English note's place, under a lead of its own", () => {
      expect(items.length).toBe(ENGLISH_ITEMS.length);
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
    });

    it("carries the English note's code", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    });

    it("names Reset Bearer Token as this language's Dashboard draws it", () => {
      const drawn: string = drawnDashboardLabel(language, RESET_BEARER_TOKEN);

      expect(note).toContain(`**${drawn}**`);
    });

    it("names the status page SCIM resource and `bearerToken` in the steps for 16", () => {
      const steps: Array<string> = stepsFor16(language);

      expect(steps).toHaveLength(stepsFor16("en").length);
      expect(inlineCode(steps[0]!)).toEqual(inlineCode(stepsFor16("en")[0]!));
      expect(inlineCode(steps[1]!)).toEqual(inlineCode(stepsFor16("en")[1]!));
    });
  },
);
