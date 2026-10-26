import { CLOUD_ACCOUNTS } from "./CloudDocsPages";
import {
  DocsHeading,
  NAV_PAGES,
  anchorsOf,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { AZURE_MAX_METRICS_PER_RESOURCE } from "Common/Types/Cloud/CloudKeyMetrics";
import {
  CloudConnectionAuthMethod,
  CloudConnectionCatalog,
  CloudConnectionDefinition,
  READ_INTERVAL_FIELD_KEY,
  READ_SCOPE_FIELD_KEY,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
  AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION,
  AZURE_USD_PER_THOUSAND_METRIC_READS,
  GCP_FREE_TIME_SERIES_PER_MONTH,
  GCP_USD_PER_MILLION_TIME_SERIES,
} from "Common/Types/CloudConnection/CloudConnectionCost";
import {
  AWS_ORGANIZATION_ACTION_GROUP,
  AWS_READ_ONLY_ACTION_GROUPS,
  AWS_READ_ONLY_ACTIONS,
  AZURE_READ_ONLY_ROLE,
  AwsReadOnlyActionGroup,
  CloudConnectionSetupScope,
  GCP_READ_ONLY_ROLE,
  GCP_READ_ONLY_ROLES,
  getAwsAccessKeySetupCommand,
  getAzureSetupCommand,
  getCloudConnectionSetupCommand,
  getGcpSetupCommand,
} from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Connect a Cloud Account, held to the code that connects one: the commands
 * the form shows (CloudConnectionSetupCommands), word for word; the AWS
 * actions and the Azure and Google Cloud roles they grant; how often each
 * cloud is read and how far back (the catalog and CloudMetricWindows); the
 * prices the test's estimate uses (CloudConnectionCost); when a resource
 * gone from the cloud is archived; the variables a self-hosted OneUptime
 * gives its own AWS identity in; and the form's words the page names. Its
 * translations are held to it by CloudDocsTranslations.
 *
 * App tests read no React module, so the Dashboard's words are read from
 * its source files as text, and so are the server modules that reach a
 * database or a cloud.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const SERVER: string = "packages/Common/Server";

const SOURCES: Record<string, string> = {
  form: `${DASHBOARD}/Components/Cloud/Connect/CloudConnectionFormModal.tsx`,
  table: `${DASHBOARD}/Components/Cloud/Connect/CloudConnectionsTable.tsx`,
  sideMenu: `${DASHBOARD}/Pages/Cloud/SideMenu.tsx`,
  serverIdentity: `${SERVER}/Utils/CloudConnection/Aws/AwsServerIdentity.ts`,
  connectorTypes: `${SERVER}/Utils/CloudConnection/CloudConnectorTypes.ts`,
  lanes: `${SERVER}/Utils/CloudConnection/CloudConnectionLanes.ts`,
  changeWindow: `${SERVER}/Utils/CloudConnection/CloudChangeWindow.ts`,
  azure: `${SERVER}/Utils/CloudConnection/Azure/AzureCloudConnector.ts`,
  awsHealth: `${SERVER}/Utils/CloudConnection/Aws/AwsCloudConnector.ts`,
  windows: `${SERVER}/Utils/CloudConnection/CloudMetricWindows.ts`,
  resources: `${SERVER}/Services/CloudResourceService.ts`,
  resourceSync: `${SERVER}/Utils/CloudConnection/CloudConnectionResourceSync.ts`,
};

const BASH_FENCE: RegExp = /```bash\n([\s\S]*?)\n```/g;
const LINE_BREAK: RegExp = /\n/;
const HEADING_ANCHOR: RegExp = /#([a-z0-9-]+)$/;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

const PAGE: string = readPage("en", CLOUD_ACCOUNTS);

function bashBlocks(): Array<string> {
  return Array.from(PAGE.matchAll(BASH_FENCE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function section(heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(PAGE).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = PAGE.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

function definition(provider: CloudProvider): CloudConnectionDefinition {
  return getCloudConnectionDefinition(provider) as CloudConnectionDefinition;
}

// "1,000,000" as the page writes a count of things.
function written(value: number): string {
  return value.toLocaleString("en-US");
}

describe("Connect a Cloud Account", () => {
  it("is in the docs, under the Cloud group", () => {
    expect(NAV_PAGES).toContain(CLOUD_ACCOUNTS);
  });

  it("is where each cloud's guide link in the form lands, on that cloud's heading", () => {
    const anchors: Set<string> = anchorsOf("en", CLOUD_ACCOUNTS);

    for (const cloud of CloudConnectionCatalog) {
      expect(cloud.docsPath.startsWith(`/docs/${CLOUD_ACCOUNTS}#`)).toBe(true);
      expect(
        anchors.has(
          (
            cloud.docsPath.match(HEADING_ANCHOR) as RegExpMatchArray
          )[1] as string,
        ),
      ).toBe(true);
      expect(scanMarkdown(PAGE).headings).toContainEqual(
        expect.objectContaining({ level: 2, text: cloud.title }),
      );
    }
  });

  it("shows the access key, Azure and Google Cloud commands word for word, as the form shows them", () => {
    const blocks: Array<string> = bashBlocks();

    expect(blocks).toContain(getAwsAccessKeySetupCommand());
    expect(blocks).toContain(getAzureSetupCommand());
    expect(blocks).toContain(getGcpSetupCommand());
    // What to read: every subscription of the tenant, every project of the organization.
    expect(blocks).toContain(
      getAzureSetupCommand(CloudConnectionSetupScope.Organization),
    );
    expect(blocks).toContain(
      getGcpSetupCommand(CloudConnectionSetupScope.Organization),
    );
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
      ),
    ).toBe(getAwsAccessKeySetupCommand());
    // The role's command is the project's own: the page shows none.
    expect(PAGE).not.toContain("aws iam create-role");
  });

  it("lists every AWS action the access gets, by what it is for, and no other", () => {
    const rows: Array<Array<string>> = (
      tables(section("Amazon Web Services"))[0] as Array<Array<string>>
    ).slice(1);
    const groups: Array<AwsReadOnlyActionGroup> = [
      ...AWS_READ_ONLY_ACTION_GROUPS,
      AWS_ORGANIZATION_ACTION_GROUP,
    ];

    expect(
      rows.map((row: Array<string>): Array<unknown> => {
        return [
          row[0],
          (row[1] as string)
            .split(",")
            .map((action: string): string => {
              return action.split("`").join("").trim();
            })
            .sort(),
        ];
      }),
    ).toEqual(
      groups.map((group: AwsReadOnlyActionGroup): Array<unknown> => {
        return [group.purpose, [...group.actions].sort()];
      }),
    );
    // Every action of the role and the user is a row's.
    expect(
      rows
        .flatMap((row: Array<string>): Array<string> => {
          return (row[1] as string).split(",").map((action: string) => {
            return action.split("`").join("").trim();
          });
        })
        .filter((action: string): boolean => {
          return !AWS_ORGANIZATION_ACTION_GROUP.actions.includes(action);
        })
        .sort(),
    ).toEqual([...AWS_READ_ONLY_ACTIONS].sort());
  });

  it("names the roles the Azure and Google Cloud commands grant", () => {
    expect(section("Microsoft Azure")).toContain(`**${AZURE_READ_ONLY_ROLE}**`);
    expect(GCP_READ_ONLY_ROLE).toBe("roles/monitoring.viewer");

    // Each Google Cloud role the command grants, by the name its console shows.
    const consoleNames: Record<string, string> = {
      "roles/monitoring.viewer": "Monitoring Viewer",
      "roles/cloudasset.viewer": "Cloud Asset Viewer",
      "roles/logging.viewer": "Logs Viewer",
      "roles/servicehealth.viewer": "Service Health Viewer",
    };

    expect(Object.keys(consoleNames).sort()).toEqual(
      [...GCP_READ_ONLY_ROLES].sort(),
    );

    for (const role of GCP_READ_ONLY_ROLES) {
      expect(section("Google Cloud")).toContain(`**${consoleNames[role]}**`);
    }
  });

  it("names What to read as the form asks it, and the limits a connection reads to", () => {
    const scope: string | undefined = definition(
      CloudProvider.Azure,
    ).configFields.find((field: { key: string }): boolean => {
      return field.key === READ_SCOPE_FIELD_KEY;
    })?.title;

    expect(PAGE).toContain(`**${scope}**`);
    expect(source("connectorTypes")).toContain(
      "export const CLOUD_MAX_ORGANIZATION_ACCOUNTS: number = 50;",
    );
    expect(source("azure")).toContain(
      "export const AZURE_MAX_SUBSCRIPTIONS: number = 50;",
    );
    expect(PAGE).toContain("One connection reads up to 50 accounts.");
    expect(PAGE).toContain(
      "up to 50, unless you list some under **Subscriptions**",
    );
    expect(PAGE).toContain("reads up to 50 of its projects");
  });

  it("says how often the inventory is listed, how far back changes are read, and when an Azure secret is warned about", () => {
    expect(source("lanes")).toContain(
      "export const CLOUD_INVENTORY_INTERVAL_MS: number = 30 * 60 * 1000;",
    );
    expect(PAGE).toContain(
      "every 30 minutes a read lists every resource again",
    );
    expect(source("changeWindow")).toContain(
      "export const CLOUD_CHANGE_FIRST_LOOK_BACK_MS: number = 2 * 60 * 60 * 1000;",
    );
    expect(PAGE).toContain("2 hours back for changes");
    expect(source("azure")).toContain(
      "export const AZURE_SECRET_EXPIRY_WARNING_DAYS: number = 30;",
    );
    expect(PAGE).toContain("from 30 days before, each read warns about it");
    // An account on no support plan that includes AWS Health is asked a day later.
    expect(source("awsHealth")).toContain(
      "const HEALTH_PAUSE_MS: number = DAY_MS;",
    );
    expect(PAGE).toContain("OneUptime asks again a day later");
  });

  it("says how often each cloud is read, as the catalog defaults", () => {
    const rows: Array<Array<string>> = tables(
      section("What OneUptime reads"),
    )[0] as Array<Array<string>>;
    const header: Array<string> = rows[0] as Array<string>;
    const readEvery: Array<string> = rows.find(
      (row: Array<string>): boolean => {
        return row[0] === "Read every";
      },
    ) as Array<string>;

    expect(header).toEqual(["", "AWS", "Azure", "Google Cloud"]);

    for (const [column, provider] of [
      [1, CloudProvider.AWS],
      [2, CloudProvider.Azure],
      [3, CloudProvider.GCP],
    ] as Array<[number, CloudProvider]>) {
      expect(readEvery[column]).toBe(
        `${definition(provider).defaultReadIntervalInMinutes} minutes`,
      );
    }

    expect(PAGE).toContain(
      `Every ${definition(CloudProvider.Azure).defaultReadIntervalInMinutes} minutes for Azure and Google Cloud, and every ${definition(CloudProvider.AWS).defaultReadIntervalInMinutes} minutes for AWS`,
    );
  });

  it("says how many key metrics an Azure resource is read with", () => {
    expect(PAGE).toContain(
      `Up to ${AZURE_MAX_METRICS_PER_RESOURCE} key metrics per resource`,
    );
  });

  it("says how far back a first read and a read after a pause go", () => {
    const windows: string = source("windows");

    expect(windows).toContain("firstReadBackMs: HOUR_MS");
    expect(windows).toContain("maxBackMs: 6 * HOUR_MS");
    expect(PAGE).toContain("goes an hour back");
    expect(PAGE).toContain("goes back 6 hours at most");
  });

  it("says when a resource gone from the cloud is archived", () => {
    expect(source("resources")).toContain(
      "const DEFAULT_MONITORED_RESOURCE_AUTO_ARCHIVE_DAYS: number = 7;",
    );
    // A complete Azure listing archives what it no longer has, at once.
    expect(source("resourceSync")).toContain(
      "A resource gone from an account listed in full is archived.",
    );

    const row: Array<string> = (
      tables(section("What OneUptime reads"))[0] as Array<Array<string>>
    ).find((cells: Array<string>): boolean => {
      return cells[0] === "A deleted resource";
    }) as Array<string>;

    expect(row).toEqual([
      "A deleted resource",
      "Archived once a full listing no longer has it",
      "Archived once a full listing no longer has it",
      "Archived once a full listing no longer has it",
    ]);
    // A resource no listing has, only metrics: after the 7 days.
    expect(PAGE).toContain(
      "A resource that only reports metrics, which no listing has, is archived after 7 days without metrics.",
    );
  });

  it("states each cloud's price as the test's estimate uses it", () => {
    const rows: Array<Array<string>> = (
      tables(section("What OneUptime reads"))[1] as Array<Array<string>>
    ).slice(1);
    const price: (cloud: string) => string = (cloud: string): string => {
      return (
        rows.find((row: Array<string>): boolean => {
          return row[0] === cloud;
        }) as Array<string>
      )[1] as string;
    };

    expect(price("AWS")).toContain(
      `$${AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS} per 1,000 metrics`,
    );
    expect(price("Azure")).toContain(
      `The first ${written(AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION)} metric reads a month of each subscription are free, then $${AZURE_USD_PER_THOUSAND_METRIC_READS} per 1,000`,
    );
    expect(price("Google Cloud")).toContain(
      `The first ${written(GCP_FREE_TIME_SERIES_PER_MONTH)} time series read a month are free, then $${GCP_USD_PER_MILLION_TIME_SERIES.toFixed(2)} per million`,
    );
  });

  it("names the variables a self-hosted OneUptime's AWS identity is read from", () => {
    const identity: string = source("serverIdentity");

    for (const variable of [
      "CLOUD_CONNECT_AWS_ACCESS_KEY_ID",
      "CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY",
    ]) {
      expect(identity).toContain(`process.env["${variable}"]`);
      expect(PAGE).toContain(`\`${variable}\``);
    }
  });

  it("names the form's fields, buttons and menu as the dashboard draws them", () => {
    const form: string = source("form");
    const table: string = source("table");
    const readInterval: string | undefined = definition(
      CloudProvider.AWS,
    ).configFields.find((field: { key: string }): boolean => {
      return field.key === READ_INTERVAL_FIELD_KEY;
    })?.title;

    expect(form).toContain('title: "What the command printed"');
    expect(PAGE).toContain("**What the command printed**");
    expect(PAGE).toContain(`**${readInterval}**`);
    expect(PAGE).toContain(`**${MORE_FIELDS_SECTION_TITLE}**`);
    expect(table).toContain('title: "View error"');
    expect(PAGE).toContain("**View error**");
    expect(source("sideMenu")).toContain('title: "Connect"');
    expect(PAGE).toContain("**Cloud → Connect**");

    for (const method of definition(CloudProvider.AWS).authMethods) {
      expect(PAGE).toContain(`**${method.title}**`);
    }

    for (const cloud of CloudConnectionCatalog) {
      expect(PAGE).toContain(`pick **${cloud.title}**`);
    }
  });
});
