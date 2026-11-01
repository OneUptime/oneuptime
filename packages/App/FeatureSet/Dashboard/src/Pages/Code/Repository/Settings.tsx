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
  FIX_PULL_REQUEST_LIMIT_FIELD_KEY,
  FIX_PULL_REQUEST_LIMIT_SHOWN_COUNT,
  FixPullRequestLimitCopy,
  getFixPullRequestLimitCopy,
  FixPullRequestLimit,
  getFixPullRequestLimit,
  getPickedFixPullRequestLimit,
  getValuesForFixPullRequestLimit,
} from "../../../Components/CodeRepository/FixPullRequestLimit";
import LabelsElement from "Common/UI/Components/Label/Labels";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import RepositoryConnectionStatus from "../../../Components/CodeRepository/RepositoryConnectionStatus";
import CodeRepositoryConnection from "../../../Components/Code/CodeRepositoryConnection";
import { CodeTaskRepositoryJSON } from "Common/Types/AI/CodeTask";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerPicker,
  CodeRepositoryRunnerValueView,
  useCodeRepositoryRunnerChoices,
} from "../../../Components/Code/CodeRepositoryRunner";
import { RunnerChoices } from "../../../Components/Runner/RunnerChoices";
import {
  CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY,
  CodeRepositoryRunnerColumns,
  getCodeRepositoryRunnerChoice,
  getCodeRepositoryRunnerColumns,
} from "../../../Components/Code/CodeRepositoryRunnerChoice";
import CodeRepositoryCommandsCard from "../../../Components/Code/CodeRepositoryCommandsCard";
import {
  CODE_REPOSITORY_SETTINGS_COPY,
  CodeRepositorySetting,
  CodeRepositorySettingsValues,
  DEFAULT_GITHUB_TRIGGER_LABEL,
  getPullRequestsCardCopy,
  getRepositoryMoreSettingsDescription,
  getRepositoryMoreSettingsItems,
  getRepositorySettingsFor,
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
  inReviewHostWords,
  readProductionReviewContent,
} from "../../../Components/Code/CodeProductionReviewCopy";
import { ProductionReviewPullRequestContent } from "Common/Types/CodeRepository/ProductionReview";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import {
  RuleLlmProviderFieldHint,
  RuleLlmProviderPicker,
  useRuleLlmProviderChoices,
} from "../../../Components/AI/RuleLlmProviderField";
import {
  RULE_LLM_PROVIDER_FIELD_COPY,
  RuleLlmProviderChoices,
  RuleLlmProviderPickState,
  getRuleLlmProviderFoldedValue,
  getRuleLlmProviderPickState,
  getRuleLlmProviderPlaceholder,
} from "../../../Components/AI/RuleLlmProviderCopy";
import { readLlmProviderId } from "Common/Types/AI/LlmProviderChoice";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
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

export const CODE_REPOSITORY_PRODUCTION_REVIEW_LLM_PROVIDER_TEST_ID: string =
  "production-review-llm-provider";

// The card's line under a pick the project can no longer use.
export const CODE_REPOSITORY_PRODUCTION_REVIEW_LLM_PROVIDER_WARNING_TEST_ID: string =
  "production-review-llm-provider-warning";

/*
 * What the Production Review LLM Provider card shows: the provider picked,
 * by name - or that the reader cannot see it, or that it is no longer
 * available - and, while none is picked, the default it stands for, as the
 * Edit form's empty box names it ("Project default (Azure GPT-4o)"). Null
 * while the providers are first read: the card holds the value's place.
 */
export function getProductionReviewLlmProviderShown(
  pickedProviderId: unknown,
  choices: RuleLlmProviderChoices | null,
  translator: Translator,
): string | null {
  if (!choices) {
    return null;
  }

  const picked: string = readLlmProviderId(pickedProviderId);

  if (picked) {
    const value: string | null = getRuleLlmProviderFoldedValue(
      { llmProviderId: picked },
      choices,
      translator,
    );

    if (value) {
      return value;
    }
  }

  return getRuleLlmProviderPlaceholder(choices, translator);
}

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
 *       - Production Review LLM Provider: the LLM provider OneUptime AI
 *         reads the pull requests with - the project's default provider
 *         until one is picked;
 *       - and, only on a repository that has them, the build and test
 *         commands an operator set before AI read how to build and test
 *         from the repository's own AGENTS.md.
 *
 * A repository that is not on GitHub - GitLab, Forgejo, Gitea, a Git
 * server - says in Repository Details how it connects (its server, the
 * account, the token's last characters, whether its server refused it,
 * with Replace access token) and what works in GitHub repositories only;
 * More settings holds only what it has (getRepositorySettingsFor): the
 * Runner, its pull requests - or, on a Git server, where AI pushes a
 * branch and opens none, its Branches - and the commands.
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

  /*
   * The project's LLM providers, read once (and again when the person comes
   * back to the tab), for the Production Review LLM Provider card's value
   * and for what More settings says of it while it is folded.
   */
  const llmProviderChoices: RuleLlmProviderChoices | null =
    useRuleLlmProviderChoices();

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

  /*
   * The repository as Code reads it: where it is hosted and how its
   * connection stands (never its token). Unknown until read - a GitHub
   * repository, as every repository was before the other hosts - and read
   * again once its access token is replaced.
   */
  const [repository, setRepository] = useState<CodeTaskRepositoryJSON | null>(
    null,
  );
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    CodeApi.getRepository(modelId.toString())
      .then((answer: { repository: CodeTaskRepositoryJSON }): void => {
        if (isCurrent) {
          setIsReachable(answer.repository.isConnected);
          setRepository(answer.repository);
        }
      })
      .catch((): void => {
        // The field then says how the repository connects, as before.
      });

    return (): void => {
      isCurrent = false;
    };
  }, [modelId.toString(), readCount]);

  const provider: CodeRepositoryType = CodeHost.readType(repository?.provider);
  const isOnGitHub: boolean = provider === CodeRepositoryType.GitHub;
  // The settings the repository has, on its host, in the page's order.
  const repositorySettings: Array<CodeRepositorySetting> =
    getRepositorySettingsFor(provider);
  /*
   * Where AI's work goes: pull requests it opens - or, on a Git server, a
   * branch it pushes, so the card asks only the branch it starts from.
   */
  const opensPullRequestsHere: boolean = !repositorySettings.includes(
    CodeRepositorySetting.Branches,
  );

  /*
   * The Pull Requests card in the host's word: Merge Requests on GitLab, as
   * its tasks, their rows and the request box say merge request.
   */
  const pullRequestsCard: { title: string; description: string } =
    getPullRequestsCardCopy(provider);
  const limitCopy: FixPullRequestLimitCopy =
    getFixPullRequestLimitCopy(provider);

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
                if (!isOnGitHub && repository) {
                  return (
                    <CodeRepositoryConnection
                      repository={repository}
                      onReplaced={(): void => {
                        setReadCount((count: number) => {
                          return count + 1;
                        });
                      }}
                    />
                  );
                }

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
        description={getRepositoryMoreSettingsDescription(provider)}
        items={getRepositoryMoreSettingsItems(
          settings,
          translator,
          runnerChoices,
          provider,
          llmProviderChoices,
        )}
        dataTestId={CODE_REPOSITORY_MORE_SETTINGS_TEST_ID}
      >
        {/*
         * One switch, saved the moment it is flipped. A repository that
         * never set it reads as the column's default - on - as the server
         * reads it.
         */}
        {repositorySettings.includes(CodeRepositorySetting.GitHubCommands) ? (
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
        ) : (
          <></>
        )}

        {/*
         * One switch, saved the moment it is flipped: whether OneUptime
         * reviews the repository's pull requests against production on its
         * own. Unset - every repository connected before it existed - reads
         * as off, as the server reads it.
         */}
        {repositorySettings.includes(CodeRepositorySetting.ProductionReview) ? (
          <ModelSwitchCard<CodeRepository>
            modelType={CodeRepository}
            modelId={modelId}
            column="isProductionReviewEnabled"
            cardId={CodeRepositorySetting.ProductionReview}
            cardTitle={PRODUCTION_REVIEW_SETTINGS_COPY.cardTitle}
            title={inReviewHostWords(
              PRODUCTION_REVIEW_SETTINGS_COPY.switchTitle,
              provider,
            )}
            getDescription={(): string => {
              return inReviewHostWords(
                PRODUCTION_REVIEW_SETTINGS_COPY.switchDescription,
                provider,
              );
            }}
            onChange={(isOn: boolean): void => {
              remember({ isProductionReviewEnabled: isOn });
            }}
            dataTestId={CODE_REPOSITORY_PRODUCTION_REVIEW_TEST_ID}
          />
        ) : (
          <></>
        )}

        {/*
         * Where AI works in the repository: the one Runner picker, with the
         * project's default Runner first - the Global Runner while there is
         * none - stored as no pick (empty), so the repository follows the
         * default; then the Global Runner as a pick of its own beside a
         * default, then the project's own Runners. Empty is an answer of its
         * own, so it is not "(Optional)". One choice
         * (CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY) writes the two columns
         * it is stored in (CodeRepositoryRunnerChoice).
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
              overrideField: {
                runnerId: true,
              },
              overrideFieldKey: CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY,
              formOnly: true,
              title: CodeRepositoryRunnerCopy.fieldTitle,
              description: CodeRepositoryRunnerCopy.fieldDescription,
              fieldType: FormFieldSchemaType.CustomComponent,
              required: false,
              hideOptionalLabel: true,
              hideColumnDescription: true,
              dataTestId: "code-repository-runner",
              getDefaultValue: (values: FormValues<CodeRepository>): string => {
                return getCodeRepositoryRunnerChoice(values);
              },
              onChange: (
                value: unknown,
                currentValues: FormValues<CodeRepository>,
                setNewFormValues: (values: FormValues<CodeRepository>) => void,
              ): void => {
                const columns: CodeRepositoryRunnerColumns =
                  getCodeRepositoryRunnerColumns(value);

                setNewFormValues({
                  ...currentValues,
                  runnerId: columns.runnerId,
                  isGlobalRunnerPicked: columns.isGlobalRunnerPicked,
                } as FormValues<CodeRepository>);
              },
              getCustomElement: (
                values: FormValues<CodeRepository>,
                elementProps: CustomElementProps,
              ): ReactElement => {
                const choice: unknown = (values as Record<string, unknown>)[
                  CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY
                ];

                return (
                  <CodeRepositoryRunnerPicker
                    value={
                      typeof choice === "string"
                        ? choice
                        : getCodeRepositoryRunnerChoice(values)
                    }
                    ariaLabelledby={elementProps.ariaLabelledby}
                    provider={provider}
                    onChange={(picked: string): void => {
                      elementProps.onChange?.(picked);
                    }}
                  />
                );
              },
            } as ModelField<CodeRepository>,
            /*
             * The two columns the choice writes: never drawn, here so that
             * the form reads them and sends what was picked.
             */
            {
              field: {
                runnerId: true,
              },
              title: CodeRepositoryRunnerCopy.fieldTitle,
              fieldType: FormFieldSchemaType.Text,
              required: false,
              hideColumnDescription: true,
              showIf: (): boolean => {
                return false;
              },
            },
            {
              field: {
                isGlobalRunnerPicked: true,
              },
              title: CodeRepositoryRunnerCopy.fieldTitle,
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              hideColumnDescription: true,
              showIf: (): boolean => {
                return false;
              },
            },
          ]}
          modelDetailProps={{
            modelType: CodeRepository,
            id: "model-detail-code-repository-runner",
            selectMoreFields: {
              isGlobalRunnerPicked: true,
            },
            onItemLoaded: (item: CodeRepository): void => {
              remember({
                runnerId: getRepositoryRunnerId(item.runnerId),
                isGlobalRunnerPicked: item.isGlobalRunnerPicked === true,
              });
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
                      isGlobalRunnerPicked={item.isGlobalRunnerPicked}
                      provider={provider}
                      choices={runnerChoices}
                    />
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />

        {/*
         * Pull Requests: the branch AI starts from and how many fix pull
         * requests may be open at once. A Git repository's is Branches: AI
         * pushes a branch there and opens no pull request, so it asks only
         * where the work starts from. One card either way - the main branch
         * is edited in one place.
         */}
        <CardModelDetail<CodeRepository>
          name={
            opensPullRequestsHere
              ? "Repository > Pull Requests"
              : "Repository > Branches"
          }
          cardProps={{
            title: opensPullRequestsHere
              ? pullRequestsCard.title
              : CODE_REPOSITORY_SETTINGS_COPY.branchesCardTitle,
            description: opensPullRequestsHere
              ? pullRequestsCard.description
              : CODE_REPOSITORY_SETTINGS_COPY.branchesCardDescription,
            id: opensPullRequestsHere
              ? CodeRepositorySetting.PullRequests
              : CodeRepositorySetting.Branches,
          }}
          isEditable={true}
          editButtonText="Edit"
          editModalTitle={
            opensPullRequestsHere
              ? pullRequestsCard.title
              : CODE_REPOSITORY_SETTINGS_COPY.branchesCardTitle
          }
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
            ...(opensPullRequestsHere
              ? [
                  /*
                   * One choice - no limit, a limit or none
                   * (FixPullRequestLimit) - where a number's help explained
                   * "Leave empty for no cap, or 0 to block them". Form-only:
                   * a pick writes the column below, which is asked only for
                   * a limit.
                   */
                  {
                    overrideField: {
                      maxOpenFixPullRequests: true,
                    },
                    overrideFieldKey: FIX_PULL_REQUEST_LIMIT_FIELD_KEY,
                    formOnly: true,
                    title: limitCopy.fieldTitle,
                    fieldType: FormFieldSchemaType.RadioButton,
                    radioButtonOptions: FIX_PULL_REQUEST_LIMIT_ANSWERS.map(
                      (limit: FixPullRequestLimit) => {
                        return {
                          value: limit,
                          title: limitCopy.answers[limit].title,
                          description: limitCopy.answers[limit].description,
                        };
                      },
                    ),
                    required: true,
                    hideColumnDescription: true,
                    dataTestId: "fix-pull-request-limit",
                    getDefaultValue: (
                      values: FormValues<CodeRepository>,
                    ): string => {
                      return getFixPullRequestLimit(values);
                    },
                    onChange: (
                      value: unknown,
                      currentValues: FormValues<CodeRepository>,
                      setNewFormValues: (
                        values: FormValues<CodeRepository>,
                      ) => void,
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
                    title: limitCopy.maxFieldTitle,
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
                ]
              : []),
          ]}
          modelDetailProps={{
            modelType: CodeRepository,
            id: opensPullRequestsHere
              ? "model-detail-code-repository-pull-requests"
              : "model-detail-code-repository-branches",
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
              ...(opensPullRequestsHere
                ? [
                    {
                      field: {
                        maxOpenFixPullRequests: true,
                      },
                      /*
                       * Named as the Edit form's choice is, and shown as its
                       * answer: No limit, Up to 3 open at once, or None.
                       */
                      title: limitCopy.fieldTitle,
                      description: limitCopy.cardDescription,
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
                                  limitCopy.shown[limit],
                                )}
                          </span>
                        );
                      },
                    },
                  ]
                : []),
            ],
            modelId: modelId,
          }}
        />

        {repositorySettings.includes(CodeRepositorySetting.TriggerLabel) ? (
          <CardModelDetail<CodeRepository>
            name="Repository > GitHub Trigger Label"
            cardProps={{
              title: CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardTitle,
              description:
                CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardSummary,
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
        ) : (
          <></>
        )}

        {/*
         * What a production review posts on a pull request: the review, or
         * only a link to it in OneUptime on a public repository (the
         * default); only a link; or the review even on a public repository.
         * One choice, held in a form value of its own so a repository that
         * never chose opens on the default; a pick writes the column.
         */}
        {repositorySettings.includes(
          CodeRepositorySetting.ProductionReviewComment,
        ) ? (
          <CardModelDetail<CodeRepository>
            name="Repository > Production Review Comment"
            cardProps={{
              title: PRODUCTION_REVIEW_SETTINGS_COPY.contentCardTitle,
              description: inReviewHostWords(
                PRODUCTION_REVIEW_SETTINGS_COPY.contentCardDescription,
                provider,
              ),
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
                      description: inReviewHostWords(
                        PRODUCTION_REVIEW_CONTENT_COPY[content].description,
                        provider,
                      ),
                    };
                  },
                ),
                required: true,
                hideColumnDescription: true,
                dataTestId: "production-review-content",
                getDefaultValue: (
                  values: FormValues<CodeRepository>,
                ): string => {
                  return getPickedProductionReviewContent(values);
                },
                onChange: (
                  value: unknown,
                  currentValues: FormValues<CodeRepository>,
                  setNewFormValues: (
                    values: FormValues<CodeRepository>,
                  ) => void,
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
        ) : (
          <></>
        )}

        {/*
         * The LLM provider OneUptime AI reads the repository's pull requests
         * with in production reviews: the AI rules' picker - the project's
         * providers, its default first and tagged, then the global ones,
         * each with its model. Empty is an answer of its own - the
         * project's default provider, else the global one, named in the
         * box - so the field never says "(Optional)". A pick that cannot be
         * used falls back the same way (Common/Types/AI/LlmProviderChoice).
         */}
        {repositorySettings.includes(
          CodeRepositorySetting.ProductionReviewLlmProvider,
        ) ? (
          <CardModelDetail<CodeRepository>
            name="Repository > Production Review LLM Provider"
            cardProps={{
              title: PRODUCTION_REVIEW_SETTINGS_COPY.providerCardTitle,
              description:
                PRODUCTION_REVIEW_SETTINGS_COPY.providerCardDescription,
              id: CodeRepositorySetting.ProductionReviewLlmProvider,
            }}
            isEditable={true}
            editButtonText="Edit"
            editModalTitle={PRODUCTION_REVIEW_SETTINGS_COPY.providerCardTitle}
            formFields={[
              {
                field: {
                  productionReviewLlmProviderId: true,
                },
                title: RULE_LLM_PROVIDER_FIELD_COPY.title,
                description:
                  PRODUCTION_REVIEW_SETTINGS_COPY.providerFieldDescription,
                fieldType: FormFieldSchemaType.CustomComponent,
                required: false,
                // Empty is the default provider, not "(Optional)".
                hideOptionalLabel: true,
                hideColumnDescription: true,
                dataTestId:
                  CODE_REPOSITORY_PRODUCTION_REVIEW_LLM_PROVIDER_TEST_ID,
                getCustomElement: (
                  values: FormValues<CodeRepository>,
                  elementProps: CustomElementProps,
                ): ReactElement => {
                  return (
                    <RuleLlmProviderPicker
                      value={
                        (values as { productionReviewLlmProviderId?: unknown })
                          .productionReviewLlmProviderId
                      }
                      ariaLabelledby={elementProps.ariaLabelledby}
                      onChange={(llmProviderId: string | null): void => {
                        elementProps.onChange?.(llmProviderId);
                      }}
                    />
                  );
                },
                getFooterElement: (): ReactElement => {
                  return <RuleLlmProviderFieldHint />;
                },
              },
            ]}
            modelDetailProps={{
              modelType: CodeRepository,
              id: "model-detail-code-repository-production-review-llm-provider",
              onItemLoaded: (item: CodeRepository): void => {
                remember({
                  productionReviewLlmProviderId: readLlmProviderId(
                    item.productionReviewLlmProviderId,
                  ),
                });
              },
              fields: [
                /*
                 * Named as the Edit form's field is, and shown as the
                 * provider the reviews use - the default by name while none
                 * is picked.
                 */
                {
                  field: {
                    productionReviewLlmProviderId: true,
                  },
                  title: RULE_LLM_PROVIDER_FIELD_COPY.title,
                  fieldType: FieldType.Element,
                  getElement: (item: CodeRepository): ReactElement => {
                    const shown: string | null =
                      getProductionReviewLlmProviderShown(
                        item.productionReviewLlmProviderId,
                        llmProviderChoices,
                        translator,
                      );

                    if (shown === null) {
                      return (
                        <Skeleton
                          className="h-5 w-40 rounded"
                          dataTestId="production-review-llm-provider-loading"
                        />
                      );
                    }

                    /*
                     * A pick the project can no longer use says what the
                     * reviews do instead, as the Edit form's field does: the
                     * default, until another is picked.
                     */
                    const isUnavailable: boolean =
                      getRuleLlmProviderPickState({
                        pickedProviderId: readLlmProviderId(
                          item.productionReviewLlmProviderId,
                        ),
                        choices: llmProviderChoices,
                      }) === RuleLlmProviderPickState.Unavailable;

                    const value: ReactElement = (
                      <span data-testid="production-review-llm-provider-value">
                        {shown}
                      </span>
                    );

                    if (!isUnavailable) {
                      return value;
                    }

                    return (
                      <div>
                        {value}
                        <p
                          className="mt-1 text-sm text-amber-700"
                          data-testid={
                            CODE_REPOSITORY_PRODUCTION_REVIEW_LLM_PROVIDER_WARNING_TEST_ID
                          }
                        >
                          {translator.translateText(
                            RULE_LLM_PROVIDER_FIELD_COPY.unavailableWarning,
                          )}
                        </p>
                      </div>
                    );
                  },
                },
              ],
              modelId: modelId,
            }}
          />
        ) : (
          <></>
        )}

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
