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
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import IssueAiCard, {
  ISSUE_AI_CARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueAiCard";
import DataSecurityAiOverviewLine, {
  DATA_SECURITY_AI_OVERVIEW_LINE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityAiOverviewLine";
import {
  DATA_SECURITY_AI_SKIP_SENTENCES,
  DataSecurityAiPageCopy,
  IssueAiCardCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityAiCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityAiDecision from "../../../Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssueFeed from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
} from "../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiIssueSkipReason } from "../../../Types/DataSecurity/DataSecurityAiDecision";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

// The analysis as the viewer is handed it.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

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

/*
 * ONEUPTIME AI ON AN ISSUE AND ON THE OVERVIEW (#10364), rendered for real
 * with only the network stubbed:
 *   - the issue's AI card shows its newest analysis, what OneUptime AI
 *     proposed for it with where each stands and the buttons that apply,
 *     and why it left the issue alone - and is not there at all when
 *     OneUptime AI has nothing to say;
 *   - the Overview's line says what it contained this week and what waits,
 *     and is not there while both are none or cannot be read.
 */

configure({ asyncUtilTimeout: 15000 });

const ISSUE_ID: ObjectID = new ObjectID("7d7d7d7d-0000-4000-8000-000000000007");

let feeds: Array<DataSecurityIssueFeed> = [];
let proposals: Array<DataSecurityAiProposal> = [];
let decisions: Array<DataSecurityAiDecision> = [];

function proposal(values: Record<string, unknown>): DataSecurityAiProposal {
  return Object.assign(new DataSecurityAiProposal(), {
    dataSecurityIssueId: ISSUE_ID,
    work: DataSecurityAiWork.Contain,
    ...values,
  });
}

beforeEach(() => {
  feeds = [];
  proposals = [];
  decisions = [];

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (data: unknown): Promise<ListResult<BaseModel>> => {
        const modelType: unknown = (data as { modelType: unknown }).modelType;
        const rows: Array<BaseModel> =
          modelType === DataSecurityIssueFeed
            ? feeds
            : modelType === DataSecurityAiProposal
              ? proposals
              : modelType === DataSecurityAiDecision
                ? decisions
                : [];

        return { data: rows, count: rows.length, skip: 0, limit: 10 };
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function openCard(hideAnalysis?: boolean): Promise<void> {
  render(
    <MemoryRouter>
      <IssueAiCard issueId={ISSUE_ID} hideAnalysis={hideAnalysis} />
    </MemoryRouter>,
  );
  await settle();
}

describe("an issue's OneUptime AI card", () => {
  test("shows the analysis, and each proposal with where it stands and its buttons", async () => {
    feeds = [
      Object.assign(new DataSecurityIssueFeed(), {
        moreInformationInMarkdown:
          "Anyone can read the bucket. Block public access.",
      }),
    ];
    proposals = [
      proposal({
        _id: "4e4e4e4e-0000-4000-8000-000000000001",
        title: "Scrub Card number in log.body of payments · Logs",
        status: DataSecurityAiProposalStatus.Proposed,
      }),
      proposal({
        _id: "4e4e4e4e-0000-4000-8000-000000000002",
        title: "Scrub Email address in log.body of payments · Logs",
        status: DataSecurityAiProposalStatus.AppliedWithoutAsking,
      }),
    ];

    await openCard();

    const card: HTMLElement = await screen.findByTestId(ISSUE_AI_CARD_TEST_ID);

    expect(within(card).getByTestId("markdown")).toHaveTextContent(
      "Anyone can read the bucket. Block public access.",
    );
    expect(card).toHaveTextContent(IssueAiCardCopy.proposals);
    expect(card).toHaveTextContent("Waiting for you");
    expect(card).toHaveTextContent("Done by AI");
    expect(
      within(card).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", {
        name: DataSecurityAiPageCopy.dismiss,
      }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: DataSecurityAiPageCopy.undo }),
    ).toBeInTheDocument();
  });

  test("leaves the analysis to the explanation a person just asked for", async () => {
    feeds = [
      Object.assign(new DataSecurityIssueFeed(), {
        moreInformationInMarkdown: "An older analysis.",
      }),
    ];
    proposals = [
      proposal({
        _id: "4e4e4e4e-0000-4000-8000-000000000003",
        title: "Scrub Card number in log.body of payments · Logs",
        status: DataSecurityAiProposalStatus.Proposed,
      }),
    ];

    await openCard(true);

    const card: HTMLElement = await screen.findByTestId(ISSUE_AI_CARD_TEST_ID);

    expect(within(card).queryByTestId("markdown")).not.toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Scrub Card number in log.body of payments · Logs",
    );
  });

  test("says why OneUptime AI left the issue alone", async () => {
    decisions = [
      Object.assign(new DataSecurityAiDecision(), {
        didAct: false,
        skipReason: DataSecurityAiIssueSkipReason.NoRuleMatched,
      }),
    ];

    await openCard();

    expect(await screen.findByTestId(ISSUE_AI_CARD_TEST_ID)).toHaveTextContent(
      `${IssueAiCardCopy.whyNot}: ${DATA_SECURITY_AI_SKIP_SENTENCES[DataSecurityAiIssueSkipReason.NoRuleMatched]}`,
    );
  });

  test("is not there when OneUptime AI has nothing to say, or may not be read", async () => {
    await openCard();

    expect(screen.queryByTestId(ISSUE_AI_CARD_TEST_ID)).not.toBeInTheDocument();

    cleanup();
    jest.spyOn(ModelAPI, "getList").mockRejectedValue(new Error("Forbidden"));

    await openCard();

    expect(screen.queryByTestId(ISSUE_AI_CARD_TEST_ID)).not.toBeInTheDocument();
  });
});

describe("the Overview's line about OneUptime AI", () => {
  let counts: { contained: number; waiting: number };

  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/data-security`);
    counts = { contained: 4, waiting: 3 };

    jest
      .spyOn(ModelAPI, "count")
      .mockImplementation(async (data: unknown): Promise<number> => {
        const query: Record<string, unknown> =
          (data as { query: Record<string, unknown> }).query || {};

        return query["status"] === DataSecurityAiProposalStatus.Proposed
          ? counts.waiting
          : counts.contained;
      });
  });

  async function openLine(): Promise<void> {
    render(
      <MemoryRouter>
        <DataSecurityAiOverviewLine />
      </MemoryRouter>,
    );
    await settle();
  }

  test("says what it contained this week and what waits, with the way to Data Security → AI", async () => {
    await openLine();

    const line: HTMLElement = await screen.findByTestId(
      DATA_SECURITY_AI_OVERVIEW_LINE_TEST_ID,
    );

    expect(line).toHaveTextContent(
      "OneUptime AI contained 4 leaks this week. 3 proposals wait for you.",
    );
    expect(within(line).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/data-security/ai`,
    );
  });

  test("says one in the singular", async () => {
    counts = { contained: 0, waiting: 1 };

    await openLine();

    const line: HTMLElement = await screen.findByTestId(
      DATA_SECURITY_AI_OVERVIEW_LINE_TEST_ID,
    );

    expect(line).toHaveTextContent("1 proposal waits for you.");
    expect(line).not.toHaveTextContent("contained");
  });

  test("is not there while both are none, or when they cannot be read", async () => {
    counts = { contained: 0, waiting: 0 };

    await openLine();

    expect(
      screen.queryByTestId(DATA_SECURITY_AI_OVERVIEW_LINE_TEST_ID),
    ).not.toBeInTheDocument();

    cleanup();
    jest.spyOn(ModelAPI, "count").mockRejectedValue(new Error("Forbidden"));

    await openLine();

    expect(
      screen.queryByTestId(DATA_SECURITY_AI_OVERVIEW_LINE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
