import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { parseAzureResourceId } from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudResourceReading,
  CloudResourceReadings,
  readCloudResourceReadings,
} from "Common/Types/Cloud/CloudResourceHealth";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import {
  CloudConnectionDefinition,
  READ_INTERVAL_FIELD_KEY,
  getCloudConnectionDefinition,
  getCloudConnectionReadIntervalInMinutes,
  splitCloudConnectionList,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  CloudConnectionHealth,
  getCloudConnectionHealth,
} from "../../../Components/Cloud/Connect/CloudConnectionWords";
import {
  APP_SERVICE_SITE_TYPE,
  CloudAppKeptSiteSource,
  CloudAppPlatformEnvironment,
  CloudAppSiteMatch,
  CloudAppSiteResolution,
  CloudAppSubscription,
  CloudAppSubscriptionSource,
  fetchCloudAppSiteCandidates,
  fetchKeptCloudAppSite,
  getCloudAppSiteMatchOf,
  getCloudAppSiteName,
  getCloudAppSlotName,
  getCloudAppSubscription,
  isAppServiceApp,
  normalizeAzureSubscription,
  resolveCloudAppSite,
} from "./CloudAppPlatformResource";

/*
 * AN APP SERVICE APP'S WAY TO AZURE MONITOR (#10294).
 *
 * Azure Monitor measures every App Service site whatever the app sends -
 * its requests, response time, HTTP errors, CPU time and memory - and a
 * cloud connection that reads the site's subscription brings the site in
 * as a Cloud Resource with those numbers. An app is tied to that without
 * any setup of its own: its subscription is the one its telemetry names
 * (CloudAppPlatformResource.getCloudAppSubscription), its connection the
 * one that lists that subscription (its Cloud Account) or the site, and
 * its site the one resolveCloudAppSite finds.
 *
 * #6792 said "Not connected" whenever no site was found, and pointed at
 * Cloud > Connect - also when the subscription WAS connected and only the
 * site was not found, or found in another subscription. Now each link of
 * the chain is read, and the Setup check names the one that breaks
 * (getCloudAppAzureMonitorState): no Azure connection at all, one that
 * does not read this subscription, a connection turned off or failing, a
 * subscription the app's telemetry does not name, or a connected
 * subscription that holds no App Service app of the app's name.
 *
 * The site is the one the server keeps on the app (#10407,
 * CloudApp.platformCloudResourceId) when it keeps one the reader may read;
 * else it is looked up here, by the same rules (resolveCloudAppSite), which
 * also say why none is found.
 *
 * Read with the reader's own permissions (Cloud Resources, Cloud Accounts
 * and Cloud Connections are read by the same roles as App Platforms). The
 * site read is the one that matters: when it fails, the page cannot say
 * anything. The account and connection reads are not: when they fail, the
 * site is still shown, and the link says its connection was not checked.
 */

// The most Azure connections read: far more than a project has.
export const AZURE_CONNECTION_READ_LIMIT: number = 50;
// The most Cloud Accounts read for one subscription id (one, normally).
const ACCOUNT_READ_LIMIT: number = 10;

export interface CloudAppAzureLink {
  // The site the app runs as, by name (getCloudAppSiteName).
  siteName: string;
  /*
   * The deployment slot other than production the app runs in (#6793):
   * Azure Monitor measures it as a resource of its own, and `site` is that
   * slot (Microsoft.Web/sites/slots), never the site.
   */
  slot: string | null;
  // The subscription the app runs in, and where that was read from.
  subscription: CloudAppSubscription | null;
  // The app's site - or its slot, for an app of one - and how it was found.
  site: CloudResource | null;
  matchedBy: CloudAppSiteMatch | null;
  // Sites of the app's name in another subscription than its own.
  elsewhere: Array<CloudResource>;
  // The subscription's Cloud Account, when a connection lists it.
  account: CloudAccount | null;
  /*
   * The connection that reads the site - else the one that lists the
   * subscription, else one whose settings name it.
   */
  connection: CloudConnection | null;
  // The project's Azure connections; null when they could not be read.
  azureConnections: number | null;
  // Whether the account and connections were read: false when that failed.
  connectionsChecked: boolean;
  /*
   * How many App Service apps OneUptime holds in the subscription, when it
   * is connected and none is the app's site; null otherwise.
   */
  sitesInSubscription: number | null;
}

// Which link of the chain from the app to Azure Monitor holds, or breaks.
export enum CloudAppAzureMonitorState {
  // Its site (or slot) is found, and its connection reads it.
  Connected = "connected",
  // The project has no Azure connection.
  NoConnection = "no-connection",
  // Azure connections exist; none reads the app's subscription.
  SubscriptionNotRead = "subscription-not-read",
  // The app's telemetry names no subscription, and no site has its name.
  NoSubscription = "no-subscription",
  // The connection that reads it is turned off.
  ConnectionOff = "connection-off",
  // The connection's last read failed.
  ConnectionFailing = "connection-failing",
  // The connection has not finished its first read.
  FirstReadPending = "first-read-pending",
  // The subscription is read; no App Service app in it has the app's name.
  SiteNotFound = "site-not-found",
  // An App Service app of the app's name is in another subscription.
  SiteInOtherSubscription = "site-in-other-subscription",
  // The connections could not be read, and no site was found.
  Unknown = "unknown",
}

/*
 * Which link holds or breaks (see the top of this file), in the order the
 * chain is followed: the site (or slot) and the connection that reads it,
 * else the subscription and its connection, else whether the subscription
 * holds the site.
 */
export function getCloudAppAzureMonitorState(
  link: CloudAppAzureLink,
): CloudAppAzureMonitorState {
  const health: CloudConnectionHealth | null = link.connection
    ? getCloudConnectionHealth(link.connection)
    : null;
  const unhealthy: CloudAppAzureMonitorState | null = !health
    ? null
    : health.key === "off"
      ? CloudAppAzureMonitorState.ConnectionOff
      : health.key === "failing"
        ? CloudAppAzureMonitorState.ConnectionFailing
        : health.key === "waiting"
          ? CloudAppAzureMonitorState.FirstReadPending
          : null;

  if (link.site) {
    if (link.connection) {
      return unhealthy || CloudAppAzureMonitorState.Connected;
    }

    /*
     * A site no connection reads came from metrics something else sent
     * (an OpenTelemetry Collector's Azure Monitor receiver): it is shown,
     * and the connection it lacks is asked for - unless the connections
     * could not be read, which says nothing either way.
     */
    if (!link.connectionsChecked) {
      return CloudAppAzureMonitorState.Connected;
    }

    return link.azureConnections === 0
      ? CloudAppAzureMonitorState.NoConnection
      : CloudAppAzureMonitorState.SubscriptionNotRead;
  }

  if (!link.connectionsChecked) {
    return CloudAppAzureMonitorState.Unknown;
  }

  if (link.azureConnections === 0) {
    return CloudAppAzureMonitorState.NoConnection;
  }

  if (!link.subscription) {
    return CloudAppAzureMonitorState.NoSubscription;
  }

  if (!link.connection) {
    return CloudAppAzureMonitorState.SubscriptionNotRead;
  }

  if (unhealthy) {
    return unhealthy;
  }

  /*
   * A connection whose settings name the subscription but whose reads
   * never listed it: its app may not read it.
   */
  if (!link.account) {
    return CloudAppAzureMonitorState.SubscriptionNotRead;
  }

  return link.elsewhere.length > 0
    ? CloudAppAzureMonitorState.SiteInOtherSubscription
    : CloudAppAzureMonitorState.SiteNotFound;
}

// The subscriptions an Azure connection's settings name; empty for "every one it may read".
export function getAzureConnectionSubscriptions(
  connection: Pick<CloudConnection, "config">,
): Array<string> {
  const config: JSONObject = (connection.config as JSONObject) || {};

  return splitCloudConnectionList(config["subscriptionIds"]).map(
    (subscriptionId: string): string => {
      return normalizeAzureSubscription(subscriptionId);
    },
  );
}

/*
 * The connection that reads a subscription, among the project's Azure
 * connections: the one its Cloud Account names, else the one whose
 * settings list it. Null when none does.
 */
export function findAzureConnectionOfSubscription(data: {
  subscriptionId: string;
  account: Pick<CloudAccount, "cloudConnectionId"> | null;
  connections: ReadonlyArray<CloudConnection>;
}): CloudConnection | null {
  const accountConnectionId: string =
    data.account?.cloudConnectionId?.toString() || "";

  if (accountConnectionId) {
    const listed: CloudConnection | undefined = data.connections.find(
      (connection: CloudConnection): boolean => {
        return connection._id?.toString() === accountConnectionId;
      },
    );

    if (listed) {
      return listed;
    }
  }

  const subscription: string = normalizeAzureSubscription(data.subscriptionId);

  return (
    data.connections.find((connection: CloudConnection): boolean => {
      return getAzureConnectionSubscriptions(connection).includes(subscription);
    }) || null
  );
}

// The minutes between two reads of the connection, as its settings say.
export function getAzureConnectionReadInterval(
  connection: Pick<CloudConnection, "config" | "provider"> | null,
): number {
  const definition: CloudConnectionDefinition | undefined =
    getCloudConnectionDefinition(connection?.provider || CloudProvider.Azure);

  if (!definition) {
    return 15;
  }

  const config: JSONObject = (connection?.config as JSONObject) || {};

  return getCloudConnectionReadIntervalInMinutes(
    definition,
    config[READ_INTERVAL_FIELD_KEY],
  );
}

/*
 * When Azure Monitor last measured the site, as its connection's newest
 * reading says it - else when the connection last wrote its readings.
 * Null before its first reading.
 */
export function getAzureMonitorLatestReadingAt(
  site: Pick<CloudResource, "cloudReadings" | "cloudReadingsAt"> | null,
): Date | null {
  if (!site) {
    return null;
  }

  const readings: CloudResourceReadings = readCloudResourceReadings(
    site.cloudReadings,
  );
  let latest: number = 0;

  for (const reading of Object.values(
    readings,
  ) as Array<CloudResourceReading>) {
    const time: number = reading?.time ? new Date(reading.time).getTime() : 0;

    if (Number.isFinite(time) && time > latest) {
      latest = time;
    }
  }

  if (latest > 0) {
    return new Date(latest);
  }

  const writtenAt: number = site.cloudReadingsAt
    ? new Date(site.cloudReadingsAt).getTime()
    : 0;

  return Number.isFinite(writtenAt) && writtenAt > 0
    ? new Date(writtenAt)
    : null;
}

// What the look-up reads of each Azure connection.
const CONNECTION_SELECT: Readonly<Record<string, true>> = {
  _id: true,
  name: true,
  provider: true,
  config: true,
  isEnabled: true,
  lastPulledAt: true,
  lastSuccessfulPullAt: true,
  lastError: true,
  streamKeyCreatedAt: true,
};

async function readAzureConnections(): Promise<Array<CloudConnection>> {
  const result: { data: Array<CloudConnection> } =
    await ModelAPI.getList<CloudConnection>({
      modelType: CloudConnection,
      query: { provider: CloudProvider.Azure },
      select: CONNECTION_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: AZURE_CONNECTION_READ_LIMIT,
    });

  return result.data;
}

async function readSubscriptionAccount(
  subscriptionId: string,
): Promise<CloudAccount | null> {
  const subscription: string = normalizeAzureSubscription(subscriptionId);
  const result: { data: Array<CloudAccount> } =
    await ModelAPI.getList<CloudAccount>({
      modelType: CloudAccount,
      query: {
        provider: CloudProvider.Azure,
        accountId: new Search(subscription),
      },
      select: {
        _id: true,
        name: true,
        accountId: true,
        cloudConnectionId: true,
        inventoryListedAt: true,
      },
      sort: {},
      skip: 0,
      limit: ACCOUNT_READ_LIMIT,
    });

  // A search reads a part of the id: only the whole of it is the subscription.
  return (
    result.data.find((account: CloudAccount): boolean => {
      return normalizeAzureSubscription(account.accountId) === subscription;
    }) || null
  );
}

async function countSitesInSubscription(
  subscriptionId: string,
): Promise<number> {
  return await ModelAPI.count<CloudResource>({
    modelType: CloudResource,
    query: {
      cloudResourceKind: CloudResourceKind.Resource,
      cloudProvider: CloudProvider.Azure,
      cloudResourceType: APP_SERVICE_SITE_TYPE,
      cloudAccountId: new Search(normalizeAzureSubscription(subscriptionId)),
      isArchived: false,
    },
  });
}

/*
 * The app's way to Azure Monitor (see the top of this file), or null for
 * an app that is not on App Service or names no site. Rejects only when
 * the sites could not be read.
 */
export async function fetchCloudAppAzureLink(data: {
  app: CloudAppKeptSiteSource;
  environment?: CloudAppPlatformEnvironment | null | undefined;
}): Promise<CloudAppAzureLink | null> {
  const siteName: string = getCloudAppSiteName(data.app);

  if (!isAppServiceApp(data.app) || !siteName) {
    return null;
  }

  const slot: string | null = getCloudAppSlotName(data.app);
  const link: CloudAppAzureLink = {
    siteName,
    slot,
    subscription: getCloudAppSubscription(data),
    site: null,
    matchedBy: null,
    elsewhere: [],
    account: null,
    connection: null,
    azureConnections: null,
    connectionsChecked: false,
    sitesInSubscription: null,
  };

  // The site (or slot) the server keeps on the app, else the one found here.
  const kept: CloudResource | null = await fetchKeptCloudAppSite(data.app);

  if (kept) {
    link.site = kept;
    link.matchedBy = getCloudAppSiteMatchOf({ app: data.app, site: kept });
  } else {
    const resolution: CloudAppSiteResolution<CloudResource> =
      resolveCloudAppSite({
        app: data.app,
        candidates: await fetchCloudAppSiteCandidates(data.app),
        environment: data.environment,
      });

    link.site = resolution.site;
    link.matchedBy = resolution.matchedBy;
    link.elsewhere = resolution.elsewhere;
  }

  // Its telemetry names no subscription: the site found by its name does.
  if (!link.subscription && link.site?.providerResourceId) {
    const subscriptionId: string =
      parseAzureResourceId(link.site.providerResourceId)?.subscriptionId || "";

    if (subscriptionId) {
      link.subscription = {
        id: subscriptionId,
        source: CloudAppSubscriptionSource.Site,
      };
    }
  }

  try {
    const [connections, account]: [
      Array<CloudConnection>,
      CloudAccount | null,
    ] = await Promise.all([
      readAzureConnections(),
      link.subscription
        ? readSubscriptionAccount(link.subscription.id)
        : Promise.resolve(null),
    ]);

    link.azureConnections = connections.length;
    link.account = account;

    const siteConnectionId: string =
      link.site?.cloudConnectionId?.toString() || "";

    link.connection =
      (siteConnectionId
        ? connections.find((connection: CloudConnection): boolean => {
            return connection._id?.toString() === siteConnectionId;
          })
        : undefined) ||
      (link.subscription
        ? findAzureConnectionOfSubscription({
            subscriptionId: link.subscription.id,
            account,
            connections,
          })
        : null);

    if (!link.site && link.subscription && link.account) {
      link.sitesInSubscription = await countSitesInSubscription(
        link.subscription.id,
      );
    }

    link.connectionsChecked = true;
  } catch {
    // Not read: the site is still shown, and the link says it was not checked.
    link.connectionsChecked = false;
  }

  return link;
}
