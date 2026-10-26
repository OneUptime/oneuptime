import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import ResourceHeroDescription from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroDescription";
import {
  RESOURCE_HERO_DESCRIPTION_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
  RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TOGGLE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroLayout";

/*
 * Follow-up of #5298's UI review: a resource's description under its name
 * in its hero. Four heroes (a Docker Swarm, a vCenter, a Proxmox cluster, an
 * IoT fleet) cut it to one line that never wrapped - half a sentence on a
 * phone, and at 1280 the line claimed the identity's whole width and pushed
 * the refresh control under the name - and the six ResourceOverview pages
 * had it as their Details card's line, hidden on a phone. Every hero now
 * draws it with ResourceHeroDescription: two lines that wrap between words,
 * 20rem from md, laid out by its own script, aligned as the page is.
 *
 * The UI review added "Show more": the rest of a longer description was in
 * a hover title only, which a phone, a tablet and a keyboard never show.
 * jsdom lays nothing out, so the paragraph's heights are given here; the
 * browser suites (DockerSwarmPages, ResourceOverviews) measure the real ones.
 */

const DESCRIPTION: string =
  "Takes the basket to an order: prices it, reserves stock and charges the card.";

// Two lines of the hero's text-sm (20px each), and what a long one needs.
const TWO_LINES_PX: number = 40;
const FOUR_LINES_PX: number = 80;

function classesOf(element: HTMLElement): Array<string> {
  return element.className.split(" ").filter(Boolean);
}

function description(): HTMLElement {
  return screen.getByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID);
}

function toggle(): HTMLElement | null {
  return screen.queryByTestId(RESOURCE_HERO_DESCRIPTION_TOGGLE_TEST_ID);
}

interface DescriptionLayout {
  // The paragraph's height with every line drawn.
  setFullHeight: (height: number) => void;
  restore: () => void;
}

/*
 * The description's heights as a browser lays them out: all of it when
 * opened, at most two lines while it carries the two-line clamp.
 */
function installDescriptionLayout(fullHeight: number): DescriptionLayout {
  let currentFullHeight: number = fullHeight;

  const isDescription: (element: Element) => boolean = (
    element: Element,
  ): boolean => {
    return (
      element.getAttribute("data-testid") === RESOURCE_HERO_DESCRIPTION_TEST_ID
    );
  };

  const scrollHeight: SpyInstance<() => number> = jest
    .spyOn(Element.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: Element): number {
      return isDescription(this) ? currentFullHeight : 0;
    });
  const clientHeight: SpyInstance<() => number> = jest
    .spyOn(Element.prototype, "clientHeight", "get")
    .mockImplementation(function (this: Element): number {
      if (!isDescription(this)) {
        return 0;
      }

      return this.classList.contains(
        RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
      )
        ? Math.min(currentFullHeight, TWO_LINES_PX)
        : currentFullHeight;
    });

  return {
    setFullHeight: (height: number): void => {
      currentFullHeight = height;
    },
    restore: (): void => {
      scrollHeight.mockRestore();
      clientHeight.mockRestore();
    },
  };
}

let layout: DescriptionLayout | null = null;

afterEach(() => {
  cleanup();
  layout?.restore();
  layout = null;
});

describe("ResourceHeroDescription", () => {
  test("draws the description whole, with its own test id and the shared classes, two lines to start with", () => {
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    expect(description().tagName).toBe("P");
    expect(description().textContent).toBe(DESCRIPTION);
    expect(classesOf(description())).toEqual([
      ...RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" "),
      RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
    ]);
  });

  test("its words are laid out by their own script", () => {
    render(<ResourceHeroDescription text="سرویس پرداخت فروشگاه" />);

    expect(description()).toHaveAttribute("dir", "auto");
  });

  test("blank space around it is not drawn", () => {
    render(<ResourceHeroDescription text={`  ${DESCRIPTION}\n`} />);

    expect(description().textContent).toBe(DESCRIPTION);
  });

  test("the rest is never in a hover title only, which a phone or a keyboard never shows", () => {
    layout = installDescriptionLayout(FOUR_LINES_PX);
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    expect(description()).not.toHaveAttribute("title");
    expect(toggle()).toBeInTheDocument();
  });

  test.each([
    ["no description", undefined],
    ["a null one", null],
    ["an empty one", ""],
    ["one of spaces", "   "],
  ])(
    "%s draws nothing, so the hero keeps its height",
    (_name: string, text: string | null | undefined) => {
      const { container } = render(
        <div data-testid="holder">
          <ResourceHeroDescription text={text} />
        </div>,
      );

      expect(
        screen.queryByTestId(RESOURCE_HERO_DESCRIPTION_TEST_ID),
      ).not.toBeInTheDocument();
      expect(toggle()).not.toBeInTheDocument();
      expect(screen.getByTestId("holder").childNodes).toHaveLength(0);
      expect(container.textContent).toBe("");
    },
  );
});

describe("Show more: the rest of a description longer than two lines", () => {
  test("a description that fits its two lines has no Show more", () => {
    layout = installDescriptionLayout(TWO_LINES_PX);
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    expect(toggle()).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a longer one ends in Show more, a button that says what it opens", () => {
    layout = installDescriptionLayout(FOUR_LINES_PX);
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Show more",
    });
    expect(button).toBe(toggle());
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", description().id);
    expect(description().id).not.toBe("");
    expect(classesOf(button)).toEqual(
      RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME.split(" "),
    );
    // Under the words, not inside them: the description reads as written.
    expect(description().textContent).toBe(DESCRIPTION);
    expect(description().nextElementSibling).toBe(button);
    expect(classesOf(description())).toContain(
      RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
    );
  });

  test("Show more opens all of it, and Show less closes it again", () => {
    layout = installDescriptionLayout(FOUR_LINES_PX);
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    const opened: HTMLElement = screen.getByRole("button", {
      name: "Show less",
    });
    expect(opened).toHaveAttribute("aria-expanded", "true");
    expect(classesOf(description())).not.toContain(
      RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
    );
    expect(classesOf(description())).toEqual(
      RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" "),
    );

    fireEvent.click(opened);

    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(classesOf(description())).toContain(
      RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
    );
  });

  test("opened, it keeps Show less for the reader who opened it", () => {
    layout = installDescriptionLayout(FOUR_LINES_PX);
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    // A wider window would fit it in two lines now; the reader still closes it.
    layout.setFullHeight(TWO_LINES_PX);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });

  test("measured again when its box changes: a description that comes to fit loses Show more, one that no longer fits gains it", () => {
    layout = installDescriptionLayout(TWO_LINES_PX);
    render(<ResourceHeroDescription text={DESCRIPTION} />);
    expect(toggle()).not.toBeInTheDocument();

    // The window narrows (a phone turned upright): four lines now.
    layout.setFullHeight(FOUR_LINES_PX);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();

    // And wider again.
    layout.setFullHeight(TWO_LINES_PX);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(toggle()).not.toBeInTheDocument();
  });

  test("a sub-pixel difference between the heights is not a longer description", () => {
    layout = installDescriptionLayout(TWO_LINES_PX + 1);
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    expect(toggle()).not.toBeInTheDocument();
  });

  test("a different description (the resource was edited) starts collapsed", () => {
    layout = installDescriptionLayout(FOUR_LINES_PX);
    const { rerender } = render(<ResourceHeroDescription text={DESCRIPTION} />);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();

    rerender(
      <ResourceHeroDescription text="Reserves stock for every basket across the three EU warehouses." />,
    );

    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(classesOf(description())).toContain(
      RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
    );
  });

  test("the keyboard reaches it: it is a real button, in the page's tab order", () => {
    layout = installDescriptionLayout(FOUR_LINES_PX);
    render(<ResourceHeroDescription text={DESCRIPTION} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Show more",
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button).not.toHaveAttribute("tabindex");
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe("the description's classes", () => {
  const classes: Array<string> =
    RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" ");

  test("two lines while collapsed, wrapping between words, never one cut line", () => {
    expect(RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME).toBe("line-clamp-2");
    expect(classes).not.toContain("line-clamp-2");
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

  test("Show more's words start where the description's do, on either side of a page, and never wrap", () => {
    const toggleClasses: Array<string> =
      RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME.split(" ");
    // The inline start's pull, as wide as its own padding.
    expect(toggleClasses).toEqual(
      expect.arrayContaining(["-ms-1.5", "px-1.5", "whitespace-nowrap"]),
    );
    expect(RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME).not.toContain("-ml-");
    // A visible focus ring for the keyboard.
    expect(toggleClasses).toEqual(
      expect.arrayContaining([
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
      ]),
    );
  });
});
