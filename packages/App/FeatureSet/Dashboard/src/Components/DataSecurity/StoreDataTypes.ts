import { readDataTypeIds } from "./IssueDataTypes";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { useEffect, useState } from "react";

/*
 * THE KINDS OF DATA A STORE HOLDS, READ FROM THE STORE ITSELF (#10238).
 *
 * A store's data types are read by the store's own read permissions - the
 * Security roles and Read Data Store - and never through a relation
 * (DataStore.dataTypeIds): a column read on a relation query skips every
 * permission check, and a Data Asset, a Data Alert and a Data Warehouse
 * Job join their store for every member and viewer. So a page that shows a
 * record on a store and what the store holds - a data security issue's -
 * reads the store for it: one small read, made only while the page shows
 * them.
 */

export const STORE_DATA_TYPES_SELECT: Select<DataStore> = {
  _id: true,
  dataTypeIds: true,
};

// Said in place of a store's data types that could not be read.
export const STORE_DATA_TYPES_NOT_LOADED: string = translationKey(
  "Couldn't load this store's data types. {{error}}",
);

export interface StoreDataTypesRead {
  // Asked for, and not read yet.
  isLoading: boolean;
  dataTypeIds: Array<string>;
  // Why they could not be read; "" when they were, or were not asked for.
  error: string;
}

const NOT_ASKED: StoreDataTypesRead = {
  isLoading: false,
  dataTypeIds: [],
  error: "",
};

const LOADING: StoreDataTypesRead = {
  isLoading: true,
  dataTypeIds: [],
  error: "",
};

// A store's data types, as stored on it; none for a store that is not there.
export async function readStoreDataTypes(
  storeId: ObjectID,
): Promise<Array<string>> {
  const store: DataStore | null = await ModelAPI.getItem<DataStore>({
    modelType: DataStore,
    id: storeId,
    select: STORE_DATA_TYPES_SELECT,
  });

  return readDataTypeIds(store?.dataTypeIds);
}

interface StoreDataTypesOfStore {
  storeId: string;
  dataTypeIds: Array<string>;
  error: string;
}

/*
 * The data types of the store `storeId`, read while `isNeeded`, and read
 * again whenever `refreshToggle` changes. A read again keeps what is on
 * screen until it lands, and one that fails keeps the data types already
 * read, as the issue's own page keeps the issue (IssueView/Layout.tsx).
 */
export function useStoreDataTypes(data: {
  // The store's id: "" for none.
  storeId: string;
  isNeeded: boolean;
  refreshToggle?: string | undefined;
}): StoreDataTypesRead {
  const isAsked: boolean =
    data.isNeeded && ObjectID.isValidUUID(data.storeId || "");

  const [read, setRead] = useState<StoreDataTypesOfStore | null>(null);

  useEffect(() => {
    if (!isAsked) {
      return;
    }

    let isCurrent: boolean = true;
    const storeId: string = data.storeId;

    readStoreDataTypes(new ObjectID(storeId)).then(
      (dataTypeIds: Array<string>) => {
        if (isCurrent) {
          setRead({ storeId: storeId, dataTypeIds: dataTypeIds, error: "" });
        }
      },
      (err: unknown) => {
        if (!isCurrent) {
          return;
        }

        const error: string = API.getFriendlyMessage(err as Error);

        setRead(
          (previous: StoreDataTypesOfStore | null): StoreDataTypesOfStore => {
            if (previous && previous.storeId === storeId && !previous.error) {
              return previous;
            }

            return { storeId: storeId, dataTypeIds: [], error: error };
          },
        );
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [isAsked, data.storeId, data.refreshToggle]);

  if (!isAsked) {
    return NOT_ASKED;
  }

  if (!read || read.storeId !== data.storeId) {
    return LOADING;
  }

  return {
    isLoading: false,
    dataTypeIds: read.dataTypeIds,
    error: read.error,
  };
}
