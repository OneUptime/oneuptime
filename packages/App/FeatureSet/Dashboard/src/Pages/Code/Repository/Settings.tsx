import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  FIX_PULL_REQUEST_LIMIT_ANSWERS,
  FIX_PULL_REQUEST_LIMIT_CARD_DESCRIPTION,
  FIX_PULL_REQUEST_LIMIT_COPY,
  FIX_PULL_REQUEST_LIMIT_FIELD_KEY,
  FIX_PULL_REQUEST_LIMIT_FIELD_TITLE,
  FIX_PULL_REQUEST_LIMIT_SHOWN,
  FIX_PULL_REQUEST_LIMIT_SHOWN_COUNT,
  FixPullRequestLimit,
  getFixPullRequestLimit,
  getPickedFixPullRequestLimit,
  getValuesForFixPullRequestLimit,
} from "../../../Components/CodeRepository/FixPullRequestLimit";
import LabelsElement from "Common/UI/Components/Label/Labels";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import RepositoryConnectionStatus from "../../../Components/CodeRepository/RepositoryConnectionStatus";
import {
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerPicker,
  CodeRepositoryRunnerValue,
} from "../../../Components/Code/CodeRepositoryRunner";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A repository's settings in Code, on one page: what it is called (name,
 * description, labels; where its code lives is the GitHub App's to say),
 * then what AI's work in it uses - the main branch, how many AI pull
 * requests may be open at once, GitHub commands, the Runner AI works in it
 * on (Global Runner unless it picks one of the project's own:
 * CodeRepository.runnerId), and the build and test commands a change is
 * checked with, which run on a Runner of the project's own.
 */
const CodeRepositorySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  return (
    <Fragment>
      <CardModelDetail<CodeRepository>
        name="Repository > Repository Details"
        cardProps={{
          title: "Repository Details",
        }}
        isEditable={true}
        editButtonText="Edit Details"
        editModalTitle="Repository Details"
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Repository Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          getLabelsFormField<CodeRepository>(),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: CodeRepository,
          id: "model-detail-code-repository",
          selectMoreFields: {
            gitHubAppInstallationId: true,
          },
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                organizationName: true,
              },
              title: "Organization",
            },
            {
              field: {
                repositoryName: true,
              },
              title: "Repository",
            },
            {
              field: {
                gitHubAppInstallationId: true,
              },
              title: "Connection",
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                return (
                  <RepositoryConnectionStatus
                    gitHubAppInstallationId={item.gitHubAppInstallationId}
                  />
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail
        name="Repository Settings"
        cardProps={{
          title: "Repository Settings",
          description: "What AI uses when it works in this repository.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        editModalTitle="Repository Settings"
        formSteps={[
          { title: "Pull Requests", id: "pull-requests" },
          { title: "GitHub Commands", id: "github-commands" },
          { title: "Runner", id: "runner" },
          { title: "Build & Test", id: "build-and-test" },
        ]}
        formFields={[
          {
            field: {
              mainBranchName: true,
            },
            title: "Main Branch",
            stepId: "pull-requests",
            description:
              "The main branch of the repository (e.g., main, master).",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "main",
          },
          /*
           * One choice - no limit, a limit or none (FixPullRequestLimit) -
           * where a number's help explained "Leave empty for no cap, or 0
           * to block them". Form-only: a pick writes the column below,
           * which is asked only for a limit.
           */
          {
            overrideField: {
              maxOpenFixPullRequests: true,
            },
            overrideFieldKey: FIX_PULL_REQUEST_LIMIT_FIELD_KEY,
            formOnly: true,
            title: FIX_PULL_REQUEST_LIMIT_FIELD_TITLE,
            stepId: "pull-requests",
            fieldType: FormFieldSchemaType.RadioButton,
            radioButtonOptions: FIX_PULL_REQUEST_LIMIT_ANSWERS.map(
              (limit: FixPullRequestLimit) => {
                return {
                  value: limit,
                  title: FIX_PULL_REQUEST_LIMIT_COPY[limit].title,
                  description: FIX_PULL_REQUEST_LIMIT_COPY[limit].description,
                };
              },
            ),
            required: true,
            hideColumnDescription: true,
            dataTestId: "fix-pull-request-limit",
            getDefaultValue: (values: FormValues<CodeRepository>): string => {
              return getFixPullRequestLimit(values);
            },
            onChange: (
              value: unknown,
              currentValues: FormValues<CodeRepository>,
              setNewFormValues: (values: FormValues<CodeRepository>) => void,
            ): void => {
              if (
                !(
                  Object.values(FixPullRequestLimit) as Array<unknown>
                ).includes(value)
              ) {
                return;
              }

              setNewFormValues(
                getValuesForFixPullRequestLimit({
                  values: currentValues,
                  limit: value as FixPullRequestLimit,
                }),
              );
            },
          } as ModelField<CodeRepository>,
          {
            field: {
              maxOpenFixPullRequests: true,
            },
            title: "Max Open Fix Pull Requests",
            stepId: "pull-requests",
            description: "How many may be open at once.",
            fieldType: FormFieldSchemaType.Number,
            showIf: (values: FormValues<CodeRepository>): boolean => {
              return (
                getPickedFixPullRequestLimit(values) ===
                FixPullRequestLimit.Limit
              );
            },
            required: (values: FormValues<CodeRepository>): boolean => {
              return (
                getPickedFixPullRequestLimit(values) ===
                FixPullRequestLimit.Limit
              );
            },
            validation: {
              minValue: 1,
            },
            placeholder: "3",
          },
          {
            field: {
              isGitHubCommandsEnabled: true,
            },
            title: "Respond to GitHub Commands",
            stepId: "github-commands",
            description:
              "Let people with write access mention the OneUptime GitHub App, or add the trigger label, to give it work. It never merges anything.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              gitHubTriggerLabel: true,
            },
            title: "GitHub Trigger Label",
            stepId: "github-commands",
            description:
              "Adding this label to an issue hands it to the app, like a mention. Leave empty for 'oneuptime'.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "oneuptime",
            // Only read while the app answers commands at all.
            showIf: (values: FormValues<CodeRepository>): boolean => {
              return values.isGitHubCommandsEnabled === true;
            },
          },
          /*
           * The Runner AI works in the repository on: the one Runner picker,
           * with Global Runner first (empty), then the project's own Runners.
           * A field like the others: the form draws its title and the line
           * under it (the card's own words), the picker the menu and what
           * the Runner picked means for AI's work. Empty is Global Runner,
           * an answer of its own, so it is not "(Optional)".
           */
          {
            field: {
              runnerId: true,
            },
            title: CodeRepositoryRunnerCopy.fieldTitle,
            description: CodeRepositoryRunnerCopy.fieldDescription,
            stepId: "runner",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            hideOptionalLabel: true,
            dataTestId: "code-repository-runner",
            getCustomElement: (
              values: FormValues<CodeRepository>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <CodeRepositoryRunnerPicker
                  value={values.runnerId}
                  ariaLabelledby={elementProps.ariaLabelledby}
                  onChange={(runnerId: string | null): void => {
                    elementProps.onChange?.(runnerId);
                  }}
                />
              );
            },
          },
          {
            field: {
              setupCommand: true,
            },
            title: "Setup Command",
            stepId: "build-and-test",
            description:
              "Installs dependencies before an AI fix is checked, such as 'npm ci'. Runs at the repository root on your Runner.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "npm ci",
          },
          {
            field: {
              buildCommand: true,
            },
            title: "Build Command",
            stepId: "build-and-test",
            description:
              "Checks that an AI fix builds, such as 'npm run build'. A failure goes back to the AI to repair. Leave empty to skip.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "npm run build",
          },
          {
            field: {
              testCommand: true,
            },
            title: "Test Command",
            stepId: "build-and-test",
            description:
              "Runs the tests against an AI fix, such as 'npm test'. A failure goes back to the AI to repair. Leave empty to skip.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "npm test",
          },
        ]}
        modelDetailProps={{
          modelType: CodeRepository,
          id: "model-detail-code-repository-settings",
          fields: [
            {
              field: {
                mainBranchName: true,
              },
              title: "Main Branch",
              description: "The main branch of the repository.",
              fieldType: FieldType.Text,
            },
            {
              field: {
                isGitHubCommandsEnabled: true,
              },
              title: "Respond to GitHub Commands",
              description:
                "Whether the OneUptime GitHub App acts on mentions, assignments and the trigger label in this repository.",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                gitHubTriggerLabel: true,
              },
              title: "GitHub Trigger Label",
              description: "The issue label that hands an issue to the app.",
              placeholder: "oneuptime",
              fieldType: FieldType.Text,
              // A label nothing reads while commands are off says nothing.
              showIf: (item: CodeRepository): boolean => {
                return item.isGitHubCommandsEnabled === true;
              },
            },
            {
              field: {
                maxOpenFixPullRequests: true,
              },
              /*
               * Named as the Edit form's choice is, and shown as its
               * answer: No limit, Up to 3 open at once, or None.
               */
              title: FIX_PULL_REQUEST_LIMIT_FIELD_TITLE,
              description: FIX_PULL_REQUEST_LIMIT_CARD_DESCRIPTION,
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                const limit: FixPullRequestLimit = getFixPullRequestLimit(item);

                return (
                  <span>
                    {limit === FixPullRequestLimit.Limit
                      ? translator.translateTemplate(
                          FIX_PULL_REQUEST_LIMIT_SHOWN_COUNT,
                          {
                            limit: translator.formatNumber(
                              Number(item.maxOpenFixPullRequests),
                            ),
                          },
                        )
                      : translator.translateText(
                          FIX_PULL_REQUEST_LIMIT_SHOWN[limit],
                        )}
                  </span>
                );
              },
            },
            {
              field: {
                runnerId: true,
              },
              title: CodeRepositoryRunnerCopy.fieldTitle,
              description: CodeRepositoryRunnerCopy.fieldDescription,
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                return (
                  <CodeRepositoryRunnerValue
                    runnerId={item.runnerId}
                    hasCommands={Boolean(
                      item.setupCommand ||
                        item.buildCommand ||
                        item.testCommand,
                    )}
                  />
                );
              },
            },
            {
              field: {
                setupCommand: true,
              },
              title: "Setup Command",
              description: "Installs dependencies before an AI fix is checked.",
              placeholder: "Not set (skipped)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                buildCommand: true,
              },
              title: "Build Command",
              description: "Checks that an AI fix builds.",
              placeholder: "Not set (skipped)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                testCommand: true,
              },
              title: "Test Command",
              description: "Runs the tests against an AI fix.",
              placeholder: "Not set (skipped)",
              fieldType: FieldType.Text,
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default CodeRepositorySettings;
