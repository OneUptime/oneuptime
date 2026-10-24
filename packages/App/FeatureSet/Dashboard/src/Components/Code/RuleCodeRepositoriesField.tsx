import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  RULE_CODE_REPOSITORIES_HINT_TEST_ID,
  RULE_CODE_REPOSITORIES_LOADING_TEST_ID,
  RULE_CODE_REPOSITORIES_PICKER_TEST_ID,
  RuleCodeRepositoryChoice,
  getRuleCodeRepositoryChoices,
} from "./RuleCodeRepositoriesCopy";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { readCodeRepositoryIds } from "Common/Types/CodeRepository/CodeRepositoryAllowance";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import Link from "Common/UI/Components/Link/Link";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";

/*
 * A rule's "Code Repositories" field - an auto remediation rule's and an
 * investigation rule's, under More fields: the repositories OneUptime AI
 * may use for what the rule matches. Empty is an answer of its own, "All
 * connected repositories", so it is drawn as the placeholder and never as
 * "(Optional)".
 *
 * It is drawn as the Runbooks and MCP Servers pickers beside it are
 * (EntityDropdown): the repositories picked as chips over a search box, and
 * a menu that lists each by name with GitHub's organization/name beside it.
 *
 * It reads the project's repositories itself rather than through the form's
 * dropdown loader: Code's repositories are a paid feature on OneUptime
 * Cloud, and a project whose plan cannot read them must still be able to
 * save a rule - there the list is empty and the rule uses every connected
 * repository, which is none. A repository the rule names that the reader may
 * not read is kept, named as one they cannot access, so an edit never drops
 * it.
 *
 * The line under it links to Code › Repositories in a new tab, as the
 * Runner field's line links to Runbooks › Runners, so the rule being edited
 * stays; the repositories are read again when the person comes back to this
 * tab, so one they just connected can be picked at once.
 */

// The project's repositories, by name.
async function readRuleCodeRepositoryChoices(): Promise<
  Array<RuleCodeRepositoryChoice>
> {
  const result: ListResult<CodeRepository> =
    await ModelAPI.getList<CodeRepository>({
      modelType: CodeRepository,
      query: {},
      select: {
        _id: true,
        name: true,
        organizationName: true,
        repositoryName: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  return result.data.map(
    (repository: CodeRepository): RuleCodeRepositoryChoice => {
      const name: string = repository.name || "";
      const fullName: string =
        repository.organizationName && repository.repositoryName
          ? `${repository.organizationName}/${repository.repositoryName}`
          : "";

      return {
        id: repository._id?.toString() || "",
        name: name || fullName,
        ...(fullName && fullName !== name ? { fullName } : {}),
      };
    },
  );
}

/*
 * The project's repositories, by name, or null while they are first read -
 * and read again whenever the window takes the focus back.
 */
export function useRuleCodeRepositoryChoices(): Array<RuleCodeRepositoryChoice> | null {
  const [repositories, setRepositories] =
    useState<Array<RuleCodeRepositoryChoice> | null>(null);

  useEffect(() => {
    let isMounted: boolean = true;
    // Only the newest read is drawn: an older answer arriving late is dropped.
    let latestRead: number = 0;

    const read: () => void = (): void => {
      latestRead++;
      const thisRead: number = latestRead;

      readRuleCodeRepositoryChoices()
        .then((choices: Array<RuleCodeRepositoryChoice>) => {
          if (isMounted && thisRead === latestRead) {
            setRepositories(choices);
          }
        })
        .catch(() => {
          /*
           * Not read - a plan without Code, or a reader who may not read
           * repositories: nothing to pick, and the rule's own picks are
           * still kept and shown. A read again that fails keeps the list
           * the field already has.
           */
          if (isMounted && thisRead === latestRead) {
            setRepositories(
              (
                current: Array<RuleCodeRepositoryChoice> | null,
              ): Array<RuleCodeRepositoryChoice> => {
                return current || [];
              },
            );
          }
        });
    };

    read();
    window.addEventListener("focus", read);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", read);
    };
  }, []);

  return repositories;
}

export interface RuleCodeRepositoriesPickerProps {
  // The repositories the rule names, as the form holds them.
  value: unknown;
  // The repositories picked, by id: none for all of them.
  onChange: (repositoryIds: Array<string>) => void;
  // The label the form drew for the field, read out with the menu.
  ariaLabelledby?: string | undefined;
  dataTestId?: string | undefined;
}

export const RuleCodeRepositoriesPicker: FunctionComponent<
  RuleCodeRepositoriesPickerProps
> = (props: RuleCodeRepositoriesPickerProps): ReactElement => {
  const translator: Translator = useTranslator();
  const repositories: Array<RuleCodeRepositoryChoice> | null =
    useRuleCodeRepositoryChoices();
  const dataTestId: string =
    props.dataTestId || RULE_CODE_REPOSITORIES_PICKER_TEST_ID;

  if (!repositories) {
    /*
     * The box's own place and height (EntityDropdown's), so the fields
     * below do not jump when it arrives.
     */
    return (
      <Skeleton
        className="mt-2 mb-1 h-[38px] w-full rounded-lg"
        dataTestId={RULE_CODE_REPOSITORIES_LOADING_TEST_ID}
      />
    );
  }

  const pickedIds: Array<string> = readCodeRepositoryIds(props.value);

  const toOption: (choice: RuleCodeRepositoryChoice) => DropdownOption = (
    choice: RuleCodeRepositoryChoice,
  ): DropdownOption => {
    return {
      // As the rule holds its ids: lower-cased (readCodeRepositoryIds).
      value: choice.id.toLowerCase(),
      /*
       * A repository's name is drawn as it is called (EntityDropdown never
       * looks a label up); the words for one the reader may not read are
       * translated here.
       */
      label: choice.isHidden
        ? translator.translateText(choice.name) || choice.name
        : choice.name,
      ...(choice.fullName ? { description: choice.fullName } : {}),
    };
  };

  const options: Array<DropdownOption> = getRuleCodeRepositoryChoices({
    repositories,
    pickedIds,
    hiddenLabel: RULE_CODE_REPOSITORIES_FIELD_COPY.hiddenRepository,
  }).map(toOption);

  // The repositories picked, as chips in the list's order: by name, hidden last.
  const selectedIds: Array<string> = options
    .filter((option: DropdownOption): boolean => {
      return pickedIds.includes(String(option.value));
    })
    .map((option: DropdownOption): string => {
      return String(option.value);
    });

  return (
    <div data-testid={dataTestId}>
      <EntityDropdown
        options={options}
        value={selectedIds}
        isMultiSelect={true}
        placeholder={RULE_CODE_REPOSITORIES_FIELD_COPY.placeholder}
        dataTestId={`${dataTestId}-dropdown`}
        ariaLabel={translator.translateText(
          RULE_CODE_REPOSITORIES_FIELD_COPY.title,
        )}
        ariaLabelledby={props.ariaLabelledby}
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
        ): void => {
          const values: Array<DropdownValue> = Array.isArray(value)
            ? value
            : value === null || value === undefined
              ? []
              : [value];

          props.onChange(
            values.map((item: DropdownValue): string => {
              return String(item);
            }),
          );
        }}
      />
    </div>
  );
};

/*
 * Under the field: where the repositories it lists are connected, as a
 * link - so a project with none yet finds the page. Close under its box
 * and a field's gap above the next field, as the MCP Servers hint is. In a
 * new tab: the rule being edited stays, and the picker reads the
 * repositories again when the person comes back.
 */
export interface RuleCodeRepositoriesFieldHintProps {
  /*
   * A sentence more about the repositories, in the same line of help: a
   * telemetry rule says whose Runner changes their code (it has no Runner
   * field of its own).
   */
  extra?: ReactNode | undefined;
}

export const RuleCodeRepositoriesFieldHint: FunctionComponent<
  RuleCodeRepositoriesFieldHintProps
> = (props: RuleCodeRepositoriesFieldHintProps): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      className="mt-1.5 mb-2 text-xs text-gray-500"
      data-testid={RULE_CODE_REPOSITORIES_HINT_TEST_ID}
    >
      <TranslatedSentence
        template={RULE_CODE_REPOSITORIES_FIELD_COPY.manageHint}
        slots={{
          codeRepositoriesLink: (
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CODE_REPOSITORIES] as Route,
              )}
              openInNewTab={true}
              className="underline"
              dataTestId="rule-code-repositories-link"
            >
              {translator.translateText("Code › Repositories")}
            </Link>
          ),
        }}
      />
      {props.extra ? <> {props.extra}</> : <></>}
    </p>
  );
};
