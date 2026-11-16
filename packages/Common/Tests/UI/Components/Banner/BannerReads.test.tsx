/*
 * The shared Banner says what a person has to know where they are: on the
 * Dashboard's Users page and a team's Members, that SCIM Push Groups manage
 * the project's users, so nobody can be invited there; on the Admin
 * Dashboard's Global Probes, Global SSO and LLM Providers pages, where each
 * one's guide is. Its words were gray-400 - 2.5:1, under WCAG AA's 4.5:1 for
 * text - and the banner looked switched off (#9024).
 *
 * Held here without a browser, as SecondaryLinkContrast holds the
 * Dashboard's quiet links, and then drawn: with a link, it reads as one; with
 * none, it ends in no arrow that leads nowhere.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import Banner, {
  BANNER_LINK_CLASS_NAME,
  BANNER_TEXT_CLASS_NAME,
  BANNER_TITLE_CLASS_NAME,
} from "../../../../UI/Components/Banner/Banner";
import Route from "../../../../Types/API/Route";
import {
  DARK_SURFACES,
  LIGHT_SURFACES,
  TOO_LIGHT_GRAY_TEXT,
  WCAG_AA_TEXT,
  darkContrastOf,
  lightContrastOf,
  shadeOf,
} from "../../GrayTextContrast";

afterEach(() => {
  cleanup();
});

const WORDS: Array<[string, string]> = [
  ["its sentence", BANNER_TEXT_CLASS_NAME],
  ["its title", BANNER_TITLE_CLASS_NAME],
];

describe("a banner's words read: WCAG AA in both themes (#9024)", () => {
  describe.each(WORDS)("%s", (_name: string, className: string) => {
    const shade: string = shadeOf(className, "text-gray-");

    test.each(LIGHT_SURFACES)(
      "is at least 4.5:1 on %s",
      (_surface: string, surface: string) => {
        expect(lightContrastOf(shade, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      },
    );

    test.each(DARK_SURFACES)(
      "is at least 4.5:1 on %s in the dark theme",
      (_surface: string, surface: string) => {
        expect(darkContrastOf(shade, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      },
    );

    test("is never gray-400 or lighter again", () => {
      expect(className).not.toMatch(TOO_LIGHT_GRAY_TEXT);
    });
  });

  test("the title stands out from the sentence, as a heading does", () => {
    expect(
      lightContrastOf(shadeOf(BANNER_TITLE_CLASS_NAME, "text-gray-"), "#fff"),
    ).toBeGreaterThan(
      lightContrastOf(shadeOf(BANNER_TEXT_CLASS_NAME, "text-gray-"), "#fff"),
    );
  });

  test("a link darkens and underlines under the pointer, and is ringed when focused", () => {
    expect(
      lightContrastOf(
        shadeOf(BANNER_LINK_CLASS_NAME, "hover:text-gray-"),
        "#fff",
      ),
    ).toBeGreaterThan(
      lightContrastOf(shadeOf(BANNER_TEXT_CLASS_NAME, "text-gray-"), "#fff"),
    );
    expect(BANNER_LINK_CLASS_NAME.split(" ")).toContain("hover:underline");
    expect(BANNER_LINK_CLASS_NAME).toMatch(/focus-visible:ring-2/);
  });
});

describe("a banner, drawn", () => {
  test("a notice with no link: readable words, and no arrow that leads nowhere", () => {
    render(
      <Banner
        title="Users are managed by SCIM Push Groups"
        description="Invite or remove users from your identity provider."
      />,
    );

    const title: HTMLElement = screen.getByText(
      "Users are managed by SCIM Push Groups",
    );

    for (const className of BANNER_TITLE_CLASS_NAME.split(" ")) {
      expect(title).toHaveClass(className);
    }

    const paragraph: HTMLElement = title.closest("p")!;

    for (const className of BANNER_TEXT_CLASS_NAME.split(" ")) {
      expect(paragraph).toHaveClass(className);
    }

    expect(paragraph.className).not.toMatch(TOO_LIGHT_GRAY_TEXT);
    expect(screen.queryByRole("link")).toBeNull();
    expect(paragraph.textContent).not.toMatch(/[→←]/);
    expect(paragraph.textContent).toContain(
      "Invite or remove users from your identity provider.",
    );
  });

  test("a guide's banner is a link that reads as one, and its arrow says it leads on", () => {
    render(
      <Banner
        title="Need help with setting up Global Probes?"
        description="Read the guide to set one up."
        link={Route.fromString("/docs/probe/custom-probe")}
        openInNewTab={true}
      />,
    );

    const link: HTMLElement = screen.getByRole("link");

    expect(link).toHaveAttribute("href", "/docs/probe/custom-probe");
    expect(link).toHaveAttribute("target", "_blank");

    for (const className of BANNER_LINK_CLASS_NAME.split(" ")) {
      expect(link).toHaveClass(className);
    }

    expect(link.textContent).toContain(
      "Need help with setting up Global Probes?",
    );
    expect(link.textContent).toMatch(/[→←]/);
    expect(link.closest("p")!.className).not.toMatch(TOO_LIGHT_GRAY_TEXT);
  });
});
