/*
 * A status page's event card - an incident, an announcement, a maintenance
 * event, on the overview and on each list - ends with the way to its own
 * page, "View Incident", and frames its resources with "Affected
 * resources". Both were gray-400: 2.5:1 on the white card, under WCAG AA's
 * 4.5:1 for text, and the one link a visitor needs read as switched off.
 * So was the uptime bars' shared scale, "90 days ago" ... "Today" (#9016).
 *
 * Held here without a browser, as SecondaryLinkContrast holds the
 * Dashboard's quiet links: each colour as the Tailwind palette paints it on
 * the light cards these sit on, and as Theme.css repaints it in the dark
 * theme on its card surfaces - each at least 4.5:1. Then an event card is
 * drawn, to see that its link, its label and its mini description carry
 * those classes.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as React from "react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Color, { RGB } from "../../../Types/Color";
import Route from "../../../Types/API/Route";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import StatusPageGroupNestingLayoutUtil from "../../../Utils/StatusPage/GroupNestingLayout";
import EventItem, {
  EVENT_ITEM_QUIET_TEXT_CLASS_NAME,
  EVENT_ITEM_VIEW_LINK_CLASS_NAME,
} from "../../../UI/Components/EventItem/EventItem";

// Tailwind 3.4's grays, as the status page's Tailwind build paints them.
const TAILWIND_GRAYS: Record<string, string> = {
  "gray-50": "#f9fafb",
  "gray-100": "#f3f4f6",
  "gray-200": "#e5e7eb",
  "gray-300": "#d1d5db",
  "gray-400": "#9ca3af",
  "gray-500": "#6b7280",
  "gray-600": "#4b5563",
  "gray-700": "#374151",
  "gray-800": "#1f2937",
  "gray-900": "#111827",
};

const WCAG_AA_TEXT: number = 4.5;

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
  "utf8",
);

function rgb(color: string): RGB {
  const parsed: RGB | null = parseColor(color);

  if (!parsed) {
    throw new Error(`Not a colour: ${color}`);
  }

  return parsed;
}

// The gray shade ("600") a class list names with a prefix ("text-gray-").
function shadeOf(className: string, prefix: string): string {
  const token: string | undefined = className
    .split(" ")
    .find((part: string): boolean => {
      return part.startsWith(prefix);
    });

  if (!token) {
    throw new Error(`No ${prefix} class in "${className}"`);
  }

  return token.slice(prefix.length);
}

function lightGray(shade: string): string {
  const hex: string | undefined = TAILWIND_GRAYS[`gray-${shade}`];

  if (!hex) {
    throw new Error(`Not a gray Tailwind paints: gray-${shade}`);
  }

  return hex;
}

// The body of the first rule whose selector is exactly `selector`.
function ruleBody(selector: string): string {
  const start: number = THEME_CSS.indexOf(`${selector} {`);

  if (start === -1) {
    throw new Error(`Theme.css has no "${selector}" rule`);
  }

  const open: number = THEME_CSS.indexOf("{", start);
  const close: number = THEME_CSS.indexOf("}", open);

  return THEME_CSS.slice(open + 1, close);
}

// A custom property's value in a rule's body.
function tokenIn(body: string, token: string): string {
  const at: number = body.indexOf(`${token}:`);

  if (at === -1) {
    throw new Error(`No ${token} in the rule`);
  }

  const end: number = body.indexOf(";", at);

  return body.slice(at + token.length + 1, end).trim();
}

// The colour Theme.css gives a gray text class in the dark theme.
function darkTextColorOf(shade: string): string {
  const selector: string = `html.dark :is(.text-gray-${shade}`;
  const at: number = THEME_CSS.indexOf(selector);

  if (at === -1) {
    throw new Error(
      `Theme.css repaints no .text-gray-${shade} in the dark theme`,
    );
  }

  const open: number = THEME_CSS.indexOf("{", at);
  const close: number = THEME_CSS.indexOf("}", open);
  const declaration: string = THEME_CSS.slice(open + 1, close)
    .replace("!important", "")
    .trim();
  const value: string = declaration
    .slice(declaration.indexOf(":") + 1, declaration.indexOf(";"))
    .trim();

  if (value.startsWith("var(")) {
    const token: string = value.slice(4, value.indexOf(")")).trim();
    return tokenIn(ruleBody("html.dark"), token);
  }

  return value;
}

const LIGHT_SURFACES: Array<[string, string]> = [
  ["a white card", "#ffffff"],
  ["a gray-50 page", TAILWIND_GRAYS["gray-50"]!],
];

const DARK_SURFACES: Array<[string, string]> = [
  ["the dark card", tokenIn(ruleBody("html.dark"), "--ou-surface-primary")],
  ["a dark panel", tokenIn(ruleBody("html.dark"), "--ou-surface-secondary")],
];

// What is held to 4.5:1, with the class list that paints it.
const QUIET_TEXTS: Array<[string, string]> = [
  [
    "View Incident, the card's way to its page",
    EVENT_ITEM_VIEW_LINK_CLASS_NAME,
  ],
  [
    "Affected resources and the mini description",
    EVENT_ITEM_QUIET_TEXT_CLASS_NAME,
  ],
  [
    "the uptime bars' scale, 90 days ago ... Today",
    StatusPageGroupNestingLayoutUtil.getTimeAxisClassName(),
  ],
];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("a status page's event card reads: WCAG AA in both themes (#9016)", () => {
  describe.each(QUIET_TEXTS)("%s", (_name: string, className: string) => {
    const shade: string = shadeOf(className, "text-gray-");

    test.each(LIGHT_SURFACES)(
      "is at least 4.5:1 on %s",
      (_surface: string, surface: string) => {
        expect(
          getContrastRatio(rgb(lightGray(shade)), rgb(surface)),
        ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      },
    );

    test.each(DARK_SURFACES)(
      "is at least 4.5:1 on %s in the dark theme",
      (_surface: string, surface: string) => {
        expect(
          getContrastRatio(rgb(darkTextColorOf(shade)), rgb(surface)),
        ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      },
    );

    test("is never gray-400 or lighter again", () => {
      expect(className).not.toMatch(/(^|\s)text-gray-(50|100|200|300|400)\b/);
    });
  });

  test("gray-400, what they were, is under 4.5:1 on white: the reason for all this", () => {
    expect(
      getContrastRatio(rgb(TAILWIND_GRAYS["gray-400"]!), rgb("#ffffff")),
    ).toBeLessThan(WCAG_AA_TEXT);
  });

  test("the pointer darkens the link and underlines it, and focus rings it", () => {
    const hover: string = shadeOf(
      EVENT_ITEM_VIEW_LINK_CLASS_NAME,
      "hover:text-gray-",
    );

    expect(
      getContrastRatio(rgb(lightGray(hover)), rgb("#ffffff")),
    ).toBeGreaterThan(
      getContrastRatio(
        rgb(lightGray(shadeOf(EVENT_ITEM_VIEW_LINK_CLASS_NAME, "text-gray-"))),
        rgb("#ffffff"),
      ),
    );
    expect(EVENT_ITEM_VIEW_LINK_CLASS_NAME.split(" ")).toContain(
      "hover:underline",
    );
    expect(EVENT_ITEM_VIEW_LINK_CLASS_NAME).toMatch(/focus-visible:ring-2/);
  });

  test("the scale stays a scale: as small as it was, quiet in size and not in contrast", () => {
    const axis: string =
      StatusPageGroupNestingLayoutUtil.getTimeAxisClassName();

    expect(axis.split(" ")).toContain("text-[11px]");
    expect(axis.split(" ")).toContain("justify-between");
  });
});

describe("an event card carries those classes", () => {
  function renderCard(): void {
    render(
      <EventItem
        eventTitle="Webhook deliveries are delayed"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        isDetailItem={false}
        eventSecondDescription="Declared at Nov 16 2026, 11:44 GMT"
        eventMiniDescription="Updated a minute ago"
        eventResourcesAffected={["Webhooks"]}
        eventViewRoute={Route.fromString(
          "/status-page/00000000-0000-4000-8000-000000000001/incidents/00000000-0000-4000-8000-000000000500",
        )}
        eventTimeline={[]}
      />,
    );
  }

  test("its View link is the quiet link that reads, and goes to the event", () => {
    renderCard();

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Incident",
    });

    for (const className of EVENT_ITEM_VIEW_LINK_CLASS_NAME.split(" ")) {
      expect(link).toHaveClass(className);
    }

    expect(link).not.toHaveClass("text-gray-400");
    expect(link).toHaveAttribute(
      "href",
      "/status-page/00000000-0000-4000-8000-000000000001/incidents/00000000-0000-4000-8000-000000000500",
    );
  });

  test("Affected resources and the mini description are the quiet text that reads", () => {
    renderCard();

    for (const words of ["Affected resources", "Updated a minute ago"]) {
      const element: HTMLElement = screen.getByText(words);

      for (const className of EVENT_ITEM_QUIET_TEXT_CLASS_NAME.split(" ")) {
        expect(element).toHaveClass(className);
      }

      expect(element).not.toHaveClass("text-gray-400");
    }
  });

  test("a card with no page to go to draws no link", () => {
    render(
      <EventItem
        eventTitle="Database upgrade"
        eventType="Scheduled Maintenance"
        eventTypeColor={new Color("#f59e0b")}
        isDetailItem={true}
        eventSecondDescription="Scheduled at Nov 16 2026, 12:44 GMT"
        eventTimeline={[]}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });
});
