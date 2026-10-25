import { splitAtNameBreaks } from "Common/Utils/NameBreaks";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A finding's title, with the names in it breakable where they read: a
 * title names what a service named - a metric, an attribute, an operation -
 * and on a phone "http.server.request.count" broke as "request.coun" / "t".
 * It now breaks after its dots and slashes first (Common/Utils/NameBreaks),
 * and anywhere only when a part is still too long for its line. The text
 * is unchanged: <wbr> adds no character.
 */

export interface ComponentProps {
  text: string;
}

const InsightTitleText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: Array<string> = splitAtNameBreaks(props.text);

  return (
    <>
      {parts.map((part: string, index: number): ReactElement => {
        return (
          <React.Fragment key={index}>
            {part}
            {index < parts.length - 1 ? <wbr /> : <></>}
          </React.Fragment>
        );
      })}
    </>
  );
};

export default InsightTitleText;
