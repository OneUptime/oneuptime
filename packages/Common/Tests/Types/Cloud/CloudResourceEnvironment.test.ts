import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_NON_PRODUCTION_WORDS,
  CLOUD_PRODUCTION_WORDS,
  CLOUD_RESOURCE_ENVIRONMENT_LABELS,
  CloudEnvironmentSource,
  CloudResourceEnvironment,
  combineEnvironments,
  getCloudResourceEnvironment,
  isKnownNonProduction,
  readEnvironmentFromLabels,
  readEnvironmentFromTags,
  readEnvironmentWord,
} from "../../../Types/Cloud/CloudResourceEnvironment";

/*
 * Whether a cloud resource is production (#11010): an off-hours schedule
 * stops only what is known not to be, and no AI rule acts on production
 * without a person. Production wins on any sign; non-production needs a
 * sign of its own; anything else is not known, and read as production.
 */

describe("what one value says", () => {
  test.each([
    ["prod", CloudResourceEnvironment.Production],
    ["Production", CloudResourceEnvironment.Production],
    ["PRD", CloudResourceEnvironment.Production],
    ["live", CloudResourceEnvironment.Production],
    ["prod-eu-1", CloudResourceEnvironment.Production],
    ["eu production", CloudResourceEnvironment.Production],
    ["dev", CloudResourceEnvironment.NonProduction],
    ["Development", CloudResourceEnvironment.NonProduction],
    ["staging", CloudResourceEnvironment.NonProduction],
    ["QA", CloudResourceEnvironment.NonProduction],
    ["uat-2", CloudResourceEnvironment.NonProduction],
    ["non-prod", CloudResourceEnvironment.NonProduction],
    ["non_production", CloudResourceEnvironment.NonProduction],
    ["pre-prod", CloudResourceEnvironment.NonProduction],
    ["sandbox", CloudResourceEnvironment.NonProduction],
    ["", CloudResourceEnvironment.Unknown],
    ["blue", CloudResourceEnvironment.Unknown],
    ["productive", CloudResourceEnvironment.Unknown],
    ["devops", CloudResourceEnvironment.Unknown],
  ])("%s", (value: string, expected: CloudResourceEnvironment) => {
    expect(readEnvironmentWord(value)).toBe(expected);
  });

  test("a value with a production word and a non-production one is production", () => {
    expect(readEnvironmentWord("prod dev")).toBe(
      CloudResourceEnvironment.Production,
    );
  });
});

describe("what a resource's tags say", () => {
  test("reads the tag keys teams use, whatever their case and separators", () => {
    for (const key of [
      "Environment",
      "env",
      "ENV",
      "Stage",
      "deployment.environment",
      "deployment.environment.name",
      "deployment-environment",
      "app_environment",
    ]) {
      expect(readEnvironmentFromTags({ [key]: "dev" })).toBe(
        CloudResourceEnvironment.NonProduction,
      );
    }
  });

  test("a tag of another name never says anything", () => {
    expect(
      readEnvironmentFromTags({ Schedule: "office-hours", Team: "dev" }),
    ).toBe(CloudResourceEnvironment.Unknown);
    expect(readEnvironmentFromTags({ Name: "staging-web" })).toBe(
      CloudResourceEnvironment.Unknown,
    );
  });

  test("two environment tags that disagree are production", () => {
    expect(
      readEnvironmentFromTags({ env: "dev", Environment: "production" }),
    ).toBe(CloudResourceEnvironment.Production);
  });

  test("no tags, or values that are not text, say nothing", () => {
    expect(readEnvironmentFromTags(undefined)).toBe(
      CloudResourceEnvironment.Unknown,
    );
    expect(readEnvironmentFromTags({ env: 3 as unknown as string })).toBe(
      CloudResourceEnvironment.Unknown,
    );
  });
});

describe("what a resource's labels say", () => {
  test("a label named for an environment, or written as key and value", () => {
    expect(readEnvironmentFromLabels(["Staging"])).toBe(
      CloudResourceEnvironment.NonProduction,
    );
    expect(readEnvironmentFromLabels(["team-a", "Production"])).toBe(
      CloudResourceEnvironment.Production,
    );
    expect(readEnvironmentFromLabels(["env: dev"])).toBe(
      CloudResourceEnvironment.NonProduction,
    );
    expect(readEnvironmentFromLabels(["environment=prod"])).toBe(
      CloudResourceEnvironment.Production,
    );
  });

  test("a label that only holds the word inside another says nothing", () => {
    expect(readEnvironmentFromLabels(["dev-tools team"])).toBe(
      CloudResourceEnvironment.Unknown,
    );
    expect(readEnvironmentFromLabels(["owner: dev"])).toBe(
      CloudResourceEnvironment.Unknown,
    );
  });
});

describe("a resource's environment, from all its signs", () => {
  test("production on any sign: a tag beats the account's non-production", () => {
    expect(
      getCloudResourceEnvironment({
        tags: { env: "prod" },
        accountEnvironment: CloudResourceEnvironment.NonProduction,
      }),
    ).toEqual({
      environment: CloudResourceEnvironment.Production,
      source: CloudEnvironmentSource.Tag,
    });
  });

  test("a production account beats a resource tagged dev", () => {
    expect(
      getCloudResourceEnvironment({
        tags: { env: "dev" },
        accountEnvironment: CloudResourceEnvironment.Production,
      }),
    ).toEqual({
      environment: CloudResourceEnvironment.Production,
      source: CloudEnvironmentSource.Account,
    });
  });

  test("a non-production account makes an untagged resource non-production", () => {
    expect(
      getCloudResourceEnvironment({
        tags: {},
        accountEnvironment: CloudResourceEnvironment.NonProduction,
      }),
    ).toEqual({
      environment: CloudResourceEnvironment.NonProduction,
      source: CloudEnvironmentSource.Account,
    });
  });

  test("nothing said is not known, and is never non-production", () => {
    const reading: ReturnType<typeof getCloudResourceEnvironment> =
      getCloudResourceEnvironment({ tags: { Team: "web" } });

    expect(reading).toEqual({
      environment: CloudResourceEnvironment.Unknown,
      source: CloudEnvironmentSource.None,
    });
    expect(isKnownNonProduction(reading.environment)).toBe(false);
  });

  test("an account's environment of no known value is ignored", () => {
    expect(
      getCloudResourceEnvironment({ accountEnvironment: "Mostly prod" })
        .environment,
    ).toBe(CloudResourceEnvironment.Unknown);
  });

  test("labels count when tags and the account say nothing", () => {
    expect(getCloudResourceEnvironment({ labelNames: ["QA"] })).toEqual({
      environment: CloudResourceEnvironment.NonProduction,
      source: CloudEnvironmentSource.Label,
    });
  });
});

describe("the word lists and labels", () => {
  test("no word is in both lists", () => {
    for (const word of CLOUD_PRODUCTION_WORDS) {
      expect(CLOUD_NON_PRODUCTION_WORDS).not.toContain(word);
    }
  });

  test("combining signs: production, then non-production, then unknown", () => {
    expect(
      combineEnvironments([
        CloudResourceEnvironment.NonProduction,
        CloudResourceEnvironment.Production,
      ]),
    ).toBe(CloudResourceEnvironment.Production);
    expect(
      combineEnvironments([undefined, CloudResourceEnvironment.NonProduction]),
    ).toBe(CloudResourceEnvironment.NonProduction);
    expect(combineEnvironments([])).toBe(CloudResourceEnvironment.Unknown);
  });

  test("every environment has a label", () => {
    for (const environment of Object.values(CloudResourceEnvironment)) {
      expect(CLOUD_RESOURCE_ENVIRONMENT_LABELS[environment]).toBeTruthy();
    }
  });
});
