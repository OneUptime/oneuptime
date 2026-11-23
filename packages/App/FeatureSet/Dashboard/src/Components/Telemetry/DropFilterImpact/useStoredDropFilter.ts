import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useState } from "react";

/*
 * A DROP FILTER AS IT IS SAVED, FOR ITS PAGE TO SAY WHAT A CHANGE TAKES
 * (#10436).
 *
 * A filter's page edits it a part at a time - its conditions, its action,
 * whether it is on - and each part's form holds only that part. What the
 * filter would take depends on all of them, so the page reads the filter
 * whole here, and puts the part being edited over it. Read again once a
 * part is saved.
 */
export interface StoredDropFilter {
  name: string;
  filterQuery: string;
  action: string;
  samplePercentage: number | null;
  isEnabled: boolean;
}

export interface StoredDropFilterResult {
  // Null until it is read, and when it could not be.
  filter: StoredDropFilter | null;
  reload: () => void;
}

export default function useStoredDropFilter(data: {
  modelType: typeof LogDropFilter | typeof TraceDropFilter;
  modelId: ObjectID;
}): StoredDropFilterResult {
  const [filter, setFilter] = useState<StoredDropFilter | null>(null);
  const [version, setVersion] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<LogDropFilter | TraceDropFilter>({
      modelType: data.modelType,
      id: data.modelId,
      select: {
        name: true,
        filterQuery: true,
        action: true,
        samplePercentage: true,
        isEnabled: true,
      },
    })
      .then((item: LogDropFilter | TraceDropFilter | null) => {
        if (!isCurrent) {
          return;
        }

        setFilter(
          item
            ? {
                name: item.name || "",
                filterQuery: (item.filterQuery as string) || "",
                action: item.action || "",
                samplePercentage:
                  typeof item.samplePercentage === "number"
                    ? item.samplePercentage
                    : null,
                isEnabled: item.isEnabled !== false,
              }
            : null,
        );
      })
      .catch(() => {
        if (isCurrent) {
          // The page's own cards say what failed; this only adds the impact.
          setFilter(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [data.modelId.toString(), version]);

  const reload: () => void = useCallback(() => {
    setVersion((current: number) => {
      return current + 1;
    });
  }, []);

  return { filter, reload };
}
