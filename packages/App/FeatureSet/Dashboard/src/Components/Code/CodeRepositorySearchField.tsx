import CodeRepositoryChoicesAPI, {
  CODE_REPOSITORY_CHOICE_GROUP_KEY,
} from "./CodeRepositoryChoicesAPI";
import { RULE_CODE_REPOSITORIES_FIELD_COPY } from "./RuleCodeRepositoriesCopy";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CodeRepositoryListGroup,
  CodeTaskRepositoryJSON,
} from "Common/Types/AI/CodeTask";
import { getCodeRepositoryFullName } from "Common/Types/CodeRepository/CodeRepositorySearch";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "Common/UI/Components/EntityDropdown/EntityDropdownNotFound";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ONE OF THE PROJECT'S REPOSITORIES, PICKED IN A FORM (#10764).
 *
 * The shared entity picker (EntityDropdown), searching the server as the
 * person types over every repository they may read - however many the
 * project has - and reading the one it holds by its id
 * (CodeRepositoryChoicesAPI). A form offered the project's first 500
 * repositories, filtered in the browser, so a repository past them could
 * not be picked. Each is listed by its name, with its host's
 * organization/name under it when that says more. `group` keeps it to one
 * of Code's two lists: the repositories AI can work in, for a request that
 * starts AI.
 */

export interface ComponentProps {
  // The repository picked, by id: null for none.
  value: string | null;
  onChange: (repositoryId: string | null) => void;
  /*
   * The repository picked, as a page already read it: its name is drawn at
   * once, never its id while it is read again.
   */
  knownRepository?: CodeTaskRepositoryJSON | null | undefined;
  group?: CodeRepositoryListGroup | undefined;
  // In English, a key to look up.
  placeholder?: string | undefined;
  // What the open list says while there is nothing to pick: a key.
  emptyListText?: string | undefined;
  isClearable?: boolean | undefined;
  error?: string | undefined;
  tabIndex?: number | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  dataTestId?: string | undefined;
}

// A repository as the picker lists it: its name, its host's organization/name under it.
export const formatCodeRepositoryOption: (
  option: DropdownOption,
  record: BaseModel,
) => DropdownOption = (
  option: DropdownOption,
  record: BaseModel,
): DropdownOption => {
  const repository: CodeRepository = record as CodeRepository;
  const fullName: string = getCodeRepositoryFullName({
    organizationName: repository.organizationName || "",
    repositoryName: repository.repositoryName || "",
  });
  const formatted: DropdownOption = {
    ...option,
    // A repository's name, as its project named it.
    isUserContent: true,
  };

  if (fullName && fullName !== String(option.label)) {
    formatted.description = fullName;
  }

  return formatted;
};

const CodeRepositorySearchField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const value: DropdownOption | string | undefined =
    props.value &&
    props.knownRepository &&
    props.knownRepository.id === props.value
      ? formatCodeRepositoryOption(
          { value: props.value, label: props.knownRepository.name },
          Object.assign(new CodeRepository(), {
            organizationName: props.knownRepository.organizationName,
            repositoryName: props.knownRepository.repositoryName,
          }),
        )
      : props.value || undefined;

  return (
    <EntityDropdown
      modelType={CodeRepository}
      modelAPI={CodeRepositoryChoicesAPI}
      labelField="name"
      valueField="_id"
      query={
        props.group ? { [CODE_REPOSITORY_CHOICE_GROUP_KEY]: props.group } : {}
      }
      enableLabelsTab={false}
      isMultiSelect={false}
      isClearable={props.isClearable}
      value={value}
      placeholder={props.placeholder}
      emptyListText={
        props.emptyListText || RULE_CODE_REPOSITORIES_FIELD_COPY.emptyList
      }
      notFoundLabel={ENTITY_DROPDOWN_NOT_FOUND_LABEL}
      formatOption={formatCodeRepositoryOption}
      error={props.error}
      tabIndex={props.tabIndex}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      dataTestId={props.dataTestId}
      onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
        const picked: DropdownValue | undefined = Array.isArray(next)
          ? next[0]
          : next === null
            ? undefined
            : next;

        props.onChange(
          picked === undefined || picked === null ? null : String(picked),
        );
      }}
    />
  );
};

export default CodeRepositorySearchField;
