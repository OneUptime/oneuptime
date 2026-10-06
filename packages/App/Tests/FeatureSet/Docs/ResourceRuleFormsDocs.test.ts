import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE,
  INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE,
  LABEL_RULE_ADDS_NOTHING_MESSAGE,
  OWNER_RULE_ADDS_NOTHING_MESSAGE,
} from "Common/Utils/Rules/RuleAction";

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

  /*
   * A new rule must add something however it is made: the server refuses
   * one from the API, Terraform, a workflow or an import. The page gives
   * its answers word for word, so a reader who meets one finds it here.
   */
  test("gives the server's answer to a new rule that adds nothing, word for word", () => {
    for (const message of [
      LABEL_RULE_ADDS_NOTHING_MESSAGE,
      INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE,
      OWNER_RULE_ADDS_NOTHING_MESSAGE,
      INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE,
    ]) {
      expect({ message, present: content.includes(`| ${message} |`) }).toEqual(
        { message, present: true },
      );
    }

    expect(content).toContain("### However the rule is made");
    expect(content).toMatch(
      /through the API, Terraform, a workflow or a \[label rule import\]/,
    );
    expect(content).toContain("terraform apply");
    expect(content).toContain("labels_to_add");
  });

  test("names a rule that only inherits after its switches", () => {
    expect(content).toContain("_Inherit labels from monitors_");
    expect(content).toContain("_Inherit labels from monitors, hosts_");
    expect(content).toContain("_Inherit labels from monitor_");
    expect(content).toContain(
      "is named after what it inherits from instead (see below)",
    );
  });

  test("still lets an edit empty a rule, as decided", () => {
    expect(content).toContain(
      "an edit may take away everything a rule adds",
    );
    expect(content).not.toContain("before the form asked");
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

describe("the label rule import docs", () => {
  const content: string = read("en", "configuration/label-rule-import-export");

  test("say a rule that adds nothing stops the batch before it is imported", () => {
    expect(content).toContain(
      "So does a rule that adds nothing — an empty `labelsToAdd`",
    );
    expect(content).toContain(
      "](/docs/configuration/label-and-owner-rules#however-the-rule-is-made)",
    );
  });
});

describe.each(LANGUAGES)(
  "%s incident pages on a rule that only inherits",
  (language: string) => {
    test("the incident settings page names it after what it inherits from", () => {
      const section: string = sectionOf(
        read(language, "incidents/settings"),
        INCIDENT_RULES_HEADING[language] as string,
      );

      expect(section).toContain("_Inherit labels from monitors, hosts_");
      expect(section).toContain("Terraform");
    });

    test("the owners page names it after its switches", () => {
      expect(read(language, "incidents/notes-owners-and-feed")).toContain(
        "_Inherit owners from monitors_",
      );
    });
  },
);
