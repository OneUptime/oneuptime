import applyStatusPageContentSecurityPolicy, {
  isStatusPageFallbackDocumentPath,
  STATUS_PAGE_CONTENT_SECURITY_POLICY_HEADER_NAME,
  STATUS_PAGE_FALLBACK_CONTENT_SECURITY_POLICY,
} from "../../../Server/Utils/StatusPageContentSecurityPolicy";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import { describe, expect, it, jest } from "@jest/globals";

type FakeResponse = {
  set: ReturnType<typeof jest.fn>;
  headersSent: boolean;
};

function fakeRequest(path: string): ExpressRequest {
  return { path } as unknown as ExpressRequest;
}

function fakeResponse(headersSent: boolean = false): FakeResponse {
  return {
    set: jest.fn(),
    headersSent,
  };
}

function policyDirectives(): Map<string, Array<string>> {
  const directives: Map<string, Array<string>> = new Map();

  for (const rawDirective of STATUS_PAGE_FALLBACK_CONTENT_SECURITY_POLICY.split(
    ";",
  )) {
    const parts: Array<string> = rawDirective.trim().split(/\s+/);
    const name: string | undefined = parts.shift();

    if (name) {
      directives.set(name, parts);
    }
  }

  return directives;
}

describe("status page fallback Content Security Policy", () => {
  it.each([
    "/status-page",
    "/status-page/",
    "/status-page/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "/status-page/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/incidents",
    "/status-page/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee?lang=en",
  ])("classifies %s as a fallback document path", (path: string) => {
    expect(isStatusPageFallbackDocumentPath(path)).toBe(true);
  });

  it.each([
    "",
    "/",
    "/incidents",
    "/rss",
    "/llms.txt",
    "/status-page-api/master-page/id",
    "/status-pages/id",
  ])(
    "does not classify custom-domain or sibling path %s as fallback",
    (path: string) => {
      expect(isStatusPageFallbackDocumentPath(path)).toBe(false);
    },
  );

  it("sets the policy on a fallback document", () => {
    const res: FakeResponse = fakeResponse();

    applyStatusPageContentSecurityPolicy(
      fakeRequest("/status-page/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
      res as unknown as ExpressResponse,
    );

    expect(res.set).toHaveBeenCalledTimes(1);
    expect(res.set).toHaveBeenCalledWith(
      STATUS_PAGE_CONTENT_SECURITY_POLICY_HEADER_NAME,
      STATUS_PAGE_FALLBACK_CONTENT_SECURITY_POLICY,
    );
  });

  it("leaves a custom-domain document unchanged", () => {
    const res: FakeResponse = fakeResponse();

    applyStatusPageContentSecurityPolicy(
      fakeRequest("/"),
      res as unknown as ExpressResponse,
    );

    expect(res.set).not.toHaveBeenCalled();
  });

  it("does not touch a response whose headers were already sent", () => {
    const res: FakeResponse = fakeResponse(true);

    applyStatusPageContentSecurityPolicy(
      fakeRequest("/status-page/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
      res as unknown as ExpressResponse,
    );

    expect(res.set).not.toHaveBeenCalled();
  });

  it("blocks dynamic JavaScript evaluation", () => {
    const scriptSources: Array<string> =
      policyDirectives().get("script-src") || [];

    expect(scriptSources).not.toContain("'unsafe-eval'");
    expect(STATUS_PAGE_FALLBACK_CONTENT_SECURITY_POLICY).not.toContain(
      "unsafe-eval",
    );
  });

  it("blocks inline event-handler attributes even though template scripts remain inline", () => {
    const directives: Map<string, Array<string>> = policyDirectives();

    expect(directives.get("script-src")).toContain("'unsafe-inline'");
    expect(directives.get("script-src-attr")).toEqual(["'none'"]);
  });

  it("keeps the template bundle and HTTPS Tag Manager dependencies loadable", () => {
    const scriptSources: Array<string> =
      policyDirectives().get("script-src") || [];

    expect(scriptSources).toContain("'self'");
    expect(scriptSources).toContain("https:");
  });

  it("forbids plugin documents and attacker-controlled base URLs", () => {
    const directives: Map<string, Array<string>> = policyDirectives();

    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
  });
});
