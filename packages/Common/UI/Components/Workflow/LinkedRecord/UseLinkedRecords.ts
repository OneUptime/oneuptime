/*
 * What a setting that names the project's records needs to draw its list: the
 * records to offer, the name behind each ID it already holds, and whether the
 * list could be read at all.
 *
 * The list is asked for as the setting appears, so a step opened to be read
 * shows names rather than IDs, and a person who may not list these records gets
 * the box to type an ID into straight away, not after they open a list that
 * then has nothing in it.
 */

import { DropdownOption } from "../../Dropdown/Dropdown";
import {
  LinkedRecordList,
  loadLinkedRecords,
  loadLinkedRecordsById,
} from "./LinkedRecordSource";
import { containsTemplateExpression } from "../ValuePicker/TemplateText";
import React, { useEffect, useRef, useState } from "react";

// How long typing has to pause before the server is asked what matches.
export const LINKED_RECORD_SEARCH_DELAY_MS: number = 250;

export interface LinkedRecordSources {
  load: typeof loadLinkedRecords;
  loadById: typeof loadLinkedRecordsById;
}

export interface LinkedRecordsState {
  // What the list offers now: a search's matches while one is typed.
  options: Array<DropdownOption>;
  // Every record known by its ID so far, to name what a setting holds.
  known: Map<string, DropdownOption>;
  // The first page is on its way, or a search is.
  isLoading: boolean;
  // The list could not be read: the setting is typed into instead.
  isUnavailable: boolean;
  onSearchTextChange: (text: string) => void;
}

export interface UseLinkedRecordsData {
  tableName: string;
  // What the setting holds: the IDs, and any references, it names.
  values: Array<string>;
  sources?: LinkedRecordSources | undefined;
}

type RememberFunction = (options: Array<DropdownOption>) => void;

const DEFAULT_SOURCES: LinkedRecordSources = {
  load: loadLinkedRecords,
  loadById: loadLinkedRecordsById,
};

const useLinkedRecords: (data: UseLinkedRecordsData) => LinkedRecordsState = (
  data: UseLinkedRecordsData,
): LinkedRecordsState => {
  const sources: LinkedRecordSources = data.sources || DEFAULT_SOURCES;

  const [firstPage, setFirstPage] = useState<LinkedRecordList | null>(null);
  const [searchResult, setSearchResult] = useState<LinkedRecordList | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [known, setKnown] = useState<Map<string, DropdownOption>>(new Map());

  const searchTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest search may fill the list: a slow answer is dropped.
  const searchRequest: React.MutableRefObject<number> = useRef<number>(0);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  // IDs already asked for, so an answer that is empty is not asked for again.
  const askedForIds: React.MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;

      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
    };
  }, []);

  const remember: RememberFunction = (options: Array<DropdownOption>): void => {
    if (!isMounted.current || options.length === 0) {
      return;
    }

    setKnown((current: Map<string, DropdownOption>) => {
      const next: Map<string, DropdownOption> = new Map(current);

      for (const option of options) {
        next.set(String(option.value).toLowerCase(), option);
      }

      return next;
    });
  };

  useEffect(() => {
    let isCurrent: boolean = true;

    setFirstPage(null);
    setSearchResult(null);
    setIsUnavailable(false);

    void (async (): Promise<void> => {
      try {
        const list: LinkedRecordList = await sources.load({
          tableName: data.tableName,
        });

        if (isCurrent && isMounted.current) {
          setFirstPage(list);
          remember(list.options);
        }
      } catch {
        if (isCurrent && isMounted.current) {
          setIsUnavailable(true);
        }
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [data.tableName]);

  // The IDs the setting holds, that the list did not name.
  const idsToLookUp: Array<string> = data.values.filter(
    (value: string): boolean => {
      return (
        value !== "" &&
        !containsTemplateExpression(value) &&
        !known.has(value.toLowerCase()) &&
        !askedForIds.current.has(value.toLowerCase())
      );
    },
  );

  const idsToLookUpKey: string = idsToLookUp.join("|");

  useEffect(() => {
    // Once the first page is here: most of what is held is on it.
    if (firstPage === null || idsToLookUp.length === 0) {
      return;
    }

    for (const id of idsToLookUp) {
      askedForIds.current.add(id.toLowerCase());
    }

    void (async (): Promise<void> => {
      try {
        remember(
          await sources.loadById({
            tableName: data.tableName,
            ids: idsToLookUp,
          }),
        );
      } catch {
        // The ID is shown as it is, and can still be changed.
      }
    })();
  }, [firstPage, idsToLookUpKey]);

  type OnSearchTextChangeFunction = (text: string) => void;

  const onSearchTextChange: OnSearchTextChangeFunction = (
    text: string,
  ): void => {
    const search: string = text.trim();

    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }

    const request: number = ++searchRequest.current;

    // Nothing typed, or a list that is all there: the menu filters it itself.
    if (search === "" || !firstPage || firstPage.isComplete) {
      setSearchResult(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    searchTimer.current = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const list: LinkedRecordList = await sources.load({
            tableName: data.tableName,
            search: search,
          });

          if (request !== searchRequest.current || !isMounted.current) {
            return;
          }

          setSearchResult(list);
          remember(list.options);
        } catch {
          // What is on the first page can still be picked.
          if (request === searchRequest.current && isMounted.current) {
            setSearchResult(null);
          }
        } finally {
          if (request === searchRequest.current && isMounted.current) {
            setIsSearching(false);
          }
        }
      })();
    }, LINKED_RECORD_SEARCH_DELAY_MS);
  };

  return {
    options: (searchResult || firstPage)?.options || [],
    known: known,
    isLoading: (firstPage === null && !isUnavailable) || isSearching,
    isUnavailable: isUnavailable,
    onSearchTextChange: onSearchTextChange,
  };
};

export default useLinkedRecords;
