import CodeApi, {
  CodeRepositoriesResponse,
  CodeRepositoryListItem,
} from "./CodeApi";
import { getRepositoryFullName } from "./CodePaths";
import {
  orderRepositoriesForPicker,
  REPOSITORY_PICKER_PAGE_SIZE,
  REPOSITORY_SEARCH_DELAY_MS,
} from "./CodeRepositoriesList";
import CodePicker, { CodePickerOption } from "./CodePicker";
import { CODE_PICKER_COPY } from "./CodeTaskCopy";
import CodeHostMark from "./CodeHostMark";
import { CodeRepositoryListOrder } from "Common/Types/AI/CodeTask";
import API from "Common/UI/Utils/API/API";
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
  /*
   * The repository picked, as the list reads it (its name, its host and how
   * it connects) - or null while none is.
   */
  value: CodeRepositoryListItem | null;
  onChange: (repository: CodeRepositoryListItem) => void;
  isDisabled?: boolean | undefined;
}

/*
 * The repositories a request can go to, as the picker lists them: those AI
 * can work in first, then those it cannot (orderRepositoriesForPicker) -
 * each by name, GitHub's organization/name under it when it says more, and
 * "Not connected", quieter, on one AI cannot reach: it can still be picked,
 * and the box then says what connects it.
 */
export const getRepositoryOptions: (
  repositories: Array<CodeRepositoryListItem>,
  translator: Translator,
) => Array<CodePickerOption> = (
  repositories: Array<CodeRepositoryListItem>,
  translator: Translator,
): Array<CodePickerOption> => {
  return orderRepositoriesForPicker(repositories).map(
    (repository: CodeRepositoryListItem): CodePickerOption => {
      const fullName: string = getRepositoryFullName(repository);
      const option: CodePickerOption = {
        value: repository.id,
        label: repository.name,
      };

      if (fullName && fullName !== repository.name) {
        option.description = fullName;
      }

      if (!repository.isConnected) {
        option.badge = translator.translateTemplate("Not connected");
        option.isMuted = true;
      }

      return option;
    },
  );
};

/*
 * Which repository a request goes to, picked in the request box the way
 * coding agents pick one: its host's mark (GitHub, GitLab, Forgejo, Gitea,
 * Git) and its name, opening the repositories with a search box.
 *
 * However many repositories the project has (#10764): the picker asks the
 * server for them as it opens - the first REPOSITORY_PICKER_PAGE_SIZE by
 * name, those AI can work in first - and for those whose name,
 * organization/name or description holds what is typed, once typing rests.
 * It used to filter the project's first 500 in the browser, so a
 * repository past them could not be picked. When the project has more
 * than it lists, a line under the list says to type a name to find the
 * rest. Only the newest read lands.
 */
const CodeRepositoryPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [answer, setAnswer] = useState<CodeRepositoriesResponse | null>(null);
  const [search, setSearch] = useState<string>("");
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
      const found: CodeRepositoriesResponse = await CodeApi.getRepositories({
        search: searchText,
        order: CodeRepositoryListOrder.Name,
        limit: REPOSITORY_PICKER_PAGE_SIZE,
      });

      if (readNumber !== readRef.current) {
        return;
      }

      setAnswer(found);
    } catch (err) {
      if (readNumber !== readRef.current) {
        return;
      }

      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const repositories: Array<CodeRepositoryListItem> = answer?.repositories || [];
  const searchText: string = search.trim();
  const hasMore: boolean = Boolean(
    answer && answer.count > answer.repositories.length,
  );

  return (
    <CodePicker
      dataTestId="code-repository-picker"
      label={translator.translateTemplate(CODE_PICKER_COPY.repositoryLabel)}
      valueText={
        props.value
          ? props.value.name
          : translator.translateTemplate(CODE_PICKER_COPY.repositoryNone)
      }
      icon={
        <span className="inline-flex text-gray-700">
          <CodeHostMark
            provider={props.value?.provider}
            hostProduct={props.value?.connection?.hostProduct}
            className="h-3.5 w-3.5"
          />
        </span>
      }
      options={getRepositoryOptions(repositories, translator)}
      value={props.value?.id || null}
      onChange={(repositoryId: string) => {
        const picked: CodeRepositoryListItem | undefined = repositories.find(
          (repository: CodeRepositoryListItem): boolean => {
            return repository.id === repositoryId;
          },
        );

        if (picked) {
          props.onChange(picked);
        }
      }}
      searchPlaceholder={translator.translateTemplate(
        CODE_PICKER_COPY.repositorySearch,
      )}
      noMatchText={translator.translateTemplate(
        CODE_PICKER_COPY.repositoryNoMatch,
      )}
      onOpen={() => {
        // Read afresh each time it opens: a repository just connected is in.
        clearTimer();
        void read("");
      }}
      onSearch={(text: string) => {
        setSearch(text);
        clearTimer();

        const trimmed: string = text.trim();

        // Opening reads the first page itself; a search waits for typing to rest.
        if (!trimmed && !answer) {
          return;
        }

        timerRef.current = setTimeout(
          () => {
            void read(trimmed);
          },
          trimmed ? REPOSITORY_SEARCH_DELAY_MS : 0,
        );
      }}
      isLoading={isLoading && (!answer || Boolean(searchText))}
      error={error}
      onRetry={() => {
        void read(searchText);
      }}
      note={
        hasMore
          ? translator.translateTemplate(
              CODE_PICKER_COPY.repositoriesSearchToFindMore,
            )
          : null
      }
      isDisabled={props.isDisabled}
    />
  );
};

export default CodeRepositoryPicker;
