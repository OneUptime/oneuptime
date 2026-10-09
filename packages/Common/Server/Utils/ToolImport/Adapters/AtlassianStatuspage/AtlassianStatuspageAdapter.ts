import MonitorType from "../../../../../Types/Monitor/MonitorType";
import { TOOL_IMPORT_MAX_RECORDS_PER_KIND } from "../../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
  getEmptyToolImportSnapshot,
  ImportedMonitor,
  ImportedStatusPage,
  ImportedStatusPageGroup,
  ImportedStatusPageResource,
  ImportedStatusPageSubscriber,
  ToolImportSnapshot,
} from "../../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../../Types/ToolImport/ToolImportSource";
import ToolImportHttpClient from "../../ToolImportHttpClient";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  capRecords,
  cleanDescription,
  cleanEmail,
  cleanName,
  createToolImportClient,
  isListNotAvailable,
  toFatalReadError,
} from "../../ToolImportAdapterSupport";
import {
  ToolImportAdapter,
  ToolImportReadContext,
  ToolImportReadError,
  ToolImportReadSettings,
} from "../../Types";

/*
 * ATLASSIAN STATUSPAGE.
 *
 * Reads, with an API key from Statuspage (your avatar > API info > Create
 * key; only an account owner can make one, and an import never writes to
 * Statuspage), through Statuspage's REST API v1, documented at
 * https://developer.statuspage.io/:
 *
 *   GET /v1/pages                                 every page the key can see
 *   GET /v1/pages/{id}/components?page=&per_page= a page's components
 *   GET /v1/pages/{id}/component-groups?...       its component groups
 *   GET /v1/pages/{id}/subscribers?type=email&state=active&page=&limit=
 *                                                 its confirmed email subscribers
 *   GET /v1/pages/{id}/subscribers/count          how many subscribe another way
 *
 * Auth is `Authorization: OAuth <key>` against api.statuspage.io. Each key
 * may make one request a second, so reads are paced at that. Components
 * and groups are paged by `page` and `per_page` (at most 100), subscribers
 * by `page` and `limit` (at most 100); a short page is the last (see
 * readPaged for how the page number is counted).
 *
 * How Statuspage's ideas map:
 *  - A page is a status page, with its name, its description and whether
 *    only some people may see it. Its own domain and its branding are
 *    named in the preview, to set up in OneUptime.
 *  - A component is something a person sets the status of by hand: a
 *    manual monitor in OneUptime, which the page shows. Component groups
 *    are the page's groups.
 *  - Email subscribers come over (with the person's word that they may
 *    move them), following the same components. Subscribers by text
 *    message, webhook, Slack or Teams are counted and named, not moved.
 *  - Incidents and scheduled maintenances stay in Statuspage: an incident
 *    in OneUptime is a live record that pages people and feeds reports,
 *    and is not made for the past.
 */

const PAGE_SIZE: number = 100;

const KEY_ADVICE: string =
  "Check that you copied the whole key, and that it is an API key from your avatar > API info in Statuspage. Only an account owner can create one.";

// What a page's subscriber count names besides email.
const OTHER_SUBSCRIBER_TYPES: ReadonlyArray<string> = [
  "sms",
  "webhook",
  "slack",
  "teams",
  "integration_partner",
];

export interface StatuspagePageRead {
  statusPage: ImportedStatusPage;
  components: Array<ImportedMonitor>;
  subscribers: Array<ImportedStatusPageSubscriber>;
  // The page had more components, or subscribers, than one read collects.
  hasMoreComponents?: boolean | undefined;
  hasMoreSubscribers?: boolean | undefined;
}

interface PagedRead {
  records: Array<Record<string, unknown>>;
  hasMore: boolean;
}

export default class AtlassianStatuspageAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.AtlassianStatuspage;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.AtlassianStatuspage,
    );

    try {
      await context.onProgress?.(ToolImportResourceKind.StatusPage);

      const pages: Array<Record<string, unknown>> = capRecords({
        kind: ToolImportResourceKind.StatusPage,
        records: asArray(await client.getJson("/v1/pages")).map(asRecord),
        notes: snapshot.notes,
      }).filter((page: Record<string, unknown>): boolean => {
        return Boolean(asString(page["id"]));
      });

      if (pages.length === 0) {
        throw new ToolImportReadError(
          `The API key can see no Statuspage page. ${KEY_ADVICE}`,
        );
      }

      const reads: Array<StatuspagePageRead> = [];

      for (const page of pages) {
        await context.onProgress?.(ToolImportResourceKind.Monitor);
        reads.push(await this.readPage(client, page, snapshot.notes));
      }

      snapshot.accountName =
        pages.length === 1
          ? asString(pages[0]!["name"]) || undefined
          : undefined;

      snapshot.monitors = capRecords({
        kind: ToolImportResourceKind.Monitor,
        records: reads.flatMap(
          (read: StatuspagePageRead): Array<ImportedMonitor> => {
            return read.components;
          },
        ),
        notes: snapshot.notes,
        hasMore: reads.some((read: StatuspagePageRead): boolean => {
          return read.hasMoreComponents === true;
        }),
      });

      snapshot.statusPages = reads.map(
        (read: StatuspagePageRead): ImportedStatusPage => {
          return read.statusPage;
        },
      );

      snapshot.statusPageSubscribers = capRecords({
        kind: ToolImportResourceKind.StatusPageSubscriber,
        records: reads.flatMap(
          (read: StatuspagePageRead): Array<ImportedStatusPageSubscriber> => {
            return read.subscribers;
          },
        ),
        notes: snapshot.notes,
        hasMore: reads.some((read: StatuspagePageRead): boolean => {
          return read.hasMoreSubscribers === true;
        }),
      });
    } catch (error) {
      throw toFatalReadError({
        error: error,
        toolName: "Atlassian Statuspage",
        keyAdvice: KEY_ADVICE,
      });
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  private async readPage(
    client: ToolImportHttpClient,
    page: Record<string, unknown>,
    notes: Array<ToolImportNote>,
  ): Promise<StatuspagePageRead> {
    const base: string = `/v1/pages/${encodeURIComponent(asString(page["id"]))}`;

    const components: PagedRead = await this.readPaged({
      client: client,
      path: `${base}/components`,
      sizeParam: "per_page",
    });

    const groups: PagedRead = await this.readOptional(
      async (): Promise<PagedRead> => {
        return await this.readPaged({
          client: client,
          path: `${base}/component-groups`,
          sizeParam: "per_page",
        });
      },
    );

    let subscribersReadable: boolean = true;

    const subscribers: PagedRead = await this.readOptional(
      async (): Promise<PagedRead> => {
        return await this.readPaged({
          client: client,
          path: `${base}/subscribers`,
          sizeParam: "limit",
          query: { type: "email", state: "active" },
        });
      },
      (): void => {
        subscribersReadable = false;
      },
    );

    if (!subscribersReadable) {
      addNoteOnce(
        notes,
        makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
          kind: ToolImportResourceKind.StatusPageSubscriber,
        }),
      );
    }

    const counts: Record<string, unknown> = subscribersReadable
      ? asRecord(
          await this.readOptionalRecord(async (): Promise<unknown> => {
            return await client.getJson(`${base}/subscribers/count`);
          }),
        )
      : {};

    return {
      ...this.toPage({
        page: page,
        components: components.records,
        groups: groups.records,
        subscribers: subscribers.records,
        otherSubscriberCount: OTHER_SUBSCRIBER_TYPES.reduce(
          (total: number, type: string): number => {
            return total + (asNumber(counts[type]) || 0);
          },
          0,
        ),
      }),
      hasMoreComponents: components.hasMore,
      hasMoreSubscribers: subscribers.hasMore,
    };
  }

  /*
   * Every record of a list Statuspage pages, by id. Its documentation
   * calls the page number an offset without saying whether it counts from
   * 0 or 1, so the first page is asked for with no number at all (which
   * Statuspage answers with the first page) and the next ones as page 1,
   * 2 and on; a record is kept once, and a page that only repeats records
   * already read - page 1 of a list that counts from 1 - is passed over
   * once. A page shorter than the size is the last. At most
   * TOOL_IMPORT_MAX_RECORDS_PER_KIND records; `hasMore` says when there
   * were more.
   */
  private async readPaged(data: {
    client: ToolImportHttpClient;
    path: string;
    sizeParam: "per_page" | "limit";
    query?: Record<string, string> | undefined;
  }): Promise<PagedRead> {
    const records: Array<Record<string, unknown>> = [];
    const seen: Set<string> = new Set<string>();
    let repeats: number = 0;

    for (let page: number = 0; ; page++) {
      const answer: Array<Record<string, unknown>> = asArray(
        await data.client.getJson(data.path, {
          ...(data.query || {}),
          ...(page > 0 ? { page: page } : {}),
          [data.sizeParam]: PAGE_SIZE,
        }),
      ).map(asRecord);

      const fresh: Array<Record<string, unknown>> = answer.filter(
        (record: Record<string, unknown>): boolean => {
          const id: string = asString(record["id"]);

          if (!id || seen.has(id)) {
            return false;
          }

          seen.add(id);
          return true;
        },
      );

      records.push(...fresh);

      if (answer.length < PAGE_SIZE) {
        return { records: records, hasMore: false };
      }

      if (records.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        return {
          records: records.slice(0, TOOL_IMPORT_MAX_RECORDS_PER_KIND),
          hasMore: true,
        };
      }

      if (fresh.length === 0 && ++repeats > 1) {
        return { records: records, hasMore: false };
      }
    }
  }

  // A list the key may not read (402, 403, 404) is an empty one.
  private async readOptional(
    read: () => Promise<PagedRead>,
    onNotReadable?: () => void,
  ): Promise<PagedRead> {
    try {
      return await read();
    } catch (error) {
      if (isListNotAvailable(error)) {
        onNotReadable?.();
        return { records: [], hasMore: false };
      }

      throw error;
    }
  }

  private async readOptionalRecord(
    read: () => Promise<unknown>,
  ): Promise<unknown> {
    try {
      return await read();
    } catch (error) {
      if (isListNotAvailable(error)) {
        return {};
      }

      throw error;
    }
  }

  public toPage(data: {
    page: Record<string, unknown>;
    components: Array<Record<string, unknown>>;
    groups: Array<Record<string, unknown>>;
    subscribers: Array<Record<string, unknown>>;
    otherSubscriberCount: number;
  }): StatuspagePageRead {
    const page: Record<string, unknown> = data.page;
    const pageId: string = asString(page["id"]);
    const name: string = cleanName(page["name"], `Status page ${pageId}`);
    const notes: Array<ToolImportNote> = [];

    const groups: Array<ImportedStatusPageGroup> = [...data.groups]
      .sort(byPosition)
      .map((group: Record<string, unknown>): ImportedStatusPageGroup => {
        const imported: ImportedStatusPageGroup = {
          key: asString(group["id"]),
          name: cleanName(group["name"], "Components"),
        };
        const description: string | undefined = cleanDescription(
          group["description"],
        );

        if (description) {
          imported.description = description;
        }

        return imported;
      })
      .filter((group: ImportedStatusPageGroup): boolean => {
        return Boolean(group.key);
      });

    const groupKeys: Set<string> = new Set<string>(
      groups.map((group: ImportedStatusPageGroup): string => {
        return group.key;
      }),
    );

    // A group is listed among the components too: only the others are shown.
    const shown: Array<Record<string, unknown>> = [...data.components]
      .filter((component: Record<string, unknown>): boolean => {
        return (
          Boolean(asString(component["id"])) &&
          component["group"] !== true &&
          !groupKeys.has(asString(component["id"]))
        );
      })
      .sort(byPosition);

    const components: Array<ImportedMonitor> = [];
    const resources: Array<ImportedStatusPageResource> = [];

    for (const component of shown) {
      const componentId: string = asString(component["id"]);
      const componentName: string = cleanName(
        component["name"],
        `Component ${componentId}`,
      );
      const description: string | undefined = cleanDescription(
        component["description"],
      );
      const status: string = asString(component["status"]).toLowerCase();
      const monitorNotes: Array<ToolImportNote> = [];

      if (status && status !== "operational") {
        monitorNotes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorStatusNotCopied),
        );
      }

      const monitor: ImportedMonitor = {
        sourceId: componentId,
        name: componentName,
        sourceType: "component",
        monitorType: MonitorType.Manual,
        isPaused: false,
        notes: monitorNotes,
      };

      if (description) {
        monitor.description = description;
      }

      components.push(monitor);

      const groupId: string = asString(component["group_id"]);
      const showcase: boolean = component["showcase"] !== false;

      resources.push({
        key: componentId,
        monitorSourceId: componentId,
        groupKey: groupKeys.has(groupId) ? groupId : undefined,
        displayName: componentName,
        displayDescription: description,
        showUptimePercent: showcase,
        showStatusHistoryChart: showcase,
      });
    }

    const isPrivate: boolean =
      page["viewers_must_be_team_members"] === true ||
      Boolean(asString(page["ip_restrictions"]));

    if (isPrivate) {
      notes.push(makeToolImportNote(ToolImportNoteCode.StatusPagePrivate));
    }

    const domain: string = asString(page["domain"]);

    if (domain) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.StatusPageCustomDomain, {
          domain: domain,
        }),
      );
    }

    if (
      hasImage(page["favicon_logo"]) ||
      hasImage(page["transactional_logo"]) ||
      hasImage(page["hero_cover"])
    ) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.StatusPageBrandingLeftOut),
      );
    }

    if (data.otherSubscriberCount > 0) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.SubscribersLeftOut, {
          count: data.otherSubscriberCount,
        }),
      );
    }

    const subscribers: Array<ImportedStatusPageSubscriber> = [];

    for (const raw of data.subscribers) {
      const email: string | null = cleanEmail(raw["email"]);
      const sourceId: string = asString(raw["id"]);

      if (!email || !sourceId) {
        continue;
      }

      subscribers.push({
        sourceId: sourceId,
        email: email,
        statusPageSourceId: pageId,
        resourceKeys: readComponentIds(raw["components"]),
        notes: [],
      });
    }

    const statusPage: ImportedStatusPage = {
      sourceId: pageId,
      name: name,
      pageTitle: name,
      isPublic: !isPrivate,
      allowsEmailSubscribers:
        page["allow_email_subscribers"] !== false &&
        page["allow_page_subscribers"] !== false,
      allowsSubscribersToChooseResources: subscribers.some(
        (subscriber: ImportedStatusPageSubscriber): boolean => {
          return subscriber.resourceKeys.length > 0;
        },
      ),
      isHiddenFromSearchEngines: page["hidden_from_search"] === true,
      groups: groups,
      resources: resources,
      notes: notes,
    };

    const pageDescription: string | undefined = cleanDescription(
      page["page_description"] || page["headline"],
    );

    if (pageDescription) {
      statusPage.pageDescription = pageDescription;
    }

    return {
      statusPage: statusPage,
      components: components,
      subscribers: subscribers,
    };
  }
}

function byPosition(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  return (asNumber(a["position"]) || 0) - (asNumber(b["position"]) || 0);
}

// A note about the read as a whole is said once, however many pages it is true of.
function addNoteOnce(notes: Array<ToolImportNote>, note: ToolImportNote): void {
  if (
    !notes.some((existing: ToolImportNote): boolean => {
      return JSON.stringify(existing) === JSON.stringify(note);
    })
  ) {
    notes.push(note);
  }
}

/*
 * A subscriber's components, as ids: Statuspage lists them as ids, and an
 * object with an id is read the same.
 */
function readComponentIds(value: unknown): Array<string> {
  return asArray(value)
    .map((component: unknown): string => {
      return asString(component) || asString(asRecord(component)["id"]);
    })
    .filter(Boolean);
}

// Statuspage writes a page image as an object with a url, or a url, or null.
function hasImage(value: unknown): boolean {
  return Boolean(asString(value) || asString(asRecord(value)["url"]));
}
