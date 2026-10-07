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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { FunctionComponent, ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Every Label Rules and Owner Rules page - the resource products', and the
 * incident, alert, scheduled maintenance, monitor and status page ones -
 * their create and edit forms drawn for real: the pages' own fields in the
 * ModelFormModal, ModelForm and BasicForm their tables open, with only the
 * table around them, the network and the permissions stubbed.
 *
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." A rule used to open on Basic Info - a name before
 * anyone had said what the rule was for - and asked what it adds, optional,
 * only on its third step (an event's rule asked which resources to inherit
 * from on a fourth). Now:
 *
 *   - it walks Match (the conditions builder), then Labels or Owners;
 *   - what a new rule adds is required, and the name is filled in from it
 *     ("Add production, eu-west", "Add Ada Lovelace as owners"), following
 *     the picks until somebody types a name of their own;
 *   - an incident, alert or maintenance rule may inherit instead: its six
 *     switches fold under Inherit Labels / Inherit Owners on that step;
 *   - the description - and Notify Owners, on - wait folded under More
 *     fields; Enabled is on the Edit form only;
 *   - an Edit form asks for nothing the rule adds, so a rule saved before
 *     the form asked - one that adds nothing - can be renamed or switched
 *     off.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";
const NEW_ID: string = "55555555-5555-4555-8555-555555555555";

const PRODUCTION: string = "0000000a-0000-4000-8000-000000000001";
const EU_WEST: string = "0000000a-0000-4000-8000-000000000002";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

interface MockTable {
  mode: "create" | "edit";
}

const mockTable: MockTable = { mode: "create" };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      const singularName: string =
        props.singularName || new props.modelType().singularName || "";
      const fields: Array<ModelField<TBaseModel>> = props.formFields || [];

      if (mockTable.mode === "edit") {
        // What the real table opens from a row's Edit.
        return (
          <ModelFormModal<TBaseModel>
            title={`Edit ${singularName}`}
            modelType={props.modelType}
            modalWidth={props.createEditModalWidth}
            submitButtonText="Save Changes"
            onClose={() => {}}
            onSuccess={() => {}}
            modelIdToEdit={new ObjectID(RULE_ID)}
            formProps={{
              id: `edit-${props.modelType.name}-form`,
              name: `edit-${props.modelType.name}-form`,
              modelType: props.modelType,
              fields: fields.filter(
                (field: ModelField<TBaseModel>): boolean => {
                  return !field.doNotShowWhenEditing;
                },
              ),
              steps: props.formSteps || [],
              formType: FormType.Update,
              allowAnyStepNavigation: true,
            }}
          />
        );
      }

      // What the real table opens from its Create button.
      return (
        <ModelFormModal<TBaseModel>
          title={`Create New ${singularName}`}
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText={`Create ${singularName}`}
          onClose={() => {}}
          onSuccess={() => {}}
          formProps={{
            id: `create-${props.modelType.name}-form`,
            name: `create-${props.modelType.name}-form`,
            modelType: props.modelType,
            fields: fields.filter((field: ModelField<TBaseModel>): boolean => {
              return !field.doNotShowWhenCreating;
            }),
            steps: props.formSteps || [],
            formType: FormType.Create,
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      /*
       * The project's labels, people and teams, answered the way the API
       * filters them by id: the label picker, the conditions builder and the
       * people picker all read from here.
       */
      getList: async (request: {
        modelType: { name: string };
        query?: Record<string, unknown>;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        type Loaded = { new (): Record<string, unknown> };

        const load: (modulePath: string) => Loaded = (
          modulePath: string,
        ): Loaded => {
          return (jest.requireActual(modulePath) as { default: Loaded })
            .default;
        };

        const query: Record<string, unknown> = request.query || {};

        // An id filter (QueryHelper.any / Includes) lets only its ids through.
        const passes: (key: string, id: string) => boolean = (
          key: string,
          id: string,
        ): boolean => {
          const filter: unknown = query[key];
          const values: unknown =
            filter && typeof filter === "object"
              ? (filter as { values?: unknown }).values
              : undefined;

          if (!Array.isArray(values)) {
            return true;
          }

          return values
            .map((value: unknown): string => {
              return String(value).toLowerCase();
            })
            .includes(id.toLowerCase());
        };

        let rows: Array<unknown> = [];

        if (request.modelType.name === "Label") {
          const LabelModel: Loaded = load(
            "../../../Models/DatabaseModels/Label",
          );

          rows = [
            ["0000000a-0000-4000-8000-000000000001", "production"],
            ["0000000a-0000-4000-8000-000000000002", "eu-west"],
            ["0000000a-0000-4000-8000-000000000003", "critical"],
          ]
            .filter(([id]: Array<string>): boolean => {
              return passes("_id", id!);
            })
            .map(([id, name]: Array<string>): unknown => {
              return Object.assign(new LabelModel(), { _id: id, name: name });
            });
        }

        if (request.modelType.name === "TeamMember") {
          const MemberModel: Loaded = load(
            "../../../Models/DatabaseModels/TeamMember",
          );
          const UserModel: Loaded = load("../../../Models/DatabaseModels/User");
          const NameType: { new (name: string): unknown } = (
            jest.requireActual("../../../Types/Name") as {
              default: { new (name: string): unknown };
            }
          ).default;
          const EmailType: { new (email: string): unknown } = (
            jest.requireActual("../../../Types/Email") as {
              default: { new (email: string): unknown };
            }
          ).default;

          const adaId: string = "0000000e-0000-4000-8000-000000000001";

          rows = passes("userId", adaId)
            ? [
                Object.assign(new MemberModel(), {
                  user: Object.assign(new UserModel(), {
                    _id: adaId,
                    name: new NameType("Ada Lovelace"),
                    email: new EmailType("ada@example.com"),
                  }),
                }),
              ]
            : [];
        }

        if (request.modelType.name === "Team") {
          const TeamModel: Loaded = load("../../../Models/DatabaseModels/Team");
          const platformId: string = "0000000b-0000-4000-8000-000000000001";

          rows = passes("_id", platformId)
            ? [
                Object.assign(new TeamModel(), {
                  _id: platformId,
                  name: "Platform",
                }),
              ]
            : [];
        }

        return { data: rows, count: rows.length, skip: 0, limit: 50 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import Route from "../../../Types/API/Route";
import HostLabelRule from "../../../Models/DatabaseModels/HostLabelRule";
import HostOwnerRule from "../../../Models/DatabaseModels/HostOwnerRule";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";
import RuleSettingsPageProps from "../../../../App/FeatureSet/Dashboard/src/Pages/RuleSettingsPageProps";
import CephLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Settings/LabelRules";
import CephOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Settings/OwnerRules";
import CloudLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Settings/LabelRules";
import CloudOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Settings/OwnerRules";
import DashboardsLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Settings/LabelRules";
import DashboardsOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Settings/OwnerRules";
import DatabaseLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Settings/LabelRules";
import DatabaseOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Settings/OwnerRules";
import DockerLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Settings/LabelRules";
import DockerOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Settings/OwnerRules";
import DockerSwarmLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Settings/LabelRules";
import DockerSwarmOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Settings/OwnerRules";
import HostLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Settings/LabelRules";
import HostOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Settings/OwnerRules";
import IoTLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Settings/LabelRules";
import IoTOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Settings/OwnerRules";
import KubernetesLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Settings/LabelRules";
import KubernetesOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Settings/OwnerRules";
import MessageQueueLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Settings/LabelRules";
import MessageQueueOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Settings/OwnerRules";
import NetworkDeviceLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/LabelRules";
import NetworkDeviceOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/OwnerRules";
import OnCallDutyLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Settings/LabelRules";
import OnCallDutyOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Settings/OwnerRules";
import PodmanLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Settings/LabelRules";
import PodmanOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Settings/OwnerRules";
import ProxmoxLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Settings/LabelRules";
import ProxmoxOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Settings/OwnerRules";
import RumLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/Settings/LabelRules";
import RumOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/Settings/OwnerRules";
import RunbookLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Settings/LabelRules";
import RunbookOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Settings/OwnerRules";
import ServerlessLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/Settings/LabelRules";
import ServerlessOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/Settings/OwnerRules";
import ServiceLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/Settings/LabelRules";
import ServiceOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/Settings/OwnerRules";
import SloLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Settings/LabelRules";
import SloOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Settings/OwnerRules";
import VMwareLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Settings/LabelRules";
import VMwareOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Settings/OwnerRules";
import WorkflowLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Settings/LabelRules";
import WorkflowOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Settings/OwnerRules";
import IncidentLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentLabelRules";
import IncidentOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOwnerRules";
import AlertLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertLabelRules";
import AlertOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertOwnerRules";
import ScheduledMaintenanceLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceLabelRules";
import ScheduledMaintenanceOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceOwnerRules";
import MonitorLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorLabelRules";
import MonitorOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorOwnerRules";
import StatusPageLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageLabelRules";
import StatusPageOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageOwnerRules";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import MonitorOwnerRule from "../../../Models/DatabaseModels/MonitorOwnerRule";
import ScheduledMaintenanceOwnerRule from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import StatusPageLabelRule from "../../../Models/DatabaseModels/StatusPageLabelRule";

type RulePage = FunctionComponent<RuleSettingsPageProps>;

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

// BasicForm opens a stepped form's first step in an effect: let it run.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function renderPage(
  Page: RulePage,
  mode: MockTable["mode"] = "create",
): Promise<UserEvent> {
  mockTable.mode = mode;

  await act(async (): Promise<void> => {
    render(
      <Page
        pageRoute={new Route(`/dashboard/${PROJECT_ID}/settings/label-rules`)}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  await settle();

  return userEvent.setup({ delay: null });
}

function stepTitles(): Array<string> {
  const progress: HTMLElement = within(dialog()).getByRole("navigation", {
    name: "Progress",
  });

  return within(progress)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function next(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
  });
  await settle();
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

function nameBox(): HTMLInputElement {
  return within(dialog()).getByRole("textbox", {
    name: "Name",
  }) as HTMLInputElement;
}

function moreFields(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "More fields" });
}

// What ModelForm handed the API: the model, read by its columns.
function sentModel(): JSONObject {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: unknown })
    .model as JSONObject;
}

/*
 * "Labels to Add" on a new rule, "Labels to Add (Optional)" on an Edit form
 * - which asks for nothing the rule adds - or once a rule inherits.
 */
const LABELS_TO_ADD: RegExp = /^Labels to Add( \(Optional\))?$/;

async function pickLabel(user: UserEvent, name: string): Promise<void> {
  await user.click(
    within(dialog()).getByRole("combobox", { name: LABELS_TO_ADD }),
  );
  await user.click(await screen.findByRole("option", { name: name }));
}

async function pickOwner(name: string): Promise<void> {
  const button: HTMLElement = within(dialog()).getByRole("button", {
    name: "Add owner",
  });

  if (button.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(button);
  }

  const list: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owner",
  });

  const options: Array<HTMLElement> =
    await within(list).findAllByRole("option");

  const option: HTMLElement | undefined = options.find(
    (candidate: HTMLElement): boolean => {
      return candidate.textContent?.includes(name) || false;
    },
  );

  if (!option) {
    throw new Error(`No owner named ${name}`);
  }

  fireEvent.click(option);
}

// Opens a page's tab - the episode rules of incidents and alerts.
async function openTab(name: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("tab", { name: name }));
  });
  await settle();
}

// The header of a fold on the dialog's step: More fields, Inherit Labels.
function fold(name: string): HTMLElement {
  return within(dialog()).getByRole("button", { name: name });
}

async function openFold(name: string): Promise<void> {
  if (fold(name).getAttribute("aria-expanded") !== "true") {
    await act(async (): Promise<void> => {
      fireEvent.click(fold(name));
    });
  }
}

function switchNamed(name: string): HTMLElement {
  return within(dialog()).getByRole("switch", { name: name });
}

// Opens an Edit form's last step from its step list, as somebody would.
async function openLastStep(): Promise<void> {
  await within(dialog()).findByRole("navigation", { name: "Progress" });
  await next();
}

function ids(value: unknown): Array<string> {
  return (Array.isArray(value) ? value : []).map((entry: unknown): string => {
    if (typeof entry === "string") {
      return entry;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;

    return String(record["_id"] || record["id"] || record["value"] || "");
  });
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/settings/label-rules`,
  );
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    const saved: BaseModel = data.model;
    saved._id = NEW_ID;
    return Promise.resolve({ data: saved });
  }) as never);
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

interface PageCase {
  name: string;
  Page: RulePage;
  kind: "labels" | "owners";
}

/*
 * Every page that takes the shared form. On-Call's pages hold three tables
 * in tabs; the first tab (on-call policies) is the one drawn.
 */
const PAGES: Array<PageCase> = [
  ["Ceph", CephLabelRules, CephOwnerRules],
  ["Cloud", CloudLabelRules, CloudOwnerRules],
  ["Dashboards", DashboardsLabelRules, DashboardsOwnerRules],
  ["Database", DatabaseLabelRules, DatabaseOwnerRules],
  ["Docker", DockerLabelRules, DockerOwnerRules],
  ["DockerSwarm", DockerSwarmLabelRules, DockerSwarmOwnerRules],
  ["Host", HostLabelRules, HostOwnerRules],
  ["IoT", IoTLabelRules, IoTOwnerRules],
  ["Kubernetes", KubernetesLabelRules, KubernetesOwnerRules],
  ["MessageQueue", MessageQueueLabelRules, MessageQueueOwnerRules],
  ["NetworkDevice", NetworkDeviceLabelRules, NetworkDeviceOwnerRules],
  ["OnCallDuty", OnCallDutyLabelRules, OnCallDutyOwnerRules],
  ["Podman", PodmanLabelRules, PodmanOwnerRules],
  ["Proxmox", ProxmoxLabelRules, ProxmoxOwnerRules],
  ["Rum", RumLabelRules, RumOwnerRules],
  ["Runbook", RunbookLabelRules, RunbookOwnerRules],
  ["Serverless", ServerlessLabelRules, ServerlessOwnerRules],
  ["Service", ServiceLabelRules, ServiceOwnerRules],
  ["Slo", SloLabelRules, SloOwnerRules],
  ["VMware", VMwareLabelRules, VMwareOwnerRules],
  ["Workflow", WorkflowLabelRules, WorkflowOwnerRules],
  // The first tab of each: the incident's and the alert's own rules.
  ["Incidents", IncidentLabelRules, IncidentOwnerRules],
  ["Alerts", AlertLabelRules, AlertOwnerRules],
  [
    "Scheduled Maintenance",
    ScheduledMaintenanceLabelRules,
    ScheduledMaintenanceOwnerRules,
  ],
  ["Monitors", MonitorLabelRules, MonitorOwnerRules],
  ["Status Pages", StatusPageLabelRules, StatusPageOwnerRules],
].flatMap(([name, LabelPage, OwnerPage]: Array<unknown>): Array<PageCase> => {
  return [
    {
      name: `${name as string} > Settings > Label Rules`,
      Page: LabelPage as RulePage,
      kind: "labels",
    },
    {
      name: `${name as string} > Settings > Owner Rules`,
      Page: OwnerPage as RulePage,
      kind: "owners",
    },
  ];
});

describe.each(PAGES)("$name", (page: PageCase) => {
  test("opens on what the rule matches, then asks what it adds - no Basic Info", async () => {
    await renderPage(page.Page);
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining(page.kind === "labels" ? "Labels" : "Owners"),
    ]);
    expect(within(dialog()).queryByText("Basic Info")).toBeNull();

    // The first step is the conditions builder; nothing is asked of the name.
    expect(within(dialog()).getByText("Conditions")).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("textbox", { name: "Name" }),
    ).toBeNull();
    // Next is plain; the rule is created from the last step only.
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();

    await next();

    if (page.kind === "labels") {
      expect(
        within(dialog()).getByRole("combobox", { name: "Labels to Add" }),
      ).toBeVisible();
      expect(listedNames(moreFields())).toEqual(["Description"]);
    } else {
      expect(
        within(dialog()).getByRole("button", { name: "Add owner" }),
      ).toBeVisible();
      expect(listedNames(moreFields())).toEqual([
        "Notify Owners",
        "Description",
      ]);
    }

    expect(nameBox()).toBeVisible();
    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    // A new rule starts on: no Enabled question.
    expect(
      within(dialog()).queryByRole("switch", { name: /Enabled/ }),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toBeInTheDocument();
  });

  test("will not create a rule that adds nothing", async () => {
    await renderPage(page.Page);
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    await next();
    fireEvent.change(nameBox(), { target: { value: "Does nothing" } });
    await submit();

    expect(
      await within(dialog()).findByText(
        page.kind === "labels"
          ? "Labels to Add is required."
          : "Owners is required.",
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("Hosts > Settings > Label Rules, as somebody fills it in", () => {
  test("names the rule after the labels it adds, and follows the next pick", async () => {
    const user: UserEvent = await renderPage(HostLabelRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    expect(nameBox()).toHaveValue("");

    await pickLabel(user, "production");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add production");
    });

    await pickLabel(user, "eu-west");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add production, eu-west");
    });
  });

  test("never writes over a name somebody typed", async () => {
    const user: UserEvent = await renderPage(HostLabelRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await pickLabel(user, "production");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add production");
    });

    fireEvent.change(nameBox(), { target: { value: "Tag production hosts" } });

    await pickLabel(user, "critical");
    await settle();

    expect(nameBox()).toHaveValue("Tag production hosts");
  });

  test("creates the rule with the labels, the name filled in and nothing else asked", async () => {
    const user: UserEvent = await renderPage(HostLabelRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await pickLabel(user, "production");
    await pickLabel(user, "eu-west");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add production, eu-west");
    });

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Add production, eu-west");
    expect(ids(model["labelsToAdd"]).sort()).toEqual(
      [PRODUCTION, EU_WEST].sort(),
    );
    // The form's own bookkeeping is never sent.
    expect(model).not.toHaveProperty("filledInRuleName");
  });
});

describe("Hosts > Settings > Owner Rules, as somebody fills it in", () => {
  test("names the rule after the owners it adds", async () => {
    await renderPage(HostOwnerRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await pickOwner("Ada Lovelace");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add Ada Lovelace as owners");
    });

    await pickOwner("Platform");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add Ada Lovelace, Platform as owners");
    });
  });

  test("creates the rule with its owners, notifying them as the server would", async () => {
    await renderPage(HostOwnerRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await pickOwner("Platform");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add Platform as owners");
    });

    // Folded and untouched: Notify Owners is at its default (on).
    expect(setChips(moreFields())).toEqual([]);

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Add Platform as owners");
    expect(ids(model["ownerTeams"])).toEqual([PLATFORM]);
    expect(model["notifyOwners"]).toBe(true);
  });
});

describe("editing a rule", () => {
  test("adds the Enabled switch on the last step, and keeps the rest folded", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new HostOwnerRule(), {
          _id: RULE_ID,
          name: "Add Platform as owners",
          description: "",
          isEnabled: true,
          notifyOwners: false,
          ownerTeams: [Object.assign(new Team(), { _id: PLATFORM })],
          ownerUsers: [],
        }),
      );
    }) as never);

    await renderPage(HostOwnerRules, "edit");
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    await next();

    expect(
      await within(dialog()).findByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();
    expect(nameBox()).toHaveValue("Add Platform as owners");

    // Folded on Edit too, its header says Notify Owners was turned off.
    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual([
      expect.stringMatching(/^Notify Owners/),
    ]);

    // A name the form made still follows the owners.
    await waitFor(() => {
      expect(
        within(dialog()).getAllByTestId("people-chip")[0],
      ).toHaveTextContent("Platform");
    });

    await pickOwner("Ada Lovelace");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add Ada Lovelace, Platform as owners");
    });
  });

  test("of a label rule keeps a name somebody typed", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new HostLabelRule(), {
          _id: RULE_ID,
          name: "Production hosts",
          description: "",
          isEnabled: true,
          labelsToAdd: [
            Object.assign(new Label(), { _id: PRODUCTION, name: "production" }),
          ],
        }),
      );
    }) as never);

    const user: UserEvent = await renderPage(HostLabelRules, "edit");
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    await next();

    expect(
      await within(dialog()).findByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();
    expect(nameBox()).toHaveValue("Production hosts");

    await pickLabel(user, "critical");
    await settle();

    expect(nameBox()).toHaveValue("Production hosts");
  });
});

/*
 * Incidents and Alerts list their episodes' rules on a second tab: the
 * same shared form, without inheriting - an episode has no monitors of its
 * own to inherit from.
 */
describe.each([
  {
    name: "Incidents > Settings > Label Rules, Episode Rules tab",
    Page: IncidentLabelRules,
    kind: "labels",
  },
  {
    name: "Incidents > Settings > Owner Rules, Episode Rules tab",
    Page: IncidentOwnerRules,
    kind: "owners",
  },
  {
    name: "Alerts > Settings > Label Rules, Episode Rules tab",
    Page: AlertLabelRules,
    kind: "labels",
  },
  {
    name: "Alerts > Settings > Owner Rules, Episode Rules tab",
    Page: AlertOwnerRules,
    kind: "owners",
  },
] as Array<PageCase>)("$name", (page: PageCase) => {
  test("walks the same two steps, with nothing to inherit", async () => {
    await renderPage(page.Page);
    await openTab("Episode Rules");
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining(page.kind === "labels" ? "Labels" : "Owners"),
    ]);
    expect(within(dialog()).queryByText("Basic Info")).toBeNull();

    await next();

    expect(nameBox()).toBeVisible();
    expect(
      within(dialog()).queryByRole("button", { name: /^Inherit/ }),
    ).toBeNull();
    expect(listedNames(moreFields())).toEqual(
      page.kind === "labels"
        ? ["Description"]
        : ["Notify Owners", "Description"],
    );
  });

  test("will not create an episode rule that adds nothing", async () => {
    await renderPage(page.Page);
    await openTab("Episode Rules");
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    fireEvent.change(nameBox(), { target: { value: "Does nothing" } });
    await submit();

    expect(
      await within(dialog()).findByText(
        page.kind === "labels"
          ? "Labels to Add is required."
          : "Owners is required.",
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

interface InheritingPageCase extends PageCase {
  // The fold's title, and the first switch in it, as the page words them.
  foldTitle: string;
  monitorsSwitch: string;
  // What the fold says it is for while nothing in it is on.
  summary: string;
}

const INHERITING_PAGES: Array<InheritingPageCase> = [
  {
    name: "Incidents > Settings > Label Rules",
    Page: IncidentLabelRules,
    kind: "labels",
    foldTitle: "Inherit Labels",
    monitorsSwitch: "Inherit Labels From Monitors",
    summary: "Optionally copy labels from related entities onto the incident.",
  },
  {
    name: "Alerts > Settings > Label Rules",
    Page: AlertLabelRules,
    kind: "labels",
    foldTitle: "Inherit Labels",
    monitorsSwitch: "Inherit Labels From Monitor",
    summary: "Optionally copy labels from related entities onto the alert.",
  },
  {
    name: "Scheduled Maintenance > Settings > Label Rules",
    Page: ScheduledMaintenanceLabelRules,
    kind: "labels",
    foldTitle: "Inherit Labels",
    monitorsSwitch: "Inherit Labels From Monitors",
    summary: "Optionally copy labels from related entities onto the event.",
  },
  {
    name: "Incidents > Settings > Owner Rules",
    Page: IncidentOwnerRules,
    kind: "owners",
    foldTitle: "Inherit Owners",
    monitorsSwitch: "Inherit Owners From Monitors",
    summary: "Optionally assign owners from related entities to the incident.",
  },
  {
    name: "Alerts > Settings > Owner Rules",
    Page: AlertOwnerRules,
    kind: "owners",
    foldTitle: "Inherit Owners",
    monitorsSwitch: "Inherit Owners From Monitor",
    summary: "Optionally assign owners from related entities to the alert.",
  },
  {
    name: "Scheduled Maintenance > Settings > Owner Rules",
    Page: ScheduledMaintenanceOwnerRules,
    kind: "owners",
    foldTitle: "Inherit Owners",
    monitorsSwitch: "Inherit Owners From Monitors",
    summary: "Optionally assign owners from related entities to the event.",
  },
];

describe.each(INHERITING_PAGES)(
  "$name, which can inherit",
  (page: InheritingPageCase) => {
    test("folds its six inherit switches right after what it adds, saying what they are for", async () => {
      await renderPage(page.Page);
      await within(dialog()).findByRole("navigation", { name: "Progress" });

      // Two steps, as every rule: no Inherit step of its own any more.
      expect(stepTitles()).toHaveLength(2);

      await next();

      expect(fold(page.foldTitle)).toHaveAttribute("aria-expanded", "false");
      expect(
        within(fold(page.foldTitle)).getByTestId("collapsible-section-summary"),
      ).toHaveTextContent(page.summary);
      // Folded: the switches are out of reach until it opens.
      expect(
        within(dialog()).queryByRole("switch", { name: page.monitorsSwitch }),
      ).toBeNull();

      await openFold(page.foldTitle);

      expect(
        within(dialog()).getAllByRole("switch", {
          name: page.kind === "labels" ? /^Inherit Labels/ : /^Inherit Owners/,
        }),
      ).toHaveLength(6);

      for (const switchElement of within(dialog()).getAllByRole("switch", {
        name: /^Inherit/,
      })) {
        expect(switchElement).toHaveAttribute("aria-checked", "false");
      }
    });

    test("creates a rule that only inherits: what it names is no longer asked for", async () => {
      await renderPage(page.Page);
      await within(dialog()).findByRole("navigation", { name: "Progress" });
      await next();

      if (page.kind === "labels") {
        expect(
          within(dialog()).getByRole("combobox", { name: "Labels to Add" }),
        ).toBeVisible();
      }

      await openFold(page.foldTitle);
      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(page.monitorsSwitch));
      });

      expect(switchNamed(page.monitorsSwitch)).toHaveAttribute(
        "aria-checked",
        "true",
      );

      if (page.kind === "labels") {
        // Optional now: the rule adds the monitors' labels.
        expect(
          within(dialog()).getByRole("combobox", {
            name: "Labels to Add (Optional)",
          }),
        ).toBeVisible();
      }

      fireEvent.change(nameBox(), {
        target: { value: "Inherit what the monitors carry" },
      });
      await submit();

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const model: JSONObject = sentModel();
      const switchColumn: string =
        page.kind === "labels"
          ? "inheritLabelsFromMonitors"
          : "inheritOwnersFromMonitors";

      expect(model["name"]).toBe("Inherit what the monitors carry");
      expect(model[switchColumn]).toBe(true);

      if (page.kind === "labels") {
        expect(ids(model["labelsToAdd"])).toEqual([]);
      } else {
        expect(ids(model["ownerUsers"])).toEqual([]);
        expect(ids(model["ownerTeams"])).toEqual([]);
      }
    });

    /*
     * A rule that only inherits used to keep an empty name until somebody
     * typed one. It is named after what it inherits from now, and the name
     * follows the switches while it is still the form's own.
     */
    test("names a rule that only inherits after its switches, and follows them", async () => {
      const kindWord: string = page.kind === "labels" ? "labels" : "owners";
      const monitors: string = page.monitorsSwitch.endsWith("Monitor")
        ? "monitor"
        : "monitors";
      const hostsSwitch: string =
        page.kind === "labels"
          ? "Inherit Labels From Hosts"
          : "Inherit Owners From Hosts";

      await renderPage(page.Page);
      await within(dialog()).findByRole("navigation", { name: "Progress" });
      await next();
      await openFold(page.foldTitle);

      expect(nameBox()).toHaveValue("");

      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(page.monitorsSwitch));
      });

      await waitFor(() => {
        expect(nameBox()).toHaveValue(`Inherit ${kindWord} from ${monitors}`);
      });

      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(hostsSwitch));
      });

      await waitFor(() => {
        expect(nameBox()).toHaveValue(
          `Inherit ${kindWord} from ${monitors}, hosts`,
        );
      });

      // Turned off again: out of the name.
      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(page.monitorsSwitch));
      });

      await waitFor(() => {
        expect(nameBox()).toHaveValue(`Inherit ${kindWord} from hosts`);
      });

      // The switches stay as they were set, the name beside them.
      expect(switchNamed(page.monitorsSwitch)).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(switchNamed(hostsSwitch)).toHaveAttribute("aria-checked", "true");

      await submit();

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const model: JSONObject = sentModel();
      const hostsColumn: string =
        page.kind === "labels"
          ? "inheritLabelsFromHosts"
          : "inheritOwnersFromHosts";
      const monitorsColumn: string =
        page.kind === "labels"
          ? "inheritLabelsFromMonitors"
          : "inheritOwnersFromMonitors";

      expect(model["name"]).toBe(`Inherit ${kindWord} from hosts`);
      expect(model[hostsColumn]).toBe(true);
      expect(model[monitorsColumn]).toBe(false);
    });

    test("never writes over a name somebody typed as the switches change", async () => {
      await renderPage(page.Page);
      await within(dialog()).findByRole("navigation", { name: "Progress" });
      await next();
      await openFold(page.foldTitle);

      fireEvent.change(nameBox(), {
        target: { value: "What the monitors carry" },
      });

      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(page.monitorsSwitch));
      });

      expect(nameBox()).toHaveValue("What the monitors carry");

      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(page.monitorsSwitch));
      });

      expect(nameBox()).toHaveValue("What the monitors carry");
    });

    test("still will not create a rule that neither names nor inherits anything", async () => {
      await renderPage(page.Page);
      await within(dialog()).findByRole("navigation", { name: "Progress" });
      await next();

      // A switch turned on and off again inherits nothing.
      await openFold(page.foldTitle);
      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(page.monitorsSwitch));
      });
      await act(async (): Promise<void> => {
        fireEvent.click(switchNamed(page.monitorsSwitch));
      });

      fireEvent.change(nameBox(), { target: { value: "Does nothing" } });
      await submit();

      expect(
        await within(dialog()).findByText(
          page.kind === "labels"
            ? "Labels to Add is required."
            : "Owners is required.",
        ),
      ).toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });
  },
);

describe("an incident rule that inherits, then picks", () => {
  test("is named after its first label over the name its switch gave it", async () => {
    const user: UserEvent = await renderPage(IncidentLabelRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await openFold("Inherit Labels");
    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Inherit Labels From Monitors"));
    });

    await waitFor(() => {
      expect(nameBox()).toHaveValue("Inherit labels from monitors");
    });

    await pickLabel(user, "production");

    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add production");
    });

    // A switch now leaves the picks' name alone.
    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Inherit Labels From Services"));
    });

    expect(nameBox()).toHaveValue("Add production");

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Add production");
    expect(ids(model["labelsToAdd"])).toEqual([PRODUCTION]);
    expect(model["inheritLabelsFromMonitors"]).toBe(true);
    expect(model["inheritLabelsFromServices"]).toBe(true);
  });

  test("an owner rule is named after its first owner over its switches' name", async () => {
    await renderPage(IncidentOwnerRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await openFold("Inherit Owners");
    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Inherit Owners From Kubernetes Clusters"));
    });

    await waitFor(() => {
      expect(nameBox()).toHaveValue("Inherit owners from Kubernetes clusters");
    });

    await pickOwner("Platform");

    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add Platform as owners");
    });
  });
});

describe("editing a rule that only inherits, named after its switches", () => {
  test("follows the switches while the name is still the one they gave it", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new IncidentLabelRule(), {
          _id: RULE_ID,
          name: "Inherit labels from services",
          isEnabled: true,
          labelsToAdd: [],
          inheritLabelsFromServices: true,
        }),
      );
    }) as never);

    await renderPage(IncidentLabelRules, "edit");
    await openLastStep();
    await within(dialog()).findByRole("switch", { name: /Enabled/ });

    await waitFor(() => {
      expect(fold("Inherit Labels")).toHaveAttribute("aria-expanded", "true");
    });

    expect(nameBox()).toHaveValue("Inherit labels from services");

    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Inherit Labels From Hosts"));
    });

    await waitFor(() => {
      expect(nameBox()).toHaveValue("Inherit labels from hosts, services");
    });

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentModel()["name"]).toBe("Inherit labels from hosts, services");
  });

  test("keeps a name somebody gave it", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new IncidentLabelRule(), {
          _id: RULE_ID,
          name: "Inherit services' labels",
          isEnabled: true,
          labelsToAdd: [],
          inheritLabelsFromServices: true,
        }),
      );
    }) as never);

    await renderPage(IncidentLabelRules, "edit");
    await openLastStep();
    await within(dialog()).findByRole("switch", { name: /Enabled/ });

    await waitFor(() => {
      expect(fold("Inherit Labels")).toHaveAttribute("aria-expanded", "true");
    });

    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Inherit Labels From Hosts"));
    });

    expect(nameBox()).toHaveValue("Inherit services' labels");
  });
});

describe("an incident label rule, as somebody fills it in", () => {
  test("names the rule after its labels, and inherits beside them", async () => {
    const user: UserEvent = await renderPage(IncidentLabelRules);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await pickLabel(user, "production");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add production");
    });

    await openFold("Inherit Labels");
    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Inherit Labels From Hosts"));
    });

    // An inherit switch does not rename the rule.
    expect(nameBox()).toHaveValue("Add production");

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Add production");
    expect(ids(model["labelsToAdd"])).toEqual([PRODUCTION]);
    expect(model["inheritLabelsFromHosts"]).toBe(true);
    expect(model["inheritLabelsFromMonitors"]).toBe(false);
  });
});

/*
 * Decision: an Edit form asks for nothing the rule adds. A rule saved
 * before the form asked - through the API, Terraform, an import or the old
 * form - may add nothing; it can still be renamed, switched off or deleted
 * without first being given labels or owners.
 */
describe("editing a rule saved before the form asked what it adds", () => {
  test.each([
    {
      name: "a host label rule",
      Page: HostLabelRules,
      rule: (): BaseModel => {
        return Object.assign(new HostLabelRule(), {
          _id: RULE_ID,
          name: "Old host rule",
          description: "",
          isEnabled: true,
          labelsToAdd: [],
        });
      },
    },
    {
      name: "a host owner rule",
      Page: HostOwnerRules,
      rule: (): BaseModel => {
        return Object.assign(new HostOwnerRule(), {
          _id: RULE_ID,
          name: "Old host rule",
          description: "",
          isEnabled: true,
          notifyOwners: true,
          ownerUsers: [],
          ownerTeams: [],
        });
      },
    },
    {
      name: "an incident label rule",
      Page: IncidentLabelRules,
      rule: (): BaseModel => {
        return Object.assign(new IncidentLabelRule(), {
          _id: RULE_ID,
          name: "Old incident rule",
          description: "",
          isEnabled: true,
          labelsToAdd: [],
          inheritLabelsFromMonitors: false,
        });
      },
    },
    {
      name: "a monitor owner rule",
      Page: MonitorOwnerRules,
      rule: (): BaseModel => {
        return Object.assign(new MonitorOwnerRule(), {
          _id: RULE_ID,
          name: "Old monitor rule",
          description: "",
          isEnabled: true,
          notifyOwners: true,
          ownerUsers: [],
          ownerTeams: [],
        });
      },
    },
    {
      name: "a status page label rule",
      Page: StatusPageLabelRules,
      rule: (): BaseModel => {
        return Object.assign(new StatusPageLabelRule(), {
          _id: RULE_ID,
          name: "Old status page rule",
          description: "",
          isEnabled: true,
          labelsToAdd: [],
        });
      },
    },
  ])(
    "renames and switches off $name that adds nothing",
    async (testCase: { Page: RulePage; rule: () => BaseModel }) => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(testCase.rule());
      }) as never);

      await renderPage(testCase.Page, "edit");
      await openLastStep();

      const enabled: HTMLElement = await within(dialog()).findByRole("switch", {
        name: /Enabled/,
      });

      fireEvent.change(nameBox(), { target: { value: "Renamed, for now" } });
      await act(async (): Promise<void> => {
        fireEvent.click(enabled);
      });

      await submit();

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      expect(within(dialog()).queryByText(/is required\./)).toBeNull();

      const model: JSONObject = sentModel();

      expect(model["name"]).toBe("Renamed, for now");
      expect(model["isEnabled"]).toBe(false);
    },
  );

  test("reads its labels as optional", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new HostLabelRule(), {
          _id: RULE_ID,
          name: "Old host rule",
          isEnabled: true,
          labelsToAdd: [],
        }),
      );
    }) as never);

    await renderPage(HostLabelRules, "edit");
    await openLastStep();

    expect(
      await within(dialog()).findByRole("combobox", {
        name: "Labels to Add (Optional)",
      }),
    ).toBeVisible();
  });

  test("still asks for a name: a rule is always called something", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new HostLabelRule(), {
          _id: RULE_ID,
          name: "Old host rule",
          isEnabled: true,
          labelsToAdd: [],
        }),
      );
    }) as never);

    await renderPage(HostLabelRules, "edit");
    await openLastStep();
    await within(dialog()).findByRole("switch", { name: /Enabled/ });

    fireEvent.change(nameBox(), { target: { value: "" } });
    await submit();

    expect(
      await within(dialog()).findByText("Name is required."),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("editing an incident, alert or maintenance rule that inherits", () => {
  test.each([
    {
      name: "an incident label rule",
      Page: IncidentLabelRules,
      foldTitle: "Inherit Labels",
      switchName: "Inherit Labels From Services",
      rule: (): BaseModel => {
        return Object.assign(new IncidentLabelRule(), {
          _id: RULE_ID,
          name: "Inherit services' labels",
          isEnabled: true,
          labelsToAdd: [],
          inheritLabelsFromServices: true,
        });
      },
    },
    {
      name: "an alert label rule",
      Page: AlertLabelRules,
      foldTitle: "Inherit Labels",
      switchName: "Inherit Labels From Monitor",
      rule: (): BaseModel => {
        return Object.assign(new AlertLabelRule(), {
          _id: RULE_ID,
          name: "Inherit the monitor's labels",
          isEnabled: true,
          labelsToAdd: [],
          inheritLabelsFromMonitors: true,
        });
      },
    },
    {
      name: "an incident owner rule",
      Page: IncidentOwnerRules,
      foldTitle: "Inherit Owners",
      switchName: "Inherit Owners From Hosts",
      rule: (): BaseModel => {
        return Object.assign(new IncidentOwnerRule(), {
          _id: RULE_ID,
          name: "Inherit hosts' owners",
          isEnabled: true,
          notifyOwners: true,
          ownerUsers: [],
          ownerTeams: [],
          inheritOwnersFromHosts: true,
        });
      },
    },
    {
      name: "a scheduled maintenance owner rule",
      Page: ScheduledMaintenanceOwnerRules,
      foldTitle: "Inherit Owners",
      switchName: "Inherit Owners From Monitors",
      rule: (): BaseModel => {
        return Object.assign(new ScheduledMaintenanceOwnerRule(), {
          _id: RULE_ID,
          name: "Inherit monitors' owners",
          isEnabled: true,
          notifyOwners: true,
          ownerUsers: [],
          ownerTeams: [],
          inheritOwnersFromMonitors: true,
        });
      },
    },
  ])(
    "opens the fold of $name, its switch on, and keeps it on when saved",
    async (testCase: {
      Page: RulePage;
      foldTitle: string;
      switchName: string;
      rule: () => BaseModel;
    }) => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(testCase.rule());
      }) as never);

      await renderPage(testCase.Page, "edit");
      await openLastStep();
      await within(dialog()).findByRole("switch", { name: /Enabled/ });

      // What the rule adds is never hidden: the fold opens on its own.
      await waitFor(() => {
        expect(fold(testCase.foldTitle)).toHaveAttribute(
          "aria-expanded",
          "true",
        );
      });
      expect(switchNamed(testCase.switchName)).toHaveAttribute(
        "aria-checked",
        "true",
      );

      await submit();

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });
    },
  );
});
