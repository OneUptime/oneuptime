import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * A pipeline's Recommendations page (Pages/DataPipeline/View/Recommendations)
 * hands the shared shell the pipeline's resource type, and the shell offers
 * every pipeline monitor the catalog has for it: since #9683, the fourth,
 * "Pipeline Stopped by Circuit Breaker", whose alert tells the pipeline's
 * owners its circuit breaker held a run back. The shell itself - picking,
 * creating in one click, dismissing - has its own suites.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsPage",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): unknown => {
        const react: typeof React = jest.requireActual("react") as typeof React;

        return react.createElement("div", {
          "data-testid": "recommendations-shell",
          "data-resource-type": String(props["resourceType"]),
        });
      },
    };
  },
);

import DataPipelineRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/DataPipeline/View/Recommendations";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";

afterEach(() => {
  cleanup();
});

describe("a pipeline's Recommendations page", () => {
  test("hands the shared shell the pipeline's resource type", () => {
    render(
      <DataPipelineRecommendations
        {...({} as unknown as PageComponentProps)}
      />,
    );

    expect(screen.getByTestId("recommendations-shell")).toHaveAttribute(
      "data-resource-type",
      MonitorRecommendationResourceType.DataPipeline,
    );
  });

  test("offers the four pipeline monitors, the circuit breaker's last", () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DataPipeline,
      );

    expect(
      recommendations.map((recommendation: MonitorRecommendation) => {
        return recommendation.name;
      }),
    ).toEqual([
      "Pipeline Run Failed",
      "Pipeline Run Unusually Long",
      "Pipeline Is Late",
      "Pipeline Stopped by Circuit Breaker",
    ]);

    const stopped: MonitorRecommendation = recommendations[3]!;

    expect(stopped.recommendationId).toBe(
      "DataPipeline:data-pipeline-stopped-by-circuit-breaker",
    );
    expect(stopped.category).toBe("Runs");
    expect(stopped.severity).toBe("Warning");
    // It says what it needs: a step that asks the circuit breaker.
    expect(stopped.description).toContain(
      "Needs a step that asks the circuit breaker before the pipeline runs.",
    );
  });
});
