import Dictionary from "../../Types/Dictionary";
import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
  replaceTemplatePlaceholders,
} from "../TemplatePlaceholders";
import {
  MAX_TOTP_SECRETS_PER_STEP,
  MAX_TOTP_SECRET_NAME_LENGTH,
  TotpParameters,
  TotpSecrets,
  readTotpSecrets,
} from "../Totp/TotpParameters";
import { generateTotpCode, getTotpWaitInMs } from "../Totp/TotpSecret";

export {
  MAX_TOTP_SECRETS_PER_STEP,
  MAX_TOTP_SECRET_NAME_LENGTH,
  readTotpSecrets,
};
export type { TotpSecrets };

/*
 * ONE-TIME CODES FROM MONITOR SECRETS, MADE WHERE AND WHEN A CHECK USES THEM.
 *
 * A monitor secret of the TOTP type (issue #9703) holds a site's
 * two-factor seed. Its value is never written into a monitor: the server
 * leaves each {{monitorSecrets.NAME}} that names one as written - it fills
 * in only the other secrets - and hands the probe the parameters the codes
 * are made from, beside the step (MonitorStep.totpSecrets). The probe then
 * makes the code at the moment the check uses it, from its own clock:
 *
 *   - an API monitor fills its URL, headers and body just before each
 *     attempt is sent, retries included;
 *   - a Synthetic or Custom JavaScript Code monitor fills its script just
 *     before it runs, and oneuptime.getTotpCode("NAME") makes a fresh code
 *     at the moment the script asks, for a sign-in that reaches its code
 *     prompt later in the script.
 *
 * A code about to expire is never handed out: with less than five seconds
 * of its period left (getTotpWaitInMs), the code of the next period is
 * waited for. Every code a check made is then taken out of what the check
 * reports - logs, results, errors, screenshot names - with redactTotpCodes.
 * A seed is never written anywhere a code goes.
 */

export const MONITOR_SECRETS_REFERENCE_PREFIX: string = "monitorSecrets.";

// The function a script asks a fresh code with: oneuptime.getTotpCode("NAME").
export const TOTP_CODE_FUNCTION_NAME: string = "getTotpCode";

// What stands in for a code a check made, wherever the check reports it.
export const REDACTED_TOTP_CODE: string = "[REDACTED]";

/*
 * How many times a moment is put off for a code about to expire. Once is
 * enough for secrets that share a period; the rest is for secrets of
 * different periods whose ends fall close together.
 */
const MAX_WAITS: number = 3;

const CALLS_TOTP_CODE_FUNCTION: RegExp = new RegExp(
  `\\b${TOTP_CODE_FUNCTION_NAME}\\s*\\(`,
);

const DIGITS_ONLY: RegExp = /^\d+$/;

// How deep a value is walked for codes to take out.
const MAX_REDACTION_DEPTH: number = 256;

function hasOwn(dictionary: Dictionary<string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(dictionary, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/*
 * The secret a placeholder names: the rest of "monitorSecrets.NAME" as
 * written, read the way the server reads it (VMUtil.replaceValueInPlace),
 * so {{ monitorSecrets.NAME }} is no reference here either.
 */
function getReferencedName(placeholder: TemplatePlaceholder): string | null {
  if (!placeholder.inner.startsWith(MONITOR_SECRETS_REFERENCE_PREFIX)) {
    return null;
  }

  const name: string = placeholder.inner.slice(
    MONITOR_SECRETS_REFERENCE_PREFIX.length,
  );

  return name ? name : null;
}

// The names of the secrets a text references as {{monitorSecrets.NAME}}.
export function getReferencedSecretNames(text: string): Array<string> {
  const names: Array<string> = [];

  for (const placeholder of findTemplatePlaceholders(text)) {
    const name: string | null = getReferencedName(placeholder);

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

// Whether a script asks for a code with oneuptime.getTotpCode(...).
export function callsTotpCodeFunction(script: string): boolean {
  return typeof script === "string" && CALLS_TOTP_CODE_FUNCTION.test(script);
}

/*
 * Of these names, the ones a script writes in quotes - "NAME", 'NAME' or
 * `NAME` - as oneuptime.getTotpCode("NAME") is written. The server hands a
 * script the secrets it names, never all of them.
 */
export function getQuotedNames(
  script: string,
  names: Iterable<string>,
): Array<string> {
  const quoted: Array<string> = [];

  for (const name of Array.from(names)) {
    if (
      name &&
      !quoted.includes(name) &&
      (script.includes(`"${name}"`) ||
        script.includes(`'${name}'`) ||
        script.includes(`\`${name}\``))
    ) {
      quoted.push(name);
    }
  }

  return quoted;
}

/*
 * The text with each {{monitorSecrets.NAME}} of a code given here replaced
 * by the code; every other placeholder is left as written.
 */
export function fillTotpCodes(text: string, codes: Dictionary<string>): string {
  if (typeof text !== "string" || text.indexOf("{{") === -1) {
    return text;
  }

  return replaceTemplatePlaceholders(
    text,
    (placeholder: TemplatePlaceholder): string => {
      const name: string | null = getReferencedName(placeholder);

      return name !== null && hasOwn(codes, name)
        ? (codes[name] as string)
        : placeholder.text;
    },
  );
}

/*
 * The text with every code taken out. A code is taken out only where it
 * stands as a number of its own - not inside a longer run of digits - so
 * an id or a timestamp that happens to hold the same digits is left alone.
 */
export function redactTotpCodes(
  text: string,
  codes: ReadonlyArray<string>,
): string {
  if (typeof text !== "string" || !text || codes.length === 0) {
    return text;
  }

  let redacted: string = text;

  for (const code of codes) {
    if (!DIGITS_ONLY.test(code) || redacted.indexOf(code) === -1) {
      continue;
    }

    redacted = redacted.replace(
      new RegExp(`(^|\\D)${code}(?=\\D|$)`, "g"),
      (_whole: string, before: string): string => {
        return `${before}${REDACTED_TOTP_CODE}`;
      },
    );
  }

  return redacted;
}

/*
 * A value - a script's returned data, a log, a header - with every code
 * taken out: in its strings, its object keys, and a number that is a code
 * (which becomes the redaction mark). Plain objects and arrays are copied;
 * the value given is never changed.
 */
export function redactTotpCodesInValue<T>(
  value: T,
  codes: ReadonlyArray<string>,
): T {
  if (codes.length === 0) {
    return value;
  }

  const numericCodes: Array<number> = codes.map((code: string): number => {
    return Number(code);
  });

  const redact: (item: unknown, depth: number) => unknown = (
    item: unknown,
    depth: number,
  ): unknown => {
    if (typeof item === "string") {
      return redactTotpCodes(item, codes);
    }

    if (typeof item === "number") {
      return numericCodes.includes(item) ? REDACTED_TOTP_CODE : item;
    }

    if (depth >= MAX_REDACTION_DEPTH) {
      return item;
    }

    if (Array.isArray(item)) {
      return item.map((entry: unknown): unknown => {
        return redact(entry, depth + 1);
      });
    }

    if (isPlainObject(item)) {
      const copy: Record<string, unknown> = {};

      for (const key of Object.keys(item)) {
        copy[redactTotpCodes(key, codes)] = redact(item[key], depth + 1);
      }

      return copy;
    }

    return item;
  };

  return redact(value, 0) as T;
}

// What a script's synchronous ask for a code is answered with.
export interface TotpCodeAnswer {
  code?: string | undefined;
  // The code is about to expire: ask again after this long.
  waitInMs?: number | undefined;
  error?: string | undefined;
}

export interface TotpCodeIssuerOptions {
  secrets: TotpSecrets;
  // The clock codes are made from, in milliseconds. Date.now by default.
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/*
 * The codes of one check: made on demand from the TOTP secrets its step
 * carries, never one about to expire, and each remembered so the check can
 * take them out of what it reports.
 */
export default class TotpCodeIssuer {
  private readonly secrets: Map<string, TotpParameters> = new Map();
  private readonly issuedCodes: Set<string> = new Set();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor(options: TotpCodeIssuerOptions) {
    const secrets: TotpSecrets = readTotpSecrets(options.secrets);

    for (const name of Object.keys(secrets)) {
      this.secrets.set(name, secrets[name] as TotpParameters);
    }

    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });

    this.sleep =
      options.sleep ||
      ((ms: number): Promise<void> => {
        return new Promise((resolve: () => void): void => {
          setTimeout(resolve, ms);
        });
      });
  }

  public hasSecrets(): boolean {
    return this.secrets.size > 0;
  }

  public getSecretNames(): Array<string> {
    return Array.from(this.secrets.keys());
  }

  // Every code this check has made so far.
  public getIssuedCodes(): Array<string> {
    return Array.from(this.issuedCodes);
  }

  /*
   * A fresh code for one secret, for oneuptime.getTotpCode: made now, or at
   * the start of the next period when the current code is about to expire.
   */
  public async getCode(name: unknown): Promise<string> {
    const secretName: string = this.readName(name);
    const moment: number = await this.getMoment([secretName]);

    return this.issue(secretName, moment);
  }

  /*
   * The same, answered at once: the code, or how long to wait before asking
   * again. For a script runtime that cannot wait on the host
   * (VMRunner's synchronous bridge).
   */
  public tryGetCode(name: unknown): TotpCodeAnswer {
    let secretName: string;

    try {
      secretName = this.readName(name);
    } catch (error: unknown) {
      return { error: (error as Error).message };
    }

    const moment: number = this.now();
    const waitInMs: number = getTotpWaitInMs(
      this.secrets.get(secretName) as TotpParameters,
      moment,
    );

    if (waitInMs > 0) {
      return { waitInMs };
    }

    return { code: this.issue(secretName, moment) };
  }

  /*
   * A value - a script, a URL, a request's headers and body - with every
   * {{monitorSecrets.NAME}} of a TOTP secret replaced by its code, in its
   * strings at any depth. All of the value's codes are made at one moment,
   * so a request that sends two of them sends codes of the same instant.
   */
  public async fill<T>(value: T): Promise<T> {
    const names: Array<string> = [];

    this.walkStrings(value, (text: string): string => {
      for (const name of getReferencedSecretNames(text)) {
        if (this.secrets.has(name) && !names.includes(name)) {
          names.push(name);
        }
      }

      return text;
    });

    if (names.length === 0) {
      return value;
    }

    const moment: number = await this.getMoment(names);
    const codes: Dictionary<string> = {};

    for (const name of names) {
      codes[name] = this.issue(name, moment);
    }

    return this.walkStrings(value, (text: string): string => {
      return fillTotpCodes(text, codes);
    });
  }

  // A value with every code this check made taken out.
  public redact<T>(value: T): T {
    return redactTotpCodesInValue(value, this.getIssuedCodes());
  }

  private readName(name: unknown): string {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(
        'Give oneuptime.getTotpCode the name of a one-time code secret, such as oneuptime.getTotpCode("LoginCode").',
      );
    }

    if (!this.secrets.has(name)) {
      throw new Error(
        `This monitor has no one-time code secret named "${name.slice(0, MAX_TOTP_SECRET_NAME_LENGTH)}". Check the name, that the secret's type is One-time code (TOTP), and that the secret's access lets this monitor use it.`,
      );
    }

    return name;
  }

  private issue(name: string, moment: number): string {
    const code: string = generateTotpCode(
      this.secrets.get(name) as TotpParameters,
      moment,
    );

    this.issuedCodes.add(code);

    return code;
  }

  /*
   * The moment to make the codes of these secrets at: now, unless one of
   * them is about to expire, then the start of its next period.
   */
  private async getMoment(names: Array<string>): Promise<number> {
    let moment: number = this.now();

    for (let attempt: number = 0; attempt < MAX_WAITS; attempt++) {
      let waitInMs: number = 0;

      for (const name of names) {
        waitInMs = Math.max(
          waitInMs,
          getTotpWaitInMs(this.secrets.get(name) as TotpParameters, moment),
        );
      }

      if (waitInMs === 0) {
        break;
      }

      await this.sleep(waitInMs);

      // Never before the period it waited for, even if the timer was early.
      moment = Math.max(this.now(), moment + waitInMs);
    }

    return moment;
  }

  private walkStrings<T>(value: T, visit: (text: string) => string): T {
    const walk: (item: unknown, depth: number) => unknown = (
      item: unknown,
      depth: number,
    ): unknown => {
      if (typeof item === "string") {
        return visit(item);
      }

      if (depth >= MAX_REDACTION_DEPTH) {
        return item;
      }

      if (Array.isArray(item)) {
        return item.map((entry: unknown): unknown => {
          return walk(entry, depth + 1);
        });
      }

      if (isPlainObject(item)) {
        const copy: Record<string, unknown> = {};

        for (const key of Object.keys(item)) {
          copy[key] = walk(item[key], depth + 1);
        }

        return copy;
      }

      return item;
    };

    return walk(value, 0) as T;
  }
}
