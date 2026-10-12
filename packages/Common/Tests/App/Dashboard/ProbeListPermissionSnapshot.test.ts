import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProbeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Probe";
import Probe from "../../../Models/DatabaseModels/Probe";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Whether a probe picker asks for the project's own probes, decided by the
 * real permission snapshot (PermissionGate.check on Probe's read list): the
 * probe readers, and whoever may read, create or edit monitors, a monitor's
 * probes or network devices, are asked; anyone else is not, and gets the
 * global probes only. A refusal of a list the snapshot says the user may
 * read is an error.
 */

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";

let getListMock: MockFunction;

function holdInProject(permissions: Array<Permission>): void {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem("is_master_admin", "false");
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  localStorage.setItem(
    "project_permissions",
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: permissions.map((permission: Permission) => {
        return { permission: permission };
      }),
    }),
  );
}

function namedProbe(name: string): Probe {
  const probe: Probe = new Probe();
  probe.name = name;
  return probe;
}

function listOf(probes: Array<Probe>): ListResult<Probe> {
  return { data: probes, count: probes.length, skip: 0, limit: probes.length };
}

function isGlobalListRequest(args: unknown): boolean {
  const requestUrl: string | undefined = (
    args as {
      requestOptions?: { overrideRequestUrl?: { toString: () => string } };
    }
  ).requestOptions?.overrideRequestUrl?.toString();

  return Boolean(requestUrl && requestUrl.includes("/probe/global-probes"));
}

function projectListRequests(): number {
  return getListMock.mock.calls.filter((call: Array<unknown>) => {
    return !isGlobalListRequest(call[0]);
  }).length;
}

beforeEach(() => {
  getListMock = getJestMockFunction();
  getListMock.mockImplementation(async (args: unknown) => {
    return isGlobalListRequest(args)
      ? listOf([namedProbe("US East")])
      : listOf([namedProbe("Office probe")]);
  });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(getListMock as unknown as typeof ModelAPI.getList);
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("ProbeUtil.getAllProbes - the permission snapshot decides who is asked about the project's probes", () => {
  test.each([
    Permission.CreateProjectMonitor,
    Permission.ReadProjectMonitor,
    Permission.EditMonitorProbe,
    Permission.CreateNetworkDevice,
    Permission.ProjectMember,
    Permission.ReadProjectProbe,
  ])(
    "a team holding only %s is asked, and gets the project's probes and the global ones",
    async (permission: Permission) => {
      holdInProject([permission]);

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();

      expect(projectListRequests()).toBe(1);
      expect(
        probes.map((probe: Probe) => {
          return [probe.name, probe.isGlobalProbe];
        }),
      ).toEqual([
        ["Office probe", false],
        ["US East", true],
      ]);
    },
  );

  test.each([Permission.BillingAdmin, Permission.ReadProjectLlm])(
    "a team holding only %s is not asked, and gets the global probes",
    async (permission: Permission) => {
      holdInProject([permission]);

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();

      expect(projectListRequests()).toBe(0);
      expect(
        probes.map((probe: Probe) => {
          return probe.name;
        }),
      ).toEqual(["US East"]);
    },
  );

  test("a refusal of a list the snapshot says the user may read is an error", async () => {
    holdInProject([Permission.CreateProjectMonitor]);

    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      422,
      { message: "You do not have permissions to read Probe." },
      {},
    );

    getListMock.mockImplementation(async (args: unknown) => {
      if (isGlobalListRequest(args)) {
        return listOf([namedProbe("US East")]);
      }

      throw refusal;
    });

    await expect(ProbeUtil.getAllProbes()).rejects.toBe(refusal);
  });

  test("before the snapshot lands, a refusal (422) is taken as no project probes", async () => {
    getListMock.mockImplementation(async (args: unknown) => {
      if (isGlobalListRequest(args)) {
        return listOf([namedProbe("US East")]);
      }

      throw new HTTPErrorResponse(
        422,
        { message: "You do not have permissions to read Probe." },
        {},
      );
    });

    const probes: Array<Probe> = await ProbeUtil.getAllProbes();

    expect(projectListRequests()).toBe(1);
    expect(
      probes.map((probe: Probe) => {
        return probe.name;
      }),
    ).toEqual(["US East"]);
  });
});
