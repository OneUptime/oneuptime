import { NameListSummary, summarizeNames } from "../../Utils/ModelDisplayName";
import { translateTemplate } from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Which records a bulk delete is about to remove, under its "Are you sure you
 * want to delete 12 monitors?".
 *
 * A count says how many, not which. The user picked these rows by hand, often
 * across pages and after a filter, and this is the last moment to notice that
 * one of them should not be there - so the first few are named, and the rest
 * are counted ("and 7 more") rather than turning the dialog into the list it
 * came from.
 */

export const DELETE_MORE_ITEMS_TEMPLATE: string = "and {{remaining}} more";

export interface ComponentProps {
  // The names of the selected records that have one, in selection order.
  names: Array<string>;
  // How many records are selected, named or not.
  totalCount: number;
  maxShown?: number | undefined;
}

const DeleteItemNames: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const summary: NameListSummary = summarizeNames({
    names: props.names,
    totalCount: props.totalCount,
    maxShown: props.maxShown,
  });

  // Nothing to name: the count in the sentence above is all there is to say.
  if (summary.shownNames.length === 0) {
    return <></>;
  }

  return (
    <div data-testid="delete-confirmation-items">
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-900">
        {summary.shownNames.map((name: string, index: number) => {
          return (
            <li
              key={`${index}-${name}`}
              data-testid="delete-confirmation-item"
              className="break-words font-medium"
            >
              {name}
            </li>
          );
        })}
      </ul>
      {summary.remainingCount > 0 ? (
        <p
          data-testid="delete-confirmation-more-items"
          className="mt-1 pl-5 text-sm text-gray-500"
        >
          {translateTemplate(DELETE_MORE_ITEMS_TEMPLATE, {
            remaining: summary.remainingCount.toLocaleString(),
          })}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default DeleteItemNames;
