import { SECURITY_GETTING_STARTED } from "./AiObservabilityDocsPages";
import { readPage } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  ENRICH_NEW_CASES_TEMPLATE_KEY,
  getSecurityPlaybookTemplateDefinition,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookTemplates";
import {
  SECURITY_LOG_FORMATS,
  SecurityLogFormatDefinition,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import {
  SETUP_TEST_EVENT_COUNT,
  SETUP_TEST_SOURCE_IP,
} from "Common/Types/SecurityEvent/SecuritySetupTest";
import {
  TURN_ON_RECOMMENDED_REASONS,
  TurnOnRecommendedReason,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import {
  GOOGLE_SECOPS_DESTINATION_DOCS_PATH,
  SecurityEventDestinationCatalog,
  SecurityEventDestinationDefinition,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import {
  SECURITY_EVENT_DESTINATION_SCOPES,
  SecurityEventDestinationScopeOption,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import {
  UDM_PRODUCT_NAME_FALLBACK,
  UdmEventType,
} from "Common/Utils/SecurityEvent/Destinations/GoogleSecOpsUdmMapper";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What Get Started with Security and the Google SecOps page's "Send
 * security events to Google SecOps" say, held to the code that does it: the
 * one click and what it turns on, the test attack, the log formats Your
 * logs recognizes, how often it reads, and what a SIEM destination sends,
 * how it tests and when it stops. The translations are held to these
 * English pages by AiToolingAndSecurityDocsTranslations and
 * IntegrationsDocsTranslations.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

function source(relative: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function section(page: string, heading: string): string {
  const start: number = page.indexOf(`\n## ${heading}\n`);
  const end: number = page.indexOf("\n## ", start + 1);

  expect(start).toBeGreaterThan(-1);

  return page.slice(start, end === -1 ? undefined : end);
}

describe("Get Started with Security", () => {
  const page: string = readPage("en", SECURITY_GETTING_STARTED);

  it("names the buttons as the Overview draws them", () => {
    const gettingStarted: string = source(
      `${DASHBOARD}/Components/SecurityOverview/SecurityGettingStarted.tsx`,
    );
    const test: string = source(
      `${DASHBOARD}/Components/SecurityOverview/SecuritySetupTest.tsx`,
    );
    const quiet: string = source(
      `${DASHBOARD}/Components/SecurityOverview/SecurityAllQuiet.tsx`,
    );

    expect(gettingStarted).toContain('title="Turn on recommended"');
    expect(test).toContain('title="Send a test attack"');
    expect(test).toContain('translator.translateText("Open the case")');
    expect(quiet).toContain('translator.translateText("All quiet")');

    for (const label of [
      "Turn on recommended",
      "Send a test attack",
      "Open the case",
      "All quiet",
    ]) {
      expect(page).toContain(`**${label}**`);
    }
  });

  it("turns on your logs, the recommended rules and Enrich New Cases in one click", () => {
    const api: string = flat(
      source(`${DASHBOARD}/Components/SecurityCase/SecurityCaseApi.ts`),
    );

    expect(api).toContain("logs: options.logs !== false,");
    expect(api).toContain("detections: options.detections !== false,");
    expect(api).toContain("playbook: options.playbook !== false,");
    expect(
      getSecurityPlaybookTemplateDefinition(ENRICH_NEW_CASES_TEMPLATE_KEY)
        ?.title,
    ).toBe("Enrich New Cases");
    expect(page).toContain(
      "It turns on three things at once: **Find security events in your logs**, the recommended detection rules, and **Enrich New Cases**",
    );
  });

  it("says what the one click does when it cannot turn everything on: names it with why, and Try again does only what is missing", () => {
    const gettingStarted: string = flat(
      source(
        `${DASHBOARD}/Components/SecurityOverview/SecurityGettingStarted.tsx`,
      ),
    );
    const setup: string = flat(
      source("packages/Common/Server/Utils/SecurityEvent/SecuritySetup.ts"),
    );
    const troubleshooting: string = flat(section(page, "Troubleshooting"));

    // The card's own button and words.
    expect(gettingStarted).toContain('title="Try again"');
    expect(gettingStarted).toContain(
      '"Everything else is on. Try again turns on only what is still missing."',
    );
    expect(page).toContain("**Try again**");
    expect(troubleshooting).toContain(
      ":::details Turn on recommended could not turn everything on",
    );
    expect(troubleshooting).toContain("Everything else is on.");
    expect(troubleshooting).toContain(
      "click **Try again**: it turns on only what is still missing, and adds nothing twice.",
    );

    // The reasons it names are the ones the server answers with.
    expect(TURN_ON_RECOMMENDED_REASONS).toEqual([
      TurnOnRecommendedReason.NotAllowed,
      TurnOnRecommendedReason.Plan,
      TurnOnRecommendedReason.Refused,
      TurnOnRecommendedReason.Failed,
    ]);
    expect(troubleshooting).toContain(
      "and why: your role, your plan, or something that went wrong on OneUptime's side.",
    );
    // Each part on its own, the rest still done: what lets "everything else is on" be said.
    expect(setup).toContain("this.recordProblem(");
    expect(setup).toContain("problems: [],");
  });

  it("sends a dozen failed sign-ins from one documentation address, and pages nobody", () => {
    const setup: string = flat(
      source("packages/Common/Server/Utils/SecurityEvent/SecuritySetup.ts"),
    );
    const evaluator: string = flat(
      source(
        "packages/Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator.ts",
      ),
    );

    expect(SETUP_TEST_EVENT_COUNT).toBe(12);
    // 203.0.113.0/24 is TEST-NET-3, kept for documentation (RFC 5737).
    expect(SETUP_TEST_SOURCE_IP.startsWith("203.0.113.")).toBe(true);
    expect(setup).toContain("setupTest");
    expect(evaluator).toContain("setupTest");
    expect(page).toContain(
      "A dozen failed sign-ins from one documentation address go through the real pipeline",
    );
    expect(page).toContain("Nobody is paged, and no SIEM receives them.");
  });

  it("lists every log format Your logs recognizes, in its order, and reads the logs every minute", () => {
    const rows: Array<Array<string>> = (tables(
      section(page, "Find security events in your logs"),
    )[0] || []) as Array<Array<string>>;

    // The first row is the header.
    expect(
      rows.slice(1).map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      SECURITY_LOG_FORMATS.map((format: SecurityLogFormatDefinition) => {
        return format.title;
      }),
    );
    expect(
      source(
        "packages/App/FeatureSet/Workers/Jobs/SecurityEvents/ScanLogsForSecurityEvents.ts",
      ),
    ).toContain("schedule: EVERY_MINUTE,");
    expect(page).toContain(
      "OneUptime reads the project's new logs every minute",
    );
  });

  it("links to the Google SecOps section the destination form links to", () => {
    expect(GOOGLE_SECOPS_DESTINATION_DOCS_PATH).toBe(
      "/docs/integrations/google-secops#send-security-events-to-google-secops",
    );
    expect(page).toContain(`(${GOOGLE_SECOPS_DESTINATION_DOCS_PATH})`);
  });
});

describe("Send security events to Google SecOps", () => {
  const page: string = readPage("en", "integrations/google-secops");
  const text: string = section(page, "Send security events to Google SecOps");
  const googleSecOps: SecurityEventDestinationDefinition | undefined =
    SecurityEventDestinationCatalog.find(
      (definition: SecurityEventDestinationDefinition): boolean => {
        return definition.provider === "google-secops";
      },
    );

  it("names the UDM types the mapper writes", () => {
    for (const type of Object.values(UdmEventType)) {
      expect(text).toContain(`\`${type}\``);
    }
  });

  it("asks for a key with the permission the importer needs, as the form describes it", () => {
    const key: string =
      googleSecOps?.secretFields.find((field: { key: string }) => {
        return field.key === "serviceAccountJson";
      })?.description || "";

    expect(key).toContain("chronicle.events.import");
    expect(key).toContain("Chronicle API Editor");
    expect(text).toContain("`chronicle.events.import`");
    expect(text).toContain(
      "**Chronicle API Editor** (`roles/chronicle.editor`)",
    );
  });

  it("names the form's fields and choices as the catalog and scopes title them", () => {
    for (const field of [
      ...(googleSecOps?.configFields || []),
      ...(googleSecOps?.secretFields || []),
    ]) {
      expect(text).toContain(`**${field.title}**`);
    }

    for (const option of SECURITY_EVENT_DESTINATION_SCOPES) {
      expect(text).toContain(
        `**${(option as SecurityEventDestinationScopeOption).title}**`,
      );
    }
  });

  it("describes the test event as the sender sends it", () => {
    const sender: string = flat(
      source(
        "packages/Common/Server/Utils/SecurityEvent/Destinations/GoogleSecOps/GoogleSecOpsSender.ts",
      ),
    );

    expect(sender).toContain("UdmEventType.GenericEvent");
    expect(UDM_PRODUCT_NAME_FALLBACK).toBe("OneUptime Security Events");
    expect(text).toContain(
      "One `GENERIC_EVENT` from the product `OneUptime Security Events` goes to Google SecOps",
    );
  });

  it("never sends history or Google SecOps' own alerts back, and sends every minute", () => {
    const service: string = flat(
      source(
        "packages/Common/Server/Services/SecurityEventDestinationService.ts",
      ),
    );

    expect(service).toContain(
      "onCreate.createBy.data.cursor = OneUptimeDate.getCurrentDate().toISOString();",
    );
    expect(googleSecOps?.importedProductNames).toEqual(["Google SecOps"]);
    expect(
      source(
        "packages/App/FeatureSet/Workers/Jobs/SecurityEvents/ForwardSecurityEvents.ts",
      ),
    ).toContain("schedule: EVERY_MINUTE,");
    expect(text).toContain("never the project's history");
    expect(text).toContain(
      "Alerts OneUptime imported from Google SecOps are never sent back to it.",
    );
  });
});
