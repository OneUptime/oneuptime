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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import RunnerView from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/RunnerView";
import RunnersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Runners";
import {
  NO_RUNNER_FORM_RESTRICTIONS,
  RunnerFormRestrictions,
  getKubernetesAgentRunnerFormNote,
  getReservedRunnerNameError,
  getRunnerFormFields,
  getRunnerFormRestrictions,
  getRunnerTableFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/RunnerFormFields";
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
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
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
 * The Runner list and detail pages on a Runner the Kubernetes agent chart
 * installed. RunnerService refuses, for any non-root write, renaming a row
 * whose name carries the "kubernetes-agent/" marker (or naming a row into
 * it), and turning on "Runs Runbooks" or "Runs AI Code Fixes" on an agent
 * row — by name marker OR agent posture. Both pages used to offer those
 * fields on every row, so an edit of an agent row could only be refused;
 * they now leave them out on such a row and say why in one line.
 * KubernetesClusterAiPageServerParity.test.ts runs these forms' writes
 * through the real RunnerService hook.
 */

const WAIT_TIMEOUT: number = 20000;

const AGENT_RUNNER_ID: string = "66666666-0000-4000-8000-000000000001";
const HOST_RUNNER_ID: string = "66666666-0000-4000-8000-000000000002";
const RENAMED_AGENT_RUNNER_ID: string = "66666666-0000-4000-8000-000000000003";

const ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

const AGENT_POSTURE: JSONObject = {
  kubernetes: {
    inCluster: true,
    allowWrites: true,
    clusterIdentifier: "prod-east",
  },
};

const AGENT_NOTE_START: string =
  "This is the in-cluster Runner the Kubernetes agent chart installed.";

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

function agentRow(): Runner {
  return makeRunnerRow(
    AGENT_RUNNER_ID,
    "kubernetes-agent/prod-east",
    AGENT_POSTURE,
  );
}

function hostRow(): Runner {
  return makeRunnerRow(HOST_RUNNER_ID, "bash-runner");
}

// An agent by posture only: its name lost the marker in a legacy rename.
function renamedAgentRow(): Runner {
  return makeRunnerRow(
    RENAMED_AGENT_RUNNER_ID,
    "prod-east-kubectl",
    AGENT_POSTURE,
  );
}

function fieldKeys(fields: Fields<Runner>): Array<string> {
  return fields.map((field: Field<Runner>): string => {
    return Object.keys(field.field || {})[0] || "";
  });
}

/*
 * What ModelTable hands its create / edit modal: the form fields filtered
 * by doNotShowWhenCreating / doNotShowWhenEditing (ModelTable.tsx).
 */
function tableFormFor(
  mode: "create" | "edit",
  fields: Fields<Runner>,
): Fields<Runner> {
  return fields.filter((field: Field<Runner>): boolean => {
    return mode === "create"
      ? !field.doNotShowWhenCreating
      : !field.doNotShowWhenEditing;
  });
}

function nameField(fields: Fields<Runner>): Field<Runner> {
  const field: Field<Runner> | undefined = fields.find(
    (candidate: Field<Runner>): boolean => {
      return Boolean(candidate.field && "name" in candidate.field);
    },
  );
  if (!field) {
    throw new Error("The form has no Name field.");
  }
  return field;
}

const FULL_FORM: Array<string> = [
  "name",
  "description",
  "canRunRunbooks",
  "canRunCodeFixTasks",
  "canRunAiCommands",
  "labels",
];

describe("what the Runner form leaves out", () => {
  test("nothing on an ordinary Runner, in a pod or not", () => {
    expect(getRunnerFormRestrictions(hostRow())).toEqual(
      NO_RUNNER_FORM_RESTRICTIONS,
    );
    expect(
      getRunnerFormRestrictions({
        name: "pod-runner",
        // In a pod, but naming no cluster: not an agent posture.
        hostInfo: { kubernetes: { inCluster: true } },
      }),
    ).toEqual(NO_RUNNER_FORM_RESTRICTIONS);
    expect(getRunnerFormRestrictions(null)).toEqual(
      NO_RUNNER_FORM_RESTRICTIONS,
    );
    expect(getKubernetesAgentRunnerFormNote(NO_RUNNER_FORM_RESTRICTIONS)).toBe(
      null,
    );
  });

  test("the name and both switches on a kubernetes-agent row, in any case", () => {
    for (const row of [
      agentRow(),
      { name: "kubernetes-agent/prod-east" },
      { name: "Kubernetes-Agent/Prod-East" },
      { name: " KUBERNETES-AGENT/prod-east " },
    ]) {
      expect({
        name: row.name,
        restrictions: getRunnerFormRestrictions(row),
      }).toEqual({
        name: row.name,
        restrictions: {
          isNameLocked: true,
          areShellCapabilitiesLocked: true,
        },
      });
    }
  });

  /*
   * The server refuses a rename only of a row whose NAME carries the
   * marker, but the two switches on any agent row, posture included.
   */
  test("only the two switches on a row that is an agent by its posture alone", () => {
    expect(getRunnerFormRestrictions(renamedAgentRow())).toEqual({
      isNameLocked: false,
      areShellCapabilitiesLocked: true,
    });
  });

  test("the note names exactly what is left out", () => {
    const both: string | null = getKubernetesAgentRunnerFormNote({
      isNameLocked: true,
      areShellCapabilitiesLocked: true,
    });
    expect(both).toContain(AGENT_NOTE_START);
    expect(both).toContain(
      "cannot be renamed or given “Runs Runbooks” or “Runs AI Code Fixes”",
    );
    expect(both).toContain("OneUptime refuses those changes");

    const switchesOnly: string | null = getKubernetesAgentRunnerFormNote({
      isNameLocked: false,
      areShellCapabilitiesLocked: true,
    });
    expect(switchesOnly).toContain(
      "cannot be given “Runs Runbooks” or “Runs AI Code Fixes”",
    );
    expect(switchesOnly).not.toContain("renamed");
  });
});

describe("the Runner form's fields", () => {
  test("an ordinary Runner gets the whole form", () => {
    expect(
      fieldKeys(
        getRunnerFormFields({
          withSteps: false,
          restrictions: NO_RUNNER_FORM_RESTRICTIONS,
        }),
      ),
    ).toEqual(FULL_FORM);
  });

  test("a kubernetes-agent row gets no name and no runbook / code-fix switches, with the note", () => {
    const restrictions: RunnerFormRestrictions =
      getRunnerFormRestrictions(agentRow());
    const fields: Fields<Runner> = getRunnerFormFields({
      withSteps: false,
      restrictions,
    });

    expect(fieldKeys(fields)).toEqual([
      "description",
      "canRunAiCommands",
      "labels",
    ]);
    expect(fields[0]!.sectionDescription).toBe(
      getKubernetesAgentRunnerFormNote(restrictions),
    );
  });

  test("a row that is an agent by posture alone keeps its name but not the switches", () => {
    expect(
      fieldKeys(
        getRunnerFormFields({
          withSteps: false,
          restrictions: getRunnerFormRestrictions(renamedAgentRow()),
        }),
      ),
    ).toEqual(["name", "description", "canRunAiCommands", "labels"]);
  });

  test("the list page's wizard puts every field on its step", () => {
    const steps: Array<string | undefined> = getRunnerFormFields({
      withSteps: true,
      restrictions: NO_RUNNER_FORM_RESTRICTIONS,
    }).map((field: Field<Runner>): string | undefined => {
      return field.stepId;
    });
    expect(steps).toEqual([
      "runner",
      "runner",
      "capabilities",
      "capabilities",
      "capabilities",
      "labels",
    ]);
    // The detail page's form has no steps.
    for (const field of getRunnerFormFields({
      withSteps: false,
      restrictions: NO_RUNNER_FORM_RESTRICTIONS,
    })) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("the name refuses the reserved prefix, in any case, as the server does", () => {
    const validate: (values: FormValues<Runner>) => string | null = nameField(
      getRunnerFormFields({
        withSteps: false,
        restrictions: NO_RUNNER_FORM_RESTRICTIONS,
      }),
    ).customValidation!;

    for (const name of [
      "kubernetes-agent/prod",
      "Kubernetes-Agent/prod",
      " KUBERNETES-AGENT/x",
    ]) {
      expect({ name, error: validate({ name }) }).toEqual({
        name,
        error: getReservedRunnerNameError(name),
      });
      expect(validate({ name })).toContain('"kubernetes-agent/"');
    }

    // Negative controls: names that only look alike.
    for (const name of [
      "prod-eu-runner",
      "kubernetes-agent",
      "my-kubernetes-agent/x",
      "kubernetes-agent-prod",
    ]) {
      expect({ name, error: validate({ name }) }).toEqual({
        name,
        error: null,
      });
    }
  });

  /*
   * One ModelTable form serves Create and Edit. The create form is never
   * restricted — a row a user creates is never an agent row — while the
   * edit form follows the row being edited.
   */
  test("the list page's create form is always whole, its edit form follows the row", () => {
    const whenEditingAnAgent: Fields<Runner> = getRunnerTableFormFields(
      getRunnerFormRestrictions(agentRow()),
    );

    expect(fieldKeys(tableFormFor("create", whenEditingAnAgent))).toEqual(
      FULL_FORM,
    );
    expect(fieldKeys(tableFormFor("edit", whenEditingAnAgent))).toEqual([
      "description",
      "canRunAiCommands",
      "labels",
    ]);

    const whenEditingAHost: Fields<Runner> = getRunnerTableFormFields(
      getRunnerFormRestrictions(hostRow()),
    );
    expect(fieldKeys(tableFormFor("edit", whenEditingAHost))).toEqual(
      FULL_FORM,
    );
    expect(fieldKeys(tableFormFor("create", whenEditingAHost))).toEqual(
      FULL_FORM,
    );
  });
});

describe("the Runner pages, rendered", () => {
  let rows: Array<Runner> = [];
  let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

  function grantAdmin(): void {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue(ADMIN_PERMISSIONS);
    jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
      projectId: new ObjectID(PROJECT_ID),
      userId: ObjectID.generate(),
      permissions: ADMIN_PERMISSIONS.map((permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          _type: "UserPermission",
        };
      }),
      _type: "UserTenantAccessPermission",
    } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
  }

  function rowById(id: unknown): Runner | undefined {
    return rows.find((row: Runner): boolean => {
      return String(row._id) === String(id);
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    grantAdmin();
    rows = [agentRow(), hostRow()];

    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (args: unknown): Promise<Runner | null> => {
        return rowById((args as { id?: unknown }).id) || null;
      });

    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(
        async (args: unknown): Promise<ListResult<Runner>> => {
          const data: Array<Runner> =
            (args as { modelType?: unknown }).modelType === Runner ? rows : [];
          return { data, count: data.length, skip: 0, limit: 10 };
        },
      );

    createOrUpdateSpy = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<never> => {
        return { data: {} } as never;
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  function openRunnerView(runnerId: string): void {
    const path: string = `/dashboard/${PROJECT_ID}/settings/runners/${runnerId}`;
    goTo(path);
    render(
      <MemoryRouter initialEntries={[path]}>
        <RunnerView
          pageRoute={RouteMap[PageMap.SETTINGS_RUNNER_VIEW] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  /*
   * The form is built from the loaded row, so the page opens it only once
   * the row has loaded (its name is on the Runner Details card).
   */
  async function openRunnerEditModal(runnerName: string): Promise<HTMLElement> {
    await screen.findByText(runnerName, {}, { timeout: WAIT_TIMEOUT });
    const edit: HTMLElement = await screen.findByText(
      "Edit Runner",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    fireEvent.click(edit);
    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await within(dialog).findByText(
      "Description",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    return dialog;
  }

  // The form's field titles, by the label elements the form renders.
  function hasFieldTitled(dialog: HTMLElement, title: string): boolean {
    return within(dialog).queryAllByText(title, { exact: true }).length > 0;
  }

  test("the detail page's form on an agent row leaves out the name and the two switches, and says why", async () => {
    openRunnerView(AGENT_RUNNER_ID);

    const note: HTMLElement = await screen.findByTestId(
      "kubernetes-agent-runner-note",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(note).toHaveTextContent(AGENT_NOTE_START);

    const dialog: HTMLElement = await openRunnerEditModal(
      "kubernetes-agent/prod-east",
    );
    await within(dialog).findByText(
      "Runs AI Remediation Commands",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      within(dialog).getByText("In-cluster Runner (Kubernetes agent)"),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(AGENT_NOTE_START);
    expect(hasFieldTitled(dialog, "Name")).toBe(false);
    expect(hasFieldTitled(dialog, "Runs Runbooks")).toBe(false);
    expect(hasFieldTitled(dialog, "Runs AI Code Fixes")).toBe(false);

    // Saving posts none of the fields the server refuses.
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    await waitFor(
      () => {
        expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    const posted: Runner = (
      createOrUpdateSpy.mock.calls[0]![0] as { model: Runner }
    ).model;
    expect(posted.name).toBeUndefined();
    expect(posted.canRunRunbooks).toBeUndefined();
    expect(posted.canRunCodeFixTasks).toBeUndefined();
    expect(posted.canRunAiCommands).toBe(true);
  });

  test("the detail page's form on an ordinary Runner is whole, with no note", async () => {
    openRunnerView(HOST_RUNNER_ID);

    const dialog: HTMLElement = await openRunnerEditModal("bash-runner");
    await within(dialog).findByText(
      "Runs AI Remediation Commands",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(hasFieldTitled(dialog, "Name")).toBe(true);
    expect(hasFieldTitled(dialog, "Runs Runbooks")).toBe(true);
    expect(hasFieldTitled(dialog, "Runs AI Code Fixes")).toBe(true);
    expect(dialog).not.toHaveTextContent(AGENT_NOTE_START);
    expect(
      screen.queryByTestId("kubernetes-agent-runner-note"),
    ).not.toBeInTheDocument();
  });

  function openRunnersPage(): void {
    const path: string = `/dashboard/${PROJECT_ID}/settings/runners`;
    goTo(path);
    render(
      <MemoryRouter initialEntries={[path]}>
        <RunnersPage
          pageRoute={RouteMap[PageMap.SETTINGS_RUNNERS] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  async function clickRowAction(
    rowName: string,
    action: string,
  ): Promise<void> {
    const cell: HTMLElement = await screen.findByText(
      rowName,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    const row: HTMLElement | null = cell.closest("tr");
    if (!row) {
      throw new Error(`"${rowName}" is not in a table row.`);
    }
    fireEvent.click(within(row).getByText(action));
  }

  async function openDialog(firstField: string): Promise<HTMLElement> {
    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await within(dialog).findByText(firstField, {}, { timeout: WAIT_TIMEOUT });
    return dialog;
  }

  async function closeDialog(dialog: HTMLElement): Promise<void> {
    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
  }

  test("the list page's edit form on an agent row leaves out the name; create and the next edit do not", async () => {
    openRunnersPage();

    await clickRowAction("kubernetes-agent/prod-east", "Edit");
    const editDialog: HTMLElement = await openDialog("Description");
    expect(hasFieldTitled(editDialog, "Name")).toBe(false);
    expect(editDialog).toHaveTextContent(AGENT_NOTE_START);
    await closeDialog(editDialog);

    // Creating right after editing an agent row: the whole form.
    fireEvent.click(
      await screen.findByText("Create Runner", {}, { timeout: WAIT_TIMEOUT }),
    );
    const createDialog: HTMLElement = await openDialog("Description");
    expect(hasFieldTitled(createDialog, "Name")).toBe(true);
    expect(createDialog).not.toHaveTextContent(AGENT_NOTE_START);
    await closeDialog(createDialog);

    // The next edit follows its own row: an ordinary Runner keeps its name.
    await clickRowAction("bash-runner", "Edit");
    const hostDialog: HTMLElement = await openDialog("Description");
    expect(hasFieldTitled(hostDialog, "Name")).toBe(true);
    expect(hostDialog).not.toHaveTextContent(AGENT_NOTE_START);
  });
});
