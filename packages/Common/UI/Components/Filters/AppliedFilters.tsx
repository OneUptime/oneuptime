import Button, { ButtonStyleType } from "../Button/Button";
import Icon, { SizeProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // What the list is narrowed to, already in the reader's language.
  title: string;
  // One chip per applied filter.
  chips: Array<ReactElement>;
  onEditFilters?: (() => void) | undefined;
  onClearFilters: () => void;
  dataTestId?: string | undefined;
}

/*
 * The box over a filtered list that says what it is filtered by - "Showing
 * monitors that match", a chip per filter, Edit Filters and Clear Filters -
 * so a narrowed list is never mistaken for the whole of it. Every table and
 * list shows it (FilterViewer), and so does a feed with an event type filter
 * (FeedFilterSummary): one box, so they look and work the same.
 */
const AppliedFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  return (
    <div
      className="mt-4 mb-4 bg-gray-50 rounded-xl p-4 border border-gray-200"
      data-testid={props.dataTestId}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          {/*
           * Sized by its class: Icon applies a size prop only alongside a
           * className, so the funnel this heading always meant to show drew
           * at 0 x 0 while it was given a size alone.
           */}
          <Icon
            icon={IconProp.Filter}
            className="h-4 w-4 shrink-0"
            data-testid="applied-filters-icon"
          />
          <span className="font-semibold">{props.title}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {props.chips.map((chip: ReactElement, index: number) => {
          return (
            <div
              key={index}
              className="inline-flex items-center rounded-full bg-white border border-gray-200 px-3 py-1 text-sm text-gray-700 shadow-sm whitespace-nowrap"
            >
              {chip}
            </div>
          );
        })}
      </div>

      <div className="flex -ml-3 mt-3 -mb-1">
        {/** Edit Filter Button */}
        <Button
          className="font-medium text-gray-900"
          icon={IconProp.Filter}
          onClick={props.onEditFilters}
          title={tx("Edit Filters")}
          iconSize={SizeProp.Smaller}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
        />

        {/** Clear Filter Button */}
        <Button
          onClick={props.onClearFilters}
          className="font-medium text-gray-900"
          icon={IconProp.Close}
          title={tx("Clear Filters")}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
        />
      </div>
    </div>
  );
};

export default AppliedFilters;
