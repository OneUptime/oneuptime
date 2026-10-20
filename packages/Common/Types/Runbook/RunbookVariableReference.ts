import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
  replaceTemplatePlaceholders,
} from "../../Utils/TemplatePlaceholders";

/*
 * HOW A RUNBOOK STEP NAMES A RUNBOOK VARIABLE.
 *
 * A runbook variable is a value the project keeps for its runbooks: a host,
 * a namespace, a URL - or a secret, such as an SSH key, a password, a
 * kubeconfig or an API token (Models/DatabaseModels/RunbookVariable). Steps
 * name one the way a workflow names a workflow variable:
 *
 *   {{global.variables.NAME}}  - one of the project's own variables, which
 *                                every runbook in the project can use;
 *   {{local.variables.NAME}}   - one of this runbook's own variables.
 *
 * The Runner a step runs on gets the step with each reference filled in,
 * at the moment it takes the step - the step as stored keeps the reference,
 * never the value.
 *
 * Runbook secrets, which were merged into variables, were written
 * {{runbookSecrets.NAME}}. Every secret became a global variable of the same
 * name, so that spelling still reads as {{global.variables.NAME}}: a script
 * nobody has edited since keeps working.
 *
 * Read with the TemplatePlaceholders helpers - in time in line with the
 * text's length, whatever the text - and anything between braces that is not
 * a variable reference (a Go or Helm template in a heredoc, say) is left as
 * written.
 */

export enum RunbookVariableScope {
  // The project's own variables: every runbook in the project can use them.
  Global = "global",
  // A runbook's own variables: only that runbook can use them.
  Local = "local",
}

export interface RunbookVariableReference {
  scope: RunbookVariableScope;
  name: string;
}

export const RUNBOOK_VARIABLE_NAME_MAX_LENGTH: number = 100;

const GLOBAL_VARIABLE_PREFIX: string = "global.variables.";
const LOCAL_VARIABLE_PREFIX: string = "local.variables.";

// How runbook secrets were named, before they became global variables.
export const LEGACY_RUNBOOK_SECRET_PREFIX: string = "runbookSecrets.";

/*
 * Letters, digits, hyphens and underscores, as a runbook secret's name was.
 * Checked character by character rather than with a pattern, so any length
 * of text is read once.
 */
function isNameCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 || // -
    code === 95 // _
  );
}

export function isValidRunbookVariableName(name: unknown): name is string {
  if (typeof name !== "string") {
    return false;
  }

  if (name.length === 0 || name.length > RUNBOOK_VARIABLE_NAME_MAX_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < name.length; index++) {
    if (!isNameCharacter(name.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

/*
 * What a placeholder names, read from what is between its braces ("
 * global.variables.NAME ", white space around it allowed), or null when it
 * names no runbook variable.
 */
export function readRunbookVariableReference(
  inner: string,
): RunbookVariableReference | null {
  if (typeof inner !== "string") {
    return null;
  }

  const text: string = inner.trim();

  let scope: RunbookVariableScope | null = null;
  let name: string = "";

  if (text.startsWith(GLOBAL_VARIABLE_PREFIX)) {
    scope = RunbookVariableScope.Global;
    name = text.slice(GLOBAL_VARIABLE_PREFIX.length);
  } else if (text.startsWith(LOCAL_VARIABLE_PREFIX)) {
    scope = RunbookVariableScope.Local;
    name = text.slice(LOCAL_VARIABLE_PREFIX.length);
  } else if (text.startsWith(LEGACY_RUNBOOK_SECRET_PREFIX)) {
    scope = RunbookVariableScope.Global;
    name = text.slice(LEGACY_RUNBOOK_SECRET_PREFIX.length);
  }

  if (!scope || !isValidRunbookVariableName(name)) {
    return null;
  }

  return { scope, name };
}

// How a step names a variable: {{global.variables.NAME}}.
export function formatRunbookVariableReference(
  reference: RunbookVariableReference,
): string {
  return `{{${
    reference.scope === RunbookVariableScope.Local
      ? LOCAL_VARIABLE_PREFIX
      : GLOBAL_VARIABLE_PREFIX
  }${reference.name}}}`;
}

// One key per variable: "global:NAME", "local:NAME".
export function getRunbookVariableReferenceKey(
  reference: RunbookVariableReference,
): string {
  return `${reference.scope}:${reference.name}`;
}

/*
 * The variables a text names, each once, in the order it first names them.
 */
export function findRunbookVariableReferences(
  text: string | null | undefined,
): Array<RunbookVariableReference> {
  if (typeof text !== "string" || text.indexOf("{{") === -1) {
    return [];
  }

  const found: Map<string, RunbookVariableReference> = new Map<
    string,
    RunbookVariableReference
  >();

  for (const placeholder of findTemplatePlaceholders(text)) {
    const reference: RunbookVariableReference | null =
      readRunbookVariableReference((placeholder as TemplatePlaceholder).inner);

    if (!reference) {
      continue;
    }

    const key: string = getRunbookVariableReferenceKey(reference);

    if (!found.has(key)) {
      found.set(key, reference);
    }
  }

  return [...found.values()];
}

// The variables any of the texts name, each once.
export function findRunbookVariableReferencesIn(
  texts: Array<string | null | undefined>,
): Array<RunbookVariableReference> {
  const found: Map<string, RunbookVariableReference> = new Map<
    string,
    RunbookVariableReference
  >();

  for (const text of texts) {
    for (const reference of findRunbookVariableReferences(text)) {
      const key: string = getRunbookVariableReferenceKey(reference);

      if (!found.has(key)) {
        found.set(key, reference);
      }
    }
  }

  return [...found.values()];
}

/*
 * The variable a field names when the whole field is one reference - the
 * fields that take a secret (an SSH step's key or password, a kubectl step's
 * kubeconfig) hold nothing else. Null for anything else: empty, a value
 * typed in, or text around the reference.
 */
export function parseSingleRunbookVariableReference(
  text: string | null | undefined,
): RunbookVariableReference | null {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed: string = text.trim();

  if (!trimmed) {
    return null;
  }

  const placeholders: Array<TemplatePlaceholder> = findTemplatePlaceholders(
    trimmed,
    2,
  );

  if (placeholders.length !== 1) {
    return null;
  }

  const placeholder: TemplatePlaceholder = placeholders[0]!;

  if (placeholder.start !== 0 || placeholder.end !== trimmed.length) {
    return null;
  }

  return readRunbookVariableReference(placeholder.inner);
}

/*
 * The text with every variable reference that `getValue` knows replaced by
 * its value, in one pass: a value that itself holds "{{...}}" is placed as
 * it is and never read again. A reference `getValue` does not know, and any
 * placeholder that is not a variable reference, stays as written.
 */
export function replaceRunbookVariableReferences(
  text: string,
  getValue: (reference: RunbookVariableReference) => string | undefined,
): string {
  if (typeof text !== "string" || text.indexOf("{{") === -1) {
    return text;
  }

  return replaceTemplatePlaceholders(
    text,
    (placeholder: TemplatePlaceholder): string => {
      const reference: RunbookVariableReference | null =
        readRunbookVariableReference(placeholder.inner);

      if (!reference) {
        return placeholder.text;
      }

      const value: string | undefined = getValue(reference);

      return value === undefined ? placeholder.text : value;
    },
  );
}

/*
 * The text with every {{runbookSecrets.NAME}} written the way variables are,
 * {{global.variables.NEW_NAME}} - NEW_NAME being what `getName` says the
 * secret's variable is called (its own name, unless that was taken or is
 * one a variable cannot have). `getName` is asked with the name as the step
 * wrote it, whatever characters it holds: a secret made through the API
 * could have any name, and its steps still have to find its variable. Other
 * placeholders, and secrets `getName` does not know, stay as written.
 */
export function rewriteLegacyRunbookSecretReferences(
  text: string,
  getName: (secretName: string) => string | undefined,
): string {
  if (
    typeof text !== "string" ||
    text.indexOf(LEGACY_RUNBOOK_SECRET_PREFIX) === -1
  ) {
    return text;
  }

  return replaceTemplatePlaceholders(
    text,
    (placeholder: TemplatePlaceholder): string => {
      const inner: string = placeholder.inner.trim();

      if (!inner.startsWith(LEGACY_RUNBOOK_SECRET_PREFIX)) {
        return placeholder.text;
      }

      const secretName: string = inner
        .slice(LEGACY_RUNBOOK_SECRET_PREFIX.length)
        .trim();

      if (!secretName) {
        return placeholder.text;
      }

      const name: string | undefined = getName(secretName);

      if (!name || !isValidRunbookVariableName(name)) {
        return placeholder.text;
      }

      return formatRunbookVariableReference({
        scope: RunbookVariableScope.Global,
        name,
      });
    },
  );
}
