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
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const CodeRepositorySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  return (
    <Fragment>
      <CardModelDetail
        name="Repository Settings"
        cardProps={{
          title: "Repository Settings",
          description: "Configure settings for your repository.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formSteps={[
          { title: "Pull Requests", id: "pull-requests" },
          { title: "GitHub Commands", id: "github-commands" },
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
