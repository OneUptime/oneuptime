import Icon from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";

type GetIconPathFunction = (icon: IconProp) => string;

const getIconPath: GetIconPathFunction = (icon: IconProp): string => {
  const { container } = render(<Icon icon={icon} />);
  return container.querySelector("path")?.getAttribute("d") || "";
};

/*
 * The chevrons are the whole vocabulary of the pagination arrows and of every
 * "back" button in the dashboard, and they are picked out of one long
 * if/else chain of hand-written path data - which is exactly how ChevronLeft
 * came to be drawing the bulleted-list glyph.
 */
describe("Icon chevrons", () => {
  it("draws a left-pointing chevron for ChevronLeft", () => {
    expect(getIconPath(IconProp.ChevronLeft)).toBe(
      "M15.75 19.5L8.25 12l7.5-7.5",
    );
  });

  it("draws a right-pointing chevron for ChevronRight", () => {
    expect(getIconPath(IconProp.ChevronRight)).toBe(
      "M8.25 4.5l7.5 7.5-7.5 7.5",
    );
  });

  it("draws a down-pointing chevron for ChevronDown", () => {
    expect(getIconPath(IconProp.ChevronDown)).toBe(
      "M19.5 8.25l-7.5 7.5-7.5-7.5",
    );
  });

  it("does not draw a list where a chevron was asked for", () => {
    const listPath: string = getIconPath(IconProp.List);

    expect(getIconPath(IconProp.ChevronLeft)).not.toBe(listPath);
    expect(getIconPath(IconProp.ChevronRight)).not.toBe(listPath);
    expect(getIconPath(IconProp.ChevronDown)).not.toBe(listPath);
  });

  it("gives each chevron its own direction", () => {
    const paths: Array<string> = [
      getIconPath(IconProp.ChevronLeft),
      getIconPath(IconProp.ChevronRight),
      getIconPath(IconProp.ChevronDown),
    ];

    expect(new Set(paths).size).toBe(paths.length);
  });
});
