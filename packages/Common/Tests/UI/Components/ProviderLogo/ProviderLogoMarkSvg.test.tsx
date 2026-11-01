import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import ProviderLogo from "../../../../Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "../../../../Types/ProviderLogo/AllProviderLogoMarks";
import { ProviderLogoMarkShapes } from "../../../../Types/ProviderLogo/ProviderLogoMark";
import { PROVIDER_LOGO_MARK_BOXES } from "../../../../Types/ProviderLogo/ProviderLogoMarks";
import ProviderLogoMarkSvg, {
  renderProviderLogoMarkShapes,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoMarkSvg";

/*
 * A mark as an inline SVG: the one drawing every place that shows a brand's
 * mark goes through (ProviderLogoImage, the icon set's brand glyphs, the
 * code hosts' marks), so they all draw the same shapes, in the same way.
 */

const SLACK: ProviderLogoMarkShapes = ALL_PROVIDER_LOGO_MARKS[ProviderLogo.Slack]!;

function svgOf(element: React.ReactElement): SVGElement {
  const { container } = render(element);
  return container.querySelector("svg")!;
}

describe("ProviderLogoMarkSvg", () => {
  test("draws the mark's shapes in its own box, in the current colour", () => {
    const svg: SVGElement = svgOf(
      <ProviderLogoMarkSvg mark={ProviderLogo.Slack} shapes={SLACK} />,
    );

    expect(svg).toHaveAttribute("viewBox", PROVIDER_LOGO_MARK_BOXES.slack);
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg.querySelectorAll("path")).toHaveLength(SLACK.length);
    for (const path of Array.from(svg.querySelectorAll("path"))) {
      expect(path).toHaveAttribute("fill", "currentColor");
      expect(path).toHaveAttribute("stroke", "none");
    }
  });

  test("is out of the reading order and of the tab order: the words beside it name the product", () => {
    const svg: SVGElement = svgOf(
      <ProviderLogoMarkSvg mark={ProviderLogo.Slack} shapes={SLACK} />,
    );

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  test("takes its size in pixels, or from its classes", () => {
    const sized: SVGElement = svgOf(
      <ProviderLogoMarkSvg
        mark={ProviderLogo.Slack}
        shapes={SLACK}
        width={20}
        height={20}
      />,
    );

    expect(sized).toHaveAttribute("width", "20");
    expect(sized).toHaveAttribute("height", "20");

    const classed: SVGElement = svgOf(
      <ProviderLogoMarkSvg
        mark={ProviderLogo.Slack}
        shapes={SLACK}
        className="h-5 w-5"
      />,
    );

    expect(classed).not.toHaveAttribute("width");
    expect(classed).toHaveClass("h-5", "w-5");
  });

  test("names the mark it draws, for the guards and the browser tests", () => {
    const svg: SVGElement = svgOf(
      <ProviderLogoMarkSvg mark={ProviderLogo.Slack} shapes={SLACK} />,
    );

    expect(svg).toHaveAttribute("data-provider-logo-mark-svg", "slack");
  });

  test("a lighter shape keeps its lightness as an opacity, the colour still the current one", () => {
    const { container } = render(
      <svg>
        {renderProviderLogoMarkShapes([
          { d: "M0 0h4v4H0z", opacity: 0.4 },
          { d: "M1 1h2v2H1z" },
        ])}
      </svg>,
    );
    const paths: Array<SVGPathElement> = Array.from(
      container.querySelectorAll("path"),
    );

    expect(paths[0]).toHaveAttribute("fill-opacity", "0.4");
    expect(paths[0]).toHaveAttribute("fill", "currentColor");
    expect(paths[1]).not.toHaveAttribute("fill-opacity");
  });
});
