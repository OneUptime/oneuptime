import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import DashboardHtmlComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardHtmlComponent";
import DashboardHtmlComponent from "../../../Types/Dashboard/DashboardComponents/DashboardHtmlComponent";
import DashboardHtmlComponentUtil from "../../../Utils/Dashboard/Components/DashboardHtmlComponent";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import ThemeUtil, { Theme } from "../../../UI/Utils/Theme";

/*
 * The HTML widget draws its frame in the theme the dashboard is drawn in
 * (DashboardHtmlComponent.tsx, useTheme): a reader's own pick in the
 * dashboard, and a public dashboard's theme. That scheme is the scheme of
 * the document it builds (HtmlWidgetDocument, colorScheme), so on the dark
 * card the frame stays transparent and its text readable. A change of theme
 * while the dashboard is open rebuilds the document, as a change of a
 * variable does.
 */

const renderWidget: () => void = (): void => {
  const component: DashboardHtmlComponent =
    DashboardHtmlComponentUtil.getDefaultComponent();

  component.arguments = {
    ...component.arguments,
    html: "<h3>Release train</h3>",
    css: "",
    javascript: "",
  };

  const props: React.ComponentProps<typeof DashboardHtmlComponentElement> = {
    component,
    componentId: component.componentId as ObjectID,
    isEditMode: false,
    isSelected: false,
    refreshTick: 0,
    variables: [],
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
  } as unknown as React.ComponentProps<typeof DashboardHtmlComponentElement>;

  render(<DashboardHtmlComponentElement {...props} />);
};

const frameDocument: () => string = (): string => {
  const frame: HTMLIFrameElement | null = document.querySelector(
    'iframe[title="HTML widget"]',
  );

  expect(frame).not.toBeNull();

  return frame!.getAttribute("srcdoc") || "";
};

const isDarkDocument: (srcdoc: string) => boolean = (
  srcdoc: string,
): boolean => {
  return new DOMParser()
    .parseFromString(srcdoc, "text/html")
    .documentElement.classList.contains("dark");
};

const withoutTimeRange: (srcdoc: string) => string = (
  srcdoc: string,
): string => {
  return srcdoc
    .split("\n")
    .filter((line: string): boolean => {
      return !line.startsWith("<script>window.ONEUPTIME=");
    })
    .join("\n");
};

afterEach(() => {
  cleanup();
  ThemeUtil.applyTheme(Theme.Light);
});

describe("the HTML widget in the theme the dashboard is drawn in", () => {
  test("on the light page, its document is the light one", () => {
    ThemeUtil.applyTheme(Theme.Light);

    renderWidget();

    expect(isDarkDocument(frameDocument())).toBe(false);
    expect(frameDocument()).not.toContain("color-scheme");
  });

  test("on the dark page, its document is the dark one", () => {
    ThemeUtil.applyTheme(Theme.Dark);

    renderWidget();

    expect(isDarkDocument(frameDocument())).toBe(true);
    expect(frameDocument()).toContain("color-scheme: dark");
  });

  test("a change of theme while the dashboard is open rebuilds it, both ways", () => {
    ThemeUtil.applyTheme(Theme.Light);
    renderWidget();

    const light: string = frameDocument();

    act(() => {
      ThemeUtil.applyTheme(Theme.Dark);
    });

    expect(isDarkDocument(frameDocument())).toBe(true);
    expect(frameDocument()).toContain("color-scheme: dark");

    act(() => {
      ThemeUtil.applyTheme(Theme.Light);
    });

    expect(isDarkDocument(frameDocument())).toBe(false);
    /*
     * The light document it started with. Its time range is read again on a
     * rebuild ("past one hour" against the clock), so that line is left out.
     */
    expect(withoutTimeRange(frameDocument())).toBe(withoutTimeRange(light));
  });

  test("keeps its sandbox whatever the theme: never allow-same-origin", () => {
    ThemeUtil.applyTheme(Theme.Dark);

    renderWidget();

    const frame: HTMLIFrameElement = document.querySelector(
      'iframe[title="HTML widget"]',
    ) as HTMLIFrameElement;

    expect(frame.getAttribute("sandbox") || "").not.toContain(
      "allow-same-origin",
    );
  });
});
