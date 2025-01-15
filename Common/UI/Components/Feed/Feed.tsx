import React, { FunctionComponent, ReactElement } from "react";
import FeedItem, { FeedItemProps } from "./FeedItem";
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
            <ErrorMessage message={props.noItemsMessage} />
          </div>
        )}
        {props.items.map((item: FeedItemProps, index: number) => {
          return (
            <FeedItem {...item} isLastItem={index === props.items.length - 1} />
          );
        })}
      </ul>
    </div>
  );
};

export default Feed;
