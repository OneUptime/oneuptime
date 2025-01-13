import React, { FunctionComponent, ReactElement } from "react";
import FeedItem, {ComponentProps as FeedItemProps} from "./FeedItem";

export interface ComponentProps {
  items: Array<FeedItemProps>;
}

const Feed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
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
