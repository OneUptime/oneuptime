/** @timezone UTC */
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import KubernetesCostPricingNote, {
  KUBERNETES_COST_ENGINE_AUTO_COMMAND,
  KUBERNETES_COST_ENGINE_AUTO_WITH_PROMETHEUS_COMMAND,
  KUBERNETES_COST_PRICING_DESCRIPTIONS,
  KUBERNETES_COST_PRICING_TEST_ID,
  KUBERNETES_COST_RATE_CARD_DOCS_ROUTE,
  getKubernetesCostReconciliation,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesCostPricingNote";
import { KubernetesCostEngineView } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostEngine";
import {
  KubernetesCostMemoryPeaksSource,
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
  overrides: Partial<KubernetesCostEngineView> = {},
): KubernetesCostEngineView {
  return {
    engine: "OpenCost",
    service: "",
    bundledEngineUnused: false,
    pricingSource: KubernetesCostPricingSource.ListPrices,
    pricingProvider: "AWS",
    memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Engine,
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

  /*
   * #9851: a Kubecost (3, and 2) that reads the cloud's bill reconciles its
   * prices with what was paid about a day and a half after each hour, after
   * the cost agent shipped it. The line says both.
   */
  test("says a Kubecost reading the cloud's bill priced the hours at list prices, before reconciling them", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          engine: "Kubecost",
          service: "kubecost/kubecost-frontend",
          pricingSource: KubernetesCostPricingSource.BillingIntegration,
          pricingProvider: "GCP",
        })}
      />,
    );

    expect(textOf(line())).toContain(
      "Prices: Google Cloud list prices, before Kubecost reconciles them with your bill",
    );
    // Not a warning: these are the cloud's real prices.
    expect(line().className).toContain("text-gray-600");
    expect(
      screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-about`),
    ).toBeInTheDocument();
    expect(
      textOf(screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-engine`)),
    ).toBe("Priced by your Kubecost (kubecost/kubecost-frontend)");
  });

  test("explains what reconciling with the bill means, before any reconciled hour arrived", () => {
    expect(KUBERNETES_COST_PRICING_DESCRIPTIONS.billingIntegration).toBe(
      "Your Kubecost reads your cloud bill and reconciles its prices with what you paid, about two days after each hour. No reconciled hour has reached OneUptime yet: these are the cloud's public list prices.",
    );
    // True of an older agent too, which never sends a reconciled hour.
    expect(
      KUBERNETES_COST_PRICING_DESCRIPTIONS.billingIntegration,
    ).not.toContain("brings");
  });

  /*
   * #9969: OneUptime brings in each hour Kubecost reconciled with the bill
   * (the cost agent reads it again about two days on), and the line says how
   * far the window's figures are reconciled.
   */
  test("says the figures are reconciled with your bill up to the newest reconciled hour", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          engine: "Kubecost",
          service: "kubecost/kubecost-cost-analyzer",
          pricingSource: KubernetesCostPricingSource.BillingIntegration,
          pricingProvider: "AWS",
          reconciledThrough: new Date("2026-11-17T15:00:00.000Z"),
          pricedThrough: new Date("2026-11-19T11:00:00.000Z"),
        })}
      />,
    );

    expect(
      textOf(
        screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-reconciled`),
      ),
    ).toBe(
      "Prices: reconciled with your AWS bill up to Nov 17, 2026, 3:00 PM, list prices after",
    );
    expect(line().className).toContain("text-gray-600");
    expect(
      screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-about`),
    ).toBeInTheDocument();
  });

  test("says the figures are reconciled with your bill when every hour of the window is", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          pricingSource: KubernetesCostPricingSource.BillingIntegration,
          pricingProvider: "GCP",
          reconciledThrough: new Date("2026-11-10T00:00:00.000Z"),
          pricedThrough: new Date("2026-11-10T00:00:00.000Z"),
        })}
      />,
    );

    expect(
      textOf(
        screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-reconciled`),
      ),
    ).toBe("Prices: reconciled with your Google Cloud bill");
  });

  test("explains what the reconciled figures are, and what the hours after them are", () => {
    expect(KUBERNETES_COST_PRICING_DESCRIPTIONS.billingReconciled).toBe(
      "Your Kubecost reads your cloud bill and reconciles its prices with what you paid, about two days after each hour, and OneUptime brings each reconciled hour in. Later hours are at the cloud's public list prices until then.",
    );
  });

  test("how far a window is reconciled: none, up to a time, or all of it", () => {
    const base: ReturnType<typeof engine> = engine({
      pricingSource: KubernetesCostPricingSource.BillingIntegration,
    });

    expect(getKubernetesCostReconciliation(base)).toEqual({
      reconciled: "none",
    });
    expect(
      getKubernetesCostReconciliation({ ...base, reconciledThrough: null }),
    ).toEqual({ reconciled: "none" });

    const through: Date = new Date("2026-11-17T15:00:00.000Z");

    expect(
      getKubernetesCostReconciliation({
        ...base,
        reconciledThrough: through,
        pricedThrough: new Date("2026-11-17T16:00:00.000Z"),
      }),
    ).toEqual({ reconciled: "upTo", through });
    expect(
      getKubernetesCostReconciliation({
        ...base,
        reconciledThrough: through,
        pricedThrough: through,
      }),
    ).toEqual({ reconciled: "all" });
    // Without the newest hour to compare with, only up to the time.
    expect(
      getKubernetesCostReconciliation({ ...base, reconciledThrough: through }),
    ).toEqual({ reconciled: "upTo", through });
  });

  test("list prices of a Kubecost that reads no bill never say reconciled", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          pricingSource: KubernetesCostPricingSource.ListPrices,
          reconciledThrough: new Date("2026-11-17T15:00:00.000Z"),
        })}
      />,
    );

    expect(textOf(line())).toBe("Prices: AWS list prices");
    expect(
      screen.queryByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-reconciled`),
    ).not.toBeInTheDocument();
  });

  /*
   * #9970: with Kubecost 3, which reads no Prometheus, memory right-sizing
   * reads its peaks from the bundled one. The upgrade that stops the bundled
   * engine names another, or the note says to keep it.
   */
  test("when the memory peaks come from the bundled Prometheus, the upgrade names another", () => {
    render(
      <KubernetesCostPricingNote
        engine={engine({
          engine: "Kubecost",
          service: "kubecost/kubecost-frontend",
          bundledEngineUnused: true,
          memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Bundled,
        })}
      />,
    );

    const notice: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COST_PRICING_TEST_ID}-bundled-peaks`,
    );

    expect(textOf(notice)).toContain(
      "This cluster runs its own Kubecost (kubecost/kubecost-frontend), and the cost agent reads that. Memory right-sizing still reads its peaks from the bundled Prometheus, as the agent found none your Kubecost reads. To stop running both, name a Prometheus that scrapes cAdvisor in the same upgrade:",
    );
    expect(textOf(notice)).toContain(
      "Without another Prometheus, keep the bundled engine: memory recommendations need it.",
    );
    expect(
      within(notice).getByText(/cost\.engine\.prometheusUrl=<prometheus-url>/),
    ).toBeTruthy();
    expect(KUBERNETES_COST_ENGINE_AUTO_WITH_PROMETHEUS_COMMAND).toBe(
      [
        "helm upgrade kubernetes-agent oneuptime/kubernetes-agent",
        "  --namespace oneuptime-agent",
        "  --reset-then-reuse-values",
        "  --set cost.engine.url=auto",
        "  --set cost.engine.prometheusUrl=<prometheus-url>",
      ].join(" \\\n"),
    );
    // Still under the same title: OpenCost itself prices nothing.
    expect(
      textOf(
        screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`),
      ),
    ).toContain("The bundled OpenCost is not needed");
  });

  test.each([
    KubernetesCostMemoryPeaksSource.Engine,
    KubernetesCostMemoryPeaksSource.Configured,
    // An agent older than #9970 says nothing: the upgrade as it was.
    KubernetesCostMemoryPeaksSource.None,
  ])(
    "when the memory peaks come from elsewhere (%j), the plain upgrade stops the bundled engine",
    (memoryPeaksFrom: KubernetesCostMemoryPeaksSource) => {
      render(
        <KubernetesCostPricingNote
          engine={engine({
            engine: "Kubecost",
            service: "kubecost/kubecost-cost-analyzer",
            bundledEngineUnused: true,
            memoryPeaksFrom,
          })}
        />,
      );

      const notice: HTMLElement = screen.getByTestId(
        `${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`,
      );

      expect(
        screen.queryByTestId(
          `${KUBERNETES_COST_PRICING_TEST_ID}-bundled-peaks`,
        ),
      ).not.toBeInTheDocument();
      expect(textOf(notice)).not.toContain("prometheusUrl");
      expect(within(notice).getByText(/cost\.engine\.url=auto/)).toBeTruthy();
    },
  );

  test("a bill-reading Kubecost with no cloud named says nothing rather than a blank", () => {
    const { container } = render(
      <KubernetesCostPricingNote
        engine={engine({
          pricingSource: KubernetesCostPricingSource.BillingIntegration,
          pricingProvider: "",
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
