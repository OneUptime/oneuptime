import { describe, expect, it, jest } from "@jest/globals";

// Substitution only: the sandbox runner, the logger and tracing are not needed.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

import { MONITOR_SECRET_ACCESS_STEP_ID } from "../../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecretAccessFormFields";
import { readPage } from "./DocsContentSupport";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import { PermissionHelper } from "Common/Types/Permission";
import fs from "fs";
import path from "path";

/*
 * What the English Monitor Secrets page says about the product, held to the
 * code that makes it true: where secrets are kept and what the form asks,
 * the plan and roles they need, what a name may be, that a value is never
 * read back, that the server fills references in before a probe gets the
 * monitor - and, above all, the table of the monitor types and fields that
 * take a secret, against the code that fills them in, so a field that
 * starts or stops taking secrets fails here until the table follows.
 *
 * MonitorSecretAccessDocs holds every language's page to the access options;
 * MonitorChecksDocsTranslations holds the translations to this page.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const SECRET_FILLING_FILE: string = "App/FeatureSet/Telemetry/Utils/Monitor.ts";
const PROBE_INGEST_FILE: string =
  "App/FeatureSet/Telemetry/API/ProbeIngest/Monitor.ts";
const SECRETS_PAGE_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecrets.tsx";
const MONITORS_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx";
const SECRET_MODEL_FILE: string =
  "Common/Models/DatabaseModels/MonitorSecret.ts";
const FORM_VALIDATION_FILE: string = "Common/UI/Components/Forms/Validation.ts";

const PAGE: string = "monitor/monitor-secrets";

const MONITOR_TYPE_NAME: RegExp = /MonitorType\.(\w+)/g;
const FILLED_FIELD: RegExp =
  /populateSecretsIn:\s*monitorStep\.data\.([\w.]+)/g;
const FIELD_LIST: RegExp = /SecretFields:[^=]*=\s*\[([^\]]*)\]/;
const FIELD_LIST_OWNER: RegExp = /monitorStep\.data\.(\w+)\[field\]/;
const QUOTED: RegExp = /"(\w+)"/g;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

const page: string = readPage("en", PAGE);

/*
 * The source between `start` and the first `end` after it - the body of a
 * function, from its name to the next declaration.
 */
function sourceBetween(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = source.indexOf(end, from + start.length);

  return source.slice(from, to < 0 ? undefined : to);
}

// The body of one heading's section, up to the next heading.
function section(heading: string): string {
  const start: number = page.indexOf(`${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = page.slice(start + heading.length + 1);
  const next: RegExpMatchArray | null = rest.match(new RegExp("^#{1,3} ", "m"));

  return next && next.index !== undefined ? rest.slice(0, next.index) : rest;
}

// The body rows of the last table in a text, as arrays of trimmed cells.
function lastTableRows(text: string): Array<Array<string>> {
  const lines: Array<string> = text.split("\n");
  let start: number = -1;

  lines.forEach((line: string, index: number): void => {
    if (line.startsWith("| ---")) {
      start = index + 1;
    }
  });

  expect(start).toBeGreaterThan(0);

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

/*
 * The fields the server fills secrets into, by monitor type, read from the
 * code that does it: each `if (monitorType === ...)` block of
 * populateSecretsInMonitorSteps names its types and the fields it fills.
 */
function fieldsFilledByType(): Map<MonitorType, Set<string>> {
  const body: string = sourceBetween(
    readRepoFile(SECRET_FILLING_FILE),
    "public static async populateSecretsInMonitorSteps(",
    "public static async populateSecretsOnMonitorTest(",
  );
  const filled: Map<MonitorType, Set<string>> = new Map();

  for (const block of body.split("\n    if (").slice(1)) {
    const condition: string = block.slice(0, block.indexOf(") {"));
    const types: Array<MonitorType> = Array.from(
      condition.matchAll(MONITOR_TYPE_NAME),
    ).map((match: RegExpMatchArray): MonitorType => {
      return MonitorType[match[1] as keyof typeof MonitorType];
    });
    const fields: Array<string> = Array.from(block.matchAll(FILLED_FIELD)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
    const list: RegExpExecArray | null = FIELD_LIST.exec(block);

    if (list) {
      const owner: string = (
        FIELD_LIST_OWNER.exec(block) as RegExpExecArray
      )[1] as string;

      for (const match of Array.from((list[1] as string).matchAll(QUOTED))) {
        fields.push(`${owner}.${match[1] as string}`);
      }
    }

    for (const type of types) {
      const set: Set<string> = filled.get(type) || new Set<string>();

      for (const field of fields) {
        set.add(field);
      }

      filled.set(type, set);
    }
  }

  return filled;
}

/*
 * The table on the page, and the fields each row means: what a reader is
 * told, next to the step fields that is in the code.
 */
const DOCUMENTED_ROWS: Array<{
  types: string;
  fields: string;
  stepFields: Array<string>;
}> = [
  {
    types: "API",
    fields:
      "The URL, the request headers and body, and the client certificate, private key and passphrase (mTLS)",
    stepFields: [
      "monitorDestination",
      "requestHeaders",
      "requestBody",
      "tlsClientCertificate",
      "tlsClientKey",
      "tlsClientKeyPassphrase",
    ],
  },
  {
    types: "Website",
    fields:
      "The URL, and the client certificate, private key and passphrase (mTLS)",
    stepFields: [
      "monitorDestination",
      "tlsClientCertificate",
      "tlsClientKey",
      "tlsClientKeyPassphrase",
    ],
  },
  {
    types: "Ping, IP, Port, NTP, SSL Certificate",
    fields: "The host or URL to check",
    stepFields: ["monitorDestination"],
  },
  {
    types: "DNS",
    fields: "The domain name and the DNS server",
    stepFields: ["dnsMonitor.queryName", "dnsMonitor.hostname"],
  },
  {
    types: "DNSSEC, Domain",
    fields: "The domain name",
    // Each type's own domain name field.
    stepFields: ["domainName"],
  },
  {
    types: "SQL Query",
    fields: "The host, database name, username, password and query",
    stepFields: [
      "sqlMonitor.host",
      "sqlMonitor.databaseName",
      "sqlMonitor.username",
      "sqlMonitor.password",
      "sqlMonitor.query",
    ],
  },
  {
    types: "Database Health",
    fields: "The host, database name, username and password",
    stepFields: [
      "databaseMonitor.host",
      "databaseMonitor.databaseName",
      "databaseMonitor.username",
      "databaseMonitor.password",
    ],
  },
  {
    types: "External Status Page",
    fields: "The status page URL",
    stepFields: ["externalStatusPageMonitor.statusPageUrl"],
  },
  {
    types: "Synthetic Monitor, Custom JavaScript Code",
    fields: "The script",
    stepFields: ["customCode"],
  },
  {
    types: "Network Device",
    fields:
      "The SNMP community string, and the SNMPv3 authentication and privacy keys",
    stepFields: [
      "snmpMonitor.communityString",
      "snmpMonitor.snmpV3Auth.authKey",
      "snmpMonitor.snmpV3Auth.privKey",
    ],
  },
];

// A monitor type by the title the type picker gives it.
function monitorTypeTitled(title: string): MonitorType | undefined {
  return MonitorTypeHelper.getAllMonitorTypeProps().find(
    (props: MonitorTypeProps): boolean => {
      return props.title === title;
    },
  )?.monitorType;
}

describe("the fields that take a secret", () => {
  const rows: Array<Array<string>> = lastTableRows(
    section("### Using a secret"),
  );

  it("are the table the page shows", () => {
    expect(
      rows.map((row: Array<string>): { types: string; fields: string } => {
        return { types: row[0] as string, fields: row[1] as string };
      }),
    ).toEqual(
      DOCUMENTED_ROWS.map(
        (row: {
          types: string;
          fields: string;
        }): { types: string; fields: string } => {
          return { types: row.types, fields: row.fields };
        },
      ),
    );
  });

  it("name each monitor type as the type picker does", () => {
    for (const row of DOCUMENTED_ROWS) {
      for (const title of row.types.split(", ")) {
        expect({ title, picker: Boolean(monitorTypeTitled(title)) }).toEqual({
          title,
          picker: true,
        });
      }
    }
  });

  it("are exactly the fields the server fills secrets into, type by type", () => {
    const filled: Map<MonitorType, Set<string>> = fieldsFilledByType();
    const documentedTypes: Array<MonitorType> = [];

    for (const row of DOCUMENTED_ROWS) {
      for (const title of row.types.split(", ")) {
        const monitorType: MonitorType = monitorTypeTitled(
          title,
        ) as MonitorType;
        const fields: Array<string> = Array.from(filled.get(monitorType) || [])
          .map((field: string): string => {
            // DNSSEC's and Domain's own domain name field: "domainName".
            return field.endsWith("Monitor.domainName") ? "domainName" : field;
          })
          .sort();

        documentedTypes.push(monitorType);
        expect({ title, fields }).toEqual({
          title,
          fields: [...row.stepFields].sort(),
        });
      }
    }

    // And no type takes a secret that the table leaves out.
    expect(Array.from(filled.keys()).sort()).toEqual(documentedTypes.sort());
  });

  it("are filled in by the server before a probe gets the monitor", () => {
    const ingest: string = readRepoFile(PROBE_INGEST_FILE);

    expect(ingest).toContain("MonitorUtil.populateSecrets(");
    expect(ingest).toContain(
      "MonitorUtil.populateSecretsOnMonitorTest(monitorTest)",
    );
    expect(page).toContain(
      "Before OneUptime hands a monitor to a probe, it replaces each reference the monitor may use with the decrypted value",
    );
    expect(page).toContain("The probe that runs the check receives the value");
  });

  it("fill a reference the monitor may use, and leave any other as written", () => {
    const storage: { monitorSecrets: { ApiKey: string } } = {
      monitorSecrets: { ApiKey: "s3cret" },
    };

    expect(
      VMUtil.replaceValueInPlace(
        storage,
        "Authorization: Bearer {{monitorSecrets.ApiKey}}",
        false,
      ),
    ).toBe("Authorization: Bearer s3cret");
    expect(
      VMUtil.replaceValueInPlace(storage, "{{monitorSecrets.Other}}", false),
    ).toBe("{{monitorSecrets.Other}}");
    expect(page).toContain(
      "If a monitor references a secret it cannot use, the reference is left as it is and is not replaced with the value.",
    );
  });

  it("are filled in from All monitors secrets only while a monitor is not saved yet", () => {
    const loading: string = sourceBetween(
      readRepoFile(SECRET_FILLING_FILE),
      "public static async loadMonitorSecretsForMonitorTest(",
      "// True when any part",
    );

    expect(loading).toContain(
      "if (!data.monitorId) {\n      return await MonitorSecretService.getSecretsForUnsavedMonitor({",
    );
    expect(page).toContain(
      "When you test a monitor before saving it, only secrets available to **All monitors** are filled in",
    );
  });
});

describe("adding a secret", () => {
  const adding: string = section("### Adding a secret");

  it("starts under Monitors → Settings → Secrets", () => {
    const menu: string = readRepoFile(MONITORS_MENU_FILE);
    const settings: string = sourceBetween(
      menu,
      'title: "Settings",',
      'title: "Advanced"',
    );

    expect(settings).toContain('title: "Secrets",');
    expect(settings).toContain("PageMap.MONITORS_SETTINGS_SECRETS");
    expect(adding).toContain(
      "Go to **Monitors → Settings → Secrets** and click **Create Monitor Secret**.",
    );
  });

  it("creates it with the button the table draws, on a Secret step then an Access step", () => {
    const secretsPage: string = readRepoFile(SECRETS_PAGE_FILE);

    expect(new MonitorSecret().singularName).toBe("Monitor Secret");
    expect(secretsPage).toContain("isCreateable={true}");
    expect(secretsPage).toContain(
      `formSteps={[\n          { title: "Secret", id: "secret" },\n          { title: "Access", id: MONITOR_SECRET_ACCESS_STEP_ID },\n        ]}`,
    );
    expect(MONITOR_SECRET_ACCESS_STEP_ID).toBe("access");
    expect(secretsPage).toContain(
      'title: "Name",\n            stepId: "secret",',
    );
    expect(secretsPage).toContain(
      'title: "Secret Value",\n            stepId: "secret",',
    );
    expect(adding).toContain("Enter a **Name** and the **Secret Value**.");
    expect(adding).toContain(
      "On the **Access** step, choose which monitors can use it (see the next section), then click **Create Monitor Secret**.",
    );
  });

  it("takes a name of letters, numbers, hyphens and underscores, unique in the project", () => {
    const secretsPage: string = readRepoFile(SECRETS_PAGE_FILE);
    const nameField: string = sourceBetween(
      secretsPage,
      "field: {\n              name: true,",
      "disableSpellCheck: true,",
    );

    expect(nameField).toContain("noSpecialCharacters: true,");
    expect(readRepoFile(FORM_VALIDATION_FILE)).toContain(
      "can only contain letters, numbers, hyphens (-), and underscores (_).",
    );
    expect(readRepoFile(SECRET_MODEL_FILE)).toContain(
      '@UniqueColumnBy("projectId")\n  public name?: string = undefined;',
    );
    expect(adding).toContain(
      "It can only contain letters, numbers, hyphens (`-`) and underscores (`_`), and no two secrets in a project share one.",
    );
  });

  it("never reads a value back, and rotates it with Update Secret Value", () => {
    const model: string = readRepoFile(SECRET_MODEL_FILE);
    const valueColumn: string = sourceBetween(
      model,
      "@ColumnAccessControl({",
      "public secretValue?: string = undefined;",
    );
    const lastColumn: string = valueColumn.slice(
      valueColumn.lastIndexOf("@ColumnAccessControl({"),
    );

    expect(lastColumn).toContain("read: [],");
    expect(lastColumn).toContain("encrypted: true,");
    expect(readRepoFile(SECRETS_PAGE_FILE)).toContain(
      'title: "Update Secret Value",',
    );
    expect(page).toContain(
      "The secret value is never shown again after it is saved — not in the table, not in the edit form, and not over the API.",
    );
    expect(page).toContain(
      "To rotate a secret, use the **Update Secret Value** button on its row",
    );
  });
});

describe("who can use secrets", () => {
  const before: string = section("## Before you begin");

  it("needs the Growth plan on OneUptime Cloud", () => {
    const model: MonitorSecret = new MonitorSecret();

    expect(model.getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(model.getReadBillingPlan()).toBe(PlanType.Growth);
    expect(before).toContain(
      `- **The ${PlanType.Growth} plan or above**, on OneUptime Cloud. Self-hosted installs have no plans.`,
    );
  });

  it("names the roles that can create a secret, as the model allows", () => {
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      new MonitorSecret().getCreatePermissions(),
    );
    const line: string | undefined = before
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith("- **A role that can manage secrets**:");
      });

    expect(titles).toContain("Create Monitor Secret");
    expect(line).toBeDefined();

    for (const title of titles) {
      expect({ title, named: line!.includes(title) }).toEqual({
        title,
        named: true,
      });
    }

    expect(line).toContain(
      "a custom role with the Create Monitor Secret permission",
    );
  });
});
