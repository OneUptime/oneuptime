import {
  readPage,
  scanMarkdown,
  TRANSLATED_LANGUAGES,
  DocsLink,
} from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import TwoFactorWrongCodes, {
  FIRST_WAIT_SECONDS,
  LONGEST_WAIT_SECONDS,
  OWNER_TOLD_AT_MOST_ONCE_IN_SECONDS,
  WRONG_CODES_BEFORE_WAITING,
  WRONG_CODES_FORGOTTEN_AFTER_SECONDS,
} from "Common/Server/Utils/TwoFactorWrongCodes";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about wrong two-factor codes, held to the code that
 * counts them (Common/Server/Utils/TwoFactorWrongCodes), the sign-in handler
 * that calls it and UserService, which forgets them on a new password and on
 * a master admin's reset:
 *
 *   - Your Account's troubleshooting entry: five wrong codes in a row, then a
 *     minute, doubling, up to an hour; counted wherever they are entered; an
 *     email when the waits begin; a right code starts the count again; a
 *     security key and a backup code still sign in; a password reset ends the
 *     wait - naming the sign-in page's links as the sign-in page draws them;
 *   - the upgrade note (installation/upgrading, "Other changes in 14"),
 *     after the note on the bundled Runner and before the note on redirects
 *     (KeyCarryingRedirectsUpgradeDocs), saying the same and linking to Your
 *     Account;
 *   - every translation carries both in the English places, each in its own
 *     words, with that language's sign-in labels.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const ACCOUNTS_LOCALES_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Accounts/src/Locales",
);

const YOUR_ACCOUNT: string = "introduction/your-account";
const YOUR_ACCOUNT_PATH: string = "/docs/introduction/your-account";

const ENTRY_TITLE: string =
  "Signing in asks me to wait before I try another code";
const ENTRY_BEFORE: string = "I lost my authenticator app";
const ENTRY_AFTER: string = "Times in the dashboard are an hour off";

const NOTE_LEAD: string =
  "**Wrong two-factor codes are counted for the account, wherever they come from.**";
// The note before it (SharedRunnerUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**The bundled Runner no longer runs a repository's commands, and holds only what it needs.**";
// The note after it (KeyCarryingRedirectsUpgradeDocs).
const NEXT_LEAD: string =
  "**Probes, Runners and OneUptime's own services follow redirects only on the server they call.**";

const DETAILS_OPEN: string = ":::details ";
const CONTAINER_CLOSE: string = ":::";

// The sign-in page's links, as the Accounts app's locale keys them.
const LOST_ACCESS_KEYS: Array<string> = ["login", "twoFactor", "lostAccess"];
const FORGOT_PASSWORD_KEYS: Array<string> = ["login", "forgotPassword"];

interface DetailsEntry {
  title: string;
  body: string;
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The :::details entries of a page, in order: each title and its text.
function detailsEntries(markdown: string): Array<DetailsEntry> {
  const entries: Array<DetailsEntry> = [];
  let open: DetailsEntry | null = null;

  for (const line of markdown.split("\n")) {
    if (line.startsWith(DETAILS_OPEN)) {
      open = { title: line.slice(DETAILS_OPEN.length).trim(), body: "" };
      continue;
    }

    if (open && line.trim() === CONTAINER_CLOSE) {
      entries.push({ title: open.title, body: open.body.trim() });
      open = null;
      continue;
    }

    if (open) {
      open.body += `${line}\n`;
    }
  }

  return entries;
}

function accountsLabel(language: string, keys: Array<string>): string {
  let value: unknown = JSON.parse(
    fs.readFileSync(
      path.join(ACCOUNTS_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  ) as unknown;

  for (const key of keys) {
    value = (value as Record<string, unknown>)[key];
  }

  return value as string;
}

function linkTargets(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return link.target;
  });
}

const ENGLISH_ENTRIES: Array<DetailsEntry> = detailsEntries(
  readPage("en", YOUR_ACCOUNT),
);
const ENTRY_INDEX: number = ENGLISH_ENTRIES.findIndex(
  (entry: DetailsEntry): boolean => {
    return entry.title === ENTRY_TITLE;
  },
);
const ENGLISH_ENTRY: string = flattened(
  ENGLISH_ENTRIES[ENTRY_INDEX]?.body || "",
);

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the code the docs describe", () => {
  it("counts five wrong codes before the first wait, of a minute, doubling, up to an hour", () => {
    expect(WRONG_CODES_BEFORE_WAITING).toBe(5);
    expect(FIRST_WAIT_SECONDS).toBe(60);
    expect(
      [5, 6, 7].map((wrong: number): number => {
        return TwoFactorWrongCodes.getWaitSecondsAfter(wrong);
      }),
    ).toEqual([60, 120, 240]);
    expect(LONGEST_WAIT_SECONDS).toBe(60 * 60);
    expect(TwoFactorWrongCodes.getWaitSecondsAfter(1000)).toBe(60 * 60);
  });

  it("emails the owner at most once a day, and forgets wrong codes a day after the last one", () => {
    expect(OWNER_TOLD_AT_MOST_ONCE_IN_SECONDS).toBe(24 * 60 * 60);
    expect(WRONG_CODES_FORGOTTEN_AFTER_SECONDS).toBe(24 * 60 * 60);
  });

  it("forgets the wrong codes on a second step that passed, a new password and a master admin's reset", () => {
    expect(source("App/FeatureSet/Identity/API/Authentication.ts")).toContain(
      "await TwoFactorWrongCodes.forget(alreadySavedUser.id!);",
    );

    const userService: string = source("Common/Server/Services/UserService.ts");
    const passwordChange: string = userService.slice(
      userService.indexOf("if (onUpdate && onUpdate.updateBy.data.password) {"),
    );
    const reset: string = userService.slice(
      userService.indexOf("public async resetTwoFactorAuth("),
    );

    expect(
      passwordChange.slice(0, passwordChange.indexOf("MailService.sendMail(")),
    ).toContain("await TwoFactorWrongCodes.forget(user.id!);");
    expect(
      reset.slice(0, reset.indexOf("public async setPassword(")),
    ).toContain("await TwoFactorWrongCodes.forget(user.id!);");
  });
});

describe("Your Account's troubleshooting entry", () => {
  it("follows the lost authenticator app, and comes before the time zone", () => {
    expect(ENTRY_INDEX).toBeGreaterThan(0);
    expect(ENGLISH_ENTRIES[ENTRY_INDEX - 1]!.title).toBe(ENTRY_BEFORE);
    expect(ENGLISH_ENTRIES[ENTRY_INDEX + 1]!.title).toBe(ENTRY_AFTER);
  });

  it("says when the waits begin, how long they are, and that they hold wherever the codes come from", () => {
    expect(ENGLISH_ENTRY).toContain(
      "After five wrong codes in a row, each next code waits before it is checked: one minute, then two, then four, and so on, up to an hour.",
    );
    expect(ENGLISH_ENTRY).toContain(
      "OneUptime counts wrong codes for your account wherever they are entered, emails you when the waits begin, and starts counting again when you get a code right.",
    );
  });

  it("names the ways in that are not held: a security key and a backup code, by the sign-in page's own link", () => {
    expect(ENGLISH_ENTRY).toContain(
      "Wait and try again, sign in with a security key, or choose **Lost access to your authenticator?** and enter a backup code.",
    );
    expect(accountsLabel("en", LOST_ACCESS_KEYS)).toBe(
      "Lost access to your authenticator?",
    );
  });

  it("says what to do when the codes were not theirs, by the sign-in page's own link", () => {
    expect(ENGLISH_ENTRY).toContain(
      "If you did not enter those codes, someone knows your password: reset it with **Forgot password?** on the sign-in page, which also ends the wait.",
    );
    expect(accountsLabel("en", FORGOT_PASSWORD_KEYS)).toBe("Forgot password?");
  });
});

describe("the English upgrade note on wrong two-factor codes", () => {
  it("is a note of the 13 → 14 changes, once, after the note on the bundled Runner and before the note on redirects", () => {
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
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says the code's rule: counted once the password is right, from any address or network, five free, then a minute doubling up to an hour", () => {
    expect(ENGLISH_NOTE).toContain(
      "Once a sign-in's password is right, every wrong authenticator code is counted for that account, from whatever address or network it is entered: after five in a row, each next code waits before it is checked, one minute at first and twice as long after each wrong code, up to an hour.",
    );
  });

  it("says what is never held, and who is told how often", () => {
    expect(ENGLISH_NOTE).toContain(
      "Backup codes have a count of their own, so wrong authenticator codes never hold them, and a security key is never held.",
    );
    expect(ENGLISH_NOTE).toContain(
      "The account's owner is emailed when the waits begin, at most once a day.",
    );
  });

  it("says what ends the wait, and that nobody who gets their code right sees a change", () => {
    expect(ENGLISH_NOTE).toContain(
      "A sign-in that gets its code right, a new password, or a master admin's reset of two-factor authentication ends the wait, and wrong codes are forgotten a day after the last one.",
    );
    expect(ENGLISH_NOTE).toContain(
      "Someone who gets their code right within five tries sees no change.",
    );
  });

  it("links to Your Account, and carries no code", () => {
    expect(linkTargets(ENGLISH_NOTE)).toEqual([YOUR_ACCOUNT_PATH]);
    expect(inlineCode(ENGLISH_NOTE)).toEqual([]);
  });
});

describe.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
  const entries: Array<DetailsEntry> = detailsEntries(
    readPage(language, YOUR_ACCOUNT),
  );
  const note: string = flattened(otherChangesItems(language)[NOTE_INDEX] || "");

  it("Your Account has the troubleshooting entry in the English entry's place, in its own words", () => {
    expect(entries).toHaveLength(ENGLISH_ENTRIES.length);

    const entry: DetailsEntry = entries[ENTRY_INDEX]!;

    expect(entry.title.length).toBeGreaterThan(0);
    expect(entry.title).not.toBe(ENTRY_TITLE);
    expect(entry.body).not.toContain("After five wrong codes in a row");
  });

  it("names the sign-in page's links as this language's sign-in page draws them", () => {
    const entry: DetailsEntry = entries[ENTRY_INDEX]!;

    for (const keys of [LOST_ACCESS_KEYS, FORGOT_PASSWORD_KEYS]) {
      const drawn: string = accountsLabel(language, keys);

      expect({ drawn, named: entry.body.includes(`**${drawn}**`) }).toEqual({
        drawn,
        named: true,
      });
    }
  });

  it("the upgrade note is in the English note's place, under a lead of its own, linking to Your Account", () => {
    expect(note.startsWith("- **")).toBe(true);
    expect(note).not.toContain(NOTE_LEAD);
    expect(linkTargets(note)).toEqual([YOUR_ACCOUNT_PATH]);
    expect(inlineCode(note)).toEqual([]);
  });
});
