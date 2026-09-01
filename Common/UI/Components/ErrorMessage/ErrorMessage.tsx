import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  message: string | ReactElement;
  onRefreshClick?: undefined | (() => void);
}

const ErrorMessage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue, translateString } = useTranslateValue();
  const translatedMessage: string | ReactElement | undefined =
    typeof props.message === "string"
      ? (translateValue(props.message) as string | ReactElement | undefined) ??
        props.message
      : props.message;
  return (
    <div className="text-center my-10 text-gray-500 text-sm">
      {translatedMessage}
      {props.onRefreshClick ? (
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
            {translateString("Refresh?") ?? "Refresh?"}
          </button>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ErrorMessage;
