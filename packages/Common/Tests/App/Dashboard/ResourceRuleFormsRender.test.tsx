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
 * Every resource product's Label Rules and Owner Rules pages, their create
 * and edit forms drawn for real - the pages' own fields in the
 * ModelFormModal, ModelForm and BasicForm their tables open - with only the
 * table around them, the network and the permissions stubbed.
 *
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." A rule used to open on Basic Info - a name before
 * anyone had said what the rule was for - and asked what it adds, optional,
 * only on its third step. Now:
 *
 *   - it walks Match (the conditions builder), then Labels or Owners;
 *   - what it adds is required, and the name is filled in from it ("Add
 *     production, eu-west", "Add Ada Lovelace as owners"), following the
 *     picks until somebody types a name of their own;
 *   - the description - and Notify Owners, on - wait folded under More
 *     fields; Enabled is on the Edit form only.
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
            ? [Object.assign(new TeamModel(), { _id: platformId, name: "Platform" })]
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

async function pickLabel(user: UserEvent, name: string): Promise<void> {
  await user.click(
    within(dialog()).getByRole("combobox", { name: "Labels to Add" }),
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
    expect(within(dialog()).queryByRole("textbox", { name: "Name" })).toBeNull();
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
    expect(within(dialog()).queryByRole("switch", { name: /Enabled/ })).toBeNull();
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

