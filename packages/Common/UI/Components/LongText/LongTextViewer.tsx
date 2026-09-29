import React, { FunctionComponent, ReactElement, useState } from "react";
import Button, { ButtonStyleType } from "../Button/Button";

export interface ComponentProps {
  text: string;
  disableTruncation?: boolean;
}

const LongTextViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showFullText, setShowFullText] = useState<boolean>(false);
  const characterLimit: number = 100;

  const shouldTruncate: boolean =
    !props.disableTruncation && props.text.length > characterLimit;
  const displayText: string =
    shouldTruncate && !showFullText
      ? `${props.text.substring(0, characterLimit)}...`
      : props.text;

  return (
    <div className="max-w-2xl break-words">
      <div className="whitespace-pre-wrap">{displayText}</div>

      {shouldTruncate && (
        <Button
          className="-mt-1 -ml-3"
          onClick={() => {
            return setShowFullText(!showFullText);
          }}
          title={showFullText ? "Show less" : "Show more"}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
        />
      )}
    </div>
  );
};

export default LongTextViewer;
