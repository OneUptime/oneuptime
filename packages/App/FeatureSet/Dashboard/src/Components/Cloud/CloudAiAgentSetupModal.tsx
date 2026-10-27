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
} from "./CloudAiAgentSetup";
import { ResourceAiAgentDescriptor } from "../ResourceAiAgent/ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  getResourceAiAccessRequestBody,
  parseResourceAiAccessStatus,
} from "../ResourceAiAgent/ResourceAiAgentStatus";
import useAiAgentAccessStatus, {
  AiAgentAccessStatusRead,
} from "../AiAccess/useAiAgentAccessStatus";
import IngestionKeySelector from "../Telemetry/IngestionKeySelector";
import { getSetupGuideOneUptimeUrl } from "../SetupGuide/SetupGuide";
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
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
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
  useState,
} from "react";

/*
 * "Let AI fix problems" on a cloud account: one question — how far may AI
 * go — and one command for the cloud's own shell, which creates the Cloud
 * AI agent's role and starts the agent. Nothing is pasted back: the agent
 * connects on its own, and the dialog says Connected when it does. Every
 * other setting has a safe default and is folded under Advanced.
 *
 * Changing how far AI may go is running the updated command: the agent's
 * own settings decide, as for every AI agent, and the final say stays in
 * the customer's cloud. The one setting OneUptime keeps — reading the
 * account's logs during investigations — is saved here directly.
 */

export const CLOUD_AI_AGENT_SETUP_TEST_ID: string = "cloud-ai-agent-setup";

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

interface ChoiceCardProps {
  title: string;
  description: string;
  isSelected: boolean;
  onSelect: () => void;
  dataTestId: string;
}

const ChoiceCard: FunctionComponent<ChoiceCardProps> = (
  props: ChoiceCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.isSelected}
      onClick={props.onSelect}
      data-testid={props.dataTestId}
      className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
        props.isSelected
          ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500"
          : "border-gray-200 bg-white hover:bg-gray-50"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
          props.isSelected ? "border-indigo-600" : "border-gray-300"
        }`}
      >
        {props.isSelected ? (
          <span className="h-2 w-2 rounded-full bg-indigo-600" />
        ) : (
          <></>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">
          {translator.translateText(props.title)}
        </span>
        <span className="mt-0.5 block text-sm text-gray-600">
          {translator.translateText(props.description)}
        </span>
      </span>
    </button>
  );
};

interface CheckRowProps {
  label: string;
  isChecked: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean | undefined;
  dataTestId: string;
  children?: ReactElement | undefined;
}

const CheckRow: FunctionComponent<CheckRowProps> = (
  props: CheckRowProps,
): ReactElement => {
  return (
    <label
      className={`flex items-start gap-2 text-sm ${
        props.isDisabled ? "text-gray-400" : "text-gray-800"
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        checked={props.isChecked}
        disabled={props.isDisabled}
        data-testid={props.dataTestId}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          props.onChange(event.target.checked);
        }}
      />
      <span className="min-w-0">
        {props.label}
        {props.children}
      </span>
    </label>
  );
};

const CloudAiAgentSetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [choices, setChoices] = useState<CloudAiAgentSetupChoices>(
    getDefaultCloudAiAgentSetupChoices({
      provider: props.provider,
      currentMode: props.status?.aiRemediationMode,
    }),
  );
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

  return (
    <Modal
      title="Let AI fix problems"
      description={translator.translateTemplate(
        "OneUptime AI can already read this account. To let it fix problems too, run one command in {{shell}}: it creates the agent's role and starts the agent, which connects on its own.",
        { shell },
      )}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText={isConnected ? "Done" : "Close"}
    >
      <div className="space-y-6" data-testid={CLOUD_AI_AGENT_SETUP_TEST_ID}>
        <div>
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText(translationKey("How far may AI go?"))}
          </p>
          <div
            className="mt-2 space-y-2"
            role="radiogroup"
            aria-label={translator.translateText(
              translationKey("How far may AI go?"),
            )}
          >
            <ChoiceCard
              title={CLOUD_AI_AGENT_ASK_FIRST_TITLE}
              description={CLOUD_AI_AGENT_ASK_FIRST_DESCRIPTION}
              isSelected={!choices.fixSafeProblemsAlone}
              dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-ask-first`}
              onSelect={() => {
                update({ fixSafeProblemsAlone: false, bypassApproval: false });
              }}
            />
            <ChoiceCard
              title={CLOUD_AI_AGENT_FIX_SAFE_TITLE}
              description={CLOUD_AI_AGENT_FIX_SAFE_DESCRIPTION}
              isSelected={choices.fixSafeProblemsAlone}
              dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-fix-safe`}
              onSelect={() => {
                update({ fixSafeProblemsAlone: true });
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
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

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">
            {translator.translateTemplate("Run this in {{shell}}", { shell })}
          </p>
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

        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            isConnected
              ? "border-emerald-200 bg-emerald-50"
              : "border-gray-200 bg-gray-50"
          }`}
          data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-connection`}
        >
          <Icon
            icon={isConnected ? IconProp.CheckCircle : IconProp.Clock}
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              isConnected ? "text-emerald-600" : "text-gray-500"
            }`}
          />
          <p
            className={`text-sm ${
              isConnected ? "text-emerald-900" : "text-gray-700"
            }`}
          >
            {isConnected
              ? translator.translateText(
                  translationKey(
                    "Connected. Running the command again with other choices updates the agent.",
                  ),
                )
              : translator.translateText(
                  translationKey(
                    "Waiting for the agent to connect. It connects within a few minutes of the command finishing.",
                  ),
                )}
          </p>
        </div>

        <CollapsibleSection
          title="Advanced"
          defaultCollapsed={true}
          collapsedDescription={translationKey(
            "Which changes AI may make, resources it must never change, a required tag, reading logs, and running the agent somewhere else.",
          )}
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
                isChecked={isAiLogReadEnabled}
                isDisabled={isSavingLogs}
                dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-logs`}
                onChange={(value: boolean) => {
                  saveLogReading(value).catch(() => {
                    // handled inside saveLogReading
                  });
                }}
              />
              <p className="pl-6 text-xs text-gray-500">
                {translator.translateText(
                  translationKey(
                    "Off by default: log lines can hold customer data. Saved at once, with no command to run.",
                  ),
                )}
              </p>
              {logsError ? (
                <p className="pl-6 text-xs text-rose-600">{logsError}</p>
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
              <p className="text-xs text-gray-600">
                {translator.translateText(
                  translationKey("Its logs, when it does not connect:"),
                )}
              </p>
              <CodeBlock
                language="bash"
                code={getCloudAiAgentLogsCommand(props.provider)}
              />
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </Modal>
  );
};

export default CloudAiAgentSetupModal;
