import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A finding's title, with the names in it breakable where they read: a
 * title names what a service named - a metric, an attribute, an operation -
 * and on a phone "http.server.request.count" broke as "request.coun" / "t".
 * It now breaks after its dots and slashes first (Common/Utils/NameBreaks),
 * and anywhere only when a part is still too long for its line. The text
 * is unchanged: <wbr> adds no character. The breaks are the shared
 * BreakableName's, as an InfoCard's value and a metric's name in a list.
 */

export interface ComponentProps {
  text: string;
}

const InsightTitleText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <BreakableName text={props.text} />;
};

export default InsightTitleText;
