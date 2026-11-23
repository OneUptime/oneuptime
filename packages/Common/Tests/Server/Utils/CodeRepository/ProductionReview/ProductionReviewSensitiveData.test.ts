import ProductionReviewSensitiveData, {
  TelemetryKnowledge,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewSensitiveData";
import { SensitiveDataCandidate } from "../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import {
  ProductionReviewLeakJSON,
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import { describe, expect, test } from "@jest/globals";

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
