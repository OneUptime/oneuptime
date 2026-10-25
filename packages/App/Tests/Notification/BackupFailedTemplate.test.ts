import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import { registerEmailDetailCardHelpers } from "../../FeatureSet/Notification/Utils/EmailDetailCard";
import {
  registerEmailBrandHelpers,
  registerJoiningConcat,
} from "./Fixtures/EmailBrandHelpers";

/*
 * BackupFailed.hbs - what every master admin gets when a backup or a
 * restore of the installation fails (ee/Server/Backup/BackupNotifications
 * fills it through the instance health sender). One template serves both,
 * so its own sentences must be true of a failed restore as well as of a
 * failed backup: the intro says what backups are for, never that "a backup"
 * did not finish; the subject, the badge and the details say which it was.
 *
 * The error comes in the storage's or the database's own words, and is
 * escaped like every other value.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const handlebars: typeof Handlebars = Handlebars.create();

const ERROR: string =
  "The S3-compatible storage did not let this key write the backup (HTTP 403, AccessDenied). <b>Allow</b> it to write.";

function render(kind: "backup" | "restore"): string {
  const isRestore: boolean = kind === "restore";

  return handlebars.compile(
    fs.readFileSync(Path.resolve(TEMPLATES_DIR, "BackupFailed.hbs"), "utf8"),
  )({
    subject: isRestore
      ? "A restore of your OneUptime instance failed"
      : "A backup of your OneUptime instance failed",
    badgeType: "critical",
    badgeText: isRestore ? "Restore failed" : "Backup failed",
    oneuptimeHost: "oneuptime.acme.test",
    homeURL: "https://oneuptime.acme.test",
    healthPageLink: "https://oneuptime.acme.test/admin/settings/backups",
    healthPageButtonText: "Open Backups",
    remediation:
      "Open Backups in the Admin Dashboard to see the step it stopped on.",
    detail1Title: "What: ",
    detail1Text: isRestore
      ? "A restore started from the Admin Dashboard"
      : "The scheduled backup",
    detail2Title: "Why: ",
    detail2Text: ERROR,
    year: "2026",
  });
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const name: string | undefined = filename.endsWith(".hbs")
      ? filename.slice(0, -".hbs".length)
      : undefined;

    if (name) {
      handlebars.registerPartial(
        name,
        fs.readFileSync(Path.resolve(partialsDir, filename), "utf8"),
      );
    }
  }

  handlebars.registerHelper(
    "ifCond",
    function (this: unknown, v1: unknown, v2: unknown, options: any) {
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );
  registerJoiningConcat(handlebars);
  registerEmailBrandHelpers(handlebars);
  registerEmailDetailCardHelpers(handlebars);
});

describe("BackupFailed.hbs", () => {
  test("says what backups are for, in words true of a failed restore too", () => {
    for (const kind of ["backup", "restore"] as const) {
      const text: string = visibleText(render(kind));

      expect(text).toContain(
        "Backups keep a copy of this OneUptime instance's data in storage you chose, ready to restore.",
      );
      // The sentence it replaced said a backup did not finish, of a restore too.
      expect(text).not.toContain("one did not finish");
    }
  });

  test("the subject, the badge and the details say which one failed", () => {
    const restore: string = visibleText(render("restore"));
    const backup: string = visibleText(render("backup"));

    expect(restore).toContain("A restore of your OneUptime instance failed");
    expect(restore).toContain("Restore failed");
    expect(restore).toContain("A restore started from the Admin Dashboard");
    expect(backup).toContain("A backup of your OneUptime instance failed");
    expect(backup).toContain("The scheduled backup");
  });

  test("says why it was sent as the other instance emails do", () => {
    expect(visibleText(render("backup"))).toContain(
      "You are receiving this email because you are a master admin on this OneUptime instance and backups are set up on it.",
    );
  });

  test("shows the storage's error as written, escaped", () => {
    const html: string = render("backup");

    expect(visibleText(html)).toContain(
      "AccessDenied). <b>Allow</b> it to write.",
    );
    expect(html).not.toContain("<b>Allow</b>");
  });
});
