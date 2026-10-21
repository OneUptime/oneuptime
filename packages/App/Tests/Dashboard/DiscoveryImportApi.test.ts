import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  DiscoveryImportAlerting,
  DiscoveryImportStatus,
  DiscoveryImportView,
} from "Common/Types/NetworkDevice/DiscoveryImport";

/*
 * The import dialog's calls to the discovery import API: the routes and
 * bodies it sends, with the project's headers, and what it makes of the
 * answers - a refusal thrown so the dialog shows its words, and a 2xx answer
 * that does not describe an import never read as "no import". The three
 * browser-bound modules it imports are mocked: Common/UI/Config reads
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
  DISCOVERY_IMPORT_ROUTES,
  getDiscoveryImport,
  getLatestDiscoveryImport,
  listActiveDiscoveryImports,
  retryDiscoveryImport,
  startDiscoveryImport,
  stopDiscoveryImport,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportApi";

const getMock: jest.Mock = API.get as unknown as jest.Mock;
const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "3f1b6b0e-0000-4000-8000-0000000000aa",
};

const IMPORT_ID: string = "5c6d7e8f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
const SCAN_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

interface CallOptions {
  url: URL;
  data?: JSONObject;
  headers: Dictionary<string>;
}

function lastCall(mock: jest.Mock): CallOptions {
  const calls: Array<Array<unknown>> = mock.mock.calls as Array<Array<unknown>>;
  return calls[calls.length - 1]![0] as CallOptions;
}

function importBody(overrides: JSONObject = {}): JSONObject {
  return {
    id: IMPORT_ID,
    scanId: SCAN_ID,
    status: DiscoveryImportStatus.Running,
    settings: {
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: DiscoveryImportAlerting.None,
    },
    progress: { hosts: 2, hostsDone: 1, devicesCreated: 1 },
    createdAt: "2026-10-15T09:00:00.000Z",
    isMine: true,
    ...overrides,
  };
}

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

function refused(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: message }, {});
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
});

describe("asking for an import", () => {
  test("posts the scan, the addresses and the settings to start, with the project's headers", async () => {
    postMock.mockResolvedValue(ok({ import: importBody() }));

    const view: DiscoveryImportView = await startDiscoveryImport({
      scanId: SCAN_ID,
      ipAddresses: ["10.0.0.1", "10.0.0.2"],
      settings: {
        pollingIntervalInMinutes: 1,
        applyVendorTemplates: false,
        alerting: DiscoveryImportAlerting.None,
      },
    });

    const call: CallOptions = lastCall(postMock);
    expect(call.url.toString()).toBe(
      "http://localhost/api/network-device-discovery-import/start",
    );
    expect(call.headers).toEqual(TENANT_HEADERS);
    expect(call.data).toEqual({
      scanId: SCAN_ID,
      ipAddresses: ["10.0.0.1", "10.0.0.2"],
      settings: {
        pollingIntervalInMinutes: 1,
        applyVendorTemplates: false,
        alerting: DiscoveryImportAlerting.None,
      },
    });
    expect(view.id).toBe(IMPORT_ID);
    expect(view.progress.devicesCreated).toBe(1);
  });

  test("a refusal is thrown with the server's words", async () => {
    postMock.mockResolvedValue(
      refused(400, "You may not create network devices in this project."),
    );

    await expect(
      startDiscoveryImport({
        scanId: SCAN_ID,
        ipAddresses: ["10.0.0.1"],
        settings: {
          pollingIntervalInMinutes: 5,
          applyVendorTemplates: true,
          alerting: DiscoveryImportAlerting.None,
        },
      }),
    ).rejects.toMatchObject({
      message: "You may not create network devices in this project.",
    });
  });

  test("an answer that does not describe the import is an error, never 'no import'", async () => {
    postMock.mockResolvedValue(ok({ import: null }));

    await expect(
      startDiscoveryImport({
        scanId: SCAN_ID,
        ipAddresses: ["10.0.0.1"],
        settings: {
          pollingIntervalInMinutes: 5,
          applyVendorTemplates: true,
          alerting: DiscoveryImportAlerting.None,
        },
      }),
    ).rejects.toThrow(
      "The server's answer did not describe the import. Reopen Review Results to see where it stands.",
    );
  });
});

describe("reading imports", () => {
  test("one import, and every host of it when asked", async () => {
    getMock.mockResolvedValue(ok({ import: importBody() }));

    await getDiscoveryImport(IMPORT_ID);
    expect(lastCall(getMock).url.toString()).toBe(
      `http://localhost/api/network-device-discovery-import/import/${IMPORT_ID}`,
    );
    expect(lastCall(getMock).headers).toEqual(TENANT_HEADERS);

    await getDiscoveryImport(IMPORT_ID, { allResults: true });
    expect(lastCall(getMock).url.toString()).toBe(
      `http://localhost/api/network-device-discovery-import/import/${IMPORT_ID}?results=all`,
    );
  });

  test("an id is put in the address as a path part, never as more of the path", () => {
    expect(DISCOVERY_IMPORT_ROUTES.import("../active")).toBe(
      "/network-device-discovery-import/import/..%2Factive",
    );
    expect(DISCOVERY_IMPORT_ROUTES.latestForScan("a b")).toBe(
      "/network-device-discovery-import/scan/a%20b/latest",
    );
  });

  test("the scan's latest import, or none", async () => {
    getMock.mockResolvedValue(ok({ import: importBody() }));
    const latest: DiscoveryImportView | null =
      await getLatestDiscoveryImport(SCAN_ID);

    expect(lastCall(getMock).url.toString()).toBe(
      `http://localhost/api/network-device-discovery-import/scan/${SCAN_ID}/latest`,
    );
    expect(latest?.id).toBe(IMPORT_ID);

    getMock.mockResolvedValue(ok({ import: null }));
    expect(await getLatestDiscoveryImport(SCAN_ID)).toBeNull();
  });

  test("the project's active imports, leaving out any this build cannot read", async () => {
    getMock.mockResolvedValue(
      ok({
        imports: [
          importBody(),
          importBody({ id: "other", status: "Paused" }),
          importBody({ id: "queued", status: DiscoveryImportStatus.Queued }),
        ],
      }),
    );

    const imports: Array<DiscoveryImportView> =
      await listActiveDiscoveryImports();

    expect(lastCall(getMock).url.toString()).toBe(
      "http://localhost/api/network-device-discovery-import/active",
    );
    expect(
      imports.map((view: DiscoveryImportView): string => {
        return view.id;
      }),
    ).toEqual([IMPORT_ID, "queued"]);

    getMock.mockResolvedValue(ok({}));
    expect(await listActiveDiscoveryImports()).toEqual([]);
  });

  test("a read that is refused is thrown", async () => {
    getMock.mockResolvedValue(
      refused(403, "You may not see this project's discovery scans."),
    );

    await expect(getDiscoveryImport(IMPORT_ID)).rejects.toMatchObject({
      message: "You may not see this project's discovery scans.",
    });
  });
});

describe("stopping and retrying", () => {
  test("stop posts to the import's stop route", async () => {
    postMock.mockResolvedValue(
      ok({ import: importBody({ isStopRequested: true }) }),
    );

    const view: DiscoveryImportView = await stopDiscoveryImport(IMPORT_ID);

    expect(lastCall(postMock).url.toString()).toBe(
      `http://localhost/api/network-device-discovery-import/import/${IMPORT_ID}/stop`,
    );
    expect(lastCall(postMock).data).toEqual({});
    expect(view.isStopRequested).toBe(true);
  });

  test("retry posts to the import's retry route and answers with the new import", async () => {
    postMock.mockResolvedValue(
      ok({
        import: importBody({
          id: "retry-import",
          retryOfImportId: IMPORT_ID,
          status: DiscoveryImportStatus.Queued,
        }),
      }),
    );

    const view: DiscoveryImportView = await retryDiscoveryImport(IMPORT_ID);

    expect(lastCall(postMock).url.toString()).toBe(
      `http://localhost/api/network-device-discovery-import/import/${IMPORT_ID}/retry`,
    );
    expect(view.id).toBe("retry-import");
    expect(view.retryOfImportId).toBe(IMPORT_ID);
  });
});
