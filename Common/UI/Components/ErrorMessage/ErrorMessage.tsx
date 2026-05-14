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
        <div
          role={"refresh-button"}
          onClick={() => {
            if (props.onRefreshClick) {
              props.onRefreshClick();
            }
          }}
          className="underline cursor-pointer hover:text-gray-700 mt-3"
        >
          {translateString("Refresh?") ?? "Refresh?"}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ErrorMessage;
