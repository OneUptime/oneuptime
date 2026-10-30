import {
  CLOUD_AI_AGENT_ASK_FIRST_DESCRIPTION,
  CLOUD_AI_AGENT_ASK_FIRST_TITLE,
  CLOUD_AI_AGENT_CONNECT_POLL_INTERVAL_MS,
  CLOUD_AI_AGENT_FIX_SAFE_DESCRIPTION,
  CLOUD_AI_AGENT_FIX_SAFE_TITLE,
  CLOUD_SHELL_NAMES,
  CloudAiAgentProtectedTargetsProblem,
  CloudAiAgentSetupChoices,
  getCloudAiAgentLogsCommand,
  getCloudAiAgentSetupOptions,
  getDefaultCloudAiAgentSetupChoices,
  getProtectedTargetsProblem,
  parseProtectedTargets,
} from "./CloudAiAgentSetup";
import { ResourceAiAgentDescriptor } from "../ResourceAiAgent/ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  getResourceAiAccessRequestBody,
  getResourceAutomaticRemediation,
  parseResourceAiAccessStatus,
} from "../ResourceAiAgent/ResourceAiAgentStatus";
import {
  AutomaticRemediationSettings,
  isAnyAutomaticRemediationOff,
} from "../AiAccess/AutomaticRemediationLine";
import AutomaticRemediationNote from "../AiAccess/AutomaticRemediationNote";
import useAiAgentAccessStatus, {
  AiAgentAccessStatusRead,
} from "../AiAccess/useAiAgentAccessStatus";
import IngestionKeySelector from "../Telemetry/IngestionKeySelector";
import { getSetupGuideOneUptimeUrl } from "../SetupGuide/SetupGuide";
import SetupGuideOptionPicker from "../SetupGuide/SetupGuideOptionPicker";
import SetupGuideSteps, {
  SetupGuideStepView,
} from "../SetupGuide/SetupGuideSteps";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudAiAgentEnvironmentVariable,
  CloudAiAgentSetupOptions,
  describeCloudAiAgentSetupProblem,
  getCloudAiAgentChangeOperations,
  getCloudAiAgentEnvironment,
  getCloudAiAgentImage,
  getCloudAiAgentSetupCommand,
} from "Common/Types/CloudConnection/CloudAiAgentSetupCommands";
import {
  CloudAiAgentCostEstimate,
  estimateCloudAiAgentMonthlyCost,
} from "Common/Types/CloudConnection/CloudAiAgentCost";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Protocol from "Common/Types/API/Protocol";
import {
  CLOUD_AI_DEFAULT_REQUIRED_TAG,
  ResourceAiAccessStatus,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  FOLDED_SECTION_ON,
  FoldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * "Let AI fix problems" on a cloud account, laid out as every "connect
 * this" guide in the product is (Add Host, the agents' setup guides): the
 * guide's one question on top - how far may AI go - then numbered steps:
 * choose the key the agent connects with, run one command in the cloud's
 * own shell (it creates the Cloud AI agent's role and starts the agent),
 * and wait for it to connect. Nothing is pasted back: the agent connects
 * on its own, and the last step says Connected when it does. Every other
 * setting has a safe default and is folded under More fields.
 *
 * Changing how far AI may go is running the updated command: the agent's
 * own settings decide, as for every AI agent, and the final say stays in
 * the customer's cloud. Opened for an agent that connected (Change), the
 * dialog starts from what the agent reports it runs with, so the command
 * keeps every earlier choice. The one setting OneUptime keeps - reading
 * the account's logs during investigations - is saved here directly.
 */

export const CLOUD_AI_AGENT_SETUP_TEST_ID: string = "cloud-ai-agent-setup";

// The question's two answers, as the option picker keys them.
const ASK_FIRST: string = "ask-first";
const FIX_SAFE: string = "fix-safe";

export interface ComponentProps {
  descriptor: ResourceAiAgentDescriptor;
  cloudAccountId: ObjectID;
  provider: CloudProvider;
  // The cloud's own id of the account.
  accountId: string;
  isAiLogReadEnabled: boolean;
  // The account's AI access as the page last read it (the agent's mode).
  status: ResourceAiAccessStatus | null;
  onClose: () => void;
  // The log setting was saved: the page reads the account again.
  onSaved?: (() => void) | undefined;
}

interface CheckRowProps {
  label: string;
  isChecked: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean | undefined;
  dataTestId: string;
  // A line under the label, read with it (aria-describedby).
  description?: string | undefined;
  children?: ReactElement | undefined;
}

const CheckRow: FunctionComponent<CheckRowProps> = (
  props: CheckRowProps,
): ReactElement => {
  const descriptionId: string = `${props.dataTestId}-description-${useId()}`;

  return (
    <div>
      <label
        className={`flex items-start gap-2 text-sm ${
          props.isDisabled ? "text-gray-400" : "text-gray-800"
        }`}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          checked={props.isChecked}
          disabled={props.isDisabled}
          data-testid={props.dataTestId}
          aria-describedby={props.description ? descriptionId : undefined}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onChange(event.target.checked);
          }}
        />
        <span className="min-w-0">
          {props.label}
          {props.children}
        </span>
      </label>
      {props.description ? (
        <p id={descriptionId} className="mt-0.5 ps-6 text-xs text-gray-500">
          {props.description}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const CloudAiAgentSetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [choices, setChoices] = useState<CloudAiAgentSetupChoices>(() => {
    return getDefaultCloudAiAgentSetupChoices({
      provider: props.provider,
      currentMode: props.status?.aiRemediationMode,
      posture: props.status?.agent?.posture,
      accountId: props.accountId,
    });
  });
  const [ingestionKey, setIngestionKey] =
    useState<TelemetryIngestionKey | null>(null);
  const [isAiLogReadEnabled, setIsAiLogReadEnabled] = useState<boolean>(
    props.isAiLogReadEnabled,
  );
  const [isSavingLogs, setIsSavingLogs] = useState<boolean>(false);
  const [logsError, setLogsError] = useState<string>("");
  const [pollToken, setPollToken] = useState<number>(0);

  // While the dialog is open, ask every few seconds whether the agent connected.
  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setPollToken((token: number) => {
        return token + 1;
      });
    }, CLOUD_AI_AGENT_CONNECT_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const read: AiAgentAccessStatusRead<ResourceAiAccessStatus> =
    useAiAgentAccessStatus<ResourceAiAccessStatus>({
      route: RESOURCE_AI_ACCESS_STATUS_ROUTE,
      body: getResourceAiAccessRequestBody(
        props.descriptor,
        props.cloudAccountId.toString(),
      ),
      parse: parseResourceAiAccessStatus,
      refreshToken: pollToken,
    });
  const status: ResourceAiAccessStatus | null = read.status || props.status;
  const isConnected: boolean = Boolean(status?.agent?.isOnline);
  /*
   * The project's own switches: the agent's answer below decides how a fix
   * runs, but the project fixes new incidents and alerts only while these
   * are on - off by default - so the question says so when one is off.
   */
  const automaticRemediation: AutomaticRemediationSettings | null = status
    ? getResourceAutomaticRemediation(status)
    : null;

  const shell: string =
    translator.translateText(CLOUD_SHELL_NAMES[props.provider]) ||
    CLOUD_SHELL_NAMES[props.provider];
  const oneuptimeUrl: string = getSetupGuideOneUptimeUrl({
    host: HOST,
    isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
  });
  const ingestionKeyValue: string = ingestionKey?.secretKey?.toString() || "";

  const options: CloudAiAgentSetupOptions = getCloudAiAgentSetupOptions({
    provider: props.provider,
    choices,
    oneuptimeUrl,
    ingestionKey: ingestionKeyValue,
    cloudAccountId: props.cloudAccountId.toString(),
    accountId: props.accountId,
  });
  const protectedProblem: CloudAiAgentProtectedTargetsProblem | null =
    getProtectedTargetsProblem({
      provider: props.provider,
      accountId: props.accountId,
      text: choices.protectedTargetsText,
    });
  let problem: string | null = null;

  if (!ingestionKeyValue) {
    problem =
      translator.translateText(
        translationKey(
          "Pick the telemetry ingestion key the agent connects with.",
        ),
      ) || "Pick the telemetry ingestion key the agent connects with.";
  } else if (protectedProblem?.kind === "unreadable") {
    problem = translator.translateTemplate(
      "{{pattern}} is not a pattern the agent can read: write a resource's id, with * for any run of characters, and no spaces or quotes.",
      { pattern: protectedProblem.pattern },
    );
  } else if (protectedProblem?.kind === "too-many") {
    problem = translator.translateTemplate(
      "List at most {{most}} protected resources, with * patterns to cover several.",
      { most: String(protectedProblem.most) },
    );
  } else {
    problem = describeCloudAiAgentSetupProblem(options);
  }
  const command: string = problem ? "" : getCloudAiAgentSetupCommand(options);
  const cost: CloudAiAgentCostEstimate = estimateCloudAiAgentMonthlyCost(
    props.provider,
  );
  const everyChange: Array<string> = getCloudAiAgentChangeOperations(
    props.provider,
  );

  const update: (changes: Partial<CloudAiAgentSetupChoices>) => void = (
    changes: Partial<CloudAiAgentSetupChoices>,
  ): void => {
    setChoices((current: CloudAiAgentSetupChoices) => {
      return { ...current, ...changes };
    });
  };

  const saveLogReading: (value: boolean) => Promise<void> = async (
    value: boolean,
  ): Promise<void> => {
    setIsSavingLogs(true);
    setLogsError("");

    try {
      await ModelAPI.updateById<CloudAccount>({
        modelType: CloudAccount,
        id: props.cloudAccountId,
        data: { isAiLogReadEnabled: value },
      });
      setIsAiLogReadEnabled(value);
      props.onSaved?.();
    } catch (error) {
      setLogsError(API.getFriendlyMessage(error));
    }

    setIsSavingLogs(false);
  };

  const environment: Array<CloudAiAgentEnvironmentVariable> = problem
    ? []
    : getCloudAiAgentEnvironment(options);

  /*
   * What More fields holds, as its folded line lists it - and what of it is
   * in force, with its value ("Changes: 3 of 10", "Tag: oneuptime-ai=allow"),
   * so the choices an agent was set up with (Change opens on them) show
   * without opening the fold.
   */
  const protectedCount: number = parseProtectedTargets(
    choices.protectedTargetsText,
  ).length;
  const moreFieldsItems: Array<FoldedSectionItem> = [
    {
      key: "changes",
      title: "Changes",
      isSet: choices.enabledOperations.length < everyChange.length,
      value: translator.translateTemplate("{{count}} of {{total}}", {
        count: translator.formatNumber(choices.enabledOperations.length),
        total: translator.formatNumber(everyChange.length),
      }),
    },
    {
      key: "protected",
      title: "Resources AI must never change",
      isSet: protectedCount > 0,
      value: translator.formatNumber(protectedCount),
    },
    {
      key: "tag",
      title: "Tag",
      isSet: choices.onlyTaggedResources,
      value: CLOUD_AI_DEFAULT_REQUIRED_TAG,
    },
    {
      key: "bypass",
      title: "Bypass approval",
      isSet: choices.bypassApproval,
      value: FOLDED_SECTION_ON,
      translateValue: true,
    },
    {
      key: "logs",
      title: "Log lines",
      isSet: isAiLogReadEnabled,
      value: FOLDED_SECTION_ON,
      translateValue: true,
    },
    {
      key: "elsewhere",
      title: "Run the agent somewhere else",
      isSet: false,
    },
  ];

  const steps: Array<SetupGuideStepView> = [
    {
      title:
        translator.translateText(translationKey("Choose an ingestion key")) ||
        "Choose an ingestion key",
      description:
        translator.translateText(
          translationKey(
            "The agent connects to your project with this key. Pick an existing key or create a new one: the command below uses it.",
          ),
        ) || undefined,
      content: (
        <div data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-key`}>
          <IngestionKeySelector
            endpointLabel={translationKey("OneUptime URL")}
            endpointValue={oneuptimeUrl}
            keyTypeFilter={TelemetryIngestionKeyType.Server}
            newKeyName={translationKey("Cloud AI agent key")}
            hideValues={true}
            onSelectedKeyChange={(key: TelemetryIngestionKey | null) => {
              setIngestionKey(key);
            }}
          />
        </div>
      ),
    },
    {
      title: translator.translateTemplate("Run this in {{shell}}", { shell }),
      description:
        translator.translateText(
          translationKey(
            "Run it as someone who may create roles in this account.",
          ),
        ) || undefined,
      content: (
        <div className="space-y-2">
          {command ? (
            <div data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-command`}>
              <CodeBlock language="bash" code={command} />
            </div>
          ) : (
            <p
              className="text-sm text-amber-700"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-problem`}
            >
              {problem}
            </p>
          )}
          <p
            className="text-xs text-gray-500"
            data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-cost`}
          >
            {translator.translateTemplate(
              "It runs one small always-on container in your account: about ${{usd}} a month at list prices, billed by your cloud.",
              { usd: String(cost.usd) },
            )}
          </p>
        </div>
      ),
    },
    {
      title:
        translator.translateText(translationKey("Wait for it to connect")) ||
        "Wait for it to connect",
      content: (
        <div className="space-y-3">
          {isConnected ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
              role="status"
              aria-live="polite"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-connection`}
              data-state="connected"
            >
              <Icon
                icon={IconProp.CheckCircle}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
              />
              <p className="text-sm text-emerald-900">
                {translator.translateText(
                  translationKey(
                    "Connected. Running the command again with other choices updates the agent.",
                  ),
                )}
              </p>
            </div>
          ) : (
            <div
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
              role="status"
              aria-live="polite"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-connection`}
              data-state="waiting"
            >
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                {/* The dot's own indigo: a mid-tone reads the same in the dark theme. */}
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
              </span>
              <p className="text-sm text-gray-700">
                {translator.translateText(
                  translationKey(
                    "Waiting for the agent to connect. It connects within a few minutes of the command finishing.",
                  ),
                )}
              </p>
            </div>
          )}

          {/*
           * Where to look when it does not connect, while it has not: the
           * log of the agent the command started, in the same shell.
           */}
          {isConnected ? (
            <></>
          ) : (
            <div
              className="space-y-1"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-logs-command`}
            >
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  translationKey("Its logs, when it does not connect:"),
                )}
              </p>
              <CodeBlock
                language="bash"
                code={getCloudAiAgentLogsCommand(props.provider)}
              />
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <Modal
      title="Let AI fix problems"
      description={translator.translateTemplate(
        "Run one command in {{shell}} to let OneUptime AI fix problems here: it creates the agent's role and starts the agent, which connects on its own.",
        { shell },
      )}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText={isConnected ? "Done" : "Close"}
    >
      <div className="space-y-6" data-testid={CLOUD_AI_AGENT_SETUP_TEST_ID}>
        {/*
         * The guide's one question, above its steps, as "What does the
         * host run?" sits above Add Host's: the command is written from
         * the answer. The project's own automatic fixing switches go under
         * it while one is off.
         */}
        <div data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-question`}>
          <SetupGuideOptionPicker
            label={
              translator.translateText(translationKey("How far may AI go?")) ||
              "How far may AI go?"
            }
            options={[
              {
                key: ASK_FIRST,
                label:
                  translator.translateText(CLOUD_AI_AGENT_ASK_FIRST_TITLE) ||
                  CLOUD_AI_AGENT_ASK_FIRST_TITLE,
                description:
                  translator.translateText(
                    CLOUD_AI_AGENT_ASK_FIRST_DESCRIPTION,
                  ) || CLOUD_AI_AGENT_ASK_FIRST_DESCRIPTION,
              },
              {
                key: FIX_SAFE,
                label:
                  translator.translateText(CLOUD_AI_AGENT_FIX_SAFE_TITLE) ||
                  CLOUD_AI_AGENT_FIX_SAFE_TITLE,
                description:
                  translator.translateText(
                    CLOUD_AI_AGENT_FIX_SAFE_DESCRIPTION,
                  ) || CLOUD_AI_AGENT_FIX_SAFE_DESCRIPTION,
              },
            ]}
            selectedKey={choices.fixSafeProblemsAlone ? FIX_SAFE : ASK_FIRST}
            onSelect={(key: string) => {
              if (key === FIX_SAFE) {
                update({ fixSafeProblemsAlone: true });
                return;
              }

              update({ fixSafeProblemsAlone: false, bypassApproval: false });
            }}
            note={
              automaticRemediation &&
              isAnyAutomaticRemediationOff(automaticRemediation) ? (
                <AutomaticRemediationNote
                  settings={automaticRemediation}
                  dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-automatic-remediation`}
                />
              ) : undefined
            }
          />
        </div>

        <SetupGuideSteps steps={steps} />

        <FoldedSection
          title={MORE_FIELDS_SECTION_TITLE}
          items={moreFieldsItems}
          dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-more-fields`}
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(
                  translationKey(
                    "Which changes AI may make (their tiers still apply)",
                  ),
                )}
              </p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {everyChange.map((operation: string): ReactElement => {
                  return (
                    <CheckRow
                      key={operation}
                      label=""
                      isChecked={choices.enabledOperations.includes(operation)}
                      isDisabled={
                        choices.enabledOperations.length === 1 &&
                        choices.enabledOperations.includes(operation)
                      }
                      dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-operation-${operation}`}
                      onChange={(value: boolean) => {
                        update({
                          enabledOperations: value
                            ? [...choices.enabledOperations, operation]
                            : choices.enabledOperations.filter(
                                (name: string): boolean => {
                                  return name !== operation;
                                },
                              ),
                        });
                      }}
                    >
                      <code className="font-mono text-xs">{operation}</code>
                    </CheckRow>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <label
                className="block text-sm font-medium text-gray-900"
                htmlFor={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-protected`}
              >
                {translator.translateText(
                  translationKey("Resources AI must never change"),
                )}
              </label>
              <textarea
                id={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-protected`}
                rows={3}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder={translator.translateText(
                  translationKey(
                    "One name or id pattern per line, such as *prod-db*",
                  ),
                )}
                value={choices.protectedTargetsText}
                data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-protected`}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                  update({ protectedTargetsText: event.target.value });
                }}
              />
            </div>

            <CheckRow
              label={translator.translateTemplate(
                "Only change resources tagged {{tag}}",
                { tag: CLOUD_AI_DEFAULT_REQUIRED_TAG },
              )}
              isChecked={choices.onlyTaggedResources}
              dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-tagged`}
              onChange={(value: boolean) => {
                update({ onlyTaggedResources: value });
              }}
            />

            <CheckRow
              label={
                translator.translateText(
                  translationKey(
                    "Let riskier changes run without approval (Bypass approval)",
                  ),
                ) || ""
              }
              isChecked={choices.bypassApproval}
              dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-bypass`}
              onChange={(value: boolean) => {
                update({
                  bypassApproval: value,
                  ...(value ? { fixSafeProblemsAlone: true } : {}),
                });
              }}
            />

            <div className="space-y-1">
              <CheckRow
                label={
                  translator.translateText(
                    translationKey(
                      "Let AI read this account's logs during investigations",
                    ),
                  ) || ""
                }
                description={
                  translator.translateText(
                    translationKey(
                      "Off by default: log lines can hold customer data. Saved at once, with no command to run.",
                    ),
                  ) || undefined
                }
                isChecked={isAiLogReadEnabled}
                isDisabled={isSavingLogs}
                dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-logs`}
                onChange={(value: boolean) => {
                  saveLogReading(value).catch(() => {
                    // handled inside saveLogReading
                  });
                }}
              />
              {logsError ? (
                <p className="ps-6 text-xs text-rose-600" role="alert">
                  {logsError}
                </p>
              ) : (
                <></>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(
                  translationKey("Run the agent somewhere else"),
                )}
              </p>
              <p className="text-xs text-gray-600">
                {translator.translateTemplate(
                  "Deploy the image {{image}} your own way, with these variables and a role that holds the enabled changes' permissions.",
                  { image: getCloudAiAgentImage() },
                )}
              </p>
              {environment.length > 0 ? (
                <CodeBlock
                  language="bash"
                  code={environment
                    .map(
                      (variable: CloudAiAgentEnvironmentVariable): string => {
                        return `${variable.name}=${variable.value}`;
                      },
                    )
                    .join("\n")}
                />
              ) : (
                <></>
              )}
            </div>
          </div>
        </FoldedSection>
      </div>
    </Modal>
  );
};

export default CloudAiAgentSetupModal;
