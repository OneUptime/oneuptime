import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, renderHook, RenderHookResult } from "@testing-library/react";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../App/Dashboard/CappedListServer";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  TelemetryServicesOnPage,
  useTelemetryServicesOnPage,
} from "../../../UI/Utils/TelemetryServicesOnPage";

/*
 * THE SERVICES A PAGE OF TELEMETRY NAMES, READ BY THEIR IDS - in Common
 * since #11072, where the logs explorer reads them too. Each id is read
 * once, in pages, past any number of services; whether a read has
 * answered (with a service, or with none) is what lets the logs explorer
 * hold an id back from the entity resolver until then.
 */

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000001";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const RUM_ID: string = "22222222-0000-4000-8000-000000000001";

let server: CappedListServer;

const idsIn: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  return value instanceof Includes
    ? value.values.map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
    : [];
};

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  server = new CappedListServer();
  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: LATE_ID, name: "wbkiosk-payments", serviceColor: "#22c55e" },
  ]);
  server.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const renderServices: () => RenderHookResult<
  TelemetryServicesOnPage,
  unknown
> = (): RenderHookResult<TelemetryServicesOnPage, unknown> => {
  return renderHook(() => {
    return useTelemetryServicesOnPage();
  });
};

describe("useTelemetryServicesOnPage", () => {
  test("a service past the project's first 10,000 is read by its id, and named", async () => {
    const hook: RenderHookResult<TelemetryServicesOnPage, unknown> =
      renderServices();

    await act(async () => {
      await hook.result.current.readServicesOf([LATE_ID]);
    });

    expect(hook.result.current.getService(LATE_ID)?.name).toBe(
      "wbkiosk-payments",
    );
    expect(hook.result.current.knownServices.get(LATE_ID)?.name).toBe(
      "wbkiosk-payments",
    );

    const reads: Array<CappedListCall> = server.callsFor(Service);
    expect(reads).toHaveLength(1);
    expect(idsIn(reads[0]!.query["_id"])).toEqual([LATE_ID]);
  });

  test("each id is read once, however often it is asked for", async () => {
    const hook: RenderHookResult<TelemetryServicesOnPage, unknown> =
      renderServices();

    await act(async () => {
      await hook.result.current.readServicesOf([
        LATE_ID,
        LATE_ID.toUpperCase(),
      ]);
      await hook.result.current.readServicesOf([LATE_ID]);
    });

    expect(server.callsFor(Service)).toHaveLength(1);
  });

  test("an id has answered once its read lands - with its service, or with none", async () => {
    const hook: RenderHookResult<TelemetryServicesOnPage, unknown> =
      renderServices();

    expect(hook.result.current.isAnswered(LATE_ID)).toBe(false);

    await act(async () => {
      await hook.result.current.readServicesOf([LATE_ID, RUM_ID]);
    });

    expect(hook.result.current.isAnswered(LATE_ID)).toBe(true);
    // A RUM application's id: no service, but answered all the same.
    expect(hook.result.current.isAnswered(RUM_ID)).toBe(true);
    expect(hook.result.current.getService(RUM_ID)).toBeUndefined();
    expect(hook.result.current.isAnswered(undefined)).toBe(false);
  });

  test("a failed read has not answered, says why, and Try again reads it again", async () => {
    // ModelAPI.getList is generic: its spy is held as the codebase holds one.
    const getList: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ModelAPI,
      "getList",
    ).mockRejectedValueOnce(new Error("The services could not be read."));
    const hook: RenderHookResult<TelemetryServicesOnPage, unknown> =
      renderServices();

    await act(async () => {
      await hook.result.current.readServicesOf([LATE_ID]);
    });

    expect(hook.result.current.isAnswered(LATE_ID)).toBe(false);
    expect(hook.result.current.error).not.toBe("");

    getList.mockImplementation((async (
      options: Parameters<typeof ModelAPI.getList>[0],
    ) => {
      return server.list(options as never);
    }) as never);

    await act(async () => {
      await hook.result.current.retry();
    });

    expect(hook.result.current.error).toBe("");
    expect(hook.result.current.isAnswered(LATE_ID)).toBe(true);
    expect(hook.result.current.getService(LATE_ID)?.name).toBe(
      "wbkiosk-payments",
    );
  });

  test("the project's own id is the synthetic Unknown Service, never read", async () => {
    const hook: RenderHookResult<TelemetryServicesOnPage, unknown> =
      renderServices();

    await act(async () => {
      await hook.result.current.readServicesOf([PROJECT_ID]);
    });

    expect(server.callsFor(Service)).toHaveLength(0);
    expect(hook.result.current.getService(PROJECT_ID)?.name).toBeTruthy();
  });
});
