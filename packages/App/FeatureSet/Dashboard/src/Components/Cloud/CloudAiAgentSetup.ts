import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_AI_AGENT_DEFAULT_FIXES_MODE,
  CloudAiAgentFixesMode,
  CloudAiAgentSetupOptions,
  getCloudAiAgentChangeOperations,
} from "Common/Types/CloudConnection/CloudAiAgentSetupCommands";
import AiResourceType, {
  CLOUD_AI_RESOURCE_TYPES,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME,
  AZURE_CLOUD_AI_AGENT_APP_NAME,
  AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
  GCP_CLOUD_AI_AGENT_SERVICE_NAME,
} from "Common/Types/ResourceAiAgent/CloudAiAgentNames";
import {
  CLOUD_AI_DEFAULT_REQUIRED_TAG,
  ResourceAiRemediationMode,
  parseResourceAiRemediationMode,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { getCloudCatalogProvider } from "Common/Utils/AiRemediation/Resource/CloudOperationCatalog";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * LETTING ONEUPTIME AI FIX PROBLEMS IN A CLOUD ACCOUNT: what the account's
 * "Let AI fix problems" dialog asks, and the setup command it builds.
 *
 * One question — how far may AI go — and one command for the cloud's own
 * shell. Every other choice has a safe default and sits under Advanced:
 * which changes AI may make (all; their tiers still apply), resources AI
 * must never change, only changing resources that carry a tag, reading the
 * account's logs during investigations (off), letting riskier changes run
 * without approval, and running the agent somewhere else.
 *
 * Import-clean on purpose (Common types and the cloud setup commands), so
 * the suites read it without a browser.
 */

// The choices the dialog collects.
export interface CloudAiAgentSetupChoices {
  // "Ask me first" (RequireApproval, the default) or "Fix safe problems on its own" (Automatic).
  fixSafeProblemsAlone: boolean;
  // Advanced: riskier changes run without approval too (BypassApproval).
  bypassApproval: boolean;
  // Advanced: the catalog changes AI may make; every change of the cloud by default.
  enabledOperations: Array<string>;
  // Advanced: resources AI must never change, one name or id pattern per line.
  protectedTargetsText: string;
  // Advanced: change only resources tagged CLOUD_AI_DEFAULT_REQUIRED_TAG.
  onlyTaggedResources: boolean;
}

// The two answers to the dialog's one question.
export const CLOUD_AI_AGENT_ASK_FIRST_TITLE: string =
  translationKey("Ask me first");
export const CLOUD_AI_AGENT_ASK_FIRST_DESCRIPTION: string = translationKey(
  "OneUptime AI proposes each fix, and a person approves it with one click.",
);
export const CLOUD_AI_AGENT_FIX_SAFE_TITLE: string = translationKey(
  "Fix safe problems on its own",
);
export const CLOUD_AI_AGENT_FIX_SAFE_DESCRIPTION: string = translationKey(
  "Safe changes, such as a rolling restart or scaling out, run on their own. Riskier ones still wait for approval.",
);

// The cloud's own shell, where the command runs.
export const CLOUD_SHELL_NAMES: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: translationKey("AWS CloudShell"),
  [CloudProvider.Azure]: translationKey("Azure Cloud Shell"),
  [CloudProvider.GCP]: translationKey("Google Cloud Shell"),
};

// The AI resource type of a cloud account, by its cloud.
export function getCloudAccountAiResourceType(
  provider: unknown,
): AiResourceType | null {
  return (
    CLOUD_AI_RESOURCE_TYPES.find((type: AiResourceType): boolean => {
      return getCloudCatalogProvider(type) === provider;
    }) || null
  );
}

// A CloudProvider from a stored value, or null.
export function readCloudProvider(value: unknown): CloudProvider | null {
  return (Object.values(CloudProvider) as Array<unknown>).includes(value)
    ? (value as CloudProvider)
    : null;
}

/*
 * The dialog's starting point: what the account's agent runs with now
 * when it has one (its mode), the defaults otherwise. A mode of Off reads
 * as "Ask me first": opening the dialog is asking for fixes.
 */
export function getDefaultCloudAiAgentSetupChoices(data: {
  provider: CloudProvider;
  currentMode?: unknown;
}): CloudAiAgentSetupChoices {
  const mode: ResourceAiRemediationMode = parseResourceAiRemediationMode(
    data.currentMode,
  );

  return {
    fixSafeProblemsAlone:
      mode === ResourceAiRemediationMode.Automatic ||
      mode === ResourceAiRemediationMode.BypassApproval,
    bypassApproval: mode === ResourceAiRemediationMode.BypassApproval,
    enabledOperations: getCloudAiAgentChangeOperations(data.provider),
    protectedTargetsText: "",
    onlyTaggedResources: false,
  };
}

// The agent's fixes setting for these choices.
export function getCloudAiAgentFixesMode(
  choices: CloudAiAgentSetupChoices,
): CloudAiAgentFixesMode {
  if (choices.bypassApproval) {
    return "BypassApproval";
  }

  return choices.fixSafeProblemsAlone
    ? "Automatic"
    : CLOUD_AI_AGENT_DEFAULT_FIXES_MODE;
}

// One pattern per line (or comma), trimmed, blanks and duplicates dropped.
export function parseProtectedTargets(text: string): Array<string> {
  const patterns: Array<string> = [];

  for (const part of (text || "").split(/[\n,]/)) {
    const pattern: string = part.trim();

    if (pattern && !patterns.includes(pattern)) {
      patterns.push(pattern);
    }
  }

  return patterns;
}

// The setup command's options for these choices and this account.
export function getCloudAiAgentSetupOptions(data: {
  provider: CloudProvider;
  choices: CloudAiAgentSetupChoices;
  oneuptimeUrl: string;
  ingestionKey: string;
  cloudAccountId: string;
  accountId: string;
}): CloudAiAgentSetupOptions {
  const everyChange: Array<string> = getCloudAiAgentChangeOperations(
    data.provider,
  );
  const enabled: Array<string> = everyChange.filter(
    (operation: string): boolean => {
      return data.choices.enabledOperations.includes(operation);
    },
  );

  return {
    provider: data.provider,
    oneuptimeUrl: data.oneuptimeUrl,
    ingestionKey: data.ingestionKey,
    cloudAccountId: data.cloudAccountId,
    accountId: data.accountId,
    fixesMode: getCloudAiAgentFixesMode(data.choices),
    // Every change is the default; the list is written only when it differs.
    ...(enabled.length === everyChange.length
      ? {}
      : { enabledOperations: enabled }),
    ...(parseProtectedTargets(data.choices.protectedTargetsText).length > 0
      ? {
          protectedTargets: parseProtectedTargets(
            data.choices.protectedTargetsText,
          ),
        }
      : {}),
    requiredTag: data.choices.onlyTaggedResources
      ? CLOUD_AI_DEFAULT_REQUIRED_TAG
      : null,
  };
}

/*
 * How the agent's own logs are read in its cloud's shell: what to look at
 * when it does not connect.
 */
export function getCloudAiAgentLogsCommand(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.AWS:
      return `aws logs tail ${AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME} --since 30m`;
    case CloudProvider.Azure:
      return `az containerapp logs show --name ${AZURE_CLOUD_AI_AGENT_APP_NAME} --resource-group ${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP} --tail 100`;
    default:
      return `gcloud run services logs read ${GCP_CLOUD_AI_AGENT_SERVICE_NAME} --limit 100`;
  }
}

// How often the dialog asks whether the agent connected, while it waits.
export const CLOUD_AI_AGENT_CONNECT_POLL_INTERVAL_MS: number = 5000;
