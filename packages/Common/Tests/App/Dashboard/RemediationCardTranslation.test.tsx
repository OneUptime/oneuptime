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
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
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

import RemediationSuggestionCard from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard";
import { REMEDIATION_DECISION_STATUS_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The Remediation card in the reader's language, from the shipped locale
 * files: the status pill, the sentence of each line, the "Why" and "What to
 * do" of a blocked path, the links and the heading above fixes. Japanese,
 * which translates the card's sentences and labels.
 *
 * The expected words are read from ja.json, so a translator rewording one
 * does not break this; what breaks it is a word on the card that is not
 * looked up at all.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000013",
);
const CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000015";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const JA: Record<string, string> = readLocale("ja");

const REMEDIATION_OFF_SENTENCE: string =
  '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.';

// A word the card shows, as ja.json words it, which must be Japanese.
function japanese(key: string): string {
  const value: string | undefined = JA[key];

  expect({ key, translated: Boolean(value) && value !== key }).toEqual({
    key,
    translated: true,
  });

  return value!;
}

function serve(data: {
  suggestions: Array<AutoRemediationSuggestion>;
  entries: Array<JSONObject>;
}): void {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: { new (): unknown };
  }): Promise<
    ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
  > => {
    if (args.modelType === AutoRemediationDecision) {
      const rows: Array<AutoRemediationDecision> = [
        Object.assign(new AutoRemediationDecision(), {
          stage: "Evaluated",
          createdAt: new Date("2026-10-05T10:00:00Z"),
          entries: data.entries,
        }),
      ];
      return { data: rows, count: rows.length, skip: 0, limit: 5 };
    }

    return {
      data: data.suggestions,
      count: data.suggestions.length,
      skip: 0,
      limit: 10,
    };
  }) as never);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "ja",
    fallbackLng: "ja",
    resources: { ja: { translation: JA } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
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

describe("the Remediation card in Japanese", () => {
  test("the screenshot's card: every sentence and link is the reader's, and the pill is looked up", async () => {
    serve({
      suggestions: [],
      entries: [{ lane: "Project", reason: "RemediationOff" }],
    });

    render(
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
    );

    const line: HTMLElement = await screen.findByTestId(
      "remediation-decision-line",
    );

    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      japanese("Remediation"),
    );
    expect(
      within(line).getByTestId("remediation-decision-text"),
    ).toHaveTextContent(japanese(REMEDIATION_OFF_SENTENCE));
    expect(
      within(line).getByRole("link", {
        name: japanese("Incident AI settings"),
      }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/incidents/ai/settings`);
    // Whatever ja.json holds for it: the pill's words are looked up.
    expect(screen.getByTestId("remediation-decision-status")).toHaveTextContent(
      JA[REMEDIATION_DECISION_STATUS_TEXT.info]!,
    );
  });

  test("a blocked cluster: the pill, why, what to do and the link are the reader's", async () => {
    serve({
      suggestions: [],
      entries: [
        {
          lane: "KubernetesCluster",
          reason: "ClusterNotReady",
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterName: "prod-east",
          gaps: [
            {
              code: "remediation_write_access_missing",
              title: "The AI agent is read-only",
              nextStep:
                "Upgrade the chart with aiAgent.remediation.enabled=true.",
            },
          ],
        },
      ],
    });

    render(
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
    );

    const line: HTMLElement = await screen.findByTestId(
      "remediation-decision-line",
    );

    expect(screen.getByTestId("remediation-decision-status")).toHaveTextContent(
      japanese(REMEDIATION_DECISION_STATUS_TEXT.attention),
    );
    expect(
      within(line).getByTestId("remediation-decision-why").querySelector("dt"),
    ).toHaveTextContent(japanese("Why:"));
    expect(
      within(line)
        .getByTestId("remediation-decision-what-to-do")
        .querySelector("dt"),
    ).toHaveTextContent(japanese("What to do:"));
    // The gap itself is the server's English, as on the AI agent page.
    expect(
      within(line).getByTestId("remediation-decision-why").querySelector("dd"),
    ).toHaveTextContent("The AI agent is read-only");
    expect(
      within(line).getByRole("link", {
        name: japanese("Open the cluster's AI agent page"),
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`,
    );
  });

  test("above fixes, the lines' heading is looked up too", async () => {
    serve({
      suggestions: [
        Object.assign(new AutoRemediationSuggestion(), {
          _id: "0193c0de-6666-4aaa-8bbb-000000000016",
          status: AutoRemediationSuggestionStatus.Suggested,
          ruleNameSnapshot: "Restart checkout",
          runbookNameSnapshot: "Restart the checkout pods",
          createdAt: new Date("2026-10-05T10:00:00Z"),
        }),
      ],
      entries: [
        {
          lane: "Rule",
          reason: "RuleRunbookProposed",
          ruleName: "Restart checkout",
          runbookName: "Restart the checkout pods",
        },
      ],
    });

    render(
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
    );

    const heading: HTMLElement = await screen.findByTestId(
      "remediation-decision-heading",
    );
    expect(heading).toHaveTextContent(JA["What auto-remediation did"]!);
    expect(
      screen.queryByTestId("remediation-decision-status"),
    ).not.toBeInTheDocument();
  });
});
