import {
  ProductionReviewReport,
  ProductionReviewUtil,
} from "../../../Types/CodeRepository/ProductionReview";
import {
  ProductionReviewCaughtLeak,
  ProductionReviewLeakJSON,
  ProductionReviewSensitiveDataJSON,
  ProductionReviewSensitiveDataUtil,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataLeakKind,
} from "../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import { emptyReport } from "../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * A REVIEW'S SENSITIVE DATA, AS IT IS KEPT AND READ (#10376): whether it
 * fails the check, what a reader who may not read Data Security sees of
 * it, and the leaks a pull request's review remembers - each once, fixed
 * when a later review no longer finds it - for AI Results.
 */

function point(
  change: Partial<ProductionReviewLeakJSON> = {},
): ProductionReviewLeakJSON {
  return {
    key: "k1",
    kind: SensitiveDataLeakKind.Infrastructure,
    checkId: "public-read",
    path: "infra/s3.tf",
    line: 3,
    subject: "acl",
    dataTypeIds: [],
    dataTypeNames: [],
    sensitivity: DataSensitivity.Confidential,
    severity: SecuritySeverity.Critical,
    isBlocking: true,
    failsCheck: true,
    text: "Sets `acl` to `public-read`.",
    fix: "Set it to `private`.",
    isAiWorded: false,
    production: {
      store: {
        dataStoreId: "5d1c2b3a-0000-4000-8000-0000000000b1",
        name: "acme-card-exports",
        sensitivity: DataSensitivity.Restricted,
        dataTypeNames: ["Card number"],
      },
    },
    ...change,
  };
}

function section(
  points: Array<ProductionReviewLeakJSON>,
): ProductionReviewSensitiveDataJSON {
  return {
    points,
    moreCount: 0,
    droppedCount: 0,
    isFailOn: true,
    isAiRead: true,
  };
}

describe("whether the check fails", () => {
  test("on a point that fails it, and only then", () => {
    expect(
      ProductionReviewSensitiveDataUtil.failsCheck(section([point()])),
    ).toBe(true);
    expect(
      ProductionReviewSensitiveDataUtil.failsCheck(
        section([point({ failsCheck: false })]),
      ),
    ).toBe(false);
    expect(ProductionReviewSensitiveDataUtil.failsCheck(undefined)).toBe(false);
    expect(
      ProductionReviewSensitiveDataUtil.getPoints({
        points: "not a list",
      } as unknown as ProductionReviewSensitiveDataJSON),
    ).toEqual([]);
  });
});

describe("a reader who may not read Data Security", () => {
  test("reads every point without what production knows - its severity the diff's own", () => {
    // Unencrypted, on a store of Restricted data: High; of Confidential data, as the diff says: Medium.
    const report: ProductionReviewReport = emptyReport({
      sensitiveData: section([
        point({
          checkId: "not-encrypted-at-rest",
          severity: SecuritySeverity.High,
          text: "Sets `storage_encrypted` to `false`.",
        }),
      ]),
    });
    const kept: ProductionReviewReport =
      ProductionReviewUtil.keepReadableSensitiveData(report, false);
    const keptPoint: ProductionReviewLeakJSON = kept.sensitiveData!.points[0]!;

    expect(keptPoint.production).toBeUndefined();
    expect(keptPoint.severity).toBe(SecuritySeverity.Medium);
    expect(keptPoint.sensitivity).toBe(DataSensitivity.Confidential);
    expect(JSON.stringify(kept)).not.toContain("acme-card-exports");
    // The rest of the point stays as it was.
    expect(keptPoint.failsCheck).toBe(true);
    expect(keptPoint.text).toBe("Sets `storage_encrypted` to `false`.");
  });

  test("a point of telemetry keeps its severity: no store gave it one", () => {
    const telemetry: ProductionReviewLeakJSON = point({
      kind: SensitiveDataLeakKind.Telemetry,
      checkId: "sensitive-data-in-telemetry",
      severity: SecuritySeverity.Medium,
      production: {
        heldBefore: [
          {
            serviceId: "s1",
            serviceName: "checkout-api",
            storeKind: "Logs",
            location: "attributes.email",
            dataTypeName: "Email address",
            lastSeenAt: "2026-10-21T10:00:00.000Z",
          },
        ],
      },
    });
    const kept: ProductionReviewSensitiveDataJSON =
      ProductionReviewSensitiveDataUtil.withoutProduction(section([telemetry]));

    expect(kept.points[0]!.production).toBeUndefined();
    expect(kept.points[0]!.severity).toBe(SecuritySeverity.Medium);
  });

  test("a reader of Data Security, or a review with nothing of production, reads it as it is", () => {
    const report: ProductionReviewReport = emptyReport({
      sensitiveData: section([point()]),
    });

    expect(ProductionReviewUtil.keepReadableSensitiveData(report, true)).toBe(
      report,
    );

    const plain: ProductionReviewReport = emptyReport({
      sensitiveData: section([point({ production: undefined })]),
    });

    expect(ProductionReviewUtil.keepReadableSensitiveData(plain, false)).toBe(
      plain,
    );
  });
});

describe("the leaks a pull request's review remembers", () => {
  const first: Date = new Date("2026-11-20T10:00:00.000Z");
  const second: Date = new Date("2026-11-21T10:00:00.000Z");
  const third: Date = new Date("2026-11-22T10:00:00.000Z");

  test("each posted point once, when it was first posted", () => {
    const caught: Array<ProductionReviewCaughtLeak> =
      ProductionReviewSensitiveDataUtil.mergeCaughtLeaks({
        previous: undefined,
        points: [
          point({ key: "a" }),
          point({ key: "b", failsCheck: false, isBlocking: false }),
        ],
        now: first,
      });

    expect(caught).toEqual([
      {
        key: "a",
        kind: SensitiveDataLeakKind.Infrastructure,
        checkId: "public-read",
        isBlocking: true,
        at: first.toISOString(),
      },
      {
        key: "b",
        kind: SensitiveDataLeakKind.Infrastructure,
        checkId: "public-read",
        isBlocking: false,
        at: first.toISOString(),
      },
    ]);

    // Posted again: still first posted then.
    expect(
      ProductionReviewSensitiveDataUtil.mergeCaughtLeaks({
        previous: caught,
        points: [point({ key: "a" }), point({ key: "b" })],
        now: second,
      }),
    ).toEqual(caught);
  });

  test("one a later review no longer finds is fixed then; one found again is open again", () => {
    const caught: Array<ProductionReviewCaughtLeak> =
      ProductionReviewSensitiveDataUtil.mergeCaughtLeaks({
        previous: undefined,
        points: [point({ key: "a" })],
        now: first,
      });
    const fixed: Array<ProductionReviewCaughtLeak> =
      ProductionReviewSensitiveDataUtil.mergeCaughtLeaks({
        previous: caught,
        points: [],
        now: second,
      });

    expect(fixed[0]).toMatchObject({
      key: "a",
      at: first.toISOString(),
      fixedAt: second.toISOString(),
    });

    // Still gone: fixed when it first went.
    expect(
      ProductionReviewSensitiveDataUtil.mergeCaughtLeaks({
        previous: fixed,
        points: [],
        now: third,
      })[0]!.fixedAt,
    ).toBe(second.toISOString());

    const reopened: ProductionReviewCaughtLeak =
      ProductionReviewSensitiveDataUtil.mergeCaughtLeaks({
        previous: fixed,
        points: [point({ key: "a" })],
        now: third,
      })[0]!;

    expect(reopened.fixedAt).toBeUndefined();
    expect(reopened.at).toBe(first.toISOString());
  });

  test("the newest are kept when a pull request caught more than the limit, and what is not one is dropped", () => {
    const many: Array<ProductionReviewLeakJSON> = [];

    for (
      let index: number = 0;
      index < SENSITIVE_DATA_LIMITS.maxCaughtLeaksPerPullRequest + 5;
      index++
    ) {
      many.push(point({ key: `k${index}` }));
    }

    const caught: Array<ProductionReviewCaughtLeak> =
      ProductionReviewSensitiveDataUtil.mergeCaughtLeaks({
        previous: [
          null as unknown as ProductionReviewCaughtLeak,
          { key: "" } as ProductionReviewCaughtLeak,
        ],
        points: many,
        now: first,
      });

    expect(caught).toHaveLength(
      SENSITIVE_DATA_LIMITS.maxCaughtLeaksPerPullRequest,
    );
    expect(caught[caught.length - 1]!.key).toBe(
      `k${SENSITIVE_DATA_LIMITS.maxCaughtLeaksPerPullRequest + 4}`,
    );
  });
});
