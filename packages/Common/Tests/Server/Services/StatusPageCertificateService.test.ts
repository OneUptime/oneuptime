import StatusPageCertificateService from "../../../Server/Services/StatusPageCertificateService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import { AppApiHostname } from "../../../Server/EnvironmentConfig";
import API from "../../../Utils/API";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Custom status page domains get their TLS certificate from the cert worker,
 * and this service is the only caller. Nothing about it is visible until a
 * customer's domain fails to serve HTTPS, so what these tests hold is the
 * request itself: the verb, the worker route, the domain in the body, and the
 * protocol taken from the instance's own configuration rather than assumed.
 */

const WORKER_ROUTE: string = "/api/workers/cert";
const DOMAIN: string = "status.example.com";

type ApiCall = { url: URL; data: Record<string, unknown> };

function lastCall(spy: jest.SpyInstance): ApiCall {
  return spy.mock.calls[spy.mock.calls.length - 1]?.[0] as ApiCall;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  { label: "https", protocol: Protocol.HTTPS },
  { label: "http", protocol: Protocol.HTTP },
])(
  "StatusPageCertificateService over $label",
  ({ protocol }: { protocol: Protocol }) => {
    function mockProtocol(): jest.SpyInstance {
      return jest
        .spyOn(DatabaseConfig, "getHttpProtocol")
        .mockResolvedValue(protocol as never);
    }

    test("add posts the domain to the cert worker", async () => {
      mockProtocol();
      const postSpy: jest.SpyInstance = jest
        .spyOn(API, "post")
        .mockResolvedValue({} as never);

      await StatusPageCertificateService.add(DOMAIN);

      expect(postSpy).toHaveBeenCalledTimes(1);
      const call: ApiCall = lastCall(postSpy);
      expect(call.data).toEqual({ domain: DOMAIN });
      expect(call.url.protocol).toBe(protocol);
      expect(call.url.hostname.toString()).toBe(AppApiHostname.toString());
      expect(call.url.route.toString()).toBe(WORKER_ROUTE);
    });

    test("remove deletes the domain at the same route", async () => {
      mockProtocol();
      const deleteSpy: jest.SpyInstance = jest
        .spyOn(API, "delete")
        .mockResolvedValue({} as never);

      await StatusPageCertificateService.remove(DOMAIN);

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const call: ApiCall = lastCall(deleteSpy);
      expect(call.data).toEqual({ domain: DOMAIN });
      expect(call.url.protocol).toBe(protocol);
      expect(call.url.route.toString()).toBe(WORKER_ROUTE);
    });

    test("get reads the domain's certificate from the same route", async () => {
      mockProtocol();
      const getSpy: jest.SpyInstance = jest
        .spyOn(API, "get")
        .mockResolvedValue({} as never);

      await StatusPageCertificateService.get(DOMAIN);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const call: ApiCall = lastCall(getSpy);
      expect(call.data).toEqual({ domain: DOMAIN });
      expect(call.url.protocol).toBe(protocol);
      expect(call.url.route.toString()).toBe(WORKER_ROUTE);
    });
  },
);

describe("StatusPageCertificateService", () => {
  test("each verb reads the protocol fresh rather than caching the first answer", async () => {
    const protocolSpy: jest.SpyInstance = jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValueOnce(Protocol.HTTP as never)
      .mockResolvedValueOnce(Protocol.HTTPS as never);
    const postSpy: jest.SpyInstance = jest
      .spyOn(API, "post")
      .mockResolvedValue({} as never);

    await StatusPageCertificateService.add(DOMAIN);
    await StatusPageCertificateService.add(DOMAIN);

    expect(protocolSpy).toHaveBeenCalledTimes(2);
    expect((postSpy.mock.calls[0]?.[0] as ApiCall).url.protocol).toBe(
      Protocol.HTTP,
    );
    expect((postSpy.mock.calls[1]?.[0] as ApiCall).url.protocol).toBe(
      Protocol.HTTPS,
    );
  });

  test("the three verbs do not call one another", async () => {
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS as never);
    const postSpy: jest.SpyInstance = jest
      .spyOn(API, "post")
      .mockResolvedValue({} as never);
    const deleteSpy: jest.SpyInstance = jest
      .spyOn(API, "delete")
      .mockResolvedValue({} as never);
    const getSpy: jest.SpyInstance = jest
      .spyOn(API, "get")
      .mockResolvedValue({} as never);

    await StatusPageCertificateService.get(DOMAIN);

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();

    await StatusPageCertificateService.remove(DOMAIN);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("the domain is passed through untouched, punycode and all", async () => {
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS as never);
    const postSpy: jest.SpyInstance = jest
      .spyOn(API, "post")
      .mockResolvedValue({} as never);

    for (const domain of [
      "status.example.com",
      "xn--80ak6aa92e.example.com",
      "STATUS.EXAMPLE.COM",
      "status.example.co.uk",
    ]) {
      await StatusPageCertificateService.add(domain);
      expect(lastCall(postSpy).data).toEqual({ domain: domain });
    }
  });

  test("a failing worker call is surfaced, not swallowed", async () => {
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS as never);
    jest
      .spyOn(API, "post")
      .mockRejectedValue(new Error("cert worker unreachable") as never);

    await expect(StatusPageCertificateService.add(DOMAIN)).rejects.toThrow(
      "cert worker unreachable",
    );
  });
});
