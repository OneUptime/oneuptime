import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_NON_PRODUCTION_SOURCES,
  CLOUD_NON_PRODUCTION_WORDS,
  CLOUD_PRODUCTION_WORDS,
  CLOUD_RESOURCE_ENVIRONMENT_LABELS,
  CLOUD_UNATTENDED_NON_PRODUCTION_SOURCES,
  CloudEnvironmentSource,
  CloudResourceEnvironment,
  CloudResourceEnvironmentReadings,
  CloudResourceEnvironmentSigns,
  combineEnvironments,
  doesLabelSayProduction,
  getCloudResourceEnvironment,
  getCloudResourceEnvironmentReadings,
  getUnattendedCloudResourceEnvironment,
  isKnownNonProduction,
  isNonProductionOnlyByLabels,
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

/*
 * #11347: renaming one label changed what OneUptime believed of every
 * resource that carried it. What nobody approves - an off-hours schedule's
 * stop, an AI rule's change made without asking - now reads non-production
 * only from the cloud's tags and the account's setting; a label may still
 * say production.
 */
describe("what a change nobody approves reads (#11347)", () => {
  test("a label never says non-production to it", () => {
    for (const labelNames of [
      ["dev"],
      ["Staging"],
      ["env: dev"],
      ["environment=qa"],
      ["QA", "team-a"],
    ]) {
      expect(getUnattendedCloudResourceEnvironment({ labelNames })).toEqual({
        environment: CloudResourceEnvironment.Unknown,
        source: CloudEnvironmentSource.None,
      });
      // A person approving still reads it, and is told where it came from.
      expect(getCloudResourceEnvironment({ labelNames })).toEqual({
        environment: CloudResourceEnvironment.NonProduction,
        source: CloudEnvironmentSource.Label,
      });
    }
  });

  test("a label still says production to it, whatever the tags and the account say", () => {
    expect(
      getUnattendedCloudResourceEnvironment({
        tags: { environment: "dev" },
        accountEnvironment: CloudResourceEnvironment.NonProduction,
        labelNames: ["Production"],
      }),
    ).toEqual({
      environment: CloudResourceEnvironment.Production,
      source: CloudEnvironmentSource.Label,
    });
  });

  test("the cloud's tags and the account's setting say non-production to it, as before", () => {
    expect(
      getUnattendedCloudResourceEnvironment({ tags: { env: "staging" } }),
    ).toEqual({
      environment: CloudResourceEnvironment.NonProduction,
      source: CloudEnvironmentSource.Tag,
    });
    expect(
      getUnattendedCloudResourceEnvironment({
        accountEnvironment: CloudResourceEnvironment.NonProduction,
        labelNames: ["dev"],
      }),
    ).toEqual({
      environment: CloudResourceEnvironment.NonProduction,
      source: CloudEnvironmentSource.Account,
    });
  });

  test("production from a tag or the account still wins over everything", () => {
    for (const signs of [
      { tags: { env: "prod" }, labelNames: ["dev"] },
      {
        accountEnvironment: CloudResourceEnvironment.Production,
        tags: { env: "dev" },
        labelNames: ["Staging"],
      },
    ]) {
      expect(getUnattendedCloudResourceEnvironment(signs).environment).toBe(
        CloudResourceEnvironment.Production,
      );
    }
  });

  test("renaming a label never makes a resource non-production to it: every name, on every resource its tags and account say nothing of", () => {
    const names: Array<string> = [
      ...CLOUD_PRODUCTION_WORDS,
      ...CLOUD_NON_PRODUCTION_WORDS,
      ...CLOUD_NON_PRODUCTION_WORDS.map((word: string): string => {
        return `env: ${word}`;
      }),
      ...CLOUD_NON_PRODUCTION_WORDS.map((word: string): string => {
        return `Environment=${word.toUpperCase()}`;
      }),
      "Production EU",
      "team-a",
      "",
    ];

    // A label renamed to any of these: what is read of the resource after.
    for (const name of names) {
      for (const otherLabels of [[], ["team-b"], ["dev"], ["Staging", "qa"]]) {
        for (const signs of [
          {},
          { tags: { Team: "web" } },
          { accountEnvironment: CloudResourceEnvironment.Unknown },
          { accountEnvironment: "Mostly non-production" },
        ]) {
          const read: CloudResourceEnvironment =
            getUnattendedCloudResourceEnvironment({
              ...signs,
              labelNames: [name, ...otherLabels],
            }).environment;

          expect({ name, otherLabels, read }).toEqual({
            name,
            otherLabels,
            read: doesLabelSayProduction(name)
              ? CloudResourceEnvironment.Production
              : CloudResourceEnvironment.Unknown,
          });
        }
      }
    }
  });

  test("the issue's two renames: Production to dev, and any label to dev", () => {
    // "Production" renamed to "dev": every sign read it non-production after.
    expect(
      getCloudResourceEnvironment({ labelNames: ["dev"] }).environment,
    ).toBe(CloudResourceEnvironment.NonProduction);
    expect(
      getUnattendedCloudResourceEnvironment({ labelNames: ["Production"] })
        .environment,
    ).toBe(CloudResourceEnvironment.Production);
    expect(
      getUnattendedCloudResourceEnvironment({ labelNames: ["dev"] })
        .environment,
    ).toBe(CloudResourceEnvironment.Unknown);

    // "team-a", on a resource nothing else is said of, renamed to "dev".
    expect(
      getUnattendedCloudResourceEnvironment({ labelNames: ["team-a"] })
        .environment,
    ).toBe(CloudResourceEnvironment.Unknown);
    expect(
      isKnownNonProduction(
        getUnattendedCloudResourceEnvironment({ labelNames: ["dev"] })
          .environment,
      ),
    ).toBe(false);
  });

  test("on a resource its tags call non-production, only a label that says production holds it back: so renaming that one lets go, which an agent asks a person about first", () => {
    const tags: Record<string, string> = { environment: "dev" };

    expect(
      getUnattendedCloudResourceEnvironment({
        tags,
        labelNames: ["Production"],
      }).environment,
    ).toBe(CloudResourceEnvironment.Production);
    expect(
      getUnattendedCloudResourceEnvironment({
        tags,
        labelNames: ["Customer facing"],
      }).environment,
    ).toBe(CloudResourceEnvironment.NonProduction);
    // A rename that still says production holds it as before.
    expect(
      getUnattendedCloudResourceEnvironment({ tags, labelNames: ["prod"] })
        .environment,
    ).toBe(CloudResourceEnvironment.Production);
  });

  test("both readings, read once, are the two readings", () => {
    for (const tags of [{}, { env: "dev" }, { env: "prod" }, { Team: "web" }]) {
      for (const accountEnvironment of [
        undefined,
        "Mostly prod",
        ...Object.values(CloudResourceEnvironment),
      ]) {
        for (const labelNames of [
          [],
          ["dev"],
          ["Production"],
          ["dev", "Production"],
          ["team-a"],
        ]) {
          const signs: CloudResourceEnvironmentSigns = {
            tags,
            accountEnvironment,
            labelNames,
          };
          const readings: CloudResourceEnvironmentReadings =
            getCloudResourceEnvironmentReadings(signs);

          expect(readings).toEqual({
            reading: getCloudResourceEnvironment(signs),
            unattended: getUnattendedCloudResourceEnvironment(signs),
          });

          // Production on every sign alike, in both readings.
          expect(
            readings.unattended.environment ===
              CloudResourceEnvironment.Production,
          ).toBe(
            readings.reading.environment ===
              CloudResourceEnvironment.Production,
          );

          // Non-production to a change nobody approves only from a tag or the account.
          if (
            readings.unattended.environment ===
            CloudResourceEnvironment.NonProduction
          ) {
            expect([
              CloudEnvironmentSource.Tag,
              CloudEnvironmentSource.Account,
            ]).toContain(readings.unattended.source);
            expect(readings.reading).toEqual(readings.unattended);
          }

          // The two differ only where a label's non-production is the only one.
          expect(isNonProductionOnlyByLabels(readings.reading)).toBe(
            readings.reading.environment !== readings.unattended.environment,
          );

          if (isNonProductionOnlyByLabels(readings.reading)) {
            expect(readings.unattended).toEqual({
              environment: CloudResourceEnvironment.Unknown,
              source: CloudEnvironmentSource.None,
            });
          }
        }
      }
    }
  });

  test("the signs each reading takes non-production from", () => {
    expect(CLOUD_NON_PRODUCTION_SOURCES).toEqual([
      CloudEnvironmentSource.Tag,
      CloudEnvironmentSource.Account,
      CloudEnvironmentSource.Label,
    ]);
    expect(CLOUD_UNATTENDED_NON_PRODUCTION_SOURCES).toEqual([
      CloudEnvironmentSource.Tag,
      CloudEnvironmentSource.Account,
    ]);
  });
});

describe("whether a reading's non-production is its labels' alone", () => {
  test("only a non-production a label gave", () => {
    expect(
      isNonProductionOnlyByLabels({
        environment: CloudResourceEnvironment.NonProduction,
        source: CloudEnvironmentSource.Label,
      }),
    ).toBe(true);

    for (const reading of [
      {
        environment: CloudResourceEnvironment.NonProduction,
        source: CloudEnvironmentSource.Tag,
      },
      {
        environment: CloudResourceEnvironment.NonProduction,
        source: CloudEnvironmentSource.Account,
      },
      {
        environment: CloudResourceEnvironment.Production,
        source: CloudEnvironmentSource.Label,
      },
      {
        environment: CloudResourceEnvironment.Unknown,
        source: CloudEnvironmentSource.None,
      },
    ]) {
      expect(isNonProductionOnlyByLabels(reading)).toBe(false);
    }
  });
});

describe("whether a label's name says production", () => {
  test.each([
    ["Production", true],
    ["prod", true],
    ["PRD", true],
    ["live", true],
    ["env: prod", true],
    ["environment=production", true],
    ["Production EU", false],
    ["prod-eu", false],
    ["owner: prod", false],
    ["dev", false],
    ["Staging", false],
    ["", false],
  ])("%s: %s", (name: string, says: boolean) => {
    expect(doesLabelSayProduction(name)).toBe(says);
    // As a resource's labels are read.
    expect(
      readEnvironmentFromLabels([name]) === CloudResourceEnvironment.Production,
    ).toBe(says);
  });

  test("a name that is not text says nothing", () => {
    for (const name of [undefined, null, 3, {}, ["Production"]]) {
      expect(doesLabelSayProduction(name)).toBe(false);
    }
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
