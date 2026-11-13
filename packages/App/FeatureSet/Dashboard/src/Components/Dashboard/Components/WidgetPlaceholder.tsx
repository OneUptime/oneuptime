import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  // What the widget would draw: its data's kind (logs, traces, a table...).
  icon: IconProp;
  // The sentence in its place: why there is nothing to draw.
  message: string;
  // The sentence's test id, where a reader of the page looks for it.
  messageTestId?: string | undefined;
}

export const WIDGET_PLACEHOLDER_TEST_ID: string =
  "dashboard-widget-placeholder";

/*
 * A widget's box holding an icon and a sentence in place of its data, in
 * the middle of the box: what a widget a public dashboard cannot draw
 * shows - a public dashboard reads no logs, traces, security events or
 * external data source, and says so where each would be - and what a list
 * whose read failed shows. One look for all of them on a board, quiet
 * (a visitor can do nothing about it), and readable: its words keep 4.5:1
 * against the widget, in both themes. On a phone the board gives a widget
 * a public dashboard cannot draw only the room this needs
 * (DashboardBoardLayout's isPlaceholder).
 */
const WidgetPlaceholder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 px-2"
      data-testid={WIDGET_PLACEHOLDER_TEST_ID}
    >
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gray-50">
        <div className="h-5 w-5 text-gray-400">
          <Icon icon={props.icon} />
        </div>
      </div>
      <p
        className="max-w-56 text-center text-xs text-gray-500"
        data-testid={props.messageTestId}
      >
        {translator.translateText(props.message)}
      </p>
    </div>
  );
};

export default WidgetPlaceholder;
