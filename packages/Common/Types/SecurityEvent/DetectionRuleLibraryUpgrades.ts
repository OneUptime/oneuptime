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
