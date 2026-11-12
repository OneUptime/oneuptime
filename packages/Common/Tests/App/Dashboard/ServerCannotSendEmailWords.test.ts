import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SERVER_EMAIL_COPY } from "../../../../App/FeatureSet/Dashboard/src/Utils/ServerEmail";
import { SERVER_SENDING_ALERT_COPY } from "../../../UI/Components/ServerSending/ServerSendingTopAlert";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "../../../Types/ServerSending/ServerSendingWords";
import { INVITATION_LINK_COPY } from "../../../UI/Components/InvitationLink/InvitationLinkModal";

/*
 * WHAT THE DASHBOARD AND THE ADMIN DASHBOARD SAY WHEN THE SERVER CANNOT
 * SEND EMAIL, IN EVERY LANGUAGE (#6825).
 *
 * Create Monitor's card and Home's on-call step promise "the project's
 * owners get an email"; the invite dialogs say "We email them an
 * invitation"; a pending member's pill says "Invitation Sent". On a server
 * that cannot send email each says the truth instead, with the fix - for a
 * master admin, where to set email up; for anybody else, to ask the
 * server's admin. This holds:
 *
 *   - every one of those sentences, the banner's and the project log's, is
 *     translated in all 17 Dashboard locales, its placeholders kept;
 *   - the banner's, which the Admin Dashboard draws too, in all 17 of its
 *     locales as well;
 *   - the sentences that replace a promise keep its first words, so the
 *     card reads the same until it comes to the email;
 *   - the pages draw the old promise only where the server can send.
 */

const FEATURE_SET: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);
const DASHBOARD_SRC: string = path.join(FEATURE_SET, "Dashboard", "src");

type Locale = Record<string, unknown>;

function readLocales(directory: string): Record<string, Locale> {
  const locales: Record<string, Locale> = {};

  for (const file of fs.readdirSync(directory)) {
    if (file.endsWith(".json")) {
      locales[file.replace(".json", "")] = JSON.parse(
        fs.readFileSync(path.join(directory, file), "utf8"),
      ) as Locale;
    }
  }

  return locales;
}

const DASHBOARD_LOCALES: Record<string, Locale> = readLocales(
  path.join(DASHBOARD_SRC, "Locales"),
);
const ADMIN_LOCALES: Record<string, Locale> = readLocales(
  path.join(FEATURE_SET, "AdminDashboard", "src", "Locales"),
);

const PLACEHOLDER: RegExp = /\{\{\s*(\w+)\s*\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

const DASHBOARD_SENTENCES: Array<string> = [
  SERVER_EMAIL_COPY.createMonitorDescription,
  SERVER_EMAIL_COPY.createMonitorDescriptionForAdmin,
  SERVER_EMAIL_COPY.onCallStepDescription,
  SERVER_EMAIL_COPY.onCallStepDescriptionForAdmin,
  SERVER_EMAIL_COPY.inviteEmailDescription,
  SERVER_EMAIL_COPY.inviteEmailDescriptionForAdmin,
  SERVER_EMAIL_COPY.invitedPill,
  SERVER_EMAIL_COPY.invitationLinkTitle,
  SERVER_EMAIL_COPY.invitationLinkDescription,
  SERVER_EMAIL_COPY.invitationLinkRegisteredDescription,
  SERVER_EMAIL_COPY.invitationLinkFailed,
  SERVER_EMAIL_NOT_SET_UP_MESSAGE,
];

const BANNER_SENTENCES: Array<string> = Object.values(
  SERVER_SENDING_ALERT_COPY,
);

// What the Admin Dashboard's invite dialogs say too, as the Dashboard's do ("Done" was there before).
const ADMIN_INVITE_SENTENCES: Array<string> = Object.values(
  INVITATION_LINK_COPY,
).filter((sentence: string): boolean => {
  return sentence !== INVITATION_LINK_COPY.done;
});

const NON_ENGLISH_DASHBOARD: Array<string> = Object.keys(DASHBOARD_LOCALES)
  .filter((code: string): boolean => {
    return code !== "en";
  })
  .sort();

const NON_ENGLISH_ADMIN: Array<string> = Object.keys(ADMIN_LOCALES)
  .filter((code: string): boolean => {
    return code !== "en";
  })
  .sort();

describe("in every language", () => {
  test("17 Dashboard and 17 Admin Dashboard languages besides English", () => {
    expect(NON_ENGLISH_DASHBOARD).toHaveLength(17);
    expect(NON_ENGLISH_ADMIN).toHaveLength(17);
  });

  test.each([...DASHBOARD_SENTENCES, ...BANNER_SENTENCES])(
    "the Dashboard says %p in every language, its placeholders kept",
    (sentence: string) => {
      expect(DASHBOARD_LOCALES["en"]![sentence]).toBe(sentence);

      for (const code of NON_ENGLISH_DASHBOARD) {
        const translated: unknown = DASHBOARD_LOCALES[code]![sentence];

        expect({ code, isString: typeof translated === "string" }).toEqual({
          code,
          isString: true,
        });
        // "Invited" was translated before; everything else is new and said anew.
        expect({ code, translated }).not.toEqual({
          code,
          translated: sentence,
        });
        expect({
          code,
          placeholders: placeholders(String(translated)),
        }).toEqual({ code, placeholders: placeholders(sentence) });
      }
    },
  );

  test.each([...BANNER_SENTENCES, ...ADMIN_INVITE_SENTENCES])(
    "the Admin Dashboard says %p in every language",
    (sentence: string) => {
      expect(ADMIN_LOCALES["en"]![sentence]).toBe(sentence);

      for (const code of NON_ENGLISH_ADMIN) {
        const translated: unknown = ADMIN_LOCALES[code]![sentence];

        expect({ code, isString: typeof translated === "string" }).toEqual({
          code,
          isString: true,
        });
        expect({ code, translated }).not.toEqual({
          code,
          translated: sentence,
        });
        expect({
          code,
          placeholders: placeholders(String(translated)),
        }).toEqual({ code, placeholders: placeholders(sentence) });
        // The two dashboards say a shared sentence alike.
        expect({ code, translated }).toEqual({
          code,
          translated: DASHBOARD_LOCALES[code]![sentence],
        });
      }
    },
  );
});

describe("the words", () => {
  test("the promises they replace keep their first words", () => {
    expect(SERVER_EMAIL_COPY.createMonitorDescription).toMatch(
      /^Pick what to monitor and give it a name\. When something goes wrong, OneUptime opens an incident or alert\./,
    );
    expect(SERVER_EMAIL_COPY.onCallStepDescription).toMatch(
      /^Page the right person when an incident or alert opens\./,
    );
  });

  test("a master admin is sent to the Admin Dashboard; anybody else to the server's admin", () => {
    for (const forAdmin of [
      SERVER_EMAIL_COPY.createMonitorDescriptionForAdmin,
      SERVER_EMAIL_COPY.onCallStepDescriptionForAdmin,
    ]) {
      expect(forAdmin).toContain("Admin Dashboard");
      expect(forAdmin).not.toContain("server's admin");
    }

    for (const forOthers of [
      SERVER_EMAIL_COPY.createMonitorDescription,
      SERVER_EMAIL_COPY.onCallStepDescription,
      SERVER_EMAIL_COPY.inviteEmailDescription,
    ]) {
      expect(forOthers).toContain("server's admin");
      expect(forOthers).not.toContain("Admin Dashboard");
    }
  });

  test("an invitation is still created, and the dialog says so before Invite is pressed", () => {
    expect(SERVER_EMAIL_COPY.inviteEmailDescription).toContain(
      "The invitation is still created",
    );
    expect(SERVER_EMAIL_COPY.inviteEmailDescriptionForAdmin).toContain(
      "you get a link to send them yourself",
    );
  });

  test("the link's rules are the emailed link's: once, this address, 7 days", () => {
    expect(SERVER_EMAIL_COPY.invitationLinkDescription).toContain(
      "It works once, only for this address, for 7 days.",
    );
  });
});

describe("where the pages say them", () => {
  function read(...segments: Array<string>): string {
    return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
  }

  /*
   * Home's on-call step has its words in the Welcome checklist's catalog,
   * and knows whether the server can send from the checklist's one server
   * answer (issue #6803), which reads the same sending status.
   */
  test("Home's on-call step says onCallStepDescription when the server cannot send email", () => {
    const catalog: string = read(
      "Components",
      "Home",
      "WelcomeChecklist",
      "WelcomeChecklistCatalog.ts",
    );
    const card: string = read("Components", "Home", "GettingStarted.tsx");

    expect(catalog).toContain("SERVER_EMAIL_COPY.onCallStepDescription");
    expect(catalog).toContain(
      "SERVER_EMAIL_COPY.onCallStepDescriptionForAdmin",
    );
    expect(card).toContain("canSendEmail: answer.canSendEmail,");
    expect(card).toContain("isMasterAdmin: Boolean(UserUtil.isMasterAdmin()),");
    expect(card).toContain(
      "getGettingStartedTaskDescription(entry, serverEmail)",
    );
  });

  test.each([
    [["Pages", "Monitor", "Create.tsx"], "createMonitorDescription"],
    [["Pages", "Users", "Index.tsx"], "inviteEmailDescription"],
    [["Pages", "Teams", "View", "Members.tsx"], "inviteEmailDescription"],
  ] as Array<[Array<string>, string]>)(
    "%j says %s when the server cannot send email",
    (file: Array<string>, copy: string) => {
      const source: string = read(...file);

      expect(source).toContain(`SERVER_EMAIL_COPY.${copy}`);
      expect(source).toContain(`SERVER_EMAIL_COPY.${copy}ForAdmin`);
      expect(source).toContain("useServerEmail()");
    },
  );

  test.each([
    [["Pages", "Users", "Index.tsx"]],
    [["Pages", "Users", "View", "Teams.tsx"]],
    [["Pages", "Teams", "View", "Members.tsx"]],
  ])(
    "%j says Invited, not Invitation Sent, when nothing was sent",
    (file: Array<string>) => {
      const source: string = read(...file);
      const pill: string = source.slice(
        source.indexOf("SERVER_EMAIL_COPY.invitedPill") - 200,
        source.indexOf("SERVER_EMAIL_COPY.invitedPill") + 200,
      );

      expect(pill).toContain("cannotSendEmail(serverEmail)");
      expect(pill).toContain('"Invitation Sent"');
    },
  );

  test("the invite dialogs hand a master admin the link once the invitation is made", () => {
    for (const file of [
      ["Pages", "Users", "Index.tsx"],
      ["Pages", "Teams", "View", "Members.tsx"],
    ]) {
      const source: string = read(...file);

      expect(source).toContain("<InvitationLinkModal");
      expect(source).toMatch(
        /cannotSendEmail\(serverEmail\) &&\s*serverEmail\.isMasterAdmin/,
      );
    }
  });

  test("the project's Email Logs read a server with no email in its owners' words", () => {
    const source: string = read(
      "Components",
      "NotificationLogs",
      "EmailLogsTable.tsx",
    );

    expect(source).toContain("ServerSendingWords.isServerEmailNotSetUpMessage");
    expect(source).toContain(
      "translator.translateText(SERVER_EMAIL_NOT_SET_UP_MESSAGE)",
    );
  });

  test("the Admin Dashboard's invite dialogs say it too, and hand over the link", () => {
    const adminPage: (file: string) => string = (file: string): string => {
      return fs.readFileSync(
        path.join(
          FEATURE_SET,
          "AdminDashboard",
          "src",
          "Pages",
          "Projects",
          "View",
          file,
        ),
        "utf8",
      );
    };

    for (const file of ["Users.tsx", "TeamView.tsx"]) {
      const source: string = adminPage(file);

      expect(source).toContain(
        "INVITATION_LINK_COPY.inviteDescriptionForAdmin",
      );
      expect(source).toContain("<InvitationLinkModal");
      expect(source).toContain("useServerCanSendEmail() === false");
    }

    for (const file of ["Users.tsx", "TeamView.tsx", "UserView.tsx"]) {
      expect(adminPage(file)).toContain("INVITATION_LINK_COPY.invitedPill");
    }
  });

  test("both dashboards draw the banner above every page", () => {
    expect(read("Components", "MasterPage", "MasterPage.tsx")).toContain(
      "<ServerSendingTopAlert",
    );
    expect(
      fs.readFileSync(
        path.join(
          FEATURE_SET,
          "AdminDashboard",
          "src",
          "Components",
          "MasterPage",
          "MasterPage.tsx",
        ),
        "utf8",
      ),
    ).toContain("<ServerSendingTopAlert");
  });
});
