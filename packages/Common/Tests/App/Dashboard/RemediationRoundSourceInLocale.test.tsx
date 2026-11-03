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

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  getClusterRoundNameSnapshot,
  getResourceRoundNameSnapshot,
  REMEDIATION_ROUND_SENTENCES,
} from "../../../Types/AutoRemediation/RemediationRoundName";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { Translator } from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHO PROPOSED A FIX, IN THE READER'S LANGUAGE (#5589's follow-up).
 *
 * Under each fix's title the Remediation step says where it came from. A
 * round OneUptime AI ran on a cluster or a resource is named by the
 * server, in English ('AI remediation for cluster "prod-east"'), and that
 * name stood under the title on a German or Persian card. The step now
 * words the round from the facts its name carries - what it ran on, its
 * name, which round - in the reader's language, the name as data; a round
 * on a cluster deleted since reads as a cluster's; a rule keeps its own
 * name.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000023",
);
const CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000025";
const RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000024";
const RULE_ID: string = "0193c0de-8888-4aaa-8bbb-000000000028";

function suggestion(
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

function serve(row: AutoRemediationSuggestion): void {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: { new (): unknown };
  }): Promise<
    ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
  > => {
    if (args.modelType === AutoRemediationDecision) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: [row], count: 1, skip: 0, limit: 10 };
  }) as never);
}

async function sourceOf(row: AutoRemediationSuggestion): Promise<string> {
  serve(row);
  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );
  await screen.findByText("Restart checkout");

  return screen.getByTestId("remediation-fix-source").textContent || "";
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

describe("in German", () => {
  const german: Translator = dashboardTranslator("de");

  beforeEach(async () => {
    await inLanguage("de");
  });

  test("a cluster's round is German, the cluster's name as written", async () => {
    expect(
      await sourceOf(
        suggestion({
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 1),
        }),
      ),
    ).toBe(
      DE[REMEDIATION_ROUND_SENTENCES.cluster]!.replace("{{name}}", "prod-east"),
    );
  });

  test("a cluster's second round says which round", async () => {
    expect(
      await sourceOf(
        suggestion({
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: getClusterRoundNameSnapshot("prod-east", 2),
        }),
      ),
    ).toBe(
      DE[REMEDIATION_ROUND_SENTENCES.clusterRound]!.replace(
        "{{name}}",
        "prod-east",
      ).replace("{{round}}", "2"),
    );
  });

  test("a resource's round names its kind in German", async () => {
    expect(
      await sourceOf(
        suggestion({
          resourceId: new ObjectID(RESOURCE_ID),
          resourceType: AiResourceType.DockerHost,
          ruleNameSnapshot: getResourceRoundNameSnapshot(
            AiResourceType.DockerHost,
            "web-1",
            1,
          ),
        }),
      ),
    ).toBe(
      DE[REMEDIATION_ROUND_SENTENCES.resource]!.replace(
        "{{kind}}",
        german.translateTerm("Docker host", { inSentence: true }),
      ).replace("{{name}}", "web-1"),
    );
  });

  test("a round on a cluster deleted since still reads as a cluster's, never as a rule", async () => {
    const said: string = await sourceOf(
      suggestion({
        ruleNameSnapshot: getClusterRoundNameSnapshot("old-cluster", 1),
      }),
    );

    expect(said).toBe(
      DE[REMEDIATION_ROUND_SENTENCES.cluster]!.replace(
        "{{name}}",
        "old-cluster",
      ),
    );
    expect(said).not.toContain(DE["Rule: {{name}}"]!.replace("{{name}}", ""));
  });

  test("a rule is named by its own name, in the German sentence for a rule", async () => {
    expect(
      await sourceOf(
        suggestion({
          autoRemediationRuleId: new ObjectID(RULE_ID),
          ruleNameSnapshot: "Fix database incidents",
        }),
      ),
    ).toBe(DE["Rule: {{name}}"]!.replace("{{name}}", "Fix database incidents"));
  });

  test("a rule named like a cluster's round is still a rule while it has its rule", async () => {
    expect(
      await sourceOf(
        suggestion({
          autoRemediationRuleId: new ObjectID(RULE_ID),
          ruleNameSnapshot: getClusterRoundNameSnapshot("prod", 1),
        }),
      ),
    ).toBe(
      DE["Rule: {{name}}"]!.replace(
        "{{name}}",
        getClusterRoundNameSnapshot("prod", 1),
      ),
    );
  });

  test("a round name the step cannot read is shown as written", async () => {
    expect(
      await sourceOf(
        suggestion({
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: "AI remediation for cluster",
        }),
      ),
    ).toBe("AI remediation for cluster");
  });
});

describe("in Persian", () => {
  beforeEach(async () => {
    await inLanguage("fa");
  });

  test("a resource's round reads right to left, its name set apart", async () => {
    const persian: Translator = dashboardTranslator("fa");
    const said: string = await sourceOf(
      suggestion({
        resourceId: new ObjectID(RESOURCE_ID),
        resourceType: AiResourceType.Host,
        ruleNameSnapshot: getResourceRoundNameSnapshot(
          AiResourceType.Host,
          "web-2",
          2,
        ),
      }),
    );

    expect(said).toContain(isolated("web-2"));
    expect(withoutIsolateMarks(said)).toBe(
      FA[REMEDIATION_ROUND_SENTENCES.resourceRound]!.replace(
        "{{kind}}",
        persian.translateTerm("host", { inSentence: true }),
      )
        .replace("{{name}}", "web-2")
        .replace("{{round}}", "۲"),
    );
  });
});
