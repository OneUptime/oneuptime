/** @timezone UTC */
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import KubernetesCostPricingNote, {
  KUBERNETES_COST_ENGINE_AUTO_COMMAND,
  KUBERNETES_COST_PRICING_DESCRIPTIONS,
  KUBERNETES_COST_PRICING_TEST_ID,
  KUBERNETES_COST_RATE_CARD_DOCS_ROUTE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesCostPricingNote";
import {
  KubernetesCostEngineInfo,
  KubernetesCostPricingSource,
} from "../../../Types/Kubernetes/KubernetesCostPricing";

/*
 * #9634: one line under a cluster's cost figures says where their prices
 * come from - a cloud's list prices, a rate card, or OpenCost's default
 * rates, the last in amber with the way to set your own. #9633: when the
 * agent read the cluster's own engine, the line names it, and while the
 * chart still bundles one nobody reads, one amber note gives the upgrade
 * that stops it.
 */

function engine(
  overrides: Partial<KubernetesCostEngineInfo> = {},
): KubernetesCostEngineInfo {
  return {
    engine: "OpenCost",
    service: "",
    bundledEngineUnused: false,
    pricingSource: KubernetesCostPricingSource.ListPrices,
    pricingProvider: "AWS",
    ...overrides,
  };
}

function line(): HTMLElement {
  return screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-line`);
}

function textOf(element: HTMLElement): string {
  return (element.textContent || "").replace(/\u00A0/g, " ");
}

afterEach(() => {
  cleanup();
});

describe("KubernetesCostPricingNote", () => {
  test("says the cloud whose list prices price the cluster, by the name people know it", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({ pricingProvider: "Azure" })}
      />,
    );

    expect(textOf(line())).toBe("Prices: Azure list prices");
  });

  test("names Google Cloud as people say it, not as OpenCost writes it", () => {
    render(
      <KubernetesCostPricingNote engine={engine({ pricingProvider: "GCP" })} />,
    );

    expect(textOf(line())).toContain("Prices: Google Cloud list prices");
  });

  test("says a rate card prices the cluster", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          pricingSource: KubernetesCostPricingSource.RateCard,
          pricingProvider: "",
        })}
      />,
    );

    expect(textOf(line())).toBe("Prices: your rate card");
    expect(line().className).toContain("text-gray-600");
  });

  test("says OpenCost's default rates price the cluster, in amber, with the way to set your own", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          pricingSource: KubernetesCostPricingSource.DefaultRates,
          pricingProvider: "",
        })}
      />,
    );

    expect(textOf(line())).toBe(
      "Prices: OpenCost's default rates. Set your own rates",
    );
    expect(line().className).toContain("text-amber-700");

    const link: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COST_PRICING_TEST_ID}-rate-card-docs`,
    );

    expect(link.getAttribute("href")).toContain(
      KUBERNETES_COST_RATE_CARD_DOCS_ROUTE,
    );
    expect(KUBERNETES_COST_RATE_CARD_DOCS_ROUTE).toBe(
      "/docs/en/telemetry/kubernetes-cost#on-prem-and-bare-metal-pricing",
    );
  });

  test("explains each kind of prices in an (i), saying what list prices leave out", () => {
    render(<KubernetesCostPricingNote engine={engine()} />);

    expect(
      screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-about`),
    ).toBeInTheDocument();
    expect(KUBERNETES_COST_PRICING_DESCRIPTIONS.listPrices).toContain(
      "discounts",
    );
    expect(KUBERNETES_COST_PRICING_DESCRIPTIONS.defaultRates).toContain(
      "far from what your hardware costs",
    );

    for (const text of Object.values(KUBERNETES_COST_PRICING_DESCRIPTIONS)) {
      // The small tooltip's room (KubernetesClusterMetricTooltips).
      expect(text.length).toBeLessThanOrEqual(260);
    }
  });

  test("names the cluster's own engine when the agent read it", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          engine: "Kubecost",
          service: "kubecost/kubecost-cost-analyzer",
        })}
      />,
    );

    expect(textOf(line())).toContain("Prices: AWS list prices");
    expect(
      textOf(screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-engine`)),
    ).toBe("Priced by your Kubecost (kubecost/kubecost-cost-analyzer)");
  });

  test("says nothing of an engine the chart bundled or someone named", () => {
    render(<KubernetesCostPricingNote engine={engine()} />);

    expect(
      screen.queryByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-engine`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`),
    ).not.toBeInTheDocument();
  });

  test("gives the upgrade that stops the bundled engine, only while it runs unread", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          engine: "Kubecost",
          service: "kubecost/kubecost-cost-analyzer",
          bundledEngineUnused: true,
        })}
      />,
    );

    const notice: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`,
    );

    expect(textOf(notice)).toContain("The bundled OpenCost is not needed");
    expect(textOf(notice)).toContain(
      "This cluster runs its own Kubecost (kubecost/kubecost-cost-analyzer), and the cost agent reads that.",
    );
    expect(within(notice).getByText(/cost\.engine\.url=auto/)).toBeTruthy();
    expect(KUBERNETES_COST_ENGINE_AUTO_COMMAND).toBe(
      [
        "helm upgrade kubernetes-agent oneuptime/kubernetes-agent",
        "  --namespace oneuptime-agent",
        "  --reset-then-reuse-values",
        "  --set cost.engine.url=auto",
      ].join(" \\\n"),
    );
  });

  test("an unknown source says nothing about prices, and draws nothing without an engine to name", () => {
    const { container } = render(
      <KubernetesCostPricingNote
        engine={engine({
          pricingSource: KubernetesCostPricingSource.Unknown,
          pricingProvider: "",
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("an unknown source with the cluster's own engine still names the engine", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          engine: "OpenCost",
          service: "opencost/opencost",
          pricingSource: KubernetesCostPricingSource.Unknown,
          pricingProvider: "",
        })}
      />,
    );

    expect(textOf(line())).toBe("Priced by your OpenCost (opencost/opencost)");
  });

  test("draws nothing at all for a cluster whose agent says nothing", () => {
    const { container } = render(<KubernetesCostPricingNote engine={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  test("list prices with no provider named say nothing rather than a blank", () => {
    const { container } = render(
      <KubernetesCostPricingNote engine={engine({ pricingProvider: "" })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
