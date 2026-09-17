import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import LogPipelineProcessorType, {
  GrokParserConfig,
} from "../../Types/Log/LogPipelineProcessorType";
import { compileGrokPattern } from "../../Utils/Grok/Grok";

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

export function validateLogPipelineProcessor(
  candidate: LogPipelineProcessorCandidate,
): void {
  if (candidate.processorType !== LogPipelineProcessorType.GrokParser) {
    return;
  }

  const configuration: JSONObject | null = readConfiguration(
    candidate.configuration,
  );

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

  if (config.targetPrefix !== undefined && config.targetPrefix !== null) {
    if (typeof config.targetPrefix !== "string") {
      throw new BadDataException("Target prefix must be text.");
    }

    const targetPrefix: string = config.targetPrefix.trim();

    if (targetPrefix && !TARGET_PREFIX_REGEX.test(targetPrefix)) {
      throw new BadDataException(
        `"${config.targetPrefix}" is not a valid target prefix. Use letters, digits, and . _ - : @ (starting with a letter or underscore).`,
      );
    }
  }

  if (config.source !== undefined && config.source !== null) {
    if (typeof config.source !== "string") {
      throw new BadDataException("Source field must be text.");
    }
  }
}
