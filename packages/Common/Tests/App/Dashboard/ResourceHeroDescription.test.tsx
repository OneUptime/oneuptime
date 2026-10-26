import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ResourceHeroDescription from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroDescription";
import {
  RESOURCE_HERO_DESCRIPTION_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroLayout";

/*
 * Follow-up of #5298's UI review: a resource's description under its name
 * in its hero. Four heroes (a Docker Swarm, a vCenter, a Proxmox cluster, an
 * IoT fleet) cut it to one line that never wrapped - half a sentence on a
 * phone, and at 1280 the line claimed the identity's whole width and pushed
 * the refresh control under the name - and the six ResourceOverview pages
 * had it as their Details card's line, hidden on a phone. Every hero now
 * draws it with ResourceHeroDescription: two lines that wrap between words,
 * 20rem from md, laid out by its own script, aligned as the page is. jsdom
 * cannot measure; the browser suites (DockerSwarmPages, ResourceOverviews)
 * do.
 */

const DESCRIPTION: string =
  "Takes the basket to an order: prices it, reserves stock and charges the card.";

function classesOf(element: HTMLElement): Array<string> {
  return element.className.split(" ").filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe("ResourceHeroDescription", () => {
  test("draws the description whole, with its own test id and the shared class", () => {
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    const description: HTMLElement = screen.getByTestId(
      RESOURCE_HERO_DESCRIPTION_TEST_ID,
    );
    expect(description.tagName).toBe("P");
    expect(description.textContent).toBe(DESCRIPTION);
    expect(classesOf(description)).toEqual(
      RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" "),
    );
  });

  test("hovering shows all of it, past its two lines", () => {
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    expect(screen.getByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID)).toHaveAttribute(
      "title",
      DESCRIPTION,
    );
  });

  test("its words are laid out by their own script", () => {
    render(<ResourceHeroDescription text="سرویس پرداخت فروشگاه" />);

    expect(screen.getByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID)).toHaveAttribute(
      "dir",
      "auto",
    );
  });

  test("blank space around it is not drawn", () => {
    render(<ResourceHeroDescription text={`  ${DESCRIPTION}\n`} />);

    expect(
      screen.getByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID).textContent,
    ).toBe(DESCRIPTION);
  });

  test.each([
    ["no description", undefined],
    ["a null one", null],
    ["an empty one", ""],
    ["one of spaces", "   "],
  ])("%s draws nothing, so the hero keeps its height", (_name: string, text: string | null | undefined) => {
    const { container } = render(
      <div data-testid="holder">
        <ResourceHeroDescription text={text} />
      </div>,
    );

    expect(
      screen.queryByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("holder").childNodes).toHaveLength(0);
    expect(container.textContent).toBe("");
  });
});

describe("the description's class", () => {
  const classes: Array<string> = RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" ");

  test("two lines at most, wrapping between words, never one cut line", () => {
    expect(classes).toContain("line-clamp-2");
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("whitespace-nowrap");
    expect(classes).toContain("[overflow-wrap:anywhere]");
    expect(classes).not.toContain("break-all");
  });

  test("asks for 20rem from md, where it shares a row with the controls, and for nothing on a phone", () => {
    expect(classes).toContain("md:min-w-[20rem]");
    // A percentage counts for nothing while the row measures its items.
    expect(RESOURCE_HERO_DESCRIPTION_CLASS_NAME).not.toContain("%");
    for (const className of classes) {
      if (className.startsWith("min-w")) {
        throw new Error(`${className} would hold a phone's column open`);
      }
    }
  });

  test("aligned as the page is: left, right on a right-to-left page", () => {
    expect(classes).toContain("text-left");
    expect(classes).toContain("rtl:text-right");
    // Chromium ignores text-align: match-parent.
    expect(RESOURCE_HERO_DESCRIPTION_CLASS_NAME).not.toContain("match-parent");
  });

  test("set as a card's description is: small, gray", () => {
    expect(classes).toEqual(
      expect.arrayContaining(["mt-1", "text-sm", "text-gray-500"]),
    );
  });
});
