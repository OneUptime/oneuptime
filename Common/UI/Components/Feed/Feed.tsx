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
      <ul role="list" className="-mb-8">
        {props.items.length === 0 && (
          <div className="mb-4">
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
