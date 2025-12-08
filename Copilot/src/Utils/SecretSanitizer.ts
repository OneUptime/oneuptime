const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  {
    regex: /sk-[a-zA-Z0-9_-]{16,}/g,
    replacement: "[REDACTED-OPENAI-KEY]",
  },
];

/** Masks known secret patterns so we never expose raw credentials to the LLM. */
export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }

  return SECRET_PATTERNS.reduce((sanitized: string, pattern) => {
    return sanitized.replace(pattern.regex, pattern.replacement);
  }, text);
}
