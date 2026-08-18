/**
 * The X-Robots-Tag half of the status page indexing opt-out, on the wire.
 *
 * The <meta name="robots"> in index.ejs only covers the HTML (it is asserted
 * in Common/Tests/App/StatusPage/StatusPageIndexPageRobotsMeta.test.ts, which
 * is where the ejs types live). These two responses have no <head> to put a
 * tag in, so the header is the only instruction a crawler gets from them -
 * and they are linked from the page itself, so a crawler that honours the
 * page's noindex will still find them.
 *
 * Both server implementations are covered: the standalone status-page
 * container and the combined App container each ship their own copy of these
 * handlers, and a status page served by one must not behave differently from
 * the same page served by the other.
 */

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import {
  handleLlmsTxt as handleFrontendLlmsTxt,
  handleRSS as handleFrontendRSS,
} from "../../FeatureSet/Frontend/Utils/StatusPage";
import { handleLlmsTxt as handleStandaloneLlmsTxt } from "../../FeatureSet/StatusPage/src/Server/API/LlmsTxt";
import { handleRSS as handleStandaloneRSS } from "../../FeatureSet/StatusPage/src/Server/API/RSS";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const STATUS_PAGE_ID: string = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type SpiedApi = {
  mockResolvedValue: (value: unknown) => void;
};

type FakeResponse = {
  set: ReturnType<typeof jest.fn>;
  send: ReturnType<typeof jest.fn>;
  status: ReturnType<typeof jest.fn>;
  headersSent: boolean;
};

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    set: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
    headersSent: false,
  };

  (
    res.status as unknown as { mockReturnValue: (value: unknown) => void }
  ).mockReturnValue(res);

  return res;
}

function customDomainRequest(): ExpressRequest {
  return {
    path: "/llms.txt",
    hostname: "status.acme.com",
    protocol: "https",
    headers: { host: "status.acme.com" },
    get: () => {
      return "status.acme.com";
    },
  } as unknown as ExpressRequest;
}

function robotsHeaderCalls(res: FakeResponse): Array<Array<unknown>> {
  const calls: Array<Array<unknown>> = (
    res.set as unknown as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls;

  return calls.filter((call: Array<unknown>) => {
    return call[0] === "X-Robots-Tag";
  });
}

function mockSeoAndFeedApis(indexingEnabled: boolean): void {
  (jest.spyOn(API, "get") as unknown as SpiedApi).mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        _id: STATUS_PAGE_ID,
        title: "Acme Status",
        description: "How Acme is doing.",
        enableSearchEngineIndexing: indexingEnabled,
      },
      {},
    ),
  );

  /*
   * The RSS handler fans out to three POST endpoints for its items. Empty
   * bodies are enough - the feed's contents are not what is under test here.
   */
  (jest.spyOn(API, "post") as unknown as SpiedApi).mockResolvedValue(
    new HTTPResponse<JSONObject>(200, {}, {}),
  );
}

type Handler = (req: ExpressRequest, res: ExpressResponse) => Promise<void>;

const NON_HTML_RESPONSES: Array<[string, Handler]> = [
  ["llms.txt (standalone status-page container)", handleStandaloneLlmsTxt],
  ["llms.txt (combined App container)", handleFrontendLlmsTxt],
  ["RSS feed (standalone status-page container)", handleStandaloneRSS],
  ["RSS feed (combined App container)", handleFrontendRSS],
];

describe.each(NON_HTML_RESPONSES)("%s", (_name: string, handler: Handler) => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("carries the noindex instruction in a header when indexing is off", async () => {
    mockSeoAndFeedApis(false);
    const res: FakeResponse = fakeResponse();

    await handler(customDomainRequest(), res as unknown as ExpressResponse);

    expect(robotsHeaderCalls(res)).toEqual([
      ["X-Robots-Tag", "noindex, nofollow"],
    ]);
  });

  it("sets no robots header when indexing is on", async () => {
    mockSeoAndFeedApis(true);
    const res: FakeResponse = fakeResponse();

    await handler(customDomainRequest(), res as unknown as ExpressResponse);

    expect(robotsHeaderCalls(res)).toEqual([]);
  });

  it("still answers 404 for a page that cannot be resolved", async () => {
    /*
     * The header is applied only after the page resolves, so the 404 path
     * must still 404 and must not have started emitting one.
     */
    (jest.spyOn(API, "get") as unknown as SpiedApi).mockResolvedValue(
      new HTTPErrorResponse(500, {}, {}),
    );
    const res: FakeResponse = fakeResponse();

    await handler(customDomainRequest(), res as unknown as ExpressResponse);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(robotsHeaderCalls(res)).toEqual([]);
  });
});
