import {
  CodeRepositoryListGroup,
  CodeTaskRepositoryJSON,
} from "Common/Types/AI/CodeTask";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ActionItemCodeTaskKind,
  MAX_ACTION_ITEM_INSTRUCTIONS_LENGTH,
} from "Common/Utils/Incident/PostmortemActionItemCodeTask";
import NamedSentence from "Common/UI/Components/DeleteConfirmation/NamedSentence";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import CodeRepositorySearchField from "../../Code/CodeRepositorySearchField";
import PostmortemActionItemsApi from "./PostmortemActionItemsApi";
import {
  POSTMORTEM_ACTION_ITEMS_COPY,
  POSTMORTEM_ACTION_ITEMS_TEST_IDS,
} from "./PostmortemActionItemsCopy";

export interface ComponentProps {
  actionItemId: ObjectID;
  actionItemTitle: string;
  kind: ActionItemCodeTaskKind;
  /*
   * The project's one repository OneUptime AI can work in, when it has only
   * one: picked already. With several, the person picks one - the field
   * searches every connected repository they may read on the server,
   * however many the project has (#10764).
   */
  onlyRepository?: CodeTaskRepositoryJSON | null | undefined;
  onClose: () => void;
  // The task OneUptime AI started: the row shows it from now on.
  onStarted: (taskId: string) => void;
}

const REPOSITORY_KEY: string = "repositoryId";
const INSTRUCTIONS_KEY: string = "instructions";

/*
 * Open Pull Request with AI, and Write a Test with AI, on a postmortem's
 * action item (#6801): which repository OneUptime AI works in - picked
 * already when the project has one - and, if the person wants, a line of
 * their own. The request itself is the server's to write, from the item and
 * its incident (PostmortemActionItemCodeTask), so the dialog asks nothing it
 * can work out. A refusal - AI off, no Runner, the plan - is said under the
 * fields in the server's words, and the dialog stays open.
 *
 * The repository is picked from the repositories AI can work in, searched
 * on the server as the person types (CodeRepositorySearchField): the
 * dialog used to offer the connected ones among the project's first 500,
 * so a repository past them could not be picked.
 */
const ActionItemCodeTaskModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const isTest: boolean = props.kind === ActionItemCodeTaskKind.Test;

  return (
    <BasicFormModal<JSONObject>
      title={
        isTest
          ? POSTMORTEM_ACTION_ITEMS_COPY.testTitle
          : POSTMORTEM_ACTION_ITEMS_COPY.pullRequestTitle
      }
      name={
        isTest
          ? "postmortem-action-item-write-test"
          : "postmortem-action-item-open-pull-request"
      }
      description={
        <NamedSentence
          template={
            isTest
              ? POSTMORTEM_ACTION_ITEMS_COPY.testDescription
              : POSTMORTEM_ACTION_ITEMS_COPY.pullRequestDescription
          }
          slot="title"
          name={props.actionItemTitle}
          dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.dialogItem}
        />
      }
      submitButtonText={POSTMORTEM_ACTION_ITEMS_COPY.askSubmit}
      isSubmitting={isWorking}
      error={error || undefined}
      onClose={props.onClose}
      formProps={{
        name: "postmortem-action-item-code-task",
        initialValues: props.onlyRepository
          ? { [REPOSITORY_KEY]: props.onlyRepository.id }
          : {},
        fields: [
          {
            field: { [REPOSITORY_KEY]: true },
            title: POSTMORTEM_ACTION_ITEMS_COPY.repositoryField,
            description: POSTMORTEM_ACTION_ITEMS_COPY.repositoryHelp,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            getCustomElement: (
              values: FormValues<JSONObject>,
              customProps: CustomElementProps,
            ): ReactElement => {
              const value: unknown = (values as JSONObject)[REPOSITORY_KEY];

              return (
                <CodeRepositorySearchField
                  value={typeof value === "string" && value ? value : null}
                  knownRepository={props.onlyRepository}
                  group={CodeRepositoryListGroup.Connected}
                  isClearable={false}
                  error={customProps.error}
                  tabIndex={customProps.tabIndex}
                  ariaLabelledby={customProps.ariaLabelledby}
                  ariaDescribedby={customProps.ariaDescribedby}
                  dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.repositoryPicker}
                  onChange={(repositoryId: string | null) => {
                    customProps.onChange?.(repositoryId);
                  }}
                />
              );
            },
          },
          {
            field: { [INSTRUCTIONS_KEY]: true },
            title: POSTMORTEM_ACTION_ITEMS_COPY.instructionsField,
            description: POSTMORTEM_ACTION_ITEMS_COPY.instructionsHelp,
            placeholder: POSTMORTEM_ACTION_ITEMS_COPY.instructionsPlaceholder,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            validation: {
              maxLength: MAX_ACTION_ITEM_INSTRUCTIONS_LENGTH,
            },
          },
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        const record: JSONObject = values as JSONObject;
        const repositoryId: string =
          typeof record[REPOSITORY_KEY] === "string"
            ? (record[REPOSITORY_KEY] as string)
            : "";
        const instructions: string =
          typeof record[INSTRUCTIONS_KEY] === "string"
            ? (record[INSTRUCTIONS_KEY] as string).trim()
            : "";

        if (!repositoryId) {
          return;
        }

        setIsWorking(true);
        setError("");

        try {
          const started: { taskId: string } =
            await PostmortemActionItemsApi.startCodeTask({
              actionItemId: props.actionItemId,
              kind: props.kind,
              repositoryId,
              instructions: instructions || undefined,
            });

          setIsWorking(false);
          props.onStarted(started.taskId);
        } catch (err) {
          setIsWorking(false);
          setError(API.getFriendlyMessage(err));
        }
      }}
    />
  );
};

export default ActionItemCodeTaskModal;
