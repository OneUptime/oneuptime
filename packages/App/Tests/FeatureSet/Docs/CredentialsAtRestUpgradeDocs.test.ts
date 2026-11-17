import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import CredentialsAtRest, {
  CredentialsAtRestGroup,
} from "../../../FeatureSet/Workers/Utils/CredentialsAtRest";
import { inlineCode } from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItems,
  sectionAtEnglishPlace,
} from "./UpgradingDocsNotes";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import { getMaxLengthFromTableColumnType } from "Common/Types/Database/ColumnLength";
import { SETTLE_PERIOD_MS } from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says the credentials a 14 install has are encrypted
 * a day after the upgrade, not at it (#9266), that a device's legacy SNMP v3
 * object is moved and walked (#9268), and that a Twilio token keeps its 500
 * characters (#9267) - held to the code that makes it true, and to what
 * rolling back means.
 *
 * The note (installation/upgrading, "Other changes in 15") is the last of
 * the 14 → 15 notes, right after the one on webhook addresses and SNMP
 * credentials, and every translation carries it in the English note's
 * place, with the English note's code and numbers. What it claims is what
 * the code does:
 *
 *   - it names the credentials of every data migration the
 *     CredentialsAtRest:EncryptInPlace job waits on, and the releases
 *     before which the server's own and the Twilio tokens were left;
 *   - the upgrade leaves them as written, and Workers encrypt them a day
 *     later (SETTLE_PERIOD_MS), those a server of the release before saved
 *     meanwhile too, and keep only the host of an address it logged;
 *   - a device's legacy snmpV3Auth moves into its columns at the upgrade
 *     (MoveLegacySnmpV3AuthToColumns), and a Twilio token may still be 500
 *     characters long;
 *   - rolling back within the day and after it;
 *   - the note on webhook addresses no longer says the release before fails
 *     its sends, and the page's opening says the credentials are encrypted
 *     a day later.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**The credentials you have are encrypted a day after the upgrade, so a server of the earlier release keeps sending with them while it rolls out.**";
// The note before it: the webhook addresses and SNMP credentials (#9013, #9014).
const PREVIOUS_LEAD: string =
  "**Webhook addresses and SNMP credentials are stored encrypted, and logs keep a webhook's address by its host.**";

// The major version whose "Other changes in" list carries the note.
const MAJOR: number = 15;

// How the note names the credentials of each data migration the job waits on.
const NAMED_AS: Record<string, Array<string>> = {
  EncryptProjectCallSMSConfigTwilioAuthToken: [
    "and before 14.0.56 a project's Twilio auth token",
  ],
  EncryptGlobalConfigCredentials: [
    "on an install still on a 14 release before 14.1, are the server's own mail, SMS, call, WhatsApp, Telegram and license credentials",
  ],
  EncryptUploadedCertificateKeys: [
    "the private keys of custom domains' certificates",
  ],
  EncryptLetsEncryptKeys: ["the private keys of custom domains' certificates"],
  EncryptProjectCredentials: [
    "A project's SMTP passwords and OAuth client secrets",
    "its Slack, Microsoft Teams and Mattermost tokens and its members' chat sign-in tokens",
    "its code repositories' webhook secrets and its webhooks' signing secrets",
  ],
  EncryptWebhookAddresses: ["the webhook addresses and SNMP credentials above"],
  EncryptSnmpCredentials: ["the webhook addresses and SNMP credentials above"],
  MaskWebhookAddressesInLogs: [
    "and keep only the host of a webhook address it logged",
  ],
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
 * left out but a number at the end of a sentence kept - as the translation
 * suite reads them.
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

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en", MAJOR);
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on the credentials encrypted a day after the upgrade", () => {
  it("is the last note of the 14 → 15 changes, once, right after the note on webhook addresses and SNMP credentials", () => {
    expect(NOTE_INDEX).toBe(ENGLISH_ITEMS.length - 1);
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

  it("names the credentials of every data migration the job waits on", () => {
    const migrations: Array<string> = CredentialsAtRest.getGroups().map(
      (group: CredentialsAtRestGroup): string => {
        return group.migrationName;
      },
    );

    // A migration the job waits on and not named here fails: say it in the note.
    expect([...migrations].sort()).toEqual(Object.keys(NAMED_AS).sort());

    for (const migration of migrations) {
      for (const phrase of NAMED_AS[migration]!) {
        expect({ migration, phrase, named: ENGLISH_NOTE.includes(phrase) }).toEqual({
          migration,
          phrase,
          named: true,
        });
      }
    }
  });

  it("says the upgrade leaves them as written, and Workers encrypt them a day later, those saved meanwhile too", () => {
    const workers: string = source("packages/App/FeatureSet/Workers/Index.ts");
    const job: string = source(
      "packages/App/FeatureSet/Workers/Jobs/CredentialsAtRest/EncryptInPlace.ts",
    );

    expect(workers).toContain(`import "./Jobs/CredentialsAtRest/EncryptInPlace";`);
    expect(job).toContain("CREDENTIALS_AT_REST_JOB_NAME");
    expect(SETTLE_PERIOD_MS).toBe(24 * 60 * 60 * 1000);
    expect(ENGLISH_NOTE).toContain(
      "The upgrade leaves the ones you have as they were written: a server of the earlier release still running while it rolls out (on Kubernetes the old pods serve while the migrations run) keeps sending email, SMS, calls, chat messages and webhooks with them, polling devices and serving custom domains.",
    );
    expect(ENGLISH_NOTE).toContain(
      "A day later, Workers encrypt each one in place, those that server saved meanwhile included,",
    );
    expect(ENGLISH_NOTE).toContain(
      "A credential saved during that day is stored encrypted at once, and a server of the earlier release cannot use it until it is replaced.",
    );
  });

  it("says a device's legacy v3 object is moved and walked, and a Twilio token keeps its 500 characters", () => {
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
    expect(ENGLISH_NOTE).toContain(
      "A project's Twilio auth token can still be up to 500 characters long.",
    );
  });

  it("says what rolling back means, within the day and after it", () => {
    expect(ENGLISH_NOTE).toContain(
      "Rolled back within that day, the earlier release reads every credential stored before the upgrade.",
    );
    expect(ENGLISH_NOTE).toContain(
      "Rolled back after it, the earlier release cannot read the credentials it did not encrypt itself: restore the backup you took before the upgrade, or enter each one again,",
    );
  });

  it("leaves the note before it saying the release before reads every address and credential, and the page's opening saying when they are encrypted", () => {
    const previous: string = flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!);

    expect(previous).not.toContain("its sends and polls fail");
    expect(previous).toContain(
      "The ones you have are encrypted a day after the upgrade, as the next note says,",
    );
    expect(flattened(sectionAtEnglishPlace("en", "Upgrading from OneUptime 14 → 15"))).toContain(
      "The upgrade hashes the keys you have, and encrypts the credentials you have a day later, once no server of 14 can still be running,",
    );
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on the credentials encrypted a day after the upgrade",
  (language: string) => {
    const items: Array<string> = otherChangesItems(language, MAJOR);
    const note: string = flattened(items[NOTE_INDEX] || "");
    const previous: string = flattened(items[NOTE_INDEX - 1] || "");

    it("is in the English note's place, the last, under a lead of its own", () => {
      expect(items.length).toBe(ENGLISH_ITEMS.length);
      expect(NOTE_INDEX).toBe(items.length - 1);
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
    });

    it("carries the English note's code and numbers", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));

      const numbers: Array<number> = numbersOf(note);

      // v3 twice, the 14 releases, 15, and the token's 500 characters.
      expect(
        numbersOf(ENGLISH_NOTE).sort((left: number, right: number): number => {
          return left - right;
        }),
      ).toEqual([3, 3, 14, 15, 500]);

      for (const number of numbersOf(ENGLISH_NOTE)) {
        expect({ number, stated: numbers.includes(number) }).toEqual({
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
  },
);
