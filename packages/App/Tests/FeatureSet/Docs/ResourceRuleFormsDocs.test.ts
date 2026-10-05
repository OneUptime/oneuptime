import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";

/*
 * Every label and owner rule is created in two steps - Match, then Labels
 * or Owners - where what a new rule adds is required and its name is filled
 * in from it, and the description (and Notify Owners) waits under More
 * fields (Dashboard Utils/Form/ResourceRuleForm). An incident, alert or
 * scheduled maintenance rule folds its inherit switches under Inherit
 * Labels / Inherit Owners on that step. An Edit form asks for nothing the
 * rule adds, and the list marks a rule that adds nothing "Adds nothing".
 *
 * The pages that describe those forms say so, in English and in Persian,
 * the two languages that describe them: nobody is sent looking for a Basic
 * Info step or an Inherit step, or told a rule's labels are optional.
 */

const CONTENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

const PAGES: Array<string> = ["slo/label-and-owner-rules", "rum/applications"];

const GENERAL_PAGE: string = "configuration/label-and-owner-rules";
const GENERAL_PAGE_URL: string = `/docs/${GENERAL_PAGE}`;

// The pages of the products that moved to the shared form in this sweep.
const EVENT_PAGES: Array<string> = [
  "incidents/settings",
  "incidents/notes-owners-and-feed",
  "status-pages/index",
];

const LANGUAGES: Array<string> = ["en", "fa"];

// The incident settings page's section on label and owner rules.
const INCIDENT_RULES_HEADING: Record<string, string> = {
  en: "## Incident label and owner rules",
  fa: "## قواعد برچسب و مالکیت حادثه",
};

// A "## " section of a page: from its heading to the next one.
function sectionOf(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`${heading}\n`);

  expect(start).toBeGreaterThan(-1);

  const end: number = markdown.indexOf("\n## ", start + heading.length);

  return markdown.slice(start, end === -1 ? undefined : end);
}

describe.each(LANGUAGES)(
  "%s docs of label and owner rules",
  (language: string) => {
    test.each(PAGES)(
      "%s names the steps and what is filled in",
      (page: string) => {
        const content: string = read(language, page);

        expect(content).toContain("**Match**");
        expect(content).toContain("**Labels**");
        expect(content).toContain("**Name**");
        expect(content).toContain("**More fields**");
        expect(content).not.toContain("Basic Info");
      },
    );

    test("the SLO page says what the name is filled in from, for both kinds", () => {
      const content: string = read(language, "slo/label-and-owner-rules");

      expect(content).toContain("_Add Checkout, Production_");
      expect(content).toContain("_Add Checkout team as owners_");
      expect(content).toMatch(
        /\*\*Notify Owners\*\* \([^)]*\*\*More fields\*\*/,
      );
    });

    test.each(PAGES)(
      "%s says the list marks a rule that adds nothing",
      (page: string) => {
        expect(read(language, page)).toContain("**Adds nothing**");
      },
    );

    test.each(EVENT_PAGES)(
      "%s describes the two steps, never Basic Info or an Inherit step, and links the form's page",
      (page: string) => {
        /*
         * The incident settings page describes other rules too - the on-call
         * rules' form still opens on Basic Info - so its label and owner
         * rules section is read on its own.
         */
        const content: string =
          page === "incidents/settings"
            ? sectionOf(
                read(language, page),
                INCIDENT_RULES_HEADING[language] as string,
              )
            : read(language, page);

        expect(content).toContain("**Match**");
        expect(content).toContain("**Adds nothing**");
        expect(content).toContain(`](${GENERAL_PAGE_URL})`);
        expect(content).not.toContain("**Basic Info**");
        expect(content).not.toContain("**Match Criteria**, **Owners**");
        expect(content).not.toMatch(
          /\*\*Owners\*\* and \*\*Inherit Owners\*\*/,
        );
      },
    );

    test("the incident pages fold the inherit switches under the picker", () => {
      expect(read(language, "incidents/settings")).toContain(
        "**Inherit Labels**",
      );
      expect(read(language, "incidents/settings")).toContain(
        "**Inherit Owners**",
      );
      expect(read(language, "incidents/notes-owners-and-feed")).toMatch(
        /^- \*\*Inherit Owners\*\*[^—\n]*\*\*Owners\*\*/m,
      );
    });
  },
);

describe("the English docs of label and owner rules", () => {
  test("say a new rule has to add at least one", () => {
    for (const page of PAGES) {
      expect(read("en", page)).toMatch(/has to add at least one/);
    }
  });

  test("no longer list a name and description before what the rule matches", () => {
    const content: string = read("en", "slo/label-and-owner-rules");

    expect(content).not.toContain(
      "A label rule has a name, an optional description, its match criteria",
    );
    expect(content).not.toContain(
      "An owner rule has a name, an optional description, whether to **Notify Owners**",
    );
  });

  test("the incident owner rules have two steps, not four", () => {
    const content: string = read("en", "incidents/notes-owners-and-feed");

    expect(content).toContain(
      "The rule form has two steps — **Match**, the conditions an incident must meet, then **Owners**",
    );
    expect(content).not.toContain("four steps");
    // The Owners line the owners picker docs pin stays as it is.
    expect(content).toContain(
      "- **Owners** — **Add owner** opens one list of people and teams",
    );
  });
});

describe("the Label and Owner Rules page", () => {
  const content: string = read("en", GENERAL_PAGE);

  test("is in the Configuration nav, titled as the page", () => {
    const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
      return candidate.title === "Configuration";
    });

    expect(group).toBeDefined();

    const link: NavLink | undefined = group!.links.find(
      (candidate: NavLink): boolean => {
        return candidate.url === GENERAL_PAGE_URL;
      },
    );

    expect(link?.title).toBe("Label and Owner Rules");
    expect(content.split("\n")[0]).toBe("# Label and Owner Rules");
  });

  test("walks the two steps, and what is filled in and folded", () => {
    for (const text of [
      "**Match**",
      "**Labels**",
      "**Owners**",
      "**Labels to Add**",
      "**Add owner**",
      "**Name**",
      "**More fields**",
      "**Notify Owners**",
      "**Enabled**",
    ]) {
      expect({ text, present: content.includes(text) }).toEqual({
        text,
        present: true,
      });
    }

    expect(content).not.toContain("Basic Info");
    expect(content).toMatch(/A new rule has to add something/);
  });

  test("names the inherit fold and its six switches", () => {
    for (const text of [
      "**Inherit Labels**",
      "**Inherit Owners**",
      "**Inherit Labels From Monitors**",
      "**Inherit Labels From Monitor**",
      "**Inherit Labels From Hosts**",
      "**… From Kubernetes Clusters**",
      "**… From Docker Hosts**",
      "**… From Podman Hosts**",
      "**… From Services**",
      "**Inherit Owners From Monitors**",
    ]) {
      expect({ text, present: content.includes(text) }).toEqual({
        text,
        present: true,
      });
    }

    expect(content).toContain("Episode rules have no inherit switches");
  });

  test("says what editing does for a rule that adds nothing", () => {
    expect(content).toContain("**Adds nothing**");
    expect(content).toMatch(/can still be renamed, switched off or deleted/);
  });

  test("lists every product with label and owner rules", () => {
    for (const product of [
      "monitors",
      "incidents and incident episodes",
      "alerts and alert episodes",
      "scheduled maintenance events",
      "status pages",
      "network devices and SLOs",
    ]) {
      expect({ product, present: content.includes(product) }).toEqual({
        product,
        present: true,
      });
    }
  });

  test("links only pages that exist", () => {
    const links: Array<string> = Array.from(
      content.matchAll(/\]\((\/docs\/[^)#]+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const relative: string = link.slice("/docs/".length);

      expect({
        link,
        exists: fs.existsSync(path.join(CONTENT_DIR, "en", `${relative}.md`)),
      }).toEqual({ link, exists: true });
    }
  });
});
