import { CodeRepositoryListItem } from "./CodeApi";
import { getRepositoryFullName } from "./CodePaths";
import CodePicker, { CodePickerOption } from "./CodePicker";
import { CODE_PICKER_COPY } from "./CodeTaskCopy";
import { GitHubMark } from "./GitHubConnect";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  repositories: Array<CodeRepositoryListItem>;
  value: string | null;
  onChange: (repositoryId: string) => void;
  isDisabled?: boolean | undefined;
}

/*
 * The repositories a request can go to, as the picker lists them: by name,
 * GitHub's organization/name under it when it says more, and "Not
 * connected", quieter, on one AI cannot reach - it can still be picked, and
 * the box then says what connects it.
 */
export const getRepositoryOptions: (
  repositories: Array<CodeRepositoryListItem>,
  translator: Translator,
) => Array<CodePickerOption> = (
  repositories: Array<CodeRepositoryListItem>,
  translator: Translator,
): Array<CodePickerOption> => {
  return repositories.map(
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
 * coding agents pick one: the GitHub mark and its name, opening the
 * repositories with a search box.
 */
const CodeRepositoryPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const picked: CodeRepositoryListItem | undefined = props.repositories.find(
    (repository: CodeRepositoryListItem): boolean => {
      return repository.id === props.value;
    },
  );

  return (
    <CodePicker
      dataTestId="code-repository-picker"
      label={translator.translateTemplate(CODE_PICKER_COPY.repositoryLabel)}
      valueText={
        picked
          ? picked.name
          : translator.translateTemplate(CODE_PICKER_COPY.repositoryNone)
      }
      icon={<GitHubMark className="h-3.5 w-3.5 text-gray-700" />}
      options={getRepositoryOptions(props.repositories, translator)}
      value={props.value}
      onChange={props.onChange}
      searchPlaceholder={translator.translateTemplate(
        CODE_PICKER_COPY.repositorySearch,
      )}
      noMatchText={translator.translateTemplate(
        CODE_PICKER_COPY.repositoryNoMatch,
      )}
      isDisabled={props.isDisabled}
    />
  );
};

export default CodeRepositoryPicker;
