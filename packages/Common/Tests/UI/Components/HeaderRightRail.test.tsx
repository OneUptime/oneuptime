import Header from "../../../UI/Components/Header/Header";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  describeVisibility,
  isVisibleAtWidth,
  resolveDisplay,
} from "../../ResponsiveVisibility";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";

/*
 * The header's right-hand rail used to live in a `hidden lg:flex` container.
 * Everything the product puts there — search, Ask AI, the notification bell,
 * help and the profile button — was therefore absent from the header on any
 * viewport under 1024px, which is every phone and most tablets. The profile
 * button was the expensive one: it is the only way into the profile menu, and
 * that menu owns admin settings, the theme switch and log out, so a phone user
 * could not sign out of the dashboard at all.
 *
 * What this file pins is the shape of the fix rather than one call site: the
 * rail is always rendered, and a caller that genuinely wants an entry only on
 * wide screens says so on that entry.
 */
describe("Header right-hand rail", () => {
  test("right components are on screen at phone, tablet and laptop widths", () => {
    render(
      <Header
        leftComponents={<span>logo</span>}
        rightComponents={<button type="button">Profile</button>}
      />,
    );

    const profile: HTMLElement = screen.getByRole("button", {
      name: "Profile",
    });

    for (const width of [
      PHONE_WIDTH_IN_PX,
      TABLET_WIDTH_IN_PX,
      LAPTOP_WIDTH_IN_PX,
    ]) {
      expect(describeVisibility(profile, width)).toBe(`visible at ${width}px`);
    }
  });

  test("no ancestor of the rail hides it below a breakpoint", () => {
    const { container } = render(
      <Header rightComponents={<button type="button">Profile</button>} />,
    );

    const rail: HTMLElement = screen.getByRole("button", {
      name: "Profile",
    }).parentElement!;

    /*
     * Asserted on the class attribute, not just on the resolved display: a rail
     * that renders `hidden` and is rescued by a `sm:flex` further along would
     * still blink out on the narrowest phones.
     */
    expect(rail.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(resolveDisplay(rail.getAttribute("class"), 320)).toBe("flex");
    expect(container.querySelectorAll(".hidden")).toHaveLength(0);
  });

  test("an entry can still opt itself out of small screens", () => {
    render(
      <Header
        rightComponents={
          <>
            <div className="hidden items-center lg:flex">
              <button type="button">Ask AI</button>
            </div>
            <button type="button">Profile</button>
          </>
        }
      />,
    );

    const askAi: HTMLElement = screen.getByRole("button", { name: "Ask AI" });
    const profile: HTMLElement = screen.getByRole("button", {
      name: "Profile",
    });

    expect(isVisibleAtWidth(askAi, PHONE_WIDTH_IN_PX)).toBe(false);
    expect(isVisibleAtWidth(askAi, LAPTOP_WIDTH_IN_PX)).toBe(true);

    // ... without dragging its neighbours off the screen with it.
    expect(isVisibleAtWidth(profile, PHONE_WIDTH_IN_PX)).toBe(true);
  });

  test("left and center components still render alongside the rail", () => {
    render(
      <Header
        leftComponents={<span>left</span>}
        centerComponents={<span>center</span>}
        rightComponents={<span>right</span>}
      />,
    );

    expect(screen.getByText("left")).toBeInTheDocument();
    expect(screen.getByText("center")).toBeInTheDocument();
    expect(screen.getByText("right")).toBeInTheDocument();

    for (const label of ["left", "center", "right"]) {
      expect(isVisibleAtWidth(screen.getByText(label), PHONE_WIDTH_IN_PX)).toBe(
        true,
      );
    }
  });

  test("the center slot is skipped entirely when there is nothing in it", () => {
    const { container } = render(
      <Header rightComponents={<span>right</span>} />,
    );

    // Left rail and right rail, and no empty absolutely-positioned middle.
    expect(container.querySelectorAll("div.sm\\:absolute")).toHaveLength(0);
  });

  test("the squeeze falls on the left side, so the rail keeps its buttons", () => {
    /*
     * The dashboard's left side is a 5:1 wordmark next to a project picker;
     * together they are wider than a phone header. Without min-w-0 on the left
     * and flex-shrink-0 on the rail, flexbox resolves that by pushing the row
     * past the viewport instead of truncating the picker, and the buttons this
     * whole fix is about end up off-screen again — this time by overflow rather
     * than by `display: none`.
     */
    render(
      <Header
        leftComponents={<span>logo</span>}
        rightComponents={<button type="button">Profile</button>}
      />,
    );

    const left: HTMLElement = screen.getByText("logo").parentElement!;
    const rail: HTMLElement = screen.getByRole("button", {
      name: "Profile",
    }).parentElement!;

    expect(left.className).toContain("min-w-0");
    expect(rail.className).toContain("flex-shrink-0");
  });

  test("the default header styling is replaced, not merged, by className", () => {
    const { container } = render(
      <Header className="custom-header" rightComponents={<span>right</span>} />,
    );

    expect(container.firstElementChild).toHaveClass("custom-header");
    expect(container.firstElementChild?.className).not.toContain("h-16");
  });
});
