import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  id: string;
}

const FeedItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <div id={props.id}></div>;
};

export default FeedItem;
