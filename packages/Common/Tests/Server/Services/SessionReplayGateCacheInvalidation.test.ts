import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";

/*
 * The session replay gate caches its resolved policy per pod, and the config
 * endpoint is cached in the browser on top of that. Without invalidation from
 * the services that own the policy rows, turning replay off keeps being
 * accepted for roughly six minutes fleet-wide - which is exactly why the
 * Redis kill key exists.
 *
 * The regression these tests guard is the one the reviewer found: the kill
 * key had NO production writer at all, so isProjectKilled always returned
 * false and the fast path was dead code (the
 * MetricPipelineRuleService.clearCache()-with-no-callers pattern).
 */

const markProjectDisabledMock: ReturnType<typeof jest.fn> = jest.fn();
const clearProjectDisabledMock: ReturnType<typeof jest.fn> = jest.fn();
const clearCacheMock: ReturnType<typeof jest.fn> = jest.fn();

jest.mock(
  "../../../Server/Utils/SessionReplay/SessionReplayGateCacheStore",
  () => {
    return {
      __esModule: true,
      default: {
        markProjectDisabled: markProjectDisabledMock,
        clearProjectDisabled: clearProjectDisabledMock,
        clearCache: clearCacheMock,
      },
    };
  },
);

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

import ProjectService from "../../../Server/Services/ProjectService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";

const PROJECT_ID: ObjectID = ObjectID.generate();

/*
 * The hooks are protected, which is the whole point - they are called by
 * DatabaseService, not by feature code. Reaching them through an index cast
 * is how their behaviour can be pinned without standing up Postgres.
 */
type HookCallable = {
  onUpdateSuccess: (
    onUpdate: unknown,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<unknown>;
  onDeleteSuccess: (
    onDelete: unknown,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<unknown>;
};

function asHooks(service: unknown): HookCallable {
  return service as unknown as HookCallable;
}

describe("RumApplicationService invalidates the session replay gate cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("disabling an application writes the kill key AND drops the policy cache", async () => {
    await asHooks(RumApplicationService).onUpdateSuccess(
      {
        updateBy: {
          data: { isSessionReplayEnabled: false },
          props: { tenantId: PROJECT_ID },
        },
      },
      [ObjectID.generate()],
    );

    expect(clearCacheMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(markProjectDisabledMock).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("re-enabling clears the kill key so the project is not stuck off", async () => {
    await asHooks(RumApplicationService).onUpdateSuccess(
      {
        updateBy: {
          data: { isSessionReplayEnabled: true },
          props: { tenantId: PROJECT_ID },
        },
      },
      [ObjectID.generate()],
    );

    expect(clearCacheMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(clearProjectDisabledMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(markProjectDisabledMock).not.toHaveBeenCalled();
  });

  test("a masking or origin change invalidates the cache without killing the project", async () => {
    await asHooks(RumApplicationService).onUpdateSuccess(
      {
        updateBy: {
          data: {
            sessionReplayAllowedOrigins: ["https://shop.example.com"],
          },
          props: { tenantId: PROJECT_ID },
        },
      },
      [ObjectID.generate()],
    );

    expect(clearCacheMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(markProjectDisabledMock).not.toHaveBeenCalled();
  });

  test("an unrelated update does not touch the gate cache at all", async () => {
    /*
     * A lastSeenAt heartbeat or a label change must never write a kill key -
     * that would stop replay for the whole project on every heartbeat.
     */
    await asHooks(RumApplicationService).onUpdateSuccess(
      {
        updateBy: {
          data: { otelCollectorStatus: "connected" },
          props: { tenantId: PROJECT_ID },
        },
      },
      [ObjectID.generate()],
    );

    expect(clearCacheMock).not.toHaveBeenCalled();
    expect(markProjectDisabledMock).not.toHaveBeenCalled();
    expect(clearProjectDisabledMock).not.toHaveBeenCalled();
  });

  test("deleting an application stops it recording immediately", async () => {
    await asHooks(RumApplicationService).onDeleteSuccess(
      {
        deleteBy: {
          props: { tenantId: PROJECT_ID },
        },
      },
      [ObjectID.generate()],
    );

    expect(clearCacheMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(markProjectDisabledMock).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("ProjectService invalidates the session replay gate cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("turning the org-wide allow flag off writes the kill key", async () => {
    await asHooks(ProjectService).onUpdateSuccess(
      {
        updateBy: {
          data: { isSessionReplayAllowed: false },
          props: {},
        },
      },
      [PROJECT_ID],
    );

    expect(clearCacheMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(markProjectDisabledMock).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("turning it back on clears the kill key", async () => {
    await asHooks(ProjectService).onUpdateSuccess(
      {
        updateBy: {
          data: { isSessionReplayAllowed: true },
          props: {},
        },
      },
      [PROJECT_ID],
    );

    expect(clearProjectDisabledMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(markProjectDisabledMock).not.toHaveBeenCalled();
  });

  test("an unrelated project update leaves the gate cache alone", async () => {
    await asHooks(ProjectService).onUpdateSuccess(
      {
        updateBy: {
          data: { name: "Renamed project" },
          props: {},
        },
      },
      [PROJECT_ID],
    );

    expect(clearCacheMock).not.toHaveBeenCalled();
    expect(markProjectDisabledMock).not.toHaveBeenCalled();
    expect(clearProjectDisabledMock).not.toHaveBeenCalled();
  });
});
