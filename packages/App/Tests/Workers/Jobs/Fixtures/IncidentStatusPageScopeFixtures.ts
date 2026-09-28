import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { withUnsubscribeToken } from "./UnsubscribeLinkFixtures";

/*
 * Shared fixtures for the status page scope cases in the incident and episode
 * subscriber job tests: ten site pages that all list one shared monitor, the
 * incident scope IncidentStatusPageScope reads back through
 * IncidentService.findBy, and subscribers that sit on more than one page.
 *
 * Each job test mocks the services itself (jest.mock is per file); these are
 * only the data and the fake implementations it plugs in.
 */

export const SHARED_MONITOR_ID: ObjectID = new ObjectID(
  "5c000000-0000-4000-8000-000000000001",
);

export const SITE_COUNT: number = 10;

export function sitePageId(site: number): ObjectID {
  return new ObjectID(
    `5b000000-0000-4000-8000-0000000000${site.toString().padStart(2, "0")}`,
  );
}

export function siteName(site: number): string {
  return `Site ${site.toString().padStart(2, "0")}`;
}

export function siteUrl(site: number): string {
  return `https://site${site.toString().padStart(2, "0")}.status.acme.com`;
}

export function allSites(): Array<number> {
  return Array.from({ length: SITE_COUNT }, (_v: unknown, i: number) => {
    return i + 1;
  });
}

// A site's status page, as getStatusPagesToSendNotification loads it.
export function sitePage(
  site: number,
  overrides?: {
    onlyShowScopedIncidents?: boolean;
    showIncidentsOnStatusPage?: boolean;
    showEpisodesOnStatusPage?: boolean;
    projectId?: ObjectID;
  },
): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = sitePageId(site).toString();
  page.projectId =
    overrides?.projectId ||
    new ObjectID("11111111-1111-4111-8111-111111111111");
  page.name = siteName(site);
  page.pageTitle = `${siteName(site)} Status`;
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage =
    overrides?.showIncidentsOnStatusPage !== false;
  page.showEpisodesOnStatusPage = overrides?.showEpisodesOnStatusPage !== false;
  page.onlyShowScopedIncidents = overrides?.onlyShowScopedIncidents === true;
  return page;
}

// The shared monitor, listed on a site's page.
export function siteResource(site: number): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = `5d000000-0000-4000-8000-0000000000${site.toString().padStart(2, "0")}`;
  resource.statusPageId = sitePageId(site);
  resource.displayName = `Checkout (${siteName(site)})`;
  return resource;
}

export function sharedMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = SHARED_MONITOR_ID.toString();
  return monitor;
}

// The ids QueryHelper.any was given (it builds a Raw IN operator).
export function idsInQueryOperator(operator: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<
      Array<string | ObjectID>
    >
  )
    .flat()
    .map((id: string | ObjectID): string => {
      return id.toString().toLowerCase();
    });
}

export interface StoredIncidentScope {
  isScopedToStatusPages: boolean;
  statusPageIds?: Array<ObjectID> | undefined;
}

/*
 * A fake of IncidentService.findBy for the scope IncidentStatusPageScope
 * reads: one row per requested incident id, unscoped unless `scopes` says
 * otherwise.
 */
export function incidentScopeFindBy(
  scopes: () => Dictionary<StoredIncidentScope>,
): (args: unknown) => Promise<Array<Incident>> {
  return async (args: unknown): Promise<Array<Incident>> => {
    const query: JSONObject = (args as { query: JSONObject }).query;

    return idsInQueryOperator(query["_id"]).map((id: string): Incident => {
      const scope: StoredIncidentScope = scopes()[id] || {
        isScopedToStatusPages: false,
      };
      const incident: Incident = new Incident();
      incident._id = id;
      incident.isScopedToStatusPages = scope.isScopedToStatusPages;
      incident.statusPages = (scope.statusPageIds || []).map(
        (statusPageId: ObjectID): StatusPage => {
          const page: StatusPage = new StatusPage();
          page._id = statusPageId.toString();
          return page;
        },
      );
      return incident;
    });
  };
}

export function scopedTo(sites: Array<number>): StoredIncidentScope {
  return {
    isScopedToStatusPages: true,
    statusPageIds: sites.map(sitePageId),
  };
}

/*
 * A fake of StatusPageSubscriberService.getStatusPagesToSendNotification
 * that, like the real one, returns only the pages asked for.
 */
export function statusPagesByIdFake(
  pages: () => Array<StatusPage>,
): (ids: unknown) => Promise<Array<StatusPage>> {
  return async (ids: unknown): Promise<Array<StatusPage>> => {
    const wanted: Array<string> = (ids as Array<ObjectID>).map(
      (id: ObjectID): string => {
        return id.toString().toLowerCase();
      },
    );

    return pages().filter((page: StatusPage): boolean => {
      return wanted.includes(page._id!.toLowerCase());
    });
  };
}

/*
 * A subscriber with a stable id per page and address, on whichever channels
 * are given. The same person on two pages is two subscriber rows with the
 * same address, as in the database.
 */
export function siteSubscriber(data: {
  site: number;
  index?: number;
  email?: string;
  phone?: string;
  webhook?: string;
  slack?: string;
  teams?: string;
}): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
  subscriber._id = `5e0000${data.site.toString().padStart(2, "0")}-0000-4000-8000-0000000000${(data.index || 0).toString().padStart(2, "0")}`;
  subscriber.statusPageId = sitePageId(data.site);
  withUnsubscribeToken(subscriber);

  if (data.email) {
    subscriber.subscriberEmail = new Email(data.email);
  }

  if (data.phone) {
    subscriber.subscriberPhone = new Phone(data.phone);
  }

  if (data.webhook) {
    subscriber.subscriberWebhook = URL.fromString(data.webhook);
  }

  if (data.slack) {
    subscriber.slackIncomingWebhookUrl = URL.fromString(data.slack);
  }

  if (data.teams) {
    subscriber.microsoftTeamsIncomingWebhookUrl = URL.fromString(data.teams);
  }

  return subscriber;
}

// A fake of getSubscribersByStatusPage serving each page its own list.
export function subscribersByPageFake(
  subscribers: () => Array<StatusPageSubscriber>,
): (statusPageId: unknown) => Promise<Array<StatusPageSubscriber>> {
  return async (
    statusPageId: unknown,
  ): Promise<Array<StatusPageSubscriber>> => {
    const id: string = (statusPageId as ObjectID).toString().toLowerCase();

    return subscribers().filter((subscriber: StatusPageSubscriber): boolean => {
      return subscriber.statusPageId?.toString().toLowerCase() === id;
    });
  };
}

// Which site a status page id belongs to, for readable assertions.
export function siteOf(statusPageId: unknown): number {
  const id: string = String(statusPageId).toLowerCase();

  const site: number | undefined = allSites().find((candidate: number) => {
    return sitePageId(candidate).toString().toLowerCase() === id;
  });

  if (site === undefined) {
    throw new Error(`Not a site page: ${id}`);
  }

  return site;
}
