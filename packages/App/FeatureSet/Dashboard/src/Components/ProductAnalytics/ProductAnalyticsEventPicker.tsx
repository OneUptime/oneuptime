import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import { ProductAnalyticsEventKind } from "Common/Types/Rum/ProductAnalyticsEvents";
import {
  ProductAnalyticsEventNameDto,
  ProductAnalyticsEventRef,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import {
  PRODUCT_ANALYTICS_EVENT_GROUP_LABELS,
  SESSION_STARTED,
  decodeProductAnalyticsEvent,
  encodeProductAnalyticsEvent,
  isProductAnalyticsEventListed,
} from "./ProductAnalyticsEventsFormat";

/*
 * One event of the application's, picked from the ones it sent in the
 * range (issue #6444, part two): a session's start, its own events by the
 * names it sent, and its pages - each group in that order, the most
 * frequent first. An event the address names that the range does not hold
 * stays pickable, so a link never loses what it asked for.
 */

export interface ProductAnalyticsEventPickerProps {
  events: ReadonlyArray<ProductAnalyticsEventNameDto>;
  value: ProductAnalyticsEventRef | null;
  onChange: (event: ProductAnalyticsEventRef) => void;
  /*
   * What the picker is for, in English ("Event"): the dropdown looks it up.
   * A sentence the page builds around a value ("Step 2") is put in the
   * reader's words there, and said so with isAriaLabelTranslated (#7790).
   */
  ariaLabel: string;
  isAriaLabelTranslated?: boolean | undefined;
  dataTestId: string;
  placeholder?: string | undefined;
  /*
   * The events are on their way: the picker says so, with a spinner,
   * instead of offering an empty list to pick from.
   */
  isLoading?: boolean | undefined;
}

export const PRODUCT_ANALYTICS_EVENTS_LOADING: string =
  translationKey("Loading events...");

export function buildProductAnalyticsEventOptions(data: {
  events: ReadonlyArray<ProductAnalyticsEventNameDto>;
  value: ProductAnalyticsEventRef | null;
  translator: Translator;
}): Array<DropdownOptionGroup> {
  const listed: Array<ProductAnalyticsEventRef> = [
    { kind: ProductAnalyticsEventKind.Session, name: "" },
    ...data.events.filter((event: ProductAnalyticsEventNameDto): boolean => {
      return event.kind !== ProductAnalyticsEventKind.Session;
    }),
  ];

  if (data.value && !isProductAnalyticsEventListed(data.value, data.events)) {
    listed.push(data.value);
  }

  const groups: Array<DropdownOptionGroup> = [];

  for (const kind of [
    ProductAnalyticsEventKind.Session,
    ProductAnalyticsEventKind.Custom,
    ProductAnalyticsEventKind.Page,
  ]) {
    const seen: Set<string> = new Set<string>();
    const options: Array<DropdownOption> = [];

    for (const event of listed) {
      const value: string = encodeProductAnalyticsEvent(event);

      if (event.kind !== kind || seen.has(value)) {
        continue;
      }

      seen.add(value);
      options.push(
        kind === ProductAnalyticsEventKind.Session
          ? { value: value, label: SESSION_STARTED }
          : { value: value, label: event.name, isUserContent: true },
      );
    }

    if (options.length > 0) {
      const label: string = PRODUCT_ANALYTICS_EVENT_GROUP_LABELS[kind];

      groups.push({
        label: data.translator.translateText(label) || label,
        options: options,
      });
    }
  }

  return groups;
}

const ProductAnalyticsEventPicker: FunctionComponent<
  ProductAnalyticsEventPickerProps
> = (props: ProductAnalyticsEventPickerProps): ReactElement => {
  const translator: Translator = useTranslator();
  const groups: Array<DropdownOptionGroup> = buildProductAnalyticsEventOptions({
    events: props.events,
    value: props.value,
    translator: translator,
  });
  const selected: string | null = props.value
    ? encodeProductAnalyticsEvent(props.value)
    : null;
  const selectedOption: DropdownOption | undefined = groups
    .flatMap((group: DropdownOptionGroup): Array<DropdownOption> => {
      return group.options;
    })
    .find((option: DropdownOption): boolean => {
      return option.value === selected;
    });

  return (
    <Dropdown
      options={groups}
      value={selectedOption}
      isClearable={false}
      ariaLabel={props.ariaLabel}
      isAriaLabelTranslated={props.isAriaLabelTranslated}
      placeholder={
        props.isLoading ? PRODUCT_ANALYTICS_EVENTS_LOADING : props.placeholder
      }
      isLoading={props.isLoading}
      loadingMessage={
        props.isLoading
          ? translator.translateText(PRODUCT_ANALYTICS_EVENTS_LOADING)
          : undefined
      }
      dataTestId={props.dataTestId}
      onChange={(value: DropdownValue | Array<DropdownValue> | null): void => {
        const event: ProductAnalyticsEventRef | null =
          typeof value === "string" ? decodeProductAnalyticsEvent(value) : null;

        if (event) {
          props.onChange(event);
        }
      }}
    />
  );
};

export default ProductAnalyticsEventPicker;
