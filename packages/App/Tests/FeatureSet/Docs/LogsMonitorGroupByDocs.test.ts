import { MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES } from "Common/Types/Monitor/MonitorStepLogMonitor";
import { MaxEntitiesPerCriteria } from "Common/Server/Utils/Monitor/PerEntityCriteriaFanOut";
import { MAX_LOG_GROUP_VALUE_LENGTH } from "Common/Server/Services/LogService";
import { parseKeyValuePairs } from "Common/Utils/Log/KeyValueParser";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Drift checks for the "Per-group alerting (Group By)" section of the
 * Logs monitor docs.
 *
 * The section states limits that live in code - how many attributes, how
 * long a value, how many groups per check - and walks through a Sophos
 * IPsec example that only works if the Key=Value Parser really turns
 * that line into the attributes the monitor filters and groups on. Each
 * is read from its source here, so the page cannot quietly go stale.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

const LOGS_MONITOR_PAGE: string = readPage("monitor/logs-monitor.md");

const SECTION: string = ((): string => {
  const start: number = LOGS_MONITOR_PAGE.indexOf(
    "## Per-group alerting (Group By)",
  );
  const end: number = LOGS_MONITOR_PAGE.indexOf("\n## ", start + 1);

  return LOGS_MONITOR_PAGE.slice(start, end === -1 ? undefined : end);
})();

function headingSlugs(markdown: string): Array<string> {
  return Array.from(
    markdown.matchAll(/^#{1,6} (.+)$/gm),
    (match: RegExpMatchArray): string => {
      return slugify(match[1]!);
    },
  );
}

describe("Logs monitor docs - per-group alerting", () => {
  it("has the section", () => {
    expect(SECTION.length).toBeGreaterThan(0);
    expect(SECTION).toContain("### One alert per group");
    expect(SECTION).toContain("### Independent resolution");
  });

  it("states the limits the code enforces", () => {
    expect(SECTION).toContain(
      `Up to ${MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES} attributes`,
    );
    expect(SECTION).toContain(
      `longer than ${MAX_LOG_GROUP_VALUE_LENGTH} characters`,
    );
    expect(SECTION).toContain(`At most **${MaxEntitiesPerCriteria} groups**`);
  });

  it("says where logs missing the attribute go", () => {
    expect(SECTION).toContain("**empty value**");
  });

  it("the Sophos example line parses into what the steps filter and group on", () => {
    const exampleLine: RegExpMatchArray | null = SECTION.match(
      /```text\n([\s\S]*?)\n```/,
    );

    expect(exampleLine).not.toBeNull();

    const pairs: Record<string, string> = parseKeyValuePairs(
      exampleLine![1]!.trim(),
    );

    expect(pairs["log_component"]).toBe("IPSec");
    expect(pairs["con_name"]).toBe("HQ-Branch1");
    expect(pairs["message"]).toContain("terminated");

    // The steps use exactly those keys.
    expect(SECTION).toContain("`log_component` = `IPSec`");
    expect(SECTION).toContain("add `con_name`");
    expect(SECTION).toContain("{{con_name}}");
  });

  it("links to anchors that exist", () => {
    const links: Array<RegExpMatchArray> = Array.from(
      LOGS_MONITOR_PAGE.matchAll(/\]\(\/docs\/([^)#]+)#([^)]+)\)/g),
    );

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const target: string = readPage(`${link[1]}.md`);
      expect(headingSlugs(target)).toContain(link[2]);
    }
  });

  it("is linked from the log pipelines page", () => {
    expect(readPage("telemetry/log-pipelines.md")).toContain(
      "/docs/monitor/logs-monitor#per-group-alerting-group-by",
    );
    expect(headingSlugs(LOGS_MONITOR_PAGE)).toContain(
      "per-group-alerting-group-by",
    );
  });
});
