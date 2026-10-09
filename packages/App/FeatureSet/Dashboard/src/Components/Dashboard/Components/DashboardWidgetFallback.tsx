import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { isPublicDashboard } from "../Utils/PublicDashboardContext";

export enum DashboardWidgetProblem {
  /*
   * Its stored type is not one this version draws: a removed widget
   * (HostMetricChart), one from a newer version, a misspelt type written
   * through the API, or no type at all.
   */
  UnknownType = "UnknownType",
  // It threw while it was being drawn.
  Crashed = "Crashed",
}

export const DASHBOARD_WIDGET_FALLBACK_TEST_ID: string =
  "dashboard-widget-fallback";

export interface ComponentProps {
  problem: DashboardWidgetProblem;
  // The type the widget was stored with, as stored ("" when it has none).
  componentType: string;
  isEditMode: boolean;
  // What was thrown, for a widget that crashed.
  error?: Error | undefined;
  // Draws the widget again (a crash that may pass, such as a data race).
  onRetry?: (() => void) | undefined;
  /*
   * Opens this widget's settings in edit mode, where it can be fixed or
   * deleted. Handed in only to someone who may edit the dashboard.
   */
  onEditWidgetClick?: (() => void) | undefined;
  /*
   * A short widget (a two-row tile) drops the icon, so the words and the
   * buttons fit without scrolling.
   */
  isCompact?: boolean | undefined;
}

/*
 * The height below which a widget's note drops its icon: a two-row tile is
 * about 190px tall, and the note with its icon needs about 170px of it
 * inside the card's padding.
 */
export const COMPACT_WIDGET_FALLBACK_HEIGHT_IN_PX: number = 220;

/*
 * What a widget shows in its own place on the board when it cannot be drawn
 * (issue #4571), instead of an empty card or - for a widget that threw - the
 * whole dashboard going with it. The rest of the board keeps working.
 *
 * It says which widget, why when the reader can act on it, and the one next
 * step: someone who may edit the dashboard gets Edit widget (its settings,
 * where Delete Widget is); while editing, the widget itself opens those
 * settings, so it says so instead. A widget that threw can be tried again.
 * A public dashboard's visitors see only that the widget could not be shown:
 * its type and the error are the owner's business.
 *
 * Drawn the way the widgets draw their own states (DataSourceWidgetPlaceholder,
 * ValueWidgetView): an icon in a soft circle above short, quiet text.
 */
const DashboardWidgetFallback: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isPublic: boolean = isPublicDashboard();
  const isCrash: boolean = props.problem === DashboardWidgetProblem.Crashed;

  let reason: string = "";

  if (!isPublic) {
    if (isCrash) {
      reason =
        translator.translateText("Something went wrong while drawing it.") ||
        "";
    } else if (props.componentType.trim()) {
      reason = translator.translateTemplate(
        'OneUptime has no "{{componentType}}" widget.',
        { componentType: props.componentType },
      );
    } else {
      reason =
        translator.translateText(
          "It does not say which kind of widget it is.",
        ) || "";
    }
  }

  const offersRetry: boolean =
    isCrash && !props.isEditMode && Boolean(props.onRetry);
  const offersEdit: boolean =
    !isPublic && !props.isEditMode && Boolean(props.onEditWidgetClick);
  const showsDetails: boolean = isCrash && !isPublic && Boolean(props.error);

  /*
   * The outer box scrolls; the inner one is centred with auto margins rather
   * than justify-center, so a note taller than a small widget starts at its
   * top and scrolls instead of being cut off above and below.
   */
  return (
    <div
      data-testid={DASHBOARD_WIDGET_FALLBACK_TEST_ID}
      data-problem={props.problem}
      className="flex w-full h-full overflow-auto"
    >
      <div className="m-auto flex flex-col items-center gap-2 text-center px-2 py-1 max-w-full">
        {props.isCompact ? (
          <></>
        ) : (
          <div
            className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0"
            data-testid="dashboard-widget-fallback-icon"
          >
            <div className="h-5 w-5 text-amber-500">
              <Icon icon={IconProp.Alert} />
            </div>
          </div>
        )}
        <p className="text-sm font-medium text-gray-700">
          {translator.translateText("This widget could not be shown")}
        </p>
        {reason ? (
          <p
            className="text-xs text-gray-500 max-w-xs break-words"
            data-testid="dashboard-widget-fallback-reason"
          >
            {reason}
          </p>
        ) : (
          <></>
        )}
        {props.isEditMode && !isPublic ? (
          <p
            className="text-xs text-gray-400 max-w-xs"
            data-testid="dashboard-widget-fallback-edit-hint"
          >
            {translator.translateText("Click it to edit or delete it.")}
          </p>
        ) : (
          <></>
        )}
        {offersRetry || offersEdit ? (
          /*
           * The shared Button carries a left margin (and full width on a
           * phone) for form footers; here the row's gap spaces them, so one
           * button sits exactly in the middle.
           */
          <div className="flex flex-wrap items-center justify-center gap-2 mt-1 [&_button]:ml-0 [&_button]:w-auto">
            {offersRetry ? (
              <Button
                title="Try again"
                icon={IconProp.Refresh}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                dataTestId="dashboard-widget-fallback-retry"
                onClick={() => {
                  props.onRetry?.();
                }}
              />
            ) : (
              <></>
            )}
            {offersEdit ? (
              <Button
                title="Edit widget"
                icon={IconProp.Edit}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                dataTestId="dashboard-widget-fallback-edit"
                onClick={() => {
                  props.onEditWidgetClick?.();
                }}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
        {showsDetails ? (
          <details
            className="max-w-full text-left"
            data-testid="dashboard-widget-fallback-details"
          >
            <summary className="text-xs text-gray-400 cursor-pointer select-none text-center">
              {translator.translateText("Details")}
            </summary>
            <pre className="mt-1 max-h-24 overflow-auto text-xs text-gray-500 whitespace-pre-wrap break-words">
              {props.error?.message || String(props.error)}
            </pre>
          </details>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default DashboardWidgetFallback;
