import slugify from "Common/Server/Types/MarkdownSlugify";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Default Criteria" sections of the Website, API, SSL Certificate,
 * Domain and NTP monitor pages, against the criteria a new monitor actually
 * starts with (MonitorCriteria.getDefaultMonitorCriteria).
 *
 * Markdown is not compiled, so nothing else notices when a default these
 * pages quote moves - a status code range, a number of days, the order the
 * criteria are checked in, or the title of the incident or alert a reader
 * is told to expect.
 */

const DOCS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en/monitor",
);

function readPage(fileName: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, fileName), "utf8");
}

/*
 * The text under `heading` up to the next heading of the same or a higher
 * level.
 */
function sectionOf(page: string, heading: string): string {
  const start: number = page.indexOf(`${heading}\n`);

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = heading.indexOf(" ");
  const rest: string = page.slice(start + heading.length + 1);
  const nextHeading: RegExpMatchArray | null = rest.match(
    new RegExp(`^#{1,${level}} `, "m"),
  );

  return nextHeading && nextHeading.index !== undefined
    ? rest.slice(0, nextHeading.index)
    : rest;
}

// A `#` line inside a fenced block is a comment, not a heading.
const HEADING: RegExp = /^#{1,6} /;
const FENCE: RegExp = /^\s*```/;

function headingSlugs(markdown: string): Array<string> {
  let inFence: boolean = false;

  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return false;
      }

      return !inFence && HEADING.test(line);
    })
    .map((line: string): string => {
      return slugify(line.replace(/^#+ /, "").trim());
    });
}

const MONITOR_NAME: string = "Acme";

function defaultCriteriaFor(
  monitorType: MonitorType,
): Array<MonitorCriteriaInstance> {
  return (
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: monitorType,
      monitorName: MONITOR_NAME,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      warningAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || []
  );
}

// An incident or alert title as the page writes it: "_monitor name_ ...".
function asDocumented(title: string): string {
  return title.replace(MONITOR_NAME, "_monitor name_");
}

const DEFAULT_CRITERIA_HEADING: string = "### Default Criteria";

const PAGES: Array<{ fileName: string; monitorType: MonitorType }> = [
  { fileName: "website-monitor.md", monitorType: MonitorType.Website },
  { fileName: "api-monitor.md", monitorType: MonitorType.API },
  {
    fileName: "ssl-certificate-monitor.md",
    monitorType: MonitorType.SSLCertificate,
  },
  { fileName: "domain-monitor.md", monitorType: MonitorType.Domain },
  { fileName: "ntp-monitor.md", monitorType: MonitorType.NTP },
];

describe("Every page describes the criteria a new monitor starts with", () => {
  test.each(PAGES)(
    "$fileName has a Default Criteria section under Monitoring Criteria",
    ({ fileName }: { fileName: string }) => {
      const page: string = readPage(fileName);
      const criteriaSection: string = sectionOf(page, "## Monitoring Criteria");

      expect(criteriaSection).toContain(`${DEFAULT_CRITERIA_HEADING}\n`);
    },
  );

  test.each(PAGES)(
    "$fileName names as many default criteria as a new monitor gets",
    ({
      fileName,
      monitorType,
    }: {
      fileName: string;
      monitorType: MonitorType;
    }) => {
      const section: string = sectionOf(
        readPage(fileName),
        DEFAULT_CRITERIA_HEADING,
      );

      // Each criteria is one bullet or numbered item led by its bold name.
      const items: Array<string> = Array.from(
        section.matchAll(/^(?:- |\d+\. )\*\*([^*]+)\*\* —/gm),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(items).toHaveLength(defaultCriteriaFor(monitorType).length);
    },
  );

  test.each(PAGES)(
    "$fileName says the first criteria that matches decides",
    ({ fileName }: { fileName: string }) => {
      expect(sectionOf(readPage(fileName), DEFAULT_CRITERIA_HEADING)).toContain(
        "the first one that matches decides what happens",
      );
    },
  );

  test.each(PAGES)(
    "every in-page link on $fileName resolves to a heading",
    ({ fileName }: { fileName: string }) => {
      const page: string = readPage(fileName);
      const slugs: Array<string> = headingSlugs(page);

      for (const match of page.matchAll(/\]\(#([^)]+)\)/g)) {
        expect({ anchor: match[1], found: slugs.includes(match[1]!) }).toEqual({
          anchor: match[1],
          found: true,
        });
      }
    },
  );
});

describe("Website and API monitors: any 2xx or 3xx answer is up", () => {
  test.each(["website-monitor.md", "api-monitor.md"])(
    "%s quotes the healthy status range the criteria use",
    (fileName: string) => {
      const section: string = sectionOf(
        readPage(fileName),
        DEFAULT_CRITERIA_HEADING,
      );

      expect(section).toContain(
        `a status code of \`${MonitorCriteriaInstance.DEFAULT_HEALTHY_STATUS_CODE_BELOW}\` or above (or below \`${MonitorCriteriaInstance.DEFAULT_HEALTHY_STATUS_CODE_FROM}\`)`,
      );
      expect(section).toContain("any `2xx` or `3xx` status code");
    },
  );

  test.each(["website-monitor.md", "api-monitor.md"])(
    "%s points Do Not Follow Redirects at the defaults",
    (fileName: string) => {
      expect(
        sectionOf(readPage(fileName), "#### Do Not Follow Redirects"),
      ).toContain("[default criteria](#default-criteria)");
    },
  );

  test.each(["website-monitor.md", "api-monitor.md"])(
    "%s says what changes for monitors created earlier",
    (fileName: string) => {
      expect(sectionOf(readPage(fileName), DEFAULT_CRITERIA_HEADING)).toContain(
        "which count only `200` as online",
      );
    },
  );
});

describe("SSL Certificate and Domain monitors warn before expiry", () => {
  const EXPIRY_PAGES: Array<{
    fileName: string;
    monitorType: MonitorType;
    days: number;
  }> = [
    {
      fileName: "ssl-certificate-monitor.md",
      monitorType: MonitorType.SSLCertificate,
      days: MonitorCriteriaInstance.DEFAULT_SSL_CERTIFICATE_EXPIRY_WARNING_DAYS,
    },
    {
      fileName: "domain-monitor.md",
      monitorType: MonitorType.Domain,
      days: MonitorCriteriaInstance.DEFAULT_DOMAIN_EXPIRY_WARNING_DAYS,
    },
  ];

  test.each(EXPIRY_PAGES)(
    "$fileName quotes the warning period the criteria use",
    ({ fileName, days }: { fileName: string; days: number }) => {
      const section: string = sectionOf(
        readPage(fileName),
        DEFAULT_CRITERIA_HEADING,
      );

      expect(section).toContain(`expires in ${days} days or less`);
      // The "how to add it to an older monitor" recipe uses the same number.
      expect(section).toContain(`**Less Than or Equal To** / \`${days}\``);
    },
  );

  test.each(EXPIRY_PAGES)(
    "$fileName names the alert a reader will see, exactly as it is created",
    ({
      fileName,
      monitorType,
    }: {
      fileName: string;
      monitorType: MonitorType;
    }) => {
      const warning: MonitorCriteriaInstance =
        defaultCriteriaFor(monitorType)[1]!;

      expect(warning.data!.createAlerts).toBe(true);

      expect(sectionOf(readPage(fileName), DEFAULT_CRITERIA_HEADING)).toContain(
        `"${asDocumented(warning.data!.alerts[0]!.title)}"`,
      );
    },
  );

  test.each(EXPIRY_PAGES)(
    "$fileName says the warning is an alert that pages nobody and leaves the status alone",
    ({
      fileName,
      monitorType,
    }: {
      fileName: string;
      monitorType: MonitorType;
    }) => {
      const warning: MonitorCriteriaInstance =
        defaultCriteriaFor(monitorType)[1]!;

      // What the page promises...
      const section: string = sectionOf(
        readPage(fileName),
        DEFAULT_CRITERIA_HEADING,
      );

      expect(section).toContain("is an alert, not an incident");
      expect(section).toContain(
        "it pages nobody unless you add an on-call policy to it",
      );
      expect(section).toContain("it does not change the monitor's status");
      expect(section).toContain("the alert resolves itself");

      // ...is what the criteria does.
      expect(warning.data!.createIncidents).toBe(false);
      expect(warning.data!.changeMonitorStatus).toBe(false);
      expect(warning.data!.alerts[0]!.onCallPolicyIds).toEqual([]);
      expect(warning.data!.alerts[0]!.autoResolveAlert).toBe(true);
    },
  );

  test.each(EXPIRY_PAGES)(
    "$fileName lists the criteria in the order they are checked",
    ({
      fileName,
      monitorType,
    }: {
      fileName: string;
      monitorType: MonitorType;
    }) => {
      const section: string = sectionOf(
        readPage(fileName),
        DEFAULT_CRITERIA_HEADING,
      );

      const listed: Array<string> = Array.from(
        section.matchAll(/^\d+\. \*\*([^*]+)\*\* —/gm),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!.toLowerCase();
      });

      const seeded: Array<string> = defaultCriteriaFor(monitorType).map(
        (instance: MonitorCriteriaInstance): string => {
          return instance.data!.name.toLowerCase();
        },
      );

      expect(listed).toHaveLength(3);

      /*
       * "Certificate is not valid" is listed for "Check if Acme certificate
       * is not valid", and so on: each listed name is the end of the seeded
       * one.
       */
      listed.forEach((name: string, index: number) => {
        expect({ listed: name, seeded: seeded[index] }).toEqual({
          listed: name,
          seeded: expect.stringContaining(
            name.replace(/^(certificate|domain) /, ""),
          ),
        });
      });
    },
  );

  test("the SSL page names the incident an invalid certificate opens", () => {
    const offline: MonitorCriteriaInstance = defaultCriteriaFor(
      MonitorType.SSLCertificate,
    )[0]!;

    expect(
      sectionOf(
        readPage("ssl-certificate-monitor.md"),
        DEFAULT_CRITERIA_HEADING,
      ),
    ).toContain(`"${asDocumented(offline.data!.incidents[0]!.title)}"`);
  });

  test("the SSL page's opening promise is kept by the defaults", () => {
    expect(readPage("ssl-certificate-monitor.md")).toContain(
      "alerts you before they expire",
    );
    expect(
      defaultCriteriaFor(MonitorType.SSLCertificate).some(
        (instance: MonitorCriteriaInstance): boolean => {
          return instance.data!.name.includes("expires soon");
        },
      ),
    ).toBe(true);
  });

  test("the Domain page's opening promise is kept by the defaults", () => {
    expect(readPage("domain-monitor.md")).toContain(
      "alert you before it expires",
    );
    expect(
      defaultCriteriaFor(MonitorType.Domain).some(
        (instance: MonitorCriteriaInstance): boolean => {
          return instance.data!.name.includes("expires soon");
        },
      ),
    ).toBe(true);
  });

  test.each(EXPIRY_PAGES)(
    "$fileName no longer recommends thresholds that contradict the default warning",
    ({ fileName }: { fileName: string }) => {
      const bestPractices: string = sectionOf(
        readPage(fileName),
        "## Best Practices",
      );

      expect(bestPractices).toContain("The default warning comes");
      expect(bestPractices).not.toContain("degraded");
    },
  );
});
