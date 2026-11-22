import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the Blocklist's Cloud WAFs card: the AWS WAF web ACLs
 * (#10344), Azure WAF policies (#10348) and Cloud Armor policies (#10349)
 * the blocklist is enforced in, where each stands, Add WAF with its access
 * check, Show Rule, Check Again, Put It Back, Client Address and Remove.
 * Each is an en.json key, looked up where it is drawn. Why an Azure or
 * Cloud Armor policy is not enforcing is a reason worded in the reader's
 * language (#10629); an AWS web ACL's is still the server's English.
 *
 * React-free, so the words are pinned in a plain test.
 */

// ---------- The card ----------

export const CLOUD_WAFS_TITLE: string = translationKey("Cloud WAFs");

export const CLOUD_WAFS_DESCRIPTION: string = translationKey(
  "The AWS WAF, Azure WAF and Cloud Armor policies your blocklist is enforced in. OneUptime keeps its own rules in each, holding what the blocklist blocks.",
);

export const CLOUD_WAFS_EMPTY_TITLE: string =
  translationKey("No cloud WAFs yet");

export const CLOUD_WAFS_EMPTY_DESCRIPTION: string = translationKey(
  "Add a WAF of a connected AWS, Azure or Google Cloud account, and every block on this list is enforced there.",
);

// A row is one WAF: "Add WAF", "Remove WAF".
export const WAF_SINGULAR: string = translationKey("WAF");
export const WAF_PLURAL: string = translationKey("WAFs");
export const ADD_VERB: string = translationKey("Add");

// The columns.
export const WAF_COLUMN_TITLE: string = translationKey("WAF");

// Where an Azure WAF policy or a Cloud Armor policy is, under its name.
export const AZURE_WAF_WHERE: string = translationKey(
  "{{kind}}, resource group {{group}}",
);
// {{place}} is the policy's location as Google Cloud names it: a region, or "global".
export const CLOUD_ARMOR_WHERE: string = translationKey(
  "Cloud Armor, {{place}}, project {{project}}",
);

// The location of a global policy, as Google Cloud writes it in every language (locations/global).
export const CLOUD_ARMOR_GLOBAL_LOCATION: string = "global";

// Its page in its cloud's console, beside its name.
export const OPEN_IN_CONSOLE: string = translationKey("Open in console");
export const CLIENT_ADDRESS_COLUMN_TITLE: string =
  translationKey("Client Address");
export const STATUS_COLUMN_TITLE: string = translationKey("Status");
export const CHECKED_COLUMN_TITLE: string = translationKey("Checked");

// Where a web ACL is, under its name: its Region, or CloudFront.
export const WEB_ACL_WHERE: string = translationKey(
  "{{where}}, account {{account}}",
);

// ---------- Where the client's address is read ----------

export const CLIENT_ADDRESS_FIELD_TITLE: string =
  translationKey("Client Address");
export const CLIENT_ADDRESS_FIELD_DESCRIPTION: string = translationKey(
  "Where AWS WAF reads the address a block is matched against. Behind another proxy or CDN, read the header that proxy sets instead.",
);

// The same question for the other clouds, in their own terms.
export const FRONT_DOOR_CLIENT_ADDRESS_DESCRIPTION: string = translationKey(
  "Where Front Door matches a block. Pick the original client only when another proxy or CDN in front of Front Door writes X-Forwarded-For.",
);
export const CLOUD_ARMOR_CLIENT_ADDRESS_DESCRIPTION: string = translationKey(
  "Where Cloud Armor matches a block. Pick the user IP only when the policy sets user IP request headers that a proxy in front of it writes.",
);

export const CLIENT_ADDRESS_LABELS: Record<SecurityBlockClientAddress, string> =
  {
    [SecurityBlockClientAddress.SourceIp]: translationKey(
      "The request's source address",
    ),
    [SecurityBlockClientAddress.XForwardedFor]: translationKey(
      "The last address in the {{header}} header",
    ),
    [SecurityBlockClientAddress.CfConnectingIp]: translationKey(
      "The {{header}} header",
    ),
    [SecurityBlockClientAddress.TrueClientIp]: translationKey(
      "The {{header}} header",
    ),
    [SecurityBlockClientAddress.ForwardedClient]: translationKey(
      "The original client, from X-Forwarded-For (RemoteAddr)",
    ),
    [SecurityBlockClientAddress.UserIp]: translationKey(
      "The user IP from the policy's request headers (origin.user_ip)",
    ),
  };

// What the source address is called where each cloud reads it.
export const SOURCE_ADDRESS_LABELS: {
  frontDoor: string;
  applicationGateway: string;
  cloudArmor: string;
} = {
  frontDoor: translationKey(
    "The address that connected to Front Door (SocketAddr)",
  ),
  applicationGateway: translationKey(
    "The address that connected to the gateway (RemoteAddr)",
  ),
  cloudArmor: translationKey(
    "The address that connected to the load balancer (origin.ip)",
  ),
};

// ---------- Where a web ACL stands ----------

export const CLOUD_WAF_STATUS_LABELS: Record<
  SecurityBlockCloudWafStatus,
  string
> = {
  [SecurityBlockCloudWafStatus.Checking]: translationKey("Checking"),
  [SecurityBlockCloudWafStatus.Enforcing]: translationKey("Enforcing"),
  [SecurityBlockCloudWafStatus.WaitingForRule]: translationKey(
    "Waiting for Your Rule",
  ),
  [SecurityBlockCloudWafStatus.NoFreePriority]:
    translationKey("No Free Priority"),
  [SecurityBlockCloudWafStatus.Applying]: translationKey("Applying"),
  [SecurityBlockCloudWafStatus.Drifted]: translationKey("Changed by Hand"),
  [SecurityBlockCloudWafStatus.Failed]: translationKey("Not Enforcing"),
};

// ---------- Add WAF ----------

export const ADD_WAF_TITLE: string = translationKey("Add WAF");

export const ADD_WAF_DESCRIPTION: string = translationKey(
  "Pick a WAF to enforce your blocklist in. OneUptime keeps its own rules there, before your first rule that allows traffic, and never changes yours.",
);

export const WAF_FIELD_TITLE: string = translationKey("WAF");
export const WAF_FIELD_DESCRIPTION: string = translationKey(
  "The web ACLs, Azure WAF policies and Cloud Armor policies OneUptime read from your cloud accounts.",
);

// A WAF in the list: "prod-alb (eu-west-1, Production)", "prod-waf (Front Door, Production Azure)".
export const WEB_ACL_OPTION: string = translationKey(
  "{{name}} ({{where}}, {{connection}})",
);

// Why there is nothing to pick, or why some WAFs are not listed.
export const NO_CLOUD_CONNECTION: string = translationKey(
  "Connect an AWS, Azure or Google Cloud account first: its WAFs are listed here once OneUptime has read them.",
);
export const NO_WAFS: string = translationKey(
  "OneUptime has not found a WAF in your cloud accounts yet. WAFs are listed here after the next read of a connection.",
);
export const ALL_WAFS_PICKED: string = translationKey(
  "Every WAF OneUptime found enforces your blocklist already.",
);
export const TURN_ON_BLOCKING: string = translationKey(
  "Web ACLs of {{connections}} are not listed: turn on Block addresses in AWS WAF for the connection, and run its setup command again.",
);
export const TURN_ON_POLICY_BLOCKING: string = translationKey(
  "The WAF policies of {{connections}} are not listed: turn on Block addresses in Azure WAF or Block addresses in Cloud Armor for the connection, under More fields.",
);

// ---------- Whether the connection may write a policy ----------

export const ACCESS_CHECKING: string = translationKey(
  "Checking whether the connection may write {{name}}…",
);
export const ACCESS_GRANTED: string = translationKey(
  "The connection may read and write {{name}}.",
);
export const ACCESS_MISSING: string = translationKey(
  "The connection may not write {{name}} yet. Run these lines in {{shell}}, then select Check Again.",
);
export const ACCESS_COULD_NOT_CHECK: string = translationKey(
  "OneUptime could not ask your cloud what the connection may do.",
);
export const ACCESS_CHECK_AGAIN: string = translationKey("Check Again");
export const ACCESS_PERMISSION_GRANTED: string = translationKey("Granted");
export const ACCESS_PERMISSION_MISSING: string = translationKey("Missing");
export const ACCESS_NEEDED_TO_ADD: string = translationKey(
  "Grant the connection access first: run the lines above, then select Check Again.",
);
export const AZURE_CLOUD_SHELL: string = "Azure Cloud Shell";
export const GOOGLE_CLOUD_SHELL: string = "Google Cloud Shell";
export const WEB_ACLS_NOT_READ: string = translationKey(
  "Some web ACLs are not listed: OneUptime has seen only their metrics. Run their connection's setup command again so OneUptime may read them.",
);
export const OPEN_CLOUD_CONNECTIONS: string =
  translationKey("Cloud Connections");

export const ADDED_TOAST: string = translationKey(
  "{{name}} now enforces your blocklist.",
);
export const ADDED_NOT_ENFORCING_TOAST: string = translationKey(
  "{{name}} is added. It does not enforce your blocklist yet: its status says why.",
);

// ---------- Show Rule ----------

export const SHOW_RULE_ACTION: string = translationKey("Show Rule");
export const RULE_TITLE: string = translationKey("OneUptime's Rule");
export const RULE_ADDED_DESCRIPTION: string = translationKey(
  "OneUptime added these two rules to {{name}}, below your first rule, and keeps them there. They block and challenge the addresses in its IP sets.",
);
export const RULE_IN_CODE_DESCRIPTION: string = translationKey(
  "Add these two rules to {{name}} in your code, before your other rules. OneUptime enforces its blocks there once it finds them in the web ACL.",
);
export const RULE_SETS_NOT_MADE: string = translationKey(
  "OneUptime has not made its IP sets yet. Check Again makes them, and the rule then names each.",
);
export const RULE_TABS_LABEL: string = translationKey(
  "OneUptime's rule, as code",
);

// ---------- Check Again ----------

export const CHECK_AGAIN_ACTION: string = translationKey("Check Again");
export const CHECKED_TOAST: string = translationKey("{{name}} is checked.");

// ---------- Put It Back ----------

export const PUT_IT_BACK_ACTION: string = translationKey("Put It Back");
export const PUT_BACK_TOAST: string = translationKey(
  "OneUptime's rules are back in {{name}}.",
);

// ---------- Where the client's address is read, changed ----------

export const CHANGE_CLIENT_ADDRESS_ACTION: string =
  translationKey("Client Address");
export const CHANGE_CLIENT_ADDRESS_TITLE: string = translationKey(
  "Change Client Address",
);
export const CHANGED_CLIENT_ADDRESS_TOAST: string = translationKey(
  "Where {{name}} reads the client's address is changed. OneUptime writes its rules again.",
);

// ---------- Remove ----------

export const REMOVE_ACTION: string = translationKey("Remove");
export const REMOVE_TITLE: string = translationKey("Remove WAF");
export const REMOVE_DESCRIPTION: string = translationKey(
  "OneUptime takes its rule out of {{name}}, and deletes its IP sets once no other web ACL uses them. Your blocklist is then no longer enforced there.",
);
export const REMOVE_AZURE_DESCRIPTION: string = translationKey(
  "OneUptime takes its rules out of {{name}} and changes nothing else in it. Your blocklist is then no longer enforced there.",
);
export const REMOVE_CLOUD_ARMOR_DESCRIPTION: string = translationKey(
  "OneUptime takes its rules out of {{name}}, and deletes its address groups once no other policy uses them. Your blocklist is no longer enforced there.",
);
export const KEEP_IN_CLOUD_FIELD_TITLE: string = translationKey(
  "Remove From OneUptime Only",
);
export const KEEP_IN_CLOUD_FIELD_DESCRIPTION: string = translationKey(
  "Leaves OneUptime's rule and IP sets in AWS WAF, still blocking what they hold. For when OneUptime can no longer write them: delete them yourself.",
);
export const KEEP_IN_POLICY_FIELD_DESCRIPTION: string = translationKey(
  "Leaves OneUptime's rules in the policy, still blocking what they hold. For when OneUptime may no longer write it: delete them there yourself.",
);
export const REMOVED_TOAST: string = translationKey(
  "{{name}} no longer enforces your blocklist.",
);

// What stays in the cloud once a WAF is removed, for the person to delete.
export const LEFT_IN_CLOUD_TITLE: string = translationKey("Left in AWS WAF");
export const LEFT_IN_AZURE_TITLE: string = translationKey("Left in Azure WAF");
export const LEFT_IN_CLOUD_ARMOR_TITLE: string = translationKey(
  "Left in Cloud Armor",
);
export const LEFT_IN_CLOUD_DESCRIPTION: string = translationKey(
  "{{name}} no longer enforces your blocklist, and OneUptime left these in AWS WAF. They keep blocking what they hold until you delete them there.",
);
export const LEFT_IN_POLICY_DESCRIPTION: string = translationKey(
  "{{name}} no longer enforces your blocklist, and OneUptime left these behind. They keep blocking what they hold until you delete them there.",
);
export const LEFT_IN_CLOUD_ITEMS: Record<
  SecurityBlockCloudWafLeftKind,
  string
> = {
  [SecurityBlockCloudWafLeftKind.Rule]: translationKey(
    "Rule {{name}} in {{webAcl}}",
  ),
  [SecurityBlockCloudWafLeftKind.IpSet]: translationKey("IP set {{name}}"),
  [SecurityBlockCloudWafLeftKind.PriorityRule]: translationKey(
    "The rule at priority {{priority}} in {{webAcl}}",
  ),
  [SecurityBlockCloudWafLeftKind.AddressGroup]: translationKey(
    "Address group {{name}}",
  ),
};

export const CLOUD_WAF_TEST_IDS: {
  webAclCell: string;
  statusCell: string;
  statusMessage: string;
  addNote: string;
  ruleCode: string;
  leftInCloud: string;
  access: string;
  accessCommand: string;
  accessCheck: string;
} = {
  webAclCell: "cloud-waf-web-acl",
  statusCell: "cloud-waf-status",
  statusMessage: "cloud-waf-status-message",
  addNote: "cloud-waf-add-note",
  ruleCode: "cloud-waf-rule-code",
  leftInCloud: "cloud-waf-left-in-cloud",
  access: "cloud-waf-access",
  accessCommand: "cloud-waf-access-command",
  accessCheck: "cloud-waf-access-check",
};
