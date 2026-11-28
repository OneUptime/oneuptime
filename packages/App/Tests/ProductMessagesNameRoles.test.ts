import {
  KeptEnglish,
  generalRoleWordsIn,
} from "./FeatureSet/Docs/DocsRoleNames";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE PRODUCT'S ENGLISH NAMES THE BUILT-IN ROLES IT MEANS (#8520, #8614).
 *
 * A message names a built-in role as the role picker draws it: "Ask a
 * Project Owner or Project Admin for access.", "It emails the Project
 * Owners." - not "a project owner", "the project's owners" or "owners and
 * admins". Its locale key is that English, so each language's translation
 * is then held to the role's drawn name (BuiltInRoleNamesInLocales), and
 * the docs quote the message as it reads (DocsRoleNamesInRunningText).
 *
 * This reads every string literal with a space in the product's source -
 * the frontends, the server, the workers and the mobile app - outside
 * comments, and every key of the English locales, for the general words
 * (DocsRoleNames.generalRoleWordsIn). The words that mean something else
 * are listed, each with its reason.
 */

const PACKAGES: string = path.resolve(__dirname, "../..");

const SOURCE_ROOTS: ReadonlyArray<string> = [
  "Common",
  "App/FeatureSet",
  "MobileApp/src",
];

/*
 * The Enterprise Edition's pages and server, where ee/ is checked out: App
 * Test deletes it, and the Enterprise Edition workflow runs this suite with
 * it. Its Settings > SCIM notice and Team Compliance card named "a project
 * owner" and "a project admin" after #8574 re-keyed the locales, and read
 * in English in every language (#8814).
 */
const ENTERPRISE_ROOTS: ReadonlyArray<string> = [
  "../ee/Dashboard",
  "../ee/AdminDashboard",
  "../ee/Server",
];
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(path.resolve(__dirname, "../.."), "../ee/Dashboard"),
);

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

const ENGLISH_LOCALES: ReadonlyArray<string> = [
  "App/FeatureSet/Dashboard/src/Locales/en.json",
  "App/FeatureSet/AdminDashboard/src/Locales/en.json",
  "App/FeatureSet/StatusPage/src/Locales/en.json",
  "App/FeatureSet/Accounts/src/Locales/en.json",
  "App/FeatureSet/PublicDashboard/src/Locales/en.json",
  "Common/Server/Locales/en.json",
];

// General words in the product that are not OneUptime's built-in roles.
const NOT_THE_ROLES: ReadonlyArray<KeptEnglish> = [
  {
    text: "Slack lets only workspace owners and admins",
    why: "a Slack workspace's own owners and admins, who decide who manages its user groups",
  },
  {
    text: "Map IdP groups to status page viewers",
    why: "the people a private status page lets in, not the Status Page Viewer role",
  },
  {
    text: "incident member role",
    why: "the incident role of someone on an incident (IncidentMember), in a log line and a field's path",
  },
  {
    text: "${label} incident member",
    why: "the person a monitor's steps add to its incidents (IncidentMember), in a reference's path",
  },
  {
    text: "incident member added notification",
    why: "the email to someone added to an incident, in a log line",
  },
  {
    text: "no master admin or admin notification email",
    why: "the instance's master admins and its admin notification email, in a log line",
  },
  {
    text: "owners and owner rules",
    why: "the owners and owner rules OneUptime AI proposes for Data Security's stores, in its tool's description, not the Project Owner role",
  },
];

/*
 * A string literal - double or single quoted on one line, or a template -
 * or a comment, which the scan reads past whole. A comment's own quotes and
 * backticks would otherwise open a literal: ForgejoApi's doc comment names
 * a ```suggestion block, and its third backtick paired with the next
 * template's, so the code between them read as a message. A // after a
 * colon (a URL in a JSX text) or an escaped slash (a regex) opens none.
 */
const STRING_LITERAL_OR_COMMENT: RegExp =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|(?<![\\:])\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

// What the scan read past: a comment starts with its slash, a literal never does.
const COMMENT: RegExp = /^\//;

// A message has a space in it; an identifier or a key does not.
const HAS_A_SPACE: RegExp = /\s/;

const SOURCE_FILE: RegExp = /\.tsx?$/;

// A line that is a comment's, up to where a literal starts.
const COMMENT_LINE: RegExp = /^\s*(?:\*|\/\/|\/\*)/;

// The string literals of a source text with a space in them, past comments.
function messagesIn(source: string): Array<string> {
  return Array.from(source.matchAll(STRING_LITERAL_OR_COMMENT))
    .filter((match: RegExpMatchArray): boolean => {
      const start: number = match.index || 0;
      const lineStart: number = source.lastIndexOf("\n", start) + 1;

      return (
        !COMMENT.test(match[0]) &&
        HAS_A_SPACE.test(match[0]) &&
        !COMMENT_LINE.test(source.slice(lineStart, start))
      );
    })
    .map((match: RegExpMatchArray): string => {
      return match[0];
    });
}

// The general words in a message, past the ones listed as something else.
function generalWordsIn(message: string): Array<string> {
  return generalRoleWordsIn(
    NOT_THE_ROLES.reduce((text: string, kept: KeptEnglish): string => {
      return text.split(kept.text).join(" ");
    }, message),
  );
}

function sourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) {
        return [];
      }

      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return sourceFiles(full);
      }

      return SOURCE_FILE.test(entry.name) ? [full] : [];
    });
}

interface ProductMessage {
  where: string;
  text: string;
}

const PRODUCT_MESSAGES: ReadonlyArray<ProductMessage> = [
  ...[...SOURCE_ROOTS, ...(ENTERPRISE_PRESENT ? ENTERPRISE_ROOTS : [])].flatMap(
    (root: string): Array<ProductMessage> => {
      return sourceFiles(path.join(PACKAGES, root)).flatMap(
        (file: string): Array<ProductMessage> => {
          return messagesIn(fs.readFileSync(file, "utf8")).map(
            (text: string): ProductMessage => {
              return { where: path.relative(PACKAGES, file), text };
            },
          );
        },
      );
    },
  ),
  ...ENGLISH_LOCALES.flatMap((locale: string): Array<ProductMessage> => {
    return Object.keys(
      JSON.parse(fs.readFileSync(path.join(PACKAGES, locale), "utf8")),
    ).map((text: string): ProductMessage => {
      return { where: locale, text };
    });
  }),
];

describe("the product's English names the built-in roles it means", () => {
  it("would find a role in general words, and not a role named", () => {
    expect(generalWordsIn('"It emails the project\'s owners."')).toEqual([
      "the project's owners",
    ]);
    expect(
      generalWordsIn(
        "`this ${noun} is private, so only its owners and the project's owners and admins can see it.`",
      ),
    ).toEqual(["the project's owners", "owners and admins"]);
    expect(generalWordsIn('"Ask a project admin for access."')).toEqual([
      "project admin",
    ]);
    expect(
      generalWordsIn('"Ask a Project Owner or Project Admin for access."'),
    ).toEqual([]);
    // The people in a project, not the Project Member role.
    expect(generalWordsIn('"No project members"')).toEqual([]);
    // Slack's own owners and admins.
    expect(
      generalWordsIn(
        '"Slack lets only workspace owners and admins change user groups in your workspace."',
      ),
    ).toEqual([]);
  });

  it("reads string literals, past comments", () => {
    expect(
      messagesIn(
        [
          "// Only a project owner may do this.",
          "/*",
          ' * "the project\'s owners" are told.',
          // A comment's backticks open no template: the code below is no message.
          " * Its review comments apply a ```suggestion block.",
          " */",
          'const words: string = "Ask a project admin for access.";',
          'const key: string = "projectOwner";',
          "const line: string = `${count} owners and admins`;",
          "const path: string = `${base}/pulls`; // write, admin or owner",
          // A URL in a JSX text is no comment: the literal after it is read.
          'const link = <a>See https://example.com</a>; const ask: string = "Ask a project admin first";',
        ].join("\n"),
      ),
    ).toEqual([
      '"Ask a project admin for access."',
      "`${count} owners and admins`",
      '"Ask a project admin first"',
    ]);
  });

  it("reads the frontends, the server, the workers, the mobile app and the English locales", () => {
    const places: Array<string> = PRODUCT_MESSAGES.map(
      (message: ProductMessage): string => {
        return message.where;
      },
    );

    expect(PRODUCT_MESSAGES.length).toBeGreaterThan(50000);

    for (const place of [
      "App/FeatureSet/Dashboard/src/",
      "App/FeatureSet/Workers/",
      "Common/Server/",
      "Common/UI/",
      "MobileApp/src/",
      "App/FeatureSet/Dashboard/src/Locales/en.json",
      "Common/Server/Locales/en.json",
    ]) {
      expect([
        place,
        places.some((where: string): boolean => {
          return where.startsWith(place);
        }),
      ]).toEqual([place, true]);
    }
  });

  (ENTERPRISE_PRESENT ? it : it.skip)(
    "reads the Enterprise Edition's pages and server too, where ee/ is checked out",
    () => {
      for (const place of ENTERPRISE_ROOTS) {
        expect([
          place,
          PRODUCT_MESSAGES.some((message: ProductMessage): boolean => {
            return message.where.startsWith(`${place}/`);
          }),
        ]).toEqual([place, true]);
      }
    },
  );

  it("lists only words the product uses, each with its reason", () => {
    for (const kept of NOT_THE_ROLES) {
      expect([kept.text, kept.why.length > 10]).toEqual([kept.text, true]);
      expect([
        kept.text,
        PRODUCT_MESSAGES.some((message: ProductMessage): boolean => {
          return message.text.includes(kept.text);
        }),
      ]).toEqual([kept.text, true]);
    }
  });

  it("names the roles in every message", () => {
    const found: Array<string> = PRODUCT_MESSAGES.flatMap(
      (message: ProductMessage): Array<string> => {
        return generalWordsIn(message.text).map((words: string): string => {
          return `${message.where}: ${words}: ${message.text.slice(0, 120)}`;
        });
      },
    );

    expect(found).toEqual([]);
  });
});
