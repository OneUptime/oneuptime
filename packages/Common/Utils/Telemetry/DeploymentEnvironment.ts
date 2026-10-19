/*
 * The deployment environment a resource reports.
 *
 * OpenTelemetry renamed `deployment.environment` to
 * `deployment.environment.name` (semantic conventions 1.27). SDKs on the
 * current conventions send only the new key and older ones only the old,
 * so a reader of one key alone loses the other half: an exception stored
 * with no environment cannot be told apart by environment, and an
 * Exceptions monitor scoped to "production" never counts it. The new key
 * is read first, as the Service row's enrichment reads it
 * (OpenTelemetryIngestService.buildServiceMetadataFromAttributes).
 */
export const DEPLOYMENT_ENVIRONMENT_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "deployment.environment.name",
  "deployment.environment",
];

/*
 * The environment from flattened attributes. `prefix` is what the keys
 * carry: "resource." on the ingest paths, which flatten a resource's
 * attributes under it. "" when neither key holds a non-blank string.
 */
export function readDeploymentEnvironment(
  attributes: Record<string, unknown> | null | undefined,
  options?: { prefix?: string | undefined },
): string {
  if (!attributes) {
    return "";
  }

  const prefix: string = options?.prefix ?? "";

  for (const key of DEPLOYMENT_ENVIRONMENT_ATTRIBUTE_KEYS) {
    const value: unknown = attributes[`${prefix}${key}`];

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return "";
}
