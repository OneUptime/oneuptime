import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  RULE_CODE_REPOSITORIES_HINT_TEST_ID,
  RULE_CODE_REPOSITORIES_LOADING_TEST_ID,
  RULE_CODE_REPOSITORIES_PICKER_TEST_ID,
} from "./RuleCodeRepositoriesCopy";
import { formatCodeRepositoryOption } from "./CodeRepositorySearchField";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Route from "Common/Types/API/Route";
import { readCodeRepositoryIds } from "Common/Types/CodeRepository/CodeRepositoryAllowance";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown, {
  EntityDropdownValue,
} from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { getHeldValue } from "Common/UI/Components/EntityDropdown/HeldValueOptions";
import Link from "Common/UI/Components/Link/Link";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import RecordsById from "Common/UI/Utils/RecordsById";
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
 * However many repositories the project has (#10764), the field searches
 * them on the server as the person types - by name, organization or
 * repository name - and names the ones the rule holds by their ids before it
 * is drawn. It used to read the project's first 10,000 by name, and a
 * repository the rule named past them read as one the reader cannot access.
 * A repository the rule names that the reader may not read is kept, named
 * as one they cannot access, so an edit never drops it: a deleted
 * repository leaves the rule on its own (its join row goes with it), so one
 * the read does not answer is one out of the reader's reach.
 *
 * A project whose plan cannot read repositories must still be able to save
 * a rule: the search then finds nothing, and whatever the rule names reads
 * as a repository the reader cannot access.
 *
 * The line under it links to Code › Repositories in a new tab, as the
 * Runner field's line links to Runbooks › Runners, so the rule being edited
 * stays; the field searches the server each time it opens, so a repository
 * connected there can be picked at once.
 */

/*
 * What a held repository is read with: its name, and its host's
 * organization/name.
 */
const HELD_REPOSITORY_SELECT: {
  _id: true;
  name: true;
  organizationName: true;
  repositoryName: true;
} = {
  _id: true,
  name: true,
  organizationName: true,
  repositoryName: true,
};

/*
 * The repositories the rule names, each by its lower-cased id - read by
 * those ids. One the read does not answer, or every one when the read is
 * refused (a plan without Code), is a repository the reader cannot access.
 * Picks made since are named by the search that offered them (remember).
 */
export interface RuleCodeRepositoryNames {
  options: Map<string, DropdownOption> | null;
  remember: (options: Array<DropdownOption>) => void;
}

export function useRuleCodeRepositoryNames(
  ids: Array<string>,
): RuleCodeRepositoryNames {
  const [options, setOptions] = useState<Map<string, DropdownOption> | null>(
    null,
  );

  const idsKey: string = ids
    .map((id: string): string => {
      return id.toLowerCase();
    })
    .join("|");

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const known: Map<string, DropdownOption> = new Map(options || []);
      const toRead: Array<string> = ids.filter((id: string): boolean => {
        return !known.has(id.toLowerCase());
      });

      if (toRead.length > 0) {
        try {
          const records: Array<CodeRepository> =
            await RecordsById.read<CodeRepository>({
              modelType: CodeRepository,
              ids: toRead,
              select: HELD_REPOSITORY_SELECT,
            });

          for (const record of records) {
            const id: string = record._id?.toString().toLowerCase() || "";

            if (id) {
              known.set(
                id,
                formatCodeRepositoryOption(
                  { value: id, label: record.name || id },
                  record,
                ),
              );
            }
          }
        } catch {
          // Refused - a plan without Code: none is the reader's to read.
        }

        for (const id of RecordsById.getValuesToRead({ ids: toRead })) {
          if (!known.has(id)) {
            known.set(id, {
              value: id,
              label: RULE_CODE_REPOSITORIES_FIELD_COPY.hiddenRepository,
              isUserContent: false,
              isNotFound: true,
            });
          }
        }
      }

      if (isCurrent) {
        setOptions(known);
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [idsKey]);

  return {
    options,
    remember: (picked: Array<DropdownOption>): void => {
      const known: Map<string, DropdownOption> = new Map(options || []);

      for (const option of picked) {
        const id: string = String(option.value).toLowerCase();

        if (!known.has(id)) {
          known.set(id, { ...option, value: id });
        }
      }

      setOptions(known);
    },
  };
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
  const dataTestId: string =
    props.dataTestId || RULE_CODE_REPOSITORIES_PICKER_TEST_ID;
  // As the rule holds its ids: lower-cased (readCodeRepositoryIds).
  const pickedIds: Array<string> = readCodeRepositoryIds(props.value);
  const held: RuleCodeRepositoryNames = useRuleCodeRepositoryNames(pickedIds);

  if (!held.options && pickedIds.length > 0) {
    /*
     * The box's own place and height (EntityDropdown's), so the fields
     * below do not jump when it arrives - drawn once its picks are named,
     * never with their bare ids.
     */
    return (
      <Skeleton
        className="mt-2 mb-1 h-[38px] w-full rounded-lg"
        dataTestId={RULE_CODE_REPOSITORIES_LOADING_TEST_ID}
      />
    );
  }

  return (
    <div data-testid={dataTestId}>
      <EntityDropdown
        modelType={CodeRepository}
        labelField="name"
        valueField="_id"
        searchFields={["name", "organizationName", "repositoryName"]}
        formatOption={formatCodeRepositoryOption}
        value={
          getHeldValue({
            ids: pickedIds,
            options: held.options,
          }) as EntityDropdownValue
        }
        isMultiSelect={true}
        placeholder={RULE_CODE_REPOSITORIES_FIELD_COPY.placeholder}
        emptyListText={RULE_CODE_REPOSITORIES_FIELD_COPY.emptyList}
        notFoundLabel={RULE_CODE_REPOSITORIES_FIELD_COPY.hiddenRepository}
        dataTestId={`${dataTestId}-dropdown`}
        ariaLabel={translator.translateText(
          RULE_CODE_REPOSITORIES_FIELD_COPY.title,
        )}
        ariaLabelledby={props.ariaLabelledby}
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
          change: DropdownChange,
        ): void => {
          // A repository just picked is named by the search that offered it.
          held.remember(change.selectedOptions);

          const values: Array<DropdownValue> = Array.isArray(value)
            ? value
            : value === null || value === undefined
              ? []
              : [value];

          props.onChange(
            values.map((item: DropdownValue): string => {
              return String(item).toLowerCase();
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
 * new tab: the rule being edited stays, and the picker searches the
 * repositories again when it opens.
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
