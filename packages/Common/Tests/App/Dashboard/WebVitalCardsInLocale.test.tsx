import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
} from "../../../Types/Rum/WebVitals";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import WebVitalsCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/WebVitalsCard";
import WebVitalRouteBreakdownCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/WebVitalRouteBreakdownCard";
import { WebVital } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";

/*
 * THE RUM OVERVIEW'S WEB VITAL CARDS ON A PAGE READ FROM THE RIGHT (#6658,
 * part 3, UI review).
 *
 * On an Arabic page a route and a value read from the left as written:
 * "/checkout/:orderId/payment" and "640 ms", not "checkout/:orderId/payment/"
 * and "ms 640". The route table keeps the page's sides (text-start, pe-4,
 * text-end), so each column lines up under its name; on a German page
 * nothing changes direction.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

function shown(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

function vitalsWith(
  value: (d: WebVitalDefinition) => number | null,
): Array<WebVital> {
  return WebVitalDefinitions.map((d: WebVitalDefinition): WebVital => {
    const reported: number | null = value(d);

    return {
      key: d.key,
      label: d.label,
      description: d.description,
      value: reported,
      unit: d.unit,
      thresholds: d.thresholds,
      metricName: reported === null ? null : d.names[0] || null,
    };
  });
}

const VITALS: Array<WebVital> = vitalsWith((d: WebVitalDefinition) => {
  return d.unit === "ms" ? 640 : 0.12;
});

const INP: WebVital = VITALS.find((vital: WebVital): boolean => {
  return vital.key === "inp";
}) as WebVital;

function renderRoutes(): void {
  render(
    <WebVitalRouteBreakdownCard
      vital={INP}
      loading={false}
      breakdown={{
        routeAttribute: "app.route",
        routes: [
          { route: "/checkout/:orderId/payment", value: 640 },
          { route: "/products/:id", value: 120 },
        ],
        totalRoutes: 2,
        failed: false,
      }}
    />,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      ar: { translation: readLocale("ar") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

afterEach(() => {
  cleanup();
});

describe("the web vitals card's values on a page read from the right", () => {
  test("Arabic: '640 ms' reads from the left; a bare CLS number reads as the page does", async () => {
    await i18next.changeLanguage("ar");
    render(<WebVitalsCard vitals={VITALS} loading={false} />);

    const ms: Array<HTMLElement> = screen.getAllByText(/^640\s?ms$/);
    const cls: HTMLElement = screen.getByText("0.120");

    expect(ms.length).toBeGreaterThan(0);

    for (const value of ms) {
      expect(value.tagName).toBe("SPAN");
      expect(value).toHaveAttribute("dir", "ltr");
    }

    expect(cls.tagName).toBe("SPAN");
    expect(cls).not.toHaveAttribute("dir");
  });

  test("German: no value is given a direction of its own", () => {
    render(<WebVitalsCard vitals={VITALS} loading={false} />);

    for (const value of screen.getAllByText(/^640\s?ms$/)) {
      expect(value).not.toHaveAttribute("dir");
    }
  });
});

describe("the web vital by route table on a page read from the right", () => {
  test("Arabic: each route and its average read from the left, inside cells on the page's sides", async () => {
    await i18next.changeLanguage("ar");
    renderRoutes();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "web-vital-route-row",
    );

    expect(rows).toHaveLength(2);

    const [routeCell, averageCell, ratingCell] = Array.from(
      rows[0]!.querySelectorAll("td"),
    ) as Array<HTMLElement>;
    const route: HTMLElement = routeCell!.querySelector("span") as HTMLElement;
    const average: HTMLElement = averageCell!.querySelector(
      "span",
    ) as HTMLElement;

    expect(shown(route)).toBe("/checkout/:orderId/payment");
    expect(route).toHaveAttribute("dir", "ltr");
    expect(shown(average)).toMatch(/^640\s?ms$/);
    expect(average).toHaveAttribute("dir", "ltr");

    // The cells themselves follow the page: no dir, logical sides only.
    for (const cell of [routeCell!, averageCell!, ratingCell!]) {
      expect(cell).not.toHaveAttribute("dir");
      expect(cell.className).not.toMatch(
        /\b(text-left|text-right|pr-4|pl-4)\b/,
      );
    }

    expect(averageCell!.className.split(" ")).toEqual(
      expect.arrayContaining(["pe-4", "text-end"]),
    );
    expect(ratingCell!.className.split(" ")).toContain("text-end");
  });

  test("the headers sit on the page's sides: Route at the start, Average and Rating at the end", () => {
    renderRoutes();

    const headers: Array<HTMLElement> = Array.from(
      document.querySelectorAll("thead th"),
    ) as Array<HTMLElement>;

    expect(headers).toHaveLength(3);

    for (const header of headers) {
      expect(header.className).not.toMatch(
        /\b(text-left|text-right|pr-4|pl-4|ml-1|mr-1)\b/,
      );
    }

    expect(headers[0]!.className.split(" ")).toEqual(
      expect.arrayContaining(["text-start", "pe-4"]),
    );
    expect(headers[1]!.className.split(" ")).toEqual(
      expect.arrayContaining(["text-end", "pe-4"]),
    );
    expect(headers[2]!.className.split(" ")).toContain("text-end");

    // "(app.route)" after the column's name keeps its gap on either side.
    const attribute: HTMLElement = screen.getByText("(app.route)");

    expect(attribute.className.split(" ")).toContain("ms-1");
  });

  test("German: neither a route nor a value is given a direction of its own", () => {
    renderRoutes();

    const cells: Array<HTMLElement> = Array.from(
      screen.getAllByTestId("web-vital-route-row")[0]!.querySelectorAll("td"),
    ) as Array<HTMLElement>;

    expect(cells[0]!.querySelector("span")).not.toHaveAttribute("dir");
    expect(cells[1]!.querySelector("span")).not.toHaveAttribute("dir");
  });
});
