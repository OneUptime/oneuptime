import ProductionReviewSensitiveData, {
  parseColumnLocation,
  TableKnowledge,
  TelemetryKnowledge,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewSensitiveData";
import { SensitiveDataCandidate } from "../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import { CodeHostChangedFile } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import DataAssetService from "../../../../../Server/Services/DataAssetService";
import DataAssetUsageService from "../../../../../Server/Services/DataAssetUsageService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DataAsset from "../../../../../Models/DatabaseModels/DataAsset";
import DataAssetUsage from "../../../../../Models/DatabaseModels/DataAssetUsage";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import {
  ProductionReviewLeakJSON,
  ProductionReviewSensitiveDataJSON,
  ProductionReviewSensitiveDataUtil,
  SensitiveDataColumn,
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT PRODUCTION KNOWS MAKES A POINT SHARPER (#10376): the store a
 * resource is - its sensitivity is how bad a public bucket is, and a store
 * marked Public By Design makes no point for being public - and where the
 * service's own telemetry already held what a line writes, and whether a
 * scrub rule masks it at ingest. All of it kept apart from the point.
 */

const SERVICE_ID: string = "8b5b7f2e-2c3d-4c6a-9e1f-5a6b7c8d9e01";
const LOGS_STORE_ID: string = "5d1c2b3a-0000-4000-8000-0000000000a1";

function bucketCandidate(
  change: Partial<SensitiveDataCandidate> = {},
): SensitiveDataCandidate {
  return {
    kind: SensitiveDataLeakKind.Infrastructure,
    checkId: "public-read",
    path: "infra/s3.tf",
    line: 3,
    lineText: '  acl    = "public-read"',
    subject: "acl",
    where: "aws_s3_bucket.exports",
    value: '"public-read"',
    dataTypes: [],
    sensitivity: DataSensitivity.Confidential,
    isBlocking: true,
    isStoreKnown: false,
    text: "Sets `acl` to `public-read` on `aws_s3_bucket.exports` in Terraform, which makes the store readable by anyone on the internet.",
    fix: "Set `acl` to `private`.",
    resourceType: "aws_s3_bucket",
    resourceNames: ["acme-card-exports"],
    ...change,
  };
}

function emailCandidate(
  change: Partial<SensitiveDataCandidate> = {},
): SensitiveDataCandidate {
  return {
    kind: SensitiveDataLeakKind.Telemetry,
    checkId: "sensitive-data-in-telemetry",
    sink: SensitiveDataSink.Log,
    path: "services/checkout/src/signup.ts",
    line: 11,
    lineText: '  logger.info("signup", { email });',
    subject: "email",
    where: "logger.info",
    dataTypes: [
      {
        id: "email-address",
        name: "Email address",
        sensitivity: DataSensitivity.Confidential,
        category: null,
      },
    ],
    sensitivity: DataSensitivity.Confidential,
    isBlocking: false,
    text: "Writes an email address to a log: `email`, in `logger.info`.",
    fix: "Leave `email` out.",
    location: "attributes.email",
    ...change,
  };
}

function store(change: Partial<DataStore> = {}): DataStore {
  const made: DataStore = new DataStore();

  made.id = new ObjectID("5d1c2b3a-0000-4000-8000-0000000000b1");
  made.name = "acme-card-exports";
  made.kind = DataStoreKind.AwsS3Bucket;
  made.sensitivity = DataSensitivity.Restricted;
  made.dataTypeIds = ["credit-card-number", "email-address"];
  Object.assign(made, change);

  return made;
}

const NO_TELEMETRY: TelemetryKnowledge = {
  servicesByPath: new Map(),
  stores: [],
  findings: [],
  coverage: { rules: [] },
};

function pointOf(
  candidate: SensitiveDataCandidate,
  data: {
    stores?: Array<DataStore>;
    telemetry?: TelemetryKnowledge;
    isFailOn?: boolean;
  } = {},
): ProductionReviewLeakJSON | null {
  return ProductionReviewSensitiveData.toPoint({
    candidate,
    stores: data.stores || [],
    telemetry: data.telemetry || NO_TELEMETRY,
    isFailOn: data.isFailOn ?? true,
    occurrences: new Map<string, number>(),
  });
}

describe("a resource the project knows as one of its stores", () => {
  test("a store of Restricted data: its severity, and the store kept apart - the point's own sensitivity the diff's", () => {
    const point: ProductionReviewLeakJSON = pointOf(bucketCandidate(), {
      stores: [store()],
    })!;

    expect(point).toMatchObject({
      sensitivity: DataSensitivity.Confidential,
      severity: SecuritySeverity.Critical,
      isBlocking: true,
      failsCheck: true,
      production: {
        store: {
          dataStoreId: "5d1c2b3a-0000-4000-8000-0000000000b1",
          name: "acme-card-exports",
          sensitivity: DataSensitivity.Restricted,
          dataTypeNames: ["Card number", "Email address"],
        },
      },
    });
  });

  test("marked Public By Design: no point for being public", () => {
    expect(
      pointOf(bucketCandidate(), {
        stores: [store({ isPublicByDesign: true })],
      }),
    ).toBeNull();
  });

  test("marked Public By Design, it still gets a point for what being public does not explain", () => {
    expect(
      pointOf(
        bucketCandidate({
          checkId: "not-encrypted-at-rest",
          isBlocking: false,
        }),
        { stores: [store({ isPublicByDesign: true })] },
      ),
    ).not.toBeNull();
  });

  test("a store that holds nothing sensitive: a point, which never fails the check", () => {
    const point: ProductionReviewLeakJSON = pointOf(bucketCandidate(), {
      stores: [store({ sensitivity: DataSensitivity.Public })],
    })!;

    expect(point.isBlocking).toBe(false);
    expect(point.failsCheck).toBe(false);
    expect(point.severity).toBe(SecuritySeverity.Low);
  });

  test("a check Data Security raises nothing for on the store: no point either", () => {
    expect(
      pointOf(
        bucketCandidate({
          checkId: "not-encrypted-at-rest",
          isBlocking: false,
        }),
        { stores: [store({ sensitivity: DataSensitivity.Public })] },
      ),
    ).toBeNull();
  });

  test("a store's own sensitivity override is the one read", () => {
    const point: ProductionReviewLeakJSON = pointOf(bucketCandidate(), {
      stores: [
        store({
          sensitivity: DataSensitivity.Restricted,
          sensitivityOverride: DataSensitivity.Internal,
        }),
      ],
    })!;

    expect(point.production!.store!.sensitivity).toBe(DataSensitivity.Internal);
    expect(point.isBlocking).toBe(false);
  });

  test("a store of that name in another cloud is not it", () => {
    expect(
      ProductionReviewSensitiveData.findStore(bucketCandidate(), [
        store({ kind: DataStoreKind.AzureStorageAccount }),
      ]),
    ).toBeNull();
    expect(
      ProductionReviewSensitiveData.findStore(bucketCandidate(), [store()]),
    ).not.toBeNull();
  });

  test("no store known: the rule's own word - a public store can fail the check", () => {
    const point: ProductionReviewLeakJSON = pointOf(bucketCandidate())!;

    expect(point.isBlocking).toBe(true);
    expect(point.failsCheck).toBe(true);
    expect(point.production).toBeUndefined();
  });

  test("with the switch off, nothing fails the check", () => {
    expect(
      pointOf(bucketCandidate(), { stores: [store()], isFailOn: false })!
        .failsCheck,
    ).toBe(false);
  });
});

describe("what the service's telemetry already held", () => {
  function telemetry(
    findings: Array<Partial<DataStoreFinding>>,
    rules: TelemetryKnowledge["coverage"]["rules"] = [],
  ): TelemetryKnowledge {
    const logs: DataStore = new DataStore();

    logs.id = new ObjectID(LOGS_STORE_ID);
    logs.kind = DataStoreKind.TelemetryLogs;
    logs.serviceId = new ObjectID(SERVICE_ID);

    return {
      servicesByPath: new Map([
        [
          "services/checkout/src/signup.ts",
          [
            {
              id: SERVICE_ID,
              name: "checkout-api",
              method: "stack-trace",
              evidence: "",
              pathInRepository: null,
            },
          ],
        ],
      ]),
      stores: [logs],
      findings: findings.map((change: Partial<DataStoreFinding>) => {
        const finding: DataStoreFinding = new DataStoreFinding();

        finding.dataStoreId = new ObjectID(LOGS_STORE_ID);
        finding.dataTypeId = "email-address";
        finding.dataTypeName = "Email address";
        finding.lastSeenAt = new Date("2026-10-21T10:00:00.000Z");
        finding.isScrubbed = false;
        Object.assign(finding, change);

        return finding;
      }),
      coverage: { rules },
    };
  }

  test("its own location first, then another of the same data, two at most", () => {
    const point: ProductionReviewLeakJSON = pointOf(emailCandidate(), {
      telemetry: telemetry([
        { location: "attributes.user.email" },
        { location: "attributes.email" },
        { location: "body" },
      ]),
    })!;

    expect(
      point.production!.heldBefore!.map(
        (place: {
          location: string;
          serviceName: string;
          storeKind: string;
        }) => {
          return [place.location, place.serviceName, place.storeKind];
        },
      ),
    ).toEqual([
      ["attributes.email", "checkout-api", DataStoreKind.TelemetryLogs],
      ["attributes.user.email", "checkout-api", DataStoreKind.TelemetryLogs],
    ]);
    expect(point.production!.maskedAtIngestBy).toBeUndefined();
  });

  test("masked at ingest where it is written: still a point, and it says by what", () => {
    const point: ProductionReviewLeakJSON = pointOf(emailCandidate(), {
      telemetry: telemetry(
        [{ location: "attributes.email", isScrubbed: true }],
        [
          {
            id: "rule-1",
            name: "Mask emails",
            signal: "log",
            patternType: "email",
            fieldsToScrub: "both",
          },
        ],
      ),
    })!;

    expect(point.production!.maskedAtIngestBy).toBe("Mask emails");
  });

  test("a finding masked there, with no rule of the service's to name: masked, by no name", () => {
    const point: ProductionReviewLeakJSON = pointOf(emailCandidate(), {
      telemetry: telemetry([
        { location: "attributes.email", isScrubbed: true },
      ]),
    })!;

    expect(point.production!.maskedAtIngestBy).toBe("");
  });

  test("a store of another kind than the line writes to is not where it held it", () => {
    const point: ProductionReviewLeakJSON = pointOf(
      emailCandidate({ sink: SensitiveDataSink.Span }),
      { telemetry: telemetry([{ location: "attributes.email" }]) },
    )!;

    expect(point.production).toBeUndefined();
  });
});

/*
 * WHAT DATA SECURITY KNOWS OF A MIGRATION'S TABLE (#10779): the store the
 * table is in - by the findings in its columns, and the tables Data
 * Observability watches - what that store holds, what of it the new
 * column inherits, and the table's columns already found holding what
 * the new one is for. Read for a private repository alone; it never
 * changes how bad the point is.
 */
describe("a migration's table, as Data Security knows it (#10779)", () => {
  const ORDERS_DB_ID: string = "5d1c2b3a-0000-4000-8000-0000000000c1";
  const STAGING_DB_ID: string = "5d1c2b3a-0000-4000-8000-0000000000c2";
  const CUSTOMERS_ASSET_ID: string = "5d1c2b3a-0000-4000-8000-0000000000d1";

  function ssnColumn(
    change: Partial<SensitiveDataCandidate> = {},
  ): SensitiveDataCandidate {
    return {
      kind: SensitiveDataLeakKind.Migration,
      checkId: "new-personal-data-column",
      column: SensitiveDataColumn.PersonalData,
      path: "db/migrations/20261124_add_customer_ssn.sql",
      line: 1,
      lineText: "ALTER TABLE customers ADD COLUMN customer_ssn VARCHAR(11);",
      subject: "customer_ssn",
      where: "customers",
      dataTypes: [
        {
          id: "us-ssn",
          name: "US Social Security number",
          sensitivity: DataSensitivity.Restricted,
          category: null,
        },
      ],
      sensitivity: DataSensitivity.Restricted,
      isBlocking: false,
      text: "Adds the column `customer_ssn` to `customers`, whose name says it holds a US Social Security number.",
      fix: "Store it only if you must, encrypted or tokenized, and say in your record of processing what it is for.",
      ...change,
    };
  }

  function dbStore(change: Partial<DataStore> = {}): DataStore {
    const made: DataStore = new DataStore();

    made.id = new ObjectID(ORDERS_DB_ID);
    made.name = "orders-db";
    made.kind = DataStoreKind.AwsRdsInstance;
    made.sensitivity = DataSensitivity.Restricted;
    made.dataTypeIds = ["us-ssn", "email-address"];
    made.environment = DataStoreEnvironment.Production;
    made.exposure = DataStoreExposure.Private;
    Object.assign(made, change);

    return made;
  }

  function columnFinding(
    change: Partial<DataStoreFinding> = {},
  ): DataStoreFinding {
    const made: DataStoreFinding = new DataStoreFinding();

    made.dataStoreId = new ObjectID(ORDERS_DB_ID);
    made.dataTypeId = "us-ssn";
    made.dataTypeName = "US Social Security number";
    made.sensitivity = DataSensitivity.Restricted;
    made.location = "public.customers.ssn_last4";
    made.locationKind = "Column";
    made.lastSeenAt = new Date("2026-11-22T10:00:00.000Z");
    made.matchCount = 40;
    made.isSuppressed = false;
    Object.assign(made, change);

    return made;
  }

  function knowledge(change: Partial<TableKnowledge> = {}): TableKnowledge {
    return {
      stores: [dbStore()],
      findings: [columnFinding()],
      assets: [],
      ...change,
    };
  }

  describe("a column's location, read for a table", () => {
    test.each([
      [
        "public.customers.ssn_last4",
        "customers",
        "public.customers",
        "ssn_last4",
      ],
      ["customers.ssn", "customers", "customers", "ssn"],
      [
        "analytics.public.customers.email",
        "customers",
        "analytics.public.customers",
        "email",
      ],
      ["Public.Customers.SSN", "customers", "Public.Customers", "SSN"],
      ["customers.address.city", "customers", "customers", "address.city"],
    ])(
      "%s is %s's",
      (location: string, table: string, named: string, column: string) => {
        expect(parseColumnLocation(location, table)).toEqual({
          table: named,
          column,
        });
      },
    );

    test.each([
      ["public.customers_audit.ssn", "customers"],
      ["public.orders.customers", "customers"],
      ["customers", "customers"],
      ["a.b.c.customers.ssn", "customers"],
      ["", "customers"],
    ])("%s is no column of %s", (location: string, table: string) => {
      expect(parseColumnLocation(location, table)).toBeNull();
    });
  });

  describe("what a point is told", () => {
    test("the store the table is in, what it holds, and the column that already holds the same data", () => {
      const known: ReturnType<
        typeof ProductionReviewSensitiveData.readTableKnown
      > = ProductionReviewSensitiveData.readTableKnown(
        ssnColumn(),
        knowledge(),
      );

      expect(known).toEqual({
        store: {
          dataStoreId: ORDERS_DB_ID,
          name: "orders-db",
          sensitivity: DataSensitivity.Restricted,
          dataTypeNames: ["US Social Security number", "Email address"],
        },
        table: {
          name: "public.customers",
          dataTypeNames: ["US Social Security number"],
          sameData: [
            {
              location: "public.customers.ssn_last4",
              dataTypeName: "US Social Security number",
              lastSeenAt: "2026-11-22T10:00:00.000Z",
            },
          ],
          otherStoreCount: 0,
        },
      });
    });

    test("other kinds of data the table holds are named, never as the same data", () => {
      const known: ReturnType<
        typeof ProductionReviewSensitiveData.readTableKnown
      > = ProductionReviewSensitiveData.readTableKnown(
        ssnColumn(),
        knowledge({
          findings: [
            columnFinding({
              dataTypeId: "email-address",
              dataTypeName: "Email address",
              sensitivity: DataSensitivity.Confidential,
              location: "public.customers.email",
            }),
            columnFinding({
              dataTypeId: "phone-number",
              dataTypeName: "Phone number",
              sensitivity: DataSensitivity.Confidential,
              location: "public.customers.phone",
            }),
          ],
        }),
      );

      expect(known!.table.sameData).toEqual([]);
      expect(known!.table.dataTypeNames.sort()).toEqual(
        ["Email address", "Phone number"].sort(),
      );
    });

    test("the most sensitive kinds first, three at most, each once", () => {
      const known: ReturnType<
        typeof ProductionReviewSensitiveData.readTableKnown
      > = ProductionReviewSensitiveData.readTableKnown(
        ssnColumn({ dataTypes: [] }),
        knowledge({
          findings: [
            columnFinding({
              dataTypeName: "Email address",
              sensitivity: DataSensitivity.Confidential,
              location: "public.customers.email",
            }),
            columnFinding({
              dataTypeName: "Email address",
              sensitivity: DataSensitivity.Confidential,
              location: "public.customers.backup_email",
            }),
            columnFinding({ location: "public.customers.ssn" }),
            columnFinding({
              dataTypeName: "City",
              sensitivity: DataSensitivity.Internal,
              location: "public.customers.city",
            }),
            columnFinding({
              dataTypeName: "Phone number",
              sensitivity: DataSensitivity.Confidential,
              location: "public.customers.phone",
            }),
          ],
        }),
      );

      expect(known!.table.dataTypeNames).toHaveLength(3);
      expect(known!.table.dataTypeNames[0]).toBe("US Social Security number");
      expect(known!.table.dataTypeNames).not.toContain("City");
    });

    test.each([
      [DataStoreExposure.Public, DataStoreExposure.Public],
      [DataStoreExposure.OtherAccounts, DataStoreExposure.OtherAccounts],
      [
        DataStoreExposure.InternetReachable,
        DataStoreExposure.InternetReachable,
      ],
      [DataStoreExposure.Private, undefined],
      [DataStoreExposure.Unknown, undefined],
    ])(
      "a store %s: the column inherits %s",
      (
        exposure: DataStoreExposure,
        inherited: DataStoreExposure | undefined,
      ) => {
        expect(
          ProductionReviewSensitiveData.readTableKnown(
            ssnColumn(),
            knowledge({ stores: [dbStore({ exposure })] }),
          )!.store.exposure,
        ).toBe(inherited);
      },
    );

    test("a store not encrypted at rest says so; one encrypted, or not read, says nothing", () => {
      for (const [encryptedAtRest, said] of [
        [false, true],
        [true, undefined],
        [null, undefined],
      ] as Array<[boolean | null, boolean | undefined]>) {
        expect(
          ProductionReviewSensitiveData.readTableKnown(
            ssnColumn(),
            knowledge({
              stores: [
                dbStore({
                  posture: {
                    readAt: "2026-11-20T00:00:00.000Z",
                    encryptedAtRest,
                  },
                }),
              ],
            }),
          )!.store.isNotEncryptedAtRest,
        ).toBe(said);
      }
    });

    test("a table only Data Observability watches, with no finding in it: its store, its schema", () => {
      const known: ReturnType<
        typeof ProductionReviewSensitiveData.readTableKnown
      > = ProductionReviewSensitiveData.readTableKnown(
        ssnColumn(),
        knowledge({
          findings: [],
          assets: [
            {
              dataStoreId: ORDERS_DB_ID,
              name: "customers",
              schemaName: "billing",
              isUsedByRepository: false,
            },
          ],
        }),
      );

      expect(known!.store.name).toBe("orders-db");
      expect(known!.table).toEqual({
        name: "billing.customers",
        dataTypeNames: [],
        sameData: [],
        otherStoreCount: 0,
      });
    });

    test("of several stores holding the table: the one the repository's services use first", () => {
      const known: ReturnType<
        typeof ProductionReviewSensitiveData.readTableKnown
      > = ProductionReviewSensitiveData.readTableKnown(
        ssnColumn(),
        knowledge({
          stores: [
            dbStore(),
            dbStore({
              id: new ObjectID(STAGING_DB_ID),
              name: "orders-db-staging",
              environment: DataStoreEnvironment.Staging,
            }),
          ],
          findings: [columnFinding()],
          assets: [
            {
              dataStoreId: STAGING_DB_ID,
              name: "customers",
              schemaName: "public",
              isUsedByRepository: true,
            },
          ],
        }),
      );

      expect(known!.store.name).toBe("orders-db-staging");
      expect(known!.table.otherStoreCount).toBe(1);
      // Its own findings only: the other store's column is not this table's.
      expect(known!.table.sameData).toEqual([]);
    });

    test("then production's, then the one whose columns were found holding data", () => {
      const staging: DataStore = dbStore({
        id: new ObjectID(STAGING_DB_ID),
        name: "orders-db-staging",
        environment: DataStoreEnvironment.Staging,
      });

      expect(
        ProductionReviewSensitiveData.readTableKnown(
          ssnColumn(),
          knowledge({
            stores: [staging, dbStore()],
            findings: [
              columnFinding({ dataStoreId: new ObjectID(STAGING_DB_ID) }),
              columnFinding(),
            ],
          }),
        )!.store.name,
      ).toBe("orders-db");

      expect(
        ProductionReviewSensitiveData.readTableKnown(
          ssnColumn(),
          knowledge({
            stores: [
              staging,
              dbStore({ environment: DataStoreEnvironment.Unknown }),
            ],
            findings: [
              columnFinding({ dataStoreId: new ObjectID(STAGING_DB_ID) }),
            ],
            assets: [
              {
                dataStoreId: ORDERS_DB_ID,
                name: "customers",
                schemaName: "public",
                isUsedByRepository: false,
              },
            ],
          }),
        )!.store.name,
      ).toBe("orders-db-staging");
    });

    test("nothing known: no table named, another table's columns, no store holding it, not a migration", () => {
      expect(
        ProductionReviewSensitiveData.readTableKnown(
          ssnColumn({ where: undefined }),
          knowledge(),
        ),
      ).toBeNull();
      expect(
        ProductionReviewSensitiveData.readTableKnown(
          ssnColumn({ where: "orders" }),
          knowledge(),
        ),
      ).toBeNull();
      expect(
        ProductionReviewSensitiveData.readTableKnown(
          ssnColumn(),
          knowledge({ stores: [] }),
        ),
      ).toBeNull();
      expect(
        ProductionReviewSensitiveData.readTableKnown(
          ssnColumn({ kind: SensitiveDataLeakKind.Telemetry }),
          knowledge(),
        ),
      ).toBeNull();
    });

    test("on the point: production knows the store and the table - its severity and failing are the column's own", () => {
      const point: ProductionReviewLeakJSON =
        ProductionReviewSensitiveData.toPoint({
          candidate: ssnColumn(),
          stores: [],
          telemetry: NO_TELEMETRY,
          tables: knowledge({
            stores: [dbStore({ sensitivity: DataSensitivity.Public })],
          }),
          isFailOn: true,
          occurrences: new Map<string, number>(),
        })!;
      const without: ProductionReviewLeakJSON =
        ProductionReviewSensitiveData.toPoint({
          candidate: ssnColumn(),
          stores: [],
          telemetry: NO_TELEMETRY,
          isFailOn: true,
          occurrences: new Map<string, number>(),
        })!;

      expect(point.production!.store!.name).toBe("orders-db");
      expect(point.production!.table!.name).toBe("public.customers");
      expect({
        severity: point.severity,
        isBlocking: point.isBlocking,
        failsCheck: point.failsCheck,
        sensitivity: point.sensitivity,
        key: point.key,
      }).toEqual({
        severity: without.severity,
        isBlocking: without.isBlocking,
        failsCheck: without.failsCheck,
        sensitivity: without.sensitivity,
        key: without.key,
      });
      expect(without.production).toBeUndefined();
    });

    test("a reader who may not read Data Security reads the point without any of it, and the same severity", () => {
      const point: ProductionReviewLeakJSON =
        ProductionReviewSensitiveData.toPoint({
          candidate: ssnColumn(),
          stores: [],
          telemetry: NO_TELEMETRY,
          tables: knowledge({
            stores: [dbStore({ sensitivity: DataSensitivity.Public })],
          }),
          isFailOn: true,
          occurrences: new Map<string, number>(),
        })!;
      const section: ProductionReviewSensitiveDataJSON =
        ProductionReviewSensitiveDataUtil.withoutProduction({
          points: [point],
          moreCount: 0,
          droppedCount: 0,
          isFailOn: true,
          isAiRead: false,
        });

      expect(section.points[0]!.production).toBeUndefined();
      expect(section.points[0]!.severity).toBe(point.severity);
      expect(JSON.stringify(section)).not.toContain("orders-db");
      expect(JSON.stringify(section)).not.toContain("ssn_last4");
    });
  });

  describe("read for a private repository alone", () => {
    const PROJECT_ID: ObjectID = new ObjectID(
      "a1b2c3d4-1111-4222-8333-444455556666",
    );
    let findingReads: jest.SpyInstance;
    let assetReads: jest.SpyInstance;
    let usageReads: jest.SpyInstance;
    let storeReads: jest.SpyInstance;

    const MIGRATION: Array<CodeHostChangedFile> = [
      {
        filename: "db/migrations/20261124_add_customer_ssn.sql",
        status: "added",
        additions: 1,
        deletions: 0,
        patch:
          "@@ -0,0 +1,1 @@\n+ALTER TABLE customers ADD COLUMN customer_ssn VARCHAR(11);",
      },
    ];

    beforeEach(() => {
      jest
        .spyOn(DataSecurityCustomDataTypeService, "findBy")
        .mockResolvedValue([]);
      findingReads = jest
        .spyOn(DataStoreFindingService, "findBy")
        .mockResolvedValue([
          columnFinding(),
          // Another table's, which the read's text search also finds.
          columnFinding({ location: "public.customers_audit.ssn" }),
          // Found by no value and marked by no person: not counted.
          columnFinding({
            location: "public.customers.tax_id",
            matchCount: 0,
            isConfirmed: false,
          }),
        ]);
      assetReads = jest.spyOn(DataAssetService, "findBy").mockResolvedValue([]);
      usageReads = jest
        .spyOn(DataAssetUsageService, "findBy")
        .mockResolvedValue([]);
      storeReads = jest
        .spyOn(DataStoreService, "findBy")
        .mockResolvedValue([dbStore()]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function section(data: {
      isRepositoryPrivate?: (() => Promise<boolean>) | undefined;
      files?: Array<CodeHostChangedFile>;
    }): Promise<ProductionReviewSensitiveDataJSON> {
      return await ProductionReviewSensitiveData.find({
        projectId: PROJECT_ID,
        files: data.files || MIGRATION,
        services: [],
        isFailOn: false,
        now: new Date("2026-11-24T10:00:00.000Z"),
        isRepositoryPrivate: data.isRepositoryPrivate,
      });
    }

    test("a private repository's migration point knows its table", async () => {
      const read: ProductionReviewSensitiveDataJSON = await section({
        isRepositoryPrivate: async (): Promise<boolean> => {
          return true;
        },
      });

      expect(read.points).toHaveLength(1);
      expect(read.points[0]!.production).toEqual({
        store: expect.objectContaining({ name: "orders-db" }),
        table: {
          name: "public.customers",
          dataTypeNames: ["US Social Security number"],
          sameData: [
            {
              location: "public.customers.ssn_last4",
              dataTypeName: "US Social Security number",
              lastSeenAt: "2026-11-22T10:00:00.000Z",
            },
          ],
          otherStoreCount: 0,
        },
      });
      // Its columns' findings, read by the table's name in any schema.
      expect(findingReads.mock.calls[0]![0]).toMatchObject({
        query: { projectId: PROJECT_ID, locationKind: "Column" },
      });
      expect(storeReads).toHaveBeenCalledTimes(1);
    });

    test("a public repository's says only what the diff shows: Data Security is not even asked", async () => {
      const read: ProductionReviewSensitiveDataJSON = await section({
        isRepositoryPrivate: async (): Promise<boolean> => {
          return false;
        },
      });

      expect(read.points).toHaveLength(1);
      expect(read.points[0]!.production).toBeUndefined();
      expect(findingReads).not.toHaveBeenCalled();
      expect(assetReads).not.toHaveBeenCalled();
      expect(storeReads).not.toHaveBeenCalled();
    });

    test("a repository whose visibility no one asked is not private", async () => {
      const read: ProductionReviewSensitiveDataJSON = await section({});

      expect(read.points[0]!.production).toBeUndefined();
      expect(findingReads).not.toHaveBeenCalled();
    });

    test("visibility is asked only for a migration that names its table", async () => {
      const asked: jest.Mock = jest.fn(async (): Promise<boolean> => {
        return true;
      });

      await section({
        isRepositoryPrivate: asked as unknown as () => Promise<boolean>,
        files: [
          {
            filename: "src/signup.ts",
            status: "added",
            additions: 1,
            deletions: 0,
            patch: '@@ -0,0 +1,1 @@\n+logger.info("signup", { email });',
          },
        ],
      });

      expect(asked).not.toHaveBeenCalled();
    });

    test("the stores the repository's services use are asked of the tables Data Observability watches", async () => {
      assetReads.mockResolvedValue([
        Object.assign(new DataAsset(), {
          id: new ObjectID(CUSTOMERS_ASSET_ID),
          name: "customers",
          schemaName: "public",
          dataStoreId: new ObjectID(ORDERS_DB_ID),
        }),
      ]);
      usageReads.mockResolvedValue([
        Object.assign(new DataAssetUsage(), {
          dataAssetId: new ObjectID(CUSTOMERS_ASSET_ID),
        }),
      ]);

      const read: ProductionReviewSensitiveDataJSON =
        await ProductionReviewSensitiveData.find({
          projectId: PROJECT_ID,
          files: MIGRATION,
          services: [
            {
              id: "8b5b7f2e-2c3d-4c6a-9e1f-5a6b7c8d9e01",
              name: "checkout-api",
              method: "stack-trace",
              evidence: "",
              pathInRepository: null,
            },
          ],
          isFailOn: false,
          now: new Date("2026-11-24T10:00:00.000Z"),
          isRepositoryPrivate: async (): Promise<boolean> => {
            return true;
          },
        });

      expect(usageReads).toHaveBeenCalledTimes(1);
      expect(read.points[0]!.production!.store!.name).toBe("orders-db");
    });

    test("an archived store is no store the table is in", async () => {
      storeReads.mockResolvedValue([dbStore({ isArchived: true })]);

      const read: ProductionReviewSensitiveDataJSON = await section({
        isRepositoryPrivate: async (): Promise<boolean> => {
          return true;
        },
      });

      expect(read.points[0]!.production).toBeUndefined();
    });

    test("what cannot be read leaves the point as the diff says it, never failing the section", async () => {
      findingReads.mockRejectedValue(new Error("Postgres is away"));

      const read: ProductionReviewSensitiveDataJSON = await section({
        isRepositoryPrivate: async (): Promise<boolean> => {
          return true;
        },
      });

      expect(read.points).toHaveLength(1);
      expect(read.points[0]!.production).toBeUndefined();
    });
  });
});
