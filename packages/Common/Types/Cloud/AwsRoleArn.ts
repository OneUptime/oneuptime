/*
 * AN IAM ROLE ARN: arn:<partition>:iam::<12 digits>:role/<path and name>.
 *
 * Checked piece by piece rather than with one pattern. Read by a cloud
 * connection's role (CloudConnectionPaste re-exports it) and by a project's
 * Amazon SES role (#7378), whose form also checks it on the page - so it
 * imports nothing, and stays out of the cloud catalog's weight there.
 */

// A letter of the English alphabet or a digit.
function isLetterOrDigit(character: string): boolean {
  const code: number = character.charCodeAt(0);

  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

export function isAwsRoleArn(value: string): boolean {
  const parts: Array<string> = value.split(":");

  if (parts.length !== 6 || parts[0] !== "arn" || parts[2] !== "iam") {
    return false;
  }

  const partition: string = parts[1]!;
  const accountId: string = parts[4]!;
  const resource: string = parts[5]!;

  if (
    partition !== "aws" &&
    partition !== "aws-us-gov" &&
    partition !== "aws-cn"
  ) {
    return false;
  }

  if (parts[3] !== "" || accountId.length !== 12) {
    return false;
  }

  for (const character of accountId) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  if (!resource.startsWith("role/") || resource.length <= 5) {
    return false;
  }

  // IAM names and paths: letters, digits and +=,.@_-/ - at most 512 long.
  if (resource.length > 517) {
    return false;
  }

  for (const character of resource.slice(5)) {
    if (!isLetterOrDigit(character) && !"+=,.@_-/".includes(character)) {
      return false;
    }
  }

  return !resource.endsWith("/");
}

// The 12-digit account a role ARN names, or "" for anything that is not one.
export function getAwsRoleArnAccount(value: string): string {
  return isAwsRoleArn(value.trim()) ? value.trim().split(":")[4] || "" : "";
}
