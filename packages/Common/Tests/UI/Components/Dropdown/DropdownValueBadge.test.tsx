import DropdownValueBadge from "../../../../UI/Components/Dropdown/DropdownValueBadge";
import Color from "../../../../Types/Color";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

describe("DropdownValueBadge", () => {
  test("keeps the existing indigo appearance when no color is configured", () => {
    render(<DropdownValueBadge label="High" />);

    const badge: HTMLElement = screen.getByText("High");
    expect(badge.classList.contains("bg-indigo-50")).toBe(true);
    expect(badge.classList.contains("text-indigo-700")).toBe(true);
    expect(badge.getAttribute("data-dropdown-value-color")).toBeNull();
  });

  test("uses a configured Color as the badge background and border", () => {
    render(
      <DropdownValueBadge label="Critical" color={new Color("#dc2626")} />,
    );

    const badge: HTMLElement = screen.getByText("Critical");
    expect(badge.style.backgroundColor).toEqual("rgb(220, 38, 38)");
    expect(badge.style.borderColor).toEqual("#dc2626");
    expect(badge.getAttribute("data-dropdown-value-color")).toEqual("#dc2626");
  });

  test("also accepts a serialized color string", () => {
    render(<DropdownValueBadge label="Warning" color="#f97316" />);

    expect(screen.getByText("Warning").style.backgroundColor).toEqual(
      "rgb(249, 115, 22)",
    );
  });

  test("uses light text on a dark background", () => {
    render(<DropdownValueBadge label="Dark" color="#1e293b" />);

    expect(screen.getByText("Dark").style.color).toEqual("rgb(249, 250, 251)");
  });

  test("uses dark text on a light background", () => {
    render(<DropdownValueBadge label="Light" color="#fef08a" />);

    expect(screen.getByText("Light").style.color).toEqual("rgb(17, 24, 39)");
  });

  test("falls back safely when given an invalid color", () => {
    render(<DropdownValueBadge label="Invalid" color="not-a-color" />);

    const badge: HTMLElement = screen.getByText("Invalid");
    expect(badge.classList.contains("bg-indigo-50")).toBe(true);
    expect(badge.classList.contains("text-indigo-700")).toBe(true);
    expect(badge.getAttribute("data-dropdown-value-color")).toBeNull();
  });
});
