/*
 * A Mailgun sending domain, as Mailgun lists it under Sending > Domains:
 * a DNS name such as mg.example.com or example.com - two labels or more,
 * each of letters, digits and inner hyphens, at most 63 characters, the
 * whole at most 253.
 *
 * The domain is part of the API's path (POST /v3/{domain}/messages.mime), so
 * nothing else may pass: no slash, no dot-dot, no scheme, no port, no space.
 * Read one character at a time, so a value of any length is read in one
 * pass. Shared by the server (before it sends) and the forms (as they are
 * filled in).
 */
export const MAX_MAILGUN_DOMAIN_LENGTH: number = 253;

const MAX_LABEL_LENGTH: number = 63;

function isLabelCharacter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "0" && character <= "9") ||
    character === "-"
  );
}

export function isMailgunDomain(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const domain: string = value.trim().toLowerCase();

  if (!domain || domain.length > MAX_MAILGUN_DOMAIN_LENGTH) {
    return false;
  }

  const labels: Array<string> = domain.split(".");

  if (labels.length < 2) {
    return false;
  }

  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH) {
      return false;
    }

    if (label.startsWith("-") || label.endsWith("-")) {
      return false;
    }

    for (const character of label) {
      if (!isLabelCharacter(character)) {
        return false;
      }
    }
  }

  // The last label is a top-level domain: never all digits (an IP address).
  const topLevel: string = labels[labels.length - 1]!;

  for (const character of topLevel) {
    if (character < "0" || character > "9") {
      return true;
    }
  }

  return false;
}
