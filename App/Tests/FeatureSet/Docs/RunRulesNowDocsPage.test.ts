import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  MAX_RULE_RUN_PASSES,
  RULE_RUN_RESOURCES_PER_PASS,
  RULE_RUN_TYPE_METADATA,
  RuleRunAction,
  RuleRunType,
  RuleRunTypeUtil,
} from "Common/Types/Rules/RuleRun";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Registration and drift checks for the "Run Rules on Existing Resources"
 * docs page.
 *
 * The page repeats facts that live in code: which rules can be run, for which
 * resources, and how many resources one run covers. Each of those is read from
 * its home here, so adding a runnable rule or changing the run bounds without
 * updating the page fails this suite instead of leaving the docs quietly wrong.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PAGE_TITLE: string = "Run Rules on Existing Resources";
const PAGE_RELATIVE_PATH: string = "configuration/run-rules-now";
const PAGE_URL: string = `/docs/${PAGE_RELATIVE_PATH}`;

function readPage(): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, "en", `${PAGE_RELATIVE_PATH}.md`),
    "utf8",
  );
}

describe("Run Rules on Existing Resources docs page", () => {
  it("is linked from the Configuration nav group", () => {
    const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
      return candidate.title === "Configuration";
    });

    expect(group).toBeDefined();

    const link: NavLink | undefined = group!.links.find(
      (candidate: NavLink) => {
        return candidate.url === PAGE_URL;
      },
    );

    expect(link?.title).toBe(PAGE_TITLE);
  });

  it("exists in English under the linked path, titled as linked", () => {
    expect(readPage().split("\n")[0]).toBe(`# ${PAGE_TITLE}`);
  });

  it("names every resource a label or owner rule can be run against", () => {
    const page: string = readPage().toLowerCase();

    const resources: Set<string> = new Set<string>();

    for (const ruleType of Object.values(RuleRunType)) {
      const action: RuleRunAction = RuleRunTypeUtil.getAction(ruleType);

      if (
        action === RuleRunAction.AddLabels ||
        action === RuleRunAction.AddOwners
      ) {
        resources.add(RULE_RUN_TYPE_METADATA[ruleType].resourcePlural);
      }
    }

    expect(resources.size).toBe(27);

    for (const resource of resources) {
      expect(page).toContain(resource.toLowerCase());
    }
  });

  it("names every resource a privacy rule can be run against", () => {
    const privacySection: string = readPage()
      .split("\n")
      .find((line: string) => {
        return line.startsWith("- **Privacy Rules**");
      })!
      .toLowerCase();

    for (const ruleType of Object.values(RuleRunType)) {
      if (RuleRunTypeUtil.getAction(ruleType) === RuleRunAction.MarkPrivate) {
        expect(privacySection).toContain(
          RULE_RUN_TYPE_METADATA[ruleType].resourcePlural,
        );
      }
    }
  });

  it("lists as not runnable exactly the rules that cannot be run", () => {
    const page: string = readPage();

    for (const [title, tableName] of [
      ["On-Call Rules", "IncidentOnCallRule"],
      ["Runbook Rules", "RunbookRule"],
      ["Auto-Remediation Rules", "AutoRemediationRule"],
      ["Grouping Rules", "IncidentGroupingRule"],
    ] as Array<[string, string]>) {
      expect(page).toContain(`**${title}**`);
      expect(RuleRunTypeUtil.fromTableName(tableName)).toBeNull();
    }
  });

  it("states the run bound the dashboard actually enforces", () => {
    const bound: string = (
      RULE_RUN_RESOURCES_PER_PASS * MAX_RULE_RUN_PASSES
    ).toLocaleString("en-US");

    expect(readPage()).toContain(`up to ${bound} resources`);
  });

  it("is linked from the incident rules docs", () => {
    const incidentSettings: string = fs.readFileSync(
      path.join(CONTENT_DIR, "en", "incidents", "settings.md"),
      "utf8",
    );

    expect(incidentSettings).toContain(`(${PAGE_URL})`);
  });
});
