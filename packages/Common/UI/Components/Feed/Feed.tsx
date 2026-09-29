import React, { FunctionComponent, ReactElement } from "react";
import FeedItem, { FeedItemProps } from "./FeedItem";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";

export interface ComponentProps {
  items: Array<FeedItemProps>;
  noItemsMessage: string;
  hasMore?: boolean | undefined;
  onMore?: (() => void) | undefined;
  isLoadingMore?: boolean | undefined;
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
      {props.hasMore === true && (
        <div className="mt-2 flex justify-center">
          <Button
            title="More"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={props.onMore}
            isLoading={props.isLoadingMore === true}
          />
        </div>
      )}
    </div>
  );
};

export default Feed;
