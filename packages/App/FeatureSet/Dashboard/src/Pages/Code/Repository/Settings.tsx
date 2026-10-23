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
  CodeRepositoryRunnerValueView,
  useCodeRepositoryRunnerChoices,
} from "../../../Components/Code/CodeRepositoryRunner";
import { RunnerChoices } from "../../../Components/Runner/RunnerChoices";
import CodeRepositoryCommandsCard from "../../../Components/Code/CodeRepositoryCommandsCard";
import {
  CODE_REPOSITORY_SETTINGS_COPY,
  CodeRepositorySetting,
  CodeRepositorySettingsValues,
  DEFAULT_GITHUB_TRIGGER_LABEL,
  getRepositoryMoreSettingsItems,
} from "../../../Components/Code/CodeRepositorySettingsCopy";
import { getRepositoryRunnerId } from "Common/Types/Runner/CodeRepositoryRunner";
import CodeApi from "../../../Components/Code/CodeApi";
import {
  PRODUCTION_REVIEW_CONTENT_ANSWERS,
  PRODUCTION_REVIEW_CONTENT_COPY,
  PRODUCTION_REVIEW_CONTENT_FIELD_KEY,
  PRODUCTION_REVIEW_SETTINGS_COPY,
  getPickedProductionReviewContent,
  getValuesForProductionReviewContent,
  readProductionReviewContent,
} from "../../../Components/Code/CodeProductionReviewCopy";
import { ProductionReviewPullRequestContent } from "Common/Types/CodeRepository/ProductionReview";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export const CODE_REPOSITORY_GITHUB_COMMANDS_TEST_ID: string =
  "code-repository-github-commands";

export const CODE_REPOSITORY_MORE_SETTINGS_TEST_ID: string =
  "code-repository-more-settings";

export const CODE_REPOSITORY_PRODUCTION_REVIEW_TEST_ID: string =
  "code-repository-production-review";

/*
 * A repository's settings in Code, asking as little as they can - the way
 * every settings page in OneUptime is drawn: a card per question, a switch
 * that saves the moment it is flipped, an Edit beside the rest, and what
 * most people never change folded under More settings.
 *
 *   - Repository Details, on top: its name, description and labels, where
 *     its code lives (the GitHub App's to say), and how it connects - Not
 *     connected where Code's Repositories folds it;
 *   - More settings, folded, naming what it holds - every other setting,
 *     each working as it did in sight:
 *       - GitHub Commands: whether the GitHub App answers mentions, the
 *         trigger label and assignments here - on by default;
 *       - Production Review: whether OneUptime reviews the repository's
 *         pull requests against production on its own - on for
 *         repositories connected from now on, off for those connected
 *         before it existed;
 *       - Runner: where AI works in it (CodeRepository.runnerId): a Runner
 *         of the project's own, or a global Runner when it picks none;
 *       - Pull Requests: where AI's pull requests open and how many may be
 *         open at once;
 *       - GitHub Trigger Label: the label that hands an issue to the
 *         GitHub App;
 *       - Production Review Comment: what a production review posts on a
 *         pull request;
 *       - and, only on a repository that has them, the build and test
 *         commands an operator set before AI read how to build and test
 *         from the repository's own AGENTS.md.
 *
 * "GitHub commands and runner should be inside of more settings as well"
 * (the maintainer, of the page that kept GitHub Commands and Runner in sight
 * above More settings). Production Review, a switch whose default works for
 * most repositories as GitHub Commands' does, went with them, and the three
 * come first in the fold, in the order they had. A link to one of them
 * lands on it with More settings open (CodeRepositorySetting): "Pick a
 * Runner" opens ".../settings#runner", Production Reviews' "Turn on in
 * Settings" ".../settings#production-review".
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

  /*
   * The Runners a repository may pick, read once (and again when the person
   * comes back to the tab) for the Runner card's value and for what More
   * settings says of the Runner while it is folded.
   */
  const runnerChoices: RunnerChoices | null = useCodeRepositoryRunnerChoices();

  // Keeps what a card in More settings read or a switch moved to.
  const remember: (values: CodeRepositorySettingsValues) => void = (
    values: CodeRepositorySettingsValues,
  ): void => {
    setSettings((current: CodeRepositorySettingsValues | null) => {
      return {
        ...(current || {}),
        ...values,
      };
    });
  };

  /*
   * Whether the project's GitHub App reaches the repository, as Code's
   * Repositories reads it: a repository it folds under Not connected says
   * so here too, not "GitHub App". Unknown until read; a read that fails
   * leaves the field as it always was.
   */
  const [isReachable, setIsReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    CodeApi.getRepository(modelId.toString())
      .then((answer: { repository: { isConnected: boolean } }): void => {
        if (isCurrent) {
          setIsReachable(answer.repository.isConnected);
        }
      })
      .catch((): void => {
        // The field then says how the repository connects, as before.
      });

    return (): void => {
      isCurrent = false;
    };
  }, [modelId.toString()]);

  const rememberSettings: (item: CodeRepository) => void = (
    item: CodeRepository,
  ): void => {
    remember({
      mainBranchName: item.mainBranchName,
      maxOpenFixPullRequests: item.maxOpenFixPullRequests,
      gitHubTriggerLabel: item.gitHubTriggerLabel,
      setupCommand: item.setupCommand,
      buildCommand: item.buildCommand,
      testCommand: item.testCommand,
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
                    isReachable={isReachable}
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
       * Every other setting, folded: their defaults work for most
       * repositories. Folded, its header names them - and what is set to
       * something else, with what - and a link to one of them opens it
       * there (CodeRepositorySetting, the cards' ids).
       */}
      <AdvancedPageSection
        description={CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescription}
        items={getRepositoryMoreSettingsItems(
          settings,
          translator,
          runnerChoices,
        )}
        dataTestId={CODE_REPOSITORY_MORE_SETTINGS_TEST_ID}
      >
        {/*
         * One switch, saved the moment it is flipped. A repository that
         * never set it reads as the column's default - on - as the server
         * reads it.
         */}
        <ModelSwitchCard<CodeRepository>
          modelType={CodeRepository}
          modelId={modelId}
          column="isGitHubCommandsEnabled"
          cardId={CodeRepositorySetting.GitHubCommands}
          cardTitle={CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsCardTitle}
          title={CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchTitle}
          getDescription={(): string => {
            return CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchDescription;
          }}
          onChange={(isOn: boolean): void => {
            remember({ isGitHubCommandsEnabled: isOn });
          }}
          dataTestId={CODE_REPOSITORY_GITHUB_COMMANDS_TEST_ID}
        />

        {/*
         * One switch, saved the moment it is flipped: whether OneUptime
         * reviews the repository's pull requests against production on its
         * own. Unset - every repository connected before it existed - reads
         * as off, as the server reads it.
         */}
        <ModelSwitchCard<CodeRepository>
          modelType={CodeRepository}
          modelId={modelId}
          column="isProductionReviewEnabled"
          cardId={CodeRepositorySetting.ProductionReview}
          cardTitle={PRODUCTION_REVIEW_SETTINGS_COPY.cardTitle}
          title={PRODUCTION_REVIEW_SETTINGS_COPY.switchTitle}
          getDescription={(): string => {
            return PRODUCTION_REVIEW_SETTINGS_COPY.switchDescription;
          }}
          onChange={(isOn: boolean): void => {
            remember({ isProductionReviewEnabled: isOn });
          }}
          dataTestId={CODE_REPOSITORY_PRODUCTION_REVIEW_TEST_ID}
        />

        {/*
         * Where AI works in the repository: the one Runner picker, with
         * Global Runner first (empty), then the project's own Runners. Empty
         * is Global Runner, an answer of its own, so it is not "(Optional)".
         */}
        <CardModelDetail<CodeRepository>
          name="Repository > Runner"
          cardProps={{
            title: CODE_REPOSITORY_SETTINGS_COPY.runnerCardTitle,
            description: CODE_REPOSITORY_SETTINGS_COPY.runnerCardDescription,
            id: CodeRepositorySetting.Runner,
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
            onItemLoaded: (item: CodeRepository): void => {
              remember({ runnerId: getRepositoryRunnerId(item.runnerId) });
            },
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
                  return (
                    <CodeRepositoryRunnerValueView
                      runnerId={item.runnerId}
                      choices={runnerChoices}
                    />
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />

        <CardModelDetail<CodeRepository>
          name="Repository > Pull Requests"
          cardProps={{
            title: CODE_REPOSITORY_SETTINGS_COPY.pullRequestsCardTitle,
            description:
              CODE_REPOSITORY_SETTINGS_COPY.pullRequestsCardDescription,
            id: CodeRepositorySetting.PullRequests,
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
            description: CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardSummary,
            id: CodeRepositorySetting.TriggerLabel,
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
              remember({ gitHubTriggerLabel: item.gitHubTriggerLabel });
            },
            fields: [
              /*
               * Named, as the Pull Requests card's values are: a value with
               * no name under the card's words read as one more line of
               * them. Unset, it shows the label that applies, quieter.
               */
              {
                field: {
                  gitHubTriggerLabel: true,
                },
                title: CODE_REPOSITORY_SETTINGS_COPY.triggerLabelFieldTitle,
                placeholder: DEFAULT_GITHUB_TRIGGER_LABEL,
                fieldType: FieldType.Text,
              },
            ],
            modelId: modelId,
          }}
        />

        {/*
         * What a production review posts on a pull request: the review, or
         * only a link to it in OneUptime on a public repository (the
         * default); only a link; or the review even on a public repository.
         * One choice, held in a form value of its own so a repository that
         * never chose opens on the default; a pick writes the column.
         */}
        <CardModelDetail<CodeRepository>
          name="Repository > Production Review Comment"
          cardProps={{
            title: PRODUCTION_REVIEW_SETTINGS_COPY.contentCardTitle,
            description: PRODUCTION_REVIEW_SETTINGS_COPY.contentCardDescription,
            id: CodeRepositorySetting.ProductionReviewComment,
          }}
          isEditable={true}
          editButtonText="Edit"
          editModalTitle={PRODUCTION_REVIEW_SETTINGS_COPY.contentCardTitle}
          formFields={[
            {
              overrideField: {
                productionReviewPullRequestContent: true,
              },
              overrideFieldKey: PRODUCTION_REVIEW_CONTENT_FIELD_KEY,
              formOnly: true,
              title: PRODUCTION_REVIEW_SETTINGS_COPY.contentFieldTitle,
              fieldType: FormFieldSchemaType.RadioButton,
              radioButtonOptions: PRODUCTION_REVIEW_CONTENT_ANSWERS.map(
                (content: ProductionReviewPullRequestContent) => {
                  return {
                    value: content,
                    title: PRODUCTION_REVIEW_CONTENT_COPY[content].title,
                    description:
                      PRODUCTION_REVIEW_CONTENT_COPY[content].description,
                  };
                },
              ),
              required: true,
              hideColumnDescription: true,
              dataTestId: "production-review-content",
              getDefaultValue: (values: FormValues<CodeRepository>): string => {
                return getPickedProductionReviewContent(values);
              },
              onChange: (
                value: unknown,
                currentValues: FormValues<CodeRepository>,
                setNewFormValues: (values: FormValues<CodeRepository>) => void,
              ): void => {
                if (
                  !(
                    PRODUCTION_REVIEW_CONTENT_ANSWERS as Array<unknown>
                  ).includes(value)
                ) {
                  return;
                }

                setNewFormValues(
                  getValuesForProductionReviewContent({
                    values: currentValues,
                    content: value as ProductionReviewPullRequestContent,
                  }),
                );
              },
            } as ModelField<CodeRepository>,
            /*
             * The column the choice writes: never drawn, here so that the
             * form reads it and sends what was picked.
             */
            {
              field: {
                productionReviewPullRequestContent: true,
              },
              title: PRODUCTION_REVIEW_SETTINGS_COPY.contentFieldTitle,
              fieldType: FormFieldSchemaType.Text,
              required: false,
              hideColumnDescription: true,
              showIf: (): boolean => {
                return false;
              },
            },
          ]}
          modelDetailProps={{
            modelType: CodeRepository,
            id: "model-detail-code-repository-production-review-comment",
            onItemLoaded: (item: CodeRepository): void => {
              remember({
                productionReviewPullRequestContent:
                  item.productionReviewPullRequestContent,
              });
            },
            fields: [
              /*
               * Named as the Edit form's choice is, as the other cards under
               * More settings name their values, and shown as the answer
               * picked, in the form's words.
               */
              {
                field: {
                  productionReviewPullRequestContent: true,
                },
                title: PRODUCTION_REVIEW_SETTINGS_COPY.contentFieldTitle,
                fieldType: FieldType.Element,
                getElement: (item: CodeRepository): ReactElement => {
                  return (
                    <span data-testid="production-review-content-value">
                      {translator.translateText(
                        PRODUCTION_REVIEW_CONTENT_COPY[
                          readProductionReviewContent(
                            item.productionReviewPullRequestContent,
                          )
                        ].title,
                      )}
                    </span>
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />

        <CodeRepositoryCommandsCard
          repositoryId={modelId}
          repository={settings}
          onRemoved={(): void => {
            remember({
              setupCommand: null,
              buildCommand: null,
              testCommand: null,
            });
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default CodeRepositorySettings;
