/*
 * Pure (React-free) validation helpers for JSONArgumentInput.
 *
 * Workflow JSON arguments may contain {{ variable }} tokens that are filled
 * in at runtime and are therefore not literal JSON. These helpers validate
 * the editor content while treating those tokens as valid placeholders, so
 * syntax mistakes are caught while editing rather than surfacing as a cryptic
 * runtime error (see App/FeatureSet/Workflow/Services/RunWorkflow.ts).
 *
 * Kept free of React/Monaco imports so it can be unit-tested directly.
 */

export type ValidationStatus =
  | "empty"
  | "valid"
  | "invalid"
  | "variable"
  | "template";

export interface ValidationResult {
  status: ValidationStatus;
  message?: string | undefined;
  // Does the content contain at least one {{ token }} (but still parses)?
  hasVariables: boolean;
}

// Matches a single {{ ... }} token.
export const TOKEN_REGEX: RegExp = /\{\{(.*?)\}\}/g;

// Matches {{#each}} / {{/each}} block helpers, which can't be validated statically.
const BLOCK_HELPER_REGEX: RegExp = /\{\{\s*[#/]/;

// Matches content that is exactly one {{ variable }} token.
const SINGLE_TOKEN_REGEX: RegExp = /^\{\{[^{}]*\}\}$/;

export type ContainsTokenFunction = (raw: string) => boolean;

export const containsToken: ContainsTokenFunction = (raw: string): boolean => {
  TOKEN_REGEX.lastIndex = 0;
  return TOKEN_REGEX.test(raw);
};

export type ValidateJsonFunction = (raw: string) => ValidationResult;

/*
 * Validate the raw editor content as JSON, treating {{ tokens }} as valid
 * placeholders. We mask each token with `0` (a value that is valid both on
 * its own and inside a string) before parsing, mirroring how the runtime
 * substitutes a real value in its place.
 */
export const validateJson: ValidateJsonFunction = (
  raw: string,
): ValidationResult => {
  const trimmed: string = (raw || "").trim();

  if (!trimmed) {
    return { status: "empty", hasVariables: false };
  }

  // Block helpers like {{#each …}} / {{/each}} can't be validated statically.
  if (BLOCK_HELPER_REGEX.test(trimmed)) {
    return {
      status: "template",
      message: "Uses template logic — checked when the workflow runs.",
      hasVariables: true,
    };
  }

  // The whole field is a single variable reference — nothing to parse.
  if (SINGLE_TOKEN_REGEX.test(trimmed)) {
    return {
      status: "variable",
      message: "References a variable — resolved when the workflow runs.",
      hasVariables: true,
    };
  }

  const hasVariables: boolean = containsToken(trimmed);
  const masked: string = trimmed.replace(TOKEN_REGEX, "0");

  try {
    JSON.parse(masked);
    return { status: "valid", hasVariables: hasVariables };
  } catch (err: unknown) {
    const message: string =
      err instanceof Error ? err.message : "Unexpected error.";
    return {
      status: "invalid",
      message: message,
      hasVariables: hasVariables,
    };
  }
};
