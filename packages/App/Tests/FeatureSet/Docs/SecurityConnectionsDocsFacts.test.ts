import { generateKeyPairSync } from "crypto";
import {
  AWS_SECURITY_HUB,
  CROWDSTRIKE,
  DEFENDER,
  ELASTIC,
  ENTRA_ID,
  GOOGLE_SECOPS,
  GOOGLE_WORKSPACE,
  OKTA,
  SECURITY_CONNECTION_PAGES,
  SENTINEL,
  SPLUNK,
} from "./IntegrationsDocsPages";
import { tables } from "./DocsPageShape";
import {
  bold,
  codeIn,
  englishPage,
  englishSection,
  readRepoFile,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import {
  DAY_IN_MS,
  FakePeer,
  WINDOW_END,
  WINDOW_START,
  createdAt,
  definitionOf,
  fakePeer,
  fetchWindow,
  fieldsOf,
  firstCellNames,
  json,
  messageOf,
  neverAnswers,
  quotedBlock,
  quotedMessages,
  quotes,
  text,
  unreachable,
  withoutTimes,
} from "./SecurityConnectionsDocsSupport";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import AwsSecurityHubConnector from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubConnector";
import ConnectorPlatformHealth from "Common/Server/Utils/SecurityEvent/Connectors/ConnectorPlatformHealth";
import CrowdStrikeFalconClient, {
  CROWDSTRIKE_ALERTS_OFFSET_CEILING,
  CROWDSTRIKE_ALERTS_PAGE_SIZE,
  CROWDSTRIKE_FALCON_CLOUD_BASE_URLS,
} from "Common/Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalcon/CrowdStrikeFalconClient";
import CrowdStrikeFalconConnector from "Common/Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalcon/CrowdStrikeFalconConnector";
import MicrosoftDefenderXdrClient, {
  MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
} from "Common/Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrClient";
import MicrosoftDefenderXdrConnector from "Common/Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrConnector";
import MicrosoftSentinelClient, {
  MICROSOFT_SENTINEL_API_VERSION,
  MICROSOFT_SENTINEL_CLOUD_ENDPOINTS,
  MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
} from "Common/Server/Utils/SecurityEvent/Connectors/MicrosoftSentinel/MicrosoftSentinelClient";
import ElasticSecurityConnector from "Common/Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityConnector";
import GoogleWorkspaceConnector from "Common/Server/Utils/SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceConnector";
import MicrosoftEntraIdConnector from "Common/Server/Utils/SecurityEvent/Connectors/MicrosoftEntraId/MicrosoftEntraIdConnector";
import MicrosoftSentinelConnector from "Common/Server/Utils/SecurityEvent/Connectors/MicrosoftSentinel/MicrosoftSentinelConnector";
import OktaConnector from "Common/Server/Utils/SecurityEvent/Connectors/Okta/OktaConnector";
import SecurityEventConnectionPoller, {
  DEFAULT_INITIAL_LOOKBACK_IN_MINUTES,
  MAX_CHUNK_MINUTES,
  MAX_FETCH_REQUESTS,
  MAX_RANGE_MS,
  MIN_CHUNK_MINUTES,
  POLL_REQUEST_TIMEOUT_IN_MS,
} from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectionTester, {
  CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS,
} from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import SplunkConnector from "Common/Server/Utils/SecurityEvent/Connectors/Splunk/SplunkConnector";
import {
  ConnectorFetchResult,
  ConnectorTransport,
  SecurityConnectorSettings,
  SecurityEventConnector,
} from "Common/Server/Utils/SecurityEvent/Connectors/Types";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ConnectorField,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { SecurityConnectorCheck } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import SecurityEventFormat from "Common/Types/SecurityEvent/SecurityEventFormat";
import { GOOGLE_SECOPS_SUPPORTED_REGIONS } from "Common/Types/SecurityEvent/GoogleSecOpsRegion";
import CrowdStrikeFalconNormalizer from "Common/Utils/SecurityEvent/Connectors/CrowdStrikeFalconNormalizer";
import MicrosoftDefenderXdrNormalizer from "Common/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import MicrosoftSentinelNormalizer from "Common/Utils/SecurityEvent/Connectors/MicrosoftSentinelNormalizer";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 28b: what the Google SecOps, Microsoft Sentinel,
 * Microsoft Defender XDR and CrowdStrike Falcon pages say about their
 * Security Events connections, held to the code that makes it true. Task
 * 28c's Splunk Enterprise Security, Elastic Security, AWS Security Hub and
 * Okta System Log pages share the layout, so the tests of what every
 * connection page says (the form, polling, the test's checklist) hold
 * them too, and SplunkElasticAwsOktaDocsFacts holds what is theirs alone.
 *
 * The connectors take their HTTP transport as an argument, so this suite
 * runs them: a fake Microsoft Entra ID, Graph, Azure Resource Manager or
 * Falcon answers each client, and the messages a page quotes - every Last
 * Error prefix, the warning of a run a limit stopped, the order of a test's
 * checks - are the ones the code produces. The pages' tables are read
 * against the connector catalog, the connection form and the normalizers.
 *
 * SecurityEventsConnectorGuidanceAccuracy and SecurityEventsConnectionsPage
 * (Tests/Dashboard) keep holding the Google SecOps page's Last Error
 * taxonomy, budgets, upgrade notes and connections list.
 * IntegrationsDocsTranslations holds the 16 translations of every page to
 * these English pages, line for line.
 */

const TENANT_ID: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUBSCRIPTION_ID: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const SECRET: string = "a-client-secret-for-the-tests";

interface ConnectionPage {
  page: string;
  provider: SecurityEventConnectorProvider;
  // The prefix every message of the connection starts with.
  messagePrefix: string;
}

const CONNECTION_PAGES: Array<ConnectionPage> = [
  {
    page: SENTINEL,
    provider: SecurityEventConnectorProvider.MicrosoftSentinel,
    messagePrefix: "Microsoft Sentinel",
  },
  {
    page: DEFENDER,
    provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    messagePrefix: "Microsoft Defender XDR",
  },
  {
    page: CROWDSTRIKE,
    provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
    messagePrefix: "CrowdStrike Falcon",
  },
  {
    page: SPLUNK,
    provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    messagePrefix: "Splunk Enterprise Security",
  },
  {
    page: ELASTIC,
    provider: SecurityEventConnectorProvider.ElasticSecurity,
    messagePrefix: "Elastic Security",
  },
  {
    page: AWS_SECURITY_HUB,
    provider: SecurityEventConnectorProvider.AwsSecurityHub,
    messagePrefix: "AWS Security Hub",
  },
  {
    page: OKTA,
    provider: SecurityEventConnectorProvider.OktaSystemLog,
    messagePrefix: "Okta System Log",
  },
  {
    page: ENTRA_ID,
    provider: SecurityEventConnectorProvider.MicrosoftEntraId,
    messagePrefix: "Microsoft Entra ID",
  },
  {
    page: GOOGLE_WORKSPACE,
    provider: SecurityEventConnectorProvider.GoogleWorkspace,
    messagePrefix: "Google Workspace",
  },
];

const TOKEN: DataSourceHttpResponse = json(200, {
  token_type: "Bearer",
  expires_in: 3599,
  access_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.e30.c2ln",
});

function sentinelSettings(): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.MicrosoftSentinel,
    config: {
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      subscriptionId: SUBSCRIPTION_ID,
      resourceGroup: "security-rg",
      workspaceName: "sentinel-workspace",
      cloud: "public",
    },
    secrets: { clientSecret: SECRET },
    alertingOnly: false,
  };
}

function defenderSettings(): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    config: { tenantId: TENANT_ID, clientId: CLIENT_ID, cloud: "public" },
    secrets: { clientSecret: SECRET },
    alertingOnly: false,
  };
}

/*
 * Settings the Splunk, Elastic Security, AWS Security Hub and Okta forms
 * accept, for the tests every connection page shares.
 */
const OTHER_CONNECTION_SETTINGS: Partial<
  Record<SecurityEventConnectorProvider, SecurityConnectorSettings>
> = {
  [SecurityEventConnectorProvider.SplunkEnterpriseSecurity]: {
    provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    config: {
      url: "https://splunk.example.com:8089",
      searchString: "index=notable",
    },
    secrets: { apiToken: "a-splunk-authentication-token" },
    alertingOnly: false,
  },
  [SecurityEventConnectorProvider.ElasticSecurity]: {
    provider: SecurityEventConnectorProvider.ElasticSecurity,
    config: { kibanaUrl: "https://kibana.example.com", space: "" },
    secrets: {
      apiKey: "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==",
    },
    alertingOnly: false,
  },
  [SecurityEventConnectorProvider.AwsSecurityHub]: {
    provider: SecurityEventConnectorProvider.AwsSecurityHub,
    config: { region: "us-east-1", accessKeyId: "TESTONLYACCESSKEY001" },
    secrets: { secretAccessKey: SECRET },
    alertingOnly: false,
  },
  [SecurityEventConnectorProvider.OktaSystemLog]: {
    provider: SecurityEventConnectorProvider.OktaSystemLog,
    config: { orgUrl: "https://acme.okta.com", filter: "" },
    secrets: { apiToken: "00a-test-okta-api-token" },
    alertingOnly: false,
  },
  // With its option on, so the test's checklist has the audit log's check.
  [SecurityEventConnectorProvider.MicrosoftEntraId]: {
    provider: SecurityEventConnectorProvider.MicrosoftEntraId,
    config: {
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      cloud: "public",
      includeMicrosoft365Audit: true,
    },
    secrets: { clientSecret: SECRET },
    alertingOnly: false,
  },
  // With Drive on, for the same reason; a real key, which the sign-in signs with.
  [SecurityEventConnectorProvider.GoogleWorkspace]: {
    provider: SecurityEventConnectorProvider.GoogleWorkspace,
    config: { adminEmail: "admin@example.com", includeDrive: true },
    secrets: {
      serviceAccountJson: JSON.stringify({
        type: "service_account",
        client_email: "reader@example-project.iam.gserviceaccount.com",
        private_key: generateKeyPairSync("rsa", {
          modulusLength: 2048,
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
          publicKeyEncoding: { type: "spki", format: "pem" },
        }).privateKey,
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    },
    alertingOnly: false,
  },
};

function crowdStrikeSettings(): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
    config: { clientId: "falcon-client-id", cloud: "us-1" },
    secrets: { clientSecret: SECRET },
    alertingOnly: false,
  };
}

function connectorFor(
  provider: SecurityEventConnectorProvider,
  transport: ConnectorTransport,
): SecurityEventConnector {
  if (provider === SecurityEventConnectorProvider.MicrosoftSentinel) {
    return new MicrosoftSentinelConnector(transport);
  }

  if (provider === SecurityEventConnectorProvider.MicrosoftDefenderXdr) {
    return new MicrosoftDefenderXdrConnector(transport);
  }

  if (provider === SecurityEventConnectorProvider.SplunkEnterpriseSecurity) {
    return new SplunkConnector(transport);
  }

  if (provider === SecurityEventConnectorProvider.ElasticSecurity) {
    return new ElasticSecurityConnector(transport);
  }

  if (provider === SecurityEventConnectorProvider.AwsSecurityHub) {
    return new AwsSecurityHubConnector(transport);
  }

  if (provider === SecurityEventConnectorProvider.OktaSystemLog) {
    return new OktaConnector(transport);
  }

  if (provider === SecurityEventConnectorProvider.MicrosoftEntraId) {
    return new MicrosoftEntraIdConnector(transport);
  }

  if (provider === SecurityEventConnectorProvider.GoogleWorkspace) {
    return new GoogleWorkspaceConnector(transport);
  }

  return new CrowdStrikeFalconConnector(transport);
}

function settingsFor(
  provider: SecurityEventConnectorProvider,
): SecurityConnectorSettings {
  if (provider === SecurityEventConnectorProvider.MicrosoftSentinel) {
    return sentinelSettings();
  }

  if (provider === SecurityEventConnectorProvider.MicrosoftDefenderXdr) {
    return defenderSettings();
  }

  const other: SecurityConnectorSettings | undefined =
    OTHER_CONNECTION_SETTINGS[provider];

  return other || crowdStrikeSettings();
}

function sentinelClient(
  transport: ConnectorTransport,
  requestTimeoutInMs: number = 5000,
): MicrosoftSentinelClient {
  return new MicrosoftSentinelClient({
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    subscriptionId: SUBSCRIPTION_ID,
    resourceGroup: "security-rg",
    workspaceName: "sentinel-workspace",
    cloud: "public",
    transport,
    requestTimeoutInMs,
  });
}

function defenderClient(
  transport: ConnectorTransport,
  requestTimeoutInMs: number = 5000,
): MicrosoftDefenderXdrClient {
  return new MicrosoftDefenderXdrClient({
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    cloud: "public",
    transport,
    requestTimeoutInMs,
  });
}

function crowdStrikeClient(
  transport: ConnectorTransport,
  cloud: string = "us-1",
): CrowdStrikeFalconClient {
  return new CrowdStrikeFalconClient({
    clientId: "falcon-client-id",
    clientSecret: SECRET,
    cloud,
    transport,
    requestTimeoutInMs: 5000,
  });
}

function sentinelIncident(
  index: number,
  created: string = createdAt(index),
): JSONObject {
  return {
    id: `/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.SecurityInsights/incidents/incident-${index}`,
    name: `incident-${index}`,
    type: "Microsoft.SecurityInsights/incidents",
    properties: {
      createdTimeUtc: created,
      title: `Incident ${index}`,
      severity: "High",
      status: "New",
    },
  };
}

function defenderAlert(index: number): JSONObject {
  return {
    "@odata.type": "#microsoft.graph.security.alert",
    id: `alert-${index}`,
    title: `Alert ${index}`,
    severity: "high",
    status: "new",
    createdDateTime: createdAt(index),
  };
}

function falconAlert(
  index: number,
  created: string = createdAt(index),
): JSONObject {
  return {
    composite_id: `cid:ind:alert-${index}`,
    created_timestamp: created,
    display_name: `Alert ${index}`,
    severity_name: "High",
    status: "new",
  };
}

describe("every connection page's form", () => {
  it.each(CONNECTION_PAGES)(
    "$page names every setting of the connection, as the catalog titles it, in its settings table",
    (entry: ConnectionPage) => {
      const rows: Array<Array<string>> = tableWithHeader(
        englishPage(entry.page),
        "Setting",
      );
      const firstCells: Array<string> = rows.map(
        (row: Array<string>): string => {
          return row[0] as string;
        },
      );

      expect(firstCells).toEqual(
        fieldsOf(entry.provider).map((field: ConnectorField): string => {
          return bold(field.title);
        }),
      );
    },
  );

  it.each(CONNECTION_PAGES)(
    "$page names every option of the connection's dropdowns as the form lists it",
    (entry: ConnectionPage) => {
      for (const field of fieldsOf(entry.provider)) {
        for (const option of field.options || []) {
          expect({
            field: field.title,
            option: option.label,
            named: englishPage(entry.page).includes(bold(option.label)),
          }).toEqual({ field: field.title, option: option.label, named: true });
        }
      }
    },
  );

  it.each(CONNECTION_PAGES)(
    "$page picks the provider by its title, and the client secret's value on the Credentials step",
    (entry: ConnectionPage) => {
      const definition: SecurityEventConnectorDefinition = definitionOf(
        entry.provider,
      );
      const form: string = readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionFormModal.tsx",
      );

      expect(englishPage(entry.page)).toContain(
        `click ${bold("Add connection")}, choose ${bold(definition.title)}`,
      );
      // Settings, then Credentials: the secret fields are on the step after.
      expect(form).toContain(
        'steps.push({ id: CONNECTION_STEP_ID, title: "Connection" });',
      );
      expect(form).toContain(
        'steps.push({ id: CREDENTIALS_STEP_ID, title: "Credentials" });',
      );
      expect(form).toContain(
        'title: "Test before saving",\n    stepId: CREDENTIALS_STEP_ID,',
      );
      expect(englishPage(entry.page)).toContain(
        `Click ${bold("Test these settings")} under ${bold("Test before saving")}.`,
      );
    },
  );

  it("Microsoft Defender XDR is picked under the category the picker files it in", () => {
    expect(
      definitionOf(SecurityEventConnectorProvider.MicrosoftDefenderXdr)
        .category,
    ).toBe("EDR / XDR");
    expect(englishPage(DEFENDER)).toContain(
      `choose ${bold("Microsoft Defender XDR")} under ${bold("EDR / XDR")}`,
    );
  });

  it("the polling step's interval is a whole number from 1 to 1440 that starts at 5, as every connection page says", () => {
    const form: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionFormModal.tsx",
    );

    expect(form).toContain('title: "Poll Interval (Minutes)",');
    expect(form).toContain("validation: { minValue: 1, maxValue: 1440 },");
    expect(form).toContain('initialValues["pollIntervalInMinutes"] = 5;');
    expect(form).toContain('initialValues["isEnabled"] = true;');

    for (const entry of CONNECTION_PAGES) {
      expect(definitionOf(entry.provider).defaultPollIntervalInMinutes).toBe(5);
      expect(englishPage(entry.page)).toContain(
        `the ${bold("Poll Interval (Minutes)")}, a whole number from \`1\` to \`1440\` that starts at \`5\`, and ${bold("Enabled")}, which starts on.`,
      );
    }
  });

  it("only the roles the pages name can set a connection up or run it by hand; the Security roles can read it", () => {
    const connection: SecurityEventConnection = new SecurityEventConnection();
    const admins: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
    ];

    expect(connection.getCreatePermissions()).toEqual(admins);
    expect(connection.getUpdatePermissions()).toEqual(admins);
    expect(connection.getReadPermissions()).toEqual([
      ...admins,
      Permission.SecurityMember,
      Permission.SecurityViewer,
    ]);
    // Test connection, Run now, previews and imports need the update right.
    expect(
      readRepoFile("Common/Server/API/SecurityEventConnectionAPI.ts"),
    ).toContain(
      "allowedPermissions: new SecurityEventConnection().getUpdatePermissions(),",
    );

    for (const entry of CONNECTION_PAGES) {
      expect(englishPage(entry.page)).toContain(
        "In OneUptime, the Project Owner, Project Admin or Security Admin role. Security Members and Security Viewers can see connections and their run history, but cannot change them.",
      );
      expect(englishPage(entry.page)).toContain(
        "Anyone who can change the connection can start these; everyone who can see it can read the history.",
      );
    }
  });
});

/*
 * How far before the saved cursor each provider's polls start, as its page
 * says: a minute for most, longer where a record becomes readable after its
 * creation time (AWS Security Hub's delivery, Okta's delayed events).
 */
const OVERLAP_IN_MINUTES: Partial<
  Record<SecurityEventConnectorProvider, number>
> = {
  [SecurityEventConnectorProvider.MicrosoftSentinel]: 1,
  [SecurityEventConnectorProvider.MicrosoftDefenderXdr]: 1,
  [SecurityEventConnectorProvider.CrowdStrikeFalcon]: 1,
  [SecurityEventConnectorProvider.SplunkEnterpriseSecurity]: 1,
  [SecurityEventConnectorProvider.ElasticSecurity]: 1,
  [SecurityEventConnectorProvider.AwsSecurityHub]: 30,
  [SecurityEventConnectorProvider.OktaSystemLog]: 15,
  [SecurityEventConnectorProvider.MicrosoftEntraId]: 30,
  [SecurityEventConnectorProvider.GoogleWorkspace]: 120,
};

describe("every connection page's polling", () => {
  it("polls from a cursor: 24 hours back at first, then from the provider's overlap before the cursor, at most 24 hours a poll", () => {
    const now: Date = new Date("2026-09-20T12:00:00.000Z");

    expect(DEFAULT_INITIAL_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(MAX_CHUNK_MINUTES).toBe(24 * 60);
    expect(MIN_CHUNK_MINUTES).toBe(1);

    for (const entry of CONNECTION_PAGES) {
      const definition: SecurityEventConnectorDefinition = definitionOf(
        entry.provider,
      );
      const fresh: SecurityEventConnection = new SecurityEventConnection();
      fresh.provider = entry.provider;
      const caughtUp: SecurityEventConnection = new SecurityEventConnection();
      caughtUp.provider = entry.provider;
      caughtUp.cursor = "2026-09-20T11:55:00.000Z";
      const behind: SecurityEventConnection = new SecurityEventConnection();
      behind.provider = entry.provider;
      behind.cursor = "2026-09-10T00:00:00.000Z";

      const first: { startTime: Date; endTime: Date } =
        SecurityEventConnectionPoller.getWindow(fresh, { type: "poll" }, now);
      const next: { startTime: Date; endTime: Date } =
        SecurityEventConnectionPoller.getWindow(
          caughtUp,
          { type: "poll" },
          now,
        );
      const catchingUp: { startTime: Date; endTime: Date } =
        SecurityEventConnectionPoller.getWindow(behind, { type: "poll" }, now);

      const overlap: number = definition.cursorOverlapInMinutes;

      expect(OVERLAP_IN_MINUTES[entry.provider]).toBe(overlap);
      expect(now.getTime() - first.startTime.getTime()).toBe(DAY_IN_MS);
      expect(next.startTime.toISOString()).toBe(
        new Date(
          new Date("2026-09-20T11:55:00.000Z").getTime() - overlap * 60 * 1000,
        ).toISOString(),
      );
      expect(next.endTime.getTime()).toBe(now.getTime());
      expect(catchingUp.endTime.toISOString()).toBe("2026-09-11T00:00:00.000Z");

      const page: string = englishPage(entry.page);

      expect(page).toContain(`${bold("The first poll looks back 24 hours")}`);
      expect(page).toContain(
        `**Every later poll starts ${overlap} minute${overlap === 1 ? "" : "s"} before the saved cursor`,
      );
      expect(page).toContain(
        bold("A poll reads at most 24 hours past the cursor."),
      );
    }
  });

  it("previews and imports read up to 7 days, and the pages say so", () => {
    expect(MAX_RANGE_MS).toBe(7 * DAY_IN_MS);

    for (const entry of CONNECTION_PAGES) {
      const recordName: string = definitionOf(
        entry.provider,
      ).importedRecordName;

      expect(englishPage(entry.page)).toContain(
        `${bold(`Preview ${recordName}s`)} reads a time range of up to 7 days and imports nothing.`,
      );
      expect(englishPage(entry.page)).toContain(
        `${bold("Import this time range")} imports a range of up to 7 days, after you confirm, without moving the cursor.`,
      );
    }

    const diagnostics: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnostics.tsx",
    );

    expect(diagnostics).toContain("title={`Preview ${recordName}s`}");
    expect(diagnostics).toContain('title="Import this time range"');
    expect(diagnostics).toContain('title="Run now"');
  });

  it("narrows, grows back and moves past a minute with the warnings the pages quote", () => {
    const poller: string = readRepoFile(
      "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller.ts",
    );
    const narrowing: string =
      "This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.";
    const forcedAdvance: string =
      "More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.";

    expect(poller).toContain(narrowing.replace("{n}", "${nextChunkMinutes}"));
    expect(poller).toContain(
      forcedAdvance
        .replace("{cursor}", "${minuteStart}")
        .replace("{end}", "${result.windowEnd}"),
    );

    for (const entry of CONNECTION_PAGES) {
      expect(englishPage(entry.page)).toContain(`\`${narrowing}\``);
      expect(englishPage(entry.page)).toContain(`\`${forcedAdvance}\``);
    }
  });

  it("a request that times out halves the next window; the pages say a poll waits 60 seconds and a test 20", () => {
    const poller: string = readRepoFile(
      "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller.ts",
    );

    expect(poller).toContain(
      "The source did not answer in time for this window; the next poll reads a ${nextChunkMinutes} minute window from the same starting point.",
    );
    expect(POLL_REQUEST_TIMEOUT_IN_MS).toBe(60 * 1000);
    expect(CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS).toBe(20 * 1000);
    expect(englishPage(DEFENDER)).toContain(
      "did not answer in time: 60 seconds for a poll, 20 for a test.",
    );

    for (const entry of CONNECTION_PAGES) {
      expect(englishPage(entry.page)).toContain(
        "Every request in a test has a 20 second deadline.",
      );
      expect(englishPage(entry.page)).toContain(
        "The one exception is a request that timed out: the cursor stays, but the next window is half as long",
      );
    }
  });
});

describe("every connection page's test checklist", () => {
  it.each(CONNECTION_PAGES)(
    "$page lists the checks a test reports, in its order",
    async (entry: ConnectionPage) => {
      // Every provider's sign-in fails here, so its later checks are skipped.
      const peer: FakePeer = fakePeer((): DataSourceHttpResponse => {
        return json(401, { error: "invalid_client" });
      });
      const report: { checks: Array<SecurityConnectorCheck> } =
        await SecurityEventConnectionTester.test({
          settings: settingsFor(entry.provider),
          connectorOverride: connectorFor(entry.provider, peer.transport),
          platformOverride: {
            workerConsumers: 1,
            schedulerRegistered: true,
            queueWaiting: 0,
            queueFailed: 0,
            storageReachable: true,
          },
        });
      const scheduled: SecurityConnectorCheck =
        ConnectorPlatformHealth.toScheduleCheck({
          isEnabled: true,
          pollIntervalInMinutes: 5,
        });
      const reported: Array<string> = [
        ...report.checks.map((check: SecurityConnectorCheck): string => {
          return check.name;
        }),
        scheduled.name,
      ];
      const documented: Array<string> = firstCellNames(
        tableWithHeader(
          englishSection(entry.page, "## Test connection"),
          "Check",
        ),
      );

      expect(documented).toEqual(reported);
    },
  );
});

describe("Microsoft Sentinel", () => {
  it("lists incidents by creation time, oldest first, 50 a page, through the API version the page names", () => {
    const url: URL = new URL(
      sentinelClient(fakePeer(unreachable).transport).buildIncidentsUrl({
        startTime: WINDOW_START,
        endTime: WINDOW_END,
        top: MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
      }),
    );
    const request: string = quotedBlock(SENTINEL, "GET ");

    expect(MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE).toBe(50);
    expect(url.searchParams.get("api-version")).toBe(
      MICROSOFT_SENTINEL_API_VERSION,
    );
    expect(url.searchParams.get("$orderby")).toBe(
      "properties/createdTimeUtc asc",
    );
    expect(url.searchParams.get("$top")).toBe("50");
    expect(url.searchParams.get("$filter")).toBe(
      `(properties/createdTimeUtc ge ${WINDOW_START.toISOString()}) and (properties/createdTimeUtc lt ${WINDOW_END.toISOString()})`,
    );
    expect(request).toContain(`?api-version=${MICROSOFT_SENTINEL_API_VERSION}`);
    expect(request).toContain("&$orderby=properties/createdTimeUtc asc");
    expect(request).toContain("&$top=50");
    expect(request).toContain(
      "&$filter=(properties/createdTimeUtc ge {windowStart}) and (properties/createdTimeUtc lt {windowEnd})",
    );
    expect(request).toContain(
      "/providers/Microsoft.OperationalInsights/workspaces/{ws}/providers/Microsoft.SecurityInsights/incidents",
    );
  });

  it("checks the settings as the page's table describes them", () => {
    expect(() => {
      return MicrosoftSentinelClient.validateTenantId(
        "contoso.onmicrosoft.com",
      );
    }).not.toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateTenantId(TENANT_ID);
    }).not.toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateResourceGroup("rg.ends.with.");
    }).toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateResourceGroup("x".repeat(90));
    }).not.toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateResourceGroup("x".repeat(91));
    }).toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateResourceGroup("my_rg-(prod).1");
    }).not.toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateWorkspaceName("ab");
    }).toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateWorkspaceName("abc");
    }).not.toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateWorkspaceName("-abc");
    }).toThrow();
    expect(() => {
      return MicrosoftSentinelClient.validateWorkspaceName("a".repeat(91));
    }).toThrow();

    const page: string = englishPage(SENTINEL);

    expect(page).toContain(
      "1 to 90 letters, digits, underscores, hyphens, periods or parentheses, not ending in a period.",
    );
    expect(page).toContain(
      "3 to 90 letters, digits or hyphens, starting and ending with a letter or a digit.",
    );
    expect(page).toContain(
      "or a verified domain such as `contoso.onmicrosoft.com`",
    );
  });

  it("signs in and reads incidents at the hosts of the cloud the page names", () => {
    const government: { loginBaseUrl: string; managementBaseUrl: string } =
      MICROSOFT_SENTINEL_CLOUD_ENDPOINTS.usgov;
    const usgovClient: MicrosoftSentinelClient = new MicrosoftSentinelClient({
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      subscriptionId: SUBSCRIPTION_ID,
      resourceGroup: "security-rg",
      workspaceName: "sentinel-workspace",
      cloud: "usgov",
      transport: fakePeer(unreachable).transport,
      requestTimeoutInMs: 5000,
    });

    expect(usgovClient.getTokenScope()).toBe(
      "https://management.usgovcloudapi.net/.default",
    );
    expect(government.loginBaseUrl).toBe("https://login.microsoftonline.us");
    expect(government.managementBaseUrl).toBe(
      "https://management.usgovcloudapi.net",
    );
    expect(englishPage(SENTINEL)).toContain(
      "The connection then signs in at `login.microsoftonline.us` with the `https://management.usgovcloudapi.net/.default` scope, and reads incidents from `management.usgovcloudapi.net`.",
    );
  });

  it("quotes only Last Error messages the client produces", async () => {
    const window: { startTime: Date; endTime: Date; top: number } = {
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      top: 50,
    };
    const produced: Array<string> = [
      await messageOf(() => {
        return sentinelClient(
          fakePeer((): DataSourceHttpResponse => {
            return json(401, {
              error: "invalid_client",
              error_description:
                "AADSTS7000215: Invalid client secret provided.",
            });
          }).transport,
        ).getAccessToken();
      }),
      await messageOf(() => {
        return sentinelClient(
          fakePeer((): DataSourceHttpResponse => {
            return text(200, "<html>proxy</html>");
          }).transport,
        ).getAccessToken();
      }),
      await messageOf(() => {
        return sentinelClient(fakePeer(unreachable).transport).getAccessToken();
      }),
      await messageOf(() => {
        return sentinelClient(
          fakePeer(neverAnswers).transport,
          10,
        ).getAccessToken();
      }),
      await messageOf(() => {
        return sentinelClient(
          fakePeer((_request: DataSourceHttpRequest, index: number) => {
            return index === 0
              ? TOKEN
              : json(403, { error: { code: "AuthorizationFailed" } });
          }).transport,
        ).listIncidents(window);
      }),
      await messageOf(() => {
        return sentinelClient(
          fakePeer((_request: DataSourceHttpRequest, index: number) => {
            return index === 0 ? TOKEN : text(200, "not json");
          }).transport,
        ).listIncidents(window);
      }),
      await messageOf(() => {
        return sentinelClient(
          fakePeer((_request: DataSourceHttpRequest, index: number) => {
            if (index === 0) {
              return TOKEN;
            }

            throw new Error("socket hang up");
          }).transport,
        ).listIncidents(window);
      }),
      await messageOf(() => {
        return sentinelClient(
          fakePeer((_request: DataSourceHttpRequest, index: number) => {
            return index === 0 ? TOKEN : neverAnswers();
          }).transport,
          10,
        ).listIncidents(window);
      }),
    ];
    const quoted: Array<string> = quotedMessages(
      englishSection(SENTINEL, "## Troubleshooting"),
      ["Microsoft Sentinel "],
    ).filter((span: string): boolean => {
      // The run's own warnings are checked below, from a real run.
      return !span.startsWith("Microsoft Sentinel returned");
    });

    expect(quoted.length).toBeGreaterThanOrEqual(8);

    for (const span of quoted) {
      expect({ span, produced: quotes(span, produced) }).toEqual({
        span,
        produced: true,
      });
    }

    // The Entra codes the page names are the ones the hints key on.
    const client: string = readRepoFile(
      "Common/Server/Utils/SecurityEvent/Connectors/MicrosoftSentinel/MicrosoftSentinelClient.ts",
    );

    for (const code of ["AADSTS7000215", "AADSTS700016", "AADSTS90002"]) {
      expect(client).toContain(code);
      expect(englishPage(SENTINEL)).toContain(`\`${code}\``);
    }
  });

  it("stops a busy window after 20 pages, 1,000 incidents, and resumes after the last one read, with the warning the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        if (request.url.includes("oauth2")) {
          return TOKEN;
        }

        const incidents: Array<JSONObject> = Array.from(
          { length: 50 },
          (): JSONObject => {
            served += 1;
            return sentinelIncident(served);
          },
        );

        return json(200, {
          value: incidents,
          nextLink: `https://management.azure.com/next?page=${served}`,
        });
      },
    );
    const result: ConnectorFetchResult = await fetchWindow(
      new MicrosoftSentinelConnector(peer.transport),
      sentinelSettings(),
    );

    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(1000);
    expect(result.resumeAfter?.toISOString()).toBe(createdAt(1000));
    expect(withoutTimes(result.warnings[0] as string)).toBe(
      withoutTimes(quotedBlock(SENTINEL, "Stopped after")),
    );
    expect(englishPage(SENTINEL)).toContain(
      "A poll reads at most 20 pages of 50 incidents: 1,000 incidents.",
    );
  });

  it("names no resume point when incidents arrive out of creation-time order, as the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        if (request.url.includes("oauth2")) {
          return TOKEN;
        }

        const incidents: Array<JSONObject> = Array.from(
          { length: 50 },
          (): JSONObject => {
            served += 1;
            // Every page goes back in time.
            return sentinelIncident(served, createdAt(10000 - served));
          },
        );

        return json(200, {
          value: incidents,
          nextLink: `https://management.azure.com/next?page=${served}`,
        });
      },
    );
    const result: ConnectorFetchResult = await fetchWindow(
      new MicrosoftSentinelConnector(peer.transport),
      sentinelSettings(),
    );

    expect(result.resumeAfter).toBeUndefined();
    expect(result.warnings).toContain(
      "Microsoft Sentinel returned incidents out of creation-time order, so this run cannot name a point to resume from.",
    );
    expect(englishPage(SENTINEL)).toContain(
      "`Microsoft Sentinel returned incidents out of creation-time order, so this run cannot name a point to resume from.`",
    );
  });

  it("imports an incident as the page's table maps it", () => {
    const event: NormalizedSecurityEvent =
      MicrosoftSentinelNormalizer.normalize({
        id: `/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.SecurityInsights/incidents/9f2c`,
        name: "9f2c",
        type: "Microsoft.SecurityInsights/incidents",
        properties: {
          createdTimeUtc: "2026-09-14T08:12:44Z",
          firstActivityTimeUtc: "2026-09-13T22:00:00Z",
          title: "Suspicious sign-in",
          severity: "High",
          status: "Active",
          classification: "TruePositive",
          incidentUrl: "https://portal.azure.com/#asset/Incident/9f2c",
          relatedAnalyticRuleIds: [
            `/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.SecurityInsights/alertRules/rule-guid`,
          ],
          additionalData: { tactics: ["Persistence"] },
          owner: {
            userPrincipalName: "analyst@contoso.com",
            email: "analyst@contoso.com",
            objectId: "owner-object-id",
          },
          labels: [{ labelName: "vip" }],
        },
      });

    expect(event.classUid).toBe(2005);
    expect(event.className).toBe("Incident Finding");
    expect(event.activityName).toBe("Create");
    expect(event.time.toISOString()).toBe("2026-09-14T08:12:44.000Z");
    expect(event.eventUid).toBe("9f2c");
    expect(event.message).toBe("Suspicious sign-in");
    expect(event.ruleName).toBe("Suspicious sign-in");
    expect(event.ruleId).toBe("rule-guid");
    expect(event.statusName).toBe("Active");
    expect(event.mitreTactics).toEqual(["TA0003"]);
    expect(event.principalUser).toBe("analyst@contoso.com");
    expect(event.targetResource).toBe(
      "https://portal.azure.com/#asset/Incident/9f2c",
    );
    expect(event.observables).toEqual(
      expect.arrayContaining(["analyst@contoso.com", "owner-object-id", "vip"]),
    );
    expect(event.attributes["properties.classification"]).toBe("TruePositive");
    expect(event.productName).toBe(
      definitionOf(SecurityEventConnectorProvider.MicrosoftSentinel)
        .productName,
    );

    const page: string = englishPage(SENTINEL);

    expect(page).toContain(
      "Incident Finding event (OCSF class `2005`, activity `Create`)",
    );
    expect(page).toContain("`Persistence` becomes `TA0003`");
  });
});

describe("Microsoft Defender XDR", () => {
  it("lists alerts by creation time, 100 a page, from Graph's alerts_v2", () => {
    const url: URL = new URL(
      defenderClient(fakePeer(unreachable).transport).buildAlertsUrl({
        startTime: WINDOW_START,
        endTime: WINDOW_END,
        pageSize: MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
      }),
    );

    expect(MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE).toBe(100);
    expect(url.origin).toBe("https://graph.microsoft.com");
    expect(url.pathname).toBe("/v1.0/security/alerts_v2");
    expect(url.searchParams.get("$top")).toBe("100");
    expect(url.searchParams.get("$filter")).toBe(
      `createdDateTime ge ${WINDOW_START.toISOString()} and createdDateTime lt ${WINDOW_END.toISOString()}`,
    );
    expect(quotedBlock(DEFENDER, "GET ")).toBe(
      "GET https://graph.microsoft.com/v1.0/security/alerts_v2?$filter=createdDateTime ge {start} and createdDateTime lt {end}&$top=100",
    );
    expect(MicrosoftDefenderXdrClient.graphHostForCloud("usgov")).toBe(
      "https://graph.microsoft.us",
    );
    expect(MicrosoftDefenderXdrClient.loginHostForCloud("usgov")).toBe(
      "https://login.microsoftonline.us",
    );
  });

  it("quotes only Last Error messages the client produces", async () => {
    const window: { startTime: Date; endTime: Date } = {
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    };
    const produced: Array<string> = [
      await messageOf(() => {
        return defenderClient(
          fakePeer((): DataSourceHttpResponse => {
            return json(401, {
              error: "invalid_client",
              error_codes: [7000215],
            });
          }).transport,
        ).getAccessToken();
      }),
      await messageOf(() => {
        return defenderClient(
          fakePeer((): DataSourceHttpResponse => {
            return text(200, "<html>proxy</html>");
          }).transport,
        ).getAccessToken();
      }),
      await messageOf(() => {
        return defenderClient(fakePeer(unreachable).transport).getAccessToken();
      }),
      await messageOf(() => {
        return defenderClient(
          fakePeer((_request: DataSourceHttpRequest, index: number) => {
            return index === 0
              ? TOKEN
              : json(403, { error: { code: "Authorization_RequestDenied" } });
          }).transport,
        ).listAlerts(window);
      }),
      await messageOf(() => {
        return defenderClient(
          fakePeer((_request: DataSourceHttpRequest, index: number) => {
            return index === 0 ? TOKEN : text(200, "not json");
          }).transport,
        ).listAlerts(window);
      }),
      await messageOf(() => {
        return defenderClient(
          fakePeer((_request: DataSourceHttpRequest, index: number) => {
            if (index === 0) {
              return TOKEN;
            }

            throw new Error("socket hang up");
          }).transport,
        ).listAlerts(window);
      }),
    ];
    const quoted: Array<string> = quotedMessages(
      englishSection(DEFENDER, "## Troubleshooting"),
      ["Microsoft Defender XDR "],
    );

    expect(quoted.length).toBeGreaterThanOrEqual(6);

    for (const span of quoted) {
      expect({ span, produced: quotes(span, produced) }).toEqual({
        span,
        produced: true,
      });
    }

    // The page's own warning about an expired secret is the token failure.
    expect(
      quotes(
        "Microsoft Defender XDR token request failed (HTTP 401)",
        produced,
      ),
    ).toBe(true);

    const client: string = readRepoFile(
      "Common/Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrClient.ts",
    );

    for (const code of [
      "invalid_client",
      "unauthorized_client",
      "invalid_scope",
      "Authorization_RequestDenied",
      "InvalidAuthenticationToken",
    ]) {
      expect(client).toContain(code);
      expect(englishPage(DEFENDER)).toContain(`\`${code}\``);
    }
  });

  it("stops a busy window after 20 pages, 2,000 alerts, and names no resume point, with the warning the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        if (request.url.includes("oauth2")) {
          return TOKEN;
        }

        const alerts: Array<JSONObject> = Array.from(
          { length: 100 },
          (): JSONObject => {
            served += 1;
            return defenderAlert(served);
          },
        );

        return json(200, {
          value: alerts,
          "@odata.nextLink": `https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=${served}`,
        });
      },
    );
    const result: ConnectorFetchResult = await fetchWindow(
      new MicrosoftDefenderXdrConnector(peer.transport),
      defenderSettings(),
    );

    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(2000);
    expect(result.resumeAfter).toBeUndefined();
    expect(result.warnings[0]).toBe(quotedBlock(DEFENDER, "Stopped after"));
    expect(englishPage(DEFENDER)).toContain(
      "A poll reads at most 20 pages of 100 alerts: 2,000 alerts.",
    );
  });

  it("imports an alert as the page's table maps it", () => {
    const event: NormalizedSecurityEvent =
      MicrosoftDefenderXdrNormalizer.normalize({
        "@odata.type": "#microsoft.graph.security.alert",
        id: "da637551227677560813_-961444813",
        title: "Suspicious credential access",
        severity: "high",
        status: "inProgress",
        category: "CredentialAccess",
        detectorId: "detector-1",
        alertPolicyId: "policy-1",
        createdDateTime: "2026-09-14T08:12:44Z",
        firstActivityDateTime: "2026-09-14T06:00:00Z",
        serviceSource: "microsoftDefenderForEndpoint",
        incidentId: "42",
      });
    const fallback: NormalizedSecurityEvent =
      MicrosoftDefenderXdrNormalizer.normalize({
        id: "alert-without-activity-time",
        title: "Alert",
        severity: "low",
        status: "new",
        alertPolicyId: "policy-1",
        createdDateTime: "2026-09-14T08:12:44Z",
      });

    expect(event.classUid).toBe(2004);
    expect(event.eventUid).toBe("da637551227677560813_-961444813");
    expect(event.time.toISOString()).toBe("2026-09-14T06:00:00.000Z");
    expect(fallback.time.toISOString()).toBe("2026-09-14T08:12:44.000Z");
    expect(event.ruleId).toBe("detector-1");
    expect(fallback.ruleId).toBe("policy-1");
    expect(event.statusName).toBe("In Progress");
    expect(event.mitreTactics).toEqual(["TA0006"]);
    expect(event.vendorName).toBe("Microsoft");
    expect(event.productName).toBe("Microsoft Defender XDR");
    expect(event.attributes["incidentId"]).toBe("42");

    const page: string = englishPage(DEFENDER);

    expect(page).toContain(
      "Detection Finding event (OCSF class `2004`), with vendor `Microsoft` and product `Microsoft Defender XDR`",
    );
    expect(page).toContain("`inProgress` In Progress");
    expect(page).toContain("`CredentialAccess` becomes `TA0006`");
  });
});

describe("CrowdStrike Falcon", () => {
  it("sends every request to the API host of the cloud the page's table names", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(CROWDSTRIKE, "## Set up the connection"),
      "Base URL Falcon shows",
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [
          codeIn(row[0] as string)[0] as string,
          (row[1] as string).trim(),
        ];
      }),
    ).toEqual(
      Object.entries(CROWDSTRIKE_FALCON_CLOUD_BASE_URLS).map(
        ([cloud, url]: [string, string]): Array<string> => {
          return [url, cloud.toUpperCase()];
        },
      ),
    );
  });

  it("reads at most 9,000 alerts a run: one token, then a query and a fetch per 1,000, within 20 requests", () => {
    const perPageRequests: number = 2;
    const pages: number = Math.floor(
      (MAX_FETCH_REQUESTS - 1) / perPageRequests,
    );

    expect(CROWDSTRIKE_ALERTS_PAGE_SIZE).toBe(1000);
    expect(pages * CROWDSTRIKE_ALERTS_PAGE_SIZE).toBe(9000);
    expect(1 + pages * perPageRequests).toBe(19);
    expect(CROWDSTRIKE_ALERTS_OFFSET_CEILING).toBe(10000);
    expect(englishPage(CROWDSTRIKE)).toContain(
      "A poll sends at most 20 requests. With one token request and two requests for every 1,000 alerts, it reads at most 9,000 alerts.",
    );
    expect(englishPage(CROWDSTRIKE)).toContain(
      "Falcon's alerts query cannot page past 10,000 results (`limit` plus `offset`).",
    );
  });

  it("stops a busy window after 19 requests and resumes after the last alert read, with the warning the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        if (request.url.endsWith("/oauth2/token")) {
          return json(201, { access_token: "falcon-token", expires_in: 1799 });
        }

        if (request.url.includes("/alerts/queries/alerts/v2")) {
          const offset: number = Number(
            new URL(request.url).searchParams.get("offset"),
          );

          return json(200, {
            resources: Array.from(
              { length: 1000 },
              (_value: unknown, index: number): string => {
                return `cid:ind:alert-${offset + index + 1}`;
              },
            ),
            meta: { pagination: { offset, limit: 1000, total: 50000 } },
          });
        }

        const ids: Array<string> = (
          JSON.parse(request.body as string) as { composite_ids: Array<string> }
        ).composite_ids;

        return json(200, {
          resources: ids.map((): JSONObject => {
            served += 1;
            return falconAlert(served);
          }),
        });
      },
    );
    const result: ConnectorFetchResult = await fetchWindow(
      new CrowdStrikeFalconConnector(peer.transport),
      crowdStrikeSettings(),
    );

    expect(peer.requests).toHaveLength(19);
    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(9000);
    expect(result.resumeAfter?.toISOString()).toBe(createdAt(9000));
    expect(withoutTimes(result.warnings[0] as string)).toBe(
      withoutTimes(quotedBlock(CROWDSTRIKE, "Stopped after")),
    );
  });

  it("quotes only Last Error messages the client produces", async () => {
    const filter: string = CrowdStrikeFalconClient.buildCreatedTimestampFilter(
      WINDOW_START,
      WINDOW_END,
    );
    const queryAnswering: (
      answer: DataSourceHttpResponse | (() => DataSourceHttpResponse),
    ) => ConnectorTransport = (
      answer: DataSourceHttpResponse | (() => DataSourceHttpResponse),
    ): ConnectorTransport => {
      return fakePeer((_request: DataSourceHttpRequest, index: number) => {
        if (index === 0) {
          return json(201, { access_token: "falcon-token", expires_in: 1799 });
        }

        return typeof answer === "function" ? answer() : answer;
      }).transport;
    };
    const produced: Array<string> = [
      await messageOf(() => {
        return crowdStrikeClient(
          fakePeer((): DataSourceHttpResponse => {
            return json(401, {
              errors: [{ code: 401, message: "access denied" }],
            });
          }).transport,
        ).getAccessToken();
      }),
      await messageOf(() => {
        return crowdStrikeClient(
          fakePeer((): DataSourceHttpResponse => {
            return json(201, { expires_in: 1799 });
          }).transport,
        ).getAccessToken();
      }),
      await messageOf(() => {
        return crowdStrikeClient(
          fakePeer(unreachable).transport,
        ).getAccessToken();
      }),
      ...(await Promise.all(
        [403, 401, 429, 400].map((status: number): Promise<string> => {
          return messageOf(() => {
            return crowdStrikeClient(
              queryAnswering(json(status, { errors: [] })),
            ).queryAlertIds({
              filter,
              limit: 1,
              offset: 0,
            });
          });
        }),
      )),
      await messageOf(() => {
        return crowdStrikeClient(
          queryAnswering(text(200, "not json")),
        ).queryAlertIds({
          filter,
          limit: 1,
          offset: 0,
        });
      }),
      await messageOf(() => {
        return crowdStrikeClient(
          queryAnswering((): DataSourceHttpResponse => {
            throw new Error("socket hang up");
          }),
        ).queryAlertIds({ filter, limit: 1, offset: 0 });
      }),
      await messageOf(() => {
        return crowdStrikeClient(
          queryAnswering(json(429, { errors: [] })),
        ).getAlerts(["cid:ind:alert-1"]);
      }),
      await messageOf(() => {
        return crowdStrikeClient(
          queryAnswering(text(200, "not json")),
        ).getAlerts(["cid:ind:alert-1"]);
      }),
      await messageOf(() => {
        return crowdStrikeClient(
          queryAnswering((): DataSourceHttpResponse => {
            throw new Error("socket hang up");
          }),
        ).getAlerts(["cid:ind:alert-1"]);
      }),
      await messageOf(() => {
        return Promise.resolve(
          crowdStrikeClient(fakePeer(unreachable).transport, "mars-1"),
        );
      }),
    ];
    const quoted: Array<string> = quotedMessages(
      englishSection(CROWDSTRIKE, "## Troubleshooting"),
      ["CrowdStrike Falcon "],
    );

    expect(quoted.length).toBeGreaterThanOrEqual(12);

    for (const span of quoted) {
      expect({ span, produced: quotes(span, produced) }).toEqual({
        span,
        produced: true,
      });
    }

    // A 429 names the header Falcon would have sent, as the page says.
    expect(
      produced.some((message: string): boolean => {
        return message.endsWith(
          "the X-RateLimit-RetryAfter header was not available",
        );
      }),
    ).toBe(true);
  });

  it("names no resume point when alerts arrive out of created_timestamp order, as the page quotes", async () => {
    let served: number = 0;
    const peer: FakePeer = fakePeer(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        if (request.url.endsWith("/oauth2/token")) {
          return json(201, { access_token: "falcon-token", expires_in: 1799 });
        }

        if (request.url.includes("/alerts/queries/alerts/v2")) {
          const offset: number = Number(
            new URL(request.url).searchParams.get("offset"),
          );

          return json(200, {
            resources: Array.from(
              { length: 1000 },
              (_value: unknown, index: number): string => {
                return `cid:ind:alert-${offset + index + 1}`;
              },
            ),
            meta: { pagination: { offset, limit: 1000, total: 50000 } },
          });
        }

        const ids: Array<string> = (
          JSON.parse(request.body as string) as { composite_ids: Array<string> }
        ).composite_ids;

        return json(200, {
          resources: ids.map((): JSONObject => {
            served += 1;
            // Each alert is older than the one before it.
            return falconAlert(served, createdAt(20000 - served));
          }),
        });
      },
    );
    const result: ConnectorFetchResult = await fetchWindow(
      new CrowdStrikeFalconConnector(peer.transport),
      crowdStrikeSettings(),
    );

    expect(result.resumeAfter).toBeUndefined();
    expect(result.warnings).toContain(
      "Falcon returned alerts out of created_timestamp order, so this run cannot name a point to resume from.",
    );
    expect(englishPage(CROWDSTRIKE)).toContain(
      "`Falcon returned alerts out of created_timestamp order, so this run cannot name a point to resume from.`",
    );
  });

  it("imports an alert as the page's table maps it", () => {
    const event: NormalizedSecurityEvent =
      CrowdStrikeFalconNormalizer.normalize({
        composite_id: "cid:ind:abc",
        created_timestamp: "2026-09-14T08:12:44.995Z",
        timestamp: "2026-09-14T08:00:00Z",
        display_name: "Credential dumping",
        name: "CredentialDumping",
        pattern_id: 51101,
        description: "A process read LSASS memory.",
        severity_name: "High",
        severity: 70,
        status: "new",
        tactic_id: "TA0006",
        technique_id: "T1003",
        device: {
          hostname: "web-1",
          local_ip: "10.0.0.5",
          external_ip: "203.0.113.7",
        },
        user_name: "alice",
        sha256: "a".repeat(64),
      });
    const numeric: NormalizedSecurityEvent =
      CrowdStrikeFalconNormalizer.normalize({
        composite_id: "cid:ind:def",
        created_timestamp: "2026-09-14T08:12:44.995Z",
        name: "Lateral movement",
        severity: 85,
      });

    expect(event.classUid).toBe(2004);
    expect(event.eventUid).toBe("cid:ind:abc");
    expect(event.time.toISOString()).toBe("2026-09-14T08:12:44.995Z");
    expect(event.ruleName).toBe("Credential dumping");
    expect(numeric.ruleName).toBe("Lateral movement");
    expect(event.ruleId).toBe("51101");
    expect(event.message).toBe("A process read LSASS memory.");
    expect(event.severityName).toBe("High");
    expect(numeric.severityName).toBe("Critical");
    expect(event.mitreTactics).toEqual(["TA0006"]);
    expect(event.mitreTechniques).toEqual(["T1003"]);
    expect(event.principalHost).toBe("web-1");
    expect(event.principalIp).toBe("10.0.0.5");
    expect(event.principalUser).toBe("alice");
    expect(event.observables).toEqual(
      expect.arrayContaining(["web-1", "10.0.0.5", "203.0.113.7", "alice"]),
    );
    expect(event.attributes["timestamp"]).toBe("2026-09-14T08:00:00Z");
    expect(event.vendorName).toBe("CrowdStrike");
    expect(event.productName).toBe("Falcon");

    expect(englishPage(CROWDSTRIKE)).toContain(
      "Detection Finding event (OCSF class `2004`), with vendor `CrowdStrike` and product `Falcon`",
    );
    expect(englishPage(CROWDSTRIKE)).toContain(
      "stays in `attributes.timestamp`",
    );
  });
});

describe("Google SecOps", () => {
  const definition: SecurityEventConnectorDefinition = definitionOf(
    SecurityEventConnectorProvider.GoogleSecOps,
  );

  it("names every setting of the connection and the Data to import options as the catalog does", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishPage(GOOGLE_SECOPS),
      "Setting",
    );
    const control: NonNullable<
      SecurityEventConnectorDefinition["alertingOnlyControl"]
    > = definition.alertingOnlyControl as NonNullable<
      SecurityEventConnectorDefinition["alertingOnlyControl"]
    >;

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      ...fieldsOf(SecurityEventConnectorProvider.GoogleSecOps).map(
        (field: ConnectorField): string => {
          return bold(field.title);
        },
      ),
      bold(control.title),
    ]);
    expect(englishPage(GOOGLE_SECOPS)).toContain(
      `${bold(control.alertingLabel)} are always imported because Google's alerts API always returns them. Select ${bold(control.nonAlertingLabel)} to also import rule matches that did not generate an alert.`,
    );
  });

  it("gives Region no default, and names regional endpoints Google publishes", () => {
    const region: ConnectorField = definition.configFields.find(
      (field: ConnectorField): boolean => {
        return field.key === "region";
      },
    ) as ConnectorField;
    const regionRow: string = tables(englishPage(GOOGLE_SECOPS))
      .flat()
      .find((row: Array<string>): boolean => {
        return row[0] === bold("Region");
      })
      ?.join(" | ") as string;

    expect(region.defaultValue).toBeUndefined();

    for (const example of ["us", "europe", "asia-southeast1"]) {
      expect(GOOGLE_SECOPS_SUPPORTED_REGIONS).toContain(example);
      expect(regionRow).toContain(`\`${example}\``);
    }

    expect(regionRow).toContain("There is no default");
  });

  it("sends webhook and forwarded events to the ingest route, in the formats it accepts", () => {
    const route: string = readRepoFile(
      "App/FeatureSet/Telemetry/API/SecurityEventsIngest.ts",
    );
    const page: string = englishPage(GOOGLE_SECOPS);

    expect(route).toContain('"/security-events/v1/ingest"');
    expect(page).toContain("`https://oneuptime.com/security-events/v1/ingest`");
    expect(page).toContain(
      '"https://oneuptime.com/security-events/v1/ingest?format=udm"',
    );
    expect(Object.values(SecurityEventFormat).sort()).toEqual(
      ["udm", "ocsf", "google-secops-alert", "generic"].sort(),
    );
    expect(page).toContain(
      "`format` can be `udm`, `ocsf`, `google-secops-alert` or `generic`.",
    );
  });

  it("names the ingestion keys' page as the Project Settings menu reaches it", () => {
    const settingsMenu: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
    );

    expect(settingsMenu).toContain("Telemetry & APM");
    expect(settingsMenu).toContain("Ingestion Keys");
    expect(englishPage(GOOGLE_SECOPS)).toContain(
      `open ${bold("Project Settings → Telemetry & APM → Ingestion Keys")} and click ${bold("Create Ingestion Key")}`,
    );
  });
});

describe("every connection page together", () => {
  it("cover every Security Events connection of the catalog, one page each, by the docs path the catalog links to", () => {
    expect(
      SECURITY_CONNECTION_PAGES.map((page: string): string => {
        return `/docs/${page}`;
      }).sort(),
    ).toEqual(
      SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): string => {
          return definition.docsPath;
        },
      ).sort(),
    );
    // Every page but Google SecOps's is read by the tests every page shares.
    expect(
      CONNECTION_PAGES.map((entry: ConnectionPage): string => {
        return entry.page;
      }).sort(),
    ).toEqual(
      SECURITY_CONNECTION_PAGES.filter((page: string): boolean => {
        return page !== GOOGLE_SECOPS;
      }).sort(),
    );
  });

  it("open the Connections tab from the Products menu, at the route the Dashboard serves", () => {
    for (const page of SECURITY_CONNECTION_PAGES) {
      expect(englishPage(page)).toContain(
        `${bold("Products → Security Events → Connections")} (\`/dashboard/{projectId}/security-events/connections\`)`,
      );
    }
  });

  it("send a self-hosted install with no workers to the setting that ships off", () => {
    const configExample: string = readRepoFile("../config.example.env");

    expect(configExample).toContain("DISABLE_QUEUE_WORKERS=false");

    for (const page of SECURITY_CONNECTION_PAGES) {
      expect(englishPage(page)).toContain("`DISABLE_QUEUE_WORKERS=true`");
      expect(englishPage(page)).toContain("`worker.enabled: true`");
    }
  });
});
