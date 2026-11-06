import {
  CloudAiAgentSetupChoices,
  getCloudAiAgentSetupOptions,
} from "./CloudAiAgentSetup";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { parseCloudAiAgentKey } from "Common/Types/CloudConnection/CloudAiAgentKey";
import {
  CloudAiAgentOrganizationSetupOptions,
  CloudAiAgentSetupOptions,
} from "Common/Types/CloudConnection/CloudAiAgentSetupCommands";
import {
  CloudOrganizationAccountKey,
  CloudOrganizationAccountView,
  CloudOrganizationAgentState,
  CloudOrganizationKeys,
  CloudOrganizationView,
} from "Common/Types/CloudConnection/CloudOrganizationAgents";
import { PluralTemplate } from "Common/Types/Translator";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * LET AI FIX PROBLEMS IN EVERY ACCOUNT OF AN AWS ORGANIZATION.
 *
 * An AWS account found by a connection that reads an AWS Organization can
 * set the Cloud AI agent up in every account of it at once: the dialog asks
 * where - this account, or every account of the organization - and for the
 * organization it asks OneUptime for a key for each account's agent (POST
 * /resource-ai-access/organization-agent-keys: each made as one account's
 * is, for the people who may make one), writes one command for the
 * management account's CloudShell (a StackSet: Types/CloudConnection/
 * CloudAiAgentSetupCommands), and lists every account with whether its
 * agent connected (POST /resource-ai-access/organization), read again every
 * few seconds while it waits.
 *
 * Import-clean on purpose, as CloudAiAgentSetup is: the suites read it
 * without a browser.
 */

export type CloudAiAgentSetupScope = "account" | "organization";

export const CLOUD_AI_AGENT_SCOPE_ACCOUNT: CloudAiAgentSetupScope = "account";
export const CLOUD_AI_AGENT_SCOPE_ORGANIZATION: CloudAiAgentSetupScope =
  "organization";

// The question, and its two answers.
export const CLOUD_AI_AGENT_SCOPE_QUESTION: string =
  translationKey("Which accounts?");
export const CLOUD_AI_AGENT_SCOPE_ACCOUNT_TITLE: string =
  translationKey("This account");
export const CLOUD_AI_AGENT_SCOPE_ACCOUNT_DESCRIPTION: string = translationKey(
  "One agent, in AWS account {{account}}.",
);
export const CLOUD_AI_AGENT_SCOPE_ORGANIZATION_TITLE: string = translationKey(
  "Every account of the organization",
);
/*
 * Two lines, as This account's answer is one: what each agent is given is
 * the command step's to say.
 */
export const CLOUD_AI_AGENT_SCOPE_ORGANIZATION_DESCRIPTION: string =
  translationKey(
    "An agent in each of its {{count}} accounts, from one command in the management account.",
  );

// The command's step, for the organization.
export const CLOUD_AI_AGENT_ORGANIZATION_STEP_TITLE: string = translationKey(
  "Run this in {{shell}}, in the management account {{account}}",
);
export const CLOUD_AI_AGENT_ORGANIZATION_STEP_DESCRIPTION: string =
  translationKey(
    "Run it as someone who may create StackSets and roles in the management account. Each account's agent gets the same least-privilege role and a key of its own.",
  );
export const CLOUD_AI_AGENT_ORGANIZATION_MAKING_KEYS_TEXT: string =
  translationKey("Making a key for each account's agent…");
export const CLOUD_AI_AGENT_ORGANIZATION_NO_KEYS_TEXT: string = translationKey(
  "OneUptime did not send the accounts' keys. Try again.",
);
export const CLOUD_AI_AGENT_ORGANIZATION_KEY_NOTE: string = translationKey(
  "The command holds a key made for each account's agent alone. Run it within a day, or open this dialog again for new ones.",
);
export const CLOUD_AI_AGENT_ORGANIZATION_SKIPPED: PluralTemplate = {
  one: "The command leaves out {{count}} account you may not edit: no key was made for its agent.",
  other:
    "The command leaves out {{count}} accounts you may not edit: no key was made for their agents.",
};
export const CLOUD_AI_AGENT_ORGANIZATION_COST_TEXT: string = translationKey(
  "It runs one small always-on container in each account: about ${{usd}} a month per account at list prices, billed by your cloud.",
);

// The waiting step, for the organization.
export const CLOUD_AI_AGENT_ORGANIZATION_WAIT_TITLE: string = translationKey(
  "Wait for them to connect",
);
export const CLOUD_AI_AGENT_ORGANIZATION_CONNECTED_COUNT: string =
  translationKey("{{connected}} of {{total}} accounts connected");
export const CLOUD_AI_AGENT_ORGANIZATION_ALL_CONNECTED: string = translationKey(
  "Every account's agent is connected. Running the command again with other choices updates them all.",
);
export const CLOUD_AI_AGENT_ORGANIZATION_TRUNCATED: string = translationKey(
  "The organization has more accounts than this list shows: the first {{count}}.",
);
export const CLOUD_AI_AGENT_ORGANIZATION_INSTANCES_TEXT: string =
  translationKey(
    "When an account does not connect, its stack says why. Run this in the management account:",
  );
export const CLOUD_AI_AGENT_ORGANIZATION_MANAGEMENT_LABEL: string =
  translationKey("Management account");
// The account the dialog was opened on, in the list: where the reader came from.
export const CLOUD_AI_AGENT_ORGANIZATION_THIS_ACCOUNT_LABEL: string =
  CLOUD_AI_AGENT_SCOPE_ACCOUNT_TITLE;

// Past this many accounts the list scrolls inside its frame; fewer show whole.
export const CLOUD_AI_AGENT_ORGANIZATION_LIST_SCROLLS_FROM: number = 8;

// Each account's agent, in words.
export const CLOUD_AI_AGENT_ORGANIZATION_STATE_WORDS: Readonly<
  Record<CloudOrganizationAgentState, string>
> = {
  connected: translationKey("Connected"),
  offline: translationKey("Offline"),
  none: translationKey("Waiting"),
};

/*
 * Whether the dialog asks which accounts: an AWS account of an
 * organization with more than this one account the reader may see.
 */
export function canSetUpCloudAiAgentOrganization(data: {
  provider: CloudProvider;
  view: CloudOrganizationView | null;
}): boolean {
  return Boolean(
    data.provider === CloudProvider.AWS &&
      data.view &&
      data.view.isOrganization &&
      data.view.managementAccountId &&
      data.view.accounts.length > 1,
  );
}

/*
 * The keys route's answer as the keys it holds: only each account's own
 * key, and only accounts of the organization the dialog is showing.
 */
export function readCloudOrganizationKeysForSetup(data: {
  keys: CloudOrganizationKeys | null;
  view: CloudOrganizationView | null;
}): CloudOrganizationKeys | null {
  if (!data.keys) {
    return null;
  }

  const known: Set<string> | null =
    data.view && data.view.isOrganization
      ? new Set<string>(
          data.view.accounts.map(
            (account: CloudOrganizationAccountView): string => {
              return account.cloudAccountId.toLowerCase();
            },
          ),
        )
      : null;

  return {
    ...data.keys,
    keys: data.keys.keys.filter((key: CloudOrganizationAccountKey): boolean => {
      const parsed: { cloudAccountId: string } | null = parseCloudAiAgentKey(
        key.agentKey,
      );

      return Boolean(
        parsed &&
          parsed.cloudAccountId === key.cloudAccountId.toLowerCase() &&
          (!known || known.has(key.cloudAccountId.toLowerCase())),
      );
    }),
  };
}

/*
 * The organization's command options: the dialog's choices, as one
 * account's command takes them, for every account with its own key.
 */
export function getCloudAiAgentOrganizationSetupOptions(data: {
  choices: CloudAiAgentSetupChoices;
  oneuptimeUrl: string;
  keys: CloudOrganizationKeys;
}): CloudAiAgentOrganizationSetupOptions {
  // One account's options, for the choices every account shares.
  const shared: CloudAiAgentSetupOptions = getCloudAiAgentSetupOptions({
    provider: CloudProvider.AWS,
    choices: data.choices,
    oneuptimeUrl: data.oneuptimeUrl,
    agentKey: "",
    cloudAccountId: "",
    accountId: "",
  });

  return {
    oneuptimeUrl: shared.oneuptimeUrl,
    fixesMode: shared.fixesMode,
    ...(shared.enabledOperations
      ? { enabledOperations: shared.enabledOperations }
      : {}),
    ...(shared.protectedTargets
      ? { protectedTargets: shared.protectedTargets }
      : {}),
    requiredTag: shared.requiredTag,
    managementAccountId: data.keys.managementAccountId,
    accounts: data.keys.keys.map(
      (
        key: CloudOrganizationAccountKey,
      ): { accountId: string; cloudAccountId: string; agentKey: string } => {
        return {
          accountId: key.accountId,
          cloudAccountId: key.cloudAccountId,
          agentKey: key.agentKey,
        };
      },
    ),
  };
}

// Whether every account the reader sees has its agent connected.
export function isEveryCloudOrganizationAgentConnected(
  view: CloudOrganizationView | null,
): boolean {
  return Boolean(
    view &&
      view.accounts.length > 0 &&
      view.accounts.every((account: CloudOrganizationAccountView): boolean => {
        return account.agent === "connected";
      }),
  );
}
