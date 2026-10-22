import {
  ProductionReviewOperationMatch,
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewTrigger,
  ProductionReviewWhere,
} from "../../../../../Types/CodeRepository/ProductionReview";

/*
 * A production review as a review of a real change reads: a TypeError
 * thrown at the line the change edits, the endpoint it serves, the function
 * that takes CPU time, an open incident, an incident whose root cause names
 * the file, and a deploy OneUptime suspects. Tests change what they test.
 */

export const REVIEWED_AT: string = "2026-10-22T10:00:00.000Z";
export const PROJECT_ID: string = "3ae4c1a8-7a8b-4c4e-9a52-1d2d5e0f6a11";
export const CHECKOUT_SERVICE_ID: string =
  "8b5b7f2e-2c3d-4c6a-9e1f-5a6b7c8d9e01";
export const EXCEPTION_ID: string = "5f0c9e1a-1111-4b2c-8d3e-4f5a6b7c8d9e";
export const OPEN_INCIDENT_ID: string = "6a1d0f2b-2222-4c3d-9e4f-5a6b7c8d9e0f";
export const NAMED_INCIDENT_ID: string = "7b2e1a3c-3333-4d4e-8f5a-6b7c8d9e0f1a";

export function emptyReport(
  change: Partial<ProductionReviewReport> = {},
): ProductionReviewReport {
  return {
    pullRequest: {
      number: 42,
      title: "fix: guard the card before charging",
      url: "https://github.com/acme/checkout/pull/42",
      authorLogin: "octo-dev",
      headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      baseRefName: "main",
      isFromFork: false,
    },
    reviewedAt: REVIEWED_AT,
    trigger: ProductionReviewTrigger.PullRequestChanged,
    changedFileCount: 3,
    codeFileCount: 2,
    services: [
      {
        id: CHECKOUT_SERVICE_ID,
        name: "checkout-api",
        requestCount: 12431,
        p99Ms: 840,
      },
    ],
    exceptions: [],
    operations: [],
    hotFunctions: [],
    incidents: { total: 0, open: 0, items: [] },
    suspectDeploys: [],
    points: [],
    unreadSections: [],
    posting: ProductionReviewPosting.Review,
    ...change,
  };
}

export function fullReport(
  change: Partial<ProductionReviewReport> = {},
): ProductionReviewReport {
  return emptyReport({
    exceptions: [
      {
        exceptionId: EXCEPTION_ID,
        type: "TypeError",
        serviceId: CHECKOUT_SERVICE_ID,
        serviceName: "checkout-api",
        path: "src/billing/charge.ts",
        line: 42,
        functionName: "chargeCard",
        where: ProductionReviewWhere.ChangedLine,
        occurrences: 1240,
        isWindowCount: true,
        firstSeenAt: "2026-10-20T10:00:00.000Z",
        lastSeenAt: "2026-10-22T08:00:00.000Z",
        isUnhandled: true,
        isNew: true,
      },
    ],
    operations: [
      {
        name: "GET /api/orders/:id",
        serviceId: CHECKOUT_SERVICE_ID,
        serviceName: "checkout-api",
        matchedBy: ProductionReviewOperationMatch.Route,
        requestCount: 3200,
        errorCount: 13,
        p95Ms: 840,
      },
    ],
    hotFunctions: [
      {
        functionName: "chargeCard",
        path: "src/billing/charge.ts",
        serviceId: CHECKOUT_SERVICE_ID,
        serviceName: "checkout-api",
        totalPercent: 12,
        selfPercent: 4,
        isChangedFunction: true,
        profileKind: "CPU time",
      },
    ],
    incidents: {
      total: 4,
      open: 1,
      items: [
        {
          incidentId: OPEN_INCIDENT_ID,
          label: "INC-45",
          severity: "Critical",
          state: "Investigating",
          isOpen: true,
          declaredAt: "2026-10-22T07:00:00.000Z",
        },
        {
          incidentId: NAMED_INCIDENT_ID,
          label: "INC-31",
          severity: "Major",
          state: "Resolved",
          isOpen: false,
          declaredAt: "2026-10-12T10:00:00.000Z",
          mentions: "src/billing/charge.ts",
        },
      ],
    },
    suspectDeploys: [
      {
        serviceId: CHECKOUT_SERVICE_ID,
        serviceName: "checkout-api",
        at: "2026-10-22T08:00:00.000Z",
        version: "v1.4.2",
        impact: "error rate rose from 0.2% to 2.1% after it.",
      },
    ],
    ...change,
  });
}
