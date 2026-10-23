import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import GoogleCloudMarketplaceAPI from "../../../../Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAPI";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { MarketplaceHttpRequest } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import AwsContainerMeteringAPI from "../../../../Server/Marketplace/Reporters/AwsContainerMeteringAPI";
import AwsWorkloadCredentialsProvider from "../../../../Server/Marketplace/Reporters/AwsWorkloadCredentials";
import AzureKubernetesAppMeteringAPI from "../../../../Server/Marketplace/Reporters/AzureKubernetesAppMeteringAPI";
import {
  AwsSelfHostedReporter,
  AzureSelfHostedReporter,
  GoogleCloudSelfHostedReporter,
  SelfHostedUsageOutcome,
  SelfHostedUsageReport,
} from "../../../../Server/Marketplace/Reporters/SelfHostedMarketplaceReporter";
import {
  FakeAnswer,
  FakeHttpClient,
  TestSigningKey,
  createFakeHttpClient,
  createSigningKey,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * Each marketplace's answer to an hourly user report, turned into the few
 * outcomes the Enterprise Edition's usage job acts on: accepted (billed, and
 * the buyer is subscribed), not-entitled, too-old, conflict, setup, retry.
 */

const NOW: Date = new Date("2026-10-17T10:05:00.000Z");

const REPORT: SelfHostedUsageReport = {
  hourStart: new Date("2026-10-17T09:00:00.000Z"),
  quantity: 42,
  idempotencyKey: "ou-0f6c0e1c-494769",
};

const awsReporter: (http: FakeHttpClient) => AwsSelfHostedReporter = (
  http: FakeHttpClient,
): AwsSelfHostedReporter => {
  return new AwsSelfHostedReporter({
    api: new AwsContainerMeteringAPI({
      credentials: new AwsWorkloadCredentialsProvider({
        env: {
          AWS_ACCESS_KEY_ID: "ASIAEXAMPLESESSION",
          AWS_SECRET_ACCESS_KEY: "secret",
          AWS_SESSION_TOKEN: "session",
        },
      }),
      region: "us-west-2",
      httpClient: http.client,
      now: (): Date => {
        return NOW;
      },
    }),
    productCode: "6w0yyl6ppdh2o9sbu4i1zuqvk",
  });
};

const awsError: (type: string) => FakeAnswer = (type: string): FakeAnswer => {
  return {
    status: type === "InternalServiceErrorException" ? 500 : 400,
    body: { __type: `com.amazonaws#${type}`, message: `about ${type}` },
  };
};

describe("AwsSelfHostedReporter", () => {
  it("bills the hour as the users dimension, with the report's own client token", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: { MeteringRecordId: "record-9" } },
    ]);
    const reporter: AwsSelfHostedReporter = awsReporter(http);

    expect(reporter.marketplace).toBe(CloudMarketplace.AWS);
    expect(reporter.acceptsZeroQuantity).toBe(true);
    // AWS takes six hours; the reporter keeps an hour in hand.
    expect(reporter.maxReportAgeInMs).toBe(5 * 60 * 60 * 1000);

    await expect(reporter.report(REPORT)).resolves.toEqual({
      kind: "accepted",
      reportId: "record-9",
    });

    expect(JSON.parse(http.requests[0]!.body!)).toEqual({
      ProductCode: "6w0yyl6ppdh2o9sbu4i1zuqvk",
      Timestamp: Math.floor(REPORT.hourStart.getTime() / 1000),
      UsageDimension: "users",
      UsageQuantity: 42,
      ClientToken: "ou-0f6c0e1c-494769",
    });
  });

  it("maps each AWS answer to an outcome", async () => {
    const cases: Array<[string, SelfHostedUsageOutcome["kind"]]> = [
      ["CustomerNotEntitledException", "not-entitled"],
      ["TimestampOutOfBoundsException", "too-old"],
      ["DuplicateRequestException", "conflict"],
      ["IdempotencyConflictException", "conflict"],
      ["InvalidEndpointRegionException", "setup"],
      ["InvalidProductCodeException", "setup"],
      ["InvalidUsageDimensionException", "setup"],
      ["AccessDeniedException", "setup"],
      ["ThrottlingException", "retry"],
      ["InternalServiceErrorException", "retry"],
      ["SomethingNewException", "setup"],
    ];

    for (const [type, kind] of cases) {
      const outcome: SelfHostedUsageOutcome = await awsReporter(
        createFakeHttpClient([awsError(type)]),
      ).report(REPORT);

      expect({ type, kind: outcome.kind }).toEqual({ type, kind });
      expect(outcome.kind === "accepted" ? "" : outcome.detail).toContain(type);
    }
  });

  it("retries when AWS cannot be reached", async () => {
    const outcome: SelfHostedUsageOutcome = await awsReporter(
      createFakeHttpClient([new Error("connect ECONNREFUSED")]),
    ).report(REPORT);

    expect(outcome.kind).toBe("retry");
  });

  it("treats an error that is not from the API as worth retrying", () => {
    expect(AwsSelfHostedReporter.toOutcome(new Error("boom")).kind).toBe(
      "retry",
    );
    expect(
      AwsSelfHostedReporter.toOutcome(
        new MarketplaceApiError({
          message: "Refusing to send",
          status: null,
          isRetryable: false,
        }),
      ).kind,
    ).toBe("setup");
  });
});

const RESOURCE_URI: string =
  "/subscriptions/00000000-1111-2222-3333-444444444444/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/aks/providers/Microsoft.KubernetesConfiguration/extensions/oneuptime";

const azureReporter: (http: FakeHttpClient) => AzureSelfHostedReporter = (
  http: FakeHttpClient,
): AzureSelfHostedReporter => {
  return new AzureSelfHostedReporter({
    api: new AzureKubernetesAppMeteringAPI({
      clientId: "6f1d1e8c-1111-4a2b-9c3d-123456789abc",
      httpClient: http.client,
      now: (): Date => {
        return NOW;
      },
    }),
    resourceUri: RESOURCE_URI,
    planId: "enterprise",
  });
};

const azureToken: FakeAnswer = {
  status: 200,
  body: {
    access_token: "token",
    expires_on: String(Math.floor(NOW.getTime() / 1000) + 3600),
  },
};

const azureResult: (result: Record<string, unknown>) => FakeAnswer = (
  result: Record<string, unknown>,
): FakeAnswer => {
  return { status: 200, body: { count: 1, result: [result] } };
};

describe("AzureSelfHostedReporter", () => {
  it("bills the hour as the users meter of the purchased plan", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      azureToken,
      azureResult({ status: "Accepted", usageEventId: "event-7" }),
    ]);
    const reporter: AzureSelfHostedReporter = azureReporter(http);

    expect(reporter.marketplace).toBe(CloudMarketplace.Azure);
    // Microsoft refuses a quantity of 0.
    expect(reporter.acceptsZeroQuantity).toBe(false);
    expect(reporter.maxReportAgeInMs).toBe(23 * 60 * 60 * 1000);

    await expect(reporter.report(REPORT)).resolves.toEqual({
      kind: "accepted",
      reportId: "event-7",
    });

    expect(JSON.parse(http.requests[1]!.body!)).toEqual({
      request: [
        {
          resourceUri: RESOURCE_URI,
          planId: "enterprise",
          dimension: "users",
          quantity: 42,
          effectiveStartTime: "2026-10-17T09:00:00.000Z",
        },
      ],
    });
  });

  it("takes a duplicate of the same quantity as this report landing earlier", () => {
    expect(
      AzureSelfHostedReporter.toOutcome(
        {
          status: "Duplicate",
          usageEventId: "kept",
          keptQuantity: 42,
          message: "This usage event already exist.",
        },
        42,
      ),
    ).toEqual({ kind: "accepted", reportId: "kept" });
  });

  it("takes a duplicate of another quantity as a conflict, naming both", () => {
    const outcome: SelfHostedUsageOutcome = AzureSelfHostedReporter.toOutcome(
      {
        status: "Duplicate",
        usageEventId: "kept",
        keptQuantity: 40,
        message: "This usage event already exist.",
      },
      42,
    );

    expect(outcome.kind).toBe("conflict");
    expect(outcome.kind === "conflict" ? outcome.detail : "").toContain(
      "Microsoft kept 40",
    );
  });

  it("maps each Microsoft status to an outcome", () => {
    const cases: Array<[string, SelfHostedUsageOutcome["kind"]]> = [
      ["Expired", "too-old"],
      ["ResourceNotActive", "not-entitled"],
      ["ResourceNotFound", "not-entitled"],
      ["ResourceNotAuthorized", "setup"],
      ["InvalidDimension", "setup"],
      ["InvalidQuantity", "setup"],
      ["BadArgument", "setup"],
      ["Error", "retry"],
      ["SomethingNew", "retry"],
    ];

    for (const [status, kind] of cases) {
      expect({
        status,
        kind: AzureSelfHostedReporter.toOutcome(
          { status, usageEventId: null, keptQuantity: null, message: "" },
          42,
        ).kind,
      }).toEqual({ status, kind });
    }
  });

  it("retries an outage and reports a refused identity as setup", async () => {
    expect(
      (
        await azureReporter(
          createFakeHttpClient([azureToken, { status: 503, body: "down" }]),
        ).report(REPORT)
      ).kind,
    ).toBe("retry");

    expect(
      (
        await azureReporter(
          createFakeHttpClient([
            { status: 400, body: { error: "invalid_request" } },
          ]),
        ).report(REPORT)
      ).kind,
    ).toBe("setup");
  });
});

const googleKey: TestSigningKey = createSigningKey("reporting-key");

const googleReporter: (
  http: FakeHttpClient,
) => GoogleCloudSelfHostedReporter = (
  http: FakeHttpClient,
): GoogleCloudSelfHostedReporter => {
  return new GoogleCloudSelfHostedReporter({
    api: new GoogleCloudMarketplaceAPI({
      providerId: "",
      serviceAccountKey: {
        clientEmail: "reporter@cloud-marketplace-tools.iam.gserviceaccount.com",
        privateKey: googleKey.privateKeyPem,
        tokenUri: "https://oauth2.googleapis.com/token",
      },
      serviceName:
        "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog",
      httpClient: http.client,
      now: (): number => {
        return NOW.getTime();
      },
    }),
    consumerId: "project:buyer-project-1234",
    metricName:
      "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog/users",
  });
};

const googleToken: FakeAnswer = {
  status: 200,
  body: { access_token: "google-token", expires_in: 3600 },
};

describe("GoogleCloudSelfHostedReporter", () => {
  it("checks, then reports the hour as the users metric, under the report's own operation ID", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      googleToken,
      { status: 200, body: { operationId: REPORT.idempotencyKey } },
      { status: 200, body: {} },
    ]);
    const reporter: GoogleCloudSelfHostedReporter = googleReporter(http);

    expect(reporter.marketplace).toBe(CloudMarketplace.GoogleCloud);

    await expect(reporter.report(REPORT)).resolves.toEqual({
      kind: "accepted",
      reportId: REPORT.idempotencyKey,
    });

    const check: MarketplaceHttpRequest = http.requests[1]!;
    const report: MarketplaceHttpRequest = http.requests[2]!;

    expect(check.url).toBe(
      "https://servicecontrol.googleapis.com/v1/services/oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog:check",
    );
    expect(report.url).toBe(
      "https://servicecontrol.googleapis.com/v1/services/oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog:report",
    );

    const operation: Record<string, unknown> = (
      JSON.parse(report.body!) as { operations: Array<Record<string, unknown>> }
    ).operations[0]!;

    expect(operation).toEqual({
      operationId: REPORT.idempotencyKey,
      operationName: "OneUptime Enterprise usage",
      consumerId: "project:buyer-project-1234",
      startTime: "2026-10-17T09:00:00.000Z",
      endTime: "2026-10-17T10:00:00.000Z",
      metricValueSets: [
        {
          metricName:
            "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog/users",
          metricValues: [{ int64Value: "42" }],
        },
      ],
    });
    // The check carries the very same operation.
    expect(
      (JSON.parse(check.body!) as { operation: Record<string, unknown> })
        .operation,
    ).toEqual(operation);
  });

  it("does not report when the check says the buyer can no longer be billed", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      googleToken,
      {
        status: 200,
        body: {
          checkErrors: [
            { code: "SERVICE_NOT_ACTIVATED", detail: "Plan cancelled" },
          ],
        },
      },
    ]);

    const outcome: SelfHostedUsageOutcome =
      await googleReporter(http).report(REPORT);

    expect(outcome).toEqual({
      kind: "not-entitled",
      detail: "SERVICE_NOT_ACTIVATED: Plan cancelled",
    });
    // No report after a refused check.
    expect(http.requests).toHaveLength(2);
  });

  it("reads other check errors as setup problems", () => {
    expect(
      GoogleCloudSelfHostedReporter.checkErrorsToOutcome([
        { code: "PERMISSION_DENIED", detail: "no" },
      ]).kind,
    ).toBe("setup");

    for (const code of [
      "SERVICE_NOT_ACTIVATED",
      "BILLING_DISABLED",
      "PROJECT_DELETED",
      "PROJECT_INVALID",
      "CONSUMER_INVALID",
    ]) {
      expect(
        GoogleCloudSelfHostedReporter.checkErrorsToOutcome([
          { code, detail: "" },
        ]).kind,
      ).toBe("not-entitled");
    }
  });

  it("retries report errors Service Control may get past, and not the others", () => {
    expect(
      GoogleCloudSelfHostedReporter.reportErrorsToOutcome([
        { code: "14", detail: "unavailable" },
        { code: "RESOURCE_EXHAUSTED", detail: "quota" },
      ]).kind,
    ).toBe("retry");
    expect(
      GoogleCloudSelfHostedReporter.reportErrorsToOutcome([
        { code: "3", detail: "invalid argument" },
      ]).kind,
    ).toBe("setup");
    expect(
      GoogleCloudSelfHostedReporter.reportErrorsToOutcome([
        { code: "14", detail: "unavailable" },
        { code: "7", detail: "permission denied" },
      ]).kind,
    ).toBe("setup");
  });

  it("retries when Google cannot be reached, and treats a refused key as setup", async () => {
    expect(
      (
        await googleReporter(
          createFakeHttpClient([googleToken, new Error("ETIMEDOUT")]),
        ).report(REPORT)
      ).kind,
    ).toBe("retry");

    expect(
      (
        await googleReporter(
          createFakeHttpClient([
            { status: 400, body: { error: "invalid_grant" } },
          ]),
        ).report(REPORT)
      ).kind,
    ).toBe("setup");
  });
});
