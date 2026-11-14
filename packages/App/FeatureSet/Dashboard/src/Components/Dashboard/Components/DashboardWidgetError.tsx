import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
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

// The state's icon, dropped when the words need its room.
export const DASHBOARD_WIDGET_STATE_ICON_TEST_ID: string =
  "dashboard-widget-state-icon";

/*
 * The room the icon takes above the words: its 40px circle and the 8px gap
 * under it.
 */
export const DASHBOARD_WIDGET_STATE_ICON_ROOM_IN_PX: number = 48;

export interface DashboardWidgetErrorLineProps {
  // The message, as the widget set it: its own sentence, or the server's.
  error: string;
  /*
   * The line's look, where a widget sizes it to its tile (the Value
   * widget's clamp); the shared look otherwise.
   */
  className?: string | undefined;
  // The line's test id: the error line's, unless the line says something else.
  dataTestId?: string | undefined;
}

// The error's words, in the reader's language, on a line of their own.
export const DashboardWidgetErrorLine: FunctionComponent<
  DashboardWidgetErrorLineProps
> = (props: DashboardWidgetErrorLineProps): ReactElement => {
  return (
    <p
      className={props.className || DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME}
      data-testid={props.dataTestId || DASHBOARD_WIDGET_ERROR_LINE_TEST_ID}
    >
      <ErrorMessageText
        message={props.error}
        hideWhatFailed={true}
        isCentered={true}
      />
    </p>
  );
};

/*
 * Whether the state's icon fits over its words in the widget's box. A long
 * message - a failure nobody explained, with its reference and copy button,
 * in German - in a two-row tile would push the words below the box's edge,
 * so the icon gives up its room first, as DashboardWidgetFallback's note
 * does in a short tile; what still does not fit scrolls from its first
 * line. The icon comes back when the box grows. Measured after the browser
 * lays the state out (a ResizeObserver), so nothing is read while React
 * draws; with no ResizeObserver (a test's document) the icon stays.
 */
export const useIsStateIconShown: (
  box: RefObject<HTMLDivElement>,
  content: RefObject<HTMLDivElement>,
) => boolean = (
  box: RefObject<HTMLDivElement>,
  content: RefObject<HTMLDivElement>,
): boolean => {
  const [isShown, setIsShown] = useState<boolean>(true);
  const isShownRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    const boxElement: HTMLDivElement | null = box.current;
    const contentElement: HTMLDivElement | null = content.current;

    if (
      !boxElement ||
      !contentElement ||
      typeof ResizeObserver === "undefined"
    ) {
      return undefined;
    }

    const observer: ResizeObserver = new ResizeObserver((): void => {
      // The words' height with the icon over them, drawn or not.
      const heightWithIcon: number =
        contentElement.offsetHeight +
        (isShownRef.current ? 0 : DASHBOARD_WIDGET_STATE_ICON_ROOM_IN_PX);
      const fits: boolean = heightWithIcon <= boxElement.clientHeight;

      if (fits !== isShownRef.current) {
        isShownRef.current = fits;
        setIsShown(fits);
      }
    });

    observer.observe(boxElement);
    observer.observe(contentElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  return isShown;
};

export interface DashboardWidgetStateProps {
  // The widget's own icon, in its soft circle (the Gauge's arc).
  icon: ReactElement;
  children: ReactNode;
  dataTestId?: string | undefined;
}

/*
 * A widget's state with nothing else to draw: its icon over its lines, in
 * the middle of its box. A message longer than a small tile first drops the
 * icon, then scrolls inside it from its first line (m-auto centres it only
 * while it fits; justify-center would cut its top off).
 */
export const DashboardWidgetState: FunctionComponent<
  DashboardWidgetStateProps
> = (props: DashboardWidgetStateProps): ReactElement => {
  const boxRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const contentRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const isIconShown: boolean = useIsStateIconShown(boxRef, contentRef);

  return (
    <div
      ref={boxRef}
      className="flex h-full w-full overflow-auto"
      data-testid={props.dataTestId}
    >
      <div
        ref={contentRef}
        className="m-auto flex max-w-full flex-col items-center gap-2 py-2"
      >
        {isIconShown ? (
          <div
            className="flex-none"
            data-testid={DASHBOARD_WIDGET_STATE_ICON_TEST_ID}
          >
            {props.icon}
          </div>
        ) : (
          <></>
        )}
        {props.children}
      </div>
    </div>
  );
};

// The error's icon: the widget's data kind, in a soft gray circle.
export const DashboardWidgetErrorIcon: FunctionComponent<{
  icon: IconProp;
}> = (props: { icon: IconProp }): ReactElement => {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-50">
      <div className="h-5 w-5 text-gray-400">
        <Icon icon={props.icon} />
      </div>
    </div>
  );
};

export interface ComponentProps {
  /*
   * What the widget would draw: its data's kind (a chart, a table, logs),
   * or an icon of its own (the Gauge's arc).
   */
  icon: IconProp | ReactElement;
  error: string;
}

// The whole state: the widget's icon, and the error's line under it.
const DashboardWidgetError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <DashboardWidgetState
      icon={
        React.isValidElement(props.icon) ? (
          props.icon
        ) : (
          <DashboardWidgetErrorIcon icon={props.icon as IconProp} />
        )
      }
      dataTestId={DASHBOARD_WIDGET_ERROR_TEST_ID}
    >
      <DashboardWidgetErrorLine error={props.error} />
    </DashboardWidgetState>
  );
};

export default DashboardWidgetError;
