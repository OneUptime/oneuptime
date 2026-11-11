import crypto from "crypto";
import {
  ManagedCloudPlatformDescriptor,
  getManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";
import { isCloudConnectionDeliveredResource } from "../../../Types/Cloud/CloudConnectionTelemetry";
import { isTrackableVersion } from "./ChangeDetection/TelemetryChangeSignals";
import { shortenEcsClusterArn } from "../../../Utils/Telemetry/CloudInstanceIdentity";

export { shortenEcsClusterArn };

/*
 * Which APP of an App Platforms environment one OTLP resource belongs to,
 * and which revision of it the resource runs - read from the resource
 * attributes the platform's detector (or the app) stamps on everything it
 * sends.
 *
 * An environment is a platform in one account and region (CloudPlatform:
 * buildCloudEnvironmentKey); an app is one service in it, named the way the
 * platform's own console names it:
 *
 *   - AWS ECS: the task definition family (aws.ecs.task.family), kept apart
 *     per cluster (aws.ecs.cluster.arn) - a family often runs in a staging
 *     and a production cluster of one account. Its revision is the task
 *     definition revision (aws.ecs.task.revision).
 *   - Google Cloud Run and App Engine: the service (faas.name, from
 *     K_SERVICE / GAE_SERVICE) and its revision or version (faas.version).
 *   - Azure Container Apps: the container app, which the Azure detectors
 *     write as service.name, and its revision, written as service.version.
 *   - Everything else: the app's service.name, kept apart per Elastic
 *     Beanstalk environment or App Service slot, with its service.version.
 *
 * Each platform's attributes are in its descriptor (MANAGED_CLOUD_PLATFORMS),
 * which the docs pages are held to. The first attribute present wins, so a
 * resource with no detector still has an app - its service.name.
 *
 * What a cloud connection delivers itself names no app
 * (isCloudConnectionDeliveredResource): its service.name is the
 * connection's telemetry service, and the rest names an AWS resource the
 * way CloudWatch does - an App Runner service, an Elastic Beanstalk
 * environment, an ECS task definition family without the cluster that
 * keeps two apps of one family apart - never an app the way its own
 * telemetry names it. An app made from it would be one named after the
 * connection, or a second row beside the app its own telemetry makes. So
 * a stream's App Runner, Beanstalk and ECS logs are their environment's
 * (OtelIngestBaseService still discovers it from their platform, account
 * and Region), and each resource's own page in Cloud has them too.
 *
 * Pure, apart from hashing the key: the ingest path (OtelIngestBaseService)
 * and the tests call it with a getter over the resource's attributes.
 */

export type CloudAppAttributeGetter = (key: string) => string | null;

// The longest name, group and revision stored (ColumnLength.ShortText).
export const CLOUD_APP_FIELD_MAX_LENGTH: number = 100;

// The longest image stored (ColumnLength.LongText).
export const CLOUD_APP_IMAGE_MAX_LENGTH: number = 500;

/*
 * The longest attribute value an app is filtered by. A longer one is still
 * the app's name (cut to fit the column), but is not used to filter its
 * telemetry: a filter value that long is not a name anyone sends.
 */
export const CLOUD_APP_ATTRIBUTE_VALUE_MAX_LENGTH: number = 1000;

/*
 * The service.name an OpenTelemetry SDK reports when nobody set one
 * ("unknown_service", "unknown_service:node"). It names no app, so a
 * resource that reports only it has none.
 */
export const UNKNOWN_SERVICE_NAME_PREFIX: string = "unknown_service";

export const ECS_CLUSTER_ARN_ATTRIBUTE: string = "aws.ecs.cluster.arn";

/*
 * The provider's own id for what the resource runs as, in the OpenTelemetry
 * semantic conventions: the Node.js and .NET Azure App Service detectors
 * set it to the site's resource id
 * (/subscriptions/.../providers/Microsoft.Web/sites/<site>). It links the
 * app to the Cloud Resource Azure Monitor reports it as.
 */
export const CLOUD_RESOURCE_ID_ATTRIBUTE: string = "cloud.resource_id";

/*
 * The longest cloud.resource_id kept. Resource ids, ARNs and full resource
 * names all fit; a longer one is not an id, and is not kept.
 */
export const CLOUD_APP_PROVIDER_RESOURCE_ID_MAX_LENGTH: number = 1024;

export interface CloudAppIdentity {
  // "checkout": the app as its platform names it.
  name: string;
  // The attribute the name was read from ("aws.ecs.task.family").
  nameAttribute: string;
  // "production": the ECS cluster or slot the app is kept apart by, if any.
  groupName: string | null;
  // The attribute the group was read from ("aws.ecs.cluster.arn").
  groupAttribute: string | null;
  /*
   * The resource attributes, as sent, the app's spans, logs and metrics
   * are filtered by: its name and its group.
   */
  telemetryAttributes: Record<string, string>;
  // A fixed-length key for the app within its environment.
  appKey: string;
  // The app's own service.name, when it reports one.
  serviceName: string | null;
  // "42": the revision this resource runs, when it reports one.
  revision: string | null;
  // The attribute the revision was read from ("aws.ecs.task.revision").
  revisionAttribute: string | null;
  // The service.version this resource reports, when trackable.
  serviceVersion: string | null;
  // "registry/checkout:1.4.2": the image the resource was started from.
  image: string | null;
  /*
   * The provider's id for the app (cloud.resource_id), when the resource
   * reports one: an App Service app's resource id.
   */
  providerResourceId: string | null;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUnknownServiceName(value: string): boolean {
  return value.toLowerCase().startsWith(UNKNOWN_SERVICE_NAME_PREFIX);
}

// The first of `keys` the resource reports, as [key, value].
function readFirst(data: {
  keys: ReadonlyArray<string>;
  getAttribute: CloudAppAttributeGetter;
  accept: (key: string, value: string) => boolean;
}): [string, string] | null {
  for (const key of data.keys) {
    const value: string = clean(data.getAttribute(key));

    if (value && data.accept(key, value)) {
      return [key, value];
    }
  }

  return null;
}

/*
 * A revision is something one deploy can be told from the next by: not
 * blank, not "latest" or "unknown" (isTrackableVersion), and short enough
 * to store.
 */
export function isTrackableRevision(value: string): boolean {
  return (
    isTrackableVersion(value) &&
    value.trim().length <= CLOUD_APP_FIELD_MAX_LENGTH
  );
}

export function buildCloudAppKey(parts: {
  nameAttribute: string;
  name: string;
  groupAttribute: string | null;
  group: string | null;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        parts.nameAttribute,
        parts.name,
        parts.groupAttribute || "",
        parts.group || "",
      ]),
    )
    .digest("hex")
    .slice(0, 40);
}

function readImage(getAttribute: CloudAppAttributeGetter): string | null {
  const name: string = clean(getAttribute("container.image.name"));

  if (!name) {
    return null;
  }

  const tag: string = clean(getAttribute("container.image.tag"));
  const image: string = tag ? `${name}:${tag}` : name;

  return image.slice(0, CLOUD_APP_IMAGE_MAX_LENGTH);
}

// cloud.resource_id as sent, trimmed; null when absent or too long to be one.
function readProviderResourceId(
  getAttribute: CloudAppAttributeGetter,
): string | null {
  const value: string = clean(getAttribute(CLOUD_RESOURCE_ID_ATTRIBUTE));

  if (!value || value.length > CLOUD_APP_PROVIDER_RESOURCE_ID_MAX_LENGTH) {
    return null;
  }

  return value;
}

/*
 * The app (and revision) a resource on `platform` belongs to, or null when
 * the platform is not a managed one, the resource names no app, or a cloud
 * connection delivered it (see the top of this file).
 */
export function resolveCloudAppIdentity(data: {
  platform: string;
  getAttribute: CloudAppAttributeGetter;
}): CloudAppIdentity | null {
  const descriptor: ManagedCloudPlatformDescriptor | null =
    getManagedCloudPlatformDescriptor(data.platform);

  if (!descriptor || isCloudConnectionDeliveredResource(data.getAttribute)) {
    return null;
  }

  const named: [string, string] | null = readFirst({
    keys: descriptor.appAttributes,
    getAttribute: data.getAttribute,
    accept: (key: string, value: string): boolean => {
      return key !== "service.name" || !isUnknownServiceName(value);
    },
  });

  if (!named) {
    return null;
  }

  const [nameAttribute, rawName] = named;

  const grouped: [string, string] | null = readFirst({
    keys: descriptor.appGroupAttributes,
    getAttribute: data.getAttribute,
    accept: (): boolean => {
      return true;
    },
  });

  const groupAttribute: string | null = grouped ? grouped[0] : null;
  const rawGroup: string | null = grouped ? grouped[1] : null;
  const groupName: string | null = rawGroup
    ? (groupAttribute === ECS_CLUSTER_ARN_ATTRIBUTE
        ? shortenEcsClusterArn(rawGroup)
        : rawGroup
      ).slice(0, CLOUD_APP_FIELD_MAX_LENGTH)
    : null;

  const telemetryAttributes: Record<string, string> = {};

  if (rawName.length <= CLOUD_APP_ATTRIBUTE_VALUE_MAX_LENGTH) {
    telemetryAttributes[nameAttribute] = rawName;
  }

  if (
    groupAttribute &&
    rawGroup &&
    rawGroup.length <= CLOUD_APP_ATTRIBUTE_VALUE_MAX_LENGTH
  ) {
    telemetryAttributes[groupAttribute] = rawGroup;
  }

  const revisioned: [string, string] | null = readFirst({
    keys: descriptor.revisionAttributes,
    getAttribute: data.getAttribute,
    accept: (_key: string, value: string): boolean => {
      return isTrackableRevision(value);
    },
  });

  const serviceName: string = clean(data.getAttribute("service.name"));
  const serviceVersion: string = clean(data.getAttribute("service.version"));

  return {
    name: rawName.slice(0, CLOUD_APP_FIELD_MAX_LENGTH),
    nameAttribute,
    groupName,
    groupAttribute,
    telemetryAttributes,
    appKey: buildCloudAppKey({
      nameAttribute,
      name: rawName,
      groupAttribute,
      group: rawGroup,
    }),
    serviceName:
      serviceName && !isUnknownServiceName(serviceName)
        ? serviceName.slice(0, CLOUD_APP_FIELD_MAX_LENGTH)
        : null,
    revision: revisioned ? revisioned[1] : null,
    revisionAttribute: revisioned ? revisioned[0] : null,
    serviceVersion: isTrackableRevision(serviceVersion) ? serviceVersion : null,
    image: readImage(data.getAttribute),
    providerResourceId: readProviderResourceId(data.getAttribute),
  };
}
