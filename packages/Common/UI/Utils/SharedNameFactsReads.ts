import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../Types/BaseDatabase/Includes";
import ListResult from "../../Types/BaseDatabase/ListResult";
import { getNameKey } from "../../Types/Database/UniqueName";
import ModelAPI from "./ModelAPI/ModelAPI";
import {
  SharedNameFacts,
  getSharedNameFacts,
  getSharedNameSelect,
} from "./SharedNameOptions";
import { useEffect, useState } from "react";

/*
 * RECORDS THAT SHARE A NAME, READ ON THEIR OWN WITH WHAT TELLS THEM APART
 * (#10064, #10314).
 *
 * A picker tells twins apart by what its options carry of their records
 * (SharedNameOptions): a description and when each was made, read with
 * their names. Some lists come with names alone: the labels of a bulk
 * Remove Labels through a relation, which reads no description; the
 * on-call policies of a schedule's shifts, which the server works out and
 * names. For those, the records whose names read as one name - and only
 * those - are read again, on their own, with the reader's own permissions:
 * nothing is read when no two share a name, and a read that fails leaves
 * them marked without what sets each apart.
 */

// A record of a list, as far as its name goes.
export interface NamedRecordOfList {
  id: string;
  name: string;
}

// The ids of the records whose names read as one name another of them has.
export const getIdsSharingAName: (
  records: ReadonlyArray<NamedRecordOfList>,
) => Array<string> = (
  records: ReadonlyArray<NamedRecordOfList>,
): Array<string> => {
  const idsByName: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const record of records) {
    const nameKey: string = getNameKey(record.name);

    if (!record.id || !nameKey) {
      continue;
    }

    const ids: Array<string> = idsByName.get(nameKey) || [];

    if (!ids.includes(record.id)) {
      idsByName.set(nameKey, [...ids, record.id]);
    }
  }

  return Array.from(idsByName.values())
    .filter((ids: Array<string>): boolean => {
      return ids.length > 1;
    })
    .flat();
};

export const SharedNameFactsReads: {
  readFactsOfRecordsSharingAName: <T extends BaseModel>(data: {
    modelType: { new (): T };
    records: ReadonlyArray<NamedRecordOfList>;
  }) => Promise<Map<string, SharedNameFacts>>;
} = {
  readFactsOfRecordsSharingAName: async <T extends BaseModel>(data: {
    modelType: { new (): T };
    records: ReadonlyArray<NamedRecordOfList>;
  }): Promise<Map<string, SharedNameFacts>> => {
    const facts: Map<string, SharedNameFacts> = new Map<
      string,
      SharedNameFacts
    >();
    const sharingIds: Array<string> = getIdsSharingAName(data.records);

    if (sharingIds.length === 0) {
      return facts;
    }

    try {
      const result: ListResult<T> = await ModelAPI.getList<T>({
        modelType: data.modelType,
        query: { _id: new Includes(sharingIds) } as never,
        limit: sharingIds.length,
        skip: 0,
        select: {
          _id: true,
          name: true,
          ...getSharedNameSelect(data.modelType),
        } as never,
        sort: {},
      });

      for (const record of result.data) {
        const recordFacts: SharedNameFacts | undefined =
          getSharedNameFacts(record);

        if (record._id && recordFacts) {
          facts.set(record._id.toString(), recordFacts);
        }
      }
    } catch {
      // Marked all the same, without what sets each apart.
    }

    return facts;
  },
};

/*
 * The same, for a component: the facts of the records of `records` that
 * share a name, by id - empty until they are read, and when none share one.
 * Read again only when the records or their names change.
 */
export const useSharedNameFacts: <T extends BaseModel>(
  modelType: { new (): T },
  records: ReadonlyArray<NamedRecordOfList>,
) => Map<string, SharedNameFacts> = <T extends BaseModel>(
  modelType: { new (): T },
  records: ReadonlyArray<NamedRecordOfList>,
): Map<string, SharedNameFacts> => {
  const [facts, setFacts] = useState<Map<string, SharedNameFacts>>(
    new Map<string, SharedNameFacts>(),
  );

  // Which records share a name: read again only when that changes.
  const sharingKey: string = getIdsSharingAName(records).sort().join(",");

  useEffect(() => {
    if (!sharingKey) {
      setFacts(new Map<string, SharedNameFacts>());
      return;
    }

    let isCancelled: boolean = false;

    void SharedNameFactsReads.readFactsOfRecordsSharingAName({
      modelType: modelType,
      records: records,
    }).then((read: Map<string, SharedNameFacts>) => {
      if (!isCancelled) {
        setFacts(read);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [sharingKey]);

  return facts;
};
