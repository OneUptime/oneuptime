import Icon from "../Icon/Icon";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
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
        <span>
          <span className="font-medium">{data.filter.title}</span> is{" "}
          <span className="font-medium">
            {data.filterData[data.filter.key] ? "Yes" : "No"}
          </span>
        </span>
      );
      return filterText;
    }

    if (
      data.filter.type === FieldType.Text ||
      data.filter.type === FieldType.Number ||
      data.filter.type === FieldType.Email ||
      data.filter.type === FieldType.Phone ||
      data.filter.type === FieldType.URL ||
      data.filter.type === FieldType.Hostname ||
      data.filter.type === FieldType.LongText ||
      data.filter.type === FieldType.Name ||
      data.filter.type === FieldType.Port ||
      data.filter.type === FieldType.ObjectID
    ) {
      const key: keyof T = data.filter.key;
      const value: unknown = data.filterData[key];

      type RenderFunction = (verb: string, display: string) => ReactElement;
      const render: RenderFunction = (
        verb: string,
        display: string,
      ): ReactElement => {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> {verb}{" "}
            <span className="font-medium">{display}</span>
          </span>
        );
      };

      if (value instanceof IsNull) {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> is empty
          </span>
        );
      }
      if (value instanceof NotNull) {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> is not
            empty
          </span>
        );
      }
      if (value instanceof Search) {
        return render("contains", value.toString());
      }
      if (value instanceof NotContains) {
        return render("does not contain", value.toString());
      }
      if (value instanceof StartsWith) {
        return render("starts with", value.toString());
      }
      if (value instanceof EndsWith) {
        return render("ends with", value.toString());
      }
      if (value instanceof InBetween) {
        return render(
          "is between",
          `${value.startValue} and ${value.endValue}`,
        );
      }
      if (value instanceof GreaterThanOrEqual) {
        return render("is ≥", value.toString());
      }
      if (value instanceof LessThanOrEqual) {
        return render("is ≤", value.toString());
      }
      if (value instanceof GreaterThan) {
        return render("is greater than", value.toString());
      }
      if (value instanceof LessThan) {
        return render("is less than", value.toString());
      }
      if (value instanceof NotEqual) {
        return render("does not equal", value.toString());
      }
      if (value instanceof EqualTo) {
        return render("equals", value.toString());
      }
      if (value !== undefined && value !== null && value !== "") {
        return render("is", (value as any).toString());
      }
      return null;
    }

    if (
      data.filter.type === FieldType.Date ||
      data.filter.type === FieldType.DateTime
    ) {
      const key: keyof T = data.filter.key;
      const value: unknown = data.filterData[key];

      const shouldOnlyShowDate: boolean = data.filter.type === FieldType.Date;
      const shouldShowSeconds: boolean =
        data.filter.type === FieldType.DateTime;

      type FormatFunction = (d: Date) => string;
      const format: FormatFunction = (d: Date): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          d,
          shouldOnlyShowDate,
          shouldShowSeconds,
        );
      };

      type RenderFunction = (verb: string, display: string) => ReactElement;
      const render: RenderFunction = (
        verb: string,
        display: string,
      ): ReactElement => {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> {verb}{" "}
            <span className="font-medium">{display}</span>
          </span>
        );
      };

      if (value instanceof IsNull) {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> is empty
          </span>
        );
      }
      if (value instanceof NotNull) {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> is not
            empty
          </span>
        );
      }
      if (value instanceof InBetween) {
        const start: Date = value.startValue as unknown as Date;
        const end: Date = value.endValue as unknown as Date;
        if (format(start) === format(end)) {
          return render("is", format(start));
        }
        return render("is between", `${format(start)} and ${format(end)}`);
      }
      if (value instanceof GreaterThan) {
        return render("is after", format(value.value as unknown as Date));
      }
      if (value instanceof LessThan) {
        return render("is before", format(value.value as unknown as Date));
      }
      if (value instanceof EqualTo) {
        return render("is", format(value.value as unknown as Date));
      }
      return null;
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
        <span className="inline-flex items-center space-x-1">
          <span className="font-medium">{data.filter.title}</span>
          <span>{isPlural ? "are" : "is"}</span>
          <span className="font-medium">{formatJson(json)}</span>
        </span>
      );
    }

    if (
      data.filter.type === FieldType.Dropdown ||
      data.filter.type === FieldType.MultiSelectDropdown ||
      data.filter.type === FieldType.Entity ||
      data.filter.type === FieldType.EntityArray
    ) {
      const key: keyof T = data.filter.key;
      const rawValue: unknown = data.filterData[key];

      if (rawValue instanceof IsNull) {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> is empty
          </span>
        );
      }
      if (rawValue instanceof NotNull) {
        return (
          <span>
            <span className="font-medium">{data.filter.title}</span> is not
            empty
          </span>
        );
      }

      let items: Array<string> = [];
      type MatchMode = "any" | "all" | "none";
      let matchMode: MatchMode = "any";

      if (rawValue instanceof IncludesAll) {
        items = rawValue.values as Array<string>;
        matchMode = "all";
      } else if (rawValue instanceof IncludesNone) {
        items = rawValue.values as Array<string>;
        matchMode = "none";
      } else if (rawValue instanceof Includes) {
        items = rawValue.values as Array<string>;
      } else if (Array.isArray(rawValue)) {
        items = rawValue as Array<string>;
      } else if (typeof rawValue === "string") {
        items = [rawValue];
      }

      const entityNames: string = items
        .map((item: string) => {
          const entity: DropdownOption | undefined =
            data.filter.filterDropdownOptions?.find(
              (e: DropdownOption | undefined) => {
                return e?.value.toString() === item.toString();
              },
            );
          if (entity) {
            return entity.label.toString();
          }
          return null;
        })
        .filter((name: string | null) => {
          return name !== null;
        })
        .join(", ");

      if (!entityNames) {
        return null;
      }

      const isMoreItems: boolean = items.length > 1;
      let joiner: string;
      if (matchMode === "all") {
        joiner = " has all of: ";
      } else if (matchMode === "none") {
        joiner = " has none of: ";
      } else if (isMoreItems) {
        joiner = " is any of: ";
      } else {
        joiner = " is ";
      }

      return (
        <span>
          <span className="font-medium">{data.filter.title}</span>
          {joiner}
          <span className="font-medium">{entityNames}</span>
        </span>
      );
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
          <div className="mt-4 mb-4 bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Icon icon={IconProp.Filter} size={SizeProp.Smaller} />
                <span className="font-semibold">
                  Showing {props.pluralLabel || "results"} that match
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {filterTexts.map((filterText: ReactElement, index: number) => {
                return (
                  <div
                    key={index}
                    className="inline-flex items-center rounded-full bg-white border border-gray-200 px-3 py-1 text-sm text-gray-700 shadow-sm whitespace-nowrap"
                  >
                    <FilterViewerItem key={index} text={filterText} />
                  </div>
                );
              })}
            </div>

            <div className="flex -ml-3 mt-3 -mb-1">
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
          title={`Filter ${props.pluralLabel || props.singularLabel || "results"}`}
          description={`Narrow down ${
            props.pluralLabel || "results"
          } by one or more criteria below.`}
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
