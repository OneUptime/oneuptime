import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import {
  DEFAULT_HSTS_MAX_AGE_SECONDS,
  parseHstsMaxAgeSeconds,
} from "Common/Server/EnvironmentConfig";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about sign-in cookies and HTTPS, held to the code:
 *
 *   - the upgrade note (installation/upgrading, "Other changes in 14") and
 *     the Docker Compose guide's Set up HTTPS name the setting the server
 *     reads (HSTS_MAX_AGE_SECONDS, a year unless set, 0 to forget), the
 *     header it sends (Strict-Transport-Security, never for a custom
 *     domain) and the one the proxy has to send (X-Forwarded-Proto, which
 *     the guide's Nginx example sends and OneUptime's ingress passes on);
 *   - the note sits after the note on workflow field lists and before the
 *     pointer to the endpoint changes, and links to Set up HTTPS - in every
 *     language at that language's own heading;
 *   - every translation carries the note in the English note's place, under
 *     a lead of its own, with the English note's code.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const NOTE_LEAD: string =
  "**Sign-in cookies stay on HTTPS, and an HTTPS installation tells browsers to stay there.**";
// The note before it (WorkflowFieldListsUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**A workflow's field lists have plain names, and a watched related record is heard.**";
const LAST_ITEM_START: string = "- See [API and endpoint changes]";

const DOCKER_COMPOSE_PAGE: string = "installation/docker-compose";
const HTTPS_HEADING: string = "## Set up HTTPS";
const HSTS_SETTING: string = "HSTS_MAX_AGE_SECONDS";

const LINK_TARGET: RegExp = /\]\(([^)\s]+)\)/g;
const HEADING_LINE: RegExp = /^#{1,6}\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_MARKER: RegExp = /^#+\s+/;

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function page(language: string, name: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${name}.md`),
    "utf8",
  );
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// The headings of a page, in order, outside code blocks.
function headings(markdown: string): Array<string> {
  const found: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && HEADING_LINE.test(line)) {
      found.push(line.trim());
    }
  }

  return found;
}

// The anchor of a language's "Set up HTTPS" section.
function httpsAnchor(language: string): string {
  const index: number = headings(page("en", DOCKER_COMPOSE_PAGE)).indexOf(
    HTTPS_HEADING,
  );

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = headings(
    page(language, DOCKER_COMPOSE_PAGE),
  )[index];

  expect({ language, heading: Boolean(heading) }).toEqual({
    language,
    heading: true,
  });

  return slugifyMarkdownHeading(
    (heading as string).replace(HEADING_MARKER, ""),
  );
}

function linkTargets(text: string): Array<string> {
  return Array.from(text.matchAll(LINK_TARGET)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on sign-in cookies and HTTPS", () => {
  it("is a note of the 13 → 14 changes, once, after the note on workflow field lists and before the endpoint pointer", () => {
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
    expect(ENGLISH_ITEMS[NOTE_INDEX + 1]!.startsWith(LAST_ITEM_START)).toBe(
      true,
    );
  });

  it("names the setting the server reads, which config.example.env ships at a year", () => {
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      expect.arrayContaining([HSTS_SETTING, "config.example.env", "0"]),
    );
    expect(ENGLISH_NOTE).toContain("for a year");
    expect(DEFAULT_HSTS_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(parseHstsMaxAgeSeconds("0")).toBe(0);
    expect(source("packages/Common/Server/EnvironmentConfig.ts")).toContain(
      `process.env["${HSTS_SETTING}"]`,
    );
    expect(source("config.example.env").split("\n")).toContain(
      `${HSTS_SETTING}=${DEFAULT_HSTS_MAX_AGE_SECONDS}`,
    );
  });

  it("names the header the server sends, and says custom domains get none", () => {
    expect(source("packages/Common/Server/Utils/StartServer.ts")).toContain(
      'res.header("Strict-Transport-Security", strictTransportSecurity);',
    );
    expect(
      source("packages/Common/Server/Utils/RequestTransport.ts"),
    ).not.toContain("includeSubDomains;");
    expect(ENGLISH_NOTE).toContain(
      "an installation with `HTTP_PROTOCOL=https` sends `Strict-Transport-Security` for its `HOST`",
    );
    expect(ENGLISH_NOTE).toContain(
      "Status pages and dashboards on custom domains get `Secure` cookies whenever they are served over HTTPS, and no `Strict-Transport-Security`.",
    );
  });

  it("names the header a proxy in front has to send, which the ingress passes on", () => {
    expect(source("packages/Nginx/default.conf.template")).toContain(
      "proxy_set_header X-Forwarded-Proto $visitor_scheme;",
    );
    expect(ENGLISH_NOTE).toContain(
      "Behind your own proxy, check that it sends `X-Forwarded-Proto`",
    );
  });

  it("says what changes for a sign-in over plain HTTP, and that a plain-HTTP installation sees no change", () => {
    expect(ENGLISH_NOTE).toContain(
      "a sign-in over plain HTTP to `HOST` no longer keeps them signed in.",
    );
    expect(ENGLISH_NOTE).toContain(
      "An installation served over plain HTTP (`HTTP_PROTOCOL=http`) sees no change.",
    );
  });

  it("points at the Docker Compose guide's Set up HTTPS", () => {
    expect(linkTargets(ENGLISH_NOTE)).toEqual([
      `/docs/${DOCKER_COMPOSE_PAGE}#${httpsAnchor("en")}`,
    ]);
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on sign-in cookies and HTTPS",
  (language: string) => {
    const note: string = flattened(
      otherChangesItems(language)[NOTE_INDEX] || "",
    );

    it("is in the English note's place, under a lead of its own", () => {
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      expect(
        otherChangesItems(language).filter((item: string): boolean => {
          return item.includes("`Strict-Transport-Security`");
        }),
      ).toHaveLength(1);
    });

    it("carries the English note's code", () => {
      expect(sorted(inlineCode(note))).toEqual(
        sorted(inlineCode(ENGLISH_NOTE)),
      );
    });

    it("points at its own language's Set up HTTPS", () => {
      expect(linkTargets(note)).toEqual([
        `/docs/${DOCKER_COMPOSE_PAGE}#${httpsAnchor(language)}`,
      ]);
    });
  },
);

describe("the Docker Compose guide's Set up HTTPS", () => {
  const english: string = page("en", DOCKER_COMPOSE_PAGE);
  const section: string = english.slice(
    english.indexOf(HTTPS_HEADING),
    english.indexOf("## Production checklist"),
  );

  it("says what HTTP_PROTOCOL=https does to cookies and browsers, for how long, and how to undo it", () => {
    expect(section).toContain(
      "With `HTTP_PROTOCOL=https`, OneUptime builds HTTPS links, keeps sign-in cookies on HTTPS and tells browsers to reach your `HOST` over HTTPS only.",
    );
    expect(section).toContain("A browser keeps to that for a year");
    expect(section).toContain(
      `set \`${HSTS_SETTING}=0\` in \`config.env\` a while before: browsers forget the rule at their next visit.`,
    );
  });

  it("says the proxy examples send X-Forwarded-Proto - and the Nginx one does", () => {
    const nginxExample: string = section.slice(
      section.indexOf('```nginx title="/etc/nginx/conf.d/oneuptime.conf"'),
    );

    expect(nginxExample).toContain(
      "proxy_set_header X-Forwarded-Proto $scheme;",
    );
    expect(section).toContain(
      "Both send `X-Forwarded-Proto`, which tells OneUptime that a visitor came over HTTPS.",
    );
    // After both examples, before the step that opens the instance.
    expect(section.indexOf("Both send `X-Forwarded-Proto`")).toBeGreaterThan(
      section.indexOf("sudo systemctl reload nginx"),
    );
    expect(section.indexOf("Both send `X-Forwarded-Proto`")).toBeLessThan(
      section.indexOf("#### Open your instance through the proxy"),
    );
  });

  it.each(TRANSLATIONS)(
    "%s says it in the same places, with the same code",
    (language: string) => {
      const translated: string = page(language, DOCKER_COMPOSE_PAGE);

      for (const code of [
        `\`${HSTS_SETTING}=0\``,
        "`config.env`",
        "`X-Forwarded-Proto`",
      ]) {
        expect({ code, times: translated.split(code).length - 1 }).toEqual({
          code,
          times: english.split(code).length - 1,
        });
      }

      expect(translated.split("\n").length).toBe(english.split("\n").length);
    },
  );
});
