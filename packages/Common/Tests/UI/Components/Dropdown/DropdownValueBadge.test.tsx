import DropdownValueBadge from "../../../../UI/Components/Dropdown/DropdownValueBadge";
import {
  getPillColors,
  PillColors,
} from "../../../../UI/Components/Pill/PillColors";
import Color from "../../../../Types/Color";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

function getDot(badge: HTMLElement): HTMLElement {
  const dot: HTMLElement | null = badge.querySelector<HTMLElement>(
    'span[aria-hidden="true"]',
  );

  if (!dot) {
    throw new Error("The badge rendered no dot");
  }

  return dot;
}

describe("DropdownValueBadge", () => {
  test("keeps the existing indigo appearance when no color is configured", () => {
    render(<DropdownValueBadge label="High" />);

    const badge: HTMLElement = screen.getByText("High");
    expect(badge.classList.contains("bg-indigo-50")).toBe(true);
    expect(badge.classList.contains("text-indigo-700")).toBe(true);
    expect(badge.getAttribute("data-dropdown-value-color")).toBeNull();
    expect(badge).not.toHaveAttribute("data-ou-pill");
    expect(getDot(badge)).toHaveClass("bg-indigo-500");
  });

  test("paints a configured Color the way a Pill does", () => {
    const colors: PillColors = getPillColors("#dc2626");
    render(
      <DropdownValueBadge label="Critical" color={new Color("#dc2626")} />,
    );

    const badge: HTMLElement = screen.getByText("Critical");
    expect(badge).toHaveStyle({
      backgroundColor: colors.light.backgroundColor,
      color: colors.light.textColor,
    });
    expect(badge.style.boxShadow).toBe(
      `inset 0 0 0 1px ${colors.light.ringColor}`,
    );
    expect(badge.getAttribute("data-dropdown-value-color")).toEqual("#dc2626");
  });

  test("the dot is the configured colour itself", () => {
    render(
      <DropdownValueBadge label="Critical" color={new Color("#dc2626")} />,
    );

    expect(getDot(screen.getByText("Critical"))).toHaveStyle({
      backgroundColor: "#dc2626",
    });
  });

  test("is a tint with a ring, not the old solid fill and border", () => {
    render(<DropdownValueBadge label="Critical" color="#dc2626" />);

    const badge: HTMLElement = screen.getByText("Critical");
    expect(badge.style.backgroundColor).toMatch(/^rgba\(.+, 0\.\d+\)$/);
    expect(badge.style.borderColor).toBe("");
    expect(badge).not.toHaveClass("border");
  });

  test("also accepts a serialized color string", () => {
    render(<DropdownValueBadge label="Warning" color="#f97316" />);

    expect(getDot(screen.getByText("Warning"))).toHaveStyle({
      backgroundColor: "#f97316",
    });
    expect(screen.getByText("Warning")).toHaveStyle({
      color: getPillColors("#f97316").light.textColor,
    });
  });

  test("keeps a dark colour as its own text colour", () => {
    // Slate already reads on its pale wash.
    render(<DropdownValueBadge label="Dark" color="#1e293b" />);

    expect(screen.getByText("Dark")).toHaveStyle({ color: "#1e293b" });
  });

  test("sets a light colour's text in a deeper, readable shade of it", () => {
    render(<DropdownValueBadge label="Light" color="#fef08a" />);

    const textColor: string = getPillColors("#fef08a").light.textColor;
    expect(textColor).not.toBe("#fef08a");
    expect(screen.getByText("Light")).toHaveStyle({ color: textColor });
  });

  test("carries the dark theme's colours for Theme.css", () => {
    const colors: PillColors = getPillColors("#dc2626");
    render(<DropdownValueBadge label="Critical" color="#dc2626" />);

    const badge: HTMLElement = screen.getByText("Critical");
    expect(badge).toHaveAttribute("data-ou-pill");
    expect(badge.style.getPropertyValue("--ou-pill-dark-bg")).toBe(
      colors.dark.backgroundColor,
    );
    expect(badge.style.getPropertyValue("--ou-pill-dark-text")).toBe(
      colors.dark.textColor,
    );
    expect(getDot(badge)).toHaveAttribute("data-ou-pill-dot");
    expect(getDot(badge).style.getPropertyValue("--ou-pill-dark-dot")).toBe(
      colors.dark.dotColor,
    );
  });

  test("falls back safely when given an invalid color", () => {
    render(<DropdownValueBadge label="Invalid" color="not-a-color" />);

    const badge: HTMLElement = screen.getByText("Invalid");
    expect(badge.classList.contains("bg-indigo-50")).toBe(true);
    expect(badge.classList.contains("text-indigo-700")).toBe(true);
    expect(badge.getAttribute("data-dropdown-value-color")).toBeNull();
    expect(badge).not.toHaveAttribute("data-ou-pill");
  });
});
