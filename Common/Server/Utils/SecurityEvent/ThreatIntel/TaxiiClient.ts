import BadDataException from "../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";

/*
 * Minimal TAXII 2.1 client for the threat-intel feed poller: fetch pages
 * of STIX objects from one collection's /objects/ endpoint.
 *
 * A TAXII server URL is tenant-chosen, so — unlike the Google SecOps
 * client, whose host is derived from a validated region — every request
 * goes through DataSourceHttpFetch: the EgressGuard validates and PINS
 * the resolved addresses (no SSRF, no DNS-rebind window), redirects are
 * refused, and response size and wall-clock are capped.
 *
 * The transport is injectable so unit tests exercise the real request
 * construction and response parsing against fixtures.
 */

export type TaxiiFetchLike = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface TaxiiObjectsPage {
  objects: Array<JSONObject>;
  // TAXII envelope `more`: further pages exist.
  more: boolean;
  // TAXII envelope `next`: opaque token for the next page, when `more`.
  next: string | null;
  /*
   * The X-TAXII-Date-Added-Last response header: the date_added of the
   * newest object in this page — the correct added_after cursor for the
   * next poll.
   */
  dateAddedLast: string | null;
}

export const TAXII_MEDIA_TYPE: string = "application/taxii+json;version=2.1";
export const TAXII_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;
export const TAXII_DATE_ADDED_LAST_HEADER: string = "x-taxii-date-added-last";

export default class TaxiiClient {
  private apiRootUrl: string;
  private collectionId: string;
  private apiToken: string | undefined;
  private basicAuthUsername: string | undefined;
  private basicAuthPassword: string | undefined;
  private fetchImplementation: TaxiiFetchLike;

  public constructor(data: {
    apiRootUrl: string;
    collectionId: string;
    apiToken?: string | undefined;
    basicAuthUsername?: string | undefined;
    basicAuthPassword?: string | undefined;
    fetchImplementation?: TaxiiFetchLike | undefined;
  }) {
    TaxiiClient.validateApiRootUrl(data.apiRootUrl);
    TaxiiClient.validateCollectionId(data.collectionId);

    this.apiRootUrl = data.apiRootUrl.endsWith("/")
      ? data.apiRootUrl
      : `${data.apiRootUrl}/`;
    this.collectionId = data.collectionId;
    this.apiToken = data.apiToken || undefined;
    this.basicAuthUsername = data.basicAuthUsername || undefined;
    this.basicAuthPassword = data.basicAuthPassword || undefined;
    this.fetchImplementation =
      data.fetchImplementation ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });
  }

  public static validateApiRootUrl(url: string): void {
    let parsed: URL;

    try {
      parsed = new URL(url || "");
    } catch {
      throw new BadDataException(
        "TAXII API root must be a valid URL, e.g. https://taxii.example.com/api1/",
      );
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new BadDataException("TAXII API root must be an http(s) URL.");
    }

    if (parsed.search || parsed.hash) {
      throw new BadDataException(
        "TAXII API root must not carry a query string or fragment.",
      );
    }
  }

  public static validateCollectionId(collectionId: string): void {
    const collectionIdRegex: RegExp = /^[A-Za-z0-9._~-]{1,256}$/;

    if (!collectionIdRegex.test(collectionId || "")) {
      throw new BadDataException(
        "Collection ID must be a plain TAXII collection identifier (letters, digits, dot, dash, underscore).",
      );
    }
  }

  /*
   * Bearer token wins, else HTTP basic — the same precedence as the Data
   * Source connectors' buildAuthHeaders. Anonymous collections get only
   * the TAXII Accept header.
   */
  public buildHeaders(): Dictionary<string> {
    const headers: Dictionary<string> = {
      Accept: TAXII_MEDIA_TYPE,
    };

    if (this.apiToken) {
      headers["Authorization"] = `Bearer ${this.apiToken}`;
    } else if (this.basicAuthUsername || this.basicAuthPassword) {
      const encoded: string = Buffer.from(
        `${this.basicAuthUsername || ""}:${this.basicAuthPassword || ""}`,
      ).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }

    return headers;
  }

  public buildObjectsUrl(params: {
    limit: number;
    addedAfter?: string | undefined;
    next?: string | undefined;
  }): string {
    const searchParams: URLSearchParams = new URLSearchParams();

    searchParams.set("match[type]", "indicator");
    searchParams.set("limit", String(params.limit));

    if (params.addedAfter) {
      searchParams.set("added_after", params.addedAfter);
    }

    if (params.next) {
      searchParams.set("next", params.next);
    }

    return `${this.apiRootUrl}collections/${this.collectionId}/objects/?${searchParams.toString()}`;
  }

  public async fetchIndicatorObjects(params: {
    limit: number;
    addedAfter?: string | undefined;
    next?: string | undefined;
  }): Promise<TaxiiObjectsPage> {
    const response: DataSourceHttpResponse = await this.fetchImplementation({
      method: "GET",
      url: this.buildObjectsUrl(params),
      headers: this.buildHeaders(),
      timeoutInMs: TAXII_REQUEST_TIMEOUT_IN_MS,
      egressOptions: {
        targetLabel: "TAXII server",
      },
    });

    const envelope: JSONValue = response.bodyJson as JSONValue;

    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new BadDataException(
        "TAXII server returned a non-envelope body from the objects endpoint.",
      );
    }

    const asObject: JSONObject = envelope as JSONObject;

    const objects: Array<JSONObject> = Array.isArray(asObject["objects"])
      ? ((asObject["objects"] as JSONArray).filter(
          (item: JSONValue): boolean => {
            return (
              typeof item === "object" && item !== null && !Array.isArray(item)
            );
          },
        ) as Array<JSONObject>)
      : [];

    const next: string =
      typeof asObject["next"] === "string" ? (asObject["next"] as string) : "";

    return {
      objects,
      more: asObject["more"] === true,
      next: next || null,
      dateAddedLast:
        (response.headers || {})[TAXII_DATE_ADDED_LAST_HEADER] || null,
    };
  }
}
