import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import LlmType from "../../../../Types/LLM/LlmType";
import { getProviderLogoName } from "../../../../Types/ProviderLogo/ProviderLogo";
import {
  LLM_PROVIDER_TYPES,
  LLM_PROVIDER_TYPE_COPY,
} from "../../../../UI/Components/AI/LlmProviderFormCopy";
import LlmProviderTypeLabel from "../../../../UI/Components/AI/LlmProviderTypeLabel";
import { PROVIDER_ICON_TILE_TEST_ID } from "../../../../UI/Components/ProviderLogo/ProviderLogoOrIcon";

/*
 * An LLM provider's kind in a list of providers (official logos audit): the
 * provider's official logo beside its name, as the form's cards name it.
 * Project Settings > AI > LLM Providers, a provider's own page and the Admin
 * Dashboard's Global LLM Providers all draw it, so the three agree.
 */

describe("LlmProviderTypeLabel", () => {
  test.each(LLM_PROVIDER_TYPES)(
    "%s reads as the form's card names it, beside its logo or icon",
    (type: LlmType) => {
      const { container } = render(<LlmProviderTypeLabel llmType={type} />);
      const copy: (typeof LLM_PROVIDER_TYPE_COPY)[LlmType] =
        LLM_PROVIDER_TYPE_COPY[type];

      expect(container).toHaveTextContent(copy.title);

      const logo: Element | null = container.querySelector(
        "[data-provider-logo]",
      );

      if (copy.logo) {
        expect(logo).toHaveAttribute("data-provider-logo", copy.logo);
        // Its name is the words beside it: not read out twice.
        expect(logo).toHaveAttribute("aria-hidden", "true");
        expect(getProviderLogoName(copy.logo).length).toBeGreaterThan(0);
      } else {
        expect(logo).toBeNull();
        expect(
          container.querySelector(
            `[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
          ),
        ).not.toBeNull();
      }
    },
  );

  test("OpenAI shows OpenAI's logo, bare, beside its name", () => {
    const { container } = render(
      <LlmProviderTypeLabel llmType={LlmType.OpenAI} />,
    );

    const logo: Element = container.querySelector(
      "[data-provider-logo='openai']",
    )!;

    expect(logo).not.toHaveClass("bg-white");
    expect(logo.firstElementChild).toHaveClass("h-4", "w-4");
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
  });

  test("an OpenAI-compatible server has no one brand: it keeps its icon", () => {
    const { container } = render(
      <LlmProviderTypeLabel llmType={LlmType.OpenAICompatible} />,
    );

    expect(container.querySelector("[data-provider-logo]")).toBeNull();
    expect(
      container.querySelector(`svg[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`),
    ).toHaveClass("h-4", "w-4", "text-gray-500");
  });

  test("a kind this build does not know is its stored value, as written", () => {
    const { container } = render(
      <LlmProviderTypeLabel llmType="SomeFutureProvider" />,
    );

    expect(container).toHaveTextContent("SomeFutureProvider");
    expect(container.querySelector("[data-provider-logo]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  test("a provider without a kind shows the empty text, or nothing", () => {
    const { container, unmount } = render(
      <LlmProviderTypeLabel llmType={undefined} emptyText="-" />,
    );

    expect(container.textContent).toBe("-");
    unmount();

    const second: ReturnType<typeof render> = render(
      <LlmProviderTypeLabel llmType={null} />,
    );

    expect(second.container.textContent).toBe("");
  });

  /*
   * The three lists draw the same label, so a provider reads the same
   * wherever it is listed.
   */
  test("the Dashboard's list, a provider's page and the Admin Dashboard's list all use it", () => {
    const packages: string = path.join(__dirname, "..", "..", "..", "..", "..");
    const pages: Array<string> = [
      "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx",
      "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView.tsx",
      "App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index.tsx",
    ];

    for (const page of pages) {
      const source: string = fs.readFileSync(path.join(packages, page), "utf8");

      expect({ page, usesLabel: source.includes("<LlmProviderTypeLabel") }).toEqual({
        page,
        usesLabel: true,
      });
    }
  });
});
