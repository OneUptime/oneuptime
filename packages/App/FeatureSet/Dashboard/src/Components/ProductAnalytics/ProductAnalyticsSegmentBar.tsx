import React, { FunctionComponent, ReactElement, useState } from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS,
  PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH,
  ProductAnalyticsEventField,
  ProductAnalyticsEventPropertiesDto,
  ProductAnalyticsFieldRef,
  ProductAnalyticsSegmentFilter,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import {
  PRODUCT_ANALYTICS_PLAIN_FIELDS,
  addProductAnalyticsFilter,
  decodeProductAnalyticsField,
  describeProductAnalyticsField,
  describeProductAnalyticsFieldValue,
  encodeProductAnalyticsField,
  isSameProductAnalyticsFilter,
  toProductAnalyticsFilterValue,
} from "./ProductAnalyticsEventsFormat";
import { getProductAnalyticsBreakdownFields } from "./ProductAnalyticsEventsApi";

/*
 * The segment an Events, Funnels or Retention read is narrowed to (issue
 * #6444, part two): events whose field holds a value - a device type, a
 * country, a property the event carried, a user property of the person who
 * sent it. Every filter must hold. Shown as one chip a filter, each with a
 * way out, and a small form that adds the next.
 */

export interface ProductAnalyticsSegmentBarProps {
  filters: ReadonlyArray<ProductAnalyticsSegmentFilter>;
  onChange: (filters: Array<ProductAnalyticsSegmentFilter>) => void;
  // The property keys the page's event carried, offered beside the plain fields.
  properties: ProductAnalyticsEventPropertiesDto | null;
  dataTestId: string;
}

export function describeProductAnalyticsFilter(
  filter: ProductAnalyticsSegmentFilter,
  translator: Translator,
): string {
  return translator.translateTemplate("{{field}} is {{value}}", {
    field: describeProductAnalyticsField(filter, translator),
    value: describeProductAnalyticsFieldValue({
      field: filter.field,
      value: filter.value,
      translator: translator,
    }),
  });
}

const ProductAnalyticsSegmentBar: FunctionComponent<
  ProductAnalyticsSegmentBarProps
> = (props: ProductAnalyticsSegmentBarProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [field, setField] = useState<ProductAnalyticsFieldRef>({
    field: ProductAnalyticsEventField.DeviceType,
    key: "",
  });
  const [value, setValue] = useState<string>("");

  const fields: Array<ProductAnalyticsFieldRef> =
    getProductAnalyticsBreakdownFields(
      props.properties,
      PRODUCT_ANALYTICS_PLAIN_FIELDS,
    );
  const options: Array<DropdownOption> = fields.map(
    (ref: ProductAnalyticsFieldRef): DropdownOption => {
      return {
        value: encodeProductAnalyticsField(ref),
        label: describeProductAnalyticsField(ref, translator),
        isUserContent: true,
        isInPageDirection: true,
      };
    },
  );
  const selectedField: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === encodeProductAnalyticsField(field);
    },
  );
  const isFull: boolean =
    props.filters.length >= PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS;

  const add: () => void = (): void => {
    const trimmed: string = value.trim();

    if (!trimmed) {
      return;
    }

    props.onChange(
      addProductAnalyticsFilter(props.filters, {
        field: field.field,
        key: field.key,
        value: toProductAnalyticsFilterValue({
          field: field.field,
          value: trimmed,
          translator: translator,
        }).slice(0, PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH),
      }),
    );
    setValue("");
    setIsAdding(false);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid={props.dataTestId}
    >
      <span className="text-sm text-gray-500">
        {translator.translateText("Segment")}
      </span>
      {props.filters.length === 0 && !isAdding ? (
        <span
          className="text-sm text-gray-700"
          data-testid={`${props.dataTestId}-everyone`}
        >
          {translator.translateText("Everyone")}
        </span>
      ) : (
        <></>
      )}
      {props.filters.map(
        (filter: ProductAnalyticsSegmentFilter): ReactElement => {
          const label: string = describeProductAnalyticsFilter(
            filter,
            translator,
          );

          return (
            <span
              key={`${filter.field}:${filter.key}:${filter.value}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 py-1 pe-1 ps-3 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-200"
              data-testid={`${props.dataTestId}-filter`}
            >
              <span className="min-w-0 truncate" dir="auto" title={label}>
                {label}
              </span>
              <button
                type="button"
                className="flex-none rounded-full p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label={translator.translateTemplate("Remove {{filter}}", {
                  filter: label,
                })}
                data-testid={`${props.dataTestId}-remove`}
                onClick={(): void => {
                  props.onChange(
                    props.filters.filter(
                      (candidate: ProductAnalyticsSegmentFilter): boolean => {
                        return !isSameProductAnalyticsFilter(candidate, filter);
                      },
                    ),
                  );
                }}
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        },
      )}
      {isAdding ? (
        <div
          className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
          data-testid={`${props.dataTestId}-form`}
        >
          <div className="w-full sm:w-56">
            <Dropdown
              options={options}
              value={selectedField}
              isClearable={false}
              ariaLabel={translator.translateText("Field") || "Field"}
              dataTestId={`${props.dataTestId}-field`}
              onChange={(
                picked: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                const ref: ProductAnalyticsFieldRef | null =
                  typeof picked === "string"
                    ? decodeProductAnalyticsField(picked)
                    : null;

                if (ref) {
                  setField(ref);
                }
              }}
            />
          </div>
          <div className="w-full sm:w-48">
            <Input
              value={value}
              placeholder="Value"
              ariaLabel={translator.translateText("Value")}
              maxLength={PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH}
              dataTestId={`${props.dataTestId}-value`}
              onChange={(next: string): void => {
                setValue(next);
              }}
              onEnterPress={add}
            />
          </div>
          <div className="flex gap-2">
            <Button
              title="Add"
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              disabled={!value.trim()}
              dataTestId={`${props.dataTestId}-add`}
              onClick={add}
            />
            <Button
              title="Cancel"
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId={`${props.dataTestId}-cancel`}
              onClick={(): void => {
                setValue("");
                setIsAdding(false);
              }}
            />
          </div>
        </div>
      ) : (
        <Button
          title="Add filter"
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.LINK}
          buttonSize={ButtonSize.Small}
          disabled={isFull}
          tooltip={
            isFull
              ? translator.translatePlural(
                  {
                    one: "A segment holds at most {{count}} filter.",
                    other: "A segment holds at most {{count}} filters.",
                  },
                  PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS,
                )
              : undefined
          }
          dataTestId={`${props.dataTestId}-open`}
          onClick={(): void => {
            setIsAdding(true);
          }}
        />
      )}
    </div>
  );
};

export default ProductAnalyticsSegmentBar;
