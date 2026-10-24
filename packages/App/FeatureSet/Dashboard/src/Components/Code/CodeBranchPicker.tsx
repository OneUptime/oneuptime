import CodeApi from "./CodeApi";
import { GitBranchMark } from "./CodeMarks";
import CodePicker, { CodePickerOption } from "./CodePicker";
import { CODE_PICKER_COPY } from "./CodeTaskCopy";
import { CodeRepositoryBranchesJSON } from "Common/Types/AI/CodeTask";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  repositoryId: string;
  /*
   * The repository's main branch, where a task starts unless another is
   * picked: empty while it is not known.
   */
  defaultBranch: string;
  // The branch picked, or null for the main branch.
  value: string | null;
  onChange: (branch: string | null) => void;
  isDisabled?: boolean | undefined;
  /*
   * Where the repository is hosted (CodeRepositoryType), for what a read
   * that fails names: GitHub, or its Git server. Unknown is GitHub.
   */
  provider?: string | undefined;
  /*
   * A Git server only a Runner of the project's own reaches: OneUptime
   * reads none of its branches, so the picker offers the main branch and
   * says why - it never asks the server for the rest.
   */
  isNotReadByServer?: boolean | undefined;
}

// How long typing rests before the server is asked for matching branches.
export const BRANCH_SEARCH_DELAY_MS: number = 250;

/*
 * The branches a picker holding every branch shows for what was typed:
 * those whose names hold it, in the order they came (the main branch
 * first). Nothing typed: all of them.
 */
export const filterBranches: (
  branches: Array<string>,
  search: string,
) => Array<string> = (
  branches: Array<string>,
  search: string,
): Array<string> => {
  const needle: string = search.trim().toLowerCase();

  if (!needle) {
    return branches;
  }

  return branches.filter((branch: string): boolean => {
    return branch.toLowerCase().includes(needle);
  });
};

/*
 * The branch a task starts from, picked beside the repository the way
 * coding agents pick one: the repository's main branch until another is
 * picked. Its branches are read from its host (GitHub, GitLab, Forgejo,
 * Gitea, a Git server) the first time it opens - the main branch first,
 * marked Default. A repository with more branches than one read holds is
 * searched on the server by what the person types; one that is not read
 * says so, with Try again. A Git server only the project's own Runner
 * reaches is never read: the main branch is offered, and the picker says
 * why.
 */
const CodeBranchPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [listing, setListing] = useState<CodeRepositoryBranchesJSON | null>(
    null,
  );
  const [search, setSearch] = useState<string>("");
  const [found, setFound] = useState<Array<string> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Only the latest read counts: an answer to an older search is dropped.
  const readRef: React.MutableRefObject<number> = useRef<number>(0);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer: () => void = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Another repository: its own branches, read afresh.
  useEffect(() => {
    readRef.current++;
    clearTimer();
    setListing(null);
    setSearch("");
    setFound(null);
    setError(null);
    setIsLoading(false);
  }, [props.repositoryId]);

  useEffect(() => {
    return clearTimer;
  }, []);

  const read: (searchText: string) => Promise<void> = async (
    searchText: string,
  ): Promise<void> => {
    const readNumber: number = ++readRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const answer: CodeRepositoryBranchesJSON = await CodeApi.getBranches({
        repositoryId: props.repositoryId,
        search: searchText || undefined,
      });

      if (readNumber !== readRef.current) {
        return;
      }

      if (searchText) {
        setFound(answer.branches);
      } else {
        setListing(answer);
      }
    } catch {
      if (readNumber !== readRef.current) {
        return;
      }

      setError(
        translator.translateTemplate(
          CodeHost.readType(props.provider) === CodeRepositoryType.GitHub
            ? CODE_PICKER_COPY.branchesUnreadable
            : CODE_PICKER_COPY.branchesUnreadableAnyHost,
        ),
      );
    }

    setIsLoading(false);
  };

  const defaultBranch: string = listing?.defaultBranch || props.defaultBranch;
  const searchText: string = search.trim();
  const searchesServer: boolean = Boolean(
    listing && !listing.isComplete && searchText,
  );

  // A search the server answers is loading until its answer arrives.
  const isSearching: boolean = searchesServer && (isLoading || found === null);

  const names: Array<string> = props.isNotReadByServer
    ? filterBranches(defaultBranch ? [defaultBranch] : [], search)
    : searchesServer
      ? found || []
      : filterBranches(listing?.branches || [], search);

  const options: Array<CodePickerOption> = names.map(
    (name: string): CodePickerOption => {
      return name === defaultBranch
        ? {
            value: name,
            label: name,
            badge: translator.translateTemplate(
              CODE_PICKER_COPY.branchDefaultBadge,
            ),
          }
        : { value: name, label: name };
    },
  );

  const valueText: string =
    props.value ||
    defaultBranch ||
    translator.translateTemplate(CODE_PICKER_COPY.branchUnknownDefault);

  return (
    <CodePicker
      dataTestId="code-branch-picker"
      label={translator.translateTemplate(CODE_PICKER_COPY.branchLabel)}
      valueText={valueText}
      icon={<GitBranchMark className="h-3.5 w-3.5 text-gray-500" />}
      isMonospace={Boolean(props.value || defaultBranch)}
      options={options}
      value={props.value || defaultBranch || null}
      onChange={(name: string) => {
        props.onChange(name === defaultBranch ? null : name);
      }}
      searchPlaceholder={translator.translateTemplate(
        CODE_PICKER_COPY.branchSearch,
      )}
      noMatchText={translator.translateTemplate(CODE_PICKER_COPY.branchNoMatch)}
      onOpen={() => {
        if (!listing && !isLoading && !props.isNotReadByServer) {
          void read("");
        }
      }}
      onSearch={(text: string) => {
        setSearch(text);
        clearTimer();

        const trimmed: string = text.trim();

        // A new search forgets the last one's answer until its own arrives.
        setFound(null);

        if (!listing || listing.isComplete || !trimmed) {
          return;
        }

        timerRef.current = setTimeout(() => {
          void read(trimmed);
        }, BRANCH_SEARCH_DELAY_MS);
      }}
      isLoading={(isLoading && !listing) || isSearching}
      loadingText={translator.translateTemplate(CODE_PICKER_COPY.branchLoading)}
      error={error}
      onRetry={() => {
        void read(searchesServer ? searchText : "");
      }}
      note={
        props.isNotReadByServer
          ? translator.translateTemplate(CODE_PICKER_COPY.branchesNotRead)
          : listing && !listing.isComplete && !searchText
            ? translator.translateTemplate(
                CODE_PICKER_COPY.branchesSearchToFindMore,
              )
            : null
      }
      isDisabled={props.isDisabled}
    />
  );
};

export default CodeBranchPicker;
