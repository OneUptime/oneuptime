import Icon from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { within } from "@testing-library/react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * Helpers for the tests that hold every menu of a table to "every item has
 * an icon": which glyph an item draws, and whether it draws one at all.
 *
 * A glyph is compared by its drawing - each shape's tag and geometry - not by
 * a class or a test id, so an item that renders the wrong icon, or an empty
 * <svg>, fails as surely as one that renders none.
 */

const SHAPE_ATTRIBUTES: Array<string> = [
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
];

// The drawing inside an <svg>: one entry per shape, in document order.
export const getGlyphOfSvg: (svg: Element | null) => string = (
  svg: Element | null,
): string => {
  if (!svg) {
    return "";
  }

  return Array.from(svg.querySelectorAll("*"))
    .filter((shape: Element) => {
      return SHAPE_ATTRIBUTES.some((attribute: string) => {
        return shape.hasAttribute(attribute);
      });
    })
    .map((shape: Element) => {
      return `${shape.tagName.toLowerCase()}(${SHAPE_ATTRIBUTES.filter(
        (attribute: string) => {
          return shape.hasAttribute(attribute);
        },
      )
        .map((attribute: string) => {
          return `${attribute}=${shape.getAttribute(attribute)}`;
        })
        .join(",")})`;
    })
    .join(" ");
};

// The drawing Icon renders for an IconProp.
export const getGlyphOfIcon: (icon: IconProp) => string = (
  icon: IconProp,
): string => {
  const holder: HTMLDivElement = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(<Icon icon={icon} />);
  return getGlyphOfSvg(holder.querySelector("svg"));
};

// The drawing in a menu item's icon slot, or "" when it has none.
export const getGlyphOfMenuItem: (item: HTMLElement) => string = (
  item: HTMLElement,
): string => {
  return getGlyphOfSvg(item.querySelector("svg"));
};

/*
 * What sits in the item's icon slot: an icon, a colour dot (a state's
 * colour), a mark (a heading's "H1") - or nothing, the gap this work closed.
 */
export type MenuItemIconKind = "icon" | "color" | "mark" | "none";

export const getMenuItemIconKind: (item: HTMLElement) => MenuItemIconKind = (
  item: HTMLElement,
): MenuItemIconKind => {
  if (getGlyphOfMenuItem(item)) {
    return "icon";
  }

  if (item.querySelector('[data-testid="more-menu-item-color"]')) {
    return "color";
  }

  if (item.querySelector('[data-testid="more-menu-item-mark"]')) {
    return "mark";
  }

  return "none";
};

export interface MenuItemIconSummary {
  label: string;
  kind: MenuItemIconKind;
}

// Each item of an open menu, by its label, with what is in its icon slot.
export const getMenuItemIconSummaries: (
  menu: HTMLElement,
) => Array<MenuItemIconSummary> = (
  menu: HTMLElement,
): Array<MenuItemIconSummary> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): MenuItemIconSummary => {
      return {
        label: (item.textContent || "").trim(),
        kind: getMenuItemIconKind(item),
      };
    });
};

// The items of an open menu that have nothing in their icon slot.
export const getMenuItemsWithoutAnIcon: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return getMenuItemIconSummaries(menu)
    .filter((summary: MenuItemIconSummary) => {
      return summary.kind === "none";
    })
    .map((summary: MenuItemIconSummary) => {
      return summary.label;
    });
};

// An open menu's item with this exact label.
export const getMenuItem: (menu: HTMLElement, label: string) => HTMLElement = (
  menu: HTMLElement,
  label: string,
): HTMLElement => {
  const item: HTMLElement | undefined = within(menu)
    .getAllByRole("menuitem")
    .find((candidate: HTMLElement) => {
      return (candidate.textContent || "").trim() === label;
    });

  if (!item) {
    throw new Error(`The menu has no "${label}" item.`);
  }

  return item;
};
