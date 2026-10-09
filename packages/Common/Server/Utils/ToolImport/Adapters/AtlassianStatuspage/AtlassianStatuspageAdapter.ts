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
 * and groups are paged by `page` (from 1) and `per_page` (at most 100),
 * subscribers by `page` (from 0) and `limit` (at most 100); a short page is
 * the last.
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

    const components: Array<Record<string, unknown>> = await this.readPaged({
      client: client,
      path: `${base}/components`,
      firstPage: 1,
      sizeParam: "per_page",
    });

    const groups: Array<Record<string, unknown>> = await this.readOptional(
      async (): Promise<Array<Record<string, unknown>>> => {
        return await this.readPaged({
          client: client,
          path: `${base}/component-groups`,
          firstPage: 1,
          sizeParam: "per_page",
        });
      },
    );

    let subscribersReadable: boolean = true;

    const subscribers: Array<Record<string, unknown>> = await this.readOptional(
      async (): Promise<Array<Record<string, unknown>>> => {
        return await this.readPaged({
          client: client,
          path: `${base}/subscribers`,
          firstPage: 0,
          sizeParam: "limit",
          query: { type: "email", state: "active" },
        });
      },
      (): void => {
        subscribersReadable = false;
      },
    );

    if (!subscribersReadable) {
      const note: ToolImportNote = makeToolImportNote(
        ToolImportNoteCode.CouldNotRead,
        { kind: ToolImportResourceKind.StatusPageSubscriber },
      );

      if (
        !notes.some((existing: ToolImportNote): boolean => {
          return JSON.stringify(existing) === JSON.stringify(note);
        })
      ) {
        notes.push(note);
      }
    }

    const counts: Record<string, unknown> = subscribersReadable
      ? asRecord(
          await this.readOptionalRecord(async (): Promise<unknown> => {
            return await client.getJson(`${base}/subscribers/count`);
          }),
        )
      : {};

    return this.toPage({
      page: page,
      components: components,
      groups: groups,
      subscribers: subscribers,
      otherSubscriberCount: OTHER_SUBSCRIBER_TYPES.reduce(
        (total: number, type: string): number => {
          return total + (asNumber(counts[type]) || 0);
        },
        0,
      ),
    });
  }

  /*
   * Every record of a list Statuspage pages: the page number (from 0 or 1,
   * as the list counts) and a size in, an array out. A page shorter than
   * the size is the last, as is one that comes back as the page before
   * did.
   */
  private async readPaged(data: {
    client: ToolImportHttpClient;
    path: string;
    firstPage: number;
    sizeParam: "per_page" | "limit";
    query?: Record<string, string> | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    const records: Array<Record<string, unknown>> = [];
    let previousFirstId: string | null = null;

    for (let page: number = data.firstPage; ; page++) {
      const answer: Array<Record<string, unknown>> = asArray(
        await data.client.getJson(data.path, {
          ...(data.query || {}),
          page: page,
          [data.sizeParam]: PAGE_SIZE,
        }),
      ).map(asRecord);

      const firstId: string = asString(answer[0]?.["id"]);

      if (answer.length === 0 || firstId === previousFirstId) {
        return records;
      }

      records.push(...answer);
      previousFirstId = firstId;

      if (
        answer.length < PAGE_SIZE ||
        records.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND
      ) {
        return records;
      }
    }
  }

  // A list the key may not read (402, 403, 404) is an empty one.
  private async readOptional(
    read: () => Promise<Array<Record<string, unknown>>>,
    onNotReadable?: () => void,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      return await read();
    } catch (error) {
      if (isListNotAvailable(error)) {
        onNotReadable?.();
        return [];
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
        resourceKeys: asArray(raw["components"]).map(asString).filter(Boolean),
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

// Statuspage writes a page image as an object with a url, or a url, or null.
function hasImage(value: unknown): boolean {
  return Boolean(asString(value) || asString(asRecord(value)["url"]));
}
