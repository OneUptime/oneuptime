// UX rule: Docs/ux/README.md#asking-people
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  GiveFeedbackDestination,
  getGiveFeedbackDestination,
} from "Common/Types/ProductFeedback/ProductFeedback";

/*
 * ASKING PEOPLE, KEPT TO ITS RULES (issue #6832).
 *
 * OneUptime asks people what was hard: "How easy was that?" at the end of a
 * guided setup, "Was this clear?" under an explanation, the first-week
 * check-in, and Give feedback in Help. People resent being surveyed, so
 * the asking has rules, and this keeps them:
 *
 *   - every question OneUptime asks goes through ProductFeedback.ask, where
 *     the server decides (once per question, one a week, never during an
 *     open incident or alert, never once switched off), and only from the
 *     places listed in ASKING_FILES, each with why;
 *   - every guided setup is drawn in GuidedSetupFrame, which asks its one
 *     question, so a setup cannot end without it - or ask a second one;
 *   - nothing asks how likely people are to recommend OneUptime: a
 *     product-wide score says nothing about what to fix;
 *   - an answer is kept with only the answer, the page and the version:
 *     the table has no column for a person, a project or an address, and
 *     the Dashboard posts nothing else;
 *   - Give feedback is a message (#8893): the server emails it, naming the
 *     person it reads from who is signed in, to the OneUptime team on Cloud
 *     and to a self-hosted server's own admins - never to OneUptime from a
 *     self-hosted server - and the dialog says to whom and with what, for
 *     every place it can go, before anything is sent;
 *   - once an answer is given, the card says where it went, and only then
 *     offers the GitHub issue, which says it is public (#7462): the line
 *     that says where an answer goes, "nothing leaves this server", is said
 *     before it is given and never left under the link to a public issue;
 *   - an answer is kept a set time, then deleted (#7366).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD_SRC: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);
const COMMON_UI: string = path.join(REPOSITORY_ROOT, "packages/Common/UI");

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const ASKS: RegExp = /\bProductFeedback\.ask\(/;
const GUIDED_SETUP_FILE: RegExp = /GuidedSetup\.tsx$/;
const USES_FRAME: RegExp = /<GuidedSetupFrame\b/;
const ASKS_TO_RECOMMEND: RegExp =
  /how likely are you to recommend|net promoter/i;

/*
 * The places that ask a question of their own, and why each may. A new one
 * goes here with its reason, and through ProductFeedback.ask.
 */
const ASKING_FILES: Readonly<Record<string, string>> = {
  "packages/App/FeatureSet/Dashboard/src/Components/Feedback/SetupFeedback.tsx":
    "The end of every guided setup: GuidedSetupFrame draws it once for all of them.",
  "packages/App/FeatureSet/Dashboard/src/Components/Feedback/SetupCheckInCard.tsx":
    "The first-week check-in on Home, once per project, for its creator.",
};

const listFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

const relative: (file: string) => string = (file: string): string => {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
};

const withoutComments: (source: string) => string = (
  source: string,
): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
};

const SOURCE_FILES: Array<string> = [
  ...listFiles(DASHBOARD_SRC),
  ...listFiles(COMMON_UI),
];

describe("a question OneUptime asks goes through the rules", () => {
  test("only the listed places ask, and each through ProductFeedback.ask", () => {
    const asking: Array<string> = SOURCE_FILES.filter(
      (file: string): boolean => {
        return ASKS.test(withoutComments(fs.readFileSync(file, "utf8")));
      },
    ).map(relative);

    expect(asking.sort()).toEqual(Object.keys(ASKING_FILES).sort());
  });

  test("every guided setup is drawn in GuidedSetupFrame, which asks once at its end", () => {
    const setups: Array<string> = listFiles(
      path.join(DASHBOARD_SRC, "Components/GuidedSetup"),
    ).filter((file: string): boolean => {
      return GUIDED_SETUP_FILE.test(file);
    });

    expect(setups.length).toBeGreaterThanOrEqual(4);

    for (const setup of setups) {
      const source: string = withoutComments(fs.readFileSync(setup, "utf8"));

      expect({
        setup: relative(setup),
        usesFrame: USES_FRAME.test(source),
      }).toEqual({
        setup: relative(setup),
        usesFrame: true,
      });
      // The frame asks; a setup does not ask a second time.
      expect(source.includes("EaseQuestion")).toBe(false);
    }

    const frame: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/GuidedSetup/GuidedSetupFrame.tsx"),
      "utf8",
    );

    expect(withoutComments(frame)).toMatch(
      /<SetupFeedback\s+setup=\{props\.setup\}\s+isFinished=\{props\.isFinished\}\s*\/>/,
    );
  });

  test("nothing asks how likely people are to recommend OneUptime", () => {
    const found: Array<string> = [
      ...SOURCE_FILES,
      ...listFiles(
        path.join(
          REPOSITORY_ROOT,
          "packages/App/FeatureSet/AdminDashboard/src",
        ),
      ),
    ]
      .filter((file: string): boolean => {
        return ASKS_TO_RECOMMEND.test(fs.readFileSync(file, "utf8"));
      })
      .map(relative);

    expect(found).toEqual([]);
  });
});

describe("an answer carries the answer, the page and the version - nothing else", () => {
  test("the table has a column for each, and none for a person, a project or an address", () => {
    const model: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Common/Models/DatabaseModels/ProductFeedback.ts",
      ),
      "utf8",
    );

    const columns: Array<string> = Array.from(
      model.matchAll(/public (\w+)\?:/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] || "";
    });

    expect(columns).toEqual([
      "kind",
      "topic",
      "score",
      "isPositive",
      "details",
      /*
       * A docs page's no: one of four words the page offers (#7209,
       * DocsFeedbackReason), never words anyone wrote.
       */
      "reason",
      "page",
      "productVersion",
    ]);
    // No key to a project or a person, by a decorator or a column of its own.
    expect(model).not.toMatch(
      /@TenantColumn|@ManyToOne|@JoinColumn|public (project|user|createdByUser)\w*\?:/,
    );
  });

  test("the Dashboard posts only those fields", () => {
    const client: string = withoutComments(
      fs.readFileSync(path.join(COMMON_UI, "Utils/ProductFeedback.ts"), "utf8"),
    );

    // Every answer - submit() and giveFeedback() - is posted by keep().
    const keep: string =
      client
        .slice(client.indexOf("private static async keep("))
        .split("public static async addDetails(")[0] || "";

    expect(keep).toContain("url: apiUrl(PRODUCT_FEEDBACK_ROUTE)");
    expect(
      (client.match(/apiUrl\(PRODUCT_FEEDBACK_ROUTE\)/g) || []).length,
    ).toBe(1);

    const posted: string =
      keep.slice(keep.indexOf("data: {")).split("},")[0] || "";

    const keys: Array<string> = Array.from(posted.matchAll(/^\s*(\w+):/gm)).map(
      (match: RegExpMatchArray): string => {
        return match[1] || "";
      },
    );

    expect(
      keys.filter((key: string) => {
        return key !== "data";
      }),
    ).toEqual([
      "kind",
      "topic",
      "score",
      "isPositive",
      "details",
      "page",
      "version",
    ]);
  });
});

describe("Give feedback is a message, and reaches someone who can answer it (#8893)", () => {
  const COMMON_ROOT: string = path.join(REPOSITORY_ROOT, "packages/Common");

  const readCode: (file: string) => string = (file: string): string => {
    return withoutComments(fs.readFileSync(file, "utf8"));
  };

  test("a self-hosted server never sends it to OneUptime: only OneUptime Cloud does", () => {
    for (const adminNotificationEmail of [null, "", "ops@acme.test"]) {
      expect(
        getGiveFeedbackDestination({
          isOneUptimeCloud: false,
          adminNotificationEmail: adminNotificationEmail,
        }),
      ).not.toBe(GiveFeedbackDestination.OneUptimeTeam);
    }

    expect(
      getGiveFeedbackDestination({
        isOneUptimeCloud: true,
        adminNotificationEmail: null,
      }),
    ).toBe(GiveFeedbackDestination.OneUptimeTeam);

    // The server sends to OneUptime's address in one place: the Cloud's.
    const sender: string = readCode(
      path.join(COMMON_ROOT, "Server/Utils/GiveFeedbackEmail.ts"),
    );
    const sendsToOneUptime: Array<string> =
      sender.match(/to: ONEUPTIME_SUPPORT_EMAIL/g) || [];

    expect(sendsToOneUptime).toHaveLength(1);
    expect(sender).toMatch(
      /if \(destination === GiveFeedbackDestination\.OneUptimeTeam\) \{\s*return \{ destination, to: ONEUPTIME_SUPPORT_EMAIL \};/,
    );
  });

  test("the person is named by the server, from who is signed in, never from what the Dashboard posts", () => {
    const sender: string = readCode(
      path.join(COMMON_ROOT, "Server/Utils/GiveFeedbackEmail.ts"),
    );
    const api: string = readCode(
      path.join(COMMON_ROOT, "Server/API/ProductFeedbackAPI.ts"),
    );

    expect(sender).toMatch(/UserService\.findOneById\(\{\s*id: data\.userId,/);
    expect(api).toMatch(
      /GiveFeedbackEmail\.prepare\(\{\s*userId: userId,\s*projectId: readMemberProjectId\(props\),/,
    );
    // Kept first, answered, and only then emailed.
    expect(
      api.indexOf("ProductFeedbackService.submit(submission)"),
    ).toBeLessThan(api.indexOf("GiveFeedbackEmail.prepare("));
    expect(api.indexOf("isEmailed: receipt.isEmailed")).toBeGreaterThan(-1);
    expect(api.indexOf("isEmailed: receipt.isEmailed")).toBeLessThan(
      api.indexOf("void GiveFeedbackEmail.send(delivery)"),
    );
  });

  test("the dialog says to whom and with what, wherever it goes, before anything is sent", () => {
    const dialog: string = readCode(
      path.join(DASHBOARD_SRC, "Components/Feedback/GiveFeedbackDialog.tsx"),
    );
    const whatIsSent: string =
      dialog.slice(dialog.indexOf("const WHAT_IS_SENT")).split("};")[0] || "";

    // The sentence a destination's line is, as its translationKey holds it.
    const sentenceFor: (destination: string) => string = (
      destination: string,
    ): string => {
      const found: RegExpMatchArray | null = whatIsSent.match(
        new RegExp(
          `\\[GiveFeedbackDestination\\.${destination}\\]:\\s*translationKey\\(\\s*"([^"]*)"`,
        ),
      );

      expect(found).not.toBeNull();

      return found?.[1] || "";
    };

    for (const destination of Object.keys(GiveFeedbackDestination)) {
      const sentence: string = sentenceFor(destination);

      // The page, as its breadcrumbs name it, and the version: always said.
      expect(sentence).toContain("{{page}}");
      expect(sentence).toContain("{{version}}");
    }

    // Emailed with who sent it: said, with their address.
    for (const destination of ["OneUptimeTeam", "ServerAdminsByEmail"]) {
      expect(sentenceFor(destination)).toContain(
        "with your name and email ({{email}})",
      );
    }

    expect(sentenceFor("OneUptimeTeam")).toContain("the OneUptime team");
    expect(sentenceFor("ServerAdminsByEmail")).toContain(
      "Nothing is sent to OneUptime.",
    );
    expect(sentenceFor("ServerAdmins")).toContain("without your name");
    expect(sentenceFor("ServerAdmins")).toContain(
      "Nothing leaves this server.",
    );
    expect(sentenceFor("ServerAdmins")).not.toContain("{{email}}");

    // The line is drawn from the server's word on where it goes.
    expect(dialog).toContain("ProductFeedback.getGiveFeedbackDestination()");
    expect(dialog).toContain("WHAT_IS_SENT[destination]");
  });
});

describe("once an answer is given, the card says where it went (#7462)", () => {
  const readCode: (file: string) => string = (file: string): string => {
    return withoutComments(fs.readFileSync(file, "utf8"));
  };

  const FEEDBACK: string = path.join(DASHBOARD_SRC, "Components/Feedback");

  test("the ease question says where it goes only before it is given, and where it went after", () => {
    const ease: string = readCode(path.join(FEEDBACK, "EaseQuestion.tsx"));

    // The line of where it goes is drawn only before the answer is sent...
    expect(ease).toMatch(
      /\{stage !== "sent" \? \(\s*<div[^>]*>\s*<FeedbackWhereItGoes \/>/,
    );
    // ...and, once sent, where it went comes before the GitHub link.
    const sent: string = ease.slice(
      ease.indexOf("EASE_QUESTION_THANKS_TEST_ID}"),
    );

    expect(sent.indexOf("<FeedbackSentLine />")).toBeGreaterThan(-1);
    expect(sent.indexOf("<FeedbackSentLine />")).toBeLessThan(
      sent.indexOf("<FeedbackGitHubLink"),
    );
  });

  test("every link to a GitHub issue after an answer is the one that says the issue is public", () => {
    const link: string = readCode(
      path.join(FEEDBACK, "FeedbackGitHubLink.tsx"),
    );

    expect(link).toContain("Also tell OneUptime in a public GitHub issue");
    expect(link).toContain("nothing is posted until you post it");

    for (const file of ["EaseQuestion.tsx", "GiveFeedbackDialog.tsx"]) {
      const source: string = readCode(path.join(FEEDBACK, file));

      expect({ file, drawsItsOwnLink: source.includes("github.com") }).toEqual({
        file,
        drawsItsOwnLink: false,
      });
      expect(source).toContain("<FeedbackGitHubLink");
      expect(source).not.toContain("Also tell OneUptime on GitHub");
    }
  });

  test("a self-hosted server's thanks names nobody as us: only Cloud's team says it", () => {
    const words: string = readCode(
      path.join(FEEDBACK, "FeedbackWhereItGoes.tsx"),
    );

    expect(words).toMatch(
      /BILLING_ENABLED\s*\?\s*translator\.translateText\("Thanks for telling us\."\)\s*:\s*translator\.translateText\("Thanks for your answer\."\)/,
    );

    for (const file of ["EaseQuestion.tsx", "SetupCheckInCard.tsx"]) {
      expect({
        file,
        thanksAsUs: readCode(path.join(FEEDBACK, file)).includes(
          '"Thanks for telling us."',
        ),
      }).toEqual({ file, thanksAsUs: false });
    }
  });
});
