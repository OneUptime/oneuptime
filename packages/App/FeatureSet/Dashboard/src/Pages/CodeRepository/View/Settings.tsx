import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const CodeRepositorySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
          {
            field: {
              maxOpenFixPullRequests: true,
            },
            title: "Max Open Fix Pull Requests",
            stepId: "pull-requests",
            description:
              "How many AI fix pull requests may be open here at once. Leave empty for no cap, or 0 to block them.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "No cap",
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
            },
            {
              field: {
                maxOpenFixPullRequests: true,
              },
              title: "Max Open Fix Pull Requests",
              description:
                "How many AI-authored fix pull requests may be open at once on this repository.",
              placeholder: "No cap",
              fieldType: FieldType.Number,
            },
            {
              field: {
                setupCommand: true,
              },
              title: "Setup Command",
              description:
                "Dependency-install command the Runner executes at the repository root before verifying an AI-authored fix.",
              placeholder: "Not set (skipped)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                buildCommand: true,
              },
              title: "Build Command",
              description:
                "Build command the Runner executes at the repository root to verify an AI-authored fix before the pull request opens.",
              placeholder: "Not set (skipped)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                testCommand: true,
              },
              title: "Test Command",
              description:
                "Test command the Runner executes at the repository root to verify an AI-authored fix before the pull request opens.",
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
