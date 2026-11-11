import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import {
  REMEDIATION_FIX_SOURCE_COPY,
  REMEDIATION_FIX_TITLE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixHeader";
import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import { REMEDIATION_STEP_SUMMARY_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepSummary";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  getClusterRoundNameSnapshot,
  getResourceRoundNameSnapshot,
} from "../../../Types/AutoRemediation/RemediationRoundName";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { Translator } from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHAT A FIX IS AND WHO PROPOSED IT, IN THE READER'S LANGUAGE (#5589's
 * follow-up, issue #6860).
 *
 * A round OneUptime AI runs on a cluster or a resource is named by the
 * server, in English ('AI remediation for cluster "prod-east"'), and that
 * name stood under "AI kubectl fix" on a German or Persian card. The fix is
 * now named for where it works, from the facts the round's name carries -
 * what it ran on, its name, which round - in the reader's language, the
 * name as data ('Fix on cluster "prod-east"'); a round on a cluster
 * deleted since is still a cluster's. Under it, why OneUptime AI tried it:
 * the AI rule that matched, by its own name, or OneUptime AI itself. The
 * step opens with what came of it, in the reader's language too.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000023",
);
const CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000025";
const RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000024";
const RULE_ID: string = "0193c0de-8888-4aaa-8bbb-000000000028";
const AGENT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000027";

function runbookFix(
  overrides: Partial<Record<string, unknown>>,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000026",
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    runbookNameSnapshot: "Restart checkout",
    createdAt: new Date("2026-10-20T10:00:00Z"),
    ...overrides,
  });
}

// A change on a cluster, as its round planned it; named, or not.
function kubectlCommand(clusterName?: string): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: CLUSTER_ID,
    ...(clusterName ? { kubernetesClusterNameSnapshot: clusterName } : {}),
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "Pods hold a stale config.",
    expectedEffect: "Fresh pods pick up the config.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function resourceCommand(
  resourceType: AiResourceType,
  resourceName: string,
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Resource AI agent",
    resourceType,
    resourceId: RESOURCE_ID,
    resourceNameSnapshot: resourceName,
    resourceCommandTier: "SafeWrite",
    command: "systemctl restart web",
    timeoutInMs: 60000,
    rationale: "The service hangs.",
    expectedEffect: "It answers again.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function roundFix(
  commands: Array<JSONObject>,
  overrides: Partial<Record<string, unknown>>,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000036",
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands } as JSONObject,
    createdAt: new Date("2026-10-20T10:00:00Z"),
    ...overrides,
  });
}

function serve(
  rows: Array<AutoRemediationSuggestion>,
  entries: Array<JSONObject> = [],
): void {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: { new (): unknown };
  }): Promise<
    ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
  > => {
    if (args.modelType === AutoRemediationDecision) {
      const decisions: Array<AutoRemediationDecision> =
        entries.length > 0
          ? [
              Object.assign(new AutoRemediationDecision(), {
                stage: "Evaluated",
                createdAt: new Date("2026-10-20T10:00:00Z"),
                entries,
              }),
            ]
          : [];

      return { data: decisions, count: decisions.length, skip: 0, limit: 5 };
    }

    return { data: rows, count: rows.length, skip: 0, limit: 10 };
  }) as never);
}

interface FixHeader {
  title: string;
  source: string;
}

async function renderStep(
  rows: Array<AutoRemediationSuggestion>,
  entries: Array<JSONObject> = [],
): Promise<void> {
  serve(rows, entries);
  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );
  await screen.findAllByTestId("remediation-fix");
}

async function headerOf(
  row: AutoRemediationSuggestion,
  entries: Array<JSONObject> = [],
): Promise<FixHeader> {
  await renderStep([row], entries);

  return {
    title: screen.getByTestId("remediation-fix-title").textContent || "",
    source: screen.getByTestId("remediation-fix-source").textContent || "",
  };
}

function summaryText(): string {
  return screen.getByTestId("remediation-step-summary").textContent || "";
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: { de: { translation: DE }, fa: { translation: FA } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

// Every sentence the step's summary and its fixes' names are made of.
const STEP_COPY_KEYS: Array<string> = [
  ...Object.values(REMEDIATION_FIX_TITLE_COPY),
  ...Object.values(REMEDIATION_FIX_SOURCE_COPY),
  ...Object.values(REMEDIATION_STEP_SUMMARY_COPY).flatMap(
    (words: string | { one: string; other: string }): Array<string> => {
      return typeof words === "string"
        ? [words]
        : [words.other, `${words.other}_one`];
    },
  ),
];

describe("in every Dashboard language", () => {
  test("each sentence is worded in the reader's language, with the values it is given", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of STEP_COPY_KEYS) {
        if (!isWordedInDashboardLocale(key, language)) {
          unworded.push(`${language}: ${key}`);
          continue;
        }

        /*
         * A "one" form says one, and may leave the count out; every other
         * form fills the values the English does.
         */
        const expected: Array<string> = placeholdersOf(english[key]!);
        const said: Array<string> = placeholdersOf(words[key]!);

        if (key.endsWith("_one")) {
          expect(
            said.filter((name: string) => {
              return !expected.includes(name);
            }),
          ).toEqual([]);
        } else {
          expect([language, key, said]).toEqual([language, key, expected]);
        }
      }
    }

    expect(unworded).toEqual([]);
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(16);
  });
});

describe("in German", () => {
  const german: Translator = dashboardTranslator("de");
  const fromOneUptimeAi: string = DE[REMEDIATION_FIX_SOURCE_COPY.oneUptimeAi]!;
  const fromRule: (name: string) => string = (name: string): string => {
    return DE[REMEDIATION_FIX_SOURCE_COPY.rule]!.replace("{{name}}", name);
  };

  beforeEach(async () => {
    await inLanguage("de");
  });

  test("a cluster's round is named for its cluster in German, the name as written, from OneUptime AI", async () => {
    const header: FixHeader = await headerOf(
      roundFix([kubectlCommand("prod-east")], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 1),
      }),
    );

    expect(header.title).toBe(
      DE[REMEDIATION_FIX_TITLE_COPY.cluster]!.replace("{{name}}", "prod-east"),
    );
    expect(header.source).toBe(fromOneUptimeAi);
  });

  test("a cluster's second round says which round", async () => {
    const header: FixHeader = await headerOf(
      roundFix([kubectlCommand("prod-east")], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 2),
      }),
    );

    expect(header.title).toBe(
      DE[REMEDIATION_FIX_TITLE_COPY.clusterRound]!.replace(
        "{{name}}",
        "prod-east",
      ).replace("{{round}}", "2"),
    );
  });

  test("the AI rule that matched is named under the round, by its own name", async () => {
    const header: FixHeader = await headerOf(
      roundFix([kubectlCommand("prod-east")], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 1),
      }),
      [
        {
          lane: "KubernetesCluster",
          reason: "ClusterRoundStarted",
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterName: "prod-east",
        },
        { lane: "Rule", reason: "RuleMatchedAiFix", ruleName: "All alerts" },
      ],
    );

    expect(header.source).toBe(fromRule("All alerts"));
    // The lines that said so are the fix's own words now: none is drawn.
    expect(screen.queryByTestId("remediation-decision")).toBeNull();
  });

  test("a resource's round names its kind in German", async () => {
    const header: FixHeader = await headerOf(
      roundFix([resourceCommand(AiResourceType.DockerHost, "web-1")], {
        resourceId: new ObjectID(RESOURCE_ID),
        resourceType: AiResourceType.DockerHost,
        ruleNameSnapshot: getResourceRoundNameSnapshot(
          AiResourceType.DockerHost,
          "web-1",
          1,
        ),
      }),
    );

    expect(header.title).toBe(
      DE[REMEDIATION_FIX_TITLE_COPY.resource]!.replace(
        "{{kind}}",
        german.translateTerm("Docker host", { inSentence: true }),
      ).replace("{{name}}", "web-1"),
    );
    expect(header.source).toBe(fromOneUptimeAi);
  });

  test("a round on a cluster deleted since is still a cluster's, never a rule", async () => {
    const header: FixHeader = await headerOf(
      roundFix([kubectlCommand()], {
        ruleNameSnapshot: getClusterRoundNameSnapshot("old-cluster", 1),
      }),
    );

    expect(header.title).toBe(
      DE[REMEDIATION_FIX_TITLE_COPY.cluster]!.replace(
        "{{name}}",
        "old-cluster",
      ),
    );
    expect(header.source).toBe(fromOneUptimeAi);
    expect(header.source).not.toContain("old-cluster");
  });

  test("a rule's runbook is named for the runbook, and the rule by its own name", async () => {
    const header: FixHeader = await headerOf(
      runbookFix({
        autoRemediationRuleId: new ObjectID(RULE_ID),
        ruleNameSnapshot: "Fix database incidents",
      }),
    );

    expect(header.title).toBe(
      DE[REMEDIATION_FIX_TITLE_COPY.runbook]!.replace(
        "{{name}}",
        "Restart checkout",
      ),
    );
    expect(header.source).toBe(fromRule("Fix database incidents"));
  });

  test("a rule named like a cluster's round is still a rule while it has its rule", async () => {
    const header: FixHeader = await headerOf(
      runbookFix({
        autoRemediationRuleId: new ObjectID(RULE_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 1),
      }),
    );

    expect(header.source).toBe(
      fromRule(getClusterRoundNameSnapshot("prod", 1)),
    );
  });

  test("a round whose name cannot be read is named for the cluster its changes run on, and its English name is never shown", async () => {
    const header: FixHeader = await headerOf(
      roundFix([kubectlCommand("prod-east")], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: "AI remediation for cluster",
      }),
    );

    expect(header.title).toBe(
      DE[REMEDIATION_FIX_TITLE_COPY.cluster]!.replace("{{name}}", "prod-east"),
    );
    expect(
      screen.getByTestId("ai-card-step-remediation"),
    ).not.toHaveTextContent("AI remediation");
  });

  test("with nothing that names its cluster, it is a Kubernetes cluster's", async () => {
    const header: FixHeader = await headerOf(
      roundFix([kubectlCommand()], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: "AI remediation for cluster",
      }),
    );

    expect(header.title).toBe(DE[REMEDIATION_FIX_TITLE_COPY.anyCluster]);
  });

  test("the step opens with what waits for the reader, in German", async () => {
    await renderStep([
      roundFix([kubectlCommand("prod-east")], {
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 1),
      }),
    ]);

    expect(summaryText()).toBe(
      DE[
        `${REMEDIATION_STEP_SUMMARY_COPY.needsYourApproval.other}_one`
      ]!.replace(
        "{{signal}}",
        german.translateTerm("Incident", { inSentence: true }),
      ),
    );
  });

  test("two fixes that wait for the reader are counted, in German", async () => {
    await renderStep([
      roundFix([kubectlCommand("prod-east")], {
        _id: "0193c0de-6666-4aaa-8bbb-000000000046",
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 1),
      }),
      runbookFix({
        autoRemediationRuleId: new ObjectID(RULE_ID),
        ruleNameSnapshot: "Fix database incidents",
      }),
    ]);

    expect(summaryText()).toBe(
      DE[REMEDIATION_STEP_SUMMARY_COPY.needsYourApproval.other]!.replace(
        "{{count}}",
        "2",
      ).replace(
        "{{signal}}",
        german.translateTerm("Incident", { inSentence: true }),
      ),
    );
  });
});

describe("in Persian", () => {
  const persian: Translator = dashboardTranslator("fa");

  beforeEach(async () => {
    await inLanguage("fa");
  });

  test("a resource's second round reads right to left, its name set apart", async () => {
    const header: FixHeader = await headerOf(
      roundFix([resourceCommand(AiResourceType.Host, "web-2")], {
        resourceId: new ObjectID(RESOURCE_ID),
        resourceType: AiResourceType.Host,
        ruleNameSnapshot: getResourceRoundNameSnapshot(
          AiResourceType.Host,
          "web-2",
          2,
        ),
      }),
    );

    expect(header.title).toContain(isolated("web-2"));
    expect(withoutIsolateMarks(header.title)).toBe(
      FA[REMEDIATION_FIX_TITLE_COPY.resourceRound]!.replace(
        "{{kind}}",
        persian.translateTerm("host", { inSentence: true }),
      )
        .replace("{{name}}", "web-2")
        .replace("{{round}}", "۲"),
    );
    expect(header.source).toBe(FA[REMEDIATION_FIX_SOURCE_COPY.oneUptimeAi]);
  });

  test("an English rule name keeps its place in the Persian sentence", async () => {
    const header: FixHeader = await headerOf(
      runbookFix({
        autoRemediationRuleId: new ObjectID(RULE_ID),
        ruleNameSnapshot: "Fix database incidents",
      }),
    );

    expect(header.source).toContain(isolated("Fix database incidents"));
    expect(withoutIsolateMarks(header.source)).toBe(
      FA[REMEDIATION_FIX_SOURCE_COPY.rule]!.replace(
        "{{name}}",
        "Fix database incidents",
      ),
    );
  });

  test("the step says in Persian that OneUptime AI found no fix", async () => {
    await renderStep([
      roundFix([], {
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 1),
      }),
    ]);

    expect(withoutIsolateMarks(summaryText())).toBe(
      FA[REMEDIATION_STEP_SUMMARY_COPY.noFix]!.replace(
        "{{signal}}",
        persian.translateTerm("Incident", { inSentence: true }),
      ),
    );
  });
});
