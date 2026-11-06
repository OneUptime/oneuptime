/*
 * An AWS Region code: two to four letter groups and a number, such as
 * us-east-1, eu-central-2 or us-gov-west-1. Read part by part, so text of
 * any length is read in one pass. Shared by the server (a connection's
 * Regions) and the dashboard (the Regions a stream is set up in).
 */
export function isAwsRegion(value: string): boolean {
  const parts: Array<string> = value.trim().toLowerCase().split("-");

  if (parts.length < 3 || parts.length > 4 || value.length > 25) {
    return false;
  }

  const number: string = parts[parts.length - 1]!;

  if (!number || number.length > 2) {
    return false;
  }

  for (const character of number) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  for (const part of parts.slice(0, -1)) {
    if (!part) {
      return false;
    }

    for (const character of part) {
      if (character < "a" || character > "z") {
        return false;
      }
    }
  }

  return true;
}
