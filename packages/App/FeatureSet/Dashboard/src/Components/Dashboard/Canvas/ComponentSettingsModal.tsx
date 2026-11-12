import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { withDashboardWidgetSavedSort } from "Common/Utils/Dashboard/DashboardWidgetSorts";
import DashboardBoardLayoutUtil, {
  DASHBOARD_STACKED_BELOW_WIDTH_IN_PX,
  DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX,
} from "Common/Utils/Dashboard/DashboardBoardLayout";
import { DashboardWidgetSortColumns } from "Common/Types/Dashboard/DashboardWidgetSort";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import DeleteConfirmationMessage from "Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import {
  readDisplayText,
  shortenDisplayName,
} from "Common/UI/Utils/ModelDisplayName";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import ArgumentsForm from "./ArgumentsForm";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardBaseComponentElement from "../Components/DashboardBaseComponent";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRangeZoomUtil from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { isDashboardComponentType } from "Common/Types/Dashboard/DashboardComponentType";
import { getWidgetTypeBadgeText } from "../Toolbar/WidgetCatalog";
import ContainedErrorBoundary from "Common/UI/Components/ContainedErrorBoundary/ContainedErrorBoundary";

/*
 * The settings a widget is titled by, by kind of widget: most call it
 * `title`, charts `chartTitle`, tables `tableTitle`, gauges `gaugeTitle` and
 * the SLO widget `widgetTitle`.
 */
export const WIDGET_TITLE_ARGUMENTS: ReadonlyArray<string> = [
  "title",
  "chartTitle",
  "widgetTitle",
  "tableTitle",
  "gaugeTitle",
];

/*
 * What the widget is called on the dashboard, or "" when it has no title -
 * the name the Delete Widget confirmation uses.
 */
export const getWidgetDisplayName: (
  component: DashboardBaseComponent | undefined,
) => string = (component: DashboardBaseComponent | undefined): string => {
  const widgetArguments: Record<string, unknown> =
    (component?.arguments as Record<string, unknown> | undefined) || {};

  for (const key of WIDGET_TITLE_ARGUMENTS) {
    const title: string = readDisplayText(widgetArguments[key]);

    if (title) {
      return shortenDisplayName(title);
    }
  }

  return "";
};

export const WIDGET_SETTINGS_TYPE_BADGE_TEST_ID: string =
  "widget-settings-type";

export const WIDGET_SETTINGS_SIZE_TEST_ID: string = "widget-settings-size";

// The Live Preview's box, which the widget is drawn in.
export const WIDGET_SETTINGS_PREVIEW_TEST_ID: string =
  "widget-settings-preview";

/*
 * The line under the dialog's title: which kind of widget it is and its
 * size, wrapping onto a second line before either is cut on a phone.
 */
export const WIDGET_SETTINGS_SUMMARY_CLASS_NAME: string =
  "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1";

// The kind of widget: cut at its end only when it is wider than the whole line.
export const WIDGET_SETTINGS_TYPE_BADGE_CLASS_NAME: string =
  "inline-block min-w-0 max-w-full truncate rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700";

export interface ComponentProps {
  title: string;
  onClose: () => void;
  onComponentUpdate: (component: DashboardBaseComponent) => void;
  onComponentDelete: (component: DashboardBaseComponent) => void;
  onComponentDuplicate: (component: DashboardBaseComponent) => void;
  componentId: ObjectID;
  dashboardViewConfig: DashboardViewConfig;
  variables?: Array<DashboardVariable> | undefined;
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  totalCurrentDashboardWidthInPx: number;
  metrics: {
    metricTypes: Array<MetricType>;
    telemetryAttributes: string[];
  };
}

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const component: DashboardBaseComponent | undefined = (
    props.dashboardViewConfig.components || []
  ).find((component: DashboardBaseComponent) => {
    return component.componentId.toString() === props.componentId.toString();
  });

  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    useState<boolean>(false);

  /*
   * The width the previewed widget is drawn at: the width inside the
   * preview box's padding. It is read off an element with no padding of
   * its own, so the first read (clientWidth) and the ResizeObserver's (its
   * content box) agree. Read off the padded box, the first counted the
   * padding and the second did not, and the widget came out 32 pixels
   * narrower than its box, three times the gap after it as before it.
   */
  const previewContainerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState<number>(0);

  useEffect(() => {
    const el: HTMLDivElement | null = previewContainerRef.current;
    if (!el) {
      return undefined;
    }
    setPreviewWidth(el.clientWidth);
    const ro: ResizeObserver = new ResizeObserver(
      (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
          setPreviewWidth(entry.contentRect.width);
        }
      },
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  /*
   * The preview zooms ITSELF, never the board behind the modal. A drag on
   * the previewed chart narrows this preview's own copy of the board's
   * range, a double-click (or "Reset zoom" above it) puts it back, and the
   * dashboard keeps the range it had: the board is not what is being
   * edited, and retiming it from inside a settings dialog would leave it
   * zoomed with its reset hidden (edit mode hides the toolbar's).
   */
  const [previewRange, setPreviewRange] = useState<RangeStartAndEndDateTime>(
    props.dashboardStartAndEndDate,
  );

  /*
   * A new board range starts the preview over from it. Compared by value
   * against the last board range seen, not against the preview's own
   * (zoomed) range, so a parent re-render that hands down an equal range
   * cannot knock the preview out of its zoom.
   */
  const boardRangeRef: React.MutableRefObject<RangeStartAndEndDateTime> =
    useRef<RangeStartAndEndDateTime>(props.dashboardStartAndEndDate);

  useEffect(() => {
    if (
      TimeRangeZoomUtil.isSameRange(
        boardRangeRef.current,
        props.dashboardStartAndEndDate,
      )
    ) {
      return;
    }

    boardRangeRef.current = props.dashboardStartAndEndDate;
    setPreviewRange(props.dashboardStartAndEndDate);
  }, [props.dashboardStartAndEndDate]);

  const previewZoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: previewRange,
    onTimeRangeChange: setPreviewRange,
  });

  /*
   * A click on a column header in the preview sets the widget's own sort
   * (issue #5082): the preview is the widget as everyone will see it. The
   * widget is read when the click comes, not when the preview last drew -
   * a list widget draws again only when its settings change, and an older
   * copy would undo an edit made since.
   */
  const latestComponentRef: React.MutableRefObject<
    DashboardBaseComponent | undefined
  > = useRef<DashboardBaseComponent | undefined>(component);
  latestComponentRef.current = component;

  const onComponentUpdateRef: React.MutableRefObject<
    ComponentProps["onComponentUpdate"]
  > = useRef<ComponentProps["onComponentUpdate"]>(props.onComponentUpdate);
  onComponentUpdateRef.current = props.onComponentUpdate;

  const setPreviewWidgetSort: (sort: string | null) => void = useCallback(
    (sort: string | null): void => {
      const latest: DashboardBaseComponent | undefined =
        latestComponentRef.current;

      if (!latest) {
        return;
      }

      onComponentUpdateRef.current(withDashboardWidgetSavedSort(latest, sort));
    },
    [],
  );

  /*
   * What a widget whose columns are its own can be sorted by, as its
   * preview reports it - for the Sort setting, which cannot know a metric
   * table's or a Data Source table's columns otherwise.
   */
  const [previewSortColumns, setPreviewSortColumns] =
    useState<DashboardWidgetSortColumns | null>(null);

  useEffect(() => {
    setPreviewSortColumns(null);
  }, [props.componentId.toString()]);

  /*
   * Gone from the config: the widget was just deleted, and this dialog is
   * closing in the same update.
   */
  if (!component) {
    return <></>;
  }

  /*
   * A widget of a type this version does not draw (DashboardWidgetFallback)
   * has no settings to edit, and a copy of it would be just as broken, so
   * its dialog offers Delete Widget and says why there is nothing else.
   */
  const isKnownType: boolean = isDashboardComponentType(
    component.componentType,
  );

  /*
   * The badge before the size: the widget's name as the catalog gives it
   * (issue #6720), in the reader's language - "Funnel", "Docker Hosts" -
   * never its stored type, unless that is a type OneUptime has no widget
   * of; none when the widget names no type at all.
   */
  const typeBadgeText: string = getWidgetTypeBadgeText(
    component.componentType,
    translator,
  );

  // Its size on the board, in the reader's digits.
  const sizeText: string = translator.translateTemplate(
    "{{width}} x {{height}} units",
    {
      width: translator.formatNumber(component.widthInDashboardUnits),
      height: translator.formatNumber(component.heightInDashboardUnits),
    },
  );

  const aspectRatio: number =
    (component.widthInDashboardUnits || 1) /
    (component.heightInDashboardUnits || 1);
  /*
   * The widget's shape, from 240 to 420 pixels tall. A chart in a preview
   * as narrow as a board that stacks its widgets (a phone) is at least as
   * tall as that board draws a chart: its title, series and legend take
   * about 200 pixels, and at 240 its plot was a line.
   */
  const previewMinHeight: number =
    previewWidth < DASHBOARD_STACKED_BELOW_WIDTH_IN_PX &&
    DashboardBoardLayoutUtil.isChart(component.componentType)
      ? DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX
      : 240;
  const previewHeight: number = Math.min(
    420,
    Math.max(previewMinHeight, previewWidth / aspectRatio),
  );

  return (
    <Modal
      title={props.title}
      /*
       * Under the title, which kind of widget this is and how big: a line
       * of its own. Beside the title they squeezed it into a column a word
       * wide on a phone, the long words of a language such as German cut
       * mid-word.
       */
      description={
        <span className={WIDGET_SETTINGS_SUMMARY_CLASS_NAME}>
          {typeBadgeText ? (
            <span
              className={WIDGET_SETTINGS_TYPE_BADGE_CLASS_NAME}
              title={typeBadgeText}
              data-testid={WIDGET_SETTINGS_TYPE_BADGE_TEST_ID}
            >
              {typeBadgeText}
            </span>
          ) : (
            <></>
          )}
          <span
            className="whitespace-nowrap text-xs text-gray-500"
            data-testid={WIDGET_SETTINGS_SIZE_TEST_ID}
          >
            {sizeText}
          </span>
        </span>
      }
      modalWidth={ModalWidth.Large}
      onClose={() => {
        props.onComponentUpdate(component);
        props.onClose();
      }}
      closeButtonText="Done"
      leftFooterElement={
        <div className="flex items-center gap-2">
          {isKnownType ? (
            <Button
              title={`Duplicate Widget`}
              icon={IconProp.Copy}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                props.onComponentDuplicate(component);
              }}
            />
          ) : (
            <></>
          )}
          <Button
            title={`Delete Widget`}
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            onClick={() => {
              setShowDeleteConfirmation(true);
            }}
          />
        </div>
      }
    >
      <>
        {showDeleteConfirmation && (
          <ConfirmModal
            title={`Delete Widget?`}
            description={
              <DeleteConfirmationMessage
                kind="question"
                name={getWidgetDisplayName(component)}
                typeLabel="widget"
              />
            }
            onClose={() => {
              setShowDeleteConfirmation(false);
            }}
            submitButtonText={"Delete Widget"}
            onSubmit={() => {
              props.onComponentDelete(component);
              setShowDeleteConfirmation(false);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}

        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon
                  icon={IconProp.Eye}
                  size={SizeProp.Regular}
                  className="text-gray-500"
                />
                <h4 className="text-sm font-semibold text-gray-800">
                  {translator.translateText("Live Preview")}
                </h4>
              </div>
              <div className="flex items-center gap-2">
                {/* Shown only while the preview is zoomed. */}
                <TimeRangeZoomProvider zoom={previewZoom}>
                  <ResetTimeRangeZoomButton />
                </TimeRangeZoomProvider>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  {translator.translateText("Updates as you edit")}
                </div>
              </div>
            </div>
            <div
              className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4 shadow-inner"
              data-testid={WIDGET_SETTINGS_PREVIEW_TEST_ID}
            >
              <div ref={previewContainerRef}>
                {previewWidth > 0 && (
                  <div
                    style={{
                      /*
                       * The card fills whatever box it is given, so size the
                       * box to the preview area directly.
                       */
                      width: `${previewWidth}px`,
                      height: `${previewHeight}px`,
                    }}
                  >
                    <DashboardBaseComponentElement
                      variables={props.variables}
                      componentId={props.componentId}
                      /*
                       * Drawn as a reader sees it (out of edit mode), over a
                       * board being edited: nothing in it may leave the page
                       * and take the unsaved widgets with it (issue #6859).
                       */
                      isEditMode={false}
                      isPreview={true}
                      isSelected={false}
                      key={`preview-${props.componentId.toString()}`}
                      onClick={() => {}}
                      onComponentUpdate={() => {}}
                      totalCurrentDashboardWidthInPx={
                        props.totalCurrentDashboardWidthInPx
                      }
                      dashboardCanvasTopInPx={0}
                      dashboardCanvasLeftInPx={0}
                      dashboardCanvasWidthInPx={previewWidth}
                      dashboardCanvasHeightInPx={previewHeight}
                      dashboardComponentWidthInPx={previewWidth}
                      dashboardComponentHeightInPx={previewHeight}
                      dashboardViewConfig={props.dashboardViewConfig}
                      dashboardStartAndEndDate={previewRange}
                      metricTypes={props.metrics.metricTypes}
                      /*
                       * The preview's own zoom (above), never the board's: the
                       * widget hands its drag and double-click here exactly as
                       * it hands them to the dashboard on the board.
                       */
                      onDashboardTimeRangeSelect={previewZoom.zoomToTimeRange}
                      onDashboardTimeRangeReset={previewZoom.resetZoom}
                      isDashboardTimeRangeZoomed={previewZoom.isZoomed}
                      onWidgetSortChange={setPreviewWidgetSort}
                      onWidgetSortColumnsChange={setPreviewSortColumns}
                      dndActiveMode={null}
                      isAnyGestureActive={false}
                      onMovePointerDown={() => {}}
                      onResizePointerDown={() => {}}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="border-t border-gray-200" />

          <section>
            <h4 className="text-sm font-semibold text-gray-800 mb-3">
              {translator.translateText("Settings")}
            </h4>
            {isKnownType ? (
              /*
               * Saved settings the form cannot read must not take the
               * dashboard with them: the form's place says so, and Delete
               * Widget below still works.
               */
              <ContainedErrorBoundary
                resetKeys={[props.componentId.toString()]}
                renderFallback={() => {
                  return (
                    <p
                      className="text-sm text-gray-500"
                      data-testid="widget-settings-unavailable"
                    >
                      {translator.translateText(
                        "These settings could not be shown. You can still delete this widget and add it again.",
                      )}
                    </p>
                  );
                }}
              >
                <ArgumentsForm
                  variables={props.variables}
                  component={component}
                  onFormChange={(component: DashboardBaseComponent) => {
                    props.onComponentUpdate(component);
                  }}
                  metrics={props.metrics}
                  widgetSortColumns={previewSortColumns}
                />
              </ContainedErrorBoundary>
            ) : (
              <p
                className="text-sm text-gray-500"
                data-testid="widget-settings-unknown-type"
              >
                {String(component.componentType || "").trim()
                  ? translator.translateTemplate(
                      'OneUptime has no "{{componentType}}" widget, so there are no settings to change. Delete it to take it off this dashboard.',
                      { componentType: String(component.componentType) },
                    )
                  : translator.translateText(
                      "This widget does not say which kind of widget it is, so there are no settings to change. Delete it to take it off this dashboard.",
                    )}
              </p>
            )}
          </section>
        </div>
      </>
    </Modal>
  );
};

export default ComponentSettingsModal;
