import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * DATA SECURITY > SETTINGS > ONEUPTIME AI (#10365): what OneUptime AI sees.
 *
 *   - What OneUptime AI Sees lists what no feature ever sends, then every
 *     feature of the catalog, in its order: what it sends and never sends,
 *     what starts it and whether it runs on its own, what is kept of it -
 *     and the model it runs on, named only to who may read the project's
 *     LLM providers, with whose it is and whether it is self-hosted.
 *   - With Enable AI off the page says nothing is sent, and still says
 *     what each feature would send.
 *   - Show an Example reads the example only when asked: the issue it is
 *     for, the system message, the data, what Fix with AI would ask, and
 *     the AI context by its length - or why there is none to show.
 *   - A read that fails says what failed, and Try again reads again.
 *   - Its buttons open the AI switches and the LLM providers.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import DataSecurityAiSettingsPage, {
  AI_SETTINGS_EXAMPLE_TEST_ID,
  AI_SETTINGS_FEATURES_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/AI";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  DATA_SECURITY_AI_FEATURES,
  DATA_SECURITY_AI_LOGS_KEEP_PROVIDER_ERRORS,
  DataSecurityAiFeature,
  DataSecurityAiFeatureInfo,
  NEVER_SENT_TO_ONEUPTIME_AI,
} from "../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  DataSecurityAiExampleUnavailableReason,
  DataSecurityAiInputResponse,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

configure({ asyncUtilTimeout: 15000 });

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/data-security/settings/ai`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(PAGE_PATH),
  currentProject: null,
  hasPaymentMethod: true,
};

const ISSUE_ID: string = "10365000-0000-4000-8000-0000000000e1";

// The project's own Ollama, and the server's bundled vLLM for the coding agent.
const ANSWER: DataSecurityAiInputResponse = {
  isAiEnabled: true,
  canReadModels: true,
  projectModel: {
    name: "Our Ollama",
    llmType: "Ollama",
    modelName: "llama3.1:70b",
    isProjectProvider: true,
    isSelfHosted: true,
  },
  codeAgentModel: {
    name: "OneUptime vLLM",
    llmType: "OpenAICompatible",
    modelName: "qwen2.5-coder",
    isProjectProvider: false,
    isSelfHosted: true,
  },
  example: null,
};

const EXAMPLE: NonNullable<DataSecurityAiInputResponse["example"]> = {
  dataSecurityIssueId: ISSUE_ID,
  issueTitle: "Anyone on the internet can read acme-card-exports",
  system: "You explain a data security issue to the owner of the store.",
  data: {
    issue: { checkId: "public-read", severity: "Critical" },
    store: { name: "acme-card-exports", kind: "AwsS3Bucket" },
  },
  fixRequest:
    "Fix this data security issue in the infrastructure code (Terraform, CloudFormation, Bicep or similar).",
  aiContextCharacterCount: 1234,
};

let getAiInput: SpyInstance<typeof DataSecurityApi.getAiInput>;

function answerWith(
  overrides: Partial<DataSecurityAiInputResponse> = {},
): void {
  getAiInput.mockResolvedValue({ ...ANSWER, ...overrides });
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[PAGE_PATH]}>
        <DataSecurityAiSettingsPage {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
}

function featureSection(feature: DataSecurityAiFeature): HTMLElement {
  return screen.getByTestId(`data-security-ai-feature-${feature}`);
}

async function modelsShown(): Promise<void> {
  await waitFor(() => {
    expect(getAiInput).toHaveBeenCalled();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  goTo(PAGE_PATH);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  getAiInput = jest.spyOn(DataSecurityApi, "getAiInput");
  answerWith();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("What OneUptime AI Sees", () => {
  test("says what no feature ever sends, then every feature in the catalog's order", async () => {
    await renderPage();
    await modelsShown();

    const card: HTMLElement = screen.getByTestId(AI_SETTINGS_FEATURES_TEST_ID);

    expect(within(card).getByText("Never sent, by any feature")).toBeVisible();

    for (const item of NEVER_SENT_TO_ONEUPTIME_AI) {
      expect(within(card).getByText(item)).toBeInTheDocument();
    }

    expect(
      within(card)
        .getAllByRole("heading", { level: 3 })
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
    ).toEqual([
      "Never sent, by any feature",
      ...DATA_SECURITY_AI_FEATURES.map((info: DataSecurityAiFeatureInfo) => {
        return info.title;
      }),
    ]);
  });

  test.each(
    DATA_SECURITY_AI_FEATURES.map((info: DataSecurityAiFeatureInfo) => {
      return [info.feature, info] as const;
    }),
  )(
    "%s: what it sends and never sends, what starts it, and what is kept",
    async (feature: DataSecurityAiFeature, info: DataSecurityAiFeatureInfo) => {
      await renderPage();
      await modelsShown();

      const section: HTMLElement = featureSection(feature);

      for (const line of [
        ...info.sends,
        ...info.neverSends,
        info.startedBy,
        info.keeps,
      ]) {
        expect(within(section).getByText(line)).toBeInTheDocument();
      }

      expect(
        within(section).getByText(
          info.runsOnItsOwn ? "Runs on its own" : "Only when a person asks",
        ),
      ).toBeInTheDocument();
      expect(
        within(section).queryAllByText(
          DATA_SECURITY_AI_LOGS_KEEP_PROVIDER_ERRORS,
        ),
      ).toHaveLength(info.keepsProviderErrors ? 1 : 0);
    },
  );

  test("names the model each feature runs on, whose it is, and that it is self-hosted", async () => {
    await renderPage();

    await waitFor(() => {
      expect(
        within(featureSection(DataSecurityAiFeature.ExplainIssue)).getByText(
          /Our Ollama.*llama3\.1:70b/,
        ),
      ).toBeInTheDocument();
    });

    for (const feature of [
      DataSecurityAiFeature.ExplainIssue,
      DataSecurityAiFeature.SuggestFieldTypes,
      DataSecurityAiFeature.AskAi,
    ]) {
      const section: HTMLElement = featureSection(feature);

      expect(within(section).getByText(/Our Ollama/)).toBeInTheDocument();
      expect(within(section).getByText("Your project's")).toBeInTheDocument();
      expect(within(section).getByText("Self-hosted")).toBeInTheDocument();
    }

    const fix: HTMLElement = featureSection(DataSecurityAiFeature.FixIssue);

    expect(
      within(fix).getByText(/OneUptime vLLM.*qwen2\.5-coder/),
    ).toBeVisible();
    expect(within(fix).getByText("This server's")).toBeInTheDocument();
    expect(within(fix).queryByText(/Our Ollama/)).not.toBeInTheDocument();
  });

  test("names no model to someone who may not read the LLM providers, and says who can see it", async () => {
    answerWith({
      canReadModels: false,
      projectModel: null,
      codeAgentModel: null,
    });

    await renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByText(
          "Who may read this project's LLM providers sees which one it is.",
        ),
      ).toHaveLength(DATA_SECURITY_AI_FEATURES.length);
    });
    expect(screen.queryByText("Self-hosted")).not.toBeInTheDocument();
  });

  test("says when no LLM provider is set up yet", async () => {
    answerWith({ projectModel: null, codeAgentModel: null });

    await renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByText(
          "No LLM provider is set up yet, so nothing can be sent.",
        ),
      ).toHaveLength(DATA_SECURITY_AI_FEATURES.length);
    });
  });

  test("with Enable AI off, says nothing is sent, and still what each feature would send", async () => {
    answerWith({ isAiEnabled: false });

    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Enable AI is off for this project, so OneUptime AI sends nothing. This is what each feature sends once it is on.",
        ),
      ).toBeInTheDocument();
    });

    for (const info of DATA_SECURITY_AI_FEATURES) {
      expect(
        within(featureSection(info.feature)).getByText(info.sends[0]!),
      ).toBeInTheDocument();
    }
  });

  test("a read that fails says why, and Try again reads again", async () => {
    getAiInput.mockRejectedValueOnce(new Error("The server is busy."));

    await renderPage();

    expect(
      await within(screen.getByTestId(AI_SETTINGS_FEATURES_TEST_ID)).findByText(
        /The server is busy\./,
      ),
    ).toBeInTheDocument();
    // What every feature sends does not need the server.
    expect(
      within(featureSection(DataSecurityAiFeature.ExplainIssue)).getByText(
        DATA_SECURITY_AI_FEATURES[0]!.sends[0]!,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(
        within(featureSection(DataSecurityAiFeature.ExplainIssue)).getByText(
          /Our Ollama/,
        ),
      ).toBeInTheDocument();
    });
    expect(getAiInput).toHaveBeenCalledTimes(2);
  });

  test("opens the AI switches and the LLM providers", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    await renderPage();
    await modelsShown();

    fireEvent.click(screen.getByRole("button", { name: "AI Switches" }));
    fireEvent.click(screen.getByRole("button", { name: "LLM Providers" }));

    expect(
      navigate.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as Route).toString();
      }),
    ).toEqual([
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_AI_FEATURES] as Route,
      ).toString(),
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
      ).toString(),
    ]);
  });
});

describe("Show an Example", () => {
  test("reads the example only when asked, and shows exactly what would be sent", async () => {
    await renderPage();
    await modelsShown();

    // The page's own read asks for no example.
    expect(getAiInput.mock.calls).toEqual([[]]);
    expect(
      screen.queryByTestId(AI_SETTINGS_EXAMPLE_TEST_ID),
    ).not.toBeInTheDocument();

    getAiInput.mockResolvedValueOnce({ ...ANSWER, example: EXAMPLE });
    fireEvent.click(screen.getByRole("button", { name: "Show an Example" }));

    const example: HTMLElement = await screen.findByTestId(
      AI_SETTINGS_EXAMPLE_TEST_ID,
    );

    expect(getAiInput.mock.calls[1]).toEqual([{ withExample: true }]);
    expect(
      within(example).getByRole("link", { name: EXAMPLE.issueTitle }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/data-security/issues/${ISSUE_ID}`),
    );
    expect(example).toHaveTextContent(EXAMPLE.system);
    expect(example).toHaveTextContent('"checkId": "public-read"');
    expect(example).toHaveTextContent(EXAMPLE.fixRequest);
    expect(example).toHaveTextContent(
      /Your project's AI context comes first in the system message: 1,?234 characters/,
    );
    // Asked once, the button is gone.
    expect(
      screen.queryByRole("button", { name: "Show an Example" }),
    ).not.toBeInTheDocument();
  });

  test("says nothing of an AI context the project does not have", async () => {
    await renderPage();
    await modelsShown();

    getAiInput.mockResolvedValueOnce({
      ...ANSWER,
      example: { ...EXAMPLE, aiContextCharacterCount: 0 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show an Example" }));

    const example: HTMLElement = await screen.findByTestId(
      AI_SETTINGS_EXAMPLE_TEST_ID,
    );

    expect(example).not.toHaveTextContent(/AI context/);
  });

  test.each([
    [
      DataSecurityAiExampleUnavailableReason.NoIssue,
      "No open issue to show an example for yet. One shows here once a check finds an issue.",
    ],
    [
      DataSecurityAiExampleUnavailableReason.NoPermission,
      "Seeing an example takes permission to read this project's Data Security issues.",
    ],
  ])(
    "with no example to show (%s), says why",
    async (
      reason: DataSecurityAiExampleUnavailableReason,
      sentence: string,
    ) => {
      await renderPage();
      await modelsShown();

      getAiInput.mockResolvedValueOnce({
        ...ANSWER,
        example: null,
        exampleUnavailableReason: reason,
      });
      fireEvent.click(screen.getByRole("button", { name: "Show an Example" }));

      expect(await screen.findByText(sentence)).toBeInTheDocument();
      expect(
        screen.queryByTestId(AI_SETTINGS_EXAMPLE_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("an example that fails to load says why, and Try again asks again", async () => {
    await renderPage();
    await modelsShown();

    getAiInput.mockRejectedValueOnce(new Error("The server is busy."));
    fireEvent.click(screen.getByRole("button", { name: "Show an Example" }));

    expect(await screen.findByText(/The server is busy\./)).toBeInTheDocument();

    getAiInput.mockResolvedValueOnce({ ...ANSWER, example: EXAMPLE });
    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByTestId(AI_SETTINGS_EXAMPLE_TEST_ID),
    ).toBeInTheDocument();
    expect(getAiInput.mock.calls.slice(1)).toEqual([
      [{ withExample: true }],
      [{ withExample: true }],
    ]);
  });
});
