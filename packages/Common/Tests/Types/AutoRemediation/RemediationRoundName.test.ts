import { describe, expect, test } from "@jest/globals";
import {
  CLUSTER_ROUND_NAME_PREFIX,
  describeRemediationRoundName,
  getClusterRoundNameSnapshot,
  getRemediationRoundResourceNoun,
  getResourceRoundNameSnapshot,
  parseClusterRoundNameSnapshot,
  parseResourceRoundName,
  parseResourceRoundNumber,
  REMEDIATION_ROUND_RESOURCE_NOUNS,
  REMEDIATION_ROUND_SENTENCES,
} from "../../../Types/AutoRemediation/RemediationRoundName";
import { describeResourceNoun } from "../../../Server/Services/ResourceAiAccessService";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { fastestRun, FastestRun } from "../../Helpers/FastestRun";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * AN AI REMEDIATION ROUND'S NAME, AND HOW THE REMEDIATION STEP SAYS IT
 * (#5589's follow-up).
 *
 * The server names each round it runs on a cluster or a resource - 'AI
 * remediation for cluster "prod"', 'AI remediation for Docker host
 * "web-1" (round 2)' - and stores the name with the round, where the feed,
 * Slack, Microsoft Teams and the model read it in English. The Remediation
 * step showed that English under every fix's title, on every page. It now
 * reads the name back - what the round ran on, its name, which round it
 * is - and says it in the reader's language, with the name as data; a
 * name that is no round's (a rule's own) is shown as written.
 */

const NAMES: Array<string> = [
  "prod-eu-west-1",
  "web (round 7)",
  'a "quoted" name',
  "",
  "数据库",
  "پایگاه",
];

describe("the names the server writes are the names it always wrote", () => {
  test("a cluster's rounds", () => {
    expect(getClusterRoundNameSnapshot("prod", 1)).toBe(
      'AI remediation for cluster "prod"',
    );
    expect(getClusterRoundNameSnapshot("prod", 3)).toBe(
      'AI remediation for cluster "prod" (round 3)',
    );
    expect(CLUSTER_ROUND_NAME_PREFIX).toBe("AI remediation for cluster");
  });

  test("a resource's rounds, by the server's noun for each type", () => {
    expect(
      getResourceRoundNameSnapshot(AiResourceType.DockerHost, "web-1", 1),
    ).toBe('AI remediation for Docker host "web-1"');
    expect(getResourceRoundNameSnapshot(AiResourceType.Host, "web-2", 2)).toBe(
      'AI remediation for host "web-2" (round 2)',
    );
    expect(
      getResourceRoundNameSnapshot(AiResourceType.DatabaseServer, "orders", 1),
    ).toBe('AI remediation for database server "orders"');
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "a %s is named by the server's own noun for it",
    (type: AiResourceType) => {
      expect(getRemediationRoundResourceNoun(type)).toBe(
        describeResourceNoun(type),
      );
      expect(REMEDIATION_ROUND_RESOURCE_NOUNS[type]).toBe(
        describeResourceNoun(type),
      );
    },
  );

  test("a type with no noun of its own is a resource", () => {
    expect(getRemediationRoundResourceNoun("SomethingNew")).toBe("resource");
    expect(getRemediationRoundResourceNoun(undefined)).toBe("resource");
    expect(getRemediationRoundResourceNoun(null)).toBe("resource");
    // Never a property every object has.
    expect(getRemediationRoundResourceNoun("toString")).toBe("resource");
  });
});

describe("a round's name read back", () => {
  test.each(NAMES)(
    "a cluster round named %p, its name and its round",
    (name: string) => {
      for (const round of [1, 2, 12]) {
        expect(
          parseClusterRoundNameSnapshot(
            getClusterRoundNameSnapshot(name, round),
          ),
        ).toEqual({ clusterName: name });
        // English, as the server writes it, its values set apart for the page.
        expect(
          withoutIsolateMarks(
            describeRemediationRoundName({
              ruleNameSnapshot: getClusterRoundNameSnapshot(name, round),
              isClusterRound: true,
            }) || "",
          ),
        ).toBe(getClusterRoundNameSnapshot(name, round));
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "a %s round, by every name and round",
    (type: AiResourceType) => {
      for (const name of NAMES) {
        for (const round of [1, 2, 12]) {
          const snapshot: string = getResourceRoundNameSnapshot(
            type,
            name,
            round,
          );

          expect(parseResourceRoundName(snapshot, type)).toEqual({
            name,
            round,
          });
          expect(parseResourceRoundNumber(snapshot)).toBe(round);
          expect(
            withoutIsolateMarks(
              describeRemediationRoundName({
                ruleNameSnapshot: snapshot,
                isClusterRound: false,
                resourceType: type,
              }) || "",
            ),
          ).toBe(snapshot);
        }
      }
    },
  );

  test("a name that is not that type's round is not read as one", () => {
    const dockerRound: string = getResourceRoundNameSnapshot(
      AiResourceType.DockerHost,
      "web",
      2,
    );

    expect(parseResourceRoundName(dockerRound, AiResourceType.Host)).toBeNull();
    expect(
      parseResourceRoundName(
        getClusterRoundNameSnapshot("prod", 1),
        AiResourceType.Host,
      ),
    ).toBeNull();
    expect(
      parseResourceRoundName("Restart web pods", AiResourceType.Host),
    ).toBeNull();
    expect(parseResourceRoundName(undefined, AiResourceType.Host)).toBeNull();
    expect(parseResourceRoundName(42, AiResourceType.Host)).toBeNull();
    // The name never closed its quote.
    expect(
      parseResourceRoundName(
        'AI remediation for host "web',
        AiResourceType.Host,
      ),
    ).toBeNull();
  });

  test("a rule's own name is shown as written: no round sentence is made of it", () => {
    for (const isClusterRound of [true, false]) {
      expect(
        describeRemediationRoundName({
          ruleNameSnapshot: "Restart web pods",
          isClusterRound,
          resourceType: AiResourceType.Host,
        }),
      ).toBeNull();
      expect(
        describeRemediationRoundName({
          ruleNameSnapshot: null,
          isClusterRound,
          resourceType: AiResourceType.Host,
        }),
      ).toBeNull();
    }
  });

  test("a resource round is never read as a cluster's, nor a cluster round as a resource's", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(
        parseClusterRoundNameSnapshot(
          getResourceRoundNameSnapshot(type, "x", 2),
        ),
      ).toBeNull();
      expect(
        describeRemediationRoundName({
          ruleNameSnapshot: getClusterRoundNameSnapshot("x", 2),
          isClusterRound: false,
          resourceType: type,
        }),
      ).toBeNull();
    }
  });
});

describe("the Remediation step says a round in the reader's language", () => {
  const DE: Record<string, string> = readDashboardLocale("de");
  const FA: Record<string, string> = readDashboardLocale("fa");

  test("German: the sentence and the kind are German, the name as written", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      describeRemediationRoundName(
        {
          ruleNameSnapshot: getClusterRoundNameSnapshot("prod-eu", 1),
          isClusterRound: true,
        },
        german,
      ),
    ).toBe(
      DE[REMEDIATION_ROUND_SENTENCES.cluster]!.replace("{{name}}", "prod-eu"),
    );
    expect(
      describeRemediationRoundName(
        {
          ruleNameSnapshot: getResourceRoundNameSnapshot(
            AiResourceType.DockerHost,
            "web-1",
            2,
          ),
          isClusterRound: false,
          resourceType: AiResourceType.DockerHost,
        },
        german,
      ),
    ).toBe(
      DE[REMEDIATION_ROUND_SENTENCES.resourceRound]!.replace(
        "{{kind}}",
        german.translateTerm("Docker host", { inSentence: true }),
      )
        .replace("{{name}}", "web-1")
        .replace("{{round}}", "2"),
    );
  });

  test("Persian: right to left, the name set apart, the round in Persian digits", () => {
    const persian: Translator = dashboardTranslator("fa");
    const said: string = describeRemediationRoundName(
      {
        ruleNameSnapshot: getResourceRoundNameSnapshot(
          AiResourceType.Host,
          "web-2",
          3,
        ),
        isClusterRound: false,
        resourceType: AiResourceType.Host,
      },
      persian,
    )!;

    expect(said).toContain(isolated("web-2"));
    expect(said).toContain("۳");
    expect(withoutIsolateMarks(said)).toBe(
      FA[REMEDIATION_ROUND_SENTENCES.resourceRound]!.replace(
        "{{kind}}",
        persian.translateTerm("host", { inSentence: true }),
      )
        .replace("{{name}}", "web-2")
        .replace("{{round}}", "۳"),
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every round sentence and every kind of resource",
    (language: string) => {
      for (const sentence of Object.values(REMEDIATION_ROUND_SENTENCES)) {
        expect({
          sentence,
          worded: isWordedInDashboardLocale(sentence, language),
        }).toEqual({ sentence, worded: true });
        expect(
          placeholdersOf(readDashboardLocale(language)[sentence]!),
        ).toEqual(placeholdersOf(sentence));
      }

      for (const noun of Object.values(REMEDIATION_ROUND_RESOURCE_NOUNS)) {
        expect({
          noun,
          worded: isWordedInDashboardLocale(noun, language),
        }).toEqual({ noun, worded: true });
      }
    },
  );
});

describe("reading a name takes time in line with it", () => {
  test("a cluster round's name of 400,000 quotes", () => {
    const name: string = `${CLUSTER_ROUND_NAME_PREFIX} "${'"'.repeat(400_000)}x`;
    const timed: FastestRun<unknown> = fastestRun({
      run: (): unknown => {
        return parseClusterRoundNameSnapshot(name);
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBeNull();
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("a resource round's name of 400,000 digits in an unclosed round", () => {
    const name: string = `AI remediation for host "web" (round ${"1".repeat(400_000)}`;
    const timed: FastestRun<unknown> = fastestRun({
      run: (): unknown => {
        return parseResourceRoundName(name, AiResourceType.Host);
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBeNull();
    expect(timed.inMs).toBeLessThan(2000);
  });
});
