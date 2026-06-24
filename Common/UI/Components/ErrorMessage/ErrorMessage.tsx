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
        <button
          type="button"
          role={"refresh-button"}
          onClick={() => {
            if (props.onRefreshClick) {
              props.onRefreshClick();
            }
          }}
          className="mt-3 underline text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          {translateString("Refresh?") ?? "Refresh?"}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ErrorMessage;
