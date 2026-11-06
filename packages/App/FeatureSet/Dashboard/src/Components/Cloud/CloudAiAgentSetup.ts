import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_AI_AGENT_DEFAULT_FIXES_MODE,
  CloudAiAgentFixesMode,
  CloudAiAgentSetupOptions,
  getCloudAiAgentChangeOperations,
  getCloudAiAgentMaxProtectedTargets,
  isReadableCloudAiAgentProtectedTarget,
} from "Common/Types/CloudConnection/CloudAiAgentSetupCommands";
import AiResourceType, {
  CLOUD_AI_RESOURCE_TYPES,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME,
  AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
  AZURE_CLOUD_AI_AGENT_APP_NAME,
  AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
  CLOUD_AI_AGENT_NAME,
  CloudAiAgentProvider,
  GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
  GCP_CLOUD_AI_AGENT_HOSTS,
  GCP_CLOUD_AI_AGENT_INSTANCE_NAME,
  GCP_CLOUD_AI_AGENT_SERVICE_NAME,
  GcpCloudAiAgentHost,
  getCloudAiAgentOwnTargets,
} from "Common/Types/ResourceAiAgent/CloudAiAgentNames";
import {
  CLOUD_AI_DEFAULT_REQUIRED_TAG,
  ResourceAiAgentPosture,
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
 * shell. Every other choice has a safe default and sits under More fields:
 * which changes AI may make (all; their tiers still apply), resources AI
 * must never change, only changing resources that carry a tag, reading the
 * account's logs during investigations (off), letting riskier changes run
 * without approval, on Google Cloud what runs the agent (a small VM, or
 * Cloud Run), and running the agent somewhere else.
 *
 * Import-clean on purpose (Common types and the cloud setup commands), so
 * the suites read it without a browser.
 */

// The choices the dialog collects.
export interface CloudAiAgentSetupChoices {
  // "Ask me first" (RequireApproval, the default) or "Fix safe problems on its own" (Automatic).
  fixSafeProblemsAlone: boolean;
  // More fields: riskier changes run without approval too (BypassApproval).
  bypassApproval: boolean;
  // More fields: the catalog changes AI may make; every change of the cloud by default.
  enabledOperations: Array<string>;
  // More fields: resources AI must never change, one name or id pattern per line.
  protectedTargetsText: string;
  // More fields: change only resources tagged CLOUD_AI_DEFAULT_REQUIRED_TAG.
  onlyTaggedResources: boolean;
  // More fields, Google Cloud only: what runs the agent.
  gcpHost: GcpCloudAiAgentHost;
}

/*
 * Google Cloud's two hosts for the agent, as More fields offers them: a
 * small VM, the default (about $10 a month), or Cloud Run (about $45: it
 * keeps CPU allocated only for a whole vCPU) for a project whose
 * organization allows no VM an external IP address.
 */
export const GCP_HOST_TITLES: Readonly<Record<GcpCloudAiAgentHost, string>> = {
  "compute-engine": translationKey("A small VM"),
  "cloud-run": translationKey("Cloud Run"),
};
export const GCP_HOST_DESCRIPTIONS: Readonly<
  Record<GcpCloudAiAgentHost, string>
> = {
  "compute-engine": translationKey(
    "One e2-micro Compute Engine VM in a network of its own that lets nothing in: about ${{usd}} a month.",
  ),
  "cloud-run": translationKey(
    "A Cloud Run service with CPU always allocated: about ${{usd}} a month. For a project that allows no VM an external IP address.",
  ),
};

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
 * Whether a protected target the agent reports is one of its own - its
 * stack, cluster, service, roles, resource group or service account, by
 * the names its setup command gives them, or what it found of itself where
 * it runs (its task, its revision) - rather than one a person listed.
 */
const CLOUD_AI_AGENT_OWN_NAMES: ReadonlyArray<string> = [
  CLOUD_AI_AGENT_NAME,
  AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
].map((name: string): string => {
  return name.toLowerCase();
});

function isCloudAiAgentOwnTarget(data: {
  pattern: string;
  ownTargets: Array<string>;
}): boolean {
  const pattern: string = data.pattern.toLowerCase();

  return (
    data.ownTargets.includes(pattern) ||
    CLOUD_AI_AGENT_OWN_NAMES.some((name: string): boolean => {
      return pattern.includes(name);
    })
  );
}

/*
 * What the account's agent runs with now, as it reports itself with every
 * heartbeat (its posture): the changes turned on, whether it changes only
 * tagged resources, and the resources a person listed for it never to
 * change. Change opens the dialog on these, so running the command again
 * keeps every choice made before and changes only what the reader changes
 * here: starting from the defaults would turn back on a change someone
 * turned off, and drop a protected resource or the tag, without a word.
 * What the posture does not say keeps its default.
 */
export function getCloudAiAgentReportedChoices(data: {
  provider: CloudProvider;
  accountId: string;
  posture: ResourceAiAgentPosture | null | undefined;
}): Partial<
  Pick<
    CloudAiAgentSetupChoices,
    | "enabledOperations"
    | "onlyTaggedResources"
    | "protectedTargetsText"
    | "gcpHost"
  >
> {
  const posture: ResourceAiAgentPosture | null | undefined = data.posture;

  if (!posture) {
    return {};
  }

  const details: Record<string, string | number | boolean | null> =
    posture.details || {};
  const choices: Partial<
    Pick<
      CloudAiAgentSetupChoices,
      | "enabledOperations"
      | "onlyTaggedResources"
      | "protectedTargetsText"
      | "gcpHost"
    >
  > = {};

  /*
   * Where a Google Cloud agent runs, so the command keeps it there: what it
   * reports, and Cloud Run for an agent too old to say, as every Google
   * Cloud agent was before it could run on a VM.
   */
  if (data.provider === CloudProvider.GCP) {
    const host: unknown = details["gcpHost"];

    choices.gcpHost = (
      GCP_CLOUD_AI_AGENT_HOSTS as ReadonlyArray<unknown>
    ).includes(host)
      ? (host as GcpCloudAiAgentHost)
      : "cloud-run";
  }

  const reportedOperations: unknown = details["enabledOperations"];

  if (typeof reportedOperations === "string") {
    const names: Array<string> = reportedOperations
      .split(",")
      .map((name: string): string => {
        return name.trim();
      });
    const enabled: Array<string> = getCloudAiAgentChangeOperations(
      data.provider,
    ).filter((operation: string): boolean => {
      return names.includes(operation);
    });

    if (enabled.length > 0) {
      choices.enabledOperations = enabled;
    }
  }

  if (Object.prototype.hasOwnProperty.call(details, "requiredTag")) {
    const tag: unknown = details["requiredTag"];

    choices.onlyTaggedResources = typeof tag === "string" && tag.trim() !== "";
  }

  const ownTargets: Array<string> = getCloudAiAgentOwnTargets({
    provider: data.provider as string as CloudAiAgentProvider,
    accountId: data.accountId,
  }).map((target: string): string => {
    return target.toLowerCase();
  });

  choices.protectedTargetsText = (posture.protectedTargets || [])
    .filter((pattern: string): boolean => {
      return !isCloudAiAgentOwnTarget({ pattern, ownTargets });
    })
    .join("\n");

  return choices;
}

/*
 * The dialog's starting point: what the account's agent runs with now
 * when it has one (its mode, and the choices its posture reports), the
 * defaults otherwise. A mode of Off reads as "Ask me first": opening the
 * dialog is asking for fixes.
 */
export function getDefaultCloudAiAgentSetupChoices(data: {
  provider: CloudProvider;
  currentMode?: unknown;
  // The account's agent as it reports itself, when one has connected.
  posture?: ResourceAiAgentPosture | null | undefined;
  // The cloud's own id of the account, to tell the agent's own targets.
  accountId?: string | undefined;
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
    gcpHost: GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
    ...getCloudAiAgentReportedChoices({
      provider: data.provider,
      accountId: data.accountId || "",
      posture: data.posture,
    }),
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

/*
 * What is wrong with the protected resources typed, if anything, so the
 * dialog says it in the reader's language before the command is written:
 * a pattern the agent cannot read, or more patterns than it takes.
 */
export type CloudAiAgentProtectedTargetsProblem =
  | { kind: "unreadable"; pattern: string }
  | { kind: "too-many"; most: number };

export function getProtectedTargetsProblem(data: {
  provider: CloudProvider;
  accountId: string;
  text: string;
}): CloudAiAgentProtectedTargetsProblem | null {
  const patterns: Array<string> = parseProtectedTargets(data.text);
  const unreadable: string | undefined = patterns.find(
    (pattern: string): boolean => {
      return !isReadableCloudAiAgentProtectedTarget(pattern);
    },
  );

  if (unreadable !== undefined) {
    return { kind: "unreadable", pattern: unreadable.slice(0, 64) };
  }

  const most: number = getCloudAiAgentMaxProtectedTargets(
    data.provider,
    data.accountId,
  );

  return patterns.length > most ? { kind: "too-many", most } : null;
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
    ...(data.provider === CloudProvider.GCP
      ? { gcpHost: data.choices.gcpHost }
      : {}),
  };
}

// A Google Cloud project id, as the commands name it (nothing a shell reads).
const GCP_PROJECT_ID_PATTERN: RegExp = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/*
 * How the agent's own logs are read in its cloud's shell: what to look at
 * when it does not connect.
 */
export function getCloudAiAgentLogsCommand(
  provider: CloudProvider,
  // Google Cloud only: what runs the agent, and the project it runs in.
  gcpHost: GcpCloudAiAgentHost = GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
  projectId?: string | undefined,
): string {
  const project: string =
    projectId && GCP_PROJECT_ID_PATTERN.test(projectId)
      ? ` --project ${projectId}`
      : "";

  switch (provider) {
    case CloudProvider.AWS:
      return `aws logs tail ${AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME} --since 30m`;
    case CloudProvider.Azure:
      return `az containerapp logs show --name ${AZURE_CLOUD_AI_AGENT_APP_NAME} --resource-group ${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP} --tail 100`;
    default:
      if (gcpHost === "compute-engine") {
        /*
         * The agent's own log, which Docker on its VM writes to Cloud
         * Logging; the VM's startup (pulling the image, reading the key)
         * is on its serial port.
         */
        return `gcloud logging read 'resource.type="gce_instance" AND jsonPayload.container.name="/${GCP_CLOUD_AI_AGENT_INSTANCE_NAME}"'${project} --freshness 30m --limit 100 --format "value(jsonPayload.data)"`;
      }

      // The service's own region, as the upgrade command finds it.
      return `gcloud run services logs read ${GCP_CLOUD_AI_AGENT_SERVICE_NAME}${project} --region "$(gcloud run services list${project} --filter "metadata.name=${GCP_CLOUD_AI_AGENT_SERVICE_NAME}" --format "value(region)" | head -1)" --limit 100`;
  }
}

// How often the dialog asks whether the agent connected, while it waits.
export const CLOUD_AI_AGENT_CONNECT_POLL_INTERVAL_MS: number = 5000;
