import { mockRouter } from "./Helpers";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DropFilterAPI from "../../../Server/API/DropFilterAPI";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import LogDropFilterService from "../../../Server/Services/LogDropFilterService";
import * as DropFilterImpactModule from "../../../Server/Utils/Telemetry/DropFilterImpact";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import { WRITE_WARNING_HEADER } from "../../../Types/API/WriteWarnings";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  DropFilterImpact,
  DropFilterImpactAction,
  DropFilterRecordCountState,
  getEmptyDropFilterImpact,
} from "../../../Types/Telemetry/DropFilterImpact";
import {
  getEmptyTelemetryFieldReadersByKind,
  TelemetryFieldReaderKind,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * A DROP FILTER WRITTEN THROUGH THE API SAYS WHAT IT TAKES (#10436).
 *
 * A create or an update with an API key - a script, Terraform - is never
 * asked to confirm: it is saved, and when the filter it leaves on takes
 * what others read, its answer says so in an X-OneUptime-Write-Warning
 * header. The Dashboard's own writes are not slowed by it: its form
 * already said. The write itself, and the impact, are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000104390",
);
const FILTER_ID: string = "0192f1a0-0000-7000-8000-000000104391";

function propsOf(userType: UserType): DatabaseCommonInteractionProps {
  return { tenantId: PROJECT_ID, userType };
}

function impactRead(): DropFilterImpact {
  const impact: DropFilterImpact = getEmptyDropFilterImpact({
    signal: "log",
    action: DropFilterImpactAction.Drop,
    keepPercentage: 0,
    timeLimitInSeconds: 10,
  });

  impact.count = {
    ...impact.count,
    state: DropFilterRecordCountState.Counted,
    matched: 40,
    total: 100,
  };
  impact.readers = getEmptyTelemetryFieldReadersByKind(true);
  impact.readers[TelemetryFieldReaderKind.Monitor].hiddenCount = 2;
  impact.securityEvents.isChecked = true;

  return impact;
}

function impactUnread(): DropFilterImpact {
  const impact: DropFilterImpact = impactRead();

  impact.readers = getEmptyTelemetryFieldReadersByKind(true);

  return impact;
}

interface FakeResponse {
  headers: Map<string, string>;
  setHeader: jest.Mock;
  removeHeader: jest.Mock;
  headersSent: boolean;
}

function responseOf(): FakeResponse {
  const headers: Map<string, string> = new Map<string, string>();

  return {
    headers,
    headersSent: false,
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    removeHeader: jest.fn((name: string) => {
      headers.delete(name);
    }),
  };
}

function requestOf(data: { body: unknown; id?: string }): ExpressRequest {
  return {
    params: data.id ? { id: data.id } : {},
    query: {},
    headers: {},
    body: data.body,
  } as unknown as ExpressRequest;
}

const api: DropFilterAPI<LogDropFilter, typeof LogDropFilterService> =
  new DropFilterAPI(LogDropFilter, LogDropFilterService as never, "log");

let propsSpy: jest.SpyInstance;
let impactSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;

beforeEach(() => {
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(propsOf(UserType.API));
  impactSpy = jest
    .spyOn(DropFilterImpactModule, "findDropFilterImpact")
    .mockResolvedValue(impactRead());
  createSpy = jest
    .spyOn(BaseAPI.prototype, "createItem")
    .mockResolvedValue(undefined);
  updateSpy = jest
    .spyOn(BaseAPI.prototype, "updateItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create with an API key", () => {
  test("is saved, and its answer says what the filter takes", async () => {
    const res: FakeResponse = responseOf();

    await api.createItem(
      requestOf({
        body: {
          data: { name: "Checkout", filterQuery: "severityText = 'Error'" },
        },
      }),
      res as unknown as ExpressResponse,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(res.headers.get(WRITE_WARNING_HEADER)).toBe(
      "2 monitors read logs this filter drops. Ask POST /api/telemetry/logs/drop-filter-impact with the filter for which.",
    );
    expect(
      (impactSpy.mock.calls[0]![0] as { request: unknown }).request,
    ).toEqual({
      signal: "log",
      filterQuery: "severityText = 'Error'",
      action: "drop",
      name: "Checkout",
    });
  });

  test("that nothing reads is saved with nothing said", async () => {
    impactSpy.mockResolvedValue(impactUnread());

    const res: FakeResponse = responseOf();

    await api.createItem(
      requestOf({ body: { data: { filterQuery: "severityText = 'Debug'" } } }),
      res as unknown as ExpressResponse,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  test("of a filter left off takes nothing yet: nothing is worked out", async () => {
    const res: FakeResponse = responseOf();

    await api.createItem(
      requestOf({
        body: {
          data: { filterQuery: "severityText = 'Error'", isEnabled: false },
        },
      }),
      res as unknown as ExpressResponse,
    );

    expect(impactSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("that the save refuses carries no warning", async () => {
    createSpy.mockRejectedValue(new BadDataException("Filter query is wrong."));

    const res: FakeResponse = responseOf();

    await expect(
      api.createItem(
        requestOf({
          body: { data: { filterQuery: "severityText = 'Error'" } },
        }),
        res as unknown as ExpressResponse,
      ),
    ).rejects.toThrow("Filter query is wrong.");
    expect(res.removeHeader).toHaveBeenCalledWith(WRITE_WARNING_HEADER);
    expect(res.headers.has(WRITE_WARNING_HEADER)).toBe(false);
  });

  test("of a filter the save will refuse is not worked out, and the save says why", async () => {
    const res: FakeResponse = responseOf();

    await api.createItem(
      requestOf({ body: { data: { filterQuery: "" } } }),
      res as unknown as ExpressResponse,
    );

    expect(impactSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("whose impact cannot be worked out is saved all the same", async () => {
    impactSpy.mockRejectedValue(new Error("ClickHouse is away"));

    const res: FakeResponse = responseOf();

    await api.createItem(
      requestOf({ body: { data: { filterQuery: "severityText = 'Error'" } } }),
      res as unknown as ExpressResponse,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

describe("a write from the Dashboard", () => {
  test("is not slowed: its form said what the filter takes", async () => {
    propsSpy.mockResolvedValue(propsOf(UserType.User));

    const res: FakeResponse = responseOf();

    await api.createItem(
      requestOf({ body: { data: { filterQuery: "severityText = 'Error'" } } }),
      res as unknown as ExpressResponse,
    );

    expect(impactSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});

describe("an update with an API key", () => {
  test("turning a filter on says what it takes, read over the stored filter", async () => {
    const findSpy: jest.SpyInstance = jest
      .spyOn(LogDropFilterService, "findOneById")
      .mockResolvedValue({
        name: "Checkout",
        filterQuery: "severityText = 'Error'",
        action: "sample",
        samplePercentage: 10,
        isEnabled: false,
      } as never);
    const res: FakeResponse = responseOf();

    await api.updateItem(
      requestOf({ id: FILTER_ID, body: { data: { isEnabled: true } } }),
      res as unknown as ExpressResponse,
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    // Read as the caller: a filter they may not read says nothing.
    expect(
      (findSpy.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps })
        .props.userType,
    ).toBe(UserType.API);
    expect(
      (impactSpy.mock.calls[0]![0] as { request: unknown }).request,
    ).toEqual({
      signal: "log",
      filterQuery: "severityText = 'Error'",
      action: "sample",
      samplePercentage: 10,
      name: "Checkout",
    });
    expect(res.headers.has(WRITE_WARNING_HEADER)).toBe(true);
  });

  test("of a name or a description changes nothing it takes: nothing is worked out", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(
      LogDropFilterService,
      "findOneById",
    );
    const res: FakeResponse = responseOf();

    await api.updateItem(
      requestOf({ id: FILTER_ID, body: { data: { name: "Renamed" } } }),
      res as unknown as ExpressResponse,
    );

    expect(findSpy).not.toHaveBeenCalled();
    expect(impactSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  test("turning a filter off takes nothing: nothing is said", async () => {
    jest.spyOn(LogDropFilterService, "findOneById").mockResolvedValue({
      name: "Checkout",
      filterQuery: "severityText = 'Error'",
      action: "drop",
      isEnabled: true,
    } as never);

    const res: FakeResponse = responseOf();

    await api.updateItem(
      requestOf({ id: FILTER_ID, body: { data: { isEnabled: false } } }),
      res as unknown as ExpressResponse,
    );

    expect(impactSpy).not.toHaveBeenCalled();
  });

  test("of a filter the caller may not read says nothing, and the update says why", async () => {
    jest.spyOn(LogDropFilterService, "findOneById").mockResolvedValue(null);

    const res: FakeResponse = responseOf();

    await api.updateItem(
      requestOf({
        id: FILTER_ID,
        body: { data: { filterQuery: "severityText = 'Debug'" } },
      }),
      res as unknown as ExpressResponse,
    );

    expect(impactSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
