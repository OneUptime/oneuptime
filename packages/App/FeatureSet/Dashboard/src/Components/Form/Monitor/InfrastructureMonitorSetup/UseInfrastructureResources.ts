import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { withSearchIn } from "Common/UI/Components/EntityDropdown/EntityDropdownQuery";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import RecordsById from "Common/UI/Utils/RecordsById";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import boundResourceValue from "./BoundResourceValue";

/*
 * The hosts, clusters, vCenters, arrays or fleets an infrastructure monitor
 * can watch, as its resource field offers them, with when each last sent
 * data. Read again after one is added from the form, so the new one can be
 * picked straight away.
 *
 * The field offers the project's first 10,000 by name that are not archived
 * (an archived resource is retired: never picked for a new monitor), and
 * what is typed into it is searched on the server, 50 by name, so a host
 * past them is found (#10646). The resource a step watches already is read
 * by its value - archived, or past the first 10,000 - so it is named, with
 * when it last sent data, instead of showing as nothing picked.
 */

export const INFRASTRUCTURE_RESOURCE_SEARCH_LIMIT: number = 50;
const SEARCH_DEBOUNCE_MS: number = 250;

// Retired resources are never offered for a new monitor.
const LIVE_QUERY: Record<string, unknown> = { isArchived: false };

export interface InfrastructureResources<T extends BaseModel> {
  records: Array<T>;
  options: Array<DropdownOption>;
  lastSeenAtByValue: Record<string, Date | undefined>;
  isLoading: boolean;
  reload: () => Promise<Array<T>>;
  // The option a step's resource field shows (BoundResourceValue).
  valueOf: (step: { value: string; resourceId?: string | undefined }) => string;
  // Hand the field's onSearchTextChange this: it asks the server.
  onSearchTextChange: (text: string) => void;
}

export default function useInfrastructureResources<T extends BaseModel>(input: {
  modelType: { new (): T };
  select: Select<T>;
  // The option's value is what the monitor stores and the worker filters on.
  toOption: (record: T) => DropdownOption;
  getLastSeenAt: (record: T) => Date | undefined;
  // The column the option's value is read from: "name", "hostIdentifier".
  valueField: string;
  // The columns what is typed is searched in.
  searchFields: Array<string>;
  // The value the step watches already, read by it when the list lacks it.
  heldValue?: string | undefined;
}): InfrastructureResources<T> {
  const [records, setRecords] = useState<Array<T>>([]);
  const [found, setFound] = useState<Array<T>>([]);
  const [held, setHeld] = useState<Array<T>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const timerRef: MutableRefObject<number | null> = useRef<number | null>(null);
  const sequenceRef: MutableRefObject<number> = useRef<number>(0);

  const reload: () => Promise<Array<T>> = useCallback(async (): Promise<
    Array<T>
  > => {
    setIsLoading(true);

    try {
      const result: ListResult<T> = await ModelAPI.getList<T>({
        modelType: input.modelType,
        query: LIVE_QUERY as Query<T>,
        select: input.select,
        sort: {
          name: SortOrder.Ascending,
        } as never,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

      setRecords(result.data);
      return result.data;
    } catch {
      setRecords([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {
      // reload sets an empty list itself.
    });

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const valueOfRecord: (record: T) => string = (record: T): string => {
    return String(input.toOption(record).value);
  };

  const isListed: boolean =
    !input.heldValue ||
    [...records, ...found].some((record: T): boolean => {
      return valueOfRecord(record) === input.heldValue;
    });

  // The resource the step watches, when the list does not have it.
  useEffect(() => {
    let isCurrent: boolean = true;

    if (isLoading || isListed || !input.heldValue) {
      return;
    }

    RecordsById.read<T>({
      modelType: input.modelType,
      ids: [input.heldValue],
      column: input.valueField,
      select: {
        ...(input.select as Record<string, unknown>),
        isArchived: true,
      } as Select<T>,
    })
      .then((read: Array<T>) => {
        if (isCurrent) {
          setHeld(read);
        }
      })
      .catch(() => {
        // Unnamed: the field shows nothing picked, as it did.
      });

    return () => {
      isCurrent = false;
    };
  }, [input.heldValue, isLoading, isListed]);

  const onSearchTextChange: (text: string) => void = (text: string): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    if (!text.trim()) {
      return;
    }

    const sequence: number = ++sequenceRef.current;

    timerRef.current = window.setTimeout(() => {
      ModelAPI.getList<T>({
        modelType: input.modelType,
        query: withSearchIn(LIVE_QUERY, input.searchFields, text) as Query<T>,
        select: input.select,
        sort: { name: SortOrder.Ascending } as never,
        limit: INFRASTRUCTURE_RESOURCE_SEARCH_LIMIT,
        skip: 0,
      })
        .then((result: ListResult<T>) => {
          if (sequence === sequenceRef.current) {
            setFound(result.data);
          }
        })
        .catch(() => {
          // The list read already is still offered.
        });
    }, SEARCH_DEBOUNCE_MS);
  };

  // The list, what the search found and the one held: each value once.
  const known: Array<T> = [];
  const seenValues: Set<string> = new Set<string>();

  for (const record of [...records, ...found, ...held]) {
    const value: string = valueOfRecord(record);

    if (!value || seenValues.has(value)) {
      continue;
    }

    seenValues.add(value);
    known.push(record);
  }

  const options: Array<DropdownOption> = known.map(
    (record: T): DropdownOption => {
      const option: DropdownOption = input.toOption(record);

      // One the step watches that is archived since: marked, never offered.
      return (record as unknown as Record<string, unknown>)["isArchived"] ===
        true
        ? { ...option, isArchived: true, isDisabled: true }
        : option;
    },
  );

  const lastSeenAtByValue: Record<string, Date | undefined> = {};

  for (const record of known) {
    lastSeenAtByValue[valueOfRecord(record)] = input.getLastSeenAt(record);
  }

  const valueOf: (step: {
    value: string;
    resourceId?: string | undefined;
  }) => string = (step: {
    value: string;
    resourceId?: string | undefined;
  }): string => {
    return boundResourceValue<T>({
      step,
      options,
      records: known,
      toOption: input.toOption,
    });
  };

  return {
    records: known,
    options: options,
    lastSeenAtByValue: lastSeenAtByValue,
    isLoading: isLoading,
    reload: reload,
    valueOf: valueOf,
    onSearchTextChange: onSearchTextChange,
  };
}
