import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import FeedItem, { FeedItemProps } from "./FeedItem";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import useTranslateValue from "../../Utils/Translation";

export interface ComponentProps {
  items: Array<FeedItemProps>;
  noItemsMessage: string;
  // Items arrive chronologically; an overview can start with recent updates.
  visibleItemLimit?: number | undefined;
}

const Feed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAllItems, setShowAllItems] = useState<boolean>(false);
  const listId: string = useId();
  const { translateString } = useTranslateValue();
  const itemLimit: number =
    Number.isInteger(props.visibleItemLimit) &&
    (props.visibleItemLimit || 0) > 0
      ? props.visibleItemLimit!
      : props.items.length;
  const earlierItemCount: number = Math.max(props.items.length - itemLimit, 0);
  const visibleItems: Array<FeedItemProps> =
    showAllItems || earlierItemCount === 0
      ? props.items
      : props.items.slice(-itemLimit);

  useEffect(() => {
    setShowAllItems(false);
  }, [props.visibleItemLimit]);

  return (
    <div className="flow-root">
      {earlierItemCount > 0 && (
        <button
          type="button"
          aria-expanded={showAllItems}
          aria-controls={listId}
          className="mb-5 inline-flex rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          onClick={() => {
            setShowAllItems((current: boolean) => {
              return !current;
            });
          }}
        >
          {translateString(
            showAllItems
              ? "Show fewer updates"
              : `Show ${earlierItemCount} earlier update${earlierItemCount === 1 ? "" : "s"}`,
          )}
        </button>
      )}
      {props.items.length === 0 && (
        <ErrorMessage message={props.noItemsMessage} />
      )}
      <ul id={listId} role="list">
        {visibleItems.map((item: FeedItemProps, index: number) => {
          const { key, ...itemProps } = item;
          return (
            <FeedItem
              key={key}
              {...itemProps}
              isLastItem={index === visibleItems.length - 1}
            />
          );
        })}
      </ul>
    </div>
  );
};

export default Feed;
