import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessageText from "Common/UI/Components/ErrorMessage/ErrorMessageText";
import {
  DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
} from "./DashboardWidgetSetupCopy";

/*
 * WHAT A WIDGET SAYS WHEN IT HAS NOTHING TO DRAW BECAUSE SOMETHING WENT
 * WRONG (issue #7330): a read that failed, a time range with no start or
 * end, a project it cannot tell.
 *
 * Every widget drew this line its own way. The Chart, the Data Source Chart
 * and Table, the metric Table, the Log Stream, the Gauge and the Network
 * Map drew it in gray-400 (2.5:1 on white) in a 160 or 192px column, and
 * all but the Chart drew it as it was set: "Please select a valid start and
 * end date." in English on a German or an Arabic board, though every
 * Dashboard language has its words. The log and trace charts, the trace
 * table and the security events flow drew it as a page's error, in larger
 * words with a page's margins.
 *
 * Now every widget draws it here, so they never drift apart again:
 *
 *   - the words in the reader's language (ErrorMessageText): a sentence a
 *     widget sets is looked up, and a message nobody explained - a
 *     gateway's 502, a server failure with its reference - says why and
 *     what to do next, with the reference and its copy button; English
 *     from a server or a connector keeps its own reading direction on an
 *     Arabic or Persian board;
 *   - readable: gray-500, centred, balanced over its lines and as wide as a
 *     line reads well (DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME);
 *   - under the widget's own icon, quiet, in the middle of its box, as the
 *     setup line and the public dashboard placeholder are.
 *
 * What failed is the widget itself, whose icon is right above, so the
 * words say only why and what to do (hideWhatFailed).
 */

export const DASHBOARD_WIDGET_ERROR_TEST_ID: string = "dashboard-widget-error";

export interface DashboardWidgetErrorLineProps {
  // The message, as the widget set it: its own sentence, or the server's.
  error: string;
  /*
   * The line's look, where a widget sizes it to its tile (the Value
   * widget's clamp); the shared look otherwise.
   */
  className?: string | undefined;
}

// The error's words, in the reader's language, on a line of their own.
export const DashboardWidgetErrorLine: FunctionComponent<
  DashboardWidgetErrorLineProps
> = (props: DashboardWidgetErrorLineProps): ReactElement => {
  return (
    <p
      className={props.className || DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME}
      data-testid={DASHBOARD_WIDGET_ERROR_LINE_TEST_ID}
    >
      <ErrorMessageText
        message={props.error}
        hideWhatFailed={true}
        isCentered={true}
      />
    </p>
  );
};

export interface ComponentProps {
  // What the widget would draw: its data's kind (a chart, a table, logs).
  icon: IconProp;
  error: string;
}

/*
 * The whole state: the widget's icon, and the error's line under it, in
 * the middle of the widget's box. A message longer than a small tile
 * scrolls inside it from its first line (m-auto centres it only while it
 * fits; justify-center would cut its top off).
 */
const DashboardWidgetError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="flex h-full w-full overflow-auto"
      data-testid={DASHBOARD_WIDGET_ERROR_TEST_ID}
    >
      <div className="m-auto flex flex-col items-center gap-2 py-2">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gray-50">
          <div className="h-5 w-5 text-gray-400">
            <Icon icon={props.icon} />
          </div>
        </div>
        <DashboardWidgetErrorLine error={props.error} />
      </div>
    </div>
  );
};

export default DashboardWidgetError;
