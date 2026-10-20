import { describe, expect, test } from "@jest/globals";
import {
  DEPLOYMENT_ENVIRONMENT_ATTRIBUTE_KEYS,
  readDeploymentEnvironment,
} from "../../../Utils/Telemetry/DeploymentEnvironment";

/*
 * The environment an exception, a deploy marker or a service reports.
 * OpenTelemetry renamed deployment.environment to
 * deployment.environment.name, so a reader of either key alone loses the
 * SDKs that send the other one.
 */

describe("readDeploymentEnvironment", () => {
  test("reads the current key", () => {
    expect(
      readDeploymentEnvironment({ "deployment.environment.name": "prod" }),
    ).toBe("prod");
  });

  test("reads the old key when the current one is absent", () => {
    expect(
      readDeploymentEnvironment({ "deployment.environment": "staging" }),
    ).toBe("staging");
  });

  test("prefers the current key when both are sent", () => {
    expect(
      readDeploymentEnvironment({
        "deployment.environment": "old-name",
        "deployment.environment.name": "new-name",
      }),
    ).toBe("new-name");
  });

  test("falls back to the old key when the current one is blank", () => {
    expect(
      readDeploymentEnvironment({
        "deployment.environment.name": "   ",
        "deployment.environment": "prod",
      }),
    ).toBe("prod");
  });

  test("reads keys under a prefix, as the ingest paths flatten them", () => {
    const attributes: Record<string, unknown> = {
      "resource.deployment.environment.name": "eu-prod",
      // A span attribute of the same name is not the resource's.
      "deployment.environment.name": "span-level",
    };

    expect(readDeploymentEnvironment(attributes, { prefix: "resource." })).toBe(
      "eu-prod",
    );
    expect(readDeploymentEnvironment(attributes)).toBe("span-level");
  });

  test("the old key under the ingest prefix still counts", () => {
    expect(
      readDeploymentEnvironment(
        { "resource.deployment.environment": "prod" },
        { prefix: "resource." },
      ),
    ).toBe("prod");
  });

  test("trims what it returns", () => {
    expect(
      readDeploymentEnvironment({ "deployment.environment.name": "  prod  " }),
    ).toBe("prod");
  });

  test("is empty when nothing usable is there", () => {
    expect(readDeploymentEnvironment(undefined)).toBe("");
    expect(readDeploymentEnvironment(null)).toBe("");
    expect(readDeploymentEnvironment({})).toBe("");
    expect(
      readDeploymentEnvironment({
        "deployment.environment.name": 42,
        "deployment.environment": ["prod"],
      }),
    ).toBe("");
    expect(
      readDeploymentEnvironment(
        { "deployment.environment.name": "prod" },
        { prefix: "resource." },
      ),
    ).toBe("");
  });

  test("names the current key before the old one", () => {
    expect(DEPLOYMENT_ENVIRONMENT_ATTRIBUTE_KEYS).toEqual([
      "deployment.environment.name",
      "deployment.environment",
    ]);
  });
});
