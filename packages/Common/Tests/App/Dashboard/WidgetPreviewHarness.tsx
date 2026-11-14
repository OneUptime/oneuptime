import { render, RenderResult, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import ComponentSettingsModal, {
  WIDGET_SETTINGS_PREVIEW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal";
import DashboardBaseComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * A widget two ways (issue #6859): in the widget settings dialog's Live
 * Preview, which is drawn over a board being edited, and on the board
 * itself out of edit mode, as a reader sees it. Both are drawn in the
 * app's router, under a page whose address a test can read: a link's
 * click that went somewhere shows there.
 *
 * The suites that use it stand in for the settings form (ArgumentsForm):
 * the preview above it is what they test.
 */

export const PREVIEW_WIDGET_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000006859",
);

export const PREVIEW_DASHBOARD_ID: string =
  "d0000000-0000-4000-8000-000000006859";

// The page the board is on, before any click.
export const BOARD_PATH: string = `/dashboard/project/dashboards/${PREVIEW_DASHBOARD_ID}`;

export const PREVIEW_BOARD_START: Date = new Date("2026-11-01T00:00:00.000Z");
export const PREVIEW_BOARD_END: Date = new Date("2026-11-08T00:00:00.000Z");

export const PREVIEW_BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(PREVIEW_BOARD_START, PREVIEW_BOARD_END),
};

/*
 * jsdom has no ResizeObserver and lays nothing out, and the preview is
 * drawn only once it has measured its box: report a real width.
 */
export class PreviewResizeObserver {
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(): void {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  public unobserve(): void {
    // Nothing to stop observing.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

// The page's address, where a test can read it.
function LocationProbe(): React.ReactElement {
  const location: ReturnType<typeof useLocation> = useLocation();

  return (
    <output data-testid="widget-preview-location">
      {location.pathname + location.search}
    </output>
  );
}

export function currentPath(): string {
  return screen.getByTestId("widget-preview-location").textContent || "";
}

function InRouter(props: { children?: React.ReactNode }): React.ReactElement {
  return (
    <MemoryRouter initialEntries={[BOARD_PATH]}>
      <LocationProbe />
      {props.children}
    </MemoryRouter>
  );
}

export function boardOf(
  component: DashboardBaseComponent,
): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: [component],
    heightInDashboardUnits: 12,
  };
}

export interface WidgetDrawOptions {
  range?: RangeStartAndEndDateTime | undefined;
  /*
   * The board while it is edited, where a click on a widget opens its
   * settings (issue #7160). Out of edit mode unless asked.
   */
  isEditMode?: boolean | undefined;
}

/*
 * The widget settings dialog of the board's one widget, as the canvas
 * opens it while the board is edited.
 */
export function openWidgetSettings(
  component: DashboardBaseComponent,
  options?: WidgetDrawOptions,
): RenderResult {
  return render(
    <ComponentSettingsModal
      title="Component Settings"
      componentId={component.componentId}
      dashboardViewConfig={boardOf(component)}
      onClose={() => {}}
      onComponentUpdate={() => {}}
      onComponentDelete={() => {}}
      onComponentDuplicate={() => {}}
      dashboardStartAndEndDate={options?.range || PREVIEW_BOARD_RANGE}
      totalCurrentDashboardWidthInPx={1280}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      variables={[]}
    />,
    { wrapper: InRouter },
  );
}

// The Live Preview's box in the open dialog.
export function previewBox(): HTMLElement {
  return within(screen.getByTestId("modal")).getByTestId(
    WIDGET_SETTINGS_PREVIEW_TEST_ID,
  );
}

export const BOARD_CARD_TEST_ID: string = "widget-preview-board-card";

/*
 * The same widget on the board, out of edit mode: as a reader sees it - or,
 * with isEditMode, as the board being edited draws it. A test that moves
 * the board in or out of edit mode rerenders this in place.
 */
export function widgetOnBoard(
  component: DashboardBaseComponent,
  options?: WidgetDrawOptions,
): React.ReactElement {
  return (
    <div data-testid={BOARD_CARD_TEST_ID} style={{ width: 768 }}>
      <DashboardBaseComponentElement
        componentId={component.componentId}
        key={component.componentId.toString()}
        isEditMode={Boolean(options?.isEditMode)}
        isSelected={false}
        onClick={() => {}}
        onComponentUpdate={() => {}}
        totalCurrentDashboardWidthInPx={1280}
        dashboardCanvasTopInPx={0}
        dashboardCanvasLeftInPx={0}
        dashboardCanvasWidthInPx={768}
        dashboardCanvasHeightInPx={480}
        dashboardComponentWidthInPx={768}
        dashboardComponentHeightInPx={480}
        dashboardViewConfig={boardOf(component)}
        dashboardStartAndEndDate={options?.range || PREVIEW_BOARD_RANGE}
        metricTypes={[]}
        refreshTick={0}
        variables={[]}
        dashboardId={PREVIEW_DASHBOARD_ID}
        dndActiveMode={null}
        isAnyGestureActive={false}
        onMovePointerDown={() => {}}
        onResizePointerDown={() => {}}
      />
    </div>
  );
}

export function drawWidgetOnBoard(
  component: DashboardBaseComponent,
  options?: WidgetDrawOptions,
): RenderResult {
  return render(widgetOnBoard(component, options), { wrapper: InRouter });
}

export function boardCard(): HTMLElement {
  return screen.getByTestId(BOARD_CARD_TEST_ID);
}

// Every link in a part of the page: an <a>, with an address or not.
export function linksIn(element: HTMLElement): Array<HTMLAnchorElement> {
  return Array.from(element.querySelectorAll("a"));
}

// Whatever says it is a button without being one: a tile, a map's marker.
export function roleButtonsIn(element: HTMLElement): Array<HTMLElement> {
  return Array.from(
    element.querySelectorAll<HTMLElement>('[role="button"]'),
  ).filter((node: HTMLElement): boolean => {
    return node.tagName !== "BUTTON";
  });
}
