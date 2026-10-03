import {
  CloudEnvironmentIdentity,
  buildCloudEnvironmentName,
  parseCloudEnvironmentKey,
  ParsedCloudEnvironmentKey,
} from "../../Types/Cloud/CloudPlatform";

/*
 * A RESOURCE FOUND IN TELEMETRY IS NAMED AFTER WHAT ITS TELEMETRY REPORTS.
 *
 * Hosts, Docker and Podman hosts, Kubernetes clusters, RUM applications and
 * serverless functions are each matched to their telemetry by one value the
 * telemetry carries - host.name, the kubernetes-agent's clusterName,
 * service.name, faas.name - kept in the resource's identifier column. When
 * ingest meets a value it has no resource for, it creates one and names it
 * after that value (HostService.findOrCreateByHostIdentifier and its
 * siblings). A cloud environment is matched on its platform, account and
 * region, and named after them: "AWS ECS · us-east-1 · 123456789012"
 * (buildCloudEnvironmentName).
 *
 * A person adding one by hand gets the same name, unless they give it a
 * display name of their own. The rule lives here so the dashboard's create
 * forms - which fill the display name in as the identifier is typed - and
 * the services - which fill in a name an API caller left out - can never
 * disagree about what a resource is called.
 *
 * The other way round is never done: an identifier is never made from a
 * name. A name is free text; an identifier has to equal what the telemetry
 * reports, character for character, or the telemetry never reaches the
 * resource and ingest quietly creates a second one beside it.
 */

/**
 * The name of a resource matched by one identifier: the identifier, as
 * typed, without the spaces around it. Empty when there is no identifier.
 */
export const getNameFromIdentity: (identity: unknown) => string = (
  identity: unknown,
): string => {
  return typeof identity === "string" ? identity.trim() : "";
};

export interface CloudEnvironmentNameSource {
  cloudPlatform?: unknown;
  cloudAccountId?: unknown;
  cloudRegion?: unknown;
  /*
   * The environment key ("aws_ecs|123456789012|us-east-1"): what the name
   * is made from when the platform, account and region are not given apart.
   */
  resourceIdentifier?: unknown;
}

const readText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

/**
 * The name of a cloud environment created without one: the name ingest
 * gives it ("AWS ECS · us-east-1 · 123456789012"), from its platform,
 * account and region - or, when only its key was given, from the parts of
 * the key. The key itself when even that has no platform, and empty when
 * there is nothing to name it after.
 */
export const getCloudEnvironmentNameFromIdentity: (
  source: CloudEnvironmentNameSource,
) => string = (source: CloudEnvironmentNameSource): string => {
  const platform: string = readText(source.cloudPlatform);

  if (platform) {
    const identity: CloudEnvironmentIdentity = {
      platform: platform,
      accountId: readText(source.cloudAccountId),
      region: readText(source.cloudRegion),
    };

    return buildCloudEnvironmentName(identity);
  }

  const key: string = readText(source.resourceIdentifier);
  const parsed: ParsedCloudEnvironmentKey | null =
    parseCloudEnvironmentKey(key);

  const keyPlatform: string = parsed ? parsed.platform.trim() : "";

  if (parsed && keyPlatform) {
    return buildCloudEnvironmentName({
      platform: keyPlatform,
      accountId: parsed.accountId,
      region: parsed.region,
    });
  }

  return key;
};
