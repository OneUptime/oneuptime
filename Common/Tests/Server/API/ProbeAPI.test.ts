import ProbeAPI from "../../../Server/API/ProbeAPI";
import ProbeService from "../../../Server/Services/ProbeService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { describe, expect, it } from "@jest/globals";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../Types/JSON";
import PositiveNumber from "../../../Types/PositiveNumber";
import Probe from "../../../Models/DatabaseModels/Probe";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

jest.mock("../../../Server/Services/ProbeService");

type RequestOverrides = {
  body?: JSONObject | undefined;
  query?: JSONObject | undefined;
};

describe("ProbeAPI", () => {
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  const buildRequest: (overrides?: RequestOverrides) => ExpressRequest = (
    overrides: RequestOverrides = {},
  ): ExpressRequest => {
    return {
      body: overrides.body || {},
      query: overrides.query || {},
    } as unknown as ExpressRequest;
  };

  type CallGlobalProbesFunction = (
    overrides?: RequestOverrides,
  ) => Promise<ExpressRequest>;

  const callGlobalProbes: CallGlobalProbesFunction = async (
    overrides: RequestOverrides = {},
  ): Promise<ExpressRequest> => {
    const request: ExpressRequest = buildRequest(overrides);

    await mockRouter
      .match("post", "/probe/global-probes")
      .handlerFunction(request, mockResponse, nextFunction);

    return request;
  };

  beforeEach(() => {
    new ProbeAPI();
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();

    ProbeService.findBy = jest.fn().mockResolvedValue([]);
    ProbeService.countBy = jest.fn().mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("defaults", () => {
    it("should read the full select list when the caller asks for no fields", async () => {
      const mockProbes: Array<Probe> = [{ id: "probe" } as unknown as Probe];
      ProbeService.findBy = jest.fn().mockResolvedValue(mockProbes);

      const request: ExpressRequest = await callGlobalProbes();

      expect(ProbeService.findBy).toHaveBeenCalledWith({
        query: {
          isGlobalProbe: true,
        },
        select: {
          name: true,
          description: true,
          lastAlive: true,
          iconFileId: true,
          connectionStatus: true,
          shouldAutoEnableProbeOnNewMonitors: true,
        },
        sort: {},
        props: {
          isRoot: true,
        },
        skip: new PositiveNumber(0),
        limit: new PositiveNumber(DEFAULT_LIMIT),
      });

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendEntityArrayResponse",
      );
      expect(response).toHaveBeenCalledWith(
        request,
        mockResponse,
        mockProbes,
        expect.any(PositiveNumber),
        Probe,
      );
    });
  });

  describe("query", () => {
    it("should pass the caller's query through alongside isGlobalProbe", async () => {
      await callGlobalProbes({
        body: {
          query: {
            name: "probe-1",
          },
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            name: "probe-1",
            isGlobalProbe: true,
          },
        }),
      );
    });

    it("should not let the caller widen the read past global probes", async () => {
      await callGlobalProbes({
        body: {
          query: {
            isGlobalProbe: false,
          },
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            isGlobalProbe: true,
          },
        }),
      );
    });

    it("should reject a filter on a field outside the select list", async () => {
      await callGlobalProbes({
        body: {
          query: {
            key: "secret-probe-key",
          },
        },
      });

      expect(ProbeService.findBy).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledWith(expect.any(BadDataException));
    });

    it("should allow a multi field search over allowed fields", async () => {
      const search: MultiSearch = new MultiSearch({
        fields: ["name", "description"],
        value: "probe",
      });

      await callGlobalProbes({
        body: {
          query: {
            _multiFieldSearch: search.toJSON(),
          },
        },
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            _multiFieldSearch: expect.any(MultiSearch),
            isGlobalProbe: true,
          }),
        }),
      );
    });

    it("should reject a multi field search that reaches a field outside the select list", async () => {
      const search: MultiSearch = new MultiSearch({
        fields: ["name", "key"],
        value: "a",
      });

      await callGlobalProbes({
        body: {
          query: {
            _multiFieldSearch: search.toJSON(),
          },
        },
      });

      expect(ProbeService.findBy).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledWith(expect.any(BadDataException));
    });
  });

  describe("select", () => {
    it("should honour the caller's select", async () => {
      await callGlobalProbes({
        body: {
          select: {
            name: true,
            shouldAutoEnableProbeOnNewMonitors: true,
          },
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            name: true,
            shouldAutoEnableProbeOnNewMonitors: true,
          },
        }),
      );
    });

    it("should drop selected fields outside the select list", async () => {
      await callGlobalProbes({
        body: {
          select: {
            name: true,
            key: true,
            slug: true,
          },
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            name: true,
          },
        }),
      );
    });

    it("should not let an allowed field be turned into a relation select", async () => {
      await callGlobalProbes({
        body: {
          select: {
            name: {
              key: true,
            },
          },
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            name: true,
          },
        }),
      );
    });

    it("should fall back to the default select when nothing selectable is asked for", async () => {
      await callGlobalProbes({
        body: {
          select: {
            key: true,
          },
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            name: true,
            description: true,
            lastAlive: true,
            iconFileId: true,
            connectionStatus: true,
            shouldAutoEnableProbeOnNewMonitors: true,
          },
        }),
      );
    });
  });

  describe("sort", () => {
    it("should honour the caller's sort", async () => {
      await callGlobalProbes({
        body: {
          sort: {
            name: SortOrder.Descending,
          },
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: {
            name: SortOrder.Descending,
          },
        }),
      );
    });

    it("should reject a sort on a field outside the select list", async () => {
      await callGlobalProbes({
        body: {
          sort: {
            key: SortOrder.Ascending,
          },
        },
      });

      expect(ProbeService.findBy).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledWith(expect.any(BadDataException));
    });
  });

  describe("pagination", () => {
    it("should read skip and limit from the query string", async () => {
      await callGlobalProbes({
        query: {
          skip: "20",
          limit: "5",
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: new PositiveNumber(20),
          limit: new PositiveNumber(5),
        }),
      );
    });

    it("should read skip and limit from the body", async () => {
      await callGlobalProbes({
        body: {
          skip: 10,
          limit: 25,
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: new PositiveNumber(10),
          limit: new PositiveNumber(25),
        }),
      );
    });

    it("should prefer the query string over the body", async () => {
      await callGlobalProbes({
        body: {
          skip: 10,
          limit: 25,
        },
        query: {
          skip: "30",
          limit: "40",
        },
      });

      expect(ProbeService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: new PositiveNumber(30),
          limit: new PositiveNumber(40),
        }),
      );
    });

    it("should reject a limit above the per project maximum", async () => {
      await callGlobalProbes({
        body: {
          limit: 10001,
        },
      });

      expect(ProbeService.findBy).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledWith(
        expect.any(BadRequestException),
      );
    });
  });

  describe("count", () => {
    it("should return the real count rather than the size of the page", async () => {
      const mockProbes: Array<Probe> = [{ id: "probe" } as unknown as Probe];
      ProbeService.findBy = jest.fn().mockResolvedValue(mockProbes);
      ProbeService.countBy = jest
        .fn()
        .mockResolvedValue(new PositiveNumber(137));

      const request: ExpressRequest = await callGlobalProbes({
        query: {
          limit: "1",
        },
      });

      expect(ProbeService.countBy).toHaveBeenCalledWith({
        query: {
          isGlobalProbe: true,
        },
        props: {
          isRoot: true,
        },
      });

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendEntityArrayResponse",
      );
      expect(response).toHaveBeenCalledWith(
        request,
        mockResponse,
        mockProbes,
        new PositiveNumber(137),
        Probe,
      );
    });

    it("should count against the same filtered query the list used", async () => {
      await callGlobalProbes({
        body: {
          query: {
            name: "probe-1",
          },
        },
      });

      expect(ProbeService.countBy).toHaveBeenCalledWith({
        query: {
          name: "probe-1",
          isGlobalProbe: true,
        },
        props: {
          isRoot: true,
        },
      });
    });
  });

  it("should call next with an error if findBy throws", async () => {
    const testError: Error = new Error("Test error");
    ProbeService.findBy = jest.fn().mockRejectedValue(testError);

    await callGlobalProbes();

    expect(nextFunction).toHaveBeenCalledWith(testError);
  });
});
