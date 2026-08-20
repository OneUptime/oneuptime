import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import {
  canServeStatusPageCustomizations,
  isPrimaryStatusPageHost,
  normalizeStatusPageRequestHost,
} from "../../../Server/Utils/StatusPageCustomizationAccess";
import { ExpressRequest } from "../../../Server/Utils/Express";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const makeRequest: (host?: string, forwardedHost?: string) => ExpressRequest = (
  host?: string,
  forwardedHost?: string,
): ExpressRequest => {
  const headers: Record<string, string> = {};

  if (host !== undefined) {
    headers["host"] = host;
  }

  if (forwardedHost !== undefined) {
    headers["x-forwarded-host"] = forwardedHost;
  }

  return {
    headers,
    get: (name: string): string | undefined => {
      return headers[name.toLowerCase()];
    },
  } as unknown as ExpressRequest;
};

describe("normalizeStatusPageRequestHost", () => {
  it.each([
    ["status.example.com", "status.example.com"],
    [" STATUS.Example.COM ", "status.example.com"],
    ["status.example.com:443", "status.example.com"],
    ["status.example.com.:8443", "status.example.com"],
    ["[::1]", "[::1]"],
    ["[::1]:8080", "[::1]"],
  ])("normalizes %s", (rawHost: string, expected: string) => {
    expect(normalizeStatusPageRequestHost(rawHost)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "   ",
    "https://status.example.com",
    "status.example.com/path",
    "status.example.com?query=true",
    "status.example.com#fragment",
    "user@status.example.com",
    "status.example.com,evil.example.com",
    "status example.com",
    "status.example.com:not-a-port",
    "status.example.com:99999",
    "status..example.com",
  ])("rejects malformed authority %p", (rawHost: string | undefined) => {
    expect(normalizeStatusPageRequestHost(rawHost)).toBeNull();
  });
});

describe("isPrimaryStatusPageHost", () => {
  const originalHost: string | undefined = process.env["HOST"];

  afterEach(() => {
    if (originalHost === undefined) {
      delete process.env["HOST"];
    } else {
      process.env["HOST"] = originalHost;
    }
  });

  it("recognizes the configured application host", () => {
    process.env["HOST"] = "APP.Example.com:443";

    expect(isPrimaryStatusPageHost("app.example.com")).toBe(true);
    expect(isPrimaryStatusPageHost("status.example.com")).toBe(false);
  });

  it.each(["localhost", "ingress"])(
    "always recognizes the built-in primary host %s",
    (hostname: string) => {
      process.env["HOST"] = "app.example.com";

      expect(isPrimaryStatusPageHost(hostname)).toBe(true);
    },
  );

  it("fails closed when the configured application host is malformed", () => {
    process.env["HOST"] = "https://app.example.com/path";

    expect(isPrimaryStatusPageHost("status.example.com")).toBe(true);
  });
});

describe("canServeStatusPageCustomizations", () => {
  const originalHost: string | undefined = process.env["HOST"];
  let statusPageId: ObjectID;

  beforeEach(() => {
    process.env["HOST"] = "app.example.com";
    statusPageId = ObjectID.generate();
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalHost === undefined) {
      delete process.env["HOST"];
    } else {
      process.env["HOST"] = originalHost;
    }
  });

  it.each([
    ["the configured application host", "APP.EXAMPLE.COM:443"],
    ["localhost", "localhost:3000"],
    ["the internal ingress host", "ingress"],
    ["a missing Host", undefined],
    ["a malformed Host", "status.example.com/path"],
  ])(
    "denies %s without consulting status-page domains",
    async (_label: string, host: string | undefined) => {
      const lookupSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        StatusPageDomainService,
        "findOneBy",
      );

      await expect(
        canServeStatusPageCustomizations({
          req: makeRequest(host),
          statusPageId,
        }),
      ).resolves.toBe(false);

      expect(lookupSpy).not.toHaveBeenCalled();
    },
  );

  it("requires a verified domain bound to the exact status page and normalized host", async () => {
    const statusPageDomain: StatusPageDomain = new StatusPageDomain();
    statusPageDomain.id = ObjectID.generate();

    const lookupSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockResolvedValue(statusPageDomain);

    await expect(
      canServeStatusPageCustomizations({
        req: makeRequest("STATUS.Customer.Example.:443"),
        statusPageId,
      }),
    ).resolves.toBe(true);

    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy).toHaveBeenCalledWith({
      query: {
        fullDomain: "status.customer.example",
        statusPageId,
        isCnameVerified: true,
        domain: {
          isVerified: true,
        },
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });
  });

  it("denies an unknown or unverified custom domain", async () => {
    jest.spyOn(StatusPageDomainService, "findOneBy").mockResolvedValue(null);

    await expect(
      canServeStatusPageCustomizations({
        req: makeRequest("status.customer.example"),
        statusPageId,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the status-page-domain lookup throws", async () => {
    jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(
      canServeStatusPageCustomizations({
        req: makeRequest("status.customer.example"),
        statusPageId,
      }),
    ).resolves.toBe(false);
  });

  it("never lets X-Forwarded-Host override the raw primary Host", async () => {
    const lookupSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageDomainService,
      "findOneBy",
    );

    await expect(
      canServeStatusPageCustomizations({
        req: makeRequest("app.example.com", "status.customer.example"),
        statusPageId,
      }),
    ).resolves.toBe(false);

    expect(lookupSpy).not.toHaveBeenCalled();
  });
});
