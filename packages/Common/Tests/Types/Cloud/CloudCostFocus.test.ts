import {
  CLOUD_COST_FOCUS_COLUMNS,
  CLOUD_COST_FOCUS_VERSION,
  CloudCostFocusChargeCategory,
  CloudCostFocusRow,
  CloudCostFocusServiceCategory,
  CloudCostFocusSource,
  getCloudCostFocusBillingAccountId,
  getCloudCostFocusChargeCategory,
  getCloudCostFocusCredit,
  getCloudCostFocusCsvHeader,
  getCloudCostFocusProviderName,
  getCloudCostFocusRegionName,
  getCloudCostFocusResourceName,
  getCloudCostFocusServiceCategory,
  toCloudCostFocusCsvLine,
  toCloudCostFocusDateTime,
  toCloudCostFocusDecimal,
  toCloudCostFocusField,
  toCloudCostFocusRows,
} from "../../../Types/Cloud/CloudCostFocus";
import { describe, expect, test } from "@jest/globals";

/*
 * THE FOCUS 1.2 EXPORT (#11009), against the specification itself: FOCUS
 * 1.2 (FOCUS_Spec, tag v1.2, specification/columns/*.md). Every column the
 * file writes, in its order, every value it may take and the format of each,
 * as a FOCUS reader checks them.
 */

// FOCUS 1.2's Mandatory columns: each column file whose Feature level is Mandatory.
const FOCUS_1_2_MANDATORY: Array<string> = [
  "BilledCost",
  "BillingAccountId",
  "BillingAccountName",
  "BillingCurrency",
  "BillingPeriodEnd",
  "BillingPeriodStart",
  "ChargeCategory",
  "ChargeClass",
  "ChargeDescription",
  "ChargePeriodEnd",
  "ChargePeriodStart",
  "ContractedCost",
  "EffectiveCost",
  "InvoiceIssuerName",
  "ListCost",
  "PricingQuantity",
  "PricingUnit",
  "ProviderName",
  "PublisherName",
  "ServiceCategory",
  "ServiceName",
];

// The Conditional columns OneUptime has the data for.
const FOCUS_1_2_CONDITIONAL_WRITTEN: Array<string> = [
  "RegionId",
  "RegionName",
  "ResourceId",
  "ResourceName",
  "SubAccountId",
  "SubAccountName",
  "Tags",
];

// FOCUS 1.2's allowed ServiceCategory values (columns/servicecategory.md).
const FOCUS_1_2_SERVICE_CATEGORIES: Array<string> = [
  "AI and Machine Learning",
  "Analytics",
  "Business Applications",
  "Compute",
  "Databases",
  "Developer Tools",
  "Multicloud",
  "Identity",
  "Integration",
  "Internet of Things",
  "Management and Governance",
  "Media",
  "Migration",
  "Mobile",
  "Networking",
  "Security",
  "Storage",
  "Web",
  "Other",
];

// FOCUS 1.2's allowed ChargeCategory values (columns/chargecategory.md).
const FOCUS_1_2_CHARGE_CATEGORIES: Array<string> = [
  "Usage",
  "Purchase",
  "Tax",
  "Credit",
  "Adjustment",
];

// "YYYY-MM-DDTHH:mm:ssZ", in UTC: FOCUS's date/time format.
const FOCUS_DATE_TIME: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// A FOCUS decimal: digits, at most one point, a leading minus, no exponent.
const FOCUS_DECIMAL: RegExp = /^-?\d+(\.\d+)?$/;

function source(
  overrides: Partial<CloudCostFocusSource> = {},
): CloudCostFocusSource {
  return {
    day: "2026-11-02",
    provider: "aws",
    accountId: "111111111111",
    accountName: "Production",
    billingAccountId: "999999999999",
    billingAccountName: "Acme management",
    service: "Amazon Elastic Compute Cloud",
    region: "us-east-1",
    resourceId: "i-0abc123",
    currency: "usd",
    cost: 10,
    amortizedCost: 7,
    netCost: 7,
    tags: { team: "payments" },
    ...overrides,
  };
}

/*
 * A minimal RFC 4180 reader: what a FOCUS loader does with the file. Nulls
 * come back as null (an empty, unquoted field), texts as written.
 */
function parseCsv(text: string): Array<Array<string | null>> {
  const rows: Array<Array<string | null>> = [];
  let row: Array<string | null> = [];
  let field: string = "";
  let isQuoted: boolean = false;
  let wasQuoted: boolean = false;
  let index: number = 0;

  const endField: () => void = (): void => {
    row.push(wasQuoted ? field : field === "" ? null : field);
    field = "";
    wasQuoted = false;
  };

  while (index < text.length) {
    const char: string = text.charAt(index);

    if (isQuoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 2;
        continue;
      }

      if (char === '"') {
        isQuoted = false;
        index++;
        continue;
      }

      field += char;
      index++;
      continue;
    }

    if (char === '"') {
      isQuoted = true;
      wasQuoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endField();
      rows.push(row);
      row = [];
    } else {
      field += char;
    }

    index++;
  }

  if (field !== "" || row.length > 0) {
    endField();
    rows.push(row);
  }

  return rows;
}

describe("the FOCUS 1.2 columns", () => {
  test("the file names the version it follows", () => {
    expect(CLOUD_COST_FOCUS_VERSION).toBe("1.2");
  });

  test("every Mandatory column of FOCUS 1.2 is written", () => {
    for (const column of FOCUS_1_2_MANDATORY) {
      expect(CLOUD_COST_FOCUS_COLUMNS).toContain(column);
    }
  });

  test("the Conditional columns OneUptime has the data for are written, and nothing outside the specification", () => {
    expect([...CLOUD_COST_FOCUS_COLUMNS].sort()).toEqual(
      [...FOCUS_1_2_MANDATORY, ...FOCUS_1_2_CONDITIONAL_WRITTEN].sort(),
    );
  });

  test("the columns are in the order FOCUS lists them, each once", () => {
    expect([...CLOUD_COST_FOCUS_COLUMNS]).toEqual(
      [...CLOUD_COST_FOCUS_COLUMNS].sort(),
    );
    expect(new Set(CLOUD_COST_FOCUS_COLUMNS).size).toBe(
      CLOUD_COST_FOCUS_COLUMNS.length,
    );
  });

  test("the header is the column IDs, one line", () => {
    expect(getCloudCostFocusCsvHeader()).toBe(
      `${CLOUD_COST_FOCUS_COLUMNS.join(",")}\n`,
    );
    expect(getCloudCostFocusCsvHeader().startsWith("BilledCost,")).toBe(true);
  });

  test("the allowed values are FOCUS 1.2's own", () => {
    expect(Object.values(CloudCostFocusServiceCategory).sort()).toEqual(
      [...FOCUS_1_2_SERVICE_CATEGORIES].sort(),
    );
    expect(Object.values(CloudCostFocusChargeCategory).sort()).toEqual(
      [...FOCUS_1_2_CHARGE_CATEGORIES].sort(),
    );
  });
});

describe("a cost as FOCUS rows", () => {
  test("a day's usage: what was billed, what it cost amortized, on its own day and month", () => {
    const rows: Array<CloudCostFocusRow> = toCloudCostFocusRows(source());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      BilledCost: 10,
      BillingAccountId: "999999999999",
      BillingAccountName: "Acme management",
      BillingCurrency: "USD",
      BillingPeriodEnd: "2026-12-01T00:00:00Z",
      BillingPeriodStart: "2026-11-01T00:00:00Z",
      ChargeCategory: "Usage",
      ChargeClass: null,
      ChargeDescription: "Amazon Elastic Compute Cloud usage",
      ChargePeriodEnd: "2026-11-03T00:00:00Z",
      ChargePeriodStart: "2026-11-02T00:00:00Z",
      ContractedCost: 10,
      EffectiveCost: 7,
      InvoiceIssuerName: "AWS",
      ListCost: 10,
      PricingQuantity: null,
      PricingUnit: null,
      ProviderName: "AWS",
      PublisherName: "AWS",
      RegionId: "us-east-1",
      RegionName: "US East (N. Virginia)",
      ResourceId: "i-0abc123",
      // A generated ID names it: FOCUS asks for no name rather than the ID again.
      ResourceName: null,
      ServiceCategory: "Compute",
      ServiceName: "Amazon Elastic Compute Cloud",
      SubAccountId: "111111111111",
      SubAccountName: "Production",
      Tags: '{"team":"payments"}',
    });
  });

  test("every row has every column, and nothing else", () => {
    for (const row of [
      ...toCloudCostFocusRows(source({ netCost: 5 })),
      ...toCloudCostFocusRows(source({ region: "", resourceId: "", tags: {} })),
    ]) {
      expect(Object.keys(row).sort()).toEqual(
        [...CLOUD_COST_FOCUS_COLUMNS].sort(),
      );
    }
  });

  test("of the Mandatory columns only ChargeClass, PricingQuantity and PricingUnit are ever null", () => {
    const rows: Array<CloudCostFocusRow> = [
      ...toCloudCostFocusRows(source({ netCost: 5 })),
      ...toCloudCostFocusRows(
        source({
          region: "",
          resourceId: "",
          tags: {},
          accountName: "",
          billingAccountId: "111111111111",
          billingAccountName: null,
          service: "",
        }),
      ),
      ...toCloudCostFocusRows(source({ provider: "azure", service: "Tax" })),
    ];

    for (const row of rows) {
      const nulls: Array<string> = FOCUS_1_2_MANDATORY.filter(
        (column: string): boolean => {
          return row[column] === null;
        },
      );

      // BillingAccountName may be null where the bill names no account.
      expect(
        nulls.filter((column: string): boolean => {
          return column !== "BillingAccountName";
        }),
      ).toEqual(["ChargeClass", "PricingQuantity", "PricingUnit"]);
    }
  });

  test("what the cloud took off is a Credit row of its own, so the usage row keeps its whole cost", () => {
    const rows: Array<CloudCostFocusRow> = toCloudCostFocusRows(
      source({ cost: 10, amortizedCost: 7, netCost: 6 }),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!["ChargeCategory"]).toBe("Usage");
    expect(rows[0]!["BilledCost"]).toBe(10);
    expect(rows[0]!["EffectiveCost"]).toBe(7);
    expect(rows[1]).toMatchObject({
      ChargeCategory: "Credit",
      ChargeDescription:
        "Credits, refunds and discounts on Amazon Elastic Compute Cloud",
      BilledCost: -1,
      EffectiveCost: -1,
      ListCost: -1,
      ContractedCost: -1,
      // The same day, account, service, Region and resource.
      ChargePeriodStart: "2026-11-02T00:00:00Z",
      SubAccountId: "111111111111",
      ServiceName: "Amazon Elastic Compute Cloud",
      RegionId: "us-east-1",
      ResourceId: "i-0abc123",
    });

    // Summed, the file's EffectiveCost is the net basis.
    expect(
      Number(rows[0]!["EffectiveCost"]) + Number(rows[1]!["EffectiveCost"]),
    ).toBe(6);
  });

  test("no Credit row for a cost without one, nor for one read before the bases, nor for float noise", () => {
    expect(toCloudCostFocusRows(source({ netCost: 7 }))).toHaveLength(1);
    expect(
      toCloudCostFocusRows(source({ cost: 4, amortizedCost: 4, netCost: 4 })),
    ).toHaveLength(1);
    expect(
      getCloudCostFocusCredit(
        source({ amortizedCost: 0.3, netCost: 0.1 + 0.2 }),
      ),
    ).toBe(0);
    expect(getCloudCostFocusCredit(source({ netCost: 7.5 }))).toBe(0.5);
  });

  test("AWS's Tax service is a Tax charge; nothing else is", () => {
    expect(toCloudCostFocusRows(source({ service: "Tax" }))[0]!).toMatchObject({
      ChargeCategory: "Tax",
      ChargeDescription: "Tax",
      ServiceName: "Tax",
    });
    expect(
      getCloudCostFocusChargeCategory({ provider: "AWS", service: " tax " }),
    ).toBe(CloudCostFocusChargeCategory.Tax);
    expect(
      getCloudCostFocusChargeCategory({ provider: "azure", service: "Tax" }),
    ).toBe(CloudCostFocusChargeCategory.Usage);
    expect(
      getCloudCostFocusChargeCategory({
        provider: "aws",
        service: "Amazon EC2",
      }),
    ).toBe(CloudCostFocusChargeCategory.Usage);
  });

  test("the last day of a year bills into its own December; ChargePeriodEnd is the next day, exclusive", () => {
    const row: CloudCostFocusRow = toCloudCostFocusRows(
      source({ day: "2026-12-31" }),
    )[0]!;

    expect(row["ChargePeriodStart"]).toBe("2026-12-31T00:00:00Z");
    expect(row["ChargePeriodEnd"]).toBe("2027-01-01T00:00:00Z");
    expect(row["BillingPeriodStart"]).toBe("2026-12-01T00:00:00Z");
    expect(row["BillingPeriodEnd"]).toBe("2027-01-01T00:00:00Z");
  });

  test("a leap day is a day of its February", () => {
    const row: CloudCostFocusRow = toCloudCostFocusRows(
      source({ day: "2028-02-29" }),
    )[0]!;

    expect(row["ChargePeriodEnd"]).toBe("2028-03-01T00:00:00Z");
    expect(row["BillingPeriodEnd"]).toBe("2028-03-01T00:00:00Z");
  });

  test("a day handed as a moment is that moment's UTC day", () => {
    const row: CloudCostFocusRow = toCloudCostFocusRows(
      source({ day: new Date("2026-11-02T23:30:00.000Z") }),
    )[0]!;

    expect(row["ChargePeriodStart"]).toBe("2026-11-02T00:00:00Z");

    // A day read from ClickHouse with its time.
    expect(
      toCloudCostFocusRows(source({ day: "2026-11-02 00:00:00" }))[0]![
        "ChargePeriodStart"
      ],
    ).toBe("2026-11-02T00:00:00Z");
  });

  test("every date is FOCUS's UTC date/time, and the charge period ends after it starts", () => {
    for (const day of [
      "2026-01-01",
      "2026-03-29",
      "2026-10-25",
      "2026-12-31",
    ]) {
      const row: CloudCostFocusRow = toCloudCostFocusRows(source({ day }))[0]!;

      for (const column of [
        "BillingPeriodEnd",
        "BillingPeriodStart",
        "ChargePeriodEnd",
        "ChargePeriodStart",
      ]) {
        expect(String(row[column])).toMatch(FOCUS_DATE_TIME);
      }

      expect(
        new Date(String(row["ChargePeriodEnd"])).getTime() -
          new Date(String(row["ChargePeriodStart"])).getTime(),
      ).toBe(24 * 60 * 60 * 1000);
      expect(
        new Date(String(row["ChargePeriodStart"])).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(String(row["BillingPeriodStart"])).getTime(),
      );
      expect(
        new Date(String(row["ChargePeriodEnd"])).getTime(),
      ).toBeLessThanOrEqual(
        new Date(String(row["BillingPeriodEnd"])).getTime(),
      );
    }

    expect(toCloudCostFocusDateTime(new Date("2026-11-02T05:06:07.890Z"))).toBe(
      "2026-11-02T05:06:07Z",
    );
  });

  test("a cost billed to no Region or resource, and with no tags, leaves those columns null", () => {
    const row: CloudCostFocusRow = toCloudCostFocusRows(
      source({ region: " ", resourceId: "", tags: {} }),
    )[0]!;

    expect(row["RegionId"]).toBeNull();
    expect(row["RegionName"]).toBeNull();
    expect(row["ResourceId"]).toBeNull();
    expect(row["ResourceName"]).toBeNull();
    expect(row["Tags"]).toBeNull();
  });

  test("a cost with no service name is still named, as ServiceName may never be null", () => {
    const row: CloudCostFocusRow = toCloudCostFocusRows(
      source({ service: "  " }),
    )[0]!;

    expect(row["ServiceName"]).toBe("Unknown");
    expect(row["ServiceCategory"]).toBe("Other");
  });

  test("the billing account's name is the account's own when it bills itself, and null when the bill names none", () => {
    expect(
      toCloudCostFocusRows(
        source({ billingAccountId: "111111111111", billingAccountName: null }),
      )[0]!["BillingAccountName"],
    ).toBe("Production");
    expect(
      toCloudCostFocusRows(source({ billingAccountName: null }))[0]![
        "BillingAccountName"
      ],
    ).toBeNull();
    expect(
      toCloudCostFocusRows(source({ billingAccountId: "" }))[0]![
        "BillingAccountId"
      ],
    ).toBe("111111111111");
  });

  test("a sub-account with no name is named by its ID", () => {
    expect(
      toCloudCostFocusRows(source({ accountName: " " }))[0]!["SubAccountName"],
    ).toBe("111111111111");
  });

  test("the currency is upper case, as ISO 4217 writes it", () => {
    expect(
      toCloudCostFocusRows(source({ currency: " eur " }))[0]![
        "BillingCurrency"
      ],
    ).toBe("EUR");
  });

  test("tags are a JSON object, keys as the cloud wrote them", () => {
    const tags: Record<string, string> = {
      "aws:createdBy": "AssumedRole:abc",
      Team: 'Pay "core"',
      "kubernetes.io/cluster/prod": "owned",
    };
    const row: CloudCostFocusRow = toCloudCostFocusRows(source({ tags }))[0]!;

    expect(JSON.parse(String(row["Tags"]))).toEqual(tags);
  });
});

describe("who bills it", () => {
  test("each cloud as its own FOCUS exports name it", () => {
    expect(getCloudCostFocusProviderName("aws")).toBe("AWS");
    expect(getCloudCostFocusProviderName(" AWS ")).toBe("AWS");
    expect(getCloudCostFocusProviderName("azure")).toBe("Microsoft");
    expect(getCloudCostFocusProviderName("gcp")).toBe("Google Cloud");
    expect(getCloudCostFocusProviderName("oracle")).toBe("oracle");
    expect(getCloudCostFocusProviderName("")).toBe("Unknown");
  });

  test("an AWS organization's bill is its management account's: the role's account", () => {
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "aws",
        accountId: "111111111111",
        roleArn: "arn:aws:iam::999999999999:role/OneUptimeCostReader",
      }),
    ).toBe("999999999999");
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "aws",
        accountId: "111111111111",
        roleArn: " arn:aws-us-gov:iam::888888888888:role/Reader ",
      }),
    ).toBe("888888888888");
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "aws",
        accountId: "111111111111",
        roleArn: "arn:aws:iam::not-an-account:role/Reader",
      }),
    ).toBe("111111111111");
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "aws",
        accountId: "111111111111",
      }),
    ).toBe("111111111111");
  });

  test("a Google Cloud export is one billing account's, named in its table", () => {
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "gcp",
        accountId: "shop-prod",
        billingExportTable:
          "billing-project.billing.gcp_billing_export_v1_01a2b3_c4d5e6_f7a8b9",
      }),
    ).toBe("01A2B3-C4D5E6-F7A8B9");
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "gcp",
        accountId: "shop-prod",
        billingExportTable:
          "p.d.gcp_billing_export_resource_v1_0AAAAA_BBBBBB_CCCCCC",
      }),
    ).toBe("0AAAAA-BBBBBB-CCCCCC");
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "gcp",
        accountId: "shop-prod",
        billingExportTable: "p.d.some_other_table",
      }),
    ).toBe("shop-prod");
  });

  test("an Azure subscription stands for its billing account, which is not read", () => {
    expect(
      getCloudCostFocusBillingAccountId({
        provider: "azure",
        accountId: "00000000-1111-2222-3333-444444444444",
        roleArn: "arn:aws:iam::999999999999:role/Ignored",
      }),
    ).toBe("00000000-1111-2222-3333-444444444444");
  });
});

describe("what it is for", () => {
  test.each([
    ["Amazon Elastic Compute Cloud", "Compute"],
    ["Amazon EC2", "Compute"],
    ["AWS Lambda", "Compute"],
    ["Amazon Elastic Container Service for Kubernetes", "Compute"],
    ["Virtual Machines", "Compute"],
    ["Compute Engine", "Compute"],
    ["Cloud Run", "Compute"],
    ["Amazon Relational Database Service", "Databases"],
    ["Amazon RDS", "Databases"],
    ["Amazon DynamoDB", "Databases"],
    ["Azure Cosmos DB", "Databases"],
    ["Cloud SQL", "Databases"],
    ["Amazon Simple Storage Service", "Storage"],
    ["Amazon S3", "Storage"],
    ["Storage", "Storage"],
    ["Cloud Storage", "Storage"],
    ["AmazonCloudWatch", "Management and Governance"],
    ["AWS Support (Business)", "Management and Governance"],
    ["Cloud Logging", "Management and Governance"],
    ["AWS Key Management Service", "Security"],
    ["Amazon GuardDuty", "Security"],
    ["Key Vault", "Security"],
    ["Amazon SageMaker", "AI and Machine Learning"],
    ["Amazon Bedrock", "AI and Machine Learning"],
    ["Vertex AI", "AI and Machine Learning"],
    ["BigQuery", "Analytics"],
    ["Amazon Athena", "Analytics"],
    ["Amazon CloudFront", "Networking"],
    ["Amazon Route 53", "Networking"],
    ["Bandwidth", "Networking"],
    ["Amazon Simple Queue Service", "Integration"],
    ["Amazon Cognito", "Identity"],
    ["AWS CodeBuild", "Developer Tools"],
    ["AWS IoT", "Internet of Things"],
    ["AWS Elemental MediaConvert", "Media"],
    ["AWS Database Migration Service", "Databases"],
    ["AWS Amplify", "Mobile"],
    ["Amazon WorkSpaces", "Business Applications"],
    ["Something nobody has billed before", "Other"],
    ["", "Other"],
  ])("%s is %s", (service: string, category: string) => {
    expect(getCloudCostFocusServiceCategory(service)).toBe(category);
  });

  test("every category given is one FOCUS 1.2 allows", () => {
    for (const service of [
      "Amazon EC2",
      "Azure App Service",
      "Google Kubernetes Engine",
      "Anthos",
      "Static Web Apps",
      "Azure Migrate",
      "Firebase",
      "Unheard of",
    ]) {
      expect(FOCUS_1_2_SERVICE_CATEGORIES).toContain(
        getCloudCostFocusServiceCategory(service),
      );
    }
  });
});

describe("where it ran", () => {
  test("each cloud's own names for its Regions, the ID where OneUptime knows none", () => {
    expect(
      getCloudCostFocusRegionName({ provider: "aws", regionId: "eu-west-1" }),
    ).toBe("Europe (Ireland)");
    expect(
      getCloudCostFocusRegionName({
        provider: "azure",
        regionId: "WestEurope",
      }),
    ).toBe("West Europe");
    expect(
      getCloudCostFocusRegionName({ provider: "gcp", regionId: "us-central1" }),
    ).toBe("Iowa");
    expect(
      getCloudCostFocusRegionName({
        provider: "aws",
        regionId: "mars-north-1",
      }),
    ).toBe("mars-north-1");
    expect(
      getCloudCostFocusRegionName({
        provider: "oracle",
        regionId: "us-ashburn-1",
      }),
    ).toBe("us-ashburn-1");
  });

  test("a resource's name: its Name tag, an Azure or Google Cloud ID's last part, never an AWS generated ID", () => {
    expect(
      getCloudCostFocusResourceName({
        provider: "aws",
        resourceId: "i-0abc",
        tags: { Name: " checkout-api " },
      }),
    ).toBe("checkout-api");
    expect(
      getCloudCostFocusResourceName({
        provider: "aws",
        resourceId: "i-0abc",
        tags: { name: "lower-case-key" },
      }),
    ).toBe("lower-case-key");
    expect(
      getCloudCostFocusResourceName({
        provider: "aws",
        resourceId: "arn:aws:rds:eu-west-1:111111111111:db:search",
        tags: {},
      }),
    ).toBeNull();
    expect(
      getCloudCostFocusResourceName({
        provider: "azure",
        resourceId:
          "/subscriptions/0000/resourceGroups/Shop/providers/Microsoft.Web/sites/Ledger/",
        tags: {},
      }),
    ).toBe("Ledger");
    expect(
      getCloudCostFocusResourceName({
        provider: "gcp",
        resourceId:
          "//compute.googleapis.com/projects/shop/zones/us-central1-a/instances/web-1",
        tags: {},
      }),
    ).toBe("web-1");
    // An ID that is its own last part names nothing new.
    expect(
      getCloudCostFocusResourceName({
        provider: "gcp",
        resourceId: "web-1",
        tags: {},
      }),
    ).toBeNull();
    expect(
      getCloudCostFocusResourceName({
        provider: "azure",
        resourceId: "",
        tags: { Name: "ignored without a resource" },
      }),
    ).toBeNull();
  });
});

describe("the CSV", () => {
  test("a figure is a plain decimal: no exponent, no plus, at most ten places", () => {
    expect(toCloudCostFocusDecimal(10)).toBe("10");
    expect(toCloudCostFocusDecimal(0.1 + 0.2)).toBe("0.3");
    expect(toCloudCostFocusDecimal(-1.5)).toBe("-1.5");
    expect(toCloudCostFocusDecimal(0.0000001234)).toBe("0.0000001234");
    expect(toCloudCostFocusDecimal(123456789.12)).toBe("123456789.12");
    // Ten places at most: what a float carries past them is noise.
    expect(toCloudCostFocusDecimal(1234.123456789012)).toBe("1234.123456789");
    expect(toCloudCostFocusDecimal(-0.1 - 0.2)).toBe("-0.3");
    expect(toCloudCostFocusDecimal(1e21)).toBe("1000000000000000000000");
    expect(toCloudCostFocusDecimal(1e-12)).toBe("0");
    expect(toCloudCostFocusDecimal(-0)).toBe("0");
    expect(toCloudCostFocusDecimal(-1e-12)).toBe("0");
    expect(toCloudCostFocusDecimal(Number.NaN)).toBe("0");

    for (const value of [10, 0.3, -1.5, 0.0000001234, 99999.9999]) {
      expect(toCloudCostFocusDecimal(value)).toMatch(FOCUS_DECIMAL);
    }
  });

  test("a null is an empty field; a text is quoted, even an empty one", () => {
    expect(toCloudCostFocusField(null)).toBe("");
    expect(toCloudCostFocusField("")).toBe('""');
    expect(toCloudCostFocusField("Amazon EC2")).toBe('"Amazon EC2"');
    expect(toCloudCostFocusField('say "hi"')).toBe('"say ""hi"""');
    expect(toCloudCostFocusField(2.5)).toBe("2.5");
  });

  test("a text that would start a spreadsheet formula starts with an apostrophe", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(toCloudCostFocusField(`${lead}cmd`)).toBe(`"'${lead}cmd"`);
    }

    // A figure is never a formula: a credit stays a negative number.
    expect(toCloudCostFocusField(-3)).toBe("-3");
  });

  test("a whole file reads back as FOCUS: the header, then every column of every row", () => {
    const rows: Array<CloudCostFocusRow> = [
      ...toCloudCostFocusRows(source({ netCost: 6 })),
      ...toCloudCostFocusRows(
        source({
          provider: "azure",
          accountId: "sub-1",
          accountName: "Shop, EU",
          billingAccountId: "sub-1",
          service: "Virtual Machines",
          region: "westeurope",
          resourceId:
            "/subscriptions/sub-1/resourceGroups/shop/providers/Microsoft.Compute/virtualMachines/vm-1",
          tags: { note: "line one\nline two", "=x": "-1" },
          cost: 2.25,
          amortizedCost: 2.25,
          netCost: 2.25,
          currency: "EUR",
        }),
      ),
    ];
    const text: string =
      getCloudCostFocusCsvHeader() +
      rows
        .map((row: CloudCostFocusRow): string => {
          return toCloudCostFocusCsvLine(row);
        })
        .join("");
    const parsed: Array<Array<string | null>> = parseCsv(text);

    expect(parsed[0]).toEqual([...CLOUD_COST_FOCUS_COLUMNS]);
    expect(parsed).toHaveLength(rows.length + 1);

    for (let index: number = 1; index < parsed.length; index++) {
      const line: Array<string | null> = parsed[index]!;
      const row: CloudCostFocusRow = rows[index - 1]!;

      expect(line).toHaveLength(CLOUD_COST_FOCUS_COLUMNS.length);

      CLOUD_COST_FOCUS_COLUMNS.forEach((column: string, position: number) => {
        const value: string | number | null = row[column]!;

        if (value === null) {
          expect(line[position]).toBeNull();
        } else if (typeof value === "number") {
          expect(Number(line[position])).toBeCloseTo(value, 10);
        } else {
          expect(line[position]).toBe(value);
        }
      });
    }

    // The Azure row's tags, with a newline and a formula-like key, read back whole.
    const azure: Array<string | null> = parsed[3]!;
    expect(
      JSON.parse(azure[CLOUD_COST_FOCUS_COLUMNS.indexOf("Tags")]!),
    ).toEqual({ note: "line one\nline two", "=x": "-1" });
    expect(azure[CLOUD_COST_FOCUS_COLUMNS.indexOf("SubAccountName")]).toBe(
      "Shop, EU",
    );
    expect(azure[CLOUD_COST_FOCUS_COLUMNS.indexOf("ResourceName")]).toBe(
      "vm-1",
    );
    expect(azure[CLOUD_COST_FOCUS_COLUMNS.indexOf("ProviderName")]).toBe(
      "Microsoft",
    );
  });

  test("a row missing a column writes it as null", () => {
    const line: string = toCloudCostFocusCsvLine({ BilledCost: 1 });
    const parsed: Array<string | null> = parseCsv(line)[0]!;

    expect(parsed).toHaveLength(CLOUD_COST_FOCUS_COLUMNS.length);
    expect(parsed[0]).toBe("1");
    expect(
      parsed.slice(1).every((value: string | null) => {
        return value === null;
      }),
    ).toBe(true);
  });
});
