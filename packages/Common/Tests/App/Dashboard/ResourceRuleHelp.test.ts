import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getLabelRuleHelpMarkdown,
  getOwnerRuleHelpMarkdown,
  RULE_HELP_MATCH_CRITERIA_HEADING,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Help/ResourceRuleHelp";
import readHelpDocument, {
  HelpDocument,
  HelpSection,
} from "../../../UI/Components/Help/HelpDocument";
import {
  RULE_CRITERIA_HELP_SECTION_BODY,
  replaceRuleCriteriaHelpMarkdown,
} from "../../../UI/Components/RuleCriteria/RuleCriteriaModelTable";

/*
 * The help of every resource's label rules and owner rules (#8889), written
 * once (Dashboard Utils/Help/ResourceRuleHelp) where fifty pages each kept a
 * copy that said a little less: none said a rule runs only as a resource is
 * added, or how to reach the ones you already have.
 */

const HOSTS: { singular: string; plural: string } = {
  singular: "host",
  plural: "hosts",
};

const titlesOf: (document: HelpDocument) => Array<string> = (
  document: HelpDocument,
): Array<string> => {
  return document.sections.map((section: HelpSection): string => {
    return section.title;
  });
};

const sectionOf: (document: HelpDocument, title: string) => string = (
  document: HelpDocument,
  title: string,
): string => {
  return (
    document.sections.find((section: HelpSection): boolean => {
      return section.title === title;
    })?.markdown || ""
  );
};

describe("a label rule's help", () => {
  const markdown: string = getLabelRuleHelpMarkdown({ nouns: HOSTS });
  const document: HelpDocument = readHelpDocument(markdown);

  test("says in short what a rule does, then how it works and what it matches", () => {
    expect(document.summary).toBe(
      "A label rule adds labels to every host it matches, so each new host is labelled without anyone having to remember.",
    );
    expect(titlesOf(document)).toEqual(["How It Works", "Match Criteria"]);
  });

  test("says when a rule runs, how to reach what already exists, and that it only adds", () => {
    const howItWorks: string = sectionOf(document, "How It Works");

    expect(howItWorks).toContain("runs as each new host is added");
    expect(howItWorks).toContain("**Run Now**");
    expect(howItWorks).toContain("Labels are only ever added");
    expect(howItWorks).toContain("labels of every one of them");
    expect(howItWorks).toContain("A disabled rule does not run.");
    expect(howItWorks).toContain("Label rules run before owner rules");
  });

  test("names the resource in its own words, and no column's jargon", () => {
    expect(
      getLabelRuleHelpMarkdown({
        nouns: {
          singular: "Kubernetes cluster",
          plural: "Kubernetes clusters",
        },
      }),
    ).toContain("To label the Kubernetes clusters you already have");
    expect(markdown).not.toMatch(/any-of|M2M|prerequisite|Labels to Add/);
  });
});

describe("an owner rule's help", () => {
  const markdown: string = getOwnerRuleHelpMarkdown({ nouns: HOSTS });
  const document: HelpDocument = readHelpDocument(markdown);

  test("says in short what a rule does, then how it works, what it matches and who is told", () => {
    expect(document.summary).toBe(
      "An owner rule makes people and teams owners of every host it matches, so each new host has someone responsible for it from the start.",
    );
    expect(titlesOf(document)).toEqual([
      "How It Works",
      "Match Criteria",
      "Telling the New Owners",
    ]);
  });

  test("says Run Now asks whether to tell the owners it adds", () => {
    const howItWorks: string = sectionOf(document, "How It Works");

    expect(howItWorks).toContain("To add owners to the hosts you already have");
    expect(howItWorks).toContain(
      "You choose there whether the people it adds are told.",
    );
    expect(howItWorks).toContain("Owners are only ever added");
  });

  test("names Notify Owners where the form keeps it, and that it starts on", () => {
    const telling: string = sectionOf(document, "Telling the New Owners");

    expect(telling).toContain("**Notify Owners**");
    expect(telling).toContain("**More fields**");
    expect(telling).toContain("It is on for a new rule");
  });
});

describe("a page's own topics", () => {
  test("come after the shared ones, each a topic of its own", () => {
    const document: HelpDocument = readHelpDocument(
      getOwnerRuleHelpMarkdown({
        nouns: { singular: "queue", plural: "queues" },
        topics: [
          {
            topic: "Matching Discovered Queues",
            markdown: "\nNamed after their destination.\n",
          },
        ],
      }),
    );

    expect(titlesOf(document)).toEqual([
      "How It Works",
      "Match Criteria",
      "Telling the New Owners",
      "Matching Discovered Queues",
    ]);
    expect(sectionOf(document, "Matching Discovered Queues")).toBe(
      "Named after their destination.",
    );
  });
});

describe("the Match Criteria topic", () => {
  test.each([
    ["label", getLabelRuleHelpMarkdown({ nouns: HOSTS })],
    ["owner", getOwnerRuleHelpMarkdown({ nouns: HOSTS })],
  ])(
    "of a %s rule is the one the table rewrites for its own conditions, and only it",
    (_kind: string, markdown: string) => {
      expect(markdown).toContain(`${RULE_HELP_MATCH_CRITERIA_HEADING}\n`);

      const rewritten: string = replaceRuleCriteriaHelpMarkdown(markdown);
      const document: HelpDocument = readHelpDocument(rewritten);

      expect(rewritten).not.toBe(markdown);
      expect(sectionOf(document, "Match Criteria")).toBe(
        RULE_CRITERIA_HELP_SECTION_BODY,
      );
      expect(sectionOf(document, "How It Works")).toBe(
        sectionOf(readHelpDocument(markdown), "How It Works"),
      );
    },
  );
});

describe("every resource's rule pages", () => {
  const PAGES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Pages",
  );

  /*
   * The resources whose label and owner rules are the shared kind: a
   * LabelRuleTable or RuleTable of label or owner rules, with help. The
   * incident, alert and maintenance rules inherit labels and have help of
   * their own.
   */
  const RESOURCE_RULE_PAGES: Array<string> = [
    // The five that had no help at all until #8889.
    "AppPlatforms/Settings/LabelRules.tsx",
    "AppPlatforms/Settings/OwnerRules.tsx",
    "Cloud/Settings/LabelRules.tsx",
    "Cloud/Settings/OwnerRules.tsx",
    "DataSecurity/Settings/LabelRules.tsx",
    "DataSecurity/Settings/OwnerRules.tsx",
    "Rum/Settings/LabelRules.tsx",
    "Rum/Settings/OwnerRules.tsx",
    "Serverless/Settings/LabelRules.tsx",
    "Serverless/Settings/OwnerRules.tsx",
    "Ceph/Settings/LabelRules.tsx",
    "Ceph/Settings/OwnerRules.tsx",
    "Dashboards/Settings/LabelRules.tsx",
    "Dashboards/Settings/OwnerRules.tsx",
    "Database/Settings/LabelRules.tsx",
    "Database/Settings/OwnerRules.tsx",
    "Docker/Settings/LabelRules.tsx",
    "Docker/Settings/OwnerRules.tsx",
    "DockerSwarm/Settings/LabelRules.tsx",
    "DockerSwarm/Settings/OwnerRules.tsx",
    "Host/Settings/LabelRules.tsx",
    "Host/Settings/OwnerRules.tsx",
    "IoT/Settings/LabelRules.tsx",
    "IoT/Settings/OwnerRules.tsx",
    "Kubernetes/Settings/LabelRules.tsx",
    "Kubernetes/Settings/OwnerRules.tsx",
    "MessageQueue/Settings/LabelRules.tsx",
    "MessageQueue/Settings/OwnerRules.tsx",
    "Monitor/Settings/MonitorLabelRules.tsx",
    "Monitor/Settings/MonitorOwnerRules.tsx",
    "NetworkDevice/Settings/LabelRules.tsx",
    "NetworkDevice/Settings/OwnerRules.tsx",
    "OnCallDuty/Settings/LabelRules.tsx",
    "OnCallDuty/Settings/OwnerRules.tsx",
    "OpenStack/Settings/LabelRules.tsx",
    "OpenStack/Settings/OwnerRules.tsx",
    "Podman/Settings/LabelRules.tsx",
    "Podman/Settings/OwnerRules.tsx",
    "Proxmox/Settings/LabelRules.tsx",
    "Proxmox/Settings/OwnerRules.tsx",
    "Runbook/Settings/LabelRules.tsx",
    "Runbook/Settings/OwnerRules.tsx",
    "Service/Settings/LabelRules.tsx",
    "Service/Settings/OwnerRules.tsx",
    "Slo/Settings/LabelRules.tsx",
    "Slo/Settings/OwnerRules.tsx",
    "StatusPages/Settings/StatusPageLabelRules.tsx",
    "StatusPages/Settings/StatusPageOwnerRules.tsx",
    "StorageArray/Settings/LabelRules.tsx",
    "StorageArray/Settings/OwnerRules.tsx",
    "VMware/Settings/LabelRules.tsx",
    "VMware/Settings/OwnerRules.tsx",
    "Workflow/Settings/LabelRules.tsx",
    "Workflow/Settings/OwnerRules.tsx",
  ];

  test.each(RESOURCE_RULE_PAGES)(
    "%s writes its help with the shared helper, never a copy of its own",
    (page: string) => {
      const source: string = fs.readFileSync(path.join(PAGES, page), "utf8");
      const helper: string = page.includes("Owner")
        ? "getOwnerRuleHelpMarkdown({"
        : "getLabelRuleHelpMarkdown({";

      expect(source).toContain(helper);
      expect(source).toContain("helpContent={{");
      // No help text of its own: no heading written on the page.
      expect(source).not.toMatch(/^#{2,3} (How|Match Criteria|Action)/m);
    },
  );
});
