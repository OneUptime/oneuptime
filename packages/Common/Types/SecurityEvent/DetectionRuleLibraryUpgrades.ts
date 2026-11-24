/*
 * A LIBRARY RULE AS IT WAS BEFORE A FIX.
 *
 * A project's rule added from the Rule Library - one at a time, or by Turn
 * on recommended - is a copy of the library's YAML and description
 * (buildDetectionRuleFromLibrary), so a fix to a library rule reaches only
 * the rules added after it. Each entry here is a library rule's wording
 * before a fix: a project's copy that is still word for word that wording is
 * the library rule as it was added, and the data migration
 * UpgradeLibraryRuleCopies gives it the library's own (DetectionRuleLibrary
 * UpgradeCopies). A copy anyone edited is theirs, and stays as it is.
 */
export interface DetectionRuleLibraryUpgrade {
  // The library rule's Sigma id.
  id: string;
  // What the fix changed, for the server's log.
  why: string;
  // The YAML and description the library gave the rule before the fix.
  previousSigmaRuleYaml: string;
  previousDescription: string;
  /*
   * The field the library's rule grouped by before the fix, when the fix
   * moved it (#10773): a copy still grouped by it, its YAML still the
   * library's, is grouped as the library's rule is now. A copy grouped by
   * a field someone chose is theirs.
   */
  previousGroupByField?: string | undefined;
}

export const DETECTION_RULE_LIBRARY_UPGRADES: ReadonlyArray<DetectionRuleLibraryUpgrade> =
  [
    {
      id: "2917bec0-2331-4e59-bdd4-a81211529156",
      why: "Burst of access-denied API calls leaves OneUptime's own reads of a connected AWS account out (#10427)",
      previousDescription:
        "Twenty or more AWS API calls denied for one identity within ten minutes: someone probing what a stolen key can do.",
      previousSigmaRuleYaml: `title: Burst of access-denied API calls
id: 2917bec0-2331-4e59-bdd4-a81211529156
description: Many AWS API calls denied for one identity.
level: medium
tags:
  - attack.discovery
  - attack.t1580
detection:
  selection:
    errorCode:
      - AccessDenied
      - UnauthorizedOperation
      - Client.UnauthorizedOperation
  condition: selection
`,
    },
    {
      id: "7c8121cd-87ff-4e1c-bd5e-b1c3ab130737",
      why: "A sensitive bucket was made public reads a public access block taken off by CloudTrail's name for it, DeleteBucketPublicAccessBlock",
      previousDescription:
        "The policy or ACL of a bucket Data Security found sensitive data in was changed, or its public access block removed: the changes that open a bucket to the internet.",
      previousSigmaRuleYaml: `title: A sensitive bucket was made public
id: 7c8121cd-87ff-4e1c-bd5e-b1c3ab130737
description: The policy or ACL of a bucket that holds sensitive data changed, or its public access block was removed.
level: high
tags:
  - attack.collection
  - attack.t1530
detection:
  selection:
    oneuptime.signal: data-security.store-change
    oneuptime.cloud.operation:
      - s3:PutBucketPolicy
      - s3:PutBucketAcl
      - s3:DeletePublicAccessBlock
    statusName: Success
  condition: selection
`,
    },
    /*
     * #10773: the two OpenStack rules that count per address count per
     * principalIp, which names the address behind a Hash rule's token,
     * rather than the parser's own attribute, which holds real addresses
     * only - so a sign-in whose address a Hash rule hid is counted. Their
     * YAML's wording is otherwise as it was.
     */
    {
      id: "6e7a4f92-2d3b-4b31-9a55-1f0c8e7d4a10",
      why: "OpenStack failed logins burst counts a sign-in whose address a Hash scrub rule hid, per its real address (#10773)",
      previousDescription:
        "Ten or more failed sign-ins to Keystone from one address within five minutes: someone guessing passwords, or something using a password that has changed.",
      previousGroupByField: "openstack.audit.initiator_address",
      previousSigmaRuleYaml: `title: OpenStack failed logins burst
id: 6e7a4f92-2d3b-4b31-9a55-1f0c8e7d4a10
description: Many failed Keystone sign-ins from one address in a short time.
level: medium
tags:
  - attack.credential_access
  - attack.t1110
detection:
  selection:
    openstack.audit.event_type: identity.authenticate
    openstack.audit.outcome: failure
  condition: selection
`,
    },
    {
      id: "c94e1b77-8a26-4d57-b2f1-0ea3f6d81c22",
      why: "OpenStack admin credential used from a new address sees an address a Hash scrub rule hid, as its real address (#10773)",
      previousDescription:
        "The admin account was used from an address it had not used in thirty days: a sign-in, a change or a call through the audit filter. If it is not someone you know, its password is somewhere it should not be. Add your other administrators to the rule's list.",
      previousSigmaRuleYaml: `title: OpenStack admin credential used from a new address
id: c94e1b77-8a26-4d57-b2f1-0ea3f6d81c22
description: The first use of the admin account from an address in thirty days.
level: high
tags:
  - attack.initial_access
  - attack.t1078
correlation:
  type: new_value
  rules:
    - openstack_admin_used
  group-by:
    - principalUser
  timespan: 30d
  condition:
    field: openstack.audit.initiator_address
---
title: OpenStack admin account used
name: openstack_admin_used
detection:
  selection:
    openstack.audit.outcome: success
    openstack.audit.initiator_name:
      - admin
  condition: selection
`,
    },
  ];

// A YAML's lines as written: whatever its line endings, and the spaces that end its lines.
function linesOf(yaml: string): Array<string> {
  return (yaml || "")
    .split("\r\n")
    .join("\n")
    .split("\n")
    .map((line: string): string => {
      return line.trimEnd();
    })
    .join("\n")
    .trim()
    .split("\n");
}

/*
 * Whether two rules' YAML is the same as written: the same lines, in the
 * same order - whatever the line endings, the spaces at the ends of lines
 * and the blank lines around it. A rule changed in any other way is not.
 */
export function isSameRuleYaml(a: string, b: string): boolean {
  const left: Array<string> = linesOf(a);
  const right: Array<string> = linesOf(b);

  return (
    left.length === right.length &&
    left.every((line: string, index: number): boolean => {
      return line === right[index];
    })
  );
}
