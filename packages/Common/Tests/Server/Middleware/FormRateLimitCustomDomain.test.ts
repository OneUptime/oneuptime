import { describe, expect, it, jest } from "@jest/globals";

/*
 * Which form a request to a form's own domain counts against
 * (FormRateLimit, FormRateLimitFormSource.CustomDomain): the page on the
 * domain names no share key, and the domain answers with one form, so the
 * per-form counters key it by the domain the request came to - its own Host,
 * lower case, without its port - and never by anything the request names.
 * The routes' HTTP suite (FormCustomDomainRoutes) drives the middleware end
 * to end; this pins the key itself.
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

import FormRateLimit, {
  FormRateLimitFormSource,
} from "../../../Server/Middleware/FormRateLimit";
import { ExpressRequest } from "../../../Server/Utils/Express";

function request(headers: Record<string, unknown>): ExpressRequest {
  return {
    headers: headers,
    params: {},
  } as unknown as ExpressRequest;
}

describe("FormRateLimit, on a form's own domain", () => {
  it("keys the form by its domain, in one spelling", () => {
    for (const host of [
      "report.acme.com",
      "Report.ACME.com",
      "report.acme.com:443",
      "report.acme.com.",
    ]) {
      expect(
        FormRateLimit.resolveCustomDomainFormKey(request({ host: host })),
      ).toBe("d:report.acme.com");
    }
  });

  it("two domains are two forms", () => {
    expect(
      FormRateLimit.resolveCustomDomainFormKey(
        request({ host: "report.acme.com" }),
      ),
    ).not.toBe(
      FormRateLimit.resolveCustomDomainFormKey(
        request({ host: "feedback.acme.com" }),
      ),
    );
  });

  it("never by X-Forwarded-Host, which a caller writes to pick a bucket", () => {
    expect(
      FormRateLimit.resolveCustomDomainFormKey(
        request({
          host: "report.acme.com",
          "x-forwarded-host": "another.acme.com",
        }),
      ),
    ).toBe("d:report.acme.com");
  });

  it("a Host that is not one name shares one bucket, as a malformed key does", () => {
    for (const host of [
      undefined,
      "",
      ["report.acme.com", "evil.example"],
      "user@report.acme.com",
      "report.acme.com/admin",
    ]) {
      expect(
        FormRateLimit.resolveCustomDomainFormKey(request({ host: host })),
      ).toBe("invalid");
    }

    expect(FormRateLimit.getCustomDomainFormKey(null)).toBe("invalid");
    expect(FormRateLimit.getCustomDomainFormKey("   ")).toBe("invalid");
  });

  it("can never be mistaken for a form's share key", () => {
    const shareKeyBucket: string = FormRateLimit.getFormKey(
      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    );

    expect(shareKeyBucket.startsWith("d:")).toBe(false);
    expect(
      FormRateLimit.getCustomDomainFormKey("report.acme.com").startsWith("d:"),
    ).toBe(true);
  });

  it("a link's request keeps its share key: the source is the route's to choose", () => {
    expect(FormRateLimitFormSource.ShareKey).toBe("share-key");
    expect(FormRateLimitFormSource.CustomDomain).toBe("custom-domain");
    expect(
      FormRateLimit.resolveFormKey({
        headers: { host: "report.acme.com" },
        params: { shareKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
      } as unknown as ExpressRequest),
    ).toBe(FormRateLimit.getFormKey("7c9e6679-7425-40de-944b-e07fc1f90ae7"));
  });
});
