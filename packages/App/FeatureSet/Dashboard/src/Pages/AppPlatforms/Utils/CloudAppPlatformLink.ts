import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import {
  CloudAppPlatformResourceKind,
  getCloudAppPlatformResourceKind,
  getCloudAppPlatformResourceName,
} from "Common/Types/Cloud/CloudAppPlatformResourceMatch";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  CloudAppKeptSiteSource,
  CloudAppPlatformEnvironment,
  fetchCloudAppPlatformCandidates,
  fetchKeptCloudAppPlatformResource,
  hasCloudAppPlatformResource,
  isAppServiceApp,
  resolveCloudAppPlatformResource,
} from "./CloudAppPlatformResource";

/*
 * AN APP'S WAY TO ITS PLATFORM'S MONITORING, OFF APP SERVICE (#6794).
 *
 * A Container App's numbers are Azure Monitor's, a Cloud Run or App Engine
 * service's Google Cloud Monitoring's, an App Runner or ECS service's
 * Amazon CloudWatch's - each read by a cloud connection of its account,
 * whatever the app sends. The app's page shows them once it finds the
 * Cloud Resource the app runs as: the one the server keeps on the app
 * (CloudApp.platformCloudResourceId, #10407) when the reader may read it,
 * else the one it finds by the same rules
 * (resolveCloudAppPlatformResource). The Setup check's row for it says
 * Connected, Not connected or Checking; with no resource found, whether
 * any connection of the app's cloud is set up says which sentence it is.
 *
 * App Service apps keep their own, longer chain (CloudAppAzureLink): a
 * site's subscription, its connection and that connection's health.
 */

export interface CloudAppPlatformLink {
  // The app's platform, as cloud.platform writes it.
  platform: string;
  provider: CloudProvider;
  // What the resource is looked up by: its service's name, an ECS task definition family.
  name: string;
  // The ECS cluster that keeps the app apart; empty elsewhere.
  cluster: string;
  // The resource the app runs as, when found.
  resource: CloudResource | null;
  /*
   * The project's connections of the app's cloud, read only when no
   * resource is found; null when they were not, or could not be, read.
   */
  connections: number | null;
}

// What the Setup check's row says of the link.
export enum CloudAppPlatformMonitorState {
  // The resource is found: its numbers are below.
  Connected = "connected",
  // No connection of the app's cloud is set up.
  NoConnection = "no-connection",
  // A connection is set up, and no resource it reads is the app's.
  NotFound = "not-found",
}

export function getCloudAppPlatformMonitorState(
  link: CloudAppPlatformLink,
): CloudAppPlatformMonitorState {
  if (link.resource) {
    return CloudAppPlatformMonitorState.Connected;
  }

  return link.connections === 0
    ? CloudAppPlatformMonitorState.NoConnection
    : CloudAppPlatformMonitorState.NotFound;
}

/*
 * Whether the app's page has a platform section other than App Service's:
 * a Container App, a Cloud Run, App Engine, App Runner or ECS service with
 * a name (and, on ECS, a cluster) to go by.
 */
export function hasCloudAppPlatformMonitor(
  app: CloudAppKeptSiteSource,
): boolean {
  return !isAppServiceApp(app) && hasCloudAppPlatformResource(app);
}

async function countConnectionsOf(provider: CloudProvider): Promise<number> {
  return await ModelAPI.count<CloudConnection>({
    modelType: CloudConnection,
    query: { provider },
  });
}

/*
 * The app's way to its platform's monitoring (see the top of this file),
 * or null for an app that has none of its own (an App Service app, an app
 * of another platform, one with no name to go by). Rejects only when the
 * resources could not be read: the Setup check then leaves its row out.
 */
export async function fetchCloudAppPlatformLink(data: {
  app: CloudAppKeptSiteSource;
  environment?: CloudAppPlatformEnvironment | null | undefined;
  // How the connections are counted: ModelAPI's, unless a test's.
  countConnections?: ((provider: CloudProvider) => Promise<number>) | undefined;
}): Promise<CloudAppPlatformLink | null> {
  const kind: CloudAppPlatformResourceKind | null =
    getCloudAppPlatformResourceKind(data.app.cloudPlatform);

  if (!kind || !hasCloudAppPlatformMonitor(data.app)) {
    return null;
  }

  const link: CloudAppPlatformLink = {
    platform: kind.platform,
    provider: kind.provider,
    name: getCloudAppPlatformResourceName(data.app),
    cluster: (data.app.groupName || "").trim(),
    resource: null,
    connections: null,
  };

  // The resource the server keeps on the app, else the one found here.
  link.resource =
    (await fetchKeptCloudAppPlatformResource(data.app)) ||
    resolveCloudAppPlatformResource({
      app: data.app,
      candidates: await fetchCloudAppPlatformCandidates(
        data.app,
        data.environment,
      ),
      environment: data.environment,
    }).site;

  if (!link.resource) {
    try {
      link.connections = await (data.countConnections || countConnectionsOf)(
        kind.provider,
      );
    } catch {
      // Unknown: the row asks for the resource, not for a connection.
      link.connections = null;
    }
  }

  return link;
}
