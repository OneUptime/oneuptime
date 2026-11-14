import { isUnexplainedErrorMessage } from "./ErrorExplanation";
import ErrorMessageText from "./ErrorMessageText";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  message: string | ReactElement;
  onRefreshClick?: undefined | (() => void);
  /*
   * A way forward to offer under the message - an empty table's "Create X"
   * button. It takes the place of the Refresh link: reloading a list that
   * just loaded empty only shows the same nothing again.
   */
  action?: undefined | ReactElement;
  /*
   * What failed, in the reader's language - "The monitors could not be
   * loaded." - said first when the error is one nobody explained.
   */
  whatFailed?: string | undefined;
}

const ErrorMessage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  /*
   * An error nobody explained (#6836) says what failed, what to do next
   * and, when the server failed, the reference to give - and its way out is
   * called Try again rather than Refresh?.
   */
  const isUnexplained: boolean = isUnexplainedErrorMessage(props.message);
  /*
   * Read the way it is written (ErrorMessageText): a failed read's answer
   * from the server is in English, and keeps its full stop at its end on a
   * Persian page, in an isolate of its own. Words in the page's own way are
   * drawn as they always were.
   */
  const words: ReactElement = (
    <ErrorMessageText message={props.message} whatFailed={props.whatFailed} />
  );
  return (
    <div className="text-center my-10 text-gray-500 text-sm">
      {isUnexplained ? (
        <span className="mx-auto block max-w-prose">{words}</span>
      ) : (
        words
      )}
      {props.action ? (
        <div className="mt-4 flex justify-center" data-testid="empty-action">
          {props.action}
        </div>
      ) : props.onRefreshClick ? (
        /*
         * This is the only recovery control on the app-wide failure and
         * empty-state surface, and it used to be a <div role="refresh-button">
         * - not focusable, and deaf to Enter and Space, so the single way out
         * of a failed table was the mouse. It is a real <button> now; the
         * data-testid keeps the hook the tests reach for, which the invented
         * role was standing in for.
         */
        <div className="mt-3">
          <button
            type="button"
            data-testid="refresh-button"
            onClick={() => {
              if (props.onRefreshClick) {
                props.onRefreshClick();
              }
            }}
            className="underline cursor-pointer hover:text-gray-700 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {translateString(isUnexplained ? "Try again" : "Refresh?")}
          </button>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ErrorMessage;
