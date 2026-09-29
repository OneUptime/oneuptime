/**
 * The /seo endpoint is the only channel by which the indexing opt-out reaches
 * the two servers that render status pages. Both of them call it over internal
 * HTTP, read one field off the JSON, and decide from that whether to emit a
 * noindex. If the field stops being in the response the toggle silently stops
 * working: the renderers read undefined, which means "indexable".
 *
 * So this pins the wire format, not just the code path.
 */

import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Select from "../../../Server/Types/Database/Select";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const SEO_ROUTE: string = "/status-page/seo/:statusPageIdOrDomain";

describe("StatusPageAPI /seo search engine indexing flag", () => {
  let statusPageId: ObjectID;
  let statusPage: StatusPage;
  let mockRequest: ExpressRequest;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    statusPageId = ObjectID.generate();

    statusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.name = "Acme Status";
    statusPage.pageTitle = "Acme Status";
    statusPage.pageDescription = "How Acme is doing.";

    jest
      .spyOn(StatusPageService, "resolveStatusPageIdOrNull")
      .mockResolvedValue(statusPageId);

    jest.spyOn(StatusPageService, "findOneBy").mockResolvedValue(statusPage);

    mockRequest = {
      params: {
        statusPageIdOrDomain: statusPageId.toString(),
      },
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    mockResponse = {
      set: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function callSeoRoute(): Promise<JSONObject> {
    await mockRouter
      .match("get", SEO_ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = (Response.sendJsonObjectResponse as jest.Mock)
      .mock.calls[0] as Array<unknown>;

    return call[2] as JSONObject;
  }

  it("selects the column, or the response could never carry it", async () => {
    /*
     * findOneBy only populates what is selected. A response built from an
     * unselected column reads as undefined, which the renderers treat as
     * indexable - the toggle would be on for everyone with no error anywhere.
     */
    await callSeoRoute();

    const selectArgument: Select<StatusPage> = (
      (StatusPageService.findOneBy as jest.Mock).mock.calls[0] as Array<{
        select: Select<StatusPage>;
      }>
    )[0]!.select;

    expect(selectArgument["enableSearchEngineIndexing"]).toBe(true);
  });

  it("reports a page with indexing left on as indexable", async () => {
    statusPage.enableSearchEngineIndexing = true;

    const body: JSONObject = await callSeoRoute();

    expect(body["enableSearchEngineIndexing"]).toBe(true);
  });

  it("reports a page whose owner turned indexing off", async () => {
    statusPage.enableSearchEngineIndexing = false;

    const body: JSONObject = await callSeoRoute();

    expect(body["enableSearchEngineIndexing"]).toBe(false);
  });

  it.each([
    ["never set", undefined],
    ["null out of the driver", null],
  ])(
    "normalises a row whose column is %s to indexable",
    async (_label: string, columnValue: unknown) => {
      /*
       * The migration backfills every row, so neither should happen in
       * practice - but the renderers must never receive a value they have to
       * interpret. Normalising here keeps that decision in one place, and
       * keeps it failing towards "indexable" rather than towards a silent
       * de-index.
       */
      (statusPage as unknown as Record<string, unknown>)[
        "enableSearchEngineIndexing"
      ] = columnValue;

      const body: JSONObject = await callSeoRoute();

      expect(body["enableSearchEngineIndexing"]).toBe(true);
    },
  );

  it("still returns everything the renderers already depended on", async () => {
    statusPage.enableSearchEngineIndexing = false;
    statusPage.defaultLanguage = "de";

    const body: JSONObject = await callSeoRoute();

    expect(body).toEqual({
      title: "Acme Status",
      description: "How Acme is doing.",
      _id: statusPageId.toString(),
      defaultLanguage: "de",
      enableSearchEngineIndexing: false,
    });
  });
});
