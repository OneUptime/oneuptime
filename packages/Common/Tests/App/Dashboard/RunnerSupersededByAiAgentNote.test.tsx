import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import RunnerView from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView";
import {
  KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE,
  NO_RUNNER_FORM_RESTRICTIONS,
  RunnerFormRestrictions,
  getKubernetesAgentRunnerFormNote,
  getRunnerFormFields,
  getRunnerCreateFormFields,
  getRunnerFormRestrictions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerFormFields";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Field from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

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
 * The Kubernetes AI agent — its own identity, never a Runner row — replaced
 * the in-cluster Runner the Kubernetes agent chart used to install, and the
 * server refuses that legacy Runner's registration while the agent is
 * online. The legacy rows keep their existing guards; their note now also
 * says they are superseded, what to do (upgrade the chart), and when the row
 * can go (once the AI agent is connected). Ordinary Runners say nothing of
 * the sort.
 */

const WAIT_TIMEOUT: number = 20000;

const AGENT_RUNNER_ID: string = "66666666-0000-4000-8000-0000000000a1";
const HOST_RUNNER_ID: string = "66666666-0000-4000-8000-0000000000a2";
const RENAMED_AGENT_RUNNER_ID: string = "66666666-0000-4000-8000-0000000000a3";

const AGENT_POSTURE: JSONObject = {
  kubernetes: {
    inCluster: true,
    allowWrites: false,
    clusterIdentifier: "prod-east",
  },
};

const PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

function makeRunnerRow(
  id: string,
  name: string,
  hostInfo?: JSONObject,
): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: "",
    key: "runner-key",
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
    canRunAiCommands: true,
    lastAlive: new Date("2026-09-23T10:00:00Z"),
    ...(hostInfo ? { hostInfo } : {}),
  });
}

const ROWS: Array<Runner> = [
  makeRunnerRow(AGENT_RUNNER_ID, "kubernetes-agent/prod-east", AGENT_POSTURE),
  makeRunnerRow(HOST_RUNNER_ID, "bash-runner"),
  makeRunnerRow(RENAMED_AGENT_RUNNER_ID, "prod-east-kubectl", AGENT_POSTURE),
];

function rowById(id: string): Runner {
  return ROWS.find((row: Runner): boolean => {
    return String(row._id) === id;
  })!;
}

describe("the superseded sentence", () => {
  test("names the replacement, the step and when the row can go", () => {
    expect(KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE).toContain(
      "superseded by the Kubernetes AI agent",
    );
    expect(KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE).toContain(
      "upgrade the Kubernetes agent chart",
    );
    expect(KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE).toContain(
      "this Runner can be deleted once the AI agent is connected",
    );
  });

  test.each<[string, RunnerFormRestrictions]>([
    [
      "name and switches locked",
      { isNameLocked: true, areShellCapabilitiesLocked: true },
    ],
    [
      "switches locked (an agent by posture alone)",
      { isNameLocked: false, areShellCapabilitiesLocked: true },
    ],
    [
      "name locked only",
      { isNameLocked: true, areShellCapabilitiesLocked: false },
    ],
  ])(
    "ends every kubernetes-agent row's note: %s",
    (_label: string, restrictions: RunnerFormRestrictions) => {
      const note: string | null =
        getKubernetesAgentRunnerFormNote(restrictions);

      expect(note).not.toBeNull();
      // The existing explanation is kept, first.
      expect(note).toMatch(
        /^This is the in-cluster Runner the Kubernetes agent chart installed\./,
      );
      expect(note).toContain("OneUptime refuses those changes");
      expect(note!.endsWith(KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE)).toBe(
        true,
      );
    },
  );

  test("is not said about an ordinary Runner", () => {
    expect(
      getKubernetesAgentRunnerFormNote(NO_RUNNER_FORM_RESTRICTIONS),
    ).toBeNull();
    expect(
      getKubernetesAgentRunnerFormNote(
        getRunnerFormRestrictions(rowById(HOST_RUNNER_ID)),
      ),
    ).toBeNull();
  });

  /*
   * A Runner is edited in one place, the Runner Details card on its own
   * page (the list page only creates): that form says it on a legacy row.
   */
  test("reaches the Runner page's edit form on a legacy row", () => {
    for (const row of [
      rowById(AGENT_RUNNER_ID),
      rowById(RENAMED_AGENT_RUNNER_ID),
    ]) {
      const restrictions: RunnerFormRestrictions =
        getRunnerFormRestrictions(row);

      const detailForm: Fields<Runner> = getRunnerFormFields({
        withSteps: false,
        restrictions,
      });

      const described: Array<string> = detailForm
        .map((field: Field<Runner>): string => {
          return String(field.sectionDescription || "");
        })
        .filter((description: string): boolean => {
          return description.length > 0;
        });
      expect(described.length).toBe(1);
      expect(described[0]).toContain(KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE);
    }
  });

  test("never reaches the create form", () => {
    const createForm: Fields<Runner> = getRunnerCreateFormFields();

    for (const field of createForm) {
      expect(String(field.sectionDescription || "")).not.toContain(
        "superseded",
      );
    }
  });
});

describe("the Runner detail page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue(PERMISSIONS);
    jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
      projectId: new ObjectID(PROJECT_ID),
      userId: ObjectID.generate(),
      permissions: PERMISSIONS.map((permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          _type: "UserPermission",
        };
      }),
      _type: "UserTenantAccessPermission",
    } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);

    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (args: unknown): Promise<Runner | null> => {
        return rowById(String((args as { id?: unknown }).id)) || null;
      });
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<ListResult<Runner>> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      });
    jest
      .spyOn(ModelAPI, "count")
      .mockImplementation(async (): Promise<number> => {
        return 0;
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  function openRunnerView(runnerId: string): void {
    const path: string = `/dashboard/${PROJECT_ID}/runbooks/runners/${runnerId}`;
    goTo(path);
    render(
      <MemoryRouter initialEntries={[path]}>
        <RunnerView
          pageRoute={RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  test("says a legacy kubernetes-agent Runner is superseded", async () => {
    openRunnerView(AGENT_RUNNER_ID);

    const note: HTMLElement = await screen.findByTestId(
      "kubernetes-agent-runner-note",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(note).toHaveTextContent(
      "This is the in-cluster Runner the Kubernetes agent chart installed.",
    );
    expect(note).toHaveTextContent(KUBERNETES_AGENT_RUNNER_SUPERSEDED_NOTE);
  });

  test("says nothing of the sort on an ordinary Runner", async () => {
    openRunnerView(HOST_RUNNER_ID);

    /*
     * The details show the name, and so does the Delete card at the foot of
     * the page ("Permanently delete bash-runner."), so it is found twice.
     */
    const names: Array<HTMLElement> = await screen.findAllByText(
      "bash-runner",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      names.some((element: HTMLElement) => {
        return (
          element.getAttribute("data-testid") !== "delete-confirmation-name"
        );
      }),
    ).toBe(true);
    expect(
      screen.queryByTestId("kubernetes-agent-runner-note"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/superseded/)).not.toBeInTheDocument();
  });
});
