import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_REQUIRED_TAG_MAX_ALLOWED_VALUES,
  CLOUD_REQUIRED_TAG_VALUE_MAX_LENGTH,
  CLOUD_TAG_NEIGHBOURS_MIN_AGREEING,
  CloudRequiredTagRule,
  CloudTagKeyKind,
  CloudTagNeighbourRelation,
  CloudTagProblem,
  CloudTagSuggestion,
  CloudTagSuggestionSource,
  evaluateCloudTags,
  findAllowedCloudTagValue,
  findCloudTagValue,
  fitCloudTagValue,
  getCloudRequiredTagsForAccount,
  getCloudResourceNamePrefix,
  getCloudTagCommand,
  getCloudTagCoveragePercent,
  getCloudTagKeyKind,
  isCloudTagValueAllowed,
  isCloudTagValuePattern,
  matchesCloudTagPattern,
  normalizeCloudTagKey,
  parseCloudTagAllowedValues,
  quoteForShell,
  slugCloudTagValue,
  suggestCloudTagValue,
  suggestFromCloudTagNeighbours,
  toClickHouseLikePattern,
} from "../../../Types/Cloud/CloudRequiredTags";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";

/*
 * REQUIRED TAGS, IN CODE (#11012): what "carries the tag" means - the key
 * whatever its case, an empty value no value, an allowed value whatever
 * its case or a wildcard pattern - which the watcher, the coverage pages
 * and the SQL (CloudTagConditions, held to this on real ClickHouse and
 * Postgres in their own suites) all mean; an account's own tags over the
 * project's; the values OneUptime suggests and only when the tag allows
 * them; and the one command that sets a tag in each cloud.
 */

function rule(
  key: string,
  allowedValues: Array<string> = [],
  cloudAccountId: string | null = null,
  id: string = key,
): CloudRequiredTagRule {
  return { id, key, allowedValues, cloudAccountId };
}

describe("a tag's key and value, as they are compared", () => {
  test("a key is trimmed and in lower case; anything but a string is no key", () => {
    expect(normalizeCloudTagKey("  Cost-Center ")).toBe("cost-center");
    expect(normalizeCloudTagKey("TEAM")).toBe("team");
    expect(normalizeCloudTagKey(undefined)).toBe("");
    expect(normalizeCloudTagKey(42)).toBe("");
  });

  test("a resource's value is found under any spelling of the key, the exact one first", () => {
    expect(findCloudTagValue({ Team: "payments" }, "team")).toEqual({
      key: "Team",
      value: "payments",
    });
    // The exact spelling wins over another, whatever order the tags come in.
    expect(
      findCloudTagValue({ TEAM: "search", team: "payments" }, "team"),
    ).toEqual({ key: "team", value: "payments" });
    // Of the others, the first in key order.
    expect(
      findCloudTagValue({ TEAM: "search", Team: "payments" }, "team"),
    ).toEqual({ key: "TEAM", value: "search" });
  });

  test("an empty or blank value is no value, and a spelling that holds one is used instead", () => {
    expect(findCloudTagValue({ team: "" }, "team")).toBeNull();
    expect(findCloudTagValue({ team: "   " }, "team")).toBeNull();
    expect(findCloudTagValue({ team: " ", Team: "payments" }, "team")).toEqual(
      { key: "Team", value: "payments" },
    );
    // Values are kept as written, trimmed.
    expect(findCloudTagValue({ team: "  Payments  " }, "team")).toEqual({
      key: "team",
      value: "Payments",
    });
  });

  test("tags that are not a map hold no value", () => {
    expect(findCloudTagValue(null, "team")).toBeNull();
    expect(findCloudTagValue(undefined, "team")).toBeNull();
    expect(
      findCloudTagValue(["team"] as unknown as Record<string, unknown>, "team"),
    ).toBeNull();
    expect(findCloudTagValue({ team: 7 }, "team")).toBeNull();
    expect(findCloudTagValue({ team: "x" }, "  ")).toBeNull();
  });
});

describe("a pattern", () => {
  test("is a value with * or ?", () => {
    expect(isCloudTagValuePattern("prod-*")).toBe(true);
    expect(isCloudTagValuePattern("team-?")).toBe(true);
    expect(isCloudTagValuePattern("payments")).toBe(false);
  });

  test.each([
    ["prod-eu", "prod-*", true],
    ["prod-", "prod-*", true],
    ["PROD-EU", "prod-*", true],
    ["staging", "prod-*", false],
    ["a-prod-eu", "prod-*", false],
    ["team-1", "team-?", true],
    ["team-12", "team-?", false],
    ["team-", "team-?", false],
    ["anything", "*", true],
    ["", "*", true],
    ["x", "", false],
    ["abc", "a*c", true],
    ["ac", "a*c", true],
    ["abcbc", "a*c", true],
    ["abcb", "a*c", false],
    ["eu-west-1", "*-west-?", true],
    ["eu-west-12", "*-west-?", false],
    ["100%", "100%", true],
    ["100x", "100%", false],
    ["a_b", "a_b", true],
    ["axb", "a_b", false],
    ["dev.env", "dev.env", true],
    ["devxenv", "dev.env", false],
    ["Équipe-A", "équipe-*", true],
  ])("%s against %s: %s", (value: string, pattern: string, matches: boolean) => {
    expect(matchesCloudTagPattern(value, pattern)).toBe(matches);
  });

  /*
   * The walk against a regular expression built from the same pattern
   * (every other character escaped), over many drawn values and patterns:
   * one meaning, whichever reads it.
   */
  test("means what the same pattern as a regular expression means, over 20,000 drawn cases", () => {
    const random: SeededRandom = seededRandom(11012);
    const alphabet: Array<string> = ["a", "b", "A", "-", "."];
    const patternAlphabet: Array<string> = [...alphabet, "*", "?"];
    const draw: (letters: Array<string>, longest: number) => string = (
      letters: Array<string>,
      longest: number,
    ): string => {
      let text: string = "";
      const length: number = random(longest + 1);

      for (let index = 0; index < length; index++) {
        text += letters[random(letters.length)];
      }

      return text;
    };

    for (let index = 0; index < 20000; index++) {
      const value: string = draw(alphabet, 8);
      const pattern: string = draw(patternAlphabet, 6);
      const expected: boolean = new RegExp(
        `^${pattern
          .split("")
          .map((character: string): string => {
            if (character === "*") {
              return ".*";
            }

            if (character === "?") {
              return ".";
            }

            return escapeRegExp(character);
          })
          .join("")}$`,
        "is",
      ).test(value);

      expect({ value, pattern, matches: matchesCloudTagPattern(value, pattern) })
        .toEqual({ value, pattern, matches: expected });
    }
  });

  test("a pattern built to backtrack still finishes, and answers right", () => {
    const value: string = `${"a".repeat(5000)}c`;

    expect(matchesCloudTagPattern(value, "*a*a*a*a*a*a*a*a*b")).toBe(false);
    expect(matchesCloudTagPattern(value, "*a*a*a*a*a*a*a*a*c")).toBe(true);
  });

  test("as a ClickHouse or Postgres LIKE: * and ? become % and _, and LIKE's own characters match only themselves", () => {
    expect(toClickHouseLikePattern("prod-*")).toBe("prod-%");
    expect(toClickHouseLikePattern("team-?")).toBe("team-_");
    expect(toClickHouseLikePattern("100%_off\\")).toBe("100\\%\\_off\\\\");
    expect(toClickHouseLikePattern("plain")).toBe("plain");
  });
});

describe("a value a tag allows", () => {
  test("any value at all, when it names none, but never an empty one", () => {
    expect(isCloudTagValueAllowed("anything", [])).toBe(true);
    expect(isCloudTagValueAllowed("anything", ["", "  "])).toBe(true);
    expect(isCloudTagValueAllowed("", [])).toBe(false);
    expect(isCloudTagValueAllowed("   ", ["*"])).toBe(false);
  });

  test("one of its values whatever the case, or a pattern it names", () => {
    const allowed: Array<string> = ["payments", "Search", "platform-*"];

    expect(isCloudTagValueAllowed("PAYMENTS", allowed)).toBe(true);
    expect(isCloudTagValueAllowed("search", allowed)).toBe(true);
    expect(isCloudTagValueAllowed(" payments ", allowed)).toBe(true);
    expect(isCloudTagValueAllowed("platform-core", allowed)).toBe(true);
    expect(isCloudTagValueAllowed("platform", allowed)).toBe(false);
    expect(isCloudTagValueAllowed("billing", allowed)).toBe(false);
    // An exact value is never read as a pattern of itself.
    expect(isCloudTagValueAllowed("paymentsx", allowed)).toBe(false);
  });

  test("allowed values typed as a person types them: commas or lines, trimmed, once each, cut", () => {
    expect(
      parseCloudTagAllowedValues("payments, search,\nplatform-*\n\n, Payments"),
    ).toEqual(["payments", "search", "platform-*"]);
    expect(parseCloudTagAllowedValues(["a", " b ", 3, "A"])).toEqual([
      "a",
      "b",
    ]);
    expect(parseCloudTagAllowedValues(undefined)).toEqual([]);

    const many: string = Array.from({ length: 250 }, (_v: unknown, i: number) => {
      return `v${i}`;
    }).join(",");
    expect(parseCloudTagAllowedValues(many)).toHaveLength(
      CLOUD_REQUIRED_TAG_MAX_ALLOWED_VALUES,
    );
    expect(parseCloudTagAllowedValues("x".repeat(1000))[0]).toHaveLength(
      CLOUD_REQUIRED_TAG_VALUE_MAX_LENGTH,
    );
  });
});

describe("carrying a required tag", () => {
  test("any spelling of the key with an allowed value carries it, even when another spelling's value is not allowed", () => {
    const team: CloudRequiredTagRule = rule("team", ["payments", "search"]);

    expect(
      findAllowedCloudTagValue({ team: "unknown", Team: "payments" }, team),
    ).toEqual({ key: "Team", value: "payments" });
    expect(findAllowedCloudTagValue({ TEAM: "Search" }, team)).toEqual({
      key: "TEAM",
      value: "Search",
    });
    expect(findAllowedCloudTagValue({ team: "unknown" }, team)).toBeNull();
    expect(findAllowedCloudTagValue({ owner: "payments" }, team)).toBeNull();
  });

  test("what a resource lacks: nothing when it carries every tag, else each tag missing or with a value not allowed", () => {
    const rules: Array<CloudRequiredTagRule> = [
      rule("team", ["payments"]),
      rule("env", ["prod", "staging"]),
      rule("cost-center"),
    ];

    expect(
      evaluateCloudTags(
        { Team: "Payments", ENV: "prod", "Cost-Center": "4711" },
        rules,
      ),
    ).toEqual([]);

    expect(
      evaluateCloudTags({ team: "search", "cost-center": " " }, rules),
    ).toEqual([
      {
        key: "team",
        problem: CloudTagProblem.NotAllowed,
        foundKey: "team",
        value: "search",
      },
      { key: "env", problem: CloudTagProblem.Missing },
      { key: "cost-center", problem: CloudTagProblem.Missing },
    ]);

    expect(evaluateCloudTags(null, [rule("team")])).toEqual([
      { key: "team", problem: CloudTagProblem.Missing },
    ]);
    expect(evaluateCloudTags({ team: "x" }, [])).toEqual([]);
  });
});

describe("an account's required tags", () => {
  const rules: Array<CloudRequiredTagRule> = [
    rule("team", ["payments", "search"], null, "p-team"),
    rule("env", [], null, "p-env"),
    rule("Team", ["platform"], "ACCOUNT-A", "a-team"),
    rule("owner", [], "account-a", "a-owner"),
    rule("cost-center", [], "account-b", "b-cost"),
  ];

  test("the project's, each replaced by the account's own of the same key whatever the case, and its own keys added, by key", () => {
    expect(
      getCloudRequiredTagsForAccount(rules, "account-a").map(
        (entry: CloudRequiredTagRule): string => {
          return entry.id;
        },
      ),
    ).toEqual(["p-env", "a-owner", "a-team"]);
  });

  test("another account's tags are never its, and no account means the project's alone", () => {
    expect(
      getCloudRequiredTagsForAccount(rules, "account-c").map(
        (entry: CloudRequiredTagRule): string => {
          return entry.id;
        },
      ),
    ).toEqual(["p-env", "p-team"]);
    expect(
      getCloudRequiredTagsForAccount(rules, null).map(
        (entry: CloudRequiredTagRule): string => {
          return entry.id;
        },
      ),
    ).toEqual(["p-env", "p-team"]);
  });

  test("of two project tags with one key, the first is the one", () => {
    expect(
      getCloudRequiredTagsForAccount(
        [rule("team", ["a"], null, "first"), rule("TEAM", ["b"], null, "second")],
        null,
      ).map((entry: CloudRequiredTagRule): string => {
        return entry.id;
      }),
    ).toEqual(["first"]);
  });
});

describe("a share of the spend or of the resources", () => {
  test("in percent to one decimal, never past 0 or 100, and nothing to measure is no share at all", () => {
    expect(getCloudTagCoveragePercent({ covered: 1, total: 3 })).toBe(33.3);
    expect(getCloudTagCoveragePercent({ covered: 2, total: 3 })).toBe(66.7);
    expect(getCloudTagCoveragePercent({ covered: 5, total: 5 })).toBe(100);
    expect(getCloudTagCoveragePercent({ covered: 0, total: 5 })).toBe(0);
    expect(getCloudTagCoveragePercent({ covered: 7, total: 5 })).toBe(100);
    expect(getCloudTagCoveragePercent({ covered: -1, total: 5 })).toBe(0);
    expect(getCloudTagCoveragePercent({ covered: 0, total: 0 })).toBeNull();
    expect(getCloudTagCoveragePercent(null)).toBeNull();
    expect(
      getCloudTagCoveragePercent({ covered: Number.NaN, total: 5 }),
    ).toBeNull();
  });
});

describe("what kind of tag a key is", () => {
  test.each([
    ["team", CloudTagKeyKind.Team],
    ["Owner", CloudTagKeyKind.Team],
    ["owning-squad", CloudTagKeyKind.Team],
    ["department", CloudTagKeyKind.Team],
    ["env", CloudTagKeyKind.Environment],
    ["deployment.environment", CloudTagKeyKind.Environment],
    ["Stage", CloudTagKeyKind.Environment],
    ["team-env", CloudTagKeyKind.Environment],
    ["cost-center", CloudTagKeyKind.Other],
    ["teams", CloudTagKeyKind.Other],
  ])("%s is %s", (key: string, kind: CloudTagKeyKind) => {
    expect(getCloudTagKeyKind(key)).toBe(kind);
  });
});

describe("a name as a tag value", () => {
  test("slugs as tag values often are", () => {
    expect(slugCloudTagValue("  Payments Team ")).toBe("payments-team");
    expect(slugCloudTagValue("Search & Discovery!")).toBe("search-discovery");
  });

  test("one of the allowed values, by its case or its slug; a pattern it matches; otherwise none", () => {
    expect(
      fitCloudTagValue({
        name: "Payments Team",
        allowedValues: ["payments-team", "search"],
      }),
    ).toBe("payments-team");
    expect(
      fitCloudTagValue({ name: "SEARCH", allowedValues: ["Search"] }),
    ).toBe("Search");
    expect(
      fitCloudTagValue({ name: "platform core", allowedValues: ["platform-*"] }),
    ).toBe("platform-core");
    expect(
      fitCloudTagValue({ name: "Billing", allowedValues: ["payments"] }),
    ).toBeNull();
    expect(fitCloudTagValue({ name: "  ", allowedValues: [] })).toBeNull();
  });

  test("when any value goes: the name itself, or its slug on Google Cloud, whose labels allow only lower case", () => {
    expect(
      fitCloudTagValue({ name: "Payments Team", allowedValues: [] }),
    ).toBe("Payments Team");
    expect(
      fitCloudTagValue({
        name: "Payments Team",
        allowedValues: [],
        provider: "gcp",
      }),
    ).toBe("payments-team");
  });
});

describe("the value the resources beside one agree on", () => {
  const team: CloudRequiredTagRule = rule("team", ["payments", "search"]);

  test("of its stack before its resource group before its name, at least two agreeing and more than half", () => {
    const suggestion: CloudTagSuggestion | null = suggestFromCloudTagNeighbours(
      {
        rule: team,
        groups: [
          {
            relation: CloudTagNeighbourRelation.NamePrefix,
            name: "web",
            tags: [{ team: "search" }, { team: "search" }, { team: "search" }],
          },
          {
            relation: CloudTagNeighbourRelation.Stack,
            name: "checkout-stack",
            tags: [{ Team: "Payments" }, { team: "payments" }, { env: "prod" }],
          },
        ],
      },
    );

    expect(suggestion).toEqual({
      key: "team",
      value: "Payments",
      source: CloudTagSuggestionSource.Neighbours,
      detail: "checkout-stack",
      count: 2,
    });
  });

  test(`fewer than ${CLOUD_TAG_NEIGHBOURS_MIN_AGREEING} agreeing, or no majority, says nothing; values a tag does not allow are not counted`, () => {
    expect(
      suggestFromCloudTagNeighbours({
        rule: team,
        groups: [
          {
            relation: CloudTagNeighbourRelation.Stack,
            name: "s",
            tags: [{ team: "payments" }],
          },
        ],
      }),
    ).toBeNull();
    expect(
      suggestFromCloudTagNeighbours({
        rule: team,
        groups: [
          {
            relation: CloudTagNeighbourRelation.ResourceGroup,
            name: "rg",
            tags: [
              { team: "payments" },
              { team: "payments" },
              { team: "search" },
              { team: "search" },
            ],
          },
        ],
      }),
    ).toBeNull();
    expect(
      suggestFromCloudTagNeighbours({
        rule: team,
        groups: [
          {
            relation: CloudTagNeighbourRelation.ResourceGroup,
            name: "rg",
            tags: [{ team: "unknown" }, { team: "unknown" }, { team: "unknown" }],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("the value OneUptime suggests", () => {
  test("a team-like key: the one team that owns it, as the tag allows it", () => {
    expect(
      suggestCloudTagValue({
        rule: rule("owner", ["payments-team"]),
        ownerTeamNames: ["Payments Team"],
        neighbours: [],
      }),
    ).toEqual({
      key: "owner",
      value: "payments-team",
      source: CloudTagSuggestionSource.OwnerTeam,
      detail: "Payments Team",
    });

    // Two owner teams say nothing of which.
    expect(
      suggestCloudTagValue({
        rule: rule("team"),
        ownerTeamNames: ["Payments", "Search"],
        neighbours: [],
      }),
    ).toBeNull();
  });

  test("an environment-like key: its App Platforms environment, as the tag allows it", () => {
    expect(
      suggestCloudTagValue({
        rule: rule("env", ["prod", "staging"]),
        ownerTeamNames: [],
        environmentName: "Prod",
        neighbours: [],
      }),
    ).toEqual({
      key: "env",
      value: "prod",
      source: CloudTagSuggestionSource.Environment,
      detail: "Prod",
    });
    expect(
      suggestCloudTagValue({
        rule: rule("env", ["prod"]),
        ownerTeamNames: [],
        environmentName: "QA",
        neighbours: [],
      })?.source,
    ).toBe(CloudTagSuggestionSource.OnlyAllowedValue);
  });

  test("else the neighbours, else the only value the tag allows, else nothing", () => {
    expect(
      suggestCloudTagValue({
        rule: rule("cost-center", ["4711"]),
        ownerTeamNames: ["Payments"],
        neighbours: [],
      }),
    ).toEqual({
      key: "cost-center",
      value: "4711",
      source: CloudTagSuggestionSource.OnlyAllowedValue,
    });
    // A pattern beside the value: more than one value is allowed.
    expect(
      suggestCloudTagValue({
        rule: rule("cost-center", ["4711", "47*"]),
        ownerTeamNames: [],
        neighbours: [],
      }),
    ).toBeNull();
    expect(
      suggestCloudTagValue({
        rule: rule("cost-center"),
        ownerTeamNames: [],
        neighbours: [],
      }),
    ).toBeNull();
  });
});

describe("a resource's name before its number", () => {
  test.each([
    ["web-1", "web"],
    ["Web-12", "web"],
    ["api_server.3", "api_server"],
    ["cache7", "cache"],
    // Too short a prefix to say the resources are alike.
    ["db7", null],
    ["worker", null],
    ["a-1", null],
    ["123", null],
  ])("%s is %s", (name: string, prefix: string | null) => {
    expect(getCloudResourceNamePrefix(name)).toBe(prefix);
  });
});

describe("the one command that sets a tag in its cloud", () => {
  test("a word is quoted for a shell only when it needs to be, and a quote inside cannot end it", () => {
    expect(quoteForShell("team=payments")).toBe("team=payments");
    expect(quoteForShell("team=Payments Team")).toBe("'team=Payments Team'");
    expect(quoteForShell("it's")).toBe("'it'\\''s'");
    expect(quoteForShell("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(quoteForShell("a;b")).toBe("'a;b'");
  });

  test("AWS: the tagging API, in the ARN's Region, for any resource by its ARN", () => {
    expect(
      getCloudTagCommand({
        provider: "aws",
        type: "AWS::EC2::Instance",
        providerResourceId:
          "arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc123def4567890",
        key: "team",
        value: "payments",
      }),
    ).toBe(
      "aws resourcegroupstaggingapi tag-resources --region eu-west-1 --resource-arn-list arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc123def4567890 --tags team=payments",
    );
    // A global resource's ARN names no Region: the resource's own, if known.
    expect(
      getCloudTagCommand({
        provider: "aws",
        type: "AWS::S3::Bucket",
        providerResourceId: "arn:aws:s3:::my-bucket",
        region: "us-east-1",
        key: "team",
        value: "Payments Team",
      }),
    ).toBe(
      "aws resourcegroupstaggingapi tag-resources --region us-east-1 --resource-arn-list arn:aws:s3:::my-bucket --tags 'team=Payments Team'",
    );
    expect(
      getCloudTagCommand({
        provider: "aws",
        type: "x",
        providerResourceId: "i-0abc",
        key: "team",
        value: "payments",
      }),
    ).toBeNull();
  });

  test("Azure: az tag update, merged into what the resource carries", () => {
    expect(
      getCloudTagCommand({
        provider: "azure",
        type: "Microsoft.Compute/virtualMachines",
        providerResourceId:
          "/subscriptions/0000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1",
        key: "env",
        value: "prod",
      }),
    ).toBe(
      "az tag update --resource-id /subscriptions/0000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1 --operation Merge --tags env=prod",
    );
  });

  test("Google Cloud: each kind its own command, in the resource's project and zone", () => {
    expect(
      getCloudTagCommand({
        provider: "gcp",
        type: "gce_instance",
        providerResourceId:
          "//compute.googleapis.com/projects/shop-prod/zones/us-central1-a/instances/web-1",
        key: "team",
        value: "payments",
      }),
    ).toBe(
      "gcloud compute instances add-labels web-1 --project shop-prod --zone us-central1-a --labels team=payments",
    );
    expect(
      getCloudTagCommand({
        provider: "gcp",
        type: "gce_disk",
        providerResourceId:
          "//compute.googleapis.com/projects/shop-prod/zones/us-central1-a/disks/data-1",
        key: "team",
        value: "payments",
      }),
    ).toBe(
      "gcloud compute disks add-labels data-1 --project shop-prod --zone us-central1-a --labels team=payments",
    );
    expect(
      getCloudTagCommand({
        provider: "gcp",
        type: "gcs_bucket",
        providerResourceId: "//storage.googleapis.com/assets-bucket",
        key: "team",
        value: "payments",
      }),
    ).toBe(
      "gcloud storage buckets update gs://assets-bucket --update-labels team=payments",
    );
    expect(
      getCloudTagCommand({
        provider: "gcp",
        type: "cloudsql_database",
        providerResourceId: "shop-prod:orders-db",
        accountId: "shop-prod",
        key: "team",
        value: "payments",
      }),
    ).toBe(
      "gcloud sql instances patch orders-db --project shop-prod --update-labels team=payments",
    );
    // A kind OneUptime knows no command of is labelled in its console.
    expect(
      getCloudTagCommand({
        provider: "gcp",
        type: "pubsub_topic",
        providerResourceId: "//pubsub.googleapis.com/projects/p/topics/t",
        key: "team",
        value: "payments",
      }),
    ).toBeNull();
  });

  test("no id, key or value, or another cloud: no command", () => {
    for (const missing of [
      { providerResourceId: "" },
      { key: " " },
      { value: "" },
      { provider: "openstack" },
    ]) {
      expect(
        getCloudTagCommand({
          provider: "aws",
          type: "x",
          providerResourceId: "arn:aws:s3:::b",
          key: "team",
          value: "payments",
          ...missing,
        }),
      ).toBeNull();
    }
  });
});
