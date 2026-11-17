import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import CredentialsAtRest, {
  CredentialsAtRestGroup,
} from "../../../FeatureSet/Workers/Utils/CredentialsAtRest";
import { inlineCode } from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItems,
  sectionAtEnglishPlace,
  upgradingPage,
} from "./UpgradingDocsNotes";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import { getMaxLengthFromTableColumnType } from "Common/Types/Database/ColumnLength";
import Encryption from "Common/Server/Utils/Encryption";
import { SETTLE_PERIOD_MS } from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade notes that say the webhook addresses and SNMP credentials an
 * install has are encrypted a day after the upgrade to 16, not at it
 * (#9266), that a device's legacy SNMP v3 object is moved and walked
 * (#9268), and that a Twilio token keeps its 500 characters (#9267) - held
 * to the code that makes them true, and to what rolling back means. With
 * them, the step for 15 that says the upgrade to 15, which encrypts in place
 * as it runs, fails a server of 14 still running.
 *
 * The note (installation/upgrading, "Other changes in 16") comes right after
 * the one on webhook addresses and SNMP credentials, and every translation
 * carries it in the English note's place, with the English note's code and
 * numbers. What the page claims is what the code does:
 *
 *   - the CredentialsAtRest:EncryptInPlace job waits on the data migrations
 *     of the webhook addresses and SNMP credentials, which the upgrade
 *     leaves as written, and masks what was logged meanwhile;
 *   - it waits on those the upgrade to 15 ran in place too, so what a server
 *     of 14 saved as written then is encrypted with the rest; the step for
 *     15 names their credentials;
 *   - a day is SETTLE_PERIOD_MS;
 *   - a device's legacy snmpV3Auth moves into its columns at the upgrade
 *     (MoveLegacySnmpV3AuthToColumns), and a Twilio token may be 500
 *     characters long again, where the varchar(500) of 15 held the
 *     ciphertext of about 350;
 *   - rolling back within the day and after it, in the note and in step 4
 *     for 16;
 *   - the note on webhook addresses no longer says the release before fails
 *     its sends, and the opening of 15 → 16 says what the upgrade keeps.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**Webhook addresses and SNMP credentials are encrypted a day after the upgrade, so a server of the earlier release keeps using them while it rolls out.**";
// The note before it: the webhook addresses and SNMP credentials (#9013, #9014).
const PREVIOUS_LEAD: string =
  "**Webhook addresses and SNMP credentials are stored encrypted, and logs keep a webhook's address by its host.**";
// Step 7 of "What you need to do for 15".
const STEP_LEAD: string = "**Replace every server of 14 soon.**";

// The major version whose "Other changes in" list carries the note.
const MAJOR: number = 16;

const TWILIO_COLUMN_MIGRATION: string =
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182960000-TwilioAuthTokenTextColumn.ts";

/*
 * The data migrations the job waits on, by where the page names what each
 * encrypts. 16 brought the webhook addresses and SNMP credentials: the note
 * names them, and says the upgrade leaves them as written.
 */
const KEPT_BY_THE_UPGRADE_TO_16: Record<string, string> = {
  EncryptWebhookAddresses: "Webhook addresses",
  EncryptSnmpCredentials: "SNMP credentials",
};

/*
 * The upgrade to 15 encrypts the rest in place, as it runs: step 7 for 15
 * names them, and the note says what a server of 14 saved meanwhile is
 * encrypted with the rest.
 */
const ENCRYPTED_IN_PLACE_BY_15: Record<string, string> = {
  EncryptProjectCredentials:
    "the credentials a project saved for mail, chat apps and webhooks",
  EncryptUploadedCertificateKeys: "custom domains' certificate keys",
  EncryptLetsEncryptKeys: "custom domains' certificate keys",
  EncryptGlobalConfigCredentials:
    "from a 14 release before 14.1, the server's own mail, SMS and call credentials too",
  EncryptProjectCallSMSConfigTwilioAuthToken:
    "and from one before 14.0.56 a project's Twilio auth token",
};

// The webhook log mask, run again with them.
const MASKED_AGAIN: Record<string, string> = {
  MaskWebhookAddressesInLogs:
    "and keep only the host of a webhook address it logged",
};

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/*
 * The numbers some text states, in Latin digits, a version's dotted parts
 * left out but a number at the end of a sentence kept.
 */
function numbersOf(text: string): Array<number> {
  const latin: string = text
    // Code is not prose: snmpV3Auth states no 3.
    .replace(/`[^`\n]*`/g, " ")
    .replace(/[۰-۹]/g, (digit: string): string => {
      return String(digit.charCodeAt(0) - "۰".charCodeAt(0));
    });

  return Array.from(
    latin.matchAll(/(?<!\d|\d\.)\d+(?!\d|\.\d)/g),
    (match: RegExpMatchArray): number => {
      return Number(match[0]);
    },
  );
}

function sorted(numbers: Array<number>): Array<number> {
  return [...numbers].sort((left: number, right: number): number => {
    return left - right;
  });
}

// The numbered steps of "What you need to do for <major>", each on one line.
function stepsFor(language: string, major: number): Array<string> {
  return sectionAtEnglishPlace(language, `What you need to do for ${major}`)
    .split(/\n(?=\d+\. )/)
    .slice(1)
    .map((step: string): string => {
      return flattened(step);
    });
}

/*
 * What the row of "Find the notes for your version" that links 14 → 15 says
 * to do: its second cell, without the link.
 */
function rowFor15(language: string): string {
  const rows: Array<string> = upgradingPage(language)
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| [") && line.includes("oneuptime-14-15");
    });

  expect(rows).toHaveLength(1);

  const cells: Array<string> = rows[0]!
    .split("|")
    .map((cell: string): string => {
      return cell.trim();
    })
    .filter((cell: string): boolean => {
      return cell.length > 0;
    });

  expect(cells).toHaveLength(2);

  return cells[1]!;
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en", MAJOR);
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");
const ENGLISH_STEPS_FOR_15: Array<string> = stepsFor("en", 15);
const STEP_INDEX: number = ENGLISH_STEPS_FOR_15.findIndex(
  (step: string): boolean => {
    return step.startsWith(`7. ${STEP_LEAD}`);
  },
);
const ENGLISH_STEP: string = ENGLISH_STEPS_FOR_15[STEP_INDEX] || "";

describe("the English upgrade notes on the credentials encrypted a day after the upgrade", () => {
  it("is a note of the 15 → 16 changes, once, right after the note on webhook addresses and SNMP credentials", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
  });

  it("names what every data migration the job waits on encrypts: 16's in the note, 15's in the step for 15", () => {
    const migrations: Array<string> = CredentialsAtRest.getGroups().map(
      (group: CredentialsAtRestGroup): string => {
        return group.migrationName;
      },
    );

    // A migration the job waits on and not named here fails: say it on the page.
    expect([...migrations].sort()).toEqual(
      [
        ...Object.keys(KEPT_BY_THE_UPGRADE_TO_16),
        ...Object.keys(ENCRYPTED_IN_PLACE_BY_15),
        ...Object.keys(MASKED_AGAIN),
      ].sort(),
    );

    for (const [migration, phrase] of Object.entries(
      KEPT_BY_THE_UPGRADE_TO_16,
    )) {
      expect({ migration, named: NOTE_LEAD.includes(phrase) }).toEqual({
        migration,
        named: true,
      });
    }

    for (const [migration, phrase] of Object.entries(
      ENCRYPTED_IN_PLACE_BY_15,
    )) {
      expect({ migration, named: ENGLISH_STEP.includes(phrase) }).toEqual({
        migration,
        named: true,
      });
    }

    for (const [migration, phrase] of Object.entries(MASKED_AGAIN)) {
      expect({ migration, named: ENGLISH_NOTE.includes(phrase) }).toEqual({
        migration,
        named: true,
      });
    }

    expect(ENGLISH_NOTE).toContain(
      "Workers also encrypt the credentials and certificate keys that a server of 14 saved as written while the upgrade to 15 rolled out.",
    );
  });

  it("says the upgrade leaves them as written, and Workers encrypt them a day later, those saved meanwhile too", () => {
    const workers: string = source("packages/App/FeatureSet/Workers/Index.ts");
    const job: string = source(
      "packages/App/FeatureSet/Workers/Jobs/CredentialsAtRest/EncryptInPlace.ts",
    );

    expect(workers).toContain(
      `import "./Jobs/CredentialsAtRest/EncryptInPlace";`,
    );
    expect(job).toContain("CREDENTIALS_AT_REST_JOB_NAME");
    expect(SETTLE_PERIOD_MS).toBe(24 * 60 * 60 * 1000);
    expect(ENGLISH_NOTE).toContain(
      "The upgrade leaves the ones you have as they were written: a server of the earlier release still running while it rolls out (on Kubernetes the old pods serve while the migrations run) keeps sending notifications and webhooks with them and polling devices.",
    );
    expect(ENGLISH_NOTE).toContain(
      "A day later, Workers encrypt each one in place, those that server saved meanwhile included,",
    );
    expect(ENGLISH_NOTE).toContain(
      "An address or credential saved during that day is stored encrypted at once, and a server of the earlier release cannot use it until it is replaced.",
    );
  });

  it("says a device's legacy v3 object is moved and walked, and a Twilio token may be 500 characters long again", async () => {
    const dataMigrations: string = source(
      "packages/App/FeatureSet/Workers/DataMigrations/Index.ts",
    );

    expect(dataMigrations).toContain("new MoveLegacySnmpV3AuthToColumns(),");
    expect(ENGLISH_NOTE).toContain(
      "A network device whose SNMP v3 credentials were only in its legacy `snmpV3Auth` object is walked again, not only pinged: the upgrade moves them into the device's v3 fields, where its settings show them.",
    );

    expect(
      getMaxLengthFromTableColumnType(
        new ProjectCallSMSConfig().getTableColumnMetadata("twilioAuthToken")
          .type,
      ),
    ).toBe(500);
    // 15's column, which the migration goes back to: a varchar(500).
    expect(source(TWILIO_COLUMN_MIGRATION)).toContain(
      `ALTER COLUMN "twilioAuthToken" TYPE character varying(500)`,
    );
    // Whose ciphertext of a token of more than 351 characters overflows it.
    expect((await Encryption.encrypt("x".repeat(351))).length).toBeLessThan(
      500,
    );
    expect((await Encryption.encrypt("x".repeat(352))).length).toBeGreaterThan(
      500,
    );
    expect(ENGLISH_NOTE).toContain(
      "A project's Twilio auth token can be up to 500 characters long again: one longer than about 350 was refused.",
    );
  });

  it("says what rolling back means, within the day and after it, in the note and in the step for 16", () => {
    expect(ENGLISH_NOTE).toContain(
      "Rolled back within that day, the earlier release reads every address and credential stored before the upgrade.",
    );
    expect(ENGLISH_NOTE).toContain(
      "Rolled back after it, it cannot read the webhook addresses and SNMP credentials: restore the backup you took before the upgrade, or enter each one again.",
    );

    const step: string | undefined = stepsFor("en", 16).find(
      (candidate: string): boolean => {
        return candidate.startsWith(
          "4. **Replace every server of 15 soon, and roll back only within a day.**",
        );
      },
    );

    expect(step).toContain(
      "reads a webhook address or SNMP credential saved on 16 as a broken one",
    );
    expect(step).toContain(
      "A day after the upgrade, Workers encrypt or hash the keys, addresses and credentials stored before:",
    );
    expect(step).toContain(
      "and enter the webhook addresses and SNMP credentials again, or restore the backup you took before the upgrade.",
    );
  });

  it("says, for 15, that its upgrade encrypts in place and fails a server of 14 meanwhile, and what rolling back to 14 means", () => {
    expect(STEP_INDEX).toBe(ENGLISH_STEPS_FOR_15.length - 1);
    expect(ENGLISH_STEP).toContain(
      "A server of 14 still running meanwhile reads them as broken values, so the email, SMS, calls, chat messages and webhooks it sends fail, and a custom domain it serves can lose its HTTPS, until it is replaced:",
    );
    expect(ENGLISH_STEP).toContain("with `migrate.hook: true`");
    expect(ENGLISH_STEP).toContain(
      "Rolled back to 14, the server cannot read them: restore the backup you took before the upgrade, or enter them again.",
    );

    /*
     * With migrate.hook: true the chart's migrate Job is a pre-upgrade hook:
     * every migration runs before any pod is replaced.
     */
    const migrateJob: string = source(
      "HelmChart/Public/oneuptime/templates/migrate-job.yaml",
    );

    expect(migrateJob).toContain("{{- $useHook := .Values.migrate.hook }}");
    expect(migrateJob).toContain(
      `"helm.sh/hook": {{ ternary "post-install" "pre-upgrade" .Release.IsInstall }}`,
    );

    expect(rowFor15("en").endsWith(" Replace every server of 14 soon.")).toBe(
      true,
    );
  });

  it("leaves the note before it saying the release before reads every address and credential, and the opening of 15 → 16 saying what the upgrade keeps", () => {
    const previous: string = flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!);

    expect(previous).not.toContain("its sends and polls fail");
    expect(previous).toContain(
      "The ones you have are encrypted a day after the upgrade, as the next note says,",
    );
    expect(
      flattened(
        sectionAtEnglishPlace("en", "Upgrading from OneUptime 15 → 16"),
      ),
    ).toContain(
      "The upgrade keeps the keys, addresses and credentials you have as they are, so a server of 15 still running while it rolls out keeps using them, and a day later Workers encrypt or hash them in place.",
    );
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade notes on the credentials encrypted a day after the upgrade",
  (language: string) => {
    const items: Array<string> = otherChangesItems(language, MAJOR);
    const note: string = flattened(items[NOTE_INDEX] || "");
    const previous: string = flattened(items[NOTE_INDEX - 1] || "");
    const steps: Array<string> = stepsFor(language, 15);
    const step: string = steps[STEP_INDEX] || "";

    it("is in the English note's place, under a lead of its own", () => {
      expect(items.length).toBe(ENGLISH_ITEMS.length);
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
    });

    it("carries the English note's code and numbers", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));

      // v3 twice, 14, 15, the token's 500 characters and the about 350 refused.
      expect(sorted(numbersOf(ENGLISH_NOTE))).toEqual([3, 3, 14, 15, 350, 500]);

      for (const number of numbersOf(ENGLISH_NOTE)) {
        expect({ number, stated: numbersOf(note).includes(number) }).toEqual({
          number,
          stated: true,
        });
      }
    });

    it("keeps the note before it to the English one's code", () => {
      expect(inlineCode(previous)).toEqual(
        inlineCode(flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!)),
      );
    });

    it("carries step 7 for 15, with the English step's code and numbers, and says it in the table's row", () => {
      expect(steps).toHaveLength(ENGLISH_STEPS_FOR_15.length);
      expect(step.startsWith("7. **")).toBe(true);
      expect(step).not.toContain(STEP_LEAD);
      expect(inlineCode(step)).toEqual(inlineCode(ENGLISH_STEP));

      for (const number of numbersOf(ENGLISH_STEP)) {
        expect({ number, stated: numbersOf(step).includes(number) }).toEqual({
          number,
          stated: true,
        });
      }

      // The row's other sentences name 15 alone: the step's adds 14.
      expect(numbersOf(rowFor15(language))).toContain(14);
    });
  },
);
