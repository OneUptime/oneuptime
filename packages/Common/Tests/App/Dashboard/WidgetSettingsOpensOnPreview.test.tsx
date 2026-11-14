import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * THE WIDGET SETTINGS DIALOG OPENS ON ITS LIVE PREVIEW.
 *
 * The preview sits above the settings, and each section of the settings
 * is a form of its own. Every one of them put the focus in its first field
 * as it drew, and a browser scrolls a dialog to the field it focuses: a
 * later section's field - the Title of a chart's folded Display Options,
 * or of a funnel's second, open section - opened the dialog 200 to 900
 * pixels down, past the preview. (Folded, the field then turned invisible
 * and the focus fell out of the dialog.) Below a table's columns or a Data
 * Source widget's query, which are the first things to fill in there, the
 * first section's Title did the same. Only the first field of the settings
 * takes the focus now, and only when nothing is drawn above its section.
 *
 * And the widget in the preview is drawn as wide as its box is inside the
 * box's padding: it came out 32 pixels narrower, with three times the gap
 * after it as before it. On a phone, a chart's preview is as tall as a
 * phone's board draws a chart (400 pixels): at 240 its title, series and
 * legend left its plot a line.
 */

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      getItem: () => {
        return Promise.resolve(null);
      },
      count: () => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

import ArgumentsForm from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardChartComponent";
import DashboardDataSourceValueComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceValueComponent";
import DashboardProductAnalyticsFunnelComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsFunnelComponent";
import DashboardSloListComponentUtil from "../../../Utils/Dashboard/Components/DashboardSloListComponent";
import DashboardTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTableComponent";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import { DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX } from "../../../Utils/Dashboard/DashboardBoardLayout";
import {
  PREVIEW_WIDGET_ID,
  PreviewResizeObserver,
  openWidgetSettings,
  previewBox,
} from "./WidgetPreviewHarness";

const TITLE_LABEL: string = "Title (Optional)";

function openSettingsForm(component: DashboardBaseComponent): void {
  render(
    <ArgumentsForm
      component={component}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      onFormChange={() => {}}
    />,
  );
}

// The words of the label of the field that has the focus.
function focusedFieldLabel(): string {
  const focused: Element | null = document.activeElement;

  if (!focused || !focused.id) {
    return "";
  }

  const label: Element | null = document.querySelector(
    `label[for="${focused.id}"]`,
  );

  return (label?.textContent || "").trim();
}

type WidgetCase = [string, () => DashboardBaseComponent];

const WIDGETS_OPENED_ON_NO_FIELD: Array<WidgetCase> = [
  [
    "a chart: the Title of its folded Display Options",
    (): DashboardBaseComponent => {
      return DashboardChartComponentUtil.getDefaultComponent();
    },
  ],
  [
    "a funnel: the Title of its second section, open",
    (): DashboardBaseComponent => {
      return DashboardProductAnalyticsFunnelComponentUtil.getDefaultComponent();
    },
  ],
  [
    "a Data Source value: its Title, below the query",
    (): DashboardBaseComponent => {
      return DashboardDataSourceValueComponentUtil.getDefaultComponent();
    },
  ],
  [
    "a table: its Title, below the columns",
    (): DashboardBaseComponent => {
      return DashboardTableComponentUtil.getDefaultComponent();
    },
  ],
];

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    PreviewResizeObserver;
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

describe("the field that takes the focus as a widget's settings open", () => {
  test.each(WIDGETS_OPENED_ON_NO_FIELD)(
    "%s does not take it",
    (_name: string, makeWidget: () => DashboardBaseComponent) => {
      openSettingsForm(makeWidget());

      const title: HTMLElement = screen.getByLabelText(TITLE_LABEL);

      expect(title).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    },
  );

  test("an SLO list's Title, the first field of its first section, takes it", () => {
    openSettingsForm(DashboardSloListComponentUtil.getDefaultComponent());

    expect(screen.getByLabelText(TITLE_LABEL)).toHaveFocus();
  });

  test("a text widget's Text, the first field of its first section, takes it", () => {
    openSettingsForm(DashboardTextComponentUtil.getDefaultComponent());

    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect(focusedFieldLabel()).toMatch(/^Text\b/);
  });
});

// The box the previewed widget is drawn in, sized by the dialog.
function previewedWidgetBox(): HTMLElement {
  const box: HTMLElement | null =
    previewBox().querySelector<HTMLElement>("div[style]");

  expect(box).not.toBeNull();

  return box!;
}

// A widget of the given kind, 6 units wide and 4 tall, as the board's one.
function widgetOnTheBoard(
  makeWidget: () => DashboardBaseComponent,
): DashboardBaseComponent {
  const widget: DashboardBaseComponent = makeWidget();
  widget.componentId = PREVIEW_WIDGET_ID;
  widget.widthInDashboardUnits = 6;
  widget.heightInDashboardUnits = 4;

  return widget;
}

function makeChart(): DashboardBaseComponent {
  return DashboardChartComponentUtil.getDefaultComponent();
}

function makeText(): DashboardBaseComponent {
  return DashboardTextComponentUtil.getDefaultComponent();
}

// A ResizeObserver that measures a phone's preview: 326 pixels inside the padding.
class PhonePreviewResizeObserver extends PreviewResizeObserver {
  private phoneCallback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    super(callback);
    this.phoneCallback = callback;
  }

  public override observe(): void {
    this.phoneCallback(
      [{ contentRect: { width: 326 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

describe("the Live Preview's size", () => {
  test("the widget is drawn as wide as the preview box is inside its padding", () => {
    // The stand-in ResizeObserver measures 800 pixels inside the padding.
    openWidgetSettings(widgetOnTheBoard(makeText));

    expect(previewedWidgetBox().style.width).toBe("800px");
  });

  test("a chart, wide: its shape, up to 420 pixels tall", () => {
    openWidgetSettings(widgetOnTheBoard(makeChart));

    expect(previewedWidgetBox().style.height).toBe("420px");
  });

  describe("on a phone", () => {
    beforeAll(() => {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        PhonePreviewResizeObserver;
    });

    afterAll(() => {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        PreviewResizeObserver;
    });

    test("a chart is as tall as a phone's board draws one", () => {
      openWidgetSettings(widgetOnTheBoard(makeChart));

      const box: HTMLElement = previewedWidgetBox();

      expect(box.style.width).toBe("326px");
      expect(box.style.height).toBe(
        `${DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX}px`,
      );
    });

    test("a text widget keeps its shape, 240 pixels at the least", () => {
      openWidgetSettings(widgetOnTheBoard(makeText));

      expect(previewedWidgetBox().style.height).toBe("240px");
    });
  });
});
