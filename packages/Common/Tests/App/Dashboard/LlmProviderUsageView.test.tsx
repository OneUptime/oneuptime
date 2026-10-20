import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import Metric from "../../../Models/AnalyticsModels/Metric";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import OneUptimeDate from "../../../Types/Date";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import LlmProviderUsage from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmProviderUsage";

/*
 * Usage > Provider accounts, drawn with the network stubbed:
 *
 *   - with no provider account connected it says so, and its button opens
 *     Connect on the provider tiles (?way=providers), not on the snippet;
 *   - its totals are the tiles Your AI calls draws, in the same order -
 *     requests, input and output tokens, cost - written the way the AI
 *     pages write numbers;
 *   - a bill's rows set thousands apart and keep the cents;
 *   - it opens on the last month, the range picker's own "1 month".
 */

// A tile, and its value, as LlmTile draws them.
const TILE: RegExp = /^llm-provider-usage-total-[a-z]+$/;
const TILE_VALUE: RegExp = /^llm-provider-usage-total-[a-z]+-value$/;

let connectionsForTest: Array<LlmObservabilityConnection> = [];
let navigateSpy: jest.SpyInstance<any, any>;
let aggregateSpy: jest.SpyInstance<any, any>;

function account(provider: LlmConnectionProvider): LlmObservabilityConnection {
  const item: LlmObservabilityConnection = new LlmObservabilityConnection();
  item.provider = provider;
  return item;
}

function rows(metricName: string): Array<AggregatedModel> {
  if (metricName === "oneuptime.llm.provider.cost") {
    return [
      {
        value: 12_345.678,
        attributes: {
          "gen_ai.request.model": "gpt-4o",
          "oneuptime.llm.cost.estimated": "false",
        },
      },
    ] as unknown as Array<AggregatedModel>;
  }

  if (metricName === "oneuptime.llm.provider.tokens") {
    return [
      {
        value: 1_400_000,
        attributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.token.type": "input",
        },
      },
      {
        value: 280_000,
        attributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.token.type": "output",
        },
      },
    ] as unknown as Array<AggregatedModel>;
  }

  return [
    { value: 5_400, attributes: { "gen_ai.request.model": "gpt-4o" } },
  ] as unknown as Array<AggregatedModel>;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/llm/usage?source=providers`);
  connectionsForTest = [account(LlmConnectionProvider.OpenAI)];

  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return {
        data: connectionsForTest,
        count: connectionsForTest.length,
        skip: 0,
        limit: 100,
      };
    },
  );

  aggregateSpy = getJestSpyOn(AnalyticsModelAPI, "aggregate").mockImplementation(
    async (args: unknown): Promise<unknown> => {
      const query: { name: string } = (
        args as { aggregateBy: { query: { name: string } } }
      ).aggregateBy.query;
      return { data: rows(query.name) };
    },
  );

  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function open(): Promise<void> {
  await act(async () => {
    render(<LlmProviderUsage />);
  });
}

describe("with no provider account connected", () => {
  test("it says so, and opens Connect on the provider tiles", async () => {
    connectionsForTest = [account(LlmConnectionProvider.ClaudeEnterprise)];

    await open();

    const empty: HTMLElement = await screen.findByTestId(
      "llm-provider-usage-not-connected",
    );

    expect(empty).toHaveTextContent("No provider account connected");

    await act(async () => {
      within(empty).getByTestId("llm-provider-usage-connect").click();
    });

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/connect?way=providers`,
    );
  });
});

describe("with a provider account", () => {
  test("the totals are Your AI calls' tiles, in its order, written its way", async () => {
    await open();

    const totals: HTMLElement = await screen.findByTestId(
      "llm-provider-usage-totals",
    );
    const values: Array<string> = within(totals)
      .getAllByTestId(TILE_VALUE)
      .map((value: HTMLElement): string => {
        return value.textContent || "";
      });

    expect(values).toEqual(["5,400", "1.4M", "280k", "$12,345.68"]);
    expect(
      within(totals)
        .getAllByTestId(TILE)
        .map((tile: HTMLElement): string => {
          return tile.getAttribute("data-testid") || "";
        }),
    ).toEqual([
      "llm-provider-usage-total-requests",
      "llm-provider-usage-total-input",
      "llm-provider-usage-total-output",
      "llm-provider-usage-total-cost",
    ]);
  });

  test("a bill's row sets thousands apart and keeps the cents", async () => {
    await open();

    const row: HTMLElement = (
      await screen.findAllByTestId("llm-provider-usage-row")
    )[0]!;

    expect(row).toHaveTextContent("gpt-4o");
    expect(row).toHaveTextContent("$12,345.68");
    expect(row).toHaveTextContent("1,400,000");
  });

  test("it reads the last month: the range picker's own 1 month", async () => {
    await open();

    await screen.findByTestId("llm-provider-usage-totals");

    const request: {
      aggregateBy: { startTimestamp: Date; endTimestamp: Date };
      modelType: unknown;
    } = aggregateSpy.mock.calls[0]![0] as never;

    expect(request.modelType).toBe(Metric);
    expect(
      OneUptimeDate.getDifferenceInMonths(
        request.aggregateBy.startTimestamp,
        request.aggregateBy.endTimestamp,
      ),
    ).toBe(1);
  });
});
