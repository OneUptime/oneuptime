import { afterEach, describe, expect, jest, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT THE DASHBOARD READS OF A REPORT (#11009): the FOCUS file the Costs
 * page's Export FOCUS downloads - the file itself, as the API's text
 * answer holds it - a report's preview and Send Me a Copy, and the days,
 * basis and view a report's Open Costs link opens Costs on.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { projectid: "p-1" };
      },
    },
  };
});

import {
  fetchCloudCostFocusExport,
  fetchCloudCostReportPreview,
  sendCloudCostReportCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Reports/CloudCostReportApi";
import { readCloudCostLinkedView } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostLinkedView";

const REPORT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000f0001");
const VIEW: string = "0192f1a0-1100-7000-8000-0000000e0001";

afterEach(() => {
  postMock.mockReset();
});

describe("Export FOCUS", () => {
  test("downloads the file itself, as the API's text answer holds it", async () => {
    const focus: string =
      'BilledCost,BillingAccountId\n10,"999999999999"\n';
    // As Common's API makes a text answer: { data: <text> }, isText.
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, focus as never, {}) as never,
    );

    const text: string = await fetchCloudCostFocusExport({
      startDate: new Date("2026-11-01T00:00:00.000Z"),
      endDate: new Date("2026-11-30T23:59:59.999Z"),
      cloudAccountIds: [new ObjectID("0192f1a0-1100-7000-8000-00000000ac01")],
    });

    expect(text).toBe(focus);

    const asked: {
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    } = postMock.mock.calls[0]![0] as never;
    expect(asked.url.toString()).toContain("/cloud-cost/export");
    expect(asked.data).toEqual({
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-30T23:59:59.999Z",
      cloudAccountIds: ["0192f1a0-1100-7000-8000-00000000ac01"],
    });
    expect(asked.headers).toEqual({ projectid: "p-1", Accept: "text/csv" });
  });

  test("a refusal is thrown as the API said it", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "A FOCUS export covers at most 93 days." },
      {},
    );
    postMock.mockResolvedValue(refusal as never);

    await expect(
      fetchCloudCostFocusExport({
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-11-30T00:00:00.000Z"),
      }),
    ).rejects.toBe(refusal);
  });
});

describe("a report's preview and copy", () => {
  test("the preview is the report's content, read as the person may read it", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { reportName: "Weekly cloud costs", currency: "USD" },
        {},
      ) as never,
    );

    expect(await fetchCloudCostReportPreview(REPORT)).toMatchObject({
      reportName: "Weekly cloud costs",
      currency: "USD",
    });
    expect(
      String((postMock.mock.calls[0]![0] as { url: unknown }).url),
    ).toContain(`/cloud-cost-report/${REPORT.toString()}/preview`);
  });

  test("Send Me a Copy says where it went", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { sentTo: "alice@example.com" }, {}) as never,
    );

    expect(await sendCloudCostReportCopy(REPORT)).toBe("alice@example.com");
    expect(
      String((postMock.mock.calls[0]![0] as { url: unknown }).url),
    ).toContain(`/cloud-cost-report/${REPORT.toString()}/send-copy`);
  });
});

describe("what a report's Open Costs link opens", () => {
  test("its days, basis and view's groups", () => {
    expect(
      readCloudCostLinkedView(
        `?start=2026-11-16&end=2026-11-22&basis=amortized&by=group&view=${VIEW}`,
      ),
    ).toEqual({
      start: "2026-11-16",
      lastDay: "2026-11-22",
      basis: CloudCostBasis.Amortized,
      by: "group",
      viewId: VIEW,
    });
  });

  test("anything named wrongly is left out, so Costs opens as it would", () => {
    expect(
      readCloudCostLinkedView(
        "?start=2026-11-22&end=2026-11-16&basis=list&by=colour&view=not-an-id",
      ),
    ).toEqual({});
    expect(readCloudCostLinkedView("?start=2026-02-30&end=2026-03-01")).toEqual(
      {},
    );
    expect(readCloudCostLinkedView("")).toEqual({});
    expect(readCloudCostLinkedView("?basis=net")).toEqual({
      basis: CloudCostBasis.Net,
    });
  });
});
