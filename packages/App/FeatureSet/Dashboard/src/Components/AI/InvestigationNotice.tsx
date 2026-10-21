import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface ComponentProps {
  // A small mark in front of the sentence: an icon or a spinner.
  indicator: ReactElement;
  // English, translated here like a shared component's title.
  title: string;
  children?: ReactNode | undefined;
  /*
   * "status" for something a reader may want to know (the report is being
   * written); "alert" for something they must (a save failed).
   */
  role?: "status" | "alert" | undefined;
  testId?: string | undefined;
  /*
   * For a message about something the reader just did, which they can put
   * away once read.
   */
  onDismiss?: (() => void) | undefined;
}

// The marks a notice usually carries, in the card's own colours.
export const NOTICE_ICON_CLASS_NAME: string = "h-4 w-4 flex-shrink-0";

export const noticeFailedIcon: ReactElement = (
  <Icon
    icon={IconProp.Alert}
    className={`${NOTICE_ICON_CLASS_NAME} text-red-600`}
  />
);

export const noticeDoneIcon: ReactElement = (
  <Icon
    icon={IconProp.CheckCircle}
    className={`${NOTICE_ICON_CLASS_NAME} text-emerald-600`}
  />
);

/*
 * How the AI Investigation card says something that is not the report: the
 * run stopped, its report is still being written, a verdict could not be
 * saved, a question could not be sent. A small mark, one sentence and a
 * quieter line under it, in the report's own type.
 *
 * It is never a box. A tinted, bordered panel per message made each one
 * read as another card inside the card, and louder than the report itself.
 */
const InvestigationNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role={props.role}
      data-testid={props.testId}
      className="flex items-start gap-3"
    >
      {/* A div, not a span: Icon renders its own div around the svg. */}
      <div className="flex h-5 w-4 flex-shrink-0 items-center justify-center">
        {props.indicator}
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-gray-900">
          {translator.translateText(props.title)}
        </p>
        {props.children ? (
          <p className="mt-1 break-words text-sm leading-6 text-gray-600">
            {props.children}
          </p>
        ) : (
          <></>
        )}
      </div>
      {props.onDismiss ? (
        <button
          type="button"
          aria-label={translator.translateText("Dismiss")}
          title={translator.translateText("Dismiss")}
          onClick={props.onDismiss}
          className="-my-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

export default InvestigationNotice;
