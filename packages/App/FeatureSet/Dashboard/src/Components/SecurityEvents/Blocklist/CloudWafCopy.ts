import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the Blocklist's Cloud WAFs card (#10344): the AWS WAF web
 * ACLs the blocklist is enforced in, where each stands, Add Web ACL, Show
 * Rule, Check Again and Remove. Each is an en.json key, looked up where it
 * is drawn. Why a web ACL is not enforcing is the server's sentence, in
 * English, as a destination's reason for a block it could not apply is.
 *
 * React-free, so the words are pinned in a plain test.
 */

// ---------- The card ----------

export const CLOUD_WAFS_TITLE: string = translationKey("Cloud WAFs");

export const CLOUD_WAFS_DESCRIPTION: string = translationKey(
  "The AWS WAF web ACLs your blocklist is enforced in. OneUptime keeps its own IP sets there, holding what the blocklist blocks.",
);

export const CLOUD_WAFS_EMPTY_TITLE: string = translationKey("No web ACLs yet");

export const CLOUD_WAFS_EMPTY_DESCRIPTION: string = translationKey(
  "Add an AWS WAF web ACL of a connected AWS account, and every block on this list is enforced there.",
);

// A row is one web ACL: "Add Web ACL", "Remove Web ACL".
export const WEB_ACL_SINGULAR: string = translationKey("Web ACL");
export const WEB_ACL_PLURAL: string = translationKey("Web ACLs");
export const ADD_VERB: string = translationKey("Add");

// The columns.
export const WEB_ACL_COLUMN_TITLE: string = translationKey("Web ACL");
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
  [SecurityBlockCloudWafStatus.Failed]: translationKey("Not Enforcing"),
};

// ---------- Add Web ACL ----------

export const ADD_WEB_ACL_TITLE: string = translationKey("Add Web ACL");

export const ADD_WEB_ACL_DESCRIPTION: string = translationKey(
  "Pick a web ACL to enforce your blocklist in. OneUptime makes its IP sets and adds its rule, or waits for yours when you keep the web ACL in code.",
);

export const WEB_ACL_FIELD_TITLE: string = translationKey("Web ACL");
export const WEB_ACL_FIELD_DESCRIPTION: string = translationKey(
  "The web ACLs OneUptime read from your AWS accounts.",
);

// A web ACL in the list: "prod-alb (eu-west-1, Production)".
export const WEB_ACL_OPTION: string = translationKey(
  "{{name}} ({{where}}, {{connection}})",
);

// Why there is nothing to pick, or why some web ACLs are not listed.
export const NO_AWS_CONNECTION: string = translationKey(
  "Connect an AWS account first: its web ACLs are listed here once OneUptime has read them.",
);
export const NO_WEB_ACLS: string = translationKey(
  "OneUptime has not found a web ACL in your AWS accounts yet. Web ACLs are listed here after the next read of a connection.",
);
export const ALL_WEB_ACLS_PICKED: string = translationKey(
  "Every web ACL OneUptime found enforces your blocklist already.",
);
export const TURN_ON_BLOCKING: string = translationKey(
  "Web ACLs of {{connections}} are not listed: turn on Block addresses in AWS WAF for the connection, and run its setup command again.",
);
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

// ---------- Remove ----------

export const REMOVE_ACTION: string = translationKey("Remove");
export const REMOVE_TITLE: string = translationKey("Remove Web ACL");
export const REMOVE_DESCRIPTION: string = translationKey(
  "OneUptime takes its rule out of {{name}}, and deletes its IP sets once no other web ACL uses them. Your blocklist is then no longer enforced there.",
);
export const KEEP_IN_CLOUD_FIELD_TITLE: string = translationKey(
  "Remove From OneUptime Only",
);
export const KEEP_IN_CLOUD_FIELD_DESCRIPTION: string = translationKey(
  "Leaves OneUptime's rule and IP sets in AWS WAF, still blocking what they hold. For when OneUptime can no longer write them: delete them yourself.",
);
export const REMOVED_TOAST: string = translationKey(
  "{{name}} no longer enforces your blocklist.",
);

// What stays in AWS WAF once a web ACL is removed, for the person to delete.
export const LEFT_IN_CLOUD_TITLE: string = translationKey("Left in AWS WAF");
export const LEFT_IN_CLOUD_DESCRIPTION: string = translationKey(
  "{{name}} no longer enforces your blocklist, and OneUptime left these in AWS WAF. They keep blocking what they hold until you delete them there.",
);
export const LEFT_IN_CLOUD_ITEMS: Record<
  SecurityBlockCloudWafLeftKind,
  string
> = {
  [SecurityBlockCloudWafLeftKind.Rule]: translationKey(
    "Rule {{name}} in {{webAcl}}",
  ),
  [SecurityBlockCloudWafLeftKind.IpSet]: translationKey("IP set {{name}}"),
};

export const CLOUD_WAF_TEST_IDS: {
  webAclCell: string;
  statusCell: string;
  statusMessage: string;
  addNote: string;
  ruleCode: string;
  leftInCloud: string;
} = {
  webAclCell: "cloud-waf-web-acl",
  statusCell: "cloud-waf-status",
  statusMessage: "cloud-waf-status-message",
  addNote: "cloud-waf-add-note",
  ruleCode: "cloud-waf-rule-code",
  leftInCloud: "cloud-waf-left-in-cloud",
};
