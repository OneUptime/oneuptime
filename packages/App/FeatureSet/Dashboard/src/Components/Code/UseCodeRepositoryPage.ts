import CodeApi, { CodeRepositoriesResponse } from "./CodeApi";
import {
  CodeRepositoryListGroup,
  CodeRepositoryListOrder,
} from "Common/Types/AI/CodeTask";
import API from "Common/UI/Utils/API/API";
import { useEffect, useRef, useState } from "react";

/*
 * ONE PAGE OF THE READER'S REPOSITORIES, AS THE SERVER READS IT (#10764).
 *
 * Code's Repositories page held the first 500 repositories and paged and
 * searched them itself. Each of its lists now asks the server for the page
 * it shows - searched, ordered and counted over every repository the reader
 * may read - and again whenever the search, the page or `refreshToken`
 * changes. Only the newest read lands: an answer to an older search or page
 * arriving late is dropped. The page last read stays while the next one
 * loads, so a table never empties between pages.
 */

export interface CodeRepositoryPageQuery {
  group?: CodeRepositoryListGroup | undefined;
  order?: CodeRepositoryListOrder | undefined;
  search: string;
  pageNumber: number;
  pageSize: number;
  // Read only while true: a folded list is not read until it opens.
  isEnabled: boolean;
  // Change it to read the page again (Refresh, a repository connected).
  refreshToken: number;
}

export interface CodeRepositoryPageState {
  // The page last read, kept while the next one loads; null before any.
  data: CodeRepositoriesResponse | null;
  isLoading: boolean;
  // Why the last read failed, in the reader's words; null when it did not.
  error: string | null;
}

const useCodeRepositoryPage: (
  query: CodeRepositoryPageQuery,
) => CodeRepositoryPageState = (
  query: CodeRepositoryPageQuery,
): CodeRepositoryPageState => {
  const [state, setState] = useState<CodeRepositoryPageState>({
    data: null,
    isLoading: query.isEnabled,
    error: null,
  });

  const latestReadRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    if (!query.isEnabled) {
      return;
    }

    const readNumber: number = ++latestReadRef.current;
    const pageSize: number = Math.max(1, query.pageSize);
    const pageNumber: number = Math.max(1, query.pageNumber);

    setState((current: CodeRepositoryPageState): CodeRepositoryPageState => {
      return { ...current, isLoading: true };
    });

    CodeApi.getRepositories({
      search: query.search,
      group: query.group,
      order: query.order,
      skip: (pageNumber - 1) * pageSize,
      limit: pageSize,
    })
      .then((data: CodeRepositoriesResponse) => {
        if (readNumber === latestReadRef.current) {
          setState({ data, isLoading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (readNumber === latestReadRef.current) {
          setState(
            (current: CodeRepositoryPageState): CodeRepositoryPageState => {
              return {
                ...current,
                isLoading: false,
                error: API.getFriendlyMessage(error),
              };
            },
          );
        }
      });
  }, [
    query.group,
    query.order,
    query.search,
    query.pageNumber,
    query.pageSize,
    query.isEnabled,
    query.refreshToken,
  ]);

  return state;
};

export default useCodeRepositoryPage;

/*
 * The page a list should show once a read says how many it holds: the same
 * one, or the last one it has when the list shrank under it (a repository
 * deleted, a search narrowed) - never a page past its end.
 */
export const getPageWithinList: (data: {
  pageNumber: number;
  pageSize: number;
  count: number;
}) => number = (data: {
  pageNumber: number;
  pageSize: number;
  count: number;
}): number => {
  const pageCount: number = Math.max(
    1,
    Math.ceil(Math.max(0, data.count) / Math.max(1, data.pageSize)),
  );

  return Math.min(Math.max(1, Math.floor(data.pageNumber) || 1), pageCount);
};
