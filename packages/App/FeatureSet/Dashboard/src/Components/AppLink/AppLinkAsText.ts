import React from "react";

/*
 * Inside it, a link is its words only - no link, nothing to click - drawn
 * as the link is. A dashboard widget's live preview gives it
 * (DashboardWidgetPreview, issue #6859): the preview sits over a board
 * being edited, and a click that went to another page would drop the
 * widgets not saved yet.
 *
 * A module of its own, apart from AppLink's: the preview's provider needs
 * only this, so a page whose AppLink is stood in for - as many suites do,
 * with a plain span - still draws its widgets.
 */
export const AppLinkAsTextContext: React.Context<boolean> =
  React.createContext<boolean>(false);

/*
 * The variants that answer a pointer or a focus. A link that is only its
 * words leaves their classes out - a row's group-hover colour, hover's
 * underline, a focus ring - and a cursor's, so nothing says "click me"
 * where a click does nothing.
 */
const INTERACTION_VARIANTS: ReadonlySet<string> = new Set<string>([
  "hover",
  "group-hover",
  "peer-hover",
  "focus",
  "focus-visible",
  "focus-within",
  "group-focus",
  "active",
  "visited",
]);

// A link's classes, for its words alone: the rest - colour, size, truncate - stays.
export const getAppLinkTextClassName: (
  className: string | undefined,
) => string = (className: string | undefined): string => {
  return (className || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      if (!token) {
        return false;
      }

      const parts: Array<string> = token.split(":");
      const utility: string = (parts[parts.length - 1] || "").replace(/^!/, "");

      return (
        !utility.startsWith("cursor-") &&
        !parts.slice(0, -1).some((variant: string): boolean => {
          return INTERACTION_VARIANTS.has(variant);
        })
      );
    })
    .join(" ");
};
