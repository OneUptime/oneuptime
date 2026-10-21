import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
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
import CodeRepositoryCommandsCard from "../../../Components/Code/CodeRepositoryCommandsCard";
import {
  CODE_REPOSITORY_SETTINGS_COPY,
  CodeRepositorySettingsValues,
  DEFAULT_GITHUB_TRIGGER_LABEL,
  getRepositoryMoreSettingsItems,
} from "../../../Components/Code/CodeRepositorySettingsCopy";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

export const CODE_REPOSITORY_GITHUB_COMMANDS_TEST_ID: string =
  "code-repository-github-commands";

export const CODE_REPOSITORY_MORE_SETTINGS_TEST_ID: string =
  "code-repository-more-settings";

/*
 * A repository's settings in Code, asking as little as they can - the way
 * every settings page in OneUptime is drawn: a card per question, a switch
 * that saves the moment it is flipped, an Edit beside the rest, and what
 * most people never change folded under More settings.
 *
 *   - Repository Details: its name, description and labels, and where its
 *     code lives (the GitHub App's to say);
 *   - GitHub Commands: whether the GitHub App answers mentions, the trigger
 *     label and assignments here - on by default;
 *   - Runner: where AI works in it (CodeRepository.runnerId): a Runner of
 *     the project's own, or a global Runner when it picks none;
 *   - More settings, folded: where AI's pull requests open and how many may
 *     be open at once, the trigger label, and - only on a repository that
 *     has them - the build and test commands an operator set before AI read
 *     how to build and test from the repository's own AGENTS.md.
 *
 * It used to be one card whose Edit Settings opened a four-step dialog
 * (Pull Requests, GitHub Commands, Runner, Build & Test), whose GitHub
 * Commands switch drew a repository that never set it as off - the server
 * read it as on - and saved it off when the dialog was saved untouched.
 */
const CodeRepositorySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  // What More settings' cards read, for what its folded header says.
  const [settings, setSettings] = useState<CodeRepositorySettingsValues | null>(
    null,
  );

  const rememberSettings: (item: CodeRepository) => void = (
    item: CodeRepository,
  ): void => {
    setSettings((current: CodeRepositorySettingsValues | null) => {
      return {
        ...(current || {}),
        mainBranchName: item.mainBranchName,
        maxOpenFixPullRequests: item.maxOpenFixPullRequests,
        gitHubTriggerLabel: item.gitHubTriggerLabel,
        setupCommand: item.setupCommand,
        buildCommand: item.buildCommand,
        testCommand: item.testCommand,
      };
    });
  };

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

      {/*
       * One switch, saved the moment it is flipped. A repository that never
       * set it reads as the column's default - on - as the server reads it.
       */}
      <ModelSwitchCard<CodeRepository>
        modelType={CodeRepository}
        modelId={modelId}
        column="isGitHubCommandsEnabled"
        cardTitle={CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsCardTitle}
        title={CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchTitle}
        getDescription={(): string => {
          return CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchDescription;
        }}
        dataTestId={CODE_REPOSITORY_GITHUB_COMMANDS_TEST_ID}
      />

      {/*
       * Where AI works in the repository: the one Runner picker, with Global
       * Runner first (empty), then the project's own Runners. Empty is
       * Global Runner, an answer of its own, so it is not "(Optional)".
       */}
      <CardModelDetail<CodeRepository>
        name="Repository > Runner"
        cardProps={{
          title: CODE_REPOSITORY_SETTINGS_COPY.runnerCardTitle,
          description: CODE_REPOSITORY_SETTINGS_COPY.runnerCardDescription,
        }}
        isEditable={true}
        editButtonText="Edit"
        editModalTitle={CodeRepositoryRunnerCopy.fieldTitle}
        formFields={[
          {
            field: {
              runnerId: true,
            },
            title: CodeRepositoryRunnerCopy.fieldTitle,
            description: CodeRepositoryRunnerCopy.fieldDescription,
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
        ]}
        modelDetailProps={{
          modelType: CodeRepository,
          id: "model-detail-code-repository-runner",
          fields: [
            /*
             * The card is titled Runner and says what it is for: its value
             * needs no label of its own.
             */
            {
              field: {
                runnerId: true,
              },
              fieldType: FieldType.Element,
              getElement: (item: CodeRepository): ReactElement => {
                return <CodeRepositoryRunnerValue runnerId={item.runnerId} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <AdvancedPageSection
        description={CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescription}
        items={getRepositoryMoreSettingsItems(settings, translator)}
        dataTestId={CODE_REPOSITORY_MORE_SETTINGS_TEST_ID}
      >
        <CardModelDetail<CodeRepository>
          name="Repository > Pull Requests"
          cardProps={{
            title: CODE_REPOSITORY_SETTINGS_COPY.pullRequestsCardTitle,
            description:
              CODE_REPOSITORY_SETTINGS_COPY.pullRequestsCardDescription,
          }}
          isEditable={true}
          editButtonText="Edit"
          editModalTitle={CODE_REPOSITORY_SETTINGS_COPY.pullRequestsCardTitle}
          formFields={[
            {
              field: {
                mainBranchName: true,
              },
              title: CODE_REPOSITORY_SETTINGS_COPY.mainBranchTitle,
              description:
                CODE_REPOSITORY_SETTINGS_COPY.mainBranchFormDescription,
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
          ]}
          modelDetailProps={{
            modelType: CodeRepository,
            id: "model-detail-code-repository-pull-requests",
            selectMoreFields: {
              gitHubTriggerLabel: true,
              setupCommand: true,
              buildCommand: true,
              testCommand: true,
            },
            onItemLoaded: rememberSettings,
            fields: [
              {
                field: {
                  mainBranchName: true,
                },
                title: CODE_REPOSITORY_SETTINGS_COPY.mainBranchTitle,
                description:
                  CODE_REPOSITORY_SETTINGS_COPY.mainBranchDetailDescription,
                fieldType: FieldType.Text,
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
                  const limit: FixPullRequestLimit =
                    getFixPullRequestLimit(item);

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
            ],
            modelId: modelId,
          }}
        />

        <CardModelDetail<CodeRepository>
          name="Repository > GitHub Trigger Label"
          cardProps={{
            title: CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardTitle,
            description:
              CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardDescription,
          }}
          isEditable={true}
          editButtonText="Edit"
          editModalTitle={CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardTitle}
          formFields={[
            {
              field: {
                gitHubTriggerLabel: true,
              },
              title: CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardTitle,
              description:
                CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardDescription,
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: DEFAULT_GITHUB_TRIGGER_LABEL,
            },
          ]}
          modelDetailProps={{
            modelType: CodeRepository,
            id: "model-detail-code-repository-trigger-label",
            onItemLoaded: (item: CodeRepository): void => {
              setSettings((current: CodeRepositorySettingsValues | null) => {
                return {
                  ...(current || {}),
                  gitHubTriggerLabel: item.gitHubTriggerLabel,
                };
              });
            },
            fields: [
              // The card is titled for it: no label of its own.
              {
                field: {
                  gitHubTriggerLabel: true,
                },
                placeholder: DEFAULT_GITHUB_TRIGGER_LABEL,
                fieldType: FieldType.Text,
              },
            ],
            modelId: modelId,
          }}
        />

        <CodeRepositoryCommandsCard
          repositoryId={modelId}
          repository={settings}
          onRemoved={(): void => {
            setSettings((current: CodeRepositorySettingsValues | null) => {
              return {
                ...(current || {}),
                setupCommand: null,
                buildCommand: null,
                testCommand: null,
              };
            });
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default CodeRepositorySettings;
