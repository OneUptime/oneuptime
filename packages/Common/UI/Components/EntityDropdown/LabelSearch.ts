import Label from "../../../Models/DatabaseModels/Label";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import { getSharedNameSelect } from "../../Utils/SharedNameOptions";
import { translationKey } from "../../Utils/TranslateTemplate";
import { withSearch } from "./EntityDropdownQuery";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A PICKER'S LABELS TAB, SEARCHED ON THE SERVER AS IT IS TYPED IN (#10646).
 *
 * EntityDropdown's Labels tab and the Affected Resources picker's read the
 * project's first 10,000 labels by name the first time the tab opened, and
 * filtered them in the browser: a label past them was never offered, so
 * the entries it tags could not be bulk-added by it. The tab now asks the
 * server for the labels whose name holds what is typed, 50 by name, with
 * how many match; a label once read keeps its name, so one picked before
 * the search changed is still named (getLabel).
 */

// The most labels one search lists.
export const LABEL_SEARCH_PAGE_SIZE: number = 50;

const LABEL_SEARCH_DEBOUNCE_MS: number = 250;

export const LABEL_SEARCH_COPY: {
  loadFailed: string;
} = {
  loadFailed: translationKey(
    "Failed to load labels. You may not have permission to read labels.",
  ),
};

// What a search for labels reads of each.
export const getLabelSearchSelect: () => Select<Label> = (): Select<Label> => {
  return {
    _id: true,
    name: true,
    color: true,
    // What tells labels of one name apart (#10064).
    ...getSharedNameSelect(Label),
  } as Select<Label>;
};

// The query a search for labels sends: every label whose name holds it.
export const getLabelSearchQuery: (searchText: string) => Query<Label> = (
  searchText: string,
): Query<Label> => {
  return withSearch({}, "name", searchText) as Query<Label>;
};

export interface LabelSearch {
  // The labels the search found, by name: at most LABEL_SEARCH_PAGE_SIZE.
  labels: Array<Label>;
  // How many labels match what is typed.
  count: number;
  isLoading: boolean;
  // A search has answered since the tab opened.
  hasLoaded: boolean;
  // Why the last search failed, as a translation key; "" when it did not.
  error: string;
  // Any label a search found, by its id: a picked one keeps its name.
  getLabel: (id: string) => Label | undefined;
}

export default function useLabelSearch(data: {
  // Whether the tab is open: nothing is read while it is not.
  isActive: boolean;
  searchText: string;
  // The API the search goes through: the shared ModelAPI unless named.
  modelAPI?: typeof ModelAPI | undefined;
}): LabelSearch {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;
  const [labels, setLabels] = useState<Array<Label>>([]);
  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const seenRef: MutableRefObject<Map<string, Label>> = useRef<
    Map<string, Label>
  >(new Map());
  const searchSeqRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    if (!data.isActive) {
      return;
    }

    const trimmed: string = data.searchText.trim();
    const mySeq: number = ++searchSeqRef.current;

    setIsLoading(true);

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      async () => {
        try {
          const result: ListResult<Label> = await modelAPI.getList<Label>({
            modelType: Label,
            query: getLabelSearchQuery(trimmed),
            limit: LABEL_SEARCH_PAGE_SIZE,
            skip: 0,
            select: getLabelSearchSelect(),
            sort: { name: SortOrder.Ascending },
          });

          // A newer search went out: its answer is the one to show.
          if (mySeq !== searchSeqRef.current) {
            return;
          }

          for (const label of result.data || []) {
            const id: string = label._id?.toString() || "";

            if (id) {
              seenRef.current.set(id, label);
            }
          }

          setLabels(result.data || []);
          setCount(result.count ?? (result.data || []).length);
          setError("");
          setHasLoaded(true);
        } catch {
          if (mySeq === searchSeqRef.current) {
            setLabels([]);
            setCount(0);
            setError(LABEL_SEARCH_COPY.loadFailed);
          }
        } finally {
          if (mySeq === searchSeqRef.current) {
            setIsLoading(false);
          }
        }
      },
      trimmed === "" ? 0 : LABEL_SEARCH_DEBOUNCE_MS,
    );

    return () => {
      clearTimeout(timer);
    };
  }, [data.isActive, data.searchText, modelAPI]);

  const getLabel: (id: string) => Label | undefined = useCallback(
    (id: string): Label | undefined => {
      return seenRef.current.get(id);
    },
    [],
  );

  return {
    labels: labels,
    count: count,
    isLoading: isLoading,
    hasLoaded: hasLoaded,
    error: error,
    getLabel: getLabel,
  };
}
