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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

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

import RunnerView, {
  RUNNER_PROJECT_DEFAULT_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView";
import ProjectDefaultRunnerCopy, {
  PROJECT_DEFAULT_REFUSAL_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/ProjectDefaultRunnerCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ProjectDefaultRunnerRefusal } from "../../../Types/Runner/ProjectDefaultRunner";
import { getModelSwitchConfirmationWarningTestId } from "../../../UI/Components/ModelSwitch/ModelSwitchRow";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * THE PROJECT DEFAULT CARD, ON A RUNNER'S OWN PAGE.
 *
 * As a Twilio config is made the project default from its own form, a
 * Runner is from its page: one card, "Project Default", whose one switch
 * saves the moment it is flipped (ModelSwitchCard). It asks first, saying
 * which steps move - from the Global Runner, or from the Runner that is the
 * default now - and, as a warning of its own, that the Runner is not
 * connected when it is not. Off, its line names the Runner that is the
 * default now. A Runner that may not be the default (the Kubernetes agent
 * chart's in-cluster Runner, Runs Runbooks off) shows the switch locked,
 * its line saying why; the default itself can always stop being one. The
 * card follows Runner Status: what the Runner is and how it is doing come
 * first, then how the project uses it.
 */

const WAIT: { timeout: number } = { timeout: 20000 };

const OFFICE_ID: string = "99999999-0000-4000-8000-000000000001";
const PROD_ID: string = "99999999-0000-4000-8000-000000000002";

const ADMIN: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

let permissions: Array<Permission> = ADMIN;
let rows: Map<string, Runner>;
let writes: Array<{ id: string; data: Record<string, unknown> }> = [];

function makeRunner(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: "",
    key: "runner-key",
    canRunRunbooks: true,
    isProjectDefault: false,
    lastAlive: new Date(),
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();

  permissions = ADMIN;
  rows = new Map<string, Runner>([
    [OFFICE_ID, makeRunner(OFFICE_ID, "office-runner")],
    [
      PROD_ID,
      makeRunner(PROD_ID, "prod-eu-west-1", { isProjectDefault: true }),
    ],
  ]);
  writes = [];

  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockImplementation(() => {
    return {
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
    } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>;
  });

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (args: unknown): Promise<Runner | null> => {
      const row: Runner | undefined = rows.get(
        String((args as { id?: unknown }).id),
      );

      return row ? (Object.assign(new Runner(), row) as Runner) : null;
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (args: unknown): Promise<ListResult<Runner>> => {
      const query: Record<string, unknown> =
        (args as { query?: Record<string, unknown> }).query || {};
      const data: Array<Runner> =
        (args as { modelType: unknown }).modelType === Runner &&
        query["isProjectDefault"] === true
          ? Array.from(rows.values()).filter((row: Runner): boolean => {
              return row.isProjectDefault === true;
            })
          : [];

      return { data, count: data.length, skip: 0, limit: 10 };
    });

  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);

  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const call: { id: ObjectID; data: Record<string, unknown> } = args as {
        id: ObjectID;
        data: Record<string, unknown>;
      };

      writes.push({ id: call.id.toString(), data: call.data });

      for (const row of rows.values()) {
        if (row._id?.toString() === call.id.toString()) {
          Object.assign(row, call.data);
        } else if (call.data["isProjectDefault"] === true) {
          row.isProjectDefault = false;
        }
      }

      return {} as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openRunnerView(runnerId: string): Promise<HTMLElement> {
  const path: string = `/dashboard/${PROJECT_ID}/runbooks/runners/${runnerId}`;
  goTo(path);

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <RunnerView
          pageRoute={RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  return await screen.findByTestId(
    RUNNER_PROJECT_DEFAULT_SWITCH_TEST_ID,
    {},
    WAIT,
  );
}

function card(): HTMLElement {
  return screen
    .getByText(ProjectDefaultRunnerCopy.switchCardTitle, { exact: true })
    .closest('[data-testid="card"]') as HTMLElement;
}

describe("the Project Default card on a Runner's page", () => {
  test("comes after Runner Details and Runner Status, saying what the default does, its switch off and naming the default for a Runner that is not it", async () => {
    const control: HTMLElement = await openRunnerView(OFFICE_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "false");
    }, WAIT);

    expect(card()).toHaveTextContent(
      ProjectDefaultRunnerCopy.switchCardDescription,
    );
    // Off: where the steps that pick no Runner run now - on the default, named.
    await waitFor(() => {
      expect(card()).toHaveTextContent(
        "Runbook steps and code repositories that pick no Runner run on prod-eu-west-1, the project default.",
      );
    }, WAIT);
    expect(card()).not.toHaveTextContent(
      ProjectDefaultRunnerCopy.switchOffDescription,
    );
    expect(
      screen.getByRole("switch", {
        name: ProjectDefaultRunnerCopy.switchTitle,
      }),
    ).toBe(control);

    const details: HTMLElement = screen
      .getByText("Runner Details", { exact: true })
      .closest('[data-testid="card"]') as HTMLElement;
    const status: HTMLElement = screen
      .getByText("Runner Status", { exact: true })
      .closest('[data-testid="card"]') as HTMLElement;

    expect(
      details.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      status.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // And before the setup command, once the Runner is read.
    const setup: HTMLElement = (
      await screen.findByText("Setup Instructions", { exact: true }, WAIT)
    ).closest('[data-testid="card"]') as HTMLElement;

    expect(
      card().compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("with no default in the project, its line says where the steps that pick no Runner run", async () => {
    rows.get(PROD_ID)!.isProjectDefault = false;

    const control: HTMLElement = await openRunnerView(OFFICE_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "false");
    }, WAIT);
    expect(card()).toHaveTextContent(
      ProjectDefaultRunnerCopy.switchOffDescription,
    );
    expect(card()).not.toHaveTextContent("the project default.");
  });

  test("is on for the project's default Runner", async () => {
    const control: HTMLElement = await openRunnerView(PROD_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "true");
    }, WAIT);
    expect(card()).toHaveTextContent(
      ProjectDefaultRunnerCopy.switchOnDescription,
    );
  });

  test("turning it on asks first, naming the default it replaces, then writes this Runner only", async () => {
    const control: HTMLElement = await openRunnerView(OFFICE_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "false");
    }, WAIT);

    fireEvent.click(control);

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(dialog).toHaveAccessibleName(
      "Make office-runner the project default?",
    );
    expect(dialog).toHaveTextContent(
      "Runbook steps and code repositories that pick no Runner will run on it instead of prod-eu-west-1.",
    );
    expect(writes).toEqual([]);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: ProjectDefaultRunnerCopy.makeDefaultConfirmButton,
        }),
      );
    });

    await waitFor(() => {
      expect(writes).toEqual([
        { id: OFFICE_ID, data: { isProjectDefault: true } },
      ]);
    }, WAIT);
    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "true");
    }, WAIT);
  });

  test("with no default yet, it says the steps on the Global Runner move; a Runner that is not connected is said so", async () => {
    rows.get(PROD_ID)!.isProjectDefault = false;
    rows.get(OFFICE_ID)!.lastAlive = undefined as never;

    const control: HTMLElement = await openRunnerView(OFFICE_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "false");
    }, WAIT);

    fireEvent.click(control);

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(
      within(dialog).getByTestId("confirm-modal-description").textContent,
    ).toBe(ProjectDefaultRunnerCopy.makeDefaultConfirmDescription);

    // Not connected: a warning of its own, under what moves.
    const warning: HTMLElement = within(dialog).getByTestId(
      getModelSwitchConfirmationWarningTestId(
        RUNNER_PROJECT_DEFAULT_SWITCH_TEST_ID,
      ),
    );

    expect(warning).toHaveTextContent(
      "office-runner is not connected right now, so the steps that run on it fail until it is.",
    );
    expect(warning).toHaveAttribute("role", "alert");
  });

  test("a connected Runner's dialog has no warning", async () => {
    const control: HTMLElement = await openRunnerView(OFFICE_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "false");
    }, WAIT);

    fireEvent.click(control);

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(dialog).not.toHaveTextContent("not connected");
    expect(
      within(dialog).queryByTestId(
        getModelSwitchConfirmationWarningTestId(
          RUNNER_PROJECT_DEFAULT_SWITCH_TEST_ID,
        ),
      ),
    ).toBeNull();
  });

  test("turning it off asks first, saying where the steps go, then clears this Runner's column", async () => {
    const control: HTMLElement = await openRunnerView(PROD_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "true");
    }, WAIT);

    fireEvent.click(control);

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(dialog).toHaveAccessibleName(
      "Stop using prod-eu-west-1 as the project default?",
    );
    expect(dialog).toHaveTextContent(
      ProjectDefaultRunnerCopy.stopDefaultConfirmDescription,
    );

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: ProjectDefaultRunnerCopy.stopDefaultConfirmButton,
        }),
      );
    });

    await waitFor(() => {
      expect(writes).toEqual([
        { id: PROD_ID, data: { isProjectDefault: false } },
      ]);
    }, WAIT);
  });

  test.each([
    [
      "the Kubernetes agent chart's in-cluster Runner",
      {
        name: "kubernetes-agent/prod-east",
        canRunRunbooks: false,
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-east" },
        } as JSONObject,
      },
      ProjectDefaultRunnerRefusal.KubernetesAgentRunner,
    ],
    [
      "a Runner with Runs Runbooks off",
      { canRunRunbooks: false },
      ProjectDefaultRunnerRefusal.DoesNotRunRunbooks,
    ],
  ])(
    "is locked on %s, saying why",
    async (
      _label: string,
      overrides: Record<string, unknown>,
      refusal: ProjectDefaultRunnerRefusal,
    ) => {
      Object.assign(rows.get(OFFICE_ID)!, overrides);

      const control: HTMLElement = await openRunnerView(OFFICE_ID);

      await waitFor(() => {
        expect(control).toHaveAttribute("aria-disabled", "true");
      }, WAIT);

      fireEvent.click(control);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(writes).toEqual([]);

      /*
       * Why, where it is read - the switch's line - not only in a tooltip
       * a phone never shows; and said once.
       */
      expect(control).toHaveAccessibleDescription(
        PROJECT_DEFAULT_REFUSAL_TEXT[refusal],
      );
      expect(card()).not.toHaveTextContent(
        "Runbook steps and code repositories that pick no Runner run on prod-eu-west-1, the project default.",
      );
    },
  );

  test("is locked for someone who may read Runners but not edit them", async () => {
    permissions = [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.RunbookViewer,
      Permission.ReadRunner,
    ];

    const control: HTMLElement = await openRunnerView(OFFICE_ID);

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-disabled", "true");
    }, WAIT);

    fireEvent.click(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes).toEqual([]);
  });
});
