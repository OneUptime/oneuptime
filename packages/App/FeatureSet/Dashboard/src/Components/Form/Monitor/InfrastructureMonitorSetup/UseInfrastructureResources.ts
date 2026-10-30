import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useState } from "react";

/*
 * The hosts, clusters, vCenters, arrays or fleets an infrastructure monitor
 * can watch, as its resource field offers them, with when each last sent
 * data. Read again after one is added from the form, so the new one can be
 * picked straight away.
 */

export interface InfrastructureResources<T extends BaseModel> {
  records: Array<T>;
  options: Array<DropdownOption>;
  lastSeenAtByValue: Record<string, Date | undefined>;
  isLoading: boolean;
  reload: () => Promise<Array<T>>;
}

export default function useInfrastructureResources<
  T extends BaseModel,
>(input: {
  modelType: { new (): T };
  select: Select<T>;
  // The option's value is what the monitor stores and the worker filters on.
  toOption: (record: T) => DropdownOption;
  getLastSeenAt: (record: T) => Date | undefined;
}): InfrastructureResources<T> {
  const [records, setRecords] = useState<Array<T>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const reload: () => Promise<Array<T>> = useCallback(async (): Promise<
    Array<T>
  > => {
    setIsLoading(true);

    try {
      const result: ListResult<T> = await ModelAPI.getList<T>({
        modelType: input.modelType,
        query: {},
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
  }, []);

  const options: Array<DropdownOption> = records.map(input.toOption);

  const lastSeenAtByValue: Record<string, Date | undefined> = {};

  for (const record of records) {
    lastSeenAtByValue[String(input.toOption(record).value)] =
      input.getLastSeenAt(record);
  }

  return {
    records: records,
    options: options,
    lastSeenAtByValue: lastSeenAtByValue,
    isLoading: isLoading,
    reload: reload,
  };
}
