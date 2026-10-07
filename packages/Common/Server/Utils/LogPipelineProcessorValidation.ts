import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import LogPipelineProcessorType, {
  GrokParserConfig,
  KeyValueParserConfig,
} from "../../Types/Log/LogPipelineProcessorType";
import { compileGrokPattern } from "../../Utils/Grok/Grok";
import { resolveKeyValueParserOptions } from "../../Utils/Log/KeyValueParser";

/*
 * Save-time validation for log pipeline processors.
 *
 * A processor that cannot do anything is worse than a rejected one: it
 * sits in the pipeline list looking configured while every log flows
 * past it untouched, and nothing surfaces the fact. That is exactly how
 * GrokParser behaved before it was implemented
 * (OneUptime/oneuptime#2515).
 *
 * The grok pattern is the one field where a typo is both easy and
 * invisible - `%{IPV4:client ip}` or a stray bracket compiles to
 * nothing. Compiling it here is cheap, happens once per human edit, and
 * puts the error in front of the only person who can fix it. The ingest
 * path stays defensive anyway: rows saved before this validation
 * existed still fail closed to "leave the log alone".
 *
 * The key=value parser's delimiters are the same kind of field: a pair
 * delimiter equal to the key-value delimiter, or an empty one, parses
 * every line into nothing.
 */

/*
 * Prefixes become the leading part of an attribute key, so hold them to
 * what an attribute key can sensibly be.
 */
const TARGET_PREFIX_REGEX: RegExp = /^[A-Za-z_][A-Za-z0-9_.@:-]*$/;

export interface LogPipelineProcessorCandidate {
  processorType: string | undefined | null;
  configuration: JSONObject | string | undefined | null;
}

/*
 * `configuration` is a jsonb column, but the dashboard's JSON form field
 * has historically persisted it as a JSON string literal - so both
 * shapes reach here (see LogPipelineService.normalizeProcessorConfig).
 */
function readConfiguration(
  configuration: JSONObject | string | undefined | null,
): JSONObject | null {
  if (configuration && typeof configuration === "object") {
    return configuration as JSONObject;
  }

  if (typeof configuration === "string") {
    try {
      const parsed: unknown = JSON.parse(configuration);

      if (parsed && typeof parsed === "object") {
        return parsed as JSONObject;
      }
    } catch {
      throw new BadDataException("Processor configuration is not valid JSON.");
    }
  }

  return null;
}

function validateTargetPrefix(targetPrefixValue: unknown): void {
  if (targetPrefixValue === undefined || targetPrefixValue === null) {
    return;
  }

  if (typeof targetPrefixValue !== "string") {
    throw new BadDataException("Target prefix must be text.");
  }

  const targetPrefix: string = targetPrefixValue.trim();

  if (targetPrefix && !TARGET_PREFIX_REGEX.test(targetPrefix)) {
    throw new BadDataException(
      `"${targetPrefixValue}" is not a valid target prefix. Use letters, digits, and . _ - : @ (starting with a letter or underscore).`,
    );
  }
}

function validateSource(sourceValue: unknown): void {
  if (sourceValue === undefined || sourceValue === null) {
    return;
  }

  if (typeof sourceValue !== "string") {
    throw new BadDataException("Source field must be text.");
  }
}

function validateGrokParser(
  configurationValue: JSONObject | string | undefined | null,
): void {
  const configuration: JSONObject | null =
    readConfiguration(configurationValue);

  if (!configuration) {
    throw new BadDataException(
      "A Grok Parser processor needs a configuration with a grok pattern.",
    );
  }

  const config: GrokParserConfig = configuration as unknown as GrokParserConfig;
  const pattern: string =
    typeof config.pattern === "string" ? config.pattern.trim() : "";

  if (!pattern) {
    throw new BadDataException(
      "A Grok Parser processor needs a grok pattern, for example: %{IPV4:client_ip} %{WORD:verb}",
    );
  }

  // Throws BadDataException with a message written for the person editing.
  compileGrokPattern(pattern);

  validateTargetPrefix(config.targetPrefix);
  validateSource(config.source);
}

/*
 * Every key=value setting has a working default - whitespace between
 * pairs, `=` between key and value, the log body as the source - so a
 * processor saved with no configuration at all is a working one, not a
 * silent no-op. What is checked is what the person typed.
 */
function validateKeyValueParser(
  configurationValue: JSONObject | string | undefined | null,
): void {
  const configuration: JSONObject = readConfiguration(configurationValue) || {};

  const config: KeyValueParserConfig =
    configuration as unknown as KeyValueParserConfig;

  // Throws BadDataException with a message written for the person editing.
  resolveKeyValueParserOptions({
    pairDelimiter: config.pairDelimiter,
    keyValueDelimiter: config.keyValueDelimiter,
  });

  validateTargetPrefix(config.targetPrefix);
  validateSource(config.source);

  if (
    config.overrideOnConflict !== undefined &&
    config.overrideOnConflict !== null &&
    typeof config.overrideOnConflict !== "boolean"
  ) {
    throw new BadDataException("Override on conflict must be true or false.");
  }
}

export function validateLogPipelineProcessor(
  candidate: LogPipelineProcessorCandidate,
): void {
  if (candidate.processorType === LogPipelineProcessorType.GrokParser) {
    validateGrokParser(candidate.configuration);
    return;
  }

  if (candidate.processorType === LogPipelineProcessorType.KeyValueParser) {
    validateKeyValueParser(candidate.configuration);
  }
}
