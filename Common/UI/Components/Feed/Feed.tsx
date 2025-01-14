import React, { FunctionComponent, ReactElement } from "react";
import FeedItem, { ComponentProps as FeedItemProps } from "./FeedItem";
import ErrorMessage from "../ErrorMessage/ErrorMessage";

export interface ComponentProps {
  items: Array<FeedItemProps>;
  noItemsMessage: string;
}

const Feed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flow-root">
      <ul role="list">
        {props.items.length === 0 && (
          <div>
            <ErrorMessage error={props.noItemsMessage} /></div>)}
        {props.items.map((item: FeedItemProps) => {
          return (
            <FeedItem
              {...item}
            />
          );
        })}
      </ul>
    </div>
  );
};

export default Feed;
