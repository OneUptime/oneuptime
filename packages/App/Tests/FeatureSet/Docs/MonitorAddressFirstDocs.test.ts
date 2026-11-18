import {
  getMonitorDestinationFieldCopy,
  MONITOR_TYPES_WITH_ADDRESS,
  MonitorDestinationFieldCopy,
} from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorDestinationFieldCopy";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { parseWebsiteAddress } from "Common/Utils/GuidedSetup/WebsiteMonitorRecords";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE PAGE OF EACH MONITOR TYPE OF ONE ADDRESS, AS CREATE MONITOR ASKS IT
 * (#7463, #7985, #7074).
 *
 * Create Monitor asks a Website's, an API's or an SSL certificate's URL, a
 * host to ping, an IP address, a host and its port, or an NTP server right
 * after the type, and the name follows it. Each of these types' pages walks
 * through creating one: in every language its walkthrough asks the address
 * before the name, says the name fills in from it - with the name the form
 * makes of the page's own example - and says Test Monitor starts on a probe
 * the monitor is checked from, and what its result says. The settings that
 * stayed on the Criteria step (a website's More fields, an API's request
 * type, an NTP server's port) are said there, under Monitor Target.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

function readDashboardSource(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SOURCE, file), "utf8");
}

interface AddressPage {
  page: string;
  monitorType: MonitorType;
  // The name the form gives the page's example, in English.
  name: string;
}

const PAGES: ReadonlyArray<AddressPage> = [
  {
    page: "monitor/website-monitor",
    monitorType: MonitorType.Website,
    name: "example.com",
  },
  {
    page: "monitor/api-monitor",
    monitorType: MonitorType.API,
    name: "api.example.com/health",
  },
  {
    page: "monitor/ssl-certificate-monitor",
    monitorType: MonitorType.SSLCertificate,
    name: "example.com",
  },
  {
    page: "monitor/ping-monitor",
    monitorType: MonitorType.Ping,
    name: "example.com",
  },
  {
    page: "monitor/ip-monitor",
    monitorType: MonitorType.IP,
    name: "192.168.1.1",
  },
  {
    page: "monitor/port-monitor",
    monitorType: MonitorType.Port,
    name: "db.example.com:5432",
  },
  {
    page: "monitor/ntp-monitor",
    monitorType: MonitorType.NTP,
    name: "time.example.com",
  },
];

// The pages whose Test Monitor step says how the test starts, besides these.
const TEST_STEP_PAGES: ReadonlyArray<string> = [
  "monitor/dns-monitor",
  "monitor/domain-monitor",
  "monitor/dnssec-monitor",
];

interface Step {
  heading: string;
  body: string;
}

// The steps of a page's first :::steps block: each H3 and what follows it.
function firstSteps(markdown: string): Array<Step> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(":::steps");

  expect(start).toBeGreaterThanOrEqual(0);

  const steps: Array<Step> = [];

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === ":::") {
      break;
    }

    if (line.startsWith("### ")) {
      steps.push({ heading: line, body: "" });
      continue;
    }

    if (steps.length > 0 && line.trim()) {
      const last: Step = steps[steps.length - 1]!;
      last.body = last.body ? `${last.body}\n${line}` : line;
    }
  }

  return steps;
}

function bold(language: string, english: string): string {
  return `**${drawnDashboardLabel(language, english)}**`;
}

function codeItems(text: string): Array<string> {
  return Array.from(text.matchAll(/`([^`]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the pages are the types Create Monitor asks the address of", () => {
  it("one page for each type of one address", () => {
    expect(
      PAGES.map((page: AddressPage): MonitorType => {
        return page.monitorType;
      }).sort(),
    ).toEqual([...MONITOR_TYPES_WITH_ADDRESS].sort());
  });

  it("the address is asked on the first step, before the name", () => {
    const create: string = readDashboardSource("Pages/Monitor/Create.tsx");
    const address: number = create.indexOf(
      '...getMonitorAddressFormFields({ stepId: "monitor-info" }),',
    );

    expect(address).toBeGreaterThan(0);
    // The name field comes after the address fields, on the same step.
    expect(create.indexOf("name: true,", address)).toBeGreaterThan(address);
  });

  it("the name the pages say it fills in is the one the form makes of the example", () => {
    const field: string = readDashboardSource(
      "Components/Form/Monitor/MonitorAddressField.tsx",
    );

    // A website, an API and an SSL certificate are named as the guided setup names them.
    expect(field).toContain(
      "const website: WebsiteAddress | null = parseWebsiteAddress(address);",
    );
    expect(parseWebsiteAddress("https://example.com")!.monitorName).toBe(
      "example.com",
    );
    expect(
      parseWebsiteAddress("https://api.example.com/health")!.monitorName,
    ).toBe("api.example.com/health");

    // Any other by its host, and a Port monitor's with its port.
    expect(field).toContain(
      "const name: string = port ? `${host}:${port.toString()}` : host;",
    );
  });
});

describe.each(PAGES)("$page", (addressPage: AddressPage) => {
  const copy: MonitorDestinationFieldCopy | null =
    getMonitorDestinationFieldCopy(addressPage.monitorType);

  it.each(DOCS_LANGUAGES)(
    "in %s, asks the address after the type and before the name, which fills in from it",
    (language: string) => {
      const steps: Array<Step> = firstSteps(
        readPage(language, addressPage.page),
      );

      expect(copy).not.toBeNull();
      expect(steps.length).toBeGreaterThanOrEqual(4);

      const [start, enter, name, test] = steps as [Step, Step, Step, Step];

      expect(start.body).toContain(bold(language, "Monitor Type"));
      expect(enter.body).toContain(bold(language, copy!.title));
      expect(enter.body).not.toContain(bold(language, "Name"));

      expect(name.body).toContain(bold(language, "Name"));
      expect(name.body).toContain(bold(language, "Next"));
      expect(codeItems(name.body)[0]).toBe(addressPage.name);

      expect(test.body).toContain(bold(language, "Test Monitor"));
      expect(test.body).toContain(bold(language, "Select Probe"));
      expect(test.body).toContain(bold(language, "Run Test"));
      expect(test.body).toContain(bold(language, "Monitor Test Result"));
    },
  );

  it("says it in English as the form does", () => {
    const steps: Array<Step> = firstSteps(readPage("en", addressPage.page));
    const [, enter, name, test] = steps as [Step, Step, Step, Step];

    expect(enter.heading).toMatch(/^### Enter /);
    expect(enter.body).toContain(`In **${copy!.title}**, enter`);
    expect(name.heading).toBe("### Name it");
    expect(name.body).toContain(
      `The **Name** fills in from what you entered, such as \`${addressPage.name}\`. Keep it or enter your own,`,
    );
    expect(test.heading).toBe("### Test it");
    expect(test.body).toContain(
      "Click **Test Monitor**: the test starts on a probe the monitor is checked from. Pick another under **Select Probe** if you like, then click **Run Test**.",
    );
    expect(test.body).toContain(
      "It also says which criteria the answer matches and what would follow: the status, the incident or alert, and who is told.",
    );
  });
});

describe("the settings that stayed on the Criteria step are said there", () => {
  const STAYED: ReadonlyArray<{ page: string; labels: Array<string> }> = [
    { page: "monitor/website-monitor", labels: ["More fields"] },
    {
      page: "monitor/api-monitor",
      labels: [
        "API Request Type",
        "More fields",
        "Request Headers",
        "Request Body (in JSON)",
      ],
    },
    { page: "monitor/ntp-monitor", labels: ["More fields", "Port"] },
  ];

  it("in the step's Monitor Target, which holds them", () => {
    const step: string = readDashboardSource(
      "Components/Form/Monitor/MonitorStep.tsx",
    );

    expect(step).toContain('<Card title="Monitor Target">');
    expect(step).toContain('title={"API Request Type"}');
    expect(step).toContain(
      'description="Redirect, TLS, timeout and retry settings"',
    );
    expect(step).toContain('description="Port, timeout and retry settings"');
  });

  describe.each(STAYED)(
    "$page",
    (stayed: { page: string; labels: Array<string> }) => {
      it.each(DOCS_LANGUAGES)("in %s", (language: string) => {
        const [, enter, , test] = firstSteps(
          readPage(language, stayed.page),
        ) as [Step, Step, Step, Step];

        for (const label of stayed.labels) {
          expect({
            label,
            onFirstStep: enter.body.includes(bold(language, label)),
          }).toEqual({
            label,
            onFirstStep: false,
          });
          expect({
            label,
            onCriteriaStep: test.body.includes(bold(language, label)),
          }).toEqual({
            label,
            onCriteriaStep: true,
          });
        }

        expect(test.body).toContain(bold(language, "Monitor Target"));
      });
    },
  );

  it.each(DOCS_LANGUAGES)(
    "in %s, the website page's More fields are in Monitor Target, not below the URL",
    (language: string) => {
      const page: string = readPage(language, "monitor/website-monitor");
      const heading: string = `### ${drawnDashboardLabel(language, "More fields")}`;
      const lines: Array<string> = page.split("\n");
      const at: number = lines.indexOf(heading);

      expect(at).toBeGreaterThan(0);
      expect(lines[at + 2]).toContain(bold(language, "Monitor Target"));
    },
  );
});

describe.each(TEST_STEP_PAGES)("%s", (page: string) => {
  it("says Test Monitor starts on a probe the monitor is checked from, and what its result says", () => {
    const text: string = readPage("en", page);

    expect(text).not.toContain("pick a probe under **Select Probe** and click");
    expect(text).toContain(
      "Click **Test Monitor**: the test starts on a probe the monitor is checked from. Pick another under **Select Probe** if you like, then click **Run Test**.",
    );
    expect(text).toContain(
      "It also says which criteria the answer matches and what would follow: the status, the incident or alert, and who is told.",
    );
  });
});
