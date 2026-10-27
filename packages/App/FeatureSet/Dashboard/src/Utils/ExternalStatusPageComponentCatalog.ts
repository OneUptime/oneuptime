import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import StatusPageSummaryUtil, {
  StatusPageSummary,
} from "Common/Types/StatusPage/StatusPageSummary";
import ExternalStatusPageReading, {
  ExternalStatusPageComponent,
  ExternalStatusPageContents,
} from "Common/Utils/Monitor/ExternalStatusPageReading";

/*
 * THE COMPONENTS OF A STATUS PAGE, FOR THE PICKER IN THE MONITOR FORM.
 *
 * An External Status Page monitor can watch only some components of a page
 * (issue #5156). The form lists the page's components to pick from, read
 * the way the probe reads them (ExternalStatusPageReading): Atlassian
 * Statuspage's components, incident.io's, a OneUptime status page's
 * resources, in their groups, with the status each has now.
 *
 * The page is read by the person's own browser, not by OneUptime's
 * servers: the three providers that list components answer any web page
 * (they send Access-Control-Allow-Origin: *), so nothing on OneUptime's side
 * fetches an address a project member typed. The request carries nothing of
 * OneUptime's - no cookies, no key, no referrer - and an answer is read for
 * at most MAX_ANSWER_BYTES within TIMEOUT_IN_MS.
 *
 * A page that cannot be read this way - an RSS or Atom feed (no components,
 * only items), a page the browser cannot reach, a private page - says why
 * (ExternalStatusPageCatalogProblem), and the person types the names
 * instead. Kept free of React, so its tests run anywhere.
 */

// The most an answer is read for: Cloudflare's 482 components are 176 KB.
export const MAX_ANSWER_BYTES: number = 4 * 1024 * 1024;

// How long one read of a page may take, its providers asked in turn.
export const TIMEOUT_IN_MS: number = 15000;

export enum ExternalStatusPageCatalogProblem {
  // No address yet, or not an http(s) address.
  NoAddress = "NoAddress",
  // An RSS or Atom feed: its items have titles, not components.
  Feed = "Feed",
  // No provider that lists components answered the browser.
  NotRead = "NotRead",
  // The page was read, and lists no components.
  NoComponents = "NoComponents",
  // The page took longer than TIMEOUT_IN_MS.
  TimedOut = "TimedOut",
}

export class ExternalStatusPageCatalogError extends Error {
  public readonly problem: ExternalStatusPageCatalogProblem;

  public constructor(problem: ExternalStatusPageCatalogProblem) {
    super(problem);
    this.problem = problem;
  }
}

export interface ExternalStatusPageCatalog {
  // The provider that answered.
  provider: ExternalStatusPageProviderType;
  // The page's host, as the form names it ("www.githubstatus.com").
  host: string;
  components: Array<ExternalStatusPageComponent>;
}

// What a read needs of a fetch answer (window.fetch's Response has it).
export interface CatalogAnswer {
  ok: boolean;
  status: number;
  headers?: { get: (name: string) => string | null } | undefined;
  body?: {
    getReader: () => {
      read: () => Promise<{ done: boolean; value?: Uint8Array | undefined }>;
      cancel: () => Promise<void>;
    };
  } | null;
  text: () => Promise<string>;
}

export type CatalogFetch = (
  url: string,
  init: RequestInit,
) => Promise<CatalogAnswer>;

// The options of every request: nothing of OneUptime's goes with it.
export const CATALOG_REQUEST_INIT: RequestInit = {
  method: "GET",
  mode: "cors",
  credentials: "omit",
  referrerPolicy: "no-referrer",
  cache: "no-store",
  redirect: "follow",
  headers: { Accept: "application/json" },
};

type Reader = (
  statusPageUrl: string,
  ask: (url: string) => Promise<unknown>,
) => Promise<Array<ExternalStatusPageComponent> | null>;

// Each provider that lists components, read as the probe reads it.
const READERS: Record<string, Reader> = {
  [ExternalStatusPageProviderType.IncidentIo]: async (
    statusPageUrl: string,
    ask: (url: string) => Promise<unknown>,
  ): Promise<Array<ExternalStatusPageComponent> | null> => {
    const url: string | null =
      ExternalStatusPageReading.getIncidentIoUrl(statusPageUrl);

    if (!url) {
      return null;
    }

    const contents: ExternalStatusPageContents | null =
      ExternalStatusPageReading.readIncidentIo(await ask(url));

    return contents ? contents.components : null;
  },
  [ExternalStatusPageProviderType.AtlassianStatuspage]: async (
    statusPageUrl: string,
    ask: (url: string) => Promise<unknown>,
  ): Promise<Array<ExternalStatusPageComponent> | null> => {
    return ExternalStatusPageReading.readAtlassianComponents(
      await ask(ExternalStatusPageReading.getAtlassianUrls(statusPageUrl).components),
    );
  },
  [ExternalStatusPageProviderType.OneUptime]: async (
    statusPageUrl: string,
    ask: (url: string) => Promise<unknown>,
  ): Promise<Array<ExternalStatusPageComponent> | null> => {
    const url: string | null =
      StatusPageSummaryUtil.getSummaryUrl(statusPageUrl);

    if (!url) {
      return null;
    }

    const summary: StatusPageSummary | null = StatusPageSummaryUtil.fromJSON(
      await ask(url),
    );

    return summary
      ? ExternalStatusPageReading.readOneUptimeSummary(summary).components
      : null;
  },
};

// The providers Auto asks, in the probe's order.
const AUTO_ORDER: Array<ExternalStatusPageProviderType> = [
  ExternalStatusPageProviderType.IncidentIo,
  ExternalStatusPageProviderType.AtlassianStatuspage,
  ExternalStatusPageProviderType.OneUptime,
];

export default class ExternalStatusPageComponentCatalog {
  /*
   * The address the page is read at: the URL as typed, with https:// when
   * it names no scheme. Null for anything but an http(s) address with a
   * host.
   */
  public static getAddress(statusPageUrl: string | undefined): URL | null {
    const trimmed: string = (statusPageUrl || "").trim();

    if (!trimmed) {
      return null;
    }

    let url: URL;

    try {
      url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    } catch {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    /*
     * A status page's address names no user: "mailto:a@example.com", read
     * with https:// in front, would be user "mailto" on example.com.
     */
    if (url.username || url.password) {
      return null;
    }

    // A host the person could mean: a name with a dot, or "localhost".
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost")) {
      return null;
    }

    return url;
  }

  // The providers asked for a page, in order.
  public static getProvidersToAsk(
    provider: ExternalStatusPageProviderType,
  ): Array<ExternalStatusPageProviderType> {
    if (provider === ExternalStatusPageProviderType.Auto || !provider) {
      return [...AUTO_ORDER];
    }

    return READERS[provider] ? [provider] : [];
  }

  public static async read(data: {
    statusPageUrl: string;
    provider: ExternalStatusPageProviderType;
    fetch?: CatalogFetch | undefined;
    signal?: AbortSignal | undefined;
    timeoutInMs?: number | undefined;
  }): Promise<ExternalStatusPageCatalog> {
    const address: URL | null = ExternalStatusPageComponentCatalog.getAddress(
      data.statusPageUrl,
    );

    if (!address) {
      throw new ExternalStatusPageCatalogError(
        ExternalStatusPageCatalogProblem.NoAddress,
      );
    }

    if (
      data.provider === ExternalStatusPageProviderType.RSS ||
      data.provider === ExternalStatusPageProviderType.Atom
    ) {
      throw new ExternalStatusPageCatalogError(
        ExternalStatusPageCatalogProblem.Feed,
      );
    }

    const fetchAnswer: CatalogFetch =
      data.fetch ||
      ((url: string, init: RequestInit): Promise<CatalogAnswer> => {
        return window.fetch(url, init) as Promise<CatalogAnswer>;
      });

    const controller: AbortController = new AbortController();
    let timedOut: boolean = false;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, data.timeoutInMs ?? TIMEOUT_IN_MS);
    const stopWithCaller: () => void = (): void => {
      controller.abort();
    };

    data.signal?.addEventListener("abort", stopWithCaller);

    /*
     * One answer, as JSON: undefined for an answer that is not a success,
     * not JSON, or too long - the provider is then not the page's.
     */
    const ask: (url: string) => Promise<unknown> = async (
      url: string,
    ): Promise<unknown> => {
      const answer: CatalogAnswer = await fetchAnswer(url, {
        ...CATALOG_REQUEST_INIT,
        signal: controller.signal,
      });

      if (!answer.ok) {
        return undefined;
      }

      const text: string | null =
        await ExternalStatusPageComponentCatalog.readText(answer);

      if (text === null) {
        return undefined;
      }

      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    };

    const statusPageUrl: string = address.toString();
    let wasRead: boolean = false;

    try {
      for (const provider of ExternalStatusPageComponentCatalog.getProvidersToAsk(
        data.provider,
      )) {
        let components: Array<ExternalStatusPageComponent> | null = null;

        try {
          components = await (READERS[provider] as Reader)(statusPageUrl, ask);
        } catch {
          /*
           * The browser could not reach it, or the provider's address does
           * not answer other pages (no Access-Control-Allow-Origin): this
           * provider is not one to read the page by.
           */
          if (controller.signal.aborted) {
            break;
          }

          continue;
        }

        if (components === null) {
          continue;
        }

        wasRead = true;

        if (components.length === 0) {
          continue;
        }

        return {
          provider: provider,
          host: address.host,
          components: components,
        };
      }
    } finally {
      clearTimeout(timer);
      data.signal?.removeEventListener("abort", stopWithCaller);
    }

    if (timedOut) {
      throw new ExternalStatusPageCatalogError(
        ExternalStatusPageCatalogProblem.TimedOut,
      );
    }

    throw new ExternalStatusPageCatalogError(
      wasRead
        ? ExternalStatusPageCatalogProblem.NoComponents
        : ExternalStatusPageCatalogProblem.NotRead,
    );
  }

  /*
   * An answer's text, read for at most MAX_ANSWER_BYTES: null for one that
   * says or turns out to be longer.
   */
  public static async readText(answer: CatalogAnswer): Promise<string | null> {
    const length: number = Number(answer.headers?.get("content-length") || 0);

    if (Number.isFinite(length) && length > MAX_ANSWER_BYTES) {
      return null;
    }

    if (!answer.body || typeof answer.body.getReader !== "function") {
      const text: string = await answer.text();

      return text.length > MAX_ANSWER_BYTES ? null : text;
    }

    const reader: ReturnType<NonNullable<CatalogAnswer["body"]>["getReader"]> =
      answer.body.getReader();
    const chunks: Array<Uint8Array> = [];
    let received: number = 0;

    while (true) {
      const chunk: { done: boolean; value?: Uint8Array | undefined } =
        await reader.read();

      if (chunk.done) {
        break;
      }

      if (!chunk.value) {
        continue;
      }

      received += chunk.value.byteLength;

      if (received > MAX_ANSWER_BYTES) {
        await reader.cancel();
        return null;
      }

      chunks.push(chunk.value);
    }

    const bytes: Uint8Array = new Uint8Array(received);
    let offset: number = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder("utf-8").decode(bytes);
  }
}
