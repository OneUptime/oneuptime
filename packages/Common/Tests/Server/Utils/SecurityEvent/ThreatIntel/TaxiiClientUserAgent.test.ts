import axios, { AxiosRequestConfig } from "axios";
import OutboundUserAgent from "../../../../../Server/Utils/OutboundUserAgent";
import TaxiiClient, {
  TAXII_MEDIA_TYPE,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/TaxiiClient";
import Dictionary from "../../../../../Types/Dictionary";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Regression test for issue #3555: threat-intel feed polls went out with
 * axios' default `axios/<version>` User-Agent, and feed providers' WAFs
 * answered 403 ("Bare axios User-Agent detected") before the request ever
 * reached the TAXII API.
 *
 * The other TaxiiClient tests inject a fake transport, which is exactly
 * where a UA regression would hide — the header is added by the transport,
 * not by the client. So this file drives the client through its REAL
 * default transport (DataSourceHttpFetch) with axios mocked at the module
 * boundary, and asserts against the config axios actually received: the
 * closest thing to the wire without opening a socket.
 *
 * The API root is a literal public IP so the egress guard validates it
 * without touching DNS — no network, no resolver, in any environment.
 */
jest.mock("axios", () => {
  type IsAxiosErrorFunction = (candidate: unknown) => boolean;
  const isAxiosError: IsAxiosErrorFunction = (candidate: unknown): boolean => {
    return Boolean(
      candidate &&
        typeof candidate === "object" &&
        (candidate as { isAxiosError?: boolean }).isAxiosError === true,
    );
  };
  const axiosFunction: jest.Mock = Object.assign(jest.fn(), {
    isAxiosError: isAxiosError,
  });
  return {
    __esModule: true,
    default: axiosFunction,
  };
});

const axiosMock: jest.Mock = axios as unknown as jest.Mock;

// A public, non-private literal address: no DNS lookup, never blocked.
const API_ROOT: string = "https://93.184.216.34/api1/";
const COLLECTION_ID: string = "91a7b528-80eb-42ed-a74d-c6fbd5a26116";

function buildClient(options?: { apiToken?: string | undefined }): TaxiiClient {
  return new TaxiiClient({
    apiRootUrl: API_ROOT,
    collectionId: COLLECTION_ID,
    apiToken: options?.apiToken,
  });
}

function getSentHeaders(callIndex: number = 0): Dictionary<string> {
  expect(axiosMock.mock.calls.length).toBeGreaterThan(callIndex);
  const config: AxiosRequestConfig = axiosMock.mock.calls[
    callIndex
  ]![0] as AxiosRequestConfig;
  return config.headers as Dictionary<string>;
}

beforeEach(() => {
  axiosMock.mockReset();
  axiosMock.mockResolvedValue({
    status: 200,
    data: JSON.stringify({ objects: [], more: false }),
    headers: {},
  });
});

describe("TAXII feed polling — outbound User-Agent (issue #3555)", () => {
  test("a poll identifies itself as OneUptime instead of a bare HTTP library", async () => {
    await buildClient().fetchIndicatorObjects({ limit: 500 });

    const userAgent: string = getSentHeaders()["User-Agent"] as string;

    expect(userAgent).toBe(OutboundUserAgent.get());
    expect(userAgent.startsWith("OneUptime")).toBe(true);
    expect(userAgent).toContain("https://oneuptime.com");
    expect(userAgent.toLowerCase()).not.toContain("axios");
  });

  test("the User-Agent header is present on the request axios is given, so axios never supplies its own", async () => {
    await buildClient().fetchIndicatorObjects({ limit: 500 });

    const headers: Dictionary<string> = getSentHeaders();
    const userAgentKeys: Array<string> = Object.keys(headers).filter(
      (key: string): boolean => {
        return key.toLowerCase() === "user-agent";
      },
    );

    expect(userAgentKeys).toEqual(["User-Agent"]);
    expect((headers["User-Agent"] as string).trim()).not.toBe("");
  });

  test("it does not displace the TAXII media type or the feed's credentials", async () => {
    await buildClient({ apiToken: "feed-token" }).fetchIndicatorObjects({
      limit: 500,
    });

    const headers: Dictionary<string> = getSentHeaders();

    expect(headers["Accept"]).toBe(TAXII_MEDIA_TYPE);
    expect(headers["Authorization"]).toBe("Bearer feed-token");
    expect(headers["User-Agent"]).toBe(OutboundUserAgent.get());
  });

  test("every page of a paginated sync carries it, not just the first", async () => {
    const client: TaxiiClient = buildClient();

    await client.fetchIndicatorObjects({ limit: 500 });
    await client.fetchIndicatorObjects({
      limit: 500,
      addedAfter: "2026-08-01T00:00:00.000Z",
      next: "page-2-token",
    });

    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(getSentHeaders(0)["User-Agent"]).toBe(OutboundUserAgent.get());
    expect(getSentHeaders(1)["User-Agent"]).toBe(OutboundUserAgent.get());
  });

  test("the header comes from the transport, not the client — buildHeaders stays protocol-only", () => {
    const headers: Dictionary<string> = buildClient({
      apiToken: "feed-token",
    }).buildHeaders();

    const userAgentKeys: Array<string> = Object.keys(headers).filter(
      (key: string): boolean => {
        return key.toLowerCase() === "user-agent";
      },
    );

    expect(userAgentKeys).toEqual([]);
    expect(headers["Accept"]).toBe(TAXII_MEDIA_TYPE);
  });
});
