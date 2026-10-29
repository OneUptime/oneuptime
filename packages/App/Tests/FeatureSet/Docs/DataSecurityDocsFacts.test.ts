import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DocsHeading,
  NAV_PAGES,
  TRANSLATED_LANGUAGES,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  CARD_LINE,
  cardLines,
  cardTargets,
  comparableFence,
  inlineCode,
  listItemCount,
  strayMarkers,
  tableShape,
} from "./DocsTranslationChecks";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudConnectionDefinition,
  CloudConnectionField,
  DATA_SECURITY_FIELD_KEY,
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_DATA_SECURITY_CONFIGURATION_ACTION_GROUPS,
  AWS_DATA_SECURITY_CONTENT_ACTIONS,
  AWS_DATA_SECURITY_CONTENT_RESOURCES,
  AWS_DATA_SECURITY_GROUP_NAME,
  AWS_DATA_SECURITY_KMS_CONDITION,
  AWS_DATA_SECURITY_POLICY_NAME,
  AWS_DATA_SECURITY_RESPONSE_ACTIONS,
  AWS_DATA_SECURITY_RESPONSE_POLICY_NAME,
  AZURE_DATA_SECURITY_CONTENT_ROLE,
  AZURE_DATA_SECURITY_RESPONSE_ACTIONS,
  AZURE_DATA_SECURITY_RESPONSE_ROLE,
  AZURE_READ_ONLY_ROLE,
  AwsReadOnlyActionGroup,
  CloudConnectionSetupScope,
  GCP_DATA_SECURITY_CONTENT_ROLES,
  GCP_DATA_SECURITY_CONTENT_SERVICES,
  GCP_DATA_SECURITY_RESPONSE_PERMISSIONS,
  GCP_DATA_SECURITY_RESPONSE_ROLE_ID,
  getAwsAccessKeySetupCommand,
  getAwsDataSecurityPolicy,
  getAwsDataSecurityPolicyDocument,
  getAwsRoleSetupCommand,
  getAzureSetupCommand,
  getGcpSetupCommand,
} from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "Common/Types/DataSecurity/ComplianceFramework";
import {
  COMPLIANCE_REQUIREMENTS,
  ComplianceRequirementInfo,
  getChecksForRequirement,
} from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory, {
  ALL_DATA_CATEGORIES,
  DATA_CATEGORY_DESCRIPTION,
  isPersonalDataCategory,
} from "Common/Types/DataSecurity/DataCategory";
import {
  ALL_DATA_SECURITY_CHECK_GROUPS,
  DATA_SECURITY_CHECKS,
  DataSecurityCheckGroup,
  DataSecurityCheckInfo,
  DataSecurityCheckStatus,
  getDataSecurityCheck,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import { DATA_SECURITY_API_ROUTES } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  BLOCKABLE_DATA_STORE_KINDS,
  DATA_SECURITY_RESPONSE_ACTION_CHECKS,
  DataSecurityResponseAction,
  SHAREABLE_DATA_STORE_KINDS,
} from "Common/Types/DataSecurity/DataSecurityResponseAction";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionCategory,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { regionMatches } from "Common/Types/DataSecurity/DataSecurityResidency";
import {
  RISK_BASE_BY_SEVERITY,
  getRiskScore,
  volumeWeight,
} from "Common/Types/DataSecurity/DataSecurityRisk";
import DataSensitivity, {
  ALL_DATA_SENSITIVITIES,
  DATA_SENSITIVITY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataSensitivity";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import DataStoreEnvironment from "Common/Types/DataSecurity/DataStoreEnvironment";
import {
  DATA_STORE_KINDS,
  DataStoreFamily,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
} from "Common/Types/DataSecurity/DataStoreKind";
import {
  ALL_DATA_STORE_EXPOSURES,
  DATA_STORE_EXPOSURE_DESCRIPTION,
  DATA_STORE_EXPOSURE_WEIGHT,
  DataStoreExposure,
} from "Common/Types/DataSecurity/DataStorePosture";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "Common/Types/DataSecurity/DataTypeCatalog";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import { ALL_CUSTOM_DATA_TYPE_VALIDATORS } from "Common/Utils/DataSecurity/CustomDataTypeDetector";
import {
  CONTEXT_AFTER,
  CONTEXT_BEFORE,
} from "Common/Utils/DataSecurity/Detector";
import {
  MAX_FIELD_VALUES,
  MAX_FIELD_VALUE_LENGTH,
} from "Common/Utils/DataSecurity/FieldClassifier";
import { MAX_MASKED_SAMPLES } from "Common/Utils/DataSecurity/FindingTally";
import {
  maskCardNumber,
  maskEmail,
  maskValue,
} from "Common/Utils/DataSecurity/Masking";
import {
  MAX_SCANNED_TEXT_LENGTH,
  WINDOW_OVERLAP,
  WINDOW_SIZE,
} from "Common/Utils/DataSecurity/TextScanner";
import {
  FINGERPRINT_BITS,
  FINGERPRINT_SLOTS,
} from "Common/Server/Utils/DataSecurity/Fingerprint";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Data Security docs (Content/en/data-security), held to the product they
 * describe, so a table can never drift from the catalog it copies:
 *
 *   - every built-in data type, with its id, line, sensitivity and country
 *     (Types/DataSecurity/DataTypeCatalog), and how values are found
 *     (Utils/DataSecurity: the context window, the windows text is read in,
 *     the field thresholds);
 *   - every check, by group, with what it runs on, what it checks and its
 *     severity for each sensitivity (DataSecurityCheckCatalog), the risk
 *     score's factors (DataSecurityRisk) and an accepted risk's longest life;
 *   - the three levels of a cloud connection and exactly what each grants
 *     (CloudConnectionCatalog, CloudConnectionSetupCommands), the project's
 *     settings and their defaults (DataSecuritySetting and its service), and
 *     what a finding keeps (Masking, FindingTally, Fingerprint);
 *   - telemetry scans' limits (TelemetryDataScanner) and Scrub It's rules
 *     (TelemetryScrubCoverage), flows (DataSecurityFlows), exposure and
 *     residency, the frameworks and their requirements
 *     (ComplianceFramework, ComplianceRequirementCatalog), and the
 *     integrations, API routes and MCP records.
 *
 * Server modules that reach a database, a cloud or ClickHouse are read as
 * text, as the other docs facts suites read them. The translations are held
 * to the English pages here too: the same tables row for row, the same ids
 * in the same rows, the same code, cards and list items, and no marker left
 * on the drawn page.
 */

const REPO: string = path.resolve(__dirname, "../../../../..");

const INDEX: string = "data-security/index";
const SETUP: string = "data-security/setup";
const DATA_TYPES: string = "data-security/data-types";
const CHECKS: string = "data-security/checks-and-issues";
const TELEMETRY: string = "data-security/telemetry";
const FLOWS: string = "data-security/flows-access-residency";
const COMPLIANCE: string = "data-security/compliance";
const INTEGRATIONS: string = "data-security/integrations";

const PAGES: ReadonlyArray<string> = [
  INDEX,
  SETUP,
  DATA_TYPES,
  CHECKS,
  TELEMETRY,
  FLOWS,
  COMPLIANCE,
  INTEGRATIONS,
];

const LINE_BREAK: RegExp = /\n/;
const THOUSANDS: RegExp = /,/g;
const INLINE_ID: RegExp = /`([a-z0-9-]+)`/;

function source(file: string): string {
  return fs.readFileSync(path.join(REPO, "packages", file), "utf8");
}

const SERVER: string = "Common/Server/Utils/DataSecurity";

function english(page: string): string {
  return readPage("en", page);
}

// The lines under a heading, to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const level: number = (heading.match(/^#+/)?.[0] || "").length;
  const text: string = heading.replace(/^#+\s+/, "");
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.level === level && entry.text === text;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// A table's body rows, without its header.
function rows(table: Array<Array<string>> | undefined): Array<Array<string>> {
  expect(table).toBeDefined();
  return (table as Array<Array<string>>).slice(1);
}

function only<T>(items: Array<T>): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

// "2,000" as a number.
function count(text: string): number {
  return Number(text.replace(THOUSANDS, ""));
}

function withoutTicks(text: string): string {
  return text.split("`").join("").trim();
}

function list(cell: string): Array<string> {
  return cell.split(",").map(withoutTicks);
}

// A number constant of a source file, by its name.
function constant(file: string, name: string): number {
  const match: RegExpMatchArray | null = source(file).match(
    new RegExp(`\\b${name}: number =\\s*([0-9_* ]+);`),
  );

  expect({ file, name, found: Boolean(match) }).toEqual({
    file,
    name,
    found: true,
  });

  return (match?.[1] || "")
    .replace(/_/g, "")
    .split("*")
    .map((part: string): number => {
      return Number(part.trim());
    })
    .reduce((product: number, factor: number): number => {
      return product * factor;
    }, 1);
}

// How a check's table row names what it runs on.
function runsOn(check: DataSecurityCheckInfo): string {
  if (check.kinds) {
    return check.kinds.join(", ");
  }

  if (!check.families) {
    return "Every store";
  }

  const storing: Array<string> = Object.values(DataStoreFamily).filter(
    (family: string): boolean => {
      return family !== DataStoreFamily.Telemetry;
    },
  );

  if (
    check.families.length === storing.length &&
    storing.every((family: string): boolean => {
      return (check.families as ReadonlyArray<string>).includes(family);
    })
  ) {
    return "Every store but telemetry";
  }

  return check.families.join(", ");
}

// A check's severity for Restricted, Confidential, Internal and Public data.
function severities(check: DataSecurityCheckInfo): string {
  return ALL_DATA_SENSITIVITIES.map((sensitivity: DataSensitivity): string => {
    return check.severityBySensitivity[sensitivity] || "—";
  }).join(" / ");
}

function categoriesInCatalogOrder(): Array<DataCategory> {
  const categories: Array<DataCategory> = [];

  for (const info of DATA_TYPE_CATALOG) {
    if (!categories.includes(info.category)) {
      categories.push(info.category);
    }
  }

  return categories;
}

// A setting's title and default, as the model declares them.
function settingDefault(title: string): string | null {
  const model: string = source(
    "Common/Models/DatabaseModels/DataSecuritySetting.ts",
  );
  const at: number = model.indexOf(`title: "${title}"`);

  expect({ title, found: at >= 0 }).toEqual({ title, found: true });

  const columnEnd: number = model.indexOf("public ", at);
  const declaration: string = model.slice(at, columnEnd);
  const value: RegExpMatchArray | null = declaration.match(
    /\n\s+default: ([^,\n]+),/,
  );

  return value ? (value[1] as string).trim() : null;
}

describe("Data Security in the docs' navigation", () => {
  it("is a group of its own beside Security, opening on its overview", () => {
    const groups: Array<string> = DocsNav.map((group: NavGroup): string => {
      return group.title;
    });
    const group: NavGroup = DocsNav.find((candidate: NavGroup): boolean => {
      return candidate.title === "Data Security";
    }) as NavGroup;

    expect(group).toBeDefined();
    expect(group.section).toBe("Observability");
    expect(groups.indexOf("Data Security")).toBe(
      groups.indexOf("Security") + 1,
    );
    expect(
      group.links.map((link: NavLink): string => {
        return link.url;
      }),
    ).toEqual(
      PAGES.map((page: string): string => {
        return `/docs/${page}`;
      }),
    );

    for (const page of PAGES) {
      expect(NAV_PAGES).toContain(page);
    }
  });

  it("is where the Dashboard's Data Security guide sends people", () => {
    expect(
      source(
        "App/FeatureSet/Dashboard/src/Pages/DataSecurity/Documentation.tsx",
      ),
    ).toContain("/data-security/index`");
  });
});

describe("Data Security overview", () => {
  const page: string = english(INDEX);

  it("counts the data types, checks and frameworks there are", () => {
    expect(page).toContain(`${DATA_TYPE_CATALOG.length} data types`);
    expect(page).toContain(
      `${DATA_SECURITY_CHECKS.length} checks of each store`,
    );
    expect(ALL_COMPLIANCE_FRAMEWORKS).toHaveLength(9);
    expect(page).toContain("nine frameworks");
  });

  it("lists every kind of store, by where it lives, and which have content samples", () => {
    const providers: Array<[string, DataStoreProvider]> = [
      ["AWS", DataStoreProvider.Aws],
      ["Azure", DataStoreProvider.Azure],
      ["Google Cloud", DataStoreProvider.Gcp],
      ["Databases you run", DataStoreProvider.SelfManaged],
      ["OneUptime", DataStoreProvider.OneUptime],
    ];

    expect(
      rows(tables(section(page, "## What counts as a data store"))[0]),
    ).toEqual(
      providers.map(([where, provider]: [string, DataStoreProvider]) => {
        const kinds: Array<DataStoreKindInfo> = DATA_STORE_KINDS.filter(
          (info: DataStoreKindInfo): boolean => {
            return info.provider === provider;
          },
        );

        return [
          where,
          kinds
            .map((info: DataStoreKindInfo): string => {
              return info.kind;
            })
            .join(", "),
          kinds
            .filter((info: DataStoreKindInfo): boolean => {
              return info.contentScannable;
            })
            .map((info: DataStoreKindInfo): string => {
              return info.kind;
            })
            .join(", "),
        ];
      }),
    );
    expect(
      new Set(
        DATA_STORE_KINDS.map((info: DataStoreKindInfo): string => {
          return info.provider;
        }),
      ).size,
    ).toBe(providers.length);
  });

  it("gives the schedule the Workers run", () => {
    const jobs: string = source(
      "App/FeatureSet/Workers/Jobs/DataSecurity/DataSecurityJobs.ts",
    );
    const schedule: string = section(page, "## How often it runs");

    for (const [job, cron] of [
      ["DataSecurity:Discover", "EVERY_FIFTEEN_MINUTE"],
      ["DataSecurity:ReadDueConnections", "EVERY_HOUR"],
      ["DataSecurity:ScanTelemetry", "EVERY_HOUR"],
      ["DataSecurity:EvaluateAll", "EVERY_DAY"],
    ] as Array<[string, string]>) {
      const at: number = jobs.indexOf(`"${job}"`);

      expect({ job, found: at >= 0 }).toEqual({ job, found: true });
      expect(jobs.slice(at, at + 200)).toContain(`schedule: ${cron},`);
    }

    expect(schedule).toContain("| Find new stores | Every 15 minutes |");
    expect(schedule).toContain(
      "| Sample each service's telemetry | Every hour, the last hour of it |",
    );
    expect(schedule).toContain("and once a day |");
    expect(
      constant(
        `${SERVER}/DataSecurityRunner.ts`,
        "CONFIGURATION_READ_INTERVAL_IN_HOURS",
      ),
    ).toBe(24);
    expect(settingDefault("Scan Every (Hours)")).toBe("24");
    expect(schedule).toContain("| Sample a store's content | Every 24 hours,");
    expect(source("Common/Server/API/DataSecurityAPI.ts")).toContain(
      ".slice(0, 5)",
    );
    expect(page).toContain("the **Overview** shows the five riskiest");
  });

  it("names who may set it up and read it, as the models allow", () => {
    const setting: string = source(
      "Common/Models/DatabaseModels/DataSecuritySetting.ts",
    );
    const store: string = source("Common/Models/DatabaseModels/DataStore.ts");
    const updates: string = setting.slice(
      setting.indexOf("const updatePermissions"),
      setting.indexOf("const deletePermissions"),
    );
    const reads: string = store.slice(
      store.indexOf("const readPermissions"),
      store.indexOf("const createPermissions"),
    );

    expect(updates).toContain("Permission.SecurityAdmin");
    expect(updates).not.toContain("Permission.SecurityMember");
    expect(reads).toContain("Permission.SecurityViewer");
    expect(reads).not.toContain("Permission.ProjectMember");
  });
});

describe("Set Up Data Security", () => {
  const page: string = english(SETUP);

  it("names the levels as the connection form offers them, off by default", () => {
    for (const provider of [
      CloudProvider.AWS,
      CloudProvider.Azure,
      CloudProvider.GCP,
    ]) {
      const field: CloudConnectionField | undefined = (
        getCloudConnectionDefinition(provider) as CloudConnectionDefinition
      ).configFields.find((candidate: CloudConnectionField): boolean => {
        return candidate.key === DATA_SECURITY_FIELD_KEY;
      });

      expect(field?.title).toBe("Data security");
      expect(field?.defaultValue).toBe("off");
      expect(
        (field?.options || []).map((option: { label: string }): string => {
          return option.label;
        }),
      ).toEqual([
        "Off",
        "Configuration only",
        "Configuration and content samples",
      ]);
    }

    expect(
      rows(
        tables(section(page, "## Choose a level for each connection"))[0],
      ).map((row: Array<string>): string => {
        return row[1] as string;
      }),
    ).toEqual([
      "**Off**",
      "**Configuration only**",
      "**Configuration and content samples**",
    ]);
    expect(page).toContain("Under **More fields**, set **Data security**");
  });

  it("lists every AWS action of the configuration level, by what it is for", () => {
    const aws: string = section(page, "### Amazon Web Services");

    expect(aws).toContain(`\`${AWS_DATA_SECURITY_POLICY_NAME}\``);
    expect(
      rows(tables(aws)[0]).map((row: Array<string>): Array<unknown> => {
        return [row[0], list(row[1] as string).sort()];
      }),
    ).toEqual(
      AWS_DATA_SECURITY_CONFIGURATION_ACTION_GROUPS.map(
        (group: AwsReadOnlyActionGroup): Array<unknown> => {
          return [group.purpose, [...group.actions].sort()];
        },
      ),
    );
  });

  it("lists what the content level adds, each on its own resources", () => {
    const aws: string = section(page, "### Amazon Web Services");
    const content: Array<Array<string>> = rows(tables(aws)[1]);

    expect(
      content.map((row: Array<string>): string => {
        return withoutTicks(row[0] as string);
      }),
    ).toEqual(AWS_DATA_SECURITY_CONTENT_ACTIONS);

    for (const row of content) {
      const action: string = withoutTicks(row[0] as string);

      expect(row[1]).toContain(
        `\`${AWS_DATA_SECURITY_CONTENT_RESOURCES[action] as string}\``,
      );
    }

    expect(content[2]?.[1]).toContain(
      `\`${AWS_DATA_SECURITY_KMS_CONDITION["StringLike"]?.["kms:ViaService"] as string}\``,
    );
    expect(aws).toContain(
      `the policy goes on a group, \`${AWS_DATA_SECURITY_GROUP_NAME}\``,
    );
  });

  it("shows the content level's whole policy as the command writes it", () => {
    const json: string = only(
      scanMarkdown(section(page, "### Amazon Web Services")).fences.filter(
        (fence: { lang: string }): boolean => {
          return fence.lang === "json";
        },
      ),
    ).code;

    expect(JSON.parse(json)).toEqual(getAwsDataSecurityPolicy("content"));
    expect(json).toBe(
      JSON.stringify(getAwsDataSecurityPolicy("content"), null, 2),
    );
    expect(getAwsDataSecurityPolicy("off")).toBeNull();
  });

  it("names the Azure and Google Cloud roles the content level adds", () => {
    expect(section(page, "### Microsoft Azure")).toContain(
      `**${AZURE_READ_ONLY_ROLE}**`,
    );
    expect(section(page, "### Microsoft Azure")).toContain(
      `**${AZURE_DATA_SECURITY_CONTENT_ROLE}**`,
    );

    const google: string = section(page, "### Google Cloud");

    for (const role of GCP_DATA_SECURITY_CONTENT_ROLES) {
      expect(google).toContain(`\`${role}\``);
    }

    for (const service of GCP_DATA_SECURITY_CONTENT_SERVICES) {
      expect(google).toContain(`\`${service}\``);
    }
  });

  it("gives a content scan's limits as the runner and the sampler hold them", () => {
    const reads: string = section(page, "## What a content scan reads");
    const sampler: string = `${SERVER}/Content/ObjectStoreSampler.ts`;

    expect(
      constant(
        `${SERVER}/DataSecurityRunner.ts`,
        "DATA_SECURITY_TURN_TIME_LIMIT_IN_MS",
      ),
    ).toBe(8 * 60 * 1000);
    expect(reads).toContain("stops after 8 minutes");
    expect(constant(sampler, "REREAD_AFTER_DAYS")).toBe(7);
    expect(reads).toContain("unless that was 7 or more days ago");
    expect(constant(sampler, "LISTING_FACTOR")).toBe(10);
    expect(constant(sampler, "MAX_LISTED_OBJECTS")).toBe(200000);
    expect(reads).toContain(
      "at most ten times as many as the scan may read and never more than 200,000",
    );
    expect(constant(sampler, "SAMPLES_PER_PATTERN")).toBe(5);
    expect(reads).toContain("at most 5 of one pattern");
    expect(
      constant(`${SERVER}/DataSecurityRunner.ts`, "MAX_CONTAINERS_PER_ACCOUNT"),
    ).toBe(10);
    expect(reads).toContain(
      "at most 10 containers of an Azure storage account",
    );
    expect(source(`${SERVER}/DataSecurityFindingWriter.ts`)).toContain(
      'PartlySucceeded = "Partly succeeded"',
    );
  });

  it("says which databases are sampled, and how", () => {
    const service: string = source(
      "Common/Server/Services/DataStoreService.ts",
    );
    const scannable: Array<string> = DATA_STORE_KINDS.filter(
      (info: DataStoreKindInfo): boolean => {
        return (
          info.provider === DataStoreProvider.SelfManaged &&
          info.contentScannable
        );
      },
    ).map((info: DataStoreKindInfo): string => {
      return info.kind;
    });

    expect(scannable).toEqual([DataStoreKind.PostgreSql, DataStoreKind.MySql]);
    expect(section(page, "## Scan a database you run")).toContain(
      "Data Security samples PostgreSQL and MySQL databases",
    );
    expect(service).toContain(
      "/^(postgres|postgresql|mysql|mariadb|mssql|sqlserver):\\/\\//i",
    );

    const store: string = source("Common/Models/DatabaseModels/DataStore.ts");

    for (const title of [
      "Connection String",
      "Scan From Probe",
      "Probe Connection Variable",
    ]) {
      expect(store).toContain(`title: "${title}"`);
      expect(page).toContain(`**${title}**`);
    }
  });

  it("says what a finding keeps, with samples masked as the scanner masks them", () => {
    const keeps: string = section(page, "## What OneUptime keeps");

    expect(MAX_MASKED_SAMPLES).toBe(3);
    expect(keeps).toContain("at most three masked samples");
    expect(keeps).toContain(`\`${maskEmail("jane@example.com")}\``);
    expect(keeps).toContain(`\`${maskCardNumber("4242424242424242")}\``);
    expect(keeps).toContain(`\`${maskValue("us-ssn", "123-45-6789")}\``);
    expect(maskValue("person-name", "Alice")).toBe("A****");
    expect(maskValue("confidential-document", "Confidential")).toBe(
      "Confidential",
    );
    expect(FINGERPRINT_SLOTS).toBe(128);
    expect(FINGERPRINT_BITS).toBe(16);
    expect(keeps).toContain("128 numbers of 16 bits for each data type");

    const writer: string = `${SERVER}/DataSecurityFindingWriter.ts`;

    expect(constant(writer, "FINDING_FRESHNESS_IN_DAYS")).toBe(30);
    expect(constant(writer, "FINDING_RETENTION_IN_DAYS")).toBe(90);
    expect(constant(writer, "MAX_FINDINGS_PER_STORE")).toBe(2000);
    expect(keeps).toContain(
      "A finding counts toward its store for 30 days after a scan last saw it",
    );
    expect(keeps).toContain(
      "One unseen for 90 days is deleted. A store keeps at most 2,000 findings.",
    );
  });

  it("lists every setting with its default and range, as the model and its service hold them", () => {
    const service: string = source(
      "Common/Server/Services/DataSecuritySettingService.ts",
    );
    const settings: Array<Array<string>> = rows(
      tables(section(page, "## Settings"))[0],
    );
    const model: string = source(
      "Common/Models/DatabaseModels/DataSecuritySetting.ts",
    );
    const titles: Array<string> = Array.from(
      model.matchAll(
        /\n\s+title: "([^"]+)",\n\s+description: "(?!Relation|ID of)/g,
      ),
      (match: RegExpMatchArray): string => {
        // The severity's id column is the Alert Severity the form shows.
        return match[1] === "Alert Severity ID"
          ? "Alert Severity"
          : (match[1] as string);
      },
    );

    expect(
      settings.map((row: Array<string>): string => {
        return withoutTicks((row[0] as string).split("**").join(""));
      }),
    ).toEqual(titles);

    for (const row of settings) {
      const title: string = (row[0] as string).split("**").join("");
      const declared: string | null = settingDefault(title);
      const shown: string = (row[1] as string).split(" (")[0] as string;

      if (declared === "true" || declared === "false") {
        expect({ title, shown }).toEqual({
          title,
          shown: declared === "true" ? "On" : "Off",
        });
      } else if (declared === null) {
        expect({ title, shown }).toEqual({ title, shown: "Empty" });
      } else {
        expect({ title, shown: count(shown) }).toEqual({
          title,
          shown: Number(declared),
        });
      }
    }

    // Each limit's range, as the service holds a setting to it.
    for (const match of service.matchAll(
      /(\w+): \{\s*min: (\d+),\s*max: (\d+),\s*label: "([^"]+)",?\s*\}/g,
    )) {
      const label: string = (match[4] as string).toLowerCase();
      const row: Array<string> | undefined = settings.find(
        (candidate: Array<string>): boolean => {
          return (
            (candidate[0] as string).split("**").join("").toLowerCase() ===
            label
          );
        },
      );

      expect({ label, found: Boolean(row) }).toEqual({ label, found: true });
      expect(row?.[2]).toContain(
        `from ${Number(match[2]).toLocaleString("en-US")} to ${Number(match[3]).toLocaleString("en-US")}.`,
      );
    }
  });

  it("quotes the reason a store's content was not scanned as the scan gives it", () => {
    const quoted: string =
      "Content scanning needs the connection's content permission, or a connection string for a database.";

    expect(source(`${SERVER}/DataSecurityRunner.ts`)).toContain(`"${quoted}"`);
    expect(page).toContain(`"${quoted}"`);
  });
});

describe("Connect a Cloud Account's Data security section", () => {
  const cloudAccounts: string = readPage("en", "telemetry/cloud-accounts");
  const dataSecurity: string = section(cloudAccounts, "## Data security");
  const blocks: Array<string> = scanMarkdown(dataSecurity)
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "bash";
    })
    .map((fence: { code: string }): string => {
      return fence.code;
    });

  it("names the levels as the form offers them", () => {
    expect(
      rows(tables(dataSecurity)[0]).map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "**Off**",
      "**Configuration only**",
      "**Configuration and content samples**",
    ]);
    expect(dataSecurity).toContain(
      "Under **More fields**, **Data security** is **Off** until you choose otherwise",
    );
  });

  it("shows each cloud's content-level command word for word, as the form shows it", () => {
    expect(blocks).toEqual([
      `aws iam put-role-policy --role-name "$ROLE" --policy-name ${AWS_DATA_SECURITY_POLICY_NAME} --policy-document '${getAwsDataSecurityPolicyDocument("content")}'`,
      getAwsAccessKeySetupCommand({ dataSecurity: "content" }),
      getAzureSetupCommand(CloudConnectionSetupScope.Account, "content"),
      getGcpSetupCommand(CloudConnectionSetupScope.Account, "content"),
    ]);
    // The role's own command is the project's: the page shows only the line it adds.
    expect(
      getAwsRoleSetupCommand({
        trustedPrincipalArn: "arn:aws:iam::123456789012:root",
        externalId: "oneuptime-0123456789abcdef0123456789abcdef",
        dataSecurity: "content",
      }),
    ).toContain(blocks[0] as string);
    // The configuration level adds nothing on Azure and Google Cloud.
    expect(
      getAzureSetupCommand(CloudConnectionSetupScope.Account, "configuration"),
    ).toBe(getAzureSetupCommand());
    expect(
      getGcpSetupCommand(CloudConnectionSetupScope.Account, "configuration"),
    ).toBe(getGcpSetupCommand());
  });

  it("says why an access key's policy is a group's, and that Off leaves the policy in place", () => {
    expect(
      source("Common/Types/CloudConnection/CloudConnectionSetupCommands.ts"),
    ).toContain(
      "IAM holds a user's inline policies to 2,048 characters in all",
    );
    expect(dataSecurity).toContain(
      "IAM holds a user's own inline policies to 2,048 characters in all",
    );
    expect(dataSecurity).toContain(
      "**Off** adds nothing, so it leaves what an earlier command granted in place until you delete it",
    );
    expect(dataSecurity).toContain(
      `\`aws iam delete-role-policy --role-name <your role> --policy-name ${AWS_DATA_SECURITY_POLICY_NAME}\``,
    );
    expect(dataSecurity).toContain("](/docs/data-security/setup)");
  });
});

describe("Sensitive Data Types", () => {
  const page: string = english(DATA_TYPES);

  it("counts the data types and the countries of the national IDs", () => {
    const countries: Set<string> = new Set(
      DATA_TYPE_CATALOG.filter((info: DataTypeInfo): boolean => {
        return (
          info.category === DataCategory.GovernmentId && Boolean(info.country)
        );
      }).map((info: DataTypeInfo): string => {
        return info.country as string;
      }),
    );

    expect(page).toContain(
      `Data Security knows ${DATA_TYPE_CATALOG.length} kinds of sensitive data`,
    );
    expect(page).toContain(`national IDs of ${countries.size} countries`);
    expect(page).toContain(`All ${DATA_TYPE_CATALOG.length}, by category.`);
  });

  it("lists every built-in data type, by category, as the catalog describes it", () => {
    const builtIn: string = section(page, "## Built-in data types");
    const headings: Array<string> = scanMarkdown(builtIn)
      .headings.filter((heading: DocsHeading): boolean => {
        return heading.level === 3;
      })
      .map((heading: DocsHeading): string => {
        return heading.text;
      });
    const categories: Array<DataCategory> = categoriesInCatalogOrder();

    expect(headings).toEqual(categories);
    expect(categories).toHaveLength(ALL_DATA_CATEGORIES.length);

    categories.forEach((category: DataCategory, index: number): void => {
      expect({ category, rows: rows(tables(builtIn)[index]) }).toEqual({
        category,
        rows: DATA_TYPE_CATALOG.filter((info: DataTypeInfo): boolean => {
          return info.category === category;
        }).map((info: DataTypeInfo): Array<string> => {
          return [
            info.name,
            `\`${info.id}\``,
            info.description,
            info.sensitivity,
            info.country || "—",
          ];
        }),
      });
    });
  });

  it("names every type found from field names alone", () => {
    const names: Array<string> = DATA_TYPE_CATALOG.filter(
      (info: DataTypeInfo): boolean => {
        return info.foundBy === "name";
      },
    ).map((info: DataTypeInfo): string => {
      return info.name;
    });
    const written: string = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] as string}`;

    expect(section(page, "## Fields and columns")).toContain(
      `These are found from the field's name alone, when the field has values: ${written}.`,
    );
  });

  it("gives the scanner's own windows, context and field thresholds", () => {
    const found: string = section(page, "## How a value is found");
    const classifier: string = source(
      "Common/Utils/DataSecurity/FieldClassifier.ts",
    );

    expect(CONTEXT_BEFORE).toBe(64);
    expect(CONTEXT_AFTER).toBe(32);
    expect(found).toContain(
      "by default up to 64 characters before it and 32 after it",
    );
    expect(WINDOW_SIZE).toBe(64 * 1024);
    expect(WINDOW_OVERLAP).toBe(4 * 1024);
    expect(MAX_SCANNED_TEXT_LENGTH).toBe(4 * 1024 * 1024);
    expect(found).toContain(
      "A long value is read in windows of 64 KB that overlap by 4 KB, so a value is found whole wherever it sits, and at most 4 MB of one value is read.",
    );
    expect(classifier).toContain("if (ratio >= 0.6) {");
    expect(classifier).toContain("if (ratio >= 0.25) {");
    expect(classifier).toContain(
      "const FREE_TEXT_AVERAGE_LENGTH: number = 80;",
    );
    expect(MAX_FIELD_VALUES).toBe(1000);
    expect(MAX_FIELD_VALUE_LENGTH).toBe(16384);

    const fields: string = section(page, "## Fields and columns");

    expect(
      rows(tables(fields)[0]).map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["60% or more", "25% or more", "Fewer"]);
    expect(fields).toContain(
      "A field whose values average more than 80 characters is free text",
    );
    expect(fields).toContain(
      "Up to 1,000 values of a field are classified, and up to 16 KB of each.",
    );
  });

  it("describes each sensitivity and category in the catalog's own words", () => {
    expect(rows(tables(section(page, "## Sensitivity"))[0])).toEqual(
      ALL_DATA_SENSITIVITIES.map(
        (sensitivity: DataSensitivity): Array<string> => {
          return [
            `**${sensitivity}**`,
            DATA_SENSITIVITY_DESCRIPTION[sensitivity],
          ];
        },
      ),
    );
    expect(rows(tables(section(page, "## Categories"))[0])).toEqual(
      ALL_DATA_CATEGORIES.map((category: DataCategory): Array<string> => {
        return [
          category,
          DATA_CATEGORY_DESCRIPTION[category],
          isPersonalDataCategory(category) ? "Yes" : "No",
        ];
      }),
    );
  });

  it("names the custom data type's checksums and limits as the product holds them", () => {
    const own: string = section(page, "## Your own data types");

    expect([...ALL_CUSTOM_DATA_TYPE_VALIDATORS]).toEqual([
      "None",
      "Luhn",
      "Mod97",
      "Verhoeff",
    ]);

    for (const validator of ALL_CUSTOM_DATA_TYPE_VALIDATORS) {
      expect(own).toContain(`**${validator}**`);
    }

    expect(
      constant(
        "Common/Server/Services/DataSecurityCustomDataTypeService.ts",
        "MAX_CUSTOM_DATA_TYPE_WORDS",
      ),
    ).toBe(50);
    expect(own).toContain(
      "A type takes at most 50 keywords and 50 field names.",
    );

    const form: string = source(
      "App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/DataTypes.tsx",
    );

    for (const title of [
      "Your Data Types",
      "Name",
      "Category",
      "Sensitivity",
      "Description",
      "Pattern",
      "Field Names",
      "Keywords",
      "Test It",
      "Ignore Case",
      "Requires A Keyword",
      "Checksum",
    ]) {
      expect(form).toMatch(new RegExp(`title(?:: |=)"${title}"`));
    }

    expect(form).toContain('"Only the first 64 KB of the text is tested."');
    expect(own).toContain("only its first 64 KB is tested");
  });
});

describe("Data Security Checks and Issues", () => {
  const page: string = english(CHECKS);

  it("counts the checks and their groups", () => {
    expect(page).toContain(
      `Data Security runs ${DATA_SECURITY_CHECKS.length} checks on every store, in nine groups.`,
    );
    expect(ALL_DATA_SECURITY_CHECK_GROUPS).toHaveLength(9);
  });

  it("lists every check under its group, with what it runs on, what it checks and its severities", () => {
    const every: string = section(page, "## Every check");

    ALL_DATA_SECURITY_CHECK_GROUPS.forEach(
      (group: DataSecurityCheckGroup, index: number): void => {
        expect(section(every, `### ${group}`)).toBeTruthy();

        const body: Array<Array<string>> = rows(tables(every)[index]);
        const checks: Array<DataSecurityCheckInfo> =
          DATA_SECURITY_CHECKS.filter(
            (check: DataSecurityCheckInfo): boolean => {
              return check.group === group;
            },
          );

        expect({
          group,
          rows: body.map((row: Array<string>): Array<string> => {
            return row.slice(0, 4);
          }),
        }).toEqual({
          group,
          rows: checks.map((check: DataSecurityCheckInfo): Array<string> => {
            return [
              `${check.title} (\`${check.id}\`)`,
              runsOn(check),
              check.description,
              severities(check),
            ];
          }),
        });

        for (const row of body) {
          expect((row[4] || "").length).toBeGreaterThan(10);
        }
      },
    );
  });

  it("says when secrets are Critical, as the check decides", () => {
    const secrets: DataSecurityCheckInfo = getDataSecurityCheck(
      "secrets-stored",
    ) as DataSecurityCheckInfo;

    expect(severities(secrets)).toBe("High / High / High / High");
    expect(page).toContain(
      "**Secrets are stored in it** is High on any store, and Critical on a store that is public or shared with other accounts.",
    );
  });

  it("gives the risk score's factors with the points the score gives them", () => {
    const risk: Array<Array<string>> = rows(
      tables(section(page, "## Risk score"))[0],
    );
    const points: (factor: string) => string = (factor: string): string => {
      return (
        risk.find((row: Array<string>): boolean => {
          return row[0] === factor;
        }) as Array<string>
      )[1] as string;
    };

    expect(points("Severity")).toBe(
      `${RISK_BASE_BY_SEVERITY[SecuritySeverity.Critical]} for Critical, ${RISK_BASE_BY_SEVERITY[SecuritySeverity.High]} for High, ${RISK_BASE_BY_SEVERITY[SecuritySeverity.Medium]} for Medium, ${RISK_BASE_BY_SEVERITY[SecuritySeverity.Low]} for Low`,
    );

    const exposure: (value: DataStoreExposure) => number = (
      value: DataStoreExposure,
    ): number => {
      return Math.round(10 * DATA_STORE_EXPOSURE_WEIGHT[value]);
    };

    expect(points("Exposure")).toBe(
      `${exposure(DataStoreExposure.Public)} for Public, ${exposure(DataStoreExposure.OtherAccounts)} for Other accounts, ${exposure(DataStoreExposure.InternetReachable)} for Internet reachable, ${exposure(DataStoreExposure.Unknown)} for Unknown, ${exposure(DataStoreExposure.Private)} for Private`,
    );

    const volume: (records: number) => number = (records: number): number => {
      return Math.round(6 * volumeWeight(records));
    };

    expect(points("Volume")).toContain(
      `${volume(10)} for 10 records, ${volume(1000)} for 1,000, ${volume(1000000)} for a million, ${volume(10000000)} for ten million or more`,
    );

    const activity: number = getRiskScore({
      severity: SecuritySeverity.Low,
      exposure: DataStoreExposure.Private,
      hasRecentSecurityActivity: true,
    }).score;
    const production: number = getRiskScore({
      severity: SecuritySeverity.Low,
      exposure: DataStoreExposure.Private,
      isProduction: true,
    }).score;

    expect(points("Activity")).toMatch(new RegExp(`^${activity} when`));
    expect(points("Production")).toMatch(new RegExp(`^${production} for`));
    expect(
      exposure(DataStoreExposure.Public) +
        volume(10000000) +
        activity +
        production,
    ).toBe(25);

    const example: number = getRiskScore({
      severity: SecuritySeverity.Critical,
      exposure: DataStoreExposure.Public,
      estimatedRecords: 1000000,
      isProduction: true,
    }).score;

    expect(page).toContain(
      `scores 75 + 10 + 5 + 4 = ${example} for a Critical issue`,
    );
  });

  it("names the environments, and the words a store's name is read by", () => {
    const environments: string = source(
      "Common/Types/DataSecurity/DataStoreEnvironment.ts",
    );

    expect(Object.values(DataStoreEnvironment)).toEqual([
      "Production",
      "Staging",
      "Development",
      "Test",
      "Unknown",
    ]);
    expect(page).toContain("Production, Staging, Development, Test or Unknown");

    for (const word of [
      '"env"',
      '"environment"',
      '"stage"',
      '"tier"',
      '"prod"',
      '"staging"',
      '"dev"',
      '"qa"',
    ]) {
      expect(environments).toContain(word);
    }
  });

  it("gives an accepted risk at most a year, and names the issue's actions as the Dashboard does", () => {
    expect(
      constant(
        "Common/Server/Services/DataSecurityIssueService.ts",
        "MAX_ACCEPTANCE_IN_DAYS",
      ),
    ).toBe(366);
    expect(page).toContain("at most a year away");

    const actions: string = source(
      "App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueChanges.ts",
    );
    const modals: string = source(
      "App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueModals.tsx",
    );

    for (const action of [
      "Accept Risk",
      "Mark Resolved",
      "Not an Issue",
      "Reopen",
      "Assign",
    ]) {
      expect(actions).toContain(`translationKey("${action}"`);
      expect(page).toContain(`**${action}**`);
    }

    expect(modals).toContain('title: "Reason"');
    expect(modals).toContain('title: "Accepted Until"');
  });

  it("puts check settings where the Dashboard has them", () => {
    const checks: string = source(
      "App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/Checks.tsx",
    );

    expect(checks).toContain('label: "By sensitivity"');
    expect(section(page, "## Check settings")).toContain(
      "**Data Security → Settings → Checks**",
    );
    expect(section(page, "## Check settings")).toContain("**By sensitivity**");
  });
});

describe("Sensitive Data in Telemetry", () => {
  const page: string = english(TELEMETRY);
  const scanner: string = `${SERVER}/Telemetry/TelemetryDataScanner.ts`;

  it("gives a telemetry scan's limits as the scanner holds them", () => {
    const limits: Array<Array<string>> = rows(
      tables(section(page, "## How a scan samples"))[0],
    );
    const value: (limit: string) => string = (limit: string): string => {
      return (
        limits.find((row: Array<string>): boolean => {
          return row[0] === limit;
        }) as Array<string>
      )[1] as string;
    };

    expect(settingDefault("Telemetry Sample Size")).toBe("500");
    expect(value("Records of each service and signal")).toBe(
      `**Telemetry Sample Size**, 500 by default, never more than ${constant(scanner, "TELEMETRY_SCAN_MAX_SAMPLE_PER_OWNER").toLocaleString("en-US")}`,
    );
    expect(value("Services or RUM applications read per signal")).toBe(
      `The ${constant(scanner, "TELEMETRY_SCAN_MAX_OWNERS_PER_SIGNAL")} busiest`,
    );
    expect(value("Records in one read")).toBe(
      `${constant(scanner, "TELEMETRY_SCAN_MAX_RECORDS_PER_READ").toLocaleString("en-US")}, shared between the services; ${constant(scanner, "TELEMETRY_SCAN_MAX_CONVERSATIONS_PER_READ")} for AI calls`,
    );
    expect(
      count(
        value(
          "Characters of a log body, an exception message or a stack trace",
        ),
      ),
    ).toBe(constant(scanner, "TELEMETRY_SCAN_MAX_TEXT_LENGTH"));
    expect(count(value("Characters of an attribute value"))).toBe(
      constant(scanner, "TELEMETRY_SCAN_MAX_ATTRIBUTE_VALUE_LENGTH"),
    );
    expect(count(value("Characters of a value of an AI call"))).toBe(
      constant(scanner, "TELEMETRY_SCAN_MAX_CONVERSATION_VALUE_LENGTH"),
    );
    expect(value("Attributes of one record")).toBe(
      `${constant(scanner, "TELEMETRY_SCAN_MAX_ATTRIBUTES_PER_RECORD")}; ${constant(scanner, "TELEMETRY_SCAN_MAX_CONVERSATION_ATTRIBUTES_PER_RECORD")} for an AI call`,
    );
    expect(value("Events of one span, and attributes of one event")).toBe(
      `${constant(scanner, "TELEMETRY_SCAN_MAX_EVENTS_PER_SPAN")} and ${constant(scanner, "TELEMETRY_SCAN_MAX_ATTRIBUTES_PER_EVENT")}`,
    );
    expect(count(value("Locations of one store"))).toBe(
      constant(scanner, "TELEMETRY_SCAN_MAX_LOCATIONS_PER_STORE"),
    );
    expect(constant(scanner, "TELEMETRY_SCAN_READ_TIME_LIMIT_IN_SECONDS")).toBe(
      30,
    );
    expect(page).toContain("each read stops after 30 seconds");
  });

  it("names the stores read and the locations a finding points at", () => {
    const what: Array<Array<string>> = rows(
      tables(section(page, "## What is read"))[0],
    );
    const scrub: string = source(
      `${SERVER}/Telemetry/TelemetryScrubCoverage.ts`,
    );

    expect(
      what.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      DataStoreKind.TelemetryLogs,
      DataStoreKind.TelemetryTraces,
      DataStoreKind.TelemetryExceptions,
      DataStoreKind.TelemetryAiConversations,
      DataStoreKind.TelemetrySessionReplays,
    ]);

    for (const prefix of [
      '"attributes."',
      '"events."',
      '"logs.attributes."',
      '"spans.attributes."',
      '"sessions."',
    ]) {
      expect(scrub).toContain(prefix);
    }

    for (const location of [
      '"sessions.attributes."',
      '"sessions.identifiedUserTraits."',
      '"sessions.identifiedUserLabel"',
    ]) {
      expect(source(scanner)).toContain(location);
    }

    expect(source(scanner)).toContain(
      'const ONEUPTIME_ATTRIBUTE_PREFIX: string = "oneuptime.";',
    );
  });

  it("names the rules Scrub It makes as it names them", () => {
    const scrub: string = source(
      `${SERVER}/Telemetry/TelemetryScrubCoverage.ts`,
    );

    expect(scrub).toContain(
      'export const DATA_SECURITY_SCRUB_RULE_NAME_PREFIX: string = "Data Security: ";',
    );
    expect(section(page, "## Scrub It")).toContain(
      '"Data Security: Email address in attributes.user.email"',
    );
    expect(scrub).toContain(
      "LogScrubPatternType.CreditCard,\n  LogScrubPatternType.SSN,\n  LogScrubPatternType.PhoneNumber,\n]);",
    );
  });
});

describe("Data Flows, Access and Residency", () => {
  const page: string = english(FLOWS);
  const flows: string = `${SERVER}/DataSecurityFlows.ts`;

  it("gives the flows' windows and the copy threshold", () => {
    expect(source(flows)).toContain(
      "export const COPY_OVERLAP_THRESHOLD: number = 0.5;",
    );
    expect(page).toContain("overlap by half or more");
    expect(constant(flows, "FLOW_RETENTION_IN_DAYS")).toBe(30);
    expect(page).toContain("A flow not seen again for 30 days is dropped.");
    expect(constant(flows, "AI_WINDOW_IN_DAYS")).toBe(7);
    expect(page).toContain("traces of the last 7 days");

    for (const kind of [
      'USES: string = "Uses"',
      'AI_PROVIDER: string = "AI Provider"',
      'EXTERNAL_HOST: string = "External Host"',
      'COPY: string = "Copy"',
    ]) {
      expect(source(flows)).toContain(kind);
    }
  });

  it("counts readers as the check counts them", () => {
    const check: DataSecurityCheckInfo = getDataSecurityCheck(
      "many-readers",
    ) as DataSecurityCheckInfo;
    const input: (readerCount: number) => DataSecurityCheckStatus = (
      readerCount: number,
    ): DataSecurityCheckStatus => {
      return check.evaluate({
        kind: DataStoreKind.AwsS3Bucket,
        name: "bucket",
        environment: DataStoreEnvironment.Production,
        sensitivity: DataSensitivity.Restricted,
        dataTypeIds: [],
        dataCategories: [],
        posture: {},
        isPublicByDesign: false,
        hasOwner: true,
        readerCount,
      }).status;
    };

    expect(input(25)).toBe(DataSecurityCheckStatus.Pass);
    expect(input(26)).toBe(DataSecurityCheckStatus.Fail);
    expect(check.title).toBe(
      "More than 25 identities can read Restricted data",
    );
    expect(page).toContain(`[${check.title}]`);
  });

  it("names the principals, access levels and exposures as the product does", () => {
    const access: Array<Array<string>> = rows(
      tables(section(page, "## Who can reach a store"))[0],
    );

    expect(access[1]?.[1]).toBe(
      `${Object.values(DataStorePrincipalType).slice(0, -1).join(", ")} or ${Object.values(DataStorePrincipalType).slice(-1)[0] as string}.`,
    );
    expect(access[2]?.[1]).toBe(
      `${Object.values(DataStoreAccessLevel).slice(0, -1).join(", ")} or ${Object.values(DataStoreAccessLevel).slice(-1)[0] as string}.`,
    );
    expect(rows(tables(section(page, "## Who can reach a store"))[1])).toEqual(
      ALL_DATA_STORE_EXPOSURES.map(
        (exposure: DataStoreExposure): Array<string> => {
          return [`**${exposure}**`, DATA_STORE_EXPOSURE_DESCRIPTION[exposure]];
        },
      ),
    );
  });

  it("matches regions as the examples say", () => {
    const examples: Array<Array<string>> = rows(
      tables(section(page, "### Regions and wildcards"))[0],
    );

    expect(examples.length).toBe(3);

    for (const row of examples) {
      const pattern: string = withoutTicks(
        (row[0] as string).split(" (")[0] as string,
      );

      for (const region of list(row[1] as string)) {
        expect({
          pattern,
          region,
          matches: regionMatches(pattern, region),
        }).toEqual({
          pattern,
          region,
          matches: true,
        });
      }

      for (const region of list(row[2] as string)) {
        expect({
          pattern,
          region,
          matches: regionMatches(pattern, region),
        }).toEqual({
          pattern,
          region,
          matches: false,
        });
      }
    }
  });

  it("names a residency rule's fields as the form does", () => {
    const form: string = source(
      "App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/Residency.tsx",
    );
    const fields: Array<Array<string>> = rows(
      tables(section(page, "## Residency rules"))[0],
    );

    for (const row of fields) {
      const title: string = (row[0] as string).split("**").join("");

      expect(form).toContain(`title: "${title}"`);
    }

    expect(fields).toHaveLength(6);
  });
});

describe("Data Security Compliance", () => {
  const page: string = english(COMPLIANCE);

  it("lists every framework with its full name and scope", () => {
    expect(rows(tables(section(page, "## The frameworks"))[0])).toEqual(
      ALL_COMPLIANCE_FRAMEWORKS.map(
        (framework: ComplianceFramework): Array<string> => {
          return [
            framework,
            COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
            COMPLIANCE_FRAMEWORK_INFO[framework].scope,
          ];
        },
      ),
    );
  });

  it("lists every requirement of every framework with the checks that are evidence for it", () => {
    const requirements: string = section(
      page,
      "## Requirements and their checks",
    );

    ALL_COMPLIANCE_FRAMEWORKS.forEach(
      (framework: ComplianceFramework, index: number): void => {
        expect(section(requirements, `### ${framework}`)).toBeTruthy();
        expect({ framework, rows: rows(tables(requirements)[index]) }).toEqual({
          framework,
          rows: COMPLIANCE_REQUIREMENTS.filter(
            (info: ComplianceRequirementInfo): boolean => {
              return info.framework === framework;
            },
          ).map((info: ComplianceRequirementInfo): Array<string> => {
            const checks: Array<string> = getChecksForRequirement(
              framework,
              info.requirement,
            ).map((check: DataSecurityCheckInfo): string => {
              return `\`${check.id}\``;
            });

            return [
              info.requirement,
              info.title,
              info.isMetByInventory
                ? "Met by Data Security itself"
                : checks.join(", "),
            ];
          }),
        });
      },
    );

    // Every other requirement has a check behind it.
    for (const info of COMPLIANCE_REQUIREMENTS) {
      expect({
        requirement: `${info.framework} ${info.requirement}`,
        evidence:
          Boolean(info.isMetByInventory) ||
          getChecksForRequirement(info.framework, info.requirement).length > 0,
      }).toEqual({
        requirement: `${info.framework} ${info.requirement}`,
        evidence: true,
      });
    }
  });

  it("names the two requirements Data Security meets itself", () => {
    const inventory: Array<string> = COMPLIANCE_REQUIREMENTS.filter(
      (info: ComplianceRequirementInfo): boolean => {
        return Boolean(info.isMetByInventory);
      },
    ).map((info: ComplianceRequirementInfo): string => {
      return `${info.framework} ${info.requirement}`;
    });

    expect(inventory).toEqual(["GDPR Art. 30", "ISO 27001 A.5.12"]);
    expect(page).toContain(
      "GDPR Article 30, records of processing activities, and ISO 27001 A.5.12, classification of information",
    );
  });

  it("brings PCI DSS in with every card data type", () => {
    const pci: Array<string> = DATA_TYPE_CATALOG.filter(
      (info: DataTypeInfo): boolean => {
        return info.frameworks.includes(ComplianceFramework.PCIDSS);
      },
    ).map((info: DataTypeInfo): string => {
      return info.id;
    });

    expect(pci).toEqual([
      "credit-card-number",
      "card-verification-code",
      "card-expiration-date",
    ]);
    expect(page).toContain(
      "card numbers, card security codes and card expiry dates PCI DSS",
    );
  });

  it("counts only open issues against a requirement, as the score does", () => {
    expect(source("Common/Server/API/DataSecurityAPI.ts")).toContain(
      "query: { projectId, status: DataSecurityIssueStatus.Open },",
    );
    expect(page).toContain("Only open issues count.");
  });
});

describe("Closing an exposure", () => {
  const checks: string = english(CHECKS);
  const setup: string = english(SETUP);
  const integrations: string = english(INTEGRATIONS);
  const panel: string = source(
    "App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueResponseAction.tsx",
  );

  function codeSpans(cell: string): Array<string> {
    return cell.split("`").filter((_part: string, index: number): boolean => {
      return index % 2 === 1;
    });
  }

  it("offers on an issue's page the fix of each check a response action fixes, by the button the panel draws", () => {
    const table: Array<Array<string>> = rows(
      tables(section(checks, "## Fix it from here"))[0],
    );

    expect(table).toHaveLength(2);
    expect(codeSpans(table[0]![0] as string)).toEqual([
      ...DATA_SECURITY_RESPONSE_ACTION_CHECKS[
        DataSecurityResponseAction.BlockPublicAccess
      ],
    ]);
    expect(codeSpans(table[1]![0] as string)).toEqual([
      ...DATA_SECURITY_RESPONSE_ACTION_CHECKS[
        DataSecurityResponseAction.RevokeSharing
      ],
    ]);
    expect(table[0]![2]).toBe("**Block Public Access**");
    expect(table[1]![2]).toBe("**Revoke Sharing**");
    expect(panel).toContain('translationKey("Block Public Access")');
    expect(panel).toContain('translationKey("Revoke Sharing")');
    expect(panel).toContain('translationKey("Fix it from here")');
    expect(section(checks, "## Fix it from here")).toContain(
      "**Fix it from here**",
    );

    // The stores each row names are the kinds each action takes.
    expect([...BLOCKABLE_DATA_STORE_KINDS]).toEqual([
      DataStoreKind.AwsS3Bucket,
      DataStoreKind.AzureStorageAccount,
      DataStoreKind.GcpStorageBucket,
    ]);
    expect(table[0]![1]).toBe(
      "An S3 bucket, an Azure storage account or a Cloud Storage bucket",
    );
    expect([...SHAREABLE_DATA_STORE_KINDS]).toEqual([
      DataStoreKind.AwsRdsSnapshot,
      DataStoreKind.AwsRdsInstance,
      DataStoreKind.AwsRdsCluster,
      DataStoreKind.AwsDocumentDbCluster,
    ]);
    expect(table[1]![1]).toBe(
      "An RDS snapshot, an RDS database, or an Aurora or DocumentDB cluster",
    );
  });

  it("says what each cloud's response grant may do, word for word as the commands grant it", () => {
    const response: string = section(
      setup,
      "## Let Data Security close an exposure",
    );
    const table: Array<Array<string>> = rows(tables(response)[0]);
    const field: CloudConnectionField | undefined = (
      getCloudConnectionDefinition(
        CloudProvider.AWS,
      ) as CloudConnectionDefinition
    ).configFields.find((candidate: CloudConnectionField): boolean => {
      return candidate.key === DATA_SECURITY_RESPONSE_FIELD_KEY;
    });

    expect(field?.title).toBe("Data security response");
    expect(response).toContain(`**${field?.title}**`);
    expect(
      field?.options?.find((option: { value: string }): boolean => {
        return option.value === "block";
      })?.label,
    ).toBe("Block public access and sharing");
    expect(response).toContain("**Block public access and sharing**");

    const aws: Array<string> = table[0] as Array<string>;
    const azure: Array<string> = table[1] as Array<string>;
    const gcp: Array<string> = table[2] as Array<string>;

    expect(codeSpans(aws[1] as string)).toEqual([
      AWS_DATA_SECURITY_RESPONSE_POLICY_NAME,
    ]);
    expect(codeSpans(aws[2] as string)).toEqual([
      ...AWS_DATA_SECURITY_RESPONSE_ACTIONS,
    ]);
    expect(codeSpans(azure[1] as string)).toEqual([
      AZURE_DATA_SECURITY_RESPONSE_ROLE,
    ]);
    expect(codeSpans(azure[2] as string)).toEqual([
      ...AZURE_DATA_SECURITY_RESPONSE_ACTIONS,
    ]);
    expect(codeSpans(gcp[1] as string)).toEqual([
      GCP_DATA_SECURITY_RESPONSE_ROLE_ID,
    ]);
    expect(codeSpans(gcp[2] as string)).toEqual([
      ...GCP_DATA_SECURITY_RESPONSE_PERMISSIONS,
    ]);
    expect(response).toContain(
      `--policy-name ${AWS_DATA_SECURITY_RESPONSE_POLICY_NAME}`,
    );
  });

  it("names the playbook steps as the step picker does, and the most stores one acts on", () => {
    const close: string = section(integrations, "## Close an exposure");
    const steps: Array<SecurityPlaybookActionDefinition> =
      SECURITY_PLAYBOOK_ACTIONS.filter(
        (action: SecurityPlaybookActionDefinition): boolean => {
          return (
            action.type ===
              SecurityPlaybookActionType.BlockDataStorePublicAccess ||
            action.type === SecurityPlaybookActionType.RevokeDataStoreSharing
          );
        },
      );

    expect(steps).toHaveLength(2);

    for (const step of steps) {
      expect(step.category).toBe(SecurityPlaybookActionCategory.Contain);
      expect(step.needsApprovalByDefault).toBe(true);
      expect(close).toContain(`**${step.title}**`);
    }

    expect(close).toContain("steps of the **Contain** category");
    expect(close).toContain(
      "at most 10, each a step that starts with **Needs Approval** on",
    );
    expect(
      constant(
        "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookDataStoreOwners.ts",
        "MAX_NOTIFIED_DATA_STORES",
      ),
    ).toBe(10);
  });

  it("lists Ask AI's Data Security tools by the names the toolbox gives them, and says they never read a sample", () => {
    const tools: string = source(
      "Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts",
    );
    const names: Array<string> = Array.from(
      tools.matchAll(/\n {2}name: "(query_[a-z_]+)",/g),
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
    const askAi: string = section(integrations, "### Ask AI");

    expect(names).toEqual([
      "query_data_stores",
      "query_data_security_issues",
      "query_data_store_access",
    ]);
    expect(
      rows(tables(askAi)[0]).map((row: Array<string>): string => {
        return withoutTicks(row[0] as string);
      }),
    ).toEqual(names);
    expect(tools).toContain(
      "// Never maskedSamples: a model needs no value to say where data is.",
    );
    expect(tools).not.toContain("maskedSamples: true");
    expect(askAi).toContain("never a finding's samples, masked or not");
  });
});

describe("Data Security Integrations", () => {
  const page: string = english(INTEGRATIONS);

  it("gives the integrations' switches with their defaults", () => {
    for (const row of rows(tables(section(page, "## How it works"))[0])) {
      const title: string = (row[0] as string).split("**").join("");
      const declared: string | null = settingDefault(title);

      expect({ title, shown: row[1] }).toEqual({
        title,
        shown: declared === null ? "Empty" : declared === "true" ? "On" : "Off",
      });
    }
  });

  it("names the Security Operations entity, source and rule as the integration sends them", () => {
    const integrations: string = source(
      `${SERVER}/DataSecurityIntegrations.ts`,
    );
    const operations: string = section(page, "## Security Operations");

    expect(SecurityEntityType.DataStore).toBe("Data Store");
    expect(operations).toContain(
      `of the type **${SecurityEntityType.DataStore}**`,
    );
    expect(SecurityDetectionSource.DataSecurity).toBe("Data Security");
    expect(operations).toContain(
      `its source is **${SecurityDetectionSource.DataSecurity}**`,
    );
    expect(integrations).toContain(
      "ruleName: `Data Security: ${issue.checkId}`,",
    );
    expect(operations).toContain("`Data Security: public-read`");
    expect(integrations).toContain(
      "title: `Data Security: ${issue.title} (${issue.dataStoreName})`,",
    );
    expect(
      constant(`${SERVER}/DataSecurityIntegrations.ts`, "MAX_NOTIFIED_OWNERS"),
    ).toBe(50);
    expect(section(page, "## Owners")).toContain("up to 50");
    expect(integrations).toContain(
      "return `Data Security: ${newIssuesPhrase(data.issueCount)} on ${data.dataStoreName}`;",
    );
    expect(integrations).toContain(
      'return count === 1 ? "1 new issue" : `${count} new issues`;',
    );
    expect(section(page, "## Owners")).toContain(
      '"Data Security: 2 new issues on orders-db"',
    );
  });

  it("lists every Data Security record's API path", () => {
    const api: string = section(page, "## API, Terraform and MCP");
    const listed: Array<string> = rows(tables(api)[0])
      .flatMap((row: Array<string>): Array<string> => {
        return list(row[1] as string);
      })
      .sort();
    const models: string = path.join(
      REPO,
      "packages/Common/Models/DatabaseModels",
    );
    const routes: Array<string> = fs
      .readdirSync(models)
      .filter((file: string): boolean => {
        return file.startsWith("DataStore") || file.startsWith("DataSecurity");
      })
      .map((file: string): string => {
        const match: RegExpMatchArray | null = fs
          .readFileSync(path.join(models, file), "utf8")
          .match(/@CrudApiEndpoint\(new Route\("([^"]+)"\)\)/);

        return match ? (match[1] as string) : "";
      })
      .filter((route: string): boolean => {
        return route.length > 0;
      })
      .sort();

    expect(listed).toEqual(routes);
    expect(
      rows(tables(api)[1]).map((row: Array<string>): string => {
        return withoutTicks(row[0] as string);
      }),
    ).toEqual([
      DATA_SECURITY_API_ROUTES.overview,
      DATA_SECURITY_API_ROUTES.compliance,
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
      DATA_SECURITY_API_ROUTES.scanNow("<id>"),
      DATA_SECURITY_API_ROUTES.checkNow("<id>"),
      DATA_SECURITY_API_ROUTES.scrubFinding("<id>"),
      DATA_SECURITY_API_ROUTES.explainIssue("<id>"),
      DATA_SECURITY_API_ROUTES.fixIssueWithAi("<id>"),
      DATA_SECURITY_API_ROUTES.responseActions("<id>"),
      DATA_SECURITY_API_ROUTES.respond("<id>"),
    ]);
  });

  it("names the records the MCP server has tools for, and a Terraform resource, by their models' names", () => {
    const models: string = path.join(
      REPO,
      "packages/Common/Models/DatabaseModels",
    );
    const mcp: Array<string> = [];
    let residencyRule: string = "";

    for (const file of fs.readdirSync(models)) {
      if (!file.startsWith("DataStore") && !file.startsWith("DataSecurity")) {
        continue;
      }

      const model: string = fs.readFileSync(path.join(models, file), "utf8");
      const singular: string =
        model.match(/singularName: "([^"]+)"/)?.[1] || "";

      if (model.includes("@EnableMCP()")) {
        mcp.push(singular);
      }

      if (file === "DataSecurityResidencyRule.ts") {
        residencyRule = singular;
      }
    }

    const sentence: string =
      section(page, "## API, Terraform and MCP").match(
        /count tools for these records: ([^.]+)\./,
      )?.[1] || "";

    expect(sentence.replace(" and ", ", ").split(", ").sort()).toEqual(
      mcp.sort(),
    );
    expect(page).toContain(
      `\`oneuptime_${residencyRule.toLowerCase().split(" ").join("_")}\``,
    );
  });

  it("names the AI actions as the API and the Dashboard do", () => {
    const prompt: string = source(
      "Common/Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt.ts",
    );

    expect(prompt).toContain(
      "Fix this data security issue in the infrastructure code (Terraform, CloudFormation, Bicep or similar)",
    );
    expect(source("Common/Server/API/DataSecurityAPI.ts")).toContain(
      "message: buildDataSecurityFixRequest(issue),",
    );
    expect(section(page, "## OneUptime AI")).toContain(
      "Terraform, CloudFormation, Bicep or the like",
    );
    expect(
      source(
        "App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueModals.tsx",
      ),
    ).toContain('title="Fix with AI"');
    expect(section(page, "## OneUptime AI")).toContain("**Fix with AI**");
  });

  it("puts the owner and label rules where the Dashboard's menu has them", () => {
    const menu: string = source(
      "App/FeatureSet/Dashboard/src/Utils/DataSecurityNavigation.ts",
    );

    for (const title of ["Owner Rules", "Label Rules"]) {
      expect(menu).toContain(`title: "${title}"`);
      expect(page).toContain(`**Data Security → Rules → ${title}**`);
    }

    expect(
      source("Common/Models/DatabaseModels/DataStoreOwnerRule.ts"),
    ).toContain('title: "Cloud Tag Pattern"');
  });
});

describe.each(TRANSLATED_LANGUAGES)(
  "the %s Data Security pages",
  (lang: string) => {
    describe.each(PAGES)("%s", (page: string) => {
      const englishPage: string = english(page);
      const exists: boolean = hasPage(lang, page);
      const translated: string = exists ? readPage(lang, page) : "";

      it("is translated, with a title of its own", () => {
        expect({ lang, page, exists }).toEqual({ lang, page, exists: true });
        expect(translated).not.toEqual(englishPage);
        expect(translated.split("\n")[0]).toMatch(/^# \S/);
      });

      it("keeps every table, row for row, and every list item", () => {
        expect(tableShape(translated)).toEqual(tableShape(englishPage));
        expect(listItemCount(translated)).toBe(listItemCount(englishPage));
      });

      it("keeps every code sample, and every piece of inline code", () => {
        expect(
          scanMarkdown(translated)
            .fences.filter((fence: { lang: string }): boolean => {
              return fence.lang !== "mermaid";
            })
            .map(comparableFence),
        ).toEqual(
          scanMarkdown(englishPage)
            .fences.filter((fence: { lang: string }): boolean => {
              return fence.lang !== "mermaid";
            })
            .map(comparableFence),
        );
        expect(inlineCode(translated)).toEqual(inlineCode(englishPage));
      });

      it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
        const cards: Array<string> = cardLines(translated);

        expect(cards.length).toBe(cardLines(englishPage).length);

        for (const line of cards) {
          expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
            line,
            ascii: true,
          });
        }

        expect(cardTargets(cards)).toEqual(cardTargets(cardLines(englishPage)));
      });

      it("draws every bold and italic span, with no asterisks or underscores left on the page", async () => {
        expect(await strayMarkers(translated, lang)).toEqual([]);
      });
    });

    it("keeps every data type and every check in the rows the English gives them", () => {
      for (const page of [DATA_TYPES, CHECKS]) {
        const idsOf: (markdown: string) => Array<Array<string>> = (
          markdown: string,
        ): Array<Array<string>> => {
          return tables(markdown).map((table: Array<Array<string>>) => {
            return table.slice(1).map((row: Array<string>): string => {
              return (
                row
                  .map((cell: string): string => {
                    return cell.match(INLINE_ID)?.[1] || "";
                  })
                  .find((id: string): boolean => {
                    return id.length > 0;
                  }) || ""
              );
            });
          });
        };

        expect({
          page,
          ids: idsOf(hasPage(lang, page) ? readPage(lang, page) : ""),
        }).toEqual({
          page,
          ids: idsOf(english(page)),
        });
      }
    });
  },
);
