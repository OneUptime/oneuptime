import {
  CODE_REPOSITORY_SETTINGS_COPY,
  CodeRepositorySetting,
  CodeRepositorySettingsValues,
  hasRepositoryCommands,
} from "./CodeRepositorySettingsCopy";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The build and test commands an operator set on a repository before AI
 * read how to build and test from the repository itself (its AGENTS.md).
 * Code no longer asks for them, and keeps honouring them: a Runner of the
 * project's own runs them after AI's change (Runner/Utils/BuildVerification),
 * and the API and Terraform still set them.
 *
 * So they are shown as they are, read-only, drawn as every detail card's
 * fields are, with what they do now - and Remove Commands, which clears all
 * three after asking, so AI follows the repository's AGENTS.md alone. A
 * repository with none shows nothing here.
 */

export const CODE_REPOSITORY_COMMANDS_TEST_ID: string =
  "code-repository-commands";

export interface ComponentProps {
  repositoryId: ObjectID;
  repository: CodeRepositorySettingsValues | null;
  // The commands were removed.
  onRemoved: () => void;
}

type CommandKey = "setupCommand" | "buildCommand" | "testCommand";

const COMMANDS: Array<{ key: CommandKey; title: string }> = [
  { key: "setupCommand", title: "Setup Command" },
  { key: "buildCommand", title: "Build Command" },
  { key: "testCommand", title: "Test Command" },
];

const CodeRepositoryCommandsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (!props.repository || !hasRepositoryCommands(props.repository)) {
    return <></>;
  }

  const repository: CodeRepositorySettingsValues = props.repository;

  // The three columns share their permissions: one gate for the button.
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new CodeRepository(),
    "setupCommand",
  );

  // Only the commands that are set: an empty one is no command.
  const fields: Array<Field<CodeRepositorySettingsValues>> = COMMANDS.filter(
    (command: { key: CommandKey }): boolean => {
      return Boolean((repository[command.key] || "").trim());
    },
  ).map(
    (command: {
      key: CommandKey;
      title: string;
    }): Field<CodeRepositorySettingsValues> => {
      return {
        key: command.key,
        title: command.title,
        fieldType: FieldType.InlineCode,
      };
    },
  );

  const remove: () => Promise<void> = async (): Promise<void> => {
    setIsRemoving(true);
    setError(undefined);

    try {
      await ModelAPI.updateById({
        modelType: CodeRepository,
        id: props.repositoryId,
        data: {
          setupCommand: null,
          buildCommand: null,
          testCommand: null,
        },
      });

      setIsConfirming(false);
      props.onRemoved();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsRemoving(false);
  };

  /*
   * The card at the root, so More settings draws it as one of its sections
   * (CardSections), and the dialog that asks first inside it.
   */
  return (
    <Card
      id={CodeRepositorySetting.Commands}
      title={CODE_REPOSITORY_SETTINGS_COPY.commandsCardTitle}
      description={CODE_REPOSITORY_SETTINGS_COPY.commandsCardDescription}
      headerLayout="stacked"
      buttons={
        gate.isAllowed || gate.disabledReason
          ? [
              {
                title: CODE_REPOSITORY_SETTINGS_COPY.removeCommandsButton,
                icon: IconProp.Trash,
                buttonStyle: ButtonStyleType.NORMAL,
                disabled: !gate.isAllowed,
                tooltip: gate.disabledReason,
                onClick: (): void => {
                  setError(undefined);
                  setIsConfirming(true);
                },
              },
            ]
          : []
      }
    >
      <div data-testid={CODE_REPOSITORY_COMMANDS_TEST_ID}>
        <Detail<CodeRepositorySettingsValues>
          id="code-repository-commands-detail"
          item={repository}
          fields={fields}
          showDetailsInNumberOfColumns={fields.length}
        />
      </div>

      {isConfirming ? (
        <ConfirmModal
          title={CODE_REPOSITORY_SETTINGS_COPY.removeCommandsConfirmTitle}
          description={
            CODE_REPOSITORY_SETTINGS_COPY.removeCommandsConfirmDescription
          }
          submitButtonText={CODE_REPOSITORY_SETTINGS_COPY.removeCommandsButton}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={error}
          onClose={() => {
            setIsConfirming(false);
          }}
          onSubmit={() => {
            remove().catch(() => {
              // handled inside remove
            });
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default CodeRepositoryCommandsCard;
