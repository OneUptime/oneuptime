import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, test } from "@jest/globals";
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
import { getProviderLogoStandInIcon } from "../../../../Types/ProviderLogo/ProviderLogoMarks";
import {
  getDrawnMark,
  getDrawnPathData,
  getMarkPathData,
  preloadProviderLogoMarks,
} from "../../../Helpers/ProviderLogoMarks";

/*
 * An LLM provider's kind in a list of providers (official logos audit): the
 * provider's official logo beside its name, as the form's cards name it.
 * Project Settings > AI > LLM Providers, a provider's own page and the Admin
 * Dashboard's Global LLM Providers all draw it, so the three agree.
 */

describe("LlmProviderTypeLabel", () => {
  beforeAll(async (): Promise<void> => {
    await preloadProviderLogoMarks();
  });

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
        // In one colour, inline; Groq, which licenses its logo to partners only, by an icon.
        expect(logo!.querySelector("img")).toBeNull();
        if (getProviderLogoStandInIcon(copy.logo)) {
          expect(getDrawnMark(logo)).toBeNull();
          expect(logo!.querySelectorAll("svg")).toHaveLength(1);
        } else {
          expect(getDrawnPathData(getDrawnMark(logo))).toEqual(
            getMarkPathData(copy.logo),
          );
        }
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

  test("OpenAI shows OpenAI's mark, bare and grey as the icon beside a name is", () => {
    const { container } = render(
      <LlmProviderTypeLabel llmType={LlmType.OpenAI} />,
    );

    const logo: HTMLElement = container.querySelector(
      "[data-provider-logo='openai']",
    )!;
    const mark: SVGElement | null = getDrawnMark(logo);

    expect(logo).not.toHaveClass("bg-white");
    expect(logo).toHaveClass("text-gray-500");
    // An icon's 16px square, so the names after the marks start at one place.
    expect(logo.style.minWidth).toBe("16px");
    expect(mark).toHaveAttribute("height", "16");
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
  });

  test("every provider's name starts at the same place, whatever its mark's shape", () => {
    for (const type of LLM_PROVIDER_TYPES) {
      const { container, unmount } = render(
        <LlmProviderTypeLabel llmType={type} />,
      );
      const logo: HTMLElement | null = container.querySelector(
        "[data-provider-logo]",
      );

      if (logo) {
        // A narrow mark (Ollama's llama) is centred in an icon's square.
        expect([type, logo.style.minWidth]).toEqual([type, "16px"]);
      }

      unmount();
    }
  });

  test("an OpenAI-compatible server has no one brand: it keeps its icon", () => {
    const { container } = render(
      <LlmProviderTypeLabel llmType={LlmType.OpenAICompatible} />,
    );

    expect(container.querySelector("[data-provider-logo]")).toBeNull();
    expect(
      container.querySelector(
        `svg[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
      ),
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

      expect({
        page,
        usesLabel: source.includes("<LlmProviderTypeLabel"),
      }).toEqual({
        page,
        usesLabel: true,
      });
    }
  });
});
