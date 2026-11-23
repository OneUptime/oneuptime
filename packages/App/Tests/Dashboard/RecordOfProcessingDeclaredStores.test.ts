import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ComplianceFramework from "Common/Types/DataSecurity/ComplianceFramework";
import DataCategory from "Common/Types/DataSecurity/DataCategory";
import {
  DataSecurityDeclaredStore,
  DataSecurityRecordOfProcessingRow,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import {
  DeclaredStoreReaders,
  DeclaredStoreRetentionBasis,
} from "Common/Types/DataSecurity/DeclaredDataStore";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { Translator, createTranslator } from "Common/Types/Translator";
import * as DownloadFile from "Common/UI/Utils/DownloadFile";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import {
  downloadRecordOfProcessingJson,
  getRecordOfProcessingCsv,
  getRecordOfProcessingJson,
  getRecordWhoCanRead,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/ComplianceExport";
import {
  DECLARED_PURPOSE,
  RETENTION_FOLLOWS_SETTINGS,
  RETENTION_FROM_ARRIVAL,
  RETENTION_FROM_LAST_SEEN,
  getDeclaredPurposeText,
  getDeclaredReaderNames,
  getDeclaredRetentionHint,
  getDeclaredRetentionText,
  getStoreDisplayName,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/DeclaredStoreCopy";
import { sortRecordRows } from "../../FeatureSet/Dashboard/src/Components/DataSecurity/RecordOfProcessingRows";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import fs from "fs";
import path from "path";

/*
 * THE RECORD OF PROCESSING, WITH THE STORES ONEUPTIME DECLARES (#10398).
 *
 * Security Events, Network Flows and the address vault are listed beside
 * the stores Data Security found: in the reader's language on the page -
 * OneUptime's purpose and retention while they are OneUptime's, the team's
 * as written - and in the exports as the English an auditor files them
 * under, with who can read each and that OneUptime declares it.
 */

const SECURITY_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityEvent,
];

function declaredOf(
  overrides: Partial<DataSecurityDeclaredStore> = {},
): DataSecurityDeclaredStore {
  return {
    kind: DataStoreKind.SecurityEvents,
    purpose: "Network and information security (GDPR Recital 49)",
    retentionInDays: 15,
    retentionBasis: DeclaredStoreRetentionBasis.SecurityEvents,
    retentionText: "15 days",
    isPurposeTheTeams: false,
    isRetentionTheTeams: false,
    readers: DeclaredStoreReaders.Roles,
    readPermissions: [...SECURITY_READERS],
    readerNames: PermissionHelper.getPermissionTitles(SECURITY_READERS),
    dataTypeNames: ["IP address", "Username", "Email address"],
    fields: ["principalIp", "targetIp"],
    ...overrides,
  };
}

function rowOf(
  overrides: Partial<DataSecurityRecordOfProcessingRow> = {},
): DataSecurityRecordOfProcessingRow {
  return {
    dataStoreId: "22222222-2222-4222-8222-222222222222",
    name: "crm-exports",
    kind: DataStoreKind.AwsS3Bucket,
    provider: "aws",
    region: "eu-west-1",
    environment: "Production",
    sensitivity: DataSensitivity.Confidential,
    dataCategories: [DataCategory.ContactAndIdentity],
    dataTypeNames: ["Email address"],
    owners: ["Alice Owner"],
    purpose: "Customer support exports",
    retention: "90 days",
    frameworks: [ComplianceFramework.GDPR, ComplianceFramework.CCPA],
    ...overrides,
  };
}

const SECURITY_EVENTS: DataSecurityRecordOfProcessingRow = rowOf({
  dataStoreId: "33333333-3333-4333-8333-333333333333",
  name: "Security Events",
  kind: DataStoreKind.SecurityEvents,
  provider: "oneuptime",
  region: "",
  environment: "",
  dataTypeNames: ["IP address", "Username", "Email address"],
  owners: [],
  purpose: "Network and information security (GDPR Recital 49)",
  retention: "15 days",
  declared: declaredOf(),
});

const VAULT: DataSecurityRecordOfProcessingRow = rowOf({
  dataStoreId: "44444444-4444-4444-8444-444444444444",
  name: "Security Address Vault",
  kind: DataStoreKind.SecurityAddressVault,
  provider: "oneuptime",
  region: "",
  environment: "",
  dataTypeNames: ["IP address"],
  owners: [],
  purpose: "Network and information security (GDPR Recital 49)",
  retention: "30 days after an address was last seen",
  declared: declaredOf({
    kind: DataStoreKind.SecurityAddressVault,
    retentionInDays: 30,
    retentionBasis: DeclaredStoreRetentionBasis.AddressVault,
    retentionText: "30 days after an address was last seen",
    readers: DeclaredStoreReaders.SecurityEventsScansOnly,
    readPermissions: [],
    readerNames: [],
  }),
});

const ENGLISH: Translator = createTranslator(undefined, "en");

// German, as its locale words these keys.
const GERMAN_WORDS: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../FeatureSet/Dashboard/src/Locales/de.json"),
    "utf8",
  ),
) as Record<string, string>;

const GERMAN: Translator = createTranslator((text: string) => {
  const value: string | undefined = GERMAN_WORDS[text];

  return typeof value === "string" ? value : undefined;
}, "de");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the record's CSV", () => {
  function lines(
    rows: Array<DataSecurityRecordOfProcessingRow>,
  ): Array<string> {
    return getRecordOfProcessingCsv(rows).split("\r\n");
  }

  test("has a column for who can read a store, and one for who declares it", () => {
    expect(lines([])[0]).toBe(
      "Data Store,Kind,Provider,Region,Environment,Sensitivity,Data Categories,Data Types,Owners,Purpose,Retention,Who Can Read,Frameworks,Declared By",
    );
  });

  test("a declared store says its purpose, retention, readers and that OneUptime declares it", () => {
    const row: Array<string> = lines([SECURITY_EVENTS])[1]!.split(",");

    expect(row[0]).toBe("Security Events");
    expect(row[9]).toBe("Network and information security (GDPR Recital 49)");
    expect(row[10]).toBe("15 days");
    expect(row[11]).toBe(
      PermissionHelper.getPermissionTitles(SECURITY_READERS).join("; "),
    );
    expect(row[11]).toContain("Security Viewer");
    expect(row[13]).toBe("OneUptime");
  });

  test("the vault is read only by Security Events' scans", () => {
    expect(getRecordWhoCanRead(VAULT)).toBe(
      "Only Security Events' scans, inside OneUptime",
    );
    // Its comma is the value's own: quoted, as RFC 4180 has it.
    expect(lines([VAULT])[1]).toContain(
      '30 days after an address was last seen,"Only Security Events\' scans, inside OneUptime",GDPR; CCPA,OneUptime',
    );
  });

  test("a store Data Security found has neither: its access is its own page's", () => {
    const row: Array<string> = lines([rowOf()])[1]!.split(",");

    expect(getRecordWhoCanRead(rowOf())).toBe("");
    expect(row[11]).toBe("");
    expect(row[13]).toBe("");
    expect(row[9]).toBe("Customer support exports");
  });

  test("a team's purpose that would run as a formula is made text", () => {
    const csv: string = getRecordOfProcessingCsv([
      rowOf({
        ...SECURITY_EVENTS,
        purpose: '=HYPERLINK("https://evil.example")',
        declared: declaredOf({ isPurposeTheTeams: true }),
      }),
    ]);

    expect(csv).toContain(
      TableColumnsToCsv.escapeCsvValue(
        TableColumnsToCsv.sanitizeForCsvInjection(
          '=HYPERLINK("https://evil.example")',
        ),
      ),
    );
    expect(csv).not.toContain(",=HYPERLINK");
  });
});

describe("the record's JSON", () => {
  test("every row as the server wrote it, a declared store's declaration in it, and when it was exported", () => {
    const exportedAt: Date = new Date("2026-11-22T12:00:00.000Z");
    const json: {
      exportedAt: string;
      rows: Array<DataSecurityRecordOfProcessingRow>;
    } = JSON.parse(
      getRecordOfProcessingJson([rowOf(), SECURITY_EVENTS, VAULT], exportedAt),
    );

    expect(json.exportedAt).toBe("2026-11-22T12:00:00.000Z");
    expect(json.rows).toEqual([rowOf(), SECURITY_EVENTS, VAULT]);
    expect(json.rows[1]!.declared).toMatchObject({
      readers: DeclaredStoreReaders.Roles,
      readPermissions: SECURITY_READERS,
    });
    expect(json.rows[2]!.declared?.readers).toBe(
      DeclaredStoreReaders.SecurityEventsScansOnly,
    );
  });

  test("is downloaded as a JSON file named for the record", () => {
    let written: { content: string; filename: string; mimeType: string } = {
      content: "",
      filename: "",
      mimeType: "",
    };

    jest
      .spyOn(DownloadFile, "default")
      .mockImplementation(
        (data: Parameters<typeof DownloadFile.default>[0]): void => {
          written = data as unknown as typeof written;
        },
      );

    downloadRecordOfProcessingJson(
      [SECURITY_EVENTS],
      new Date("2026-11-22T12:00:00.000Z"),
    );

    expect(written.mimeType).toBe("application/json;charset=utf-8;");
    expect(written.filename).toContain("record-of-processing");
    expect(written.filename.endsWith(".json")).toBe(true);
    expect(JSON.parse(written.content).rows[0].declared.kind).toBe(
      DataStoreKind.SecurityEvents,
    );
  });
});

describe("a declared store's words", () => {
  test("OneUptime's purpose reads in the reader's language; the team's as written", () => {
    expect(
      getDeclaredPurposeText(
        { purpose: SECURITY_EVENTS.purpose, declared: declaredOf() },
        ENGLISH,
      ),
    ).toBe("Network and information security (GDPR Recital 49)");
    expect(
      getDeclaredPurposeText(
        { purpose: SECURITY_EVENTS.purpose, declared: declaredOf() },
        GERMAN,
      ),
    ).toBe(GERMAN_WORDS[DECLARED_PURPOSE]);
    expect(GERMAN_WORDS[DECLARED_PURPOSE]).not.toBe(DECLARED_PURPOSE);
    expect(
      getDeclaredPurposeText(
        {
          purpose: "Angriffe auf unseren Shop erkennen",
          declared: declaredOf({ isPurposeTheTeams: true }),
        },
        ENGLISH,
      ),
    ).toBe("Angriffe auf unseren Shop erkennen");
  });

  test("OneUptime's retention is a count of days, the vault's after an address was last seen", () => {
    expect(
      getDeclaredRetentionText(
        { retention: "", declared: declaredOf() },
        ENGLISH,
      ),
    ).toBe("15 days");
    expect(
      getDeclaredRetentionText(
        { retention: "", declared: declaredOf({ retentionInDays: 1 }) },
        ENGLISH,
      ),
    ).toBe("1 day");
    expect(
      getDeclaredRetentionText(
        { retention: "", declared: VAULT.declared! },
        ENGLISH,
      ),
    ).toBe("30 days after an address was last seen");
    expect(
      getDeclaredRetentionText(
        { retention: "", declared: VAULT.declared! },
        GERMAN,
      ),
    ).not.toContain("after an address");
    expect(
      getDeclaredRetentionText(
        {
          retention: "Ein Jahr",
          declared: declaredOf({ isRetentionTheTeams: true }),
        },
        GERMAN,
      ),
    ).toBe("Ein Jahr");
  });

  test("says where OneUptime's retention comes from", () => {
    expect(getDeclaredRetentionHint(declaredOf())).toBe(
      RETENTION_FOLLOWS_SETTINGS,
    );
    expect(
      getDeclaredRetentionHint(
        declaredOf({
          retentionBasis: DeclaredStoreRetentionBasis.NetworkFlows,
        }),
      ),
    ).toBe(RETENTION_FROM_ARRIVAL);
    expect(getDeclaredRetentionHint(VAULT.declared!)).toBe(
      RETENTION_FROM_LAST_SEEN,
    );
  });

  test("names who can read it by its roles, in the reader's language - and the vault by nobody", () => {
    expect(getDeclaredReaderNames(declaredOf(), ENGLISH)).toEqual(
      PermissionHelper.getPermissionTitles(SECURITY_READERS),
    );
    expect(getDeclaredReaderNames(VAULT.declared!, ENGLISH)).toEqual([]);
  });
});

describe("the record on Compliance", () => {
  test("reads down by store name", () => {
    expect(
      sortRecordRows([VAULT, rowOf(), SECURITY_EVENTS]).map(
        (row: DataSecurityRecordOfProcessingRow): string => {
          return row.name;
        },
      ),
    ).toEqual(["crm-exports", "Security Address Vault", "Security Events"]);
  });
});

describe("a store's name on its row", () => {
  function storeOf(name: string, kind: DataStoreKind): DataStore {
    const store: DataStore = new DataStore();
    store.name = name;
    store.kind = kind;
    return store;
  }

  test("a declared store named for its kind reads in the reader's language", () => {
    expect(
      getStoreDisplayName(
        storeOf("Security Address Vault", DataStoreKind.SecurityAddressVault),
        GERMAN,
      ),
    ).toBe(GERMAN_WORDS["Security Address Vault"]);
  });

  test("a name the team gave it, and any other store's, read as written", () => {
    expect(
      getStoreDisplayName(
        storeOf("SIEM events", DataStoreKind.SecurityEvents),
        GERMAN,
      ),
    ).toBe("SIEM events");
    expect(
      getStoreDisplayName(storeOf("Logs", DataStoreKind.AwsS3Bucket), GERMAN),
    ).toBe("Logs");
  });
});
