import Includes from "../../../Types/BaseDatabase/Includes";
import Button, { ButtonStyleType } from "../Button/Button";
import { DropdownOption } from "../Dropdown/Dropdown";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import { SizeProp } from "../Icon/Icon";
import Modal, { ModalWidth } from "../Modal/Modal";
import FieldType from "../Types/FieldType";
import FilterViewerItem from "./FilterViewerItem";
import FiltersForm from "./FiltersForm";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Search from "../../../Types/BaseDatabase/Search";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  filters: Array<Filter<T>>;
  singularLabel?: string;
  pluralLabel?: string;
  id: string;
  showFilterModal: boolean;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterError?: string | undefined;
  onFilterModalClose?: (() => void) | undefined;
  onFilterModalOpen?: (() => void) | undefined;
  isModalLoading?: boolean;
  onFilterRefreshClick?: undefined | (() => void);
  filterData?: FilterData<T> | undefined;
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);
}

type FilterComponentFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const FilterComponent: FilterComponentFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const [tempFilterDataForModal, setTempFilterDataForModal] = useState<
    FilterData<T>
  >({});

  type ChangeFilterDataFunction = (filterData: FilterData<T>) => void;

  const changeFilterData: ChangeFilterDataFunction = (
    filterData: FilterData<T>,
  ) => {
    setTempFilterDataForModal(filterData);
    props.onFilterChanged?.(filterData);
  };

  useEffect(() => {
    if (props.showFilterModal) {
      setTempFilterDataForModal({ ...props.filterData });
    }
  }, [props.showFilterModal]);

  type FormatJsonFunction = (
    json: Dictionary<string | number | boolean>,
  ) => ReactElement;

  const formatJson: FormatJsonFunction = (
    json: Dictionary<string | number | boolean>,
  ): ReactElement => {
    return (
      <div className="flex space-x-2 -mt-1">
        {Object.keys(json).map((key: string, i: number) => {
          let jsonText: string | number | boolean = json[key] as
            | string
            | number
            | boolean;

          if (typeof jsonText === "boolean" && jsonText === true) {
            jsonText = "True";
          }

          if (typeof jsonText === "boolean" && jsonText === false) {
            jsonText = "False";
          }

          return (
            <div
              key={i}
              className="rounded-full h-7 bg-gray-100 text-gray-500 border-2 border-gray-200 p-1 pr-2 pl-2 text-xs"
            >
              <span className="font-medium">{key}</span> ={" "}
              <span className="font-medium">{jsonText}</span>
            </div>
          );
        })}
      </div>
    );
  };

  type TranslateFilterToTextFunction = <T extends GenericObject>(data: {
    filters: Array<Filter<T>>;
    filterData: FilterData<T>;
  }) => Array<ReactElement>;

  const translateFilterToText: TranslateFilterToTextFunction = <
    T extends GenericObject,
  >(data: {
    filters: Array<Filter<T>>;
    filterData: FilterData<T>;
  }): Array<ReactElement> => {
    const filterTexts: Array<ReactElement | null> = [];

    for (const filter of data.filters) {
      filterTexts.push(
        translateFilterItemToText({
          filter: filter,
          filterData: data.filterData,
        }),
      );
    }

    return filterTexts.filter((filterText: ReactElement | null) => {
      return filterText !== null;
    }) as Array<ReactElement>;
  };

  type TranslateFilterItemToTextFunction = <T extends GenericObject>(data: {
    filter: Filter<T>;
    filterData: FilterData<T>;
  }) => ReactElement | null;

  const translateFilterItemToText: TranslateFilterItemToTextFunction = <
    T extends GenericObject,
  >(data: {
    filter: Filter<T>;
    filterData: FilterData<T>;
  }): ReactElement | null => {
    let filterText: ReactElement = <></>;

    if (!data.filter.key) {
      return null;
    }

    if (
      data.filterData[data.filter.key] === undefined ||
      data.filterData[data.filter.key] === null
    ) {
      return null;
    }

    if (data.filter.type === FieldType.Boolean) {
      filterText = (
        <div>
          {" "}
          <span className="font-medium">{data.filter.title}</span> is{" "}
          <span className="font-medium">
            {data.filterData[data.filter.key] ? "Yes" : "No"}
          </span>{" "}
        </div>
      );
      return filterText;
    }

    if (
      data.filter.type === FieldType.Text ||
      data.filter.type === FieldType.Number ||
      data.filter.type === FieldType.Email ||
      data.filter.type === FieldType.Phone ||
      data.filter.type === FieldType.URL ||
      data.filter.type === FieldType.Hostname
    ) {
      const key: keyof T = data.filter.key;

      if (data.filterData[key] && data.filterData[key] instanceof Search) {
        filterText = (
          <div>
            {" "}
            <span className="font-medium">
              {data.filter.title}
            </span> contains{" "}
            <span className="font-medium">
              {data.filterData[data.filter.key]?.toString()}
            </span>{" "}
          </div>
        );
      } else if (data.filterData[key]) {
        filterText = (
          <div>
            {" "}
            <span className="font-medium">{data.filter.title}</span> is{" "}
            <span className="font-medium">
              {data.filterData[data.filter.key]?.toString()}
            </span>{" "}
          </div>
        );
      }
      return filterText;
    }

    if (
      data.filter.type === FieldType.Date ||
      data.filter.type === FieldType.DateTime
    ) {
      const key: keyof T = data.filter.key;

      const startAndEndDates: InBetween<Date> = data.filterData[
        key
      ] as InBetween<Date>;

      const shouldOnlyShowDate: boolean = data.filter.type === FieldType.Date;
      const shouldShowSeconds: boolean =
        data.filter.type === FieldType.DateTime;

      if (
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          startAndEndDates.startValue as Date,
          shouldOnlyShowDate,
          shouldShowSeconds,
        ) ===
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          startAndEndDates.endValue as Date,
          shouldOnlyShowDate,
          shouldShowSeconds,
        )
      ) {
        return (
          <div>
            {" "}
            <span className="font-medium">{data.filter.title}</span> at{" "}
            <span className="font-medium">
              {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                startAndEndDates.startValue as Date,
                data.filter.type === FieldType.Date,
                shouldShowSeconds,
              )}
            </span>{" "}
          </div>
        );
      }
      return (
        <div>
          {" "}
          <span className="font-medium">{data.filter.title}</span> is in between{" "}
          <span className="font-medium">
            {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              startAndEndDates.startValue as Date,
              shouldOnlyShowDate,
              shouldShowSeconds,
            )}
          </span>{" "}
          and{" "}
          <span className="font-medium">
            {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              startAndEndDates.endValue as Date,
              shouldOnlyShowDate,
              shouldShowSeconds,
            )}
          </span>{" "}
        </div>
      );
    }

    if (data.filter.type === FieldType.JSON) {
      const key: keyof T = data.filter.key;

      const json: Dictionary<string | number | boolean> = data.filterData[
        key
      ] as Dictionary<string | number | boolean>;

      // if json is empty, return null

      if (Object.keys(json).length === 0) {
        return null;
      }

      const isPlural: boolean = Object.keys(json).length > 1;

      return (
        <div className="flex space-x-1">
          {" "}
          <div className="font-medium">{data.filter.title}</div>{" "}
          <div>
            {isPlural ? "are" : "is"} {""}
          </div>
          <div className="font-medium">{formatJson(json)}</div>{" "}
        </div>
      );
    }

    if (
      data.filter.type === FieldType.Dropdown ||
      data.filter.type === FieldType.MultiSelectDropdown ||
      data.filter.type === FieldType.Entity ||
      data.filter.type === FieldType.EntityArray
    ) {
      const key: keyof T = data.filter.key;

      let items: Array<string> = data.filterData[key] as Array<string>;

      if (typeof items === "string") {
        items = [items];
      }

      if (items instanceof Includes) {
        items = items.values as Array<string>;
      }

      const isMoreItems: boolean = items.length > 1;

      if (items && items instanceof Array) {
        const entityNames: string = (items as Array<string>)
          .map((item: string) => {
            // item is the id of the entity. We need to find the name of the entity from the list of entities.

            const entity: DropdownOption | undefined =
              data.filter.filterDropdownOptions?.find(
                (entity: DropdownOption | undefined) => {
                  return entity?.value.toString() === item.toString();
                },
              );

            if (entity) {
              return entity.label.toString();
            }

            return null;
          })
          .filter((item: string | null) => {
            return item !== null;
          })
          .join(", ");

        if (!entityNames) {
          return null;
        }

        return (
          <div>
            <span className="font-medium">{data.filter.title}</span>
            {isMoreItems ? " is any of these values: " : " is "}
            <span className="font-medium">{entityNames}</span>
          </div>
        );
      }

      return filterText;
    }

    return filterText;
  };

  const filterTexts: Array<ReactElement> = translateFilterToText({
    filters: props.filters,
    filterData: props.filterData || {},
  });

  if (props.filterError) {
    return <ErrorMessage message={props.filterError} />;
  }

  const showViewer: boolean = filterTexts.length > 0;

  return (
    <div>
      {showViewer && (
        <div>
          <div className="mt-5 mb-5 bg-gray-50 rounded-xl p-5 border-2 border-gray-100">
            <div className="flex mt-1 mb-2">
              <div className="flex-auto py-0.5 text-sm leading-5">
                <span className="font-semibold">
                  Filter {props.pluralLabel + " " || ""}
                  by the following criteria:
                </span>{" "}
              </div>
            </div>

            <ul role="list" className="space-y-3">
              {filterTexts.map((filterText: ReactElement, index: number) => {
                const isLastItem: boolean = index === filterTexts.length - 1;
                return (
                  <li className="relative flex gap-x-2" key={index}>
                    {!isLastItem && (
                      <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                        <div className="w-px bg-gray-200"></div>
                      </div>
                    )}
                    <div className="relative flex h-6 w-6  flex-none items-center justify-center bg-gray-50">
                      <div className="h-1.5 w-1.5 rounded-full bg-gray-100 ring-1 ring-gray-300"></div>
                    </div>
                    <FilterViewerItem key={index} text={filterText} />{" "}
                  </li>
                );
              })}
            </ul>

            <div className="flex -ml-3 mt-3 -mb-2">
              {/** Edit Filter Button */}
              <Button
                className="font-medium text-gray-900"
                icon={IconProp.Filter}
                onClick={props.onFilterModalOpen}
                title="Edit Filters"
                iconSize={SizeProp.Smaller}
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
              />

              {/** Clear Filter Button */}
              <Button
                onClick={() => {
                  changeFilterData({});
                  props.onFilterModalClose?.();
                }}
                className="font-medium text-gray-900"
                icon={IconProp.Close}
                title="Clear Filters"
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
              />
            </div>
          </div>
        </div>
      )}

      {props.showFilterModal && (
        <Modal
          modalWidth={ModalWidth.Large}
          isLoading={props.isModalLoading}
          title={`${props.singularLabel + " " || ""}Filters`}
          description={`Filter ${
            props.pluralLabel || ""
          } by the following criteria:`}
          submitButtonText={`Apply Filters`}
          onClose={() => {
            props.onFilterModalClose?.();
          }}
          onSubmit={() => {
            setTempFilterDataForModal({});
            if (props.onFilterChanged) {
              props.onFilterChanged({
                ...tempFilterDataForModal,
              });
            }
            props.onFilterModalClose?.();
          }}
        >
          <FiltersForm
            onFilterRefreshClick={props.onFilterRefreshClick}
            filterData={tempFilterDataForModal}
            filters={props.filters}
            id={props.id + "-form"}
            showFilter={true}
            onFilterChanged={(filterData: FilterData<T>) => {
              setTempFilterDataForModal(filterData);
            }}
            onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
          />
        </Modal>
      )}
    </div>
  );
};

export default FilterComponent;
