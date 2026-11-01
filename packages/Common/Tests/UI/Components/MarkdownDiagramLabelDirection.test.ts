import { describe, expect, test } from "@jest/globals";
import { setDiagramLabelDirections } from "../../../UI/Components/Markdown.tsx/DiagramLabelDirection";

/*
 * mermaid draws a diagram's labels in the direction of the box around it -
 * a note's - so a Persian label in a note that starts in English drew its
 * full stop at its right, and an English label in a Persian note put its
 * full stop first. Each label now reads the way most of its letters do; the
 * diagram's own layout is untouched, and a text anchored at its start or
 * its end is left where it is.
 */

const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";

const drawn: (build: (svg: SVGSVGElement) => void) => HTMLDivElement = (
  build: (svg: SVGSVGElement) => void,
): HTMLDivElement => {
  const container: HTMLDivElement = document.createElement("div");
  const svg: SVGSVGElement = document.createElementNS(
    SVG_NAMESPACE,
    "svg",
  ) as SVGSVGElement;

  build(svg);
  container.appendChild(svg);

  return container;
};

const element: (
  parent: Element,
  name: string,
  text: string,
  attributes?: Record<string, string>,
) => SVGElement = (
  parent: Element,
  name: string,
  text: string,
  attributes: Record<string, string> = {},
): SVGElement => {
  const child: SVGElement = document.createElementNS(
    SVG_NAMESPACE,
    name,
  ) as SVGElement;

  child.textContent = text;

  for (const [key, value] of Object.entries(attributes)) {
    child.setAttribute(key, value);
  }

  parent.appendChild(child);

  return child;
};

describe("setDiagramLabelDirections", () => {
  test("a box's label reads the way most of its letters do", () => {
    let persian: SVGElement | null = null;
    let english: SVGElement | null = null;
    let mixed: SVGElement | null = null;

    const diagram: HTMLDivElement = drawn((svg: SVGSVGElement): void => {
      persian = element(svg, "foreignObject", "درگاه پرداخت.");
      english = element(svg, "foreignObject", "Checkout API.");
      // A Persian sentence that starts with an English word.
      mixed = element(svg, "foreignObject", "API پرداخت از کار افتاده");
    });

    expect(setDiagramLabelDirections(diagram)).toBe(3);
    expect(persian!.style.getPropertyValue("direction")).toBe("rtl");
    expect(english!.style.getPropertyValue("direction")).toBe("ltr");
    expect(mixed!.style.getPropertyValue("direction")).toBe("rtl");
  });

  test("a sequence diagram's centred text reads its own way", () => {
    let message: SVGElement | null = null;
    let name: SVGElement | null = null;

    const diagram: HTMLDivElement = drawn((svg: SVGSVGElement): void => {
      message = element(svg, "text", "پرداخت انجام شد.", {
        "text-anchor": "middle",
        class: "messageText",
      });
      name = element(svg, "text", "Gateway", { "text-anchor": "middle" });
    });

    setDiagramLabelDirections(diagram);

    expect(message!.getAttribute("direction")).toBe("rtl");
    expect(name!.getAttribute("direction")).toBe("ltr");
  });

  test("a text anchored at its start or its end is left where it is", () => {
    let start: SVGElement | null = null;
    let end: SVGElement | null = null;
    let unanchored: SVGElement | null = null;

    const diagram: HTMLDivElement = drawn((svg: SVGSVGElement): void => {
      start = element(svg, "text", "پرداخت", { "text-anchor": "start" });
      end = element(svg, "text", "پرداخت", { "text-anchor": "end" });
      unanchored = element(svg, "text", "پرداخت");
    });

    expect(setDiagramLabelDirections(diagram)).toBe(0);
    expect(start!.hasAttribute("direction")).toBe(false);
    expect(end!.hasAttribute("direction")).toBe(false);
    expect(unanchored!.hasAttribute("direction")).toBe(false);
  });

  test("a label with no letters follows the diagram", () => {
    let count: SVGElement | null = null;

    const diagram: HTMLDivElement = drawn((svg: SVGSVGElement): void => {
      count = element(svg, "foreignObject", "42 → 7");
    });

    expect(setDiagramLabelDirections(diagram)).toBe(0);
    expect(count!.style.getPropertyValue("direction")).toBe("");
  });
});
