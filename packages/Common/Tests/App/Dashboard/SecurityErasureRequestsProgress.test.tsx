import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityErasureRequestsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/ErasureRequests";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { ERASURE_REQUEST_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ErasureRequests/ErasureRequestCells";
import {
  ERASING_LINE,
  ERASURE_PROGRESS_REFRESH_IN_MS,
  QUEUED_LINE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ErasureRequests/ErasureRequestCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityUserErasureRequest from "../../../Models/DatabaseModels/SecurityUserErasureRequest";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SecurityUserErasureRequestStatus } from "../../../Types/SecurityEvent/SecurityUserErasure";
import {
  SECURITY_USER_ERASURE_PROGRESS_PATH,
  SecurityUserErasureProgressLine,
  SecurityUserErasureStage,
  progressLinesToJSON,
} from "../../../Types/SecurityEvent/SecurityUserErasureProgressLine";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * Security Events > Settings > Erasure Requests, while a request reads
 * Erasing (#11232): rendered for real - the page, its list and each row's
 * status cell - with the network and the permission snapshot stubbed.
 *
 *   - under Erasing, the line says how far the request has got, from the
 *     server's narrow read of the worker's progress: which pass of the
 *     Detection Findings, and up to when; or when the final check starts;
 *   - a request the server has no line for, or a Queued one, says what it
 *     always said;
 *   - the page asks again every ERASURE_PROGRESS_REFRESH_IN_MS while a
 *     request is open and the page is in view, never while none is open or
 *     the tab is hidden, and reads the list again once a request moved on.
 */

configure({ asyncUtilTimeout: 15000 });

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/security-events/settings/erasure-requests`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(PAGE_PATH),
  currentProject: null,
  hasPaymentMethod: true,
};

const ERASING_ID: string = "11232000-0000-4000-8000-0000000000e1";
const QUEUED_ID: string = "11232000-0000-4000-8000-0000000000e2";
const ERASED_ID: string = "11232000-0000-4000-8000-0000000000e3";
const READ_UP_TO: string = "2026-11-24T16:00:00.123Z";

// The requests the list holds, and the lines the server answers, as each test sets them.
let listed: Array<SecurityUserErasureRequest> = [];
let lines: Array<SecurityUserErasureProgressLine> = [];
let progressAsks: number = 0;
let listReads: number = 0;
let ticks: Array<() => void> = [];

function requestOf(
  id: string,
  status: SecurityUserErasureRequestStatus,
): SecurityUserErasureRequest {
  const request: SecurityUserErasureRequest = new SecurityUserErasureRequest();

  request._id = id;
  request.projectId = new ObjectID(PROJECT_ID);
  request.status = status;
  request.reference = `DSR-${id.slice(-2)}`;
  request.requestedAt = new Date("2026-11-27T09:50:00.000Z");
  request.tokens = ["[HASHED:5e29db14e508e09a]"];

  if (status === SecurityUserErasureRequestStatus.Completed) {
    request.completedAt = new Date("2026-11-27T10:05:00.000Z");
  }

  return request;
}

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectUser,
    Permission.SecurityViewer,
  ]);

  listed = [
    requestOf(ERASING_ID, SecurityUserErasureRequestStatus.InProgress),
    requestOf(QUEUED_ID, SecurityUserErasureRequestStatus.Pending),
    requestOf(ERASED_ID, SecurityUserErasureRequestStatus.Completed),
  ];
  lines = [
    {
      requestId: ERASING_ID,
      status: SecurityUserErasureRequestStatus.InProgress,
      stage: SecurityUserErasureStage.ReadingFindings,
      pass: 1,
      readUpTo: READ_UP_TO,
    },
    {
      requestId: QUEUED_ID,
      status: SecurityUserErasureRequestStatus.Pending,
      stage: null,
    },
  ];
  progressAsks = 0;
  listReads = 0;
  ticks = [];

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<BaseModel>> => {
      listReads++;

      return {
        data: listed,
        count: listed.length,
        skip: 0,
        limit: 10,
      } as unknown as ListResult<BaseModel>;
    });

  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
  }): Promise<never> => {
    if (args.url.toString().endsWith(SECURITY_USER_ERASURE_PROGRESS_PATH)) {
      progressAsks++;

      return new HTTPResponse<JSONObject>(
        200,
        progressLinesToJSON(lines),
        {},
      ) as unknown as never;
    }

    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  }) as never);

  // The page's own timer is run by hand: one tick is one ERASURE_PROGRESS_REFRESH_IN_MS.
  const setInterval: typeof window.setInterval = window.setInterval;

  jest.spyOn(window, "setInterval").mockImplementation(((
    handler: () => void,
    timeout?: number,
  ): unknown => {
    if (timeout === ERASURE_PROGRESS_REFRESH_IN_MS) {
      ticks.push(handler);

      return 0;
    }

    return setInterval(handler, timeout);
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return "visible";
    },
  });
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderPage(): Promise<void> {
  goTo(PAGE_PATH);

  render(
    <MemoryRouter initialEntries={[PAGE_PATH]}>
      <SecurityErasureRequestsPage {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await screen.findAllByTestId(ERASURE_REQUEST_TEST_IDS.statusLine);
  await settle();
}

// What each row's status line says, by its reference.
function statusLines(): Array<string> {
  return screen
    .getAllByTestId(ERASURE_REQUEST_TEST_IDS.statusLine)
    .map((line: HTMLElement): string => {
      return line.textContent || "";
    });
}

async function tick(): Promise<void> {
  await act(async (): Promise<void> => {
    for (const handler of ticks) {
      handler();
    }
  });
  await settle();
}

describe("Erasure Requests, while a request reads Erasing (#11232)", () => {
  test("says how far it has got: the pass of the Detection Findings, and up to when", async () => {
    await renderPage();

    await waitFor(() => {
      expect(statusLines()).toContain(
        `Reading the Detection Findings: pass 1, up to ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(READ_UP_TO)}.`,
      );
    });

    // The others say what they always said.
    expect(statusLines()).toContain(QUEUED_LINE);
    expect(
      statusLines().some((line: string): boolean => {
        return line.startsWith("Erased ");
      }),
    ).toBe(true);
    expect(statusLines()).not.toContain(ERASING_LINE);
    expect(progressAsks).toBe(1);
  });

  test("once every change is applied, when the final check starts: a short wait, not a stuck one", async () => {
    lines[0] = {
      requestId: ERASING_ID,
      status: SecurityUserErasureRequestStatus.InProgress,
      stage: SecurityUserErasureStage.WaitingForFinalCheck,
      finalCheckAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
    };

    await renderPage();

    await waitFor(() => {
      expect(
        statusLines().some((line: string): boolean => {
          return line.startsWith("The final check starts in ");
        }),
      ).toBe(true);
    });
  });

  test("with no line from the server, the row says it is waiting for the last of it to be applied", async () => {
    lines = [];

    await renderPage();

    expect(statusLines()).toContain(ERASING_LINE);
  });

  test("a server that cannot say how far it has got leaves the rows as they were", async () => {
    jest.spyOn(API, "post").mockImplementation((async (): Promise<never> => {
      progressAsks++;

      return new HTTPErrorResponse(500, {}, {}) as unknown as never;
    }) as never);

    await renderPage();

    expect(progressAsks).toBe(1);
    expect(statusLines()).toContain(ERASING_LINE);
    expect(statusLines()).toContain(QUEUED_LINE);
  });

  test("asks again while a request is open, and reads the list again once one has moved on", async () => {
    await renderPage();

    expect(ticks.length).toBeGreaterThan(0);

    const readsBefore: number = listReads;

    // Nothing has moved on: the line is read again, the list is not.
    lines[0] = { ...lines[0]!, readUpTo: "2026-11-25T08:00:00.000Z" };
    await tick();

    expect(progressAsks).toBe(2);
    expect(listReads).toBe(readsBefore);
    await waitFor(() => {
      expect(statusLines()).toContain(
        `Reading the Detection Findings: pass 1, up to ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString("2026-11-25T08:00:00.000Z")}.`,
      );
    });

    // The worker finished it: the server has no line for it, and the list is read again.
    listed[0] = requestOf(
      ERASING_ID,
      SecurityUserErasureRequestStatus.Completed,
    );
    lines = lines.slice(1);
    await tick();

    await waitFor(() => {
      expect(listReads).toBeGreaterThan(readsBefore);
    });
    await waitFor(() => {
      expect(
        statusLines().filter((line: string): boolean => {
          return line.startsWith("Erased ");
        }),
      ).toHaveLength(2);
    });
  });

  test("a request the server and the list disagree on for good is read again at most once a tick, never in a loop", async () => {
    // A state the page reads as Queued, which the server counts as no open request.
    listed[1] = requestOf(
      QUEUED_ID,
      "Paused" as SecurityUserErasureRequestStatus,
    );
    lines = lines.slice(0, 1);

    await renderPage();

    const readsAtOpen: number = listReads;

    // Reading the lines as the list loads never reads the list again.
    expect(readsAtOpen).toBe(1);

    await tick();
    await tick();

    expect(listReads).toBe(readsAtOpen + 2);
    expect(progressAsks).toBeLessThanOrEqual(1 + 2 * 2);
  });

  test("asks nothing while the tab is hidden", async () => {
    await renderPage();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): DocumentVisibilityState => {
        return "hidden";
      },
    });

    await tick();

    expect(progressAsks).toBe(1);
  });

  test("with no request open, asks nothing at all", async () => {
    listed = [requestOf(ERASED_ID, SecurityUserErasureRequestStatus.Completed)];

    await renderPage();

    expect(progressAsks).toBe(0);
    expect(ticks).toHaveLength(0);
  });
});
