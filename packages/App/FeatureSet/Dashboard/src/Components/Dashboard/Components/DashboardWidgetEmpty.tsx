import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DashboardWidgetErrorIcon,
  DashboardWidgetState,
} from "./DashboardWidgetError";
import {
  DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_EMPTY_LINE_TEST_ID,
} from "./DashboardWidgetSetupCopy";

/*
 * WHAT A WIDGET SAYS WHEN IT READ, AND FOUND NOTHING TO DRAW (issue #8038).
 *
 * A widget has three states with nothing to draw, and PR #7990 gave two of
 * them one look: not set up yet (its icon, its name and a setup line) and
 * something went wrong (DashboardWidgetError: its icon over the error
 * line). The third - a time range or filters with no data in them - was
 * left as each widget drew it: bare words in gray-400, 2.5:1 on white,
 * with no icon, so a Log Chart that read fine and found nothing looked like
 * no other widget on its board.
 *
 * It is drawn here now, in the shared state (DashboardWidgetState): the
 * widget's own icon in its soft circle - the same one its error shows
 * (Logs, Waterfall, ShieldExclamation, TableCells) - over one line in the
 * setup and error lines' readable look (gray-500, centred, balanced, as wide
 * as a line reads well), in the reader's language. A long German line in a
 * small tile drops the icon first and then scrolls from its first line, as
 * an error does; it is never cut off.
 *
 * The line is the widget's own sentence, a key of the Dashboard's locales,
 * looked up here: never a server's message, which is an error
 * (DashboardWidgetError) and not "nothing to draw".
 */

export const DASHBOARD_WIDGET_EMPTY_TEST_ID: string = "dashboard-widget-empty";

export interface ComponentProps {
  // What the widget would draw: its data's kind, the icon its error shows.
  icon: IconProp;
  // The widget's sentence, in English: looked up in the reader's language.
  message: string;
  // The line's test id, where a widget's own tests look for it.
  lineTestId?: string | undefined;
}

const DashboardWidgetEmpty: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <DashboardWidgetState
      icon={<DashboardWidgetErrorIcon icon={props.icon} />}
      dataTestId={DASHBOARD_WIDGET_EMPTY_TEST_ID}
    >
      <p
        className={DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME}
        data-testid={props.lineTestId || DASHBOARD_WIDGET_EMPTY_LINE_TEST_ID}
      >
        {translator.translateText(props.message) || props.message}
      </p>
    </DashboardWidgetState>
  );
};

export default DashboardWidgetEmpty;
