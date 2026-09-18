import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
}

const PlaceholderText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedText: string = translateString(props.text) ?? props.text;
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-gray-300 bg-gray-50 px-2 py-0.5 align-middle text-sm font-normal text-gray-500 select-none">
      {translatedText}
    </span>
  );
};

export default PlaceholderText;
