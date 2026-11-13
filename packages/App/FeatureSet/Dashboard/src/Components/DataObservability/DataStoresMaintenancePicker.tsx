import DataObservabilityApi from "./DataObservabilityApi";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  value: Array<string> | undefined;
  onChange: (value: Array<string>) => void;
  ariaLabelledby?: string | undefined;
}

/*
 * The databases Data Observability watches, for a maintenance event to name: a
 * backfill or a migration on one stays quiet while the event is on. They are read
 * through Data Observability's own route, as a store is Data Security's record.
 */
const DataStoresMaintenancePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getStores()
      .then((stores: Array<DataObservabilityStoreSummary>): void => {
        if (isCurrent) {
          setOptions(
            stores.map(
              (store: DataObservabilityStoreSummary): DropdownOption => {
                return { value: store.dataStoreId, label: store.name };
              },
            ),
          );
        }
      })
      .catch((): void => {
        // Someone who may not read Data Observability has nothing to pick here.
      })
      .finally((): void => {
        if (isCurrent) {
          setIsLoaded(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (!isLoaded) {
    return <></>;
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {translator.translateText("No database is connected yet.")}
      </p>
    );
  }

  const chosen: Set<string> = new Set(props.value || []);

  return (
    <Dropdown
      isMultiSelect={true}
      options={options}
      initialValue={options.filter((option: DropdownOption): boolean => {
        return chosen.has(String(option.value));
      })}
      ariaLabelledby={props.ariaLabelledby}
      placeholder="Select Databases"
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        props.onChange(
          (Array.isArray(value) ? value : value ? [value] : []).map(String),
        );
      }}
    />
  );
};

// The databases an event names, by what Data Observability calls them.
export const DataStoresUnderMaintenance: FunctionComponent<{
  ids: Array<string>;
}> = (props: { ids: Array<string> }): ReactElement => {
  const [names, setNames] = useState<Array<string>>([]);

  useEffect(() => {
    let isCurrent: boolean = true;

    if (props.ids.length === 0) {
      return;
    }

    DataObservabilityApi.getStores()
      .then((stores: Array<DataObservabilityStoreSummary>): void => {
        if (isCurrent) {
          setNames(
            stores
              .filter((store: DataObservabilityStoreSummary): boolean => {
                return props.ids.includes(store.dataStoreId);
              })
              .map((store: DataObservabilityStoreSummary): string => {
                return store.name;
              }),
          );
        }
      })
      .catch((): void => {
        // Someone who may not read Data Observability sees how many, not which.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.ids.join(",")]);

  if (props.ids.length === 0) {
    return <span className="text-sm text-gray-500">-</span>;
  }

  return (
    <span className="text-sm text-gray-900">
      {names.length > 0 ? names.join(", ") : String(props.ids.length)}
    </span>
  );
};

export default DataStoresMaintenancePicker;
