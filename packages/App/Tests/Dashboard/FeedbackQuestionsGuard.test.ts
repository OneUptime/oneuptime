// UX rule: Docs/ux/README.md#asking-people
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

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
 *     the Dashboard posts nothing else.
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

    const submit: string =
      client
        .slice(client.indexOf("public static async submit("))
        .split("public static async addDetails(")[0] || "";
    const posted: string =
      submit.slice(submit.indexOf("data: {")).split("},")[0] || "";

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
