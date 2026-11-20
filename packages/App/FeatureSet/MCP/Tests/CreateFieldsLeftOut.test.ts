/**
 * A create through the MCP server says which fields OneUptime left out
 * because only OneUptime writes them (#10136).
 *
 * An agent that copies a record - reads one, then creates another from it -
 * sends what OneUptime set on the first one too. The create goes through
 * without those fields (#10053) and names them in its answer's
 * X-OneUptime-Fields-Left-Out header (Common/Types/API/FieldsLeftOut):
 * OneUptimeApiService hands the answer's headers to its caller, the tool
 * handler reads the fields from them, and the tool's answer names them
 * (formatToolResponse). The HTTP layer is the API client's own post,
 * answered as the server answers.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import OneUptimeApiService from "../Services/OneUptimeApiService";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { OneUptimeToolCallArgs } from "../Types/McpTypes";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import { JSONObject } from "Common/Types/JSON";

const API_KEY: string = "test-api-key";

describe("a create through the MCP server", () => {
  beforeAll(() => {
    OneUptimeApiService.initialize({ url: "https://test.oneuptime.com" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function answerWith(headers: Headers): void {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          { _id: "new-1", name: "Berlin" },
          headers,
        ) as never,
      );
  }

  it("hands its caller the headers of the answer: the fields left out among them", async () => {
    answerWith({
      "content-type": "application/json",
      "x-oneuptime-fields-left-out": "createdByUserId, lastRollupAt",
    });
    let handed: Headers | null = null;

    const result: unknown = await OneUptimeApiService.executeOperation(
      "NetworkSite",
      OneUptimeOperation.Create,
      ModelType.Database,
      "/network-site",
      {
        name: "Berlin",
        createdByUserId: "u1",
        lastRollupAt: "2026-11-19T10:00:00.000Z",
      } as unknown as OneUptimeToolCallArgs,
      API_KEY,
      (headers: Headers): void => {
        handed = headers;
      },
    );

    expect((result as JSONObject)["_id"]).toBe("new-1");
    expect(handed).toEqual({
      "content-type": "application/json",
      "x-oneuptime-fields-left-out": "createdByUserId, lastRollupAt",
    });
  });

  it("a caller that asks for no headers is answered as before", async () => {
    answerWith({ "x-oneuptime-fields-left-out": "lastRollupAt" });

    const result: unknown = await OneUptimeApiService.executeOperation(
      "NetworkSite",
      OneUptimeOperation.Create,
      ModelType.Database,
      "/network-site",
      { name: "Berlin" } as unknown as OneUptimeToolCallArgs,
      API_KEY,
    );

    expect((result as JSONObject)["name"]).toBe("Berlin");
  });
});
