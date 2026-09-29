import { JSONObject } from "Common/Types/JSON";

interface ProcessorWithConfiguration {
  configuration?: unknown;
}

interface CachedConfiguration {
  raw: unknown;
  normalized: JSONObject;
}

/*
 * Pipeline processors live in the bounded project cache. Keep the parsed
 * configuration for exactly that processor's lifetime without retaining old
 * processors after their pipeline is evicted or refreshed.
 */
const configurations: WeakMap<ProcessorWithConfiguration, CachedConfiguration> =
  new WeakMap<ProcessorWithConfiguration, CachedConfiguration>();

/**
 * The UI can persist JSONB configuration as a JSON string. Parsing it for
 * every record also discards the category filters compiled onto the parsed
 * object, so both allocations and filter compilation repeat at ingest rate.
 * Reuse the parsed object until configuration is replaced. Object configs
 * retain their existing reference semantics, including in-place edits.
 */
export default function getPipelineProcessorConfig(
  processor: ProcessorWithConfiguration,
): JSONObject {
  const raw: unknown = processor.configuration;
  const cached: CachedConfiguration | undefined = configurations.get(processor);

  if (cached && cached.raw === raw) {
    return cached.normalized;
  }

  let normalized: JSONObject = {};

  if (raw && typeof raw === "object") {
    normalized = raw as JSONObject;
  } else if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        normalized = parsed as JSONObject;
      }
    } catch {
      // Preserve the existing empty-config fallback, including for bad JSON.
    }
  }

  configurations.set(processor, { raw, normalized });
  return normalized;
}
