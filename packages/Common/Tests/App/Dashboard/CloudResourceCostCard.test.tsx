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
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { CloudSavingKind } from "../../../Types/Cloud/CloudCost";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import CloudResourceCostCard, {
  CloudResourceCost,
  RESOURCE_COST_DESCRIPTION,
  RESOURCE_COST_TITLE,
  RESOURCE_SAVINGS_DESCRIPTION,
  RESOURCE_SAVINGS_TITLE,
  fetchCloudResourceCost,
  getCloudResourceCostCardHeading,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceCostCard";

/*
 * What one cloud resource costs, on its Overview: this month so far and
 * the last 30 days, from the costs its cloud bills it under - an Azure id
 * as Cost Management writes it, in lower case - in the currency most of
 * them are in; and the ways its cloud's recommender says it could cost
 * less. Nothing is drawn for a resource with neither, or when they cannot
 * be read.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const RESOURCE_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const AZURE_ID: string =
  "/subscriptions/0000/resourceGroups/Web/providers/Microsoft.Compute/virtualMachines/Web-1";
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const MONTH_START: Date = new Date("2026-11-01T00:00:00.000Z");

let monthRows: Array<Record<string, unknown>> = [];
let thirtyDayRows: Array<Record<string, unknown>> = [];
let recommendations: Array<CloudCostRecommendation> = [];
let aggregateSpy: jest.SpyInstance<any, any>;
let listSpy: jest.SpyInstance<any, any>;

function recommendation(
  overrides: Partial<CloudCostRecommendation> = {},
): CloudCostRecommendation {
  const model: CloudCostRecommendation = new CloudCostRecommendation();
  Object.assign(model, {
    _id: "10000000-0000-4000-8000-0000000000f1",
    kind: CloudSavingKind.Rightsize,
    action: "Resize",
    currentConfiguration: "Standard_D8s_v5",
    recommendedConfiguration: "Standard_D4s_v5",
    monthlySavings: 140,
    currency: "EUR",
    ...overrides,
  });
  return model;
}

beforeEach(() => {
  monthRows = [{ currency: "EUR", value: 210.5 }];
  thirtyDayRows = [
    { currency: "EUR", value: 380 },
    // A few cents billed in another currency is left out.
    { currency: "USD", value: 0.4 },
  ];
  recommendations = [recommendation()];

  // The card reads up to now: the same now, whatever day the suite runs.
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  aggregateSpy = getJestSpyOn(
    AnalyticsModelAPI,
    "aggregate",
  ).mockImplementation(
    async (request: {
      aggregateBy: AggregateBy<CloudCost>;
    }): Promise<unknown> => {
      const start: Date = request.aggregateBy.startTimestamp as Date;
      return {
        data:
          start.getTime() === MONTH_START.getTime() ? monthRows : thirtyDayRows,
      };
    },
  );
  listSpy = getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return {
        data: recommendations,
        count: recommendations.length,
        skip: 0,
        limit: 5,
      };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what one resource costs", () => {
  test("this month and the last 30 days, by the key its cloud bills it under, in the currency most are in", async () => {
    const cost: CloudResourceCost = await fetchCloudResourceCost({
      projectId: PROJECT,
      resourceRecordId: RESOURCE_ROW,
      provider: "azure",
      providerResourceId: AZURE_ID,
      now: NOW,
    });

    expect(cost).toMatchObject({
      currency: "EUR",
      monthToDate: 210.5,
      last30Days: 380,
      hasCosts: true,
    });
    expect(cost.recommendations).toHaveLength(1);

    const windows: Array<AggregateBy<CloudCost>> = aggregateSpy.mock.calls.map(
      (call: Array<any>): AggregateBy<CloudCost> => {
        return call[0].aggregateBy;
      },
    );
    expect(windows).toHaveLength(2);
    for (const window of windows) {
      // Azure Cost Management writes ARM ids in lower case.
      expect(window.query["resourceId" as keyof CloudCost] as unknown).toBe(
        AZURE_ID.toLowerCase(),
      );
      expect(window.groupBy).toEqual({ currency: true });
    }
    expect(windows[0]!.query["day" as keyof CloudCost] as unknown).toEqual(
      new InBetween<Date>(new Date("2026-11-01T00:00:00.000Z"), NOW),
    );
    expect(windows[1]!.startTimestamp).toEqual(
      new Date("2026-10-22T00:00:00.000Z"),
    );

    // Its recommendations, the largest first.
    const request: { query: Record<string, unknown>; limit: number } =
      listSpy.mock.calls[0]![0];
    expect(request.query).toEqual({ cloudResourceId: RESOURCE_ROW });
    expect(request.limit).toBe(5);
  });

  test("an AWS resource's id as its cloud writes it; no costs is in its recommendations' currency", async () => {
    monthRows = [];
    thirtyDayRows = [];

    const cost: CloudResourceCost = await fetchCloudResourceCost({
      projectId: PROJECT,
      resourceRecordId: RESOURCE_ROW,
      provider: "aws",
      providerResourceId: "arn:aws:ec2:us-east-1:1:instance/i-0ABC",
      now: NOW,
    });

    expect(cost).toMatchObject({ hasCosts: false, currency: "EUR" });
    expect(aggregateSpy.mock.calls[0]![0].aggregateBy.query["resourceId"]).toBe(
      "arn:aws:ec2:us-east-1:1:instance/i-0ABC",
    );
  });

  test("no id to bill it under: no cost read at all", async () => {
    const cost: CloudResourceCost = await fetchCloudResourceCost({
      projectId: PROJECT,
      resourceRecordId: RESOURCE_ROW,
      provider: "gcp",
      providerResourceId: "  ",
      now: NOW,
    });

    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(cost.hasCosts).toBe(false);
  });
});

describe("the card", () => {
  async function renderCard(): Promise<void> {
    await act(async () => {
      render(
        <CloudResourceCostCard
          projectId={PROJECT}
          resourceRecordId={RESOURCE_ROW}
          provider="azure"
          providerResourceId={AZURE_ID}
        />,
      );
    });
  }

  test("the figures, then each way to spend less with what it would change", async () => {
    await renderCard();

    expect(
      await screen.findByTestId("cloud-resource-cost-30-days"),
    ).toHaveTextContent("€380.00");
    expect(screen.getByTestId("cloud-resource-cost-month")).toHaveTextContent(
      "€210.50",
    );

    const savings: HTMLElement = screen.getByTestId("cloud-resource-savings");
    expect(savings).toHaveTextContent("Resize");
    expect(savings).toHaveTextContent("Standard_D8s_v5 → Standard_D4s_v5");
    expect(savings).toHaveTextContent("€140.00");
    /*
     * What it changes sits under what to do in the card's direction; only
     * the configurations are set apart, inline (joinWithArrowsOn, #7666),
     * so a page read right to left does not push the line to the far side.
     * Two names in Latin letters on an English page need nothing round
     * them: the line is written exactly as it was.
     */
    const change: HTMLElement = within(savings).getByTestId(
      "cloud-resource-saving-change",
    );
    expect(change.tagName).toBe("DIV");
    expect(change.textContent).toBe("Standard_D8s_v5 → Standard_D4s_v5");

    // Called what it shows: what it costs, and how it could cost less.
    expect(screen.getByTestId("cloud-resource-cost")).toHaveAttribute(
      "data-state",
      "costs",
    );
    expect(screen.getByText(RESOURCE_COST_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RESOURCE_COST_DESCRIPTION)).toBeInTheDocument();
  });

  /*
   * A resource its cloud does not bill by name (AWS Cost Explorer says the
   * service and Region only) has no figure: its card is only its ways to
   * spend less, and says so - not "What it costs" over no cost.
   */
  test("only recommendations: no figures, and called Ways to spend less", async () => {
    monthRows = [];
    thirtyDayRows = [];

    await renderCard();

    expect(
      await screen.findByTestId("cloud-resource-savings"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-resource-cost-month")).toBeNull();
    expect(screen.getByTestId("cloud-resource-cost")).toHaveAttribute(
      "data-state",
      "savings-only",
    );
    expect(screen.getByText(RESOURCE_SAVINGS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RESOURCE_SAVINGS_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(RESOURCE_COST_TITLE)).toBeNull();
  });

  test("its heading follows what it holds", () => {
    expect(getCloudResourceCostCardHeading({ hasCosts: true })).toEqual({
      title: "What it costs",
      description:
        "From its cloud's own billing, and the ways its cloud's recommender says it could cost less.",
    });
    expect(getCloudResourceCostCardHeading({ hasCosts: false })).toEqual({
      title: "Ways to spend less",
      description: "What its cloud's own recommender says could be saved.",
    });
  });

  test("neither costs nor recommendations, or a read that fails: nothing", async () => {
    monthRows = [];
    thirtyDayRows = [];
    recommendations = [];

    await renderCard();
    expect(screen.queryByTestId("cloud-resource-cost")).toBeNull();

    cleanup();
    aggregateSpy.mockRejectedValue(new Error("Request failed"));
    recommendations = [recommendation()];

    await renderCard();
    expect(screen.queryByTestId("cloud-resource-cost")).toBeNull();
  });
});
