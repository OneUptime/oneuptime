import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import SelfHostedMarketplaceConfig, {
  AWS_SELF_HOSTED_PRODUCT_CODES,
  SelfHostedMarketplaceConfigResult,
  SelfHostedMarketplaceEnvironment,
} from "../../../../Server/Marketplace/Reporters/SelfHostedMarketplaceConfig";
import {
  AwsSelfHostedReporter,
  AzureSelfHostedReporter,
  GoogleCloudSelfHostedReporter,
} from "../../../../Server/Marketplace/Reporters/SelfHostedMarketplaceReporter";
import { createSigningKey } from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * Which marketplace a self-hosted Enterprise installation bills, read from
 * the environment the marketplace editions of the chart set. A setting that
 * is missing is named, never guessed - and nothing here grants anything: the
 * marketplace still has to accept a report.
 */

const TRUSTED: ReadonlyArray<string> = ["6w0yyl6ppdh2o9sbu4i1zuqvk"];

const IRSA: SelfHostedMarketplaceEnvironment = {
  AWS_ROLE_ARN: "arn:aws:iam::111122223333:role/oneuptime",
  AWS_WEB_IDENTITY_TOKEN_FILE:
    "/var/run/secrets/eks.amazonaws.com/serviceaccount/token",
  AWS_REGION: "eu-west-1",
};

const AZURE: SelfHostedMarketplaceEnvironment = {
  ENTERPRISE_MARKETPLACE: "azure",
  ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID:
    "/subscriptions/0000/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/aks/providers/Microsoft.KubernetesConfiguration/extensions/oneuptime",
  ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID: "enterprise",
  ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID:
    "6f1d1e8c-1111-4a2b-9c3d-123456789abc",
};

const googleKeyJson: string = JSON.stringify({
  type: "service_account",
  client_email: "reporter@cloud-marketplace-tools.iam.gserviceaccount.com",
  private_key: createSigningKey("reporting").privateKeyPem,
  token_uri: "https://oauth2.googleapis.com/token",
});

const GOOGLE: SelfHostedMarketplaceEnvironment = {
  ENTERPRISE_MARKETPLACE: "google-cloud",
  ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_SERVICE_NAME:
    "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog",
  ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_CONSUMER_ID: "project:buyer-project-1234",
  ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_ENTITLEMENT_ID: "entitlement-5678",
  // Kubernetes hands the secret over decoded once: still base64 of the JSON key.
  ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_REPORTING_KEY:
    Buffer.from(googleKeyJson).toString("base64"),
};

const problemsOf: (result: SelfHostedMarketplaceConfigResult) => string = (
  result: SelfHostedMarketplaceConfigResult,
): string => {
  return result.kind === "incomplete" ? result.problems.join("\n") : "";
};

describe("SelfHostedMarketplaceConfig.read", () => {
  it("bills nothing when no marketplace is named", () => {
    expect(SelfHostedMarketplaceConfig.read({}, TRUSTED)).toEqual({
      kind: "none",
    });
    expect(
      SelfHostedMarketplaceConfig.read(
        { ENTERPRISE_MARKETPLACE: "  " },
        TRUSTED,
      ),
    ).toEqual({ kind: "none" });
  });

  it("names a marketplace it does not know", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        { ENTERPRISE_MARKETPLACE: "oracle" },
        TRUSTED,
      );

    expect(result.kind).toBe("incomplete");
    expect(problemsOf(result)).toContain('"oracle"');
  });

  it("accepts the marketplaces' names in any case", () => {
    expect(SelfHostedMarketplaceConfig.parseMarketplace("AWS")).toBe(
      CloudMarketplace.AWS,
    );
    expect(SelfHostedMarketplaceConfig.parseMarketplace("Azure")).toBe(
      CloudMarketplace.Azure,
    );
    expect(SelfHostedMarketplaceConfig.parseMarketplace("microsoft")).toBe(
      CloudMarketplace.Azure,
    );
    expect(SelfHostedMarketplaceConfig.parseMarketplace("Google-Cloud")).toBe(
      CloudMarketplace.GoogleCloud,
    );
    expect(SelfHostedMarketplaceConfig.parseMarketplace("gcp")).toBe(
      CloudMarketplace.GoogleCloud,
    );
    expect(SelfHostedMarketplaceConfig.parseMarketplace("")).toBeNull();
  });
});

describe("SelfHostedMarketplaceConfig on AWS", () => {
  it("bills the compiled product code in the pod's Region, with the IRSA role", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        { ENTERPRISE_MARKETPLACE: "aws", ...IRSA },
        TRUSTED,
      );

    expect(result).toEqual({
      kind: "configured",
      settings: {
        marketplace: CloudMarketplace.AWS,
        productCode: "6w0yyl6ppdh2o9sbu4i1zuqvk",
        region: "eu-west-1",
      },
    });
  });

  it("lets the environment pick only a product code this build trusts", () => {
    const trusted: ReadonlyArray<string> = ["code-a", "code-b"];

    const picked: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        {
          ENTERPRISE_MARKETPLACE: "aws",
          ENTERPRISE_MARKETPLACE_AWS_PRODUCT_CODE: "code-b",
          ...IRSA,
        },
        trusted,
      );
    expect(
      picked.kind === "configured" &&
        picked.settings.marketplace === CloudMarketplace.AWS
        ? picked.settings.productCode
        : null,
    ).toBe("code-b");

    const forged: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        {
          ENTERPRISE_MARKETPLACE: "aws",
          ENTERPRISE_MARKETPLACE_AWS_PRODUCT_CODE: "someone-elses-cheaper-code",
          ...IRSA,
        },
        trusted,
      );
    expect(forged.kind).toBe("incomplete");
    expect(problemsOf(forged)).toContain("someone-elses-cheaper-code");
  });

  it("cannot bill AWS from a build with no product code", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        { ENTERPRISE_MARKETPLACE: "aws", ...IRSA },
        [],
      );

    expect(result.kind).toBe("incomplete");
    expect(problemsOf(result)).toContain("no AWS Marketplace product code");
  });

  it("needs IAM roles for service accounts - not Pod Identity or keys", () => {
    for (const credentials of [
      {
        AWS_CONTAINER_CREDENTIALS_FULL_URI:
          "http://169.254.170.23/v1/credentials",
        AWS_REGION: "eu-west-1",
      },
      {
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_REGION: "eu-west-1",
      },
      { AWS_REGION: "eu-west-1" },
    ]) {
      const result: SelfHostedMarketplaceConfigResult =
        SelfHostedMarketplaceConfig.read(
          { ENTERPRISE_MARKETPLACE: "aws", ...credentials },
          TRUSTED,
        );

      expect(result.kind).toBe("incomplete");
      expect(problemsOf(result)).toContain("IAM roles for service accounts");
    }
  });

  it("needs the pod's Region, from EKS or the fallback setting", () => {
    const withoutRegion: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        {
          ENTERPRISE_MARKETPLACE: "aws",
          AWS_ROLE_ARN: IRSA["AWS_ROLE_ARN"],
          AWS_WEB_IDENTITY_TOKEN_FILE: IRSA["AWS_WEB_IDENTITY_TOKEN_FILE"],
        },
        TRUSTED,
      );
    expect(withoutRegion.kind).toBe("incomplete");
    expect(problemsOf(withoutRegion)).toContain("AWS_REGION");

    const withFallback: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        {
          ENTERPRISE_MARKETPLACE: "aws",
          AWS_ROLE_ARN: IRSA["AWS_ROLE_ARN"],
          AWS_WEB_IDENTITY_TOKEN_FILE: IRSA["AWS_WEB_IDENTITY_TOKEN_FILE"],
          ENTERPRISE_MARKETPLACE_AWS_REGION: "ap-southeast-2",
        },
        TRUSTED,
      );
    expect(
      withFallback.kind === "configured" &&
        withFallback.settings.marketplace === CloudMarketplace.AWS
        ? withFallback.settings.region
        : null,
    ).toBe("ap-southeast-2");
  });

  it("ships with the product code AWS issued for the container product", () => {
    expect(AWS_SELF_HOSTED_PRODUCT_CODES).toEqual([
      "c8qvytt92i74r7bhzi6nxunsi",
    ]);

    for (const code of AWS_SELF_HOSTED_PRODUCT_CODES) {
      expect(code).toMatch(/^[-a-zA-Z0-9/=:_.@]{1,255}$/);
    }
  });

  it("bills the compiled-in product when the installation names none", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read({
        ENTERPRISE_MARKETPLACE: "aws",
        ...IRSA,
      });

    expect(result.kind).toBe("configured");
    expect(
      result.kind === "configured" &&
        result.settings.marketplace === CloudMarketplace.AWS
        ? result.settings.productCode
        : null,
    ).toBe("c8qvytt92i74r7bhzi6nxunsi");
  });
});

describe("SelfHostedMarketplaceConfig on Microsoft Marketplace", () => {
  it("bills the extension's resource, plan and identity Azure filled in", () => {
    expect(SelfHostedMarketplaceConfig.read(AZURE, TRUSTED)).toEqual({
      kind: "configured",
      settings: {
        marketplace: CloudMarketplace.Azure,
        resourceId: AZURE["ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID"],
        planId: "enterprise",
        clientId: "6f1d1e8c-1111-4a2b-9c3d-123456789abc",
      },
    });
  });

  it("treats the chart's DONOTMODIFY placeholders as missing", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        {
          ENTERPRISE_MARKETPLACE: "azure",
          ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID: "DONOTMODIFY",
          ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID: "DONOTMODIFY",
          ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID: "donotmodify",
        },
        TRUSTED,
      );

    expect(result.kind).toBe("incomplete");
    expect(problemsOf(result)).toContain("global.azure.extension.resourceId");
    expect(problemsOf(result)).toContain("global.azure.marketplace.planId");
    expect(problemsOf(result)).toContain("global.azure.identity.clientId");
  });

  it("refuses a resource ID that is not an ARM ID", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        { ...AZURE, ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID: "oneuptime" },
        TRUSTED,
      );

    expect(result.kind).toBe("incomplete");
    expect(problemsOf(result)).toContain("ARM resource ID");
  });
});

describe("SelfHostedMarketplaceConfig on Google Cloud Marketplace", () => {
  it("bills the consumer in the reporting secret, with its reporting key", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(GOOGLE, TRUSTED);

    expect(result.kind).toBe("configured");

    if (
      result.kind !== "configured" ||
      result.settings.marketplace !== CloudMarketplace.GoogleCloud
    ) {
      return;
    }

    expect(result.settings.serviceName).toBe(
      "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog",
    );
    expect(result.settings.consumerId).toBe("project:buyer-project-1234");
    expect(result.settings.entitlementId).toBe("entitlement-5678");
    expect(result.settings.reportingKey.clientEmail).toBe(
      "reporter@cloud-marketplace-tools.iam.gserviceaccount.com",
    );
  });

  it("takes the reporting key as raw JSON too", () => {
    expect(
      SelfHostedMarketplaceConfig.read(
        {
          ...GOOGLE,
          ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_REPORTING_KEY: googleKeyJson,
        },
        TRUSTED,
      ).kind,
    ).toBe("configured");
  });

  it("names every missing piece of the reporting secret", () => {
    const result: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        { ENTERPRISE_MARKETPLACE: "google-cloud" },
        TRUSTED,
      );

    expect(result.kind).toBe("incomplete");
    expect(problemsOf(result)).toContain("SERVICE_NAME");
    expect(problemsOf(result)).toContain("consumer-id");
    expect(problemsOf(result)).toContain("reporting-key");
  });

  it("names the metric after the service", () => {
    expect(
      SelfHostedMarketplaceConfig.getGoogleCloudMetricName(
        "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog",
      ),
    ).toBe(
      "oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog/users",
    );
  });
});

describe("SelfHostedMarketplaceConfig.createReporter", () => {
  it("wires each marketplace's settings to its reporter", () => {
    const aws: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(
        { ENTERPRISE_MARKETPLACE: "aws", ...IRSA },
        TRUSTED,
      );
    const azure: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(AZURE, TRUSTED);
    const google: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read(GOOGLE, TRUSTED);

    if (
      aws.kind !== "configured" ||
      azure.kind !== "configured" ||
      google.kind !== "configured"
    ) {
      throw new Error("Expected every marketplace to be configured.");
    }

    expect(
      SelfHostedMarketplaceConfig.createReporter(aws.settings),
    ).toBeInstanceOf(AwsSelfHostedReporter);
    expect(
      SelfHostedMarketplaceConfig.createReporter(azure.settings),
    ).toBeInstanceOf(AzureSelfHostedReporter);
    expect(
      SelfHostedMarketplaceConfig.createReporter(google.settings),
    ).toBeInstanceOf(GoogleCloudSelfHostedReporter);
  });
});
