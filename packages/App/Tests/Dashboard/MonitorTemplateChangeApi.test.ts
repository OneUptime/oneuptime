import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  MonitorTemplateChangeKind,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeStatus,
} from "Common/Types/Monitor/MonitorTemplateChange";

/*
 * The calls the dialogs that change monitors' template make (issues #11260,
 * #11266): the routes and bodies, with the project's headers, and what is
 * made of the answers - a refusal thrown so the dialog shows its words, and
 * a 2xx answer that does not describe a change never read as "no change".
 * The browser-bound modules it imports are mocked: Common/UI/Config reads
 * `window` at import time.
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  getActiveMonitorTemplateChanges,
  getMonitorTemplateChange,
  retryMonitorTemplateChange,
  startMonitorTemplateChange,
  stopMonitorTemplateChange,
  unlinkOneMonitor,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi";

const getMock: jest.Mock = API.get as unknown as jest.Mock;
const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "3f1b6b0e-0000-4000-8000-0000000000aa",
};

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "60000000-0000-4000-8000-000000000001";
const CHANGE_ID: string = "70000000-0000-4000-8000-000000000001";

interface CallOptions {
  url: URL;
  data?: JSONObject;
  headers: Dictionary<string>;
}

function lastCall(mock: jest.Mock): CallOptions {
  const calls: Array<Array<unknown>> = mock.mock.calls as Array<Array<unknown>>;
  return calls[calls.length - 1]![0] as CallOptions;
}

const CHANGE: JSONObject = {
  id: CHANGE_ID,
  status: MonitorTemplateChangeStatus.Queued,
  settings: {
    kind: MonitorTemplateChangeKind.Link,
    applyTemplateSettings: true,
    clearTemplateSettings: false,
    deleteTemplateWhenDone: false,
  },
  monitorTemplateId: TEMPLATE_ID,
  progress: { total: 2 },
  lines: [],
};

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
});

describe("starting a change of many monitors", () => {
  test("posts the template, the settings and the monitors picked, with the project's headers", async () => {
    postMock.mockResolvedValue(ok({ change: CHANGE }));

    const started: { id: string } = await startMonitorTemplateChange({
      monitorTemplateId: TEMPLATE_ID,
      settings: {
        kind: MonitorTemplateChangeKind.Link,
        applyTemplateSettings: true,
        clearTemplateSettings: false,
        deleteTemplateWhenDone: false,
      },
      monitorIds: [MONITOR_ID],
    });

    const call: CallOptions = lastCall(postMock);

    expect(started.id).toBe(CHANGE_ID);
    expect(call.url.toString()).toBe(
      "http://localhost/api/monitor-template-change/start",
    );
    expect(call.headers).toEqual(TENANT_HEADERS);
    expect(call.data).toEqual({
      monitorTemplateId: TEMPLATE_ID,
      settings: {
        kind: MonitorTemplateChangeKind.Link,
        applyTemplateSettings: true,
        clearTemplateSettings: false,
        deleteTemplateWhenDone: false,
      },
      monitorIds: [MONITOR_ID],
    });
  });

  test("a delete that clears its monitors first asks for every monitor linked to the template, none named", async () => {
    postMock.mockResolvedValue(ok({ change: CHANGE }));

    await startMonitorTemplateChange({
      monitorTemplateId: TEMPLATE_ID,
      settings: {
        kind: MonitorTemplateChangeKind.Unlink,
        applyTemplateSettings: false,
        clearTemplateSettings: true,
        deleteTemplateWhenDone: true,
      },
      allLinkedToTemplate: true,
    });

    expect(lastCall(postMock).data).toEqual({
      monitorTemplateId: TEMPLATE_ID,
      settings: {
        kind: MonitorTemplateChangeKind.Unlink,
        applyTemplateSettings: false,
        clearTemplateSettings: true,
        deleteTemplateWhenDone: true,
      },
      allLinkedToTemplate: true,
    });
  });

  test("an unlink from the Monitors list names no template: each monitor is unlinked from its own", async () => {
    postMock.mockResolvedValue(ok({ change: CHANGE }));

    await startMonitorTemplateChange({
      settings: {
        kind: MonitorTemplateChangeKind.Unlink,
        applyTemplateSettings: false,
        clearTemplateSettings: false,
        deleteTemplateWhenDone: false,
      },
      monitorIds: [MONITOR_ID],
    });

    expect(lastCall(postMock).data).not.toHaveProperty("monitorTemplateId");
  });

  test("a refusal is thrown as it came, for the dialog to say it", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "Pick at most 10,000 monitors." },
      {},
    );
    postMock.mockResolvedValue(refusal);

    await expect(
      startMonitorTemplateChange({
        monitorTemplateId: TEMPLATE_ID,
        settings: {
          kind: MonitorTemplateChangeKind.Link,
          applyTemplateSettings: true,
          clearTemplateSettings: false,
          deleteTemplateWhenDone: false,
        },
        monitorIds: [MONITOR_ID],
      }),
    ).rejects.toBe(refusal);
  });

  test("a 2xx answer that describes no change is not read as one", async () => {
    postMock.mockResolvedValue(ok({}));

    await expect(
      startMonitorTemplateChange({
        monitorTemplateId: TEMPLATE_ID,
        settings: {
          kind: MonitorTemplateChangeKind.Link,
          applyTemplateSettings: true,
          clearTemplateSettings: false,
          deleteTemplateWhenDone: false,
        },
        monitorIds: [MONITOR_ID],
      }),
    ).rejects.toThrow(
      "The answer from the server could not be read. Reload the page, then try again.",
    );
  });
});

describe("following a change", () => {
  test("reads it, its first lines or all of them", async () => {
    getMock.mockResolvedValue(ok({ change: CHANGE }));

    await getMonitorTemplateChange(CHANGE_ID);
    expect(lastCall(getMock).url.toString()).toBe(
      `http://localhost/api/monitor-template-change/change/${CHANGE_ID}`,
    );

    await getMonitorTemplateChange(CHANGE_ID, { allLines: true });
    expect(lastCall(getMock).url.toString()).toBe(
      `http://localhost/api/monitor-template-change/change/${CHANGE_ID}?lines=all`,
    );
    expect(lastCall(getMock).headers).toEqual(TENANT_HEADERS);
  });

  test("stops and retries it", async () => {
    postMock.mockResolvedValue(ok({ change: CHANGE }));

    await stopMonitorTemplateChange(CHANGE_ID);
    expect(lastCall(postMock).url.toString()).toBe(
      `http://localhost/api/monitor-template-change/change/${CHANGE_ID}/stop`,
    );

    await retryMonitorTemplateChange(CHANGE_ID);
    expect(lastCall(postMock).url.toString()).toBe(
      `http://localhost/api/monitor-template-change/change/${CHANGE_ID}/retry`,
    );
  });

  test("lists the template's changes still running, leaving out what it cannot read", async () => {
    getMock.mockResolvedValue(ok({ changes: [CHANGE, { id: 7 }] }));

    const changes: Array<{ id: string }> =
      await getActiveMonitorTemplateChanges(TEMPLATE_ID);

    expect(lastCall(getMock).url.toString()).toBe(
      `http://localhost/api/monitor-template-change/template/${TEMPLATE_ID}/active`,
    );
    expect(
      changes.map((change: { id: string }): string => {
        return change.id;
      }),
    ).toEqual([CHANGE_ID]);
  });
});

describe("one monitor's Unlink from Template, at once", () => {
  test("posts to the template's unlink-monitor route, with whether its criteria are cleared", async () => {
    postMock.mockResolvedValue(
      ok({
        outcome: MonitorTemplateChangeOutcome.Changed,
        resolvedIncidentCount: 2,
        resolvedAlertCount: 1,
      }),
    );

    const result: {
      outcome: MonitorTemplateChangeOutcome;
      resolvedIncidentCount: number;
      resolvedAlertCount: number;
    } = await unlinkOneMonitor({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: MONITOR_ID,
      clearTemplateSettings: true,
    });

    const call: CallOptions = lastCall(postMock);

    expect(call.url.toString()).toBe(
      `http://localhost/api/monitor-template/${TEMPLATE_ID}/unlink-monitor/${MONITOR_ID}`,
    );
    expect(call.data).toEqual({ clearTemplateSettings: true });
    expect(call.headers).toEqual(TENANT_HEADERS);
    expect(result).toEqual({
      outcome: MonitorTemplateChangeOutcome.Changed,
      resolvedIncidentCount: 2,
      resolvedAlertCount: 1,
    });
  });

  test("an answer without counts reads as none resolved, never as a negative or a fraction", async () => {
    postMock.mockResolvedValue(
      ok({
        outcome: MonitorTemplateChangeOutcome.Unchanged,
        resolvedIncidentCount: -3,
        resolvedAlertCount: "x",
      }),
    );

    expect(
      await unlinkOneMonitor({
        monitorTemplateId: TEMPLATE_ID,
        monitorId: MONITOR_ID,
        clearTemplateSettings: false,
      }),
    ).toEqual({
      outcome: MonitorTemplateChangeOutcome.Unchanged,
      resolvedIncidentCount: 0,
      resolvedAlertCount: 0,
    });
  });
});
