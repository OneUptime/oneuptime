import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import Path from "path";

/*
 * An email's subject names the product the way the installation goes by.
 *
 * Most subjects are literal (isSubjectLiteral: MailService sends them as
 * they are, never compiled, because many carry text people wrote), so
 * MailService cannot put the installation's name in them: the sender does,
 * with ProductBrandingText.getProductName() - "OneUptime" on an installation
 * that is not renamed, so those subjects read exactly as they did.
 *
 * Pinned over the server's source: no subject written as a string names
 * OneUptime, except the billing emails, which are about a OneUptime
 * subscription and come from OneUptime. The sender's name falls back to the
 * product's name too.
 */

const PACKAGES_DIR: string = Path.resolve(__dirname, "..", "..", "..");

const SOURCE_DIRS: ReadonlyArray<string> = [
  Path.join(PACKAGES_DIR, "Common", "Server"),
  Path.join(PACKAGES_DIR, "App", "FeatureSet"),
];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Docs",
  "Home",
]);

// About a OneUptime subscription: from OneUptime, whatever the installation is called.
const BILLING_SUBJECTS: ReadonlyArray<string> = [
  "Common/Server/Services/BillingService.ts",
  "App/FeatureSet/Workers/Jobs/PaymentProvider/SendDailyEmailsToOwnersIfSubscriptionIsOverdue.ts",
];

const SUBJECT_LITERAL: RegExp = /\bsubject:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

const ONEUPTIME_WORD: RegExp = /\bOneUptime\b/;

const WHITESPACE_RUN: RegExp = /\s+/g;

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = Path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }

      continue;
    }

    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files;
};

const toPackagePath: (file: string) => string = (file: string): string => {
  return Path.relative(PACKAGES_DIR, file).split(Path.sep).join("/");
};

describe("email subjects", () => {
  const files: Array<string> = SOURCE_DIRS.flatMap((directory: string) => {
    return listSourceFiles(directory);
  });

  test("the scan reads the server's source", () => {
    const scanned: Set<string> = new Set<string>(files.map(toPackagePath));

    expect(scanned.has("Common/Server/Services/UserService.ts")).toBe(true);
    expect(scanned.has("App/FeatureSet/Identity/API/Authentication.ts")).toBe(
      true,
    );
    expect(files.length).toBeGreaterThan(500);
  });

  test("no subject written as a string names OneUptime, outside billing", () => {
    const offenders: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");

      if (!source.includes("subject:")) {
        continue;
      }

      for (const match of source.matchAll(SUBJECT_LITERAL)) {
        const text: string = match[2] || "";

        if (
          ONEUPTIME_WORD.test(text) &&
          !BILLING_SUBJECTS.includes(toPackagePath(file))
        ) {
          offenders.push(`${toPackagePath(file)}: ${text}`);
        }
      }
    }

    /*
     * Put the installation's name in it instead:
     *   subject: `Welcome to ${ProductBrandingText.getProductName()}`
     */
    expect(offenders).toEqual([]);
  });

  test.each([
    [
      "App/FeatureSet/Identity/API/Authentication.ts",
      "subject: `Welcome to ${ProductBrandingText.getProductName()}. Please verify your email.`",
    ],
    [
      "App/FeatureSet/Identity/API/Authentication.ts",
      "subject: `Password Reset Request for ${ProductBrandingText.getProductName()}`",
    ],
    [
      "Common/Server/Services/UserService.ts",
      "subject: `Password Reset Request for ${ProductBrandingText.getProductName()}`",
    ],
    [
      "App/FeatureSet/Identity/Utils/AuthenticationEmail.ts",
      "subject: `Finish setting up your ${ProductBrandingText.getProductName()} account`",
    ],
    [
      "App/FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation.ts",
      "subject: `Confirm single sign-on for your ${ProductBrandingText.getProductName()} account`",
    ],
    [
      "App/FeatureSet/Notification/API/SMTPConfig.ts",
      "subject: `Test Email from ${ProductBrandingText.getProductName()}`",
    ],
  ])("%s names the installation: %s", (file: string, subject: string) => {
    expect(fs.readFileSync(Path.join(PACKAGES_DIR, file), "utf8")).toContain(
      subject,
    );
  });

  test("the sender's name falls back to the product's, not to OneUptime", () => {
    const config: string = fs.readFileSync(
      Path.join(PACKAGES_DIR, "App", "FeatureSet", "Notification", "Config.ts"),
      "utf8",
    );
    const mailService: string = fs.readFileSync(
      Path.join(
        PACKAGES_DIR,
        "App",
        "FeatureSet",
        "Notification",
        "Services",
        "MailService.ts",
      ),
      "utf8",
    );

    // However the formatter wraps the line.
    expect(config.replace(WHITESPACE_RUN, " ")).toContain(
      "fromName: globalConfig.smtpFromName || ProductBrandingText.getProductName()",
    );
    expect(config).not.toContain('|| "OneUptime"');
    expect(mailService.replace(WHITESPACE_RUN, " ")).toContain(
      "sendgridConfig.fromName || ProductBrandingText.getProductName()",
    );
    expect(mailService).not.toContain('fromName || "OneUptime"');
  });
});
