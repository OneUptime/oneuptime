import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";
import { AWS_LOG_GROUP_PLATFORMS } from "Common/Types/Cloud/CloudLogGroups";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Cloud Environments' "Apps and deploys" section against the code it
 * describes: each platform's row names the attributes its descriptor names
 * an app by, keeps it apart by and reads its revision from
 * (MANAGED_CLOUD_PLATFORMS, which CloudAppIdentity reads), and the numbers
 * it states - the rollback window, the hourly cap, the retention days and
 * their setting - are the ones the services use. The services reach a
 * database, so their constants are read as text.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const HUB: string = path.join(
  PACKAGES,
  "App/FeatureSet/Docs/Content/en/telemetry/cloud-environments.md",
);
const CHANGES: string = path.join(
  PACKAGES,
  "App/FeatureSet/Docs/Content/en/telemetry/change-events.md",
);
const REVISION_SERVICE: string = path.join(
  PACKAGES,
  "Common/Server/Services/CloudAppRevisionService.ts",
);
const APP_SERVICE: string = path.join(
  PACKAGES,
  "Common/Server/Services/CloudAppService.ts",
);

const hub: string = fs.readFileSync(HUB, "utf8");

// The body of a "## " section, up to the next one.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect(start).toBeGreaterThan(-1);

  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && line.startsWith("## ");
  });

  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

// A numeric constant of a source file: `NAME: number = 12;`.
function constantOf(file: string, name: string): number {
  const match: RegExpMatchArray | null = fs
    .readFileSync(file, "utf8")
    .match(new RegExp(`${name}: number = (\\d+);`));

  expect(match).not.toBeNull();

  return Number((match as RegExpMatchArray)[1]);
}

// The attributes a cell names, in the order it names them.
function codeIn(cell: string): Array<string> {
  return Array.from(cell.matchAll(/`([^`]+)`/g), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
}

const apps: string = section(hub, "## Apps and deploys");

// The table's body rows, by platform product name.
const rows: Map<string, Array<string>> = new Map(
  apps
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| ") && !line.startsWith("| -");
    })
    .slice(1)
    .map((line: string): [string, Array<string>] => {
      const cells: Array<string> = line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
      return [cells[0] as string, cells.slice(1)];
    }),
);

describe("Apps and deploys, on Cloud Environments", () => {
  it("has a row for every managed platform, and no other", () => {
    expect(Array.from(rows.keys()).sort()).toEqual(
      MANAGED_CLOUD_PLATFORMS.map(
        (descriptor: ManagedCloudPlatformDescriptor): string => {
          return descriptor.productName;
        },
      ).sort(),
    );
  });

  it.each(MANAGED_CLOUD_PLATFORMS)(
    "$productName: the attributes that name an app, keep it apart and give its revision, in the order ingest reads them",
    (descriptor: ManagedCloudPlatformDescriptor) => {
      const [app, group, revision] = rows.get(descriptor.productName) as [
        string,
        string,
        string,
      ];

      expect(codeIn(app)).toEqual(descriptor.appAttributes);
      /*
       * The group is the first attribute ingest reads it from: Beanstalk and
       * App Service also take the older deployment.environment.
       */
      expect(codeIn(group)).toEqual(descriptor.appGroupAttributes.slice(0, 1));
      expect(codeIn(revision)).toEqual(descriptor.revisionAttributes);
    },
  );

  it("states the rollback window, the hourly cap and the retention the services use", () => {
    const window: number = constantOf(
      REVISION_SERVICE,
      "CLOUD_APP_REVISION_LIVE_MINUTES",
    );
    const cap: number = constantOf(
      REVISION_SERVICE,
      "MAX_NEW_CLOUD_APP_REVISIONS_PER_HOUR",
    );
    const days: number = constantOf(
      APP_SERVICE,
      "DEFAULT_CLOUD_APP_RETENTION_DAYS",
    );

    expect(apps).toContain(
      `When the revision an app runs reports nothing for ${window} minutes while one it ran before keeps running, OneUptime records a rollback to that one.`,
    );
    expect(apps).toContain(
      `**At most ${cap} new revisions of an app are recorded in an hour.**`,
    );
    expect(apps).toContain(
      `An app that sends nothing for ${days} days is removed with its revisions`,
    );
    expect(apps).toContain(`\`CLOUD_APP_RETENTION_DAYS\` sets the ${days}.`);
    expect(fs.readFileSync(APP_SERVICE, "utf8")).toContain(
      'process.env["CLOUD_APP_RETENTION_DAYS"]',
    );
  });

  it("says the SDK's unknown_service names no app, as ingest refuses it", () => {
    expect(apps).toContain(
      "The `unknown_service` an SDK reports when no `service.name` is set names no app.",
    );
    expect(
      fs.readFileSync(
        path.join(
          PACKAGES,
          "Common/Server/Utils/Telemetry/CloudAppIdentity.ts",
        ),
        "utf8",
      ),
    ).toContain('UNKNOWN_SERVICE_NAME_PREFIX: string = "unknown_service"');
  });

  it("says a stream's CloudWatch Logs reach their environment and make no app, as discovery has it", () => {
    const bullet: string | undefined = hub
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- **A stream's CloudWatch Logs count too.**");
      });

    expect(bullet).toBeDefined();
    expect(bullet).toContain(
      "[streams its CloudWatch Logs](/docs/telemetry/cloud-streaming)",
    );
    // Every platform a log group rule stamps on a stream's logs, named.
    const names: Record<string, string> = {
      aws_app_runner: "App Runner services",
      aws_elastic_beanstalk: "Elastic Beanstalk environments",
      aws_ecs: "ECS tasks and clusters",
    };
    expect([...AWS_LOG_GROUP_PLATFORMS].sort()).toEqual(
      Object.keys(names).sort(),
    );
    for (const platform of AWS_LOG_GROUP_PLATFORMS) {
      expect(bullet).toContain(names[platform]);
    }
    expect(bullet).toContain("on their environment's **Logs** tab");
    expect(bullet).toContain(
      "They make no app: an app is named by its own telemetry.",
    );
    // Discovery refuses an app to what a connection delivers.
    expect(
      fs.readFileSync(
        path.join(
          PACKAGES,
          "Common/Server/Utils/Telemetry/CloudAppIdentity.ts",
        ),
        "utf8",
      ),
    ).toContain(
      "if (!descriptor || isCloudConnectionDeliveredResource(data.getAttribute)) {",
    );
  });

  it("is linked from the page's opening bullets and from Deploys and Changes", () => {
    expect(hub).toContain("see [Apps and deploys](#apps-and-deploys).");
    expect(fs.readFileSync(CHANGES, "utf8")).toContain(
      "[managed app platform](/docs/telemetry/cloud-environments#apps-and-deploys)",
    );
  });

  it("names the requests the overview counts: where work enters a service", () => {
    expect(section(hub, "## What you get")).toContain(
      "from the spans where requests enter your services",
    );
  });
});

/*
 * #6149's follow-up: All Environments and All Apps filter by a Cloud Account
 * chip, and Cloud's Overview links its App Platforms counts to those lists
 * with the chip already set. The hub says so, and Cloud's own page names
 * the card - each against the code that draws it, read as text (the
 * Dashboard's modules reach React).
 */
describe("the lists by cloud account, on Cloud Environments", () => {
  const DASHBOARD: string = path.join(PACKAGES, "App/FeatureSet/Dashboard/src");
  const FACET: string = fs.readFileSync(
    path.join(DASHBOARD, "Components/AppPlatforms/AppPlatformsAccountFacet.ts"),
    "utf8",
  );
  const ROUTES: string = fs.readFileSync(
    path.join(DASHBOARD, "Components/AppPlatforms/AppPlatformsListRoutes.ts"),
    "utf8",
  );
  const CARD: string = fs.readFileSync(
    path.join(DASHBOARD, "Components/Cloud/CloudAppPlatformsCard.tsx"),
    "utf8",
  );
  const ACCOUNTS: string = fs.readFileSync(
    path.join(
      PACKAGES,
      "App/FeatureSet/Docs/Content/en/telemetry/cloud-accounts.md",
    ),
    "utf8",
  );
  const paragraph: string | undefined = hub
    .split("\n")
    .find((line: string): boolean => {
      return line.includes("**Cloud Account** chip");
    });

  it("sits under the opening paragraph that lists the two lists", () => {
    const lines: Array<string> = hub.split("\n");
    const at: number = lines.indexOf(paragraph as string);

    expect(paragraph).toBeDefined();
    expect(lines[at - 2]).toContain(
      "**App Platforms → All Environments** lists every one.",
    );
  });

  it("names the chip as both lists draw it, with what it keeps", () => {
    expect(FACET).toContain(
      'CLOUD_ACCOUNT_FACET_LABEL: string =\n  translationKey("Cloud Account");',
    );
    // "is" and "is not": the accounts picked, or every other one.
    expect(FACET).toContain(
      'CLOUD_ACCOUNT_FACET_OPERATORS: Array<FilterOperator> = [\n  "is",\n  "is_not",\n];',
    );
    // Each account under its cloud: the option's group.
    expect(FACET).toContain("...(provider ? { group: provider } : {}),");
    expect(paragraph).toContain(
      "filter **All Environments** or **All Apps** by the **Cloud Account** chip",
    );
    expect(paragraph).toContain(
      "it lists each account the environments are in, under its cloud, and keeps the accounts you pick, or every other one.",
    );
    // Both lists draw it.
    expect(
      fs.readFileSync(
        path.join(DASHBOARD, "Pages/AppPlatforms/Environments.tsx"),
        "utf8",
      ),
    ).toContain("getEnvironmentsCloudAccountFacet(");
    expect(
      fs.readFileSync(
        path.join(DASHBOARD, "Components/AppPlatforms/CloudAppsTable.tsx"),
        "utf8",
      ),
    ).toContain("getAppsCloudAccountFacet(props.environments)");
  });

  it("says Cloud's Overview counts link to the lists with the chip set, as the card's links are built", () => {
    expect(CARD).toContain(
      'APP_PLATFORMS_CARD_TITLE: string = translationKey("App Platforms");',
    );
    expect(CARD).toContain(
      "to={getAppPlatformsEnvironmentsRoute(counts.accountIds)}",
    );
    expect(CARD).toContain("to={getAppPlatformsAppsRoute(counts.accountIds)}");
    // The link sets the chip to "is" those accounts, visibly and clearably.
    expect(ROUTES).toContain("[CLOUD_ACCOUNT_FACET_KEY]: accountIds,");
    expect(ROUTES).toContain('[CLOUD_ACCOUNT_FACET_KEY]: "is",');
    expect(
      fs.readFileSync(path.join(DASHBOARD, "Pages/Cloud/Overview.tsx"), "utf8"),
    ).toContain("<CloudAppPlatformsCard accounts={read.accounts} />");
    expect(paragraph).toContain(
      "On **Cloud → Overview**, the **App Platforms** card counts the environments and apps in your connected cloud accounts, and each count opens its list with the chip already set to those accounts.",
    );
    expect(paragraph).toContain("Clear the chip to see the whole list.");
  });

  it("is named on Cloud's own page, where its Overview is", () => {
    const bullet: string | undefined = ACCOUNTS.split("\n").find(
      (line: string): boolean => {
        return line.startsWith("- **Cloud opens on its Overview.**");
      },
    );

    expect(bullet).toContain(
      "its **App Platforms** card counts their environments and apps, and each count opens that list in App Platforms, already filtered to those accounts.",
    );
    // Drawn only while the accounts run something there.
    expect(CARD).toContain("if (!counts || counts.environments === 0) {");
    expect(bullet).toContain(
      "When your accounts run apps on managed app platforms,",
    );
  });
});
