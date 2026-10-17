import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import DetailFieldLabel, {
  DETAIL_FIELD_DESCRIPTION_CLASS_NAME,
  DETAIL_FIELD_LABEL_CLASS_NAME,
  DETAIL_FIELD_SIDE_LINK_CLASS_NAME,
} from "../../../../UI/Components/Detail/DetailFieldLabel";
import Route from "../../../../Types/API/Route";

/*
 * A detail field's name, the link beside it and the line under it
 * (DetailFieldLabel).
 *
 * "NAME •" - tracked capitals in a small bold face with a dot after them,
 * on every field of every detail card - read louder than the values they
 * named. The name is written as the card writes it now, muted, with no dot,
 * so the value under it is what the eye lands on. Its shape is the one a
 * detail field has always had - a block holding a <label> and then the
 * description - so whatever reads the cards' <label>s still finds them.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const GERMAN_FILE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as Record<string, string>;

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: {
      de: {
        translation: {
          Timezone: GERMAN_FILE["Timezone"] as string,
          Description: GERMAN_FILE["Description"] as string,
          Preview: GERMAN_FILE["Preview"] as string,
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return element.className.split(/\s+/).filter(Boolean);
};

describe("the name", () => {
  test("is a <label> in the card's own words, muted, medium, sentence-sized", () => {
    render(<DetailFieldLabel title="Timezone" />);

    const label: HTMLElement = screen.getByTestId("detail-label");

    expect(label.tagName).toBe("LABEL");
    expect(label.textContent).toBe("Timezone");
    expect(label.className).toContain(DETAIL_FIELD_LABEL_CLASS_NAME);
    expect(classesOf(label)).toEqual(
      expect.arrayContaining(["text-sm", "font-medium", "text-gray-500"]),
    );
  });

  test("is never shouted: no capitals, no tracking, no bold face, no dot", () => {
    render(<DetailFieldLabel title="Timezone" />);

    const label: HTMLElement = screen.getByTestId("detail-label");

    expect(classesOf(label)).not.toContain("uppercase");
    expect(label.className).not.toMatch(/tracking-/);
    expect(classesOf(label)).not.toContain("font-semibold");
    expect(classesOf(label)).not.toContain("font-bold");
    expect(label.querySelector(".rounded-full")).toBeNull();
    // The name and nothing else: no bullet character either.
    expect(label.textContent).not.toMatch(/[\u2022\u00b7]/u);
  });

  test("sits first in its block, as every detail field's name has", () => {
    const { container } = render(
      <DetailFieldLabel title="Timezone" description="Where you are." />,
    );

    const block: HTMLElement = container.firstElementChild as HTMLElement;

    expect(block).toHaveClass("space-y-1");
    expect(block.children[0]).toBe(screen.getByTestId("detail-label"));
    expect(block.children[1]).toBe(screen.getByTestId("detail-description"));
  });

  test("starts at the left by default, or where the field aligns", () => {
    render(<DetailFieldLabel title="Timezone" />);
    expect(screen.getByTestId("detail-label")).toHaveClass(
      "flex",
      "justify-start",
    );
    cleanup();

    render(
      <DetailFieldLabel title="Timezone" alignClassName="flex justify-end" />,
    );
    expect(screen.getByTestId("detail-label")).toHaveClass(
      "flex",
      "justify-end",
    );
  });

  test("takes a field's own size in place of the reading size", () => {
    render(<DetailFieldLabel title="Timezone" sizeClassName="text-base" />);

    const label: HTMLElement = screen.getByTestId("detail-label");

    expect(classesOf(label)).toContain("text-base");
    expect(classesOf(label)).not.toContain("text-sm");
  });

  test("with no name there is no label at all", () => {
    render(<DetailFieldLabel description="Only a line." />);

    expect(screen.queryByTestId("detail-label")).toBeNull();
    expect(screen.getByTestId("detail-description")).toHaveTextContent(
      "Only a line.",
    );
  });

  test("reads in the reader's language", () => {
    render(
      <I18nextProvider i18n={german}>
        <DetailFieldLabel
          title="Timezone"
          description="Description"
          sideLink={{ text: "Preview", url: new Route("/preview") }}
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("detail-label").firstElementChild).toHaveTextContent(
      GERMAN_FILE["Timezone"] as string,
    );
    expect(screen.getByTestId("detail-description")).toHaveTextContent(
      GERMAN_FILE["Description"] as string,
    );
    expect(
      screen.getByRole("link", { name: GERMAN_FILE["Preview"] as string }),
    ).toBeInTheDocument();
  });
});

describe("the line under the name", () => {
  test("is a small muted block - a <div>, so an element in it is valid HTML", () => {
    const { container } = render(
      <DetailFieldLabel
        title="Owner"
        description={<div data-testid="rich">The team that owns it</div>}
      />,
    );

    const description: HTMLElement = screen.getByTestId("detail-description");

    expect(description.tagName).toBe("DIV");
    expect(description.className).toContain(
      DETAIL_FIELD_DESCRIPTION_CLASS_NAME,
    );
    expect(classesOf(description)).toEqual(
      expect.arrayContaining(["text-xs", "text-gray-500"]),
    );
    // Readable: gray-400 on white does not reach WCAG AA.
    expect(classesOf(description)).not.toContain("text-gray-400");
    expect(container.querySelector("p")).toBeNull();
    expect(description).toContainElement(screen.getByTestId("rich"));
  });
});

describe("the link beside the name", () => {
  test("sits in the label, after the name, as a quiet indigo link", () => {
    render(
      <DetailFieldLabel
        title="Name"
        sideLink={{ text: "Preview", url: new Route("/status-page/acme") }}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", { name: "Preview" });

    expect(screen.getByTestId("detail-label")).toContainElement(link);
    expect(screen.getByTestId("detail-label").lastElementChild).toBe(link);
    expect(link.className).toContain(DETAIL_FIELD_SIDE_LINK_CLASS_NAME);
    expect(classesOf(link)).toEqual(
      expect.arrayContaining(["text-xs", "text-indigo-600"]),
    );
    expect(link).toHaveAttribute("href", "/status-page/acme");
  });

  test("one that opens a new tab says so with an arrow, and opens one", () => {
    render(
      <DetailFieldLabel
        title="Name"
        sideLink={{
          text: "Preview",
          url: new Route("/status-page/acme"),
          openLinkInNewTab: true,
        }}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", { name: "Preview" });
    const arrow: HTMLElement = within(link).getByTestId(
      "detail-side-link-new-tab",
    );

    expect(link).toHaveAttribute("target", "_blank");
    expect(arrow.tagName.toLowerCase()).toBe("svg");
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    // No <div> inside the link inside the label.
    expect(link.querySelector("div")).toBeNull();
  });

  test("one that stays in the tab has no arrow", () => {
    render(
      <DetailFieldLabel
        title="Name"
        sideLink={{ text: "Change", url: new Route("/settings") }}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", { name: "Change" });

    expect(link).not.toHaveAttribute("target", "_blank");
    expect(within(link).queryByTestId("detail-side-link-new-tab")).toBeNull();
  });

  test("a link without words or an address is not drawn", () => {
    render(
      <DetailFieldLabel
        title="Name"
        sideLink={{ text: "", url: new Route("/settings") }}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("detail-label").textContent).toBe("Name");
  });
});
