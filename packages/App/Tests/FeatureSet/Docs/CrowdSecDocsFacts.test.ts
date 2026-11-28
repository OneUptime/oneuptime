import { CROWDSEC } from "./IntegrationsDocsPages";
import { DocsFence, scanMarkdown } from "./DocsContentSupport";
import {
  bold,
  englishPage,
  englishSection,
  readRepoFile,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import {
  FakePeer,
  definitionOf,
  fakePeer,
  fieldsOf,
  firstCellNames,
  json,
} from "./SecurityConnectionsDocsSupport";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import {
  CROWDSEC_RENEW_WHEN_LEFT_IN_MS,
  CROWDSEC_UNTIL_LIFTED_IN_MS,
} from "Common/Server/Utils/SecurityBlocklist/Destinations/CrowdSecBlockDestination";
import {
  SECURITY_BLOCKLIST_FIRST_RETRY_IN_MS,
  SECURITY_BLOCKLIST_LONGEST_RETRY_IN_MS,
} from "Common/Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import CrowdSecConnector from "Common/Server/Utils/SecurityEvent/Connectors/CrowdSec/CrowdSecConnector";
import { SecurityConnectorSettings } from "Common/Server/Utils/SecurityEvent/Connectors/Types";
import SecurityEventConnectionTester from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import { CROWDSEC_LOGIN_HINTS } from "Common/Server/Utils/SecurityEvent/Response/CrowdSecLapiClient";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectorCheck } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SECURITY_EVENTS_INGEST_PATH } from "Common/Types/SecurityEvent/Connectors/PushedConnectionAddress";
import {
  BLOCK_INDICATORS_KEY,
  ConnectorField,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CROWDSEC_BEHAVIOR_SEVERITY,
  CrowdSecBehavior,
} from "Common/Types/SecurityEvent/CrowdSec/CrowdSecBehavior";
import {
  CROWDSEC_ONEUPTIME_ORIGIN,
  CROWDSEC_ONEUPTIME_SCENARIO,
} from "Common/Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import {
  CROWDSEC_NOTIFICATION_FILE,
  CROWDSEC_PROFILES_FILE,
  CROWDSEC_PROFILE_NOTIFICATIONS,
  CROWDSEC_RELOAD_COMMAND,
  CROWDSEC_TEST_COMMAND,
  getCrowdSecAlertsAddress,
  getCrowdSecNotificationYaml,
} from "Common/Types/SecurityEvent/CrowdSec/CrowdSecNotification";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES } from "Common/Types/SecurityEvent/ThreatIntelConstants";
import CrowdSecNormalizer, {
  CROWDSEC_EVENTS_KEPT_WHOLE,
} from "Common/Utils/SecurityEvent/Connectors/CrowdSecNormalizer";
import { describe, expect, it } from "@jest/globals";

/*
 * The CrowdSec page (#11158), held to the product: the connection's
 * settings, the notification Send alerts hands out, the checks a test
 * runs, how an alert is read, and how a ban is made and ends. CrowdSec
 * sends its alerts, so the facts every polled connection page shares
 * (SecurityConnectionsDocsFacts' CONNECTION_PAGES) are not this page's.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

function page(): string {
  return englishPage(CROWDSEC);
}

function fences(): Array<DocsFence> {
  return scanMarkdown(page()).fences;
}

function fenceWithInfo(info: string): DocsFence {
  const fence: DocsFence | undefined = fences().find(
    (candidate: DocsFence): boolean => {
      return candidate.info === info;
    },
  );

  if (!fence) {
    throw new Error(`The CrowdSec page has no \`\`\`${info} block`);
  }

  return fence;
}

function bashCommands(): Array<string> {
  return fences()
    .filter((fence: DocsFence): boolean => {
      return fence.lang === "bash";
    })
    .map((fence: DocsFence): string => {
      return fence.code.trim();
    });
}

/*
 * A Local API that answers every call a test makes: up, signing the
 * machine in, holding no allowlist and no ban of OneUptime's.
 */
function answeringLapi(request: DataSourceHttpRequest): DataSourceHttpResponse {
  const url: string = String(request.url);

  if (url.endsWith("/health")) {
    return json(200, { status: "up" });
  }

  if (url.endsWith("/v1/watchers/login")) {
    return json(200, {
      code: 200,
      expire: "2026-11-28T11:00:00Z",
      token: "lapi-session-token",
    });
  }

  return json(200, []);
}

describe("the CrowdSec page's connection", () => {
  it("names every setting of the connection, as the catalog titles it, in its settings table", () => {
    const rows: Array<Array<string>> = tableWithHeader(page(), "Setting");

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      fieldsOf(SecurityEventConnectorProvider.CrowdSec).map(
        (field: ConnectorField): string => {
          return bold(field.title);
        },
      ),
    );
  });

  it("opens Connections from the Products menu, picks CrowdSec by its title and tests the settings before saving", () => {
    expect(page()).toContain(
      `${bold("Products → Security Events → Connections")} (\`/dashboard/{projectId}/security-events/connections\`)`,
    );
    expect(page()).toContain(
      `click ${bold("Add connection")}, choose ${bold(definitionOf(SecurityEventConnectorProvider.CrowdSec).title)}`,
    );
    expect(page()).toContain(
      `Click ${bold("Test these settings")} under ${bold("Test before saving")}.`,
    );
  });

  it("names the form's last step, and the row's actions, as the Dashboard draws them", () => {
    const form: string = readRepoFile(
      `${DASHBOARD}/Components/SecurityEvents/SecurityEventConnectionFormModal.tsx`,
    );
    const table: string = readRepoFile(
      `${DASHBOARD}/Components/SecurityEvents/SecurityEventConnectionsTable.tsx`,
    );

    expect(form).toContain(
      'title: lastStep.isForPushedAlerts ? "Alerts" : "Polling",',
    );
    expect(page()).toContain(
      `give the connection a ${bold("Name")} on the ${bold("Alerts")} step`,
    );
    expect(table).toContain('title: "Send alerts",');
    expect(table).toContain('title: "View alerts",');
    expect(page()).toContain(
      `${bold("Send alerts")} says when it arrives, and ${bold("View alerts")} opens it in Security Events.`,
    );
  });

  it("prints the notification Send alerts hands out, for the placeholders it names", () => {
    const notification: DocsFence = fenceWithInfo(
      `yaml title="${CROWDSEC_NOTIFICATION_FILE}"`,
    );

    expect(notification.code).toBe(
      getCrowdSecNotificationYaml({
        address: getCrowdSecAlertsAddress({
          ingestUrl: `https://oneuptime.com${SECURITY_EVENTS_INGEST_PATH}`,
          connectionId: "YOUR_CONNECTION_ID",
        }),
        token: "YOUR_INGESTION_TOKEN",
      }).trimEnd(),
    );
  });

  it("prints the profiles' line, the reload and the test alert as Send alerts does", () => {
    expect(fenceWithInfo(`yaml title="${CROWDSEC_PROFILES_FILE}"`).code).toBe(
      CROWDSEC_PROFILE_NOTIFICATIONS,
    );
    expect(bashCommands()).toEqual(
      expect.arrayContaining([CROWDSEC_RELOAD_COMMAND, CROWDSEC_TEST_COMMAND]),
    );
  });

  it("adds the machine with the command the form and the sign-in's hint give", () => {
    const command: string = "sudo cscli machines add oneuptime --auto -f -";
    const machineId: ConnectorField | undefined = fieldsOf(
      SecurityEventConnectorProvider.CrowdSec,
    ).find((field: ConnectorField): boolean => {
      return field.key === "machineId";
    });

    expect(machineId?.description).toContain(command);
    expect(CROWDSEC_LOGIN_HINTS.missing).toContain(`\`${command}\``);
    expect(bashCommands()).toContain(command);
  });

  it("lists the checks a test reports, in their order, for a saved connection that blocks", async () => {
    const peer: FakePeer = fakePeer(answeringLapi);
    const settings: SecurityConnectorSettings = {
      provider: SecurityEventConnectorProvider.CrowdSec,
      config: {
        lapiUrl: "https://crowdsec.example.com:8080",
        machineId: "oneuptime",
        [BLOCK_INDICATORS_KEY]: true,
      },
      secrets: { password: "machine-password-synthetic" },
      alertingOnly: true,
    };
    const connection: SecurityEventConnection = new SecurityEventConnection();
    connection._id = "cccccccc-cccc-4ccc-8ccc-000000000001";
    connection.projectId = new ObjectID("11111111-1111-4111-8111-111111111111");
    connection.provider = SecurityEventConnectorProvider.CrowdSec;
    connection.isEnabled = true;

    const report: { checks: Array<SecurityConnectorCheck> } =
      await SecurityEventConnectionTester.test({
        settings,
        connection,
        connectorOverride: new CrowdSecConnector(peer.transport),
        platformOverride: {
          workerConsumers: 1,
          schedulerRegistered: true,
          queueWaiting: 0,
          queueFailed: 0,
          storageReachable: true,
        },
        recordRun: false,
      });

    const documented: Array<string> = firstCellNames(
      tableWithHeader(englishSection(CROWDSEC, "## Test connection"), "Check"),
    );

    expect(
      report.checks.map((check: SecurityConnectorCheck): string => {
        return `${check.name}:${check.status}`;
      }),
    ).toEqual(
      documented.map((name: string): string => {
        return `${name}:${name === "Alerts received" ? "warn" : "pass"}`;
      }),
    );
    // Nothing a test sends bans or removes anything.
    expect(
      peer.requests.map((request: DataSourceHttpRequest): string => {
        return String(request.method);
      }),
    ).not.toContain("DELETE");
  });
});

describe("what the CrowdSec page says is received", () => {
  const alert: JSONObject = JSON.parse(
    readRepoFile(
      "Common/Tests/Fixtures/CrowdSec/docs-ssh-bf-notification.json",
    ),
  )[0] as JSONObject;

  it("reads an alert as its table maps it", () => {
    const uuid: string = "5d6c1f7a-2b3e-4c8d-9e0f-1a2b3c4d5e6f";
    const event: NormalizedSecurityEvent = CrowdSecNormalizer.normalize({
      ...alert,
      uuid,
    });
    const source: JSONObject = alert["source"] as JSONObject;

    expect(event.classUid).toBe(2004);
    expect(event.vendorName).toBe("CrowdSec");
    expect(event.productName).toBe("CrowdSec");
    expect(event.eventUid).toBe(`crowdsec:${uuid}`);
    // The docs' own alert has none: its UID is a hash of it, the same each time.
    expect(CrowdSecNormalizer.normalize(alert).eventUid).toBe(
      CrowdSecNormalizer.normalize(alert).eventUid,
    );
    expect(CrowdSecNormalizer.normalize(alert).eventUid).not.toContain(
      "crowdsec:",
    );
    expect(event.time.toISOString()).toBe(
      new Date(String(alert["stop_at"])).toISOString(),
    );
    expect(event.ruleId).toBe(alert["scenario"]);
    expect(event.principalIp).toBe(source["ip"]);
    expect(event.statusName).toBe("Blocked");
    expect(event.attributes["crowdsec.scenario"]).toBe(alert["scenario"]);

    const rows: Array<Array<string>> = tableWithHeader(
      page(),
      "CrowdSec field",
    );
    expect(
      rows.map((row: Array<string>): string => {
        return row[1] as string;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Event UID, which is also what duplicates are dropped by",
        "Event time",
        "Principal IP",
        "Status: `Blocked` for a ban, `Challenge` for a captcha, `Logged` without a decision or in simulation mode",
      ]),
    );
    expect(CROWDSEC_EVENTS_KEPT_WHOLE).toBe(10);
    expect(page()).toContain("its first 10 events whole");
  });

  it("gives each behavior the severity its table names", () => {
    const rows: Array<Array<string>> = tableWithHeader(page(), "Behavior");
    const severities: Array<string> = rows.map((row: Array<string>): string => {
      return row[1] as string;
    });

    expect(severities).toEqual([
      OcsfSeverity.High,
      OcsfSeverity.Medium,
      OcsfSeverity.Low,
      OcsfSeverity.Informational,
    ]);
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.Exploit]).toBe(
      OcsfSeverity.High,
    );
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.PostExploitation]).toBe(
      OcsfSeverity.High,
    );

    for (const behavior of [
      CrowdSecBehavior.BruteForce,
      CrowdSecBehavior.DenialOfService,
      CrowdSecBehavior.Fraud,
      CrowdSecBehavior.UnusualActivity,
      CrowdSecBehavior.Unknown,
    ]) {
      expect(CROWDSEC_BEHAVIOR_SEVERITY[behavior]).toBe(OcsfSeverity.Medium);
    }

    for (const behavior of [
      CrowdSecBehavior.Audit,
      CrowdSecBehavior.Scan,
      CrowdSecBehavior.Crawl,
      CrowdSecBehavior.Bot,
      CrowdSecBehavior.Spam,
    ]) {
      expect(CROWDSEC_BEHAVIOR_SEVERITY[behavior]).toBe(OcsfSeverity.Low);
    }

    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.Test]).toBe(
      OcsfSeverity.Informational,
    );
  });

  it("opens cases from CrowdSec's own detections alone", () => {
    const manual: JSONObject = {
      ...alert,
      uuid: "6a1f0e2c-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      kind: "cscli",
    };

    expect(
      CrowdSecNormalizer.isDetection(CrowdSecNormalizer.normalize(alert)),
    ).toBe(true);
    expect(
      CrowdSecNormalizer.isDetection(CrowdSecNormalizer.normalize(manual)),
    ).toBe(false);
    expect(CrowdSecNormalizer.normalize(manual).severityName).toBe(
      OcsfSeverity.Informational,
    );
    expect(page()).toContain("Only CrowdSec's own detections open cases.");
  });
});

describe("how the CrowdSec page says a ban is made and ends", () => {
  it("is a manual decision, under OneUptime's own scenario", () => {
    expect(CROWDSEC_ONEUPTIME_SCENARIO).toBe("oneuptime/blocklist");
    expect(CROWDSEC_ONEUPTIME_ORIGIN).toBe("cscli");
    expect(page()).toContain(
      "made as `cscli decisions add` makes one, under the scenario `oneuptime/blocklist`. CrowdSec keeps it as a manual decision",
    );
  });

  it("lasts until the block's end, or a week renewed with 3 days left", () => {
    expect(CROWDSEC_UNTIL_LIFTED_IN_MS).toBe(7 * DAY_IN_MS);
    expect(CROWDSEC_RENEW_WHEN_LEFT_IN_MS).toBe(3 * DAY_IN_MS);
    expect(page()).toContain(
      "A block until it is lifted is a ban of 7 days, renewed once 3 days or less are left",
    );
  });

  it("is tried again after a minute, then twice as long each time, up to 30 minutes", () => {
    const job: string = readRepoFile(
      "App/FeatureSet/Workers/Jobs/SecurityBlocklist/ReconcileSecurityBlocklist.ts",
    );

    expect(job).toContain("schedule: EVERY_MINUTE,");
    expect(SECURITY_BLOCKLIST_FIRST_RETRY_IN_MS).toBe(60 * 1000);
    expect(SECURITY_BLOCKLIST_LONGEST_RETRY_IN_MS).toBe(30 * 60 * 1000);
    expect(page()).toContain(
      "OneUptime tries again after 1 minute, then waits twice as long each time, up to 30 minutes.",
    );
  });
});

describe("how the CrowdSec page reads CrowdSec's blocklists", () => {
  it("pulls a day apart at most on the Community plan, which the poll interval reaches", () => {
    expect(THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES).toBe(1440);
    expect(page()).toContain(
      `set ${bold("Poll Interval (Minutes)")} to \`1440\``,
    );
  });

  it("signs in with the list's username and password, as the feed form offers it", () => {
    const raises: string = readRepoFile(
      `${DASHBOARD}/Components/SecurityEvents/SecurityMatchRaises.ts`,
    );

    expect(raises).toContain("export const LIST_SIGN_IN_ANSWERS");
    expect(page()).toContain(
      `pick ${bold("Username and password")} under ${bold("Sign-in")}`,
    );
  });
});
