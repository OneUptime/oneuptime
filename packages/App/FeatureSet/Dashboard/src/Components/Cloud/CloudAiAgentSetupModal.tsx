import {
  CLOUD_AI_AGENT_ASK_FIRST_DESCRIPTION,
  CLOUD_AI_AGENT_ASK_FIRST_TITLE,
  CLOUD_AI_AGENT_CONNECT_POLL_INTERVAL_MS,
  CLOUD_AI_AGENT_FIX_SAFE_DESCRIPTION,
  CLOUD_AI_AGENT_FIX_SAFE_TITLE,
  CLOUD_AI_AGENT_KEY_NOTE,
  CLOUD_AI_AGENT_MAKING_KEY_TEXT,
  CLOUD_SHELL_NAMES,
  CloudAiAgentProtectedTargetsProblem,
  CloudAiAgentSetupChoices,
  GCP_HOST_DESCRIPTIONS,
  GCP_HOST_TITLES,
  getCloudAiAgentLogsCommand,
  getCloudAiAgentSetupOptions,
  getDefaultCloudAiAgentSetupChoices,
  getProtectedTargetsProblem,
  isCloudAiAgentKeyFailureRetryable,
  parseProtectedTargets,
  readCloudAiAgentKeyAnswer,
} from "./CloudAiAgentSetup";
import {
  CLOUD_AI_AGENT_ORGANIZATION_COST_TEXT,
  CLOUD_AI_AGENT_ORGANIZATION_INSTANCES_TEXT,
  CLOUD_AI_AGENT_ORGANIZATION_KEY_NOTE,
  CLOUD_AI_AGENT_ORGANIZATION_MAKING_KEYS_TEXT,
  CLOUD_AI_AGENT_ORGANIZATION_NO_KEYS_TEXT,
  CLOUD_AI_AGENT_ORGANIZATION_SKIPPED,
  CLOUD_AI_AGENT_ORGANIZATION_STEP_DESCRIPTION,
  CLOUD_AI_AGENT_ORGANIZATION_STEP_TITLE,
  CLOUD_AI_AGENT_ORGANIZATION_WAIT_TITLE,
  CLOUD_AI_AGENT_SCOPE_ACCOUNT,
  CLOUD_AI_AGENT_SCOPE_ACCOUNT_DESCRIPTION,
  CLOUD_AI_AGENT_SCOPE_ACCOUNT_TITLE,
  CLOUD_AI_AGENT_SCOPE_ORGANIZATION,
  CLOUD_AI_AGENT_SCOPE_ORGANIZATION_DESCRIPTION,
  CLOUD_AI_AGENT_SCOPE_ORGANIZATION_TITLE,
  CLOUD_AI_AGENT_SCOPE_QUESTION,
  CloudAiAgentSetupScope,
  canSetUpCloudAiAgentOrganization,
  getCloudAiAgentOrganizationSetupOptions,
  isEveryCloudOrganizationAgentConnected,
  readCloudOrganizationKeysForSetup,
} from "./CloudAiAgentOrganization";
import CloudAiAgentOrganizationAccounts from "./CloudAiAgentOrganizationAccounts";
import { ResourceAiAgentDescriptor } from "../ResourceAiAgent/ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_AGENT_KEY_ROUTE,
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
import { getSetupGuideOneUptimeUrl } from "../SetupGuide/SetupGuide";
import SetupGuideOptionPicker from "../SetupGuide/SetupGuideOptionPicker";
import SetupGuideSteps, {
  SetupGuideStepView,
} from "../SetupGuide/SetupGuideSteps";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  CloudAiAgentEnvironmentVariable,
  CloudAiAgentOrganizationSetupOptions,
  CloudAiAgentSetupOptions,
  describeCloudAiAgentOrganizationSetupProblem,
  describeCloudAiAgentSetupProblem,
  getAwsOrganizationCloudAiAgentInstancesCommand,
  getAwsOrganizationCloudAiAgentSetupCommand,
  getCloudAiAgentChangeOperations,
  getCloudAiAgentEnvironment,
  getCloudAiAgentImage,
  getCloudAiAgentSetupCommand,
} from "Common/Types/CloudConnection/CloudAiAgentSetupCommands";
import {
  CloudOrganizationKeys,
  CloudOrganizationSkippedAccount,
  CloudOrganizationView,
  RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
  RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
  parseCloudOrganizationKeys,
  parseCloudOrganizationView,
} from "Common/Types/CloudConnection/CloudOrganizationAgents";
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
import {
  GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
  GCP_CLOUD_AI_AGENT_HOSTS,
  GcpCloudAiAgentHost,
} from "Common/Types/ResourceAiAgent/CloudAiAgentNames";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  FOLDED_SECTION_ON,
  FoldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { APP_API_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
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
 * run one command in the cloud's own shell (it creates the Cloud AI agent's
 * role and starts the agent), and wait for it to connect. Nothing is pasted
 * back: the agent connects on its own, and the last step says Connected
 * when it does. Every other setting has a safe default and is folded under
 * More fields.
 *
 * The command carries a key made for this account's agent alone
 * (Types/CloudConnection/CloudAiAgentKey), made as the dialog opens: it
 * connects that agent and nothing else, never sends telemetry, and works
 * for a day until the agent connects with it. The agent's key so far keeps
 * working until then, so opening the dialog disconnects nothing. Only the
 * people who may set the agent up get a key; anyone else is told why where
 * the command would be.
 *
 * Changing how far AI may go is running the updated command: the agent's
 * own settings decide, as for every AI agent, and the final say stays in
 * the customer's cloud. Opened for an agent that connected (Change), the
 * dialog starts from what the agent reports it runs with, so the command
 * keeps every earlier choice. The one setting OneUptime keeps - reading
 * the account's logs during investigations - is saved here directly.
 *
 * On Google Cloud, More fields also asks what runs the agent: a small VM
 * by default (about $10 a month), or Cloud Run (about $45) for a project
 * that allows no VM an external address. The cost line and the logs
 * command follow the answer, and Change starts from where the agent runs.
 *
 * An AWS account of an AWS Organization one connection reads is also asked
 * which accounts: this one, or every account of the organization
 * (CloudAiAgentOrganization). For the organization the dialog asks for a
 * key for each account's agent - each made as this account's is, for the
 * same people - writes one command for the management account's CloudShell
 * (a StackSet), names the accounts it could make no key for, and waits for
 * every account's agent, listing each with whether it connected.
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
  /*
   * The key made for this agent as the dialog opened, why there is none,
   * and whether asking again may get one (a refusal never does).
   */
  const [agentKey, setAgentKey] = useState<string>("");
  const [keyError, setKeyError] = useState<string>("");
  const [canRetryKey, setCanRetryKey] = useState<boolean>(false);
  const [isMakingKey, setIsMakingKey] = useState<boolean>(true);
  const [keyRequest, setKeyRequest] = useState<number>(0);
  const [isAiLogReadEnabled, setIsAiLogReadEnabled] = useState<boolean>(
    props.isAiLogReadEnabled,
  );
  const [isSavingLogs, setIsSavingLogs] = useState<boolean>(false);
  const [logsError, setLogsError] = useState<string>("");
  const [pollToken, setPollToken] = useState<number>(0);
  // An AWS Organization's account: this account alone, or every account.
  const [scope, setScope] = useState<CloudAiAgentSetupScope>(
    CLOUD_AI_AGENT_SCOPE_ACCOUNT,
  );
  /*
   * The organization's keys - asked for the first time every account is
   * chosen, and with Try again - why there are none, and whether asking
   * again may get them.
   */
  const [organizationKeys, setOrganizationKeys] =
    useState<CloudOrganizationKeys | null>(null);
  const [organizationKeyError, setOrganizationKeyError] = useState<string>("");
  const [canRetryOrganizationKeys, setCanRetryOrganizationKeys] =
    useState<boolean>(false);
  const [isMakingOrganizationKeys, setIsMakingOrganizationKeys] =
    useState<boolean>(false);
  const [organizationKeyRequest, setOrganizationKeyRequest] =
    useState<number>(0);
  const isOrganizationScope: boolean =
    scope === CLOUD_AI_AGENT_SCOPE_ORGANIZATION;

  /*
   * One key per opening (and per Try again): the route makes it, and it is
   * shown here alone, in the command.
   */
  useEffect(() => {
    let isCurrent: boolean = true;

    setIsMakingKey(true);
    setKeyError("");
    setCanRetryKey(false);

    const makeKey: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              RESOURCE_AI_ACCESS_AGENT_KEY_ROUTE,
            ),
            data: getResourceAiAccessRequestBody(
              props.descriptor,
              props.cloudAccountId.toString(),
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isCurrent) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          setKeyError(API.getFriendlyMessage(response));
          setCanRetryKey(
            isCloudAiAgentKeyFailureRetryable(response.statusCode),
          );
          return;
        }

        const key: string | null = readCloudAiAgentKeyAnswer({
          answer: response.data,
          cloudAccountId: props.cloudAccountId.toString(),
        });

        if (!key) {
          setCanRetryKey(true);
          setKeyError(
            translator.translateText(
              translationKey(
                "OneUptime did not send a key for this agent. Try again.",
              ),
            ) || "OneUptime did not send a key for this agent. Try again.",
          );
          return;
        }

        setAgentKey(key);
      } catch (error) {
        if (isCurrent) {
          // No answer at all: the network, which may pass.
          setKeyError(API.getFriendlyMessage(error));
          setCanRetryKey(true);
        }
      } finally {
        if (isCurrent) {
          setIsMakingKey(false);
        }
      }
    };

    makeKey().catch(() => {
      // handled inside makeKey
    });

    return () => {
      isCurrent = false;
    };
  }, [keyRequest]);

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
   * The organization an AWS account is in, if any: read as the dialog
   * opens, and every few seconds while every account is chosen, for which
   * agents connected.
   */
  const organizationRead: AiAgentAccessStatusRead<CloudOrganizationView> =
    useAiAgentAccessStatus<CloudOrganizationView>({
      route: RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
      body: getResourceAiAccessRequestBody(
        props.descriptor,
        props.cloudAccountId.toString(),
      ),
      parse: parseCloudOrganizationView,
      refreshToken: isOrganizationScope ? pollToken + 1 : 0,
      isEnabled: props.provider === CloudProvider.AWS,
    });
  const organizationView: CloudOrganizationView | null =
    props.provider === CloudProvider.AWS ? organizationRead.status : null;
  const canChooseOrganization: boolean = canSetUpCloudAiAgentOrganization({
    provider: props.provider,
    view: organizationView,
  });
  const isOrganization: boolean = isOrganizationScope && canChooseOrganization;

  // Every account's key, once every account is chosen (and with Try again).
  useEffect(() => {
    if (!isOrganization || organizationKeys) {
      return undefined;
    }

    let isCurrent: boolean = true;

    setIsMakingOrganizationKeys(true);
    setOrganizationKeyError("");
    setCanRetryOrganizationKeys(false);

    const makeKeys: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
            ),
            data: getResourceAiAccessRequestBody(
              props.descriptor,
              props.cloudAccountId.toString(),
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isCurrent) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          setOrganizationKeyError(API.getFriendlyMessage(response));
          setCanRetryOrganizationKeys(
            isCloudAiAgentKeyFailureRetryable(response.statusCode),
          );
          return;
        }

        const keys: CloudOrganizationKeys | null = parseCloudOrganizationKeys(
          response.data,
        );

        if (!keys) {
          setCanRetryOrganizationKeys(true);
          setOrganizationKeyError(
            translator.translateText(
              CLOUD_AI_AGENT_ORGANIZATION_NO_KEYS_TEXT,
            ) || CLOUD_AI_AGENT_ORGANIZATION_NO_KEYS_TEXT,
          );
          return;
        }

        setOrganizationKeys(keys);
      } catch (error) {
        if (isCurrent) {
          setOrganizationKeyError(API.getFriendlyMessage(error));
          setCanRetryOrganizationKeys(true);
        }
      } finally {
        if (isCurrent) {
          setIsMakingOrganizationKeys(false);
        }
      }
    };

    makeKeys().catch(() => {
      // handled inside makeKeys
    });

    return () => {
      isCurrent = false;
    };
  }, [isOrganization, organizationKeyRequest]);
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
  const options: CloudAiAgentSetupOptions = getCloudAiAgentSetupOptions({
    provider: props.provider,
    choices,
    oneuptimeUrl,
    agentKey,
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

  if (!agentKey) {
    // Said where the command goes: making it, or why there is no key.
    problem = keyError || null;
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
  // Written only from a key, and only when nothing is wrong with the choices.
  const command: string =
    agentKey && !problem ? getCloudAiAgentSetupCommand(options) : "";

  /*
   * Every account of the organization: written from every account's own
   * key, with the same choices, once nothing is wrong with them.
   */
  const usableOrganizationKeys: CloudOrganizationKeys | null =
    readCloudOrganizationKeysForSetup({
      keys: organizationKeys,
      view: organizationView,
    });
  let organizationProblem: string | null = null;
  let organizationCommand: string = "";

  if (isOrganization) {
    if (!usableOrganizationKeys) {
      organizationProblem = organizationKeyError || null;
    } else if (protectedProblem) {
      // Said in the reader's language, as for one account.
      organizationProblem = problem;
    } else {
      const organizationOptions: CloudAiAgentOrganizationSetupOptions =
        getCloudAiAgentOrganizationSetupOptions({
          choices,
          oneuptimeUrl,
          keys: usableOrganizationKeys,
        });

      organizationProblem =
        describeCloudAiAgentOrganizationSetupProblem(organizationOptions);
      organizationCommand = organizationProblem
        ? ""
        : getAwsOrganizationCloudAiAgentSetupCommand(organizationOptions);
    }
  }

  const skippedAccounts: Array<CloudOrganizationSkippedAccount> =
    usableOrganizationKeys?.skipped || [];
  const cost: CloudAiAgentCostEstimate = estimateCloudAiAgentMonthlyCost(
    props.provider,
    choices.gcpHost,
  );
  // Google Cloud's agent on a VM of its own: the cost is the VM's.
  const isGcpVm: boolean =
    props.provider === CloudProvider.GCP &&
    choices.gcpHost === "compute-engine";
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

  const environment: Array<CloudAiAgentEnvironmentVariable> = command
    ? getCloudAiAgentEnvironment(options)
    : [];

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
    // What runs a Google Cloud agent, named once it is not the default.
    ...(props.provider === CloudProvider.GCP
      ? [
          {
            key: "host",
            title: translationKey("Runs on"),
            isSet: choices.gcpHost !== GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
            value: GCP_HOST_TITLES[choices.gcpHost],
            translateValue: true,
          },
        ]
      : []),
    {
      key: "elsewhere",
      title: "Run the agent somewhere else",
      isSet: false,
    },
  ];

  const organizationSteps: Array<SetupGuideStepView> = [
    {
      title: translator.translateTemplate(
        CLOUD_AI_AGENT_ORGANIZATION_STEP_TITLE,
        {
          shell,
          account: organizationView?.managementAccountId || "",
        },
      ),
      description:
        translator.translateText(
          CLOUD_AI_AGENT_ORGANIZATION_STEP_DESCRIPTION,
        ) || undefined,
      content: (
        <div className="space-y-2">
          {organizationCommand ? (
            <div
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-organization-command`}
            >
              <CodeBlock language="bash" code={organizationCommand} />
            </div>
          ) : isMakingOrganizationKeys ? (
            <p
              className="text-sm text-gray-500"
              role="status"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-making-organization-keys`}
            >
              {translator.translateText(
                CLOUD_AI_AGENT_ORGANIZATION_MAKING_KEYS_TEXT,
              ) || CLOUD_AI_AGENT_ORGANIZATION_MAKING_KEYS_TEXT}
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <p
                className="min-w-0 flex-1 text-sm text-amber-700"
                data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-organization-problem`}
              >
                {organizationProblem}
              </p>
              {organizationKeyError && canRetryOrganizationKeys ? (
                <Button
                  title="Try again"
                  icon={IconProp.Refresh}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-organization-keys-try-again`}
                  onClick={() => {
                    setOrganizationKeyRequest((request: number) => {
                      return request + 1;
                    });
                  }}
                />
              ) : (
                <></>
              )}
            </div>
          )}
          {/*
           * The accounts the reader may not edit: no key was made for
           * them, so the command leaves them out - said with their names.
           */}
          {skippedAccounts.length > 0 ? (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-organization-skipped`}
            >
              <p className="text-xs text-amber-900">
                {translator.translatePlural(
                  CLOUD_AI_AGENT_ORGANIZATION_SKIPPED,
                  skippedAccounts.length,
                  { count: translator.formatNumber(skippedAccounts.length) },
                )}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
                {skippedAccounts.map(
                  (account: CloudOrganizationSkippedAccount): ReactElement => {
                    return (
                      <li key={account.cloudAccountId} className="min-w-0">
                        <bdi>{account.name}</bdi>{" "}
                        <span dir="ltr" className="font-mono">
                          ({account.accountId})
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}
          {organizationCommand ? (
            <p
              className="text-xs text-gray-500"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-organization-key-note`}
            >
              {translator.translateText(CLOUD_AI_AGENT_ORGANIZATION_KEY_NOTE) ||
                CLOUD_AI_AGENT_ORGANIZATION_KEY_NOTE}
            </p>
          ) : (
            <></>
          )}
          <p
            className="text-xs text-gray-500"
            data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-organization-cost`}
          >
            {translator.translateTemplate(
              CLOUD_AI_AGENT_ORGANIZATION_COST_TEXT,
              { usd: String(cost.usd) },
            )}
          </p>
        </div>
      ),
    },
    {
      title:
        translator.translateText(CLOUD_AI_AGENT_ORGANIZATION_WAIT_TITLE) ||
        CLOUD_AI_AGENT_ORGANIZATION_WAIT_TITLE,
      content: (
        <div className="space-y-3">
          {organizationView ? (
            <CloudAiAgentOrganizationAccounts view={organizationView} />
          ) : (
            <></>
          )}
          {/*
           * Where to look when an account's agent does not connect: its
           * stack, as the StackSet lists them in the management account.
           */}
          {isEveryCloudOrganizationAgentConnected(organizationView) ? (
            <></>
          ) : (
            <div
              className="space-y-1"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-organization-instances-command`}
            >
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  CLOUD_AI_AGENT_ORGANIZATION_INSTANCES_TEXT,
                )}
              </p>
              <CodeBlock
                language="bash"
                code={getAwsOrganizationCloudAiAgentInstancesCommand()}
              />
            </div>
          )}
        </div>
      ),
    },
  ];

  const steps: Array<SetupGuideStepView> = [
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
          ) : isMakingKey ? (
            <p
              className="text-sm text-gray-500"
              role="status"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-making-key`}
            >
              {translator.translateText(CLOUD_AI_AGENT_MAKING_KEY_TEXT) ||
                CLOUD_AI_AGENT_MAKING_KEY_TEXT}
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <p
                className="min-w-0 flex-1 text-sm text-amber-700"
                data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-problem`}
              >
                {problem}
              </p>
              {/*
               * A key that could not be made for a reason that may pass (no
               * answer, a server error): asked for again. A refusal says who
               * may set the agent up, which asking again never changes, so
               * it stands alone.
               */}
              {keyError && canRetryKey ? (
                <Button
                  title="Try again"
                  icon={IconProp.Refresh}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-key-try-again`}
                  onClick={() => {
                    setKeyRequest((request: number) => {
                      return request + 1;
                    });
                  }}
                />
              ) : (
                <></>
              )}
            </div>
          )}
          {command ? (
            <p
              className="text-xs text-gray-500"
              data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-key-note`}
            >
              {translator.translateText(CLOUD_AI_AGENT_KEY_NOTE) ||
                CLOUD_AI_AGENT_KEY_NOTE}
            </p>
          ) : (
            <></>
          )}
          <p
            className="text-xs text-gray-500"
            data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-cost`}
          >
            {isGcpVm
              ? translator.translateTemplate(
                  "It runs on one small always-on VM in your project: about ${{usd}} a month at list prices, billed by your cloud. Google Cloud's free tier can cover it.",
                  { usd: String(cost.usd) },
                )
              : props.provider === CloudProvider.GCP
                ? // Google Cloud names it a project, as the VM's line does.
                  translator.translateTemplate(
                    "It runs one small always-on container in your project: about ${{usd}} a month at list prices, billed by your cloud.",
                    { usd: String(cost.usd) },
                  )
                : translator.translateTemplate(
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
                code={getCloudAiAgentLogsCommand(
                  props.provider,
                  choices.gcpHost,
                  props.accountId,
                )}
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
      closeButtonText={
        (
          isOrganization
            ? isEveryCloudOrganizationAgentConnected(organizationView)
            : isConnected
        )
          ? "Done"
          : "Close"
      }
    >
      <div className="space-y-6" data-testid={CLOUD_AI_AGENT_SETUP_TEST_ID}>
        {/*
         * An AWS account of an organization: which accounts, before how
         * far AI may go - the command and its steps follow the answer.
         */}
        {canChooseOrganization && organizationView ? (
          <div data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-scope`}>
            <SetupGuideOptionPicker
              label={
                translator.translateText(CLOUD_AI_AGENT_SCOPE_QUESTION) ||
                CLOUD_AI_AGENT_SCOPE_QUESTION
              }
              options={[
                {
                  key: CLOUD_AI_AGENT_SCOPE_ACCOUNT,
                  label:
                    translator.translateText(
                      CLOUD_AI_AGENT_SCOPE_ACCOUNT_TITLE,
                    ) || CLOUD_AI_AGENT_SCOPE_ACCOUNT_TITLE,
                  description: translator.translateTemplate(
                    CLOUD_AI_AGENT_SCOPE_ACCOUNT_DESCRIPTION,
                    { account: props.accountId },
                  ),
                },
                {
                  key: CLOUD_AI_AGENT_SCOPE_ORGANIZATION,
                  label:
                    translator.translateText(
                      CLOUD_AI_AGENT_SCOPE_ORGANIZATION_TITLE,
                    ) || CLOUD_AI_AGENT_SCOPE_ORGANIZATION_TITLE,
                  description: translator.translateTemplate(
                    CLOUD_AI_AGENT_SCOPE_ORGANIZATION_DESCRIPTION,
                    {
                      count: `${translator.formatNumber(
                        organizationView.accounts.length,
                      )}${organizationView.isTruncated ? "+" : ""}`,
                    },
                  ),
                },
              ]}
              selectedKey={scope}
              onSelect={(key: string) => {
                setScope(
                  key === CLOUD_AI_AGENT_SCOPE_ORGANIZATION
                    ? CLOUD_AI_AGENT_SCOPE_ORGANIZATION
                    : CLOUD_AI_AGENT_SCOPE_ACCOUNT,
                );
              }}
            />
          </div>
        ) : (
          <></>
        )}

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

        <SetupGuideSteps steps={isOrganization ? organizationSteps : steps} />

        <FoldedSection
          title={MORE_FIELDS_SECTION_TITLE}
          items={moreFieldsItems}
          dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-more-fields`}
        >
          <div className="space-y-5">
            {props.provider === CloudProvider.GCP ? (
              <fieldset
                className="space-y-2"
                data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-host`}
              >
                <legend className="text-sm font-medium text-gray-900">
                  {translator.translateText(
                    translationKey("Where the agent runs"),
                  )}
                </legend>
                {GCP_CLOUD_AI_AGENT_HOSTS.map(
                  (host: GcpCloudAiAgentHost): ReactElement => {
                    return (
                      <label
                        key={host}
                        className="flex items-start gap-2 text-sm text-gray-800"
                      >
                        <input
                          type="radio"
                          name={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-host`}
                          value={host}
                          checked={choices.gcpHost === host}
                          className="mt-0.5 h-4 w-4 flex-shrink-0 border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-500"
                          data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-host-${host}`}
                          onChange={() => {
                            update({ gcpHost: host });
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-gray-900">
                            {translator.translateText(GCP_HOST_TITLES[host]) ||
                              GCP_HOST_TITLES[host]}
                          </span>
                          <span className="block text-xs text-gray-500">
                            {translator.translateTemplate(
                              GCP_HOST_DESCRIPTIONS[host],
                              {
                                usd: String(
                                  estimateCloudAiAgentMonthlyCost(
                                    CloudProvider.GCP,
                                    host,
                                  ).usd,
                                ),
                              },
                            )}
                          </span>
                        </span>
                      </label>
                    );
                  },
                )}
              </fieldset>
            ) : (
              <></>
            )}

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
