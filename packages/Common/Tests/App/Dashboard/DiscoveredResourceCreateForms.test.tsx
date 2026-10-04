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
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import type { Mock } from "jest-mock";

/*
 * Creating a host, a Docker or Podman host, a Kubernetes cluster, a RUM
 * application, a serverless function or a cloud environment by hand.
 *
 * "Make software as simple as possible to use and reduce decision
 * paralysis." These forms asked for a Name and an "Identifier" that "should
 * match host.name", so people decided twice and guessed which one the
 * telemetry used. Now each asks only for what the telemetry is matched on,
 * titled after the attribute, and the name is an optional Display Name
 * folded under Advanced, filled in as the identifier is typed - the name
 * ingest gives a discovered one - until somebody types a name of their own.
 *
 * Each page is rendered with its table recorded, so the form fields it
 * really hands the table are the ones tested; then those fields are drawn
 * by the real ModelForm and BasicForm, with only the network stubbed.
 */

interface CapturedSave {
  model: JSONObject;
}

let capturedSaves: Array<CapturedSave> = [];
let modelTableCalls: Array<Record<string, unknown>> = [];

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      // A project that already has some, so the list (not the guide) shows.
      count: async (): Promise<number> => {
        return 3;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 50 };
      },
      getItem: async (): Promise<JSONObject> => {
        return {};
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedSaves.push({ model: data.model });
        return { data: data.model };
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      modelTableCalls.push(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          emptyState: undefined,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { archiveBulkActions: [] };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudFleetSummary",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import CloudResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/CloudResources";
import DockerHosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Hosts";
import Hosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";
import KubernetesClusters from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Clusters";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PodmanHosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Hosts";
import RumApplications from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/RumApplications";
import ServerlessFunctions from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/ServerlessFunctions";
import {
  DISPLAY_NAME_KEY,
  followWithDisplayName,
  getCloudEnvironmentNameFromFields,
  getDisplayNameAfterChange,
  getDisplayNameFormField,
  getIdentityFormField,
  getNameFromIdentityField,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/DiscoveredResourceFormFields";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import ModelForm, {
  FormType,
  ModelField,
  ModelFormOnBeforeCreate,
} from "../../../UI/Components/Forms/ModelForm";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  getAdvancedFormSection,
  isFormFieldValueSet,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  hasSetChip,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

/*
 * ---------------------------------------------------------------------------
 * The rule
 * ---------------------------------------------------------------------------
 */

describe("the display name after what it is made from changes", () => {
  test("is the new name while the form has no name yet", () => {
    for (const displayName of [undefined, null, "", "   "]) {
      expect(
        getDisplayNameAfterChange({
          displayName,
          previousName: "",
          nextName: "web-01",
        }),
      ).toBe("web-01");
    }
  });

  test("follows the identifier while it holds the name it was given", () => {
    expect(
      getDisplayNameAfterChange({
        displayName: "web-0",
        previousName: "web-0",
        nextName: "web-01",
      }),
    ).toBe("web-01");
  });

  test("stays as somebody typed it", () => {
    expect(
      getDisplayNameAfterChange({
        displayName: "Production web server",
        previousName: "web-0",
        nextName: "web-01",
      }),
    ).toBeNull();
  });

  test("stays when somebody typed it over in another case, as every followed name does", () => {
    expect(
      getDisplayNameAfterChange({
        displayName: "WEB-0",
        previousName: "web-0",
        nextName: "web-01",
      }),
    ).toBeNull();
  });

  test("keeps a typed name when the identifier is emptied", () => {
    expect(
      getDisplayNameAfterChange({
        displayName: "Production web server",
        previousName: "w",
        nextName: "",
      }),
    ).toBeNull();
  });

  test("is emptied with the identifier it followed, so the next one is followed too", () => {
    expect(
      getDisplayNameAfterChange({
        displayName: "w",
        previousName: "w",
        nextName: "",
      }),
    ).toBe("");
  });

  test("says nothing when nothing changes", () => {
    expect(
      getDisplayNameAfterChange({
        displayName: "web-01",
        previousName: "web-01",
        nextName: "web-01",
      }),
    ).toBeNull();
    expect(
      getDisplayNameAfterChange({
        displayName: "",
        previousName: "",
        nextName: "",
      }),
    ).toBeNull();
  });
});

describe("followWithDisplayName", () => {
  type Values = FormValues<Host>;

  const follow: (
    value: unknown,
    currentValues: Values,
    setNewFormValues: (values: Values) => void,
  ) => void = followWithDisplayName<Host>({
    fieldKey: "hostIdentifier",
    getDefaultName: getNameFromIdentityField<Host>("hostIdentifier"),
  });

  test("fills the display name in from the value just typed", () => {
    const setNewFormValues: Mock<(values: Values) => void> =
      jest.fn<(values: Values) => void>();

    follow("  web-01 ", { description: "kept" } as Values, setNewFormValues);

    expect(setNewFormValues).toHaveBeenCalledWith({
      description: "kept",
      name: "web-01",
    });
  });

  test("keeps every other value the form holds", () => {
    const setNewFormValues: Mock<(values: Values) => void> =
      jest.fn<(values: Values) => void>();

    follow(
      "web-012",
      { hostIdentifier: "web-01", name: "web-01", labels: [] } as Values,
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledWith({
      hostIdentifier: "web-01",
      name: "web-012",
      labels: [],
    });
  });

  test("leaves a display name of somebody's own alone", () => {
    const setNewFormValues: Mock<(values: Values) => void> =
      jest.fn<(values: Values) => void>();

    follow(
      "web-012",
      { hostIdentifier: "web-01", name: "Production" } as Values,
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("works on a form that has no values yet", () => {
    const setNewFormValues: Mock<(values: Values) => void> =
      jest.fn<(values: Values) => void>();

    follow("w", undefined as unknown as Values, setNewFormValues);

    expect(setNewFormValues).toHaveBeenCalledWith({ name: "w" });
  });
});

describe("the name a cloud environment's form fills in", () => {
  test("is the one ingest gives it, once a platform is picked", () => {
    expect(getCloudEnvironmentNameFromFields<CloudResource>({})).toBe("");
    expect(
      getCloudEnvironmentNameFromFields<CloudResource>({
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBe("");
    expect(
      getCloudEnvironmentNameFromFields<CloudResource>({
        cloudPlatform: "aws_ecs",
      }),
    ).toBe("AWS ECS");
    expect(
      getCloudEnvironmentNameFromFields<CloudResource>({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBe("AWS ECS · us-east-1 · 123456789012");
  });

  test("reads a platform held as the option that was picked", () => {
    expect(
      getCloudEnvironmentNameFromFields<CloudResource>({
        cloudPlatform: {
          label: "Google Cloud Run (gcp_cloud_run)",
          value: "gcp_cloud_run",
        },
        cloudRegion: "us-central1",
      } as unknown as FormValues<CloudResource>),
    ).toBe("GCP Cloud Run · us-central1");
  });
});

describe("the shared fields", () => {
  const advanced: FormFieldCollapsibleSection<Host> =
    getAdvancedFormSection<Host>();

  const identity: Field<Host> = getIdentityFormField<Host>({
    field: { hostIdentifier: true },
    title: "Host Name (host.name)",
    description: "Where it comes from.",
    placeholder: "host-prod-1",
  });

  const displayName: Field<Host> = getDisplayNameFormField<Host>({
    getDefaultName: getNameFromIdentityField<Host>("hostIdentifier"),
    description: "Starts as the host name.",
    placeholder: "Production web server",
    collapsibleSection: advanced,
  });

  test("the identifier is a required text field, open, that the display name follows", () => {
    expect(identity.field).toEqual({ hostIdentifier: true });
    expect(identity.fieldType).toBe(FormFieldSchemaType.Text);
    expect(identity.required).toBe(true);
    expect(identity.collapsibleSection).toBeUndefined();
    expect(identity.defaultValue).toBeUndefined();
    expect(identity.getDefaultValue).toBeUndefined();
    expect(identity.onChange).toBeDefined();
  });

  test("the display name is the optional name column, folded where it is told", () => {
    expect(displayName.field).toEqual({ [DISPLAY_NAME_KEY]: true });
    expect(displayName.title).toBe("Display Name");
    expect(displayName.fieldType).toBe(FormFieldSchemaType.Text);
    expect(displayName.required).toBe(false);
    expect(displayName.collapsibleSection).toBe(advanced);
    // Nothing follows the display name: an identifier is never made from it.
    expect(displayName.onChange).toBeUndefined();
  });

  test("a display name that is still the identifier's is not something set", () => {
    expect(
      isFormFieldValueSet(displayName, {
        hostIdentifier: " web-01 ",
        name: "web-01",
      } as FormValues<Host>),
    ).toBe(false);
    expect(
      isFormFieldValueSet(displayName, {
        hostIdentifier: "web-01",
        name: "",
      } as FormValues<Host>),
    ).toBe(false);
    expect(
      isFormFieldValueSet(displayName, {
        hostIdentifier: "web-01",
        name: "Production web server",
      } as FormValues<Host>),
    ).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The pages' forms, drawn by the real ModelForm
 * ---------------------------------------------------------------------------
 */

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

interface CapturedTable {
  formFields: Array<ModelField<BaseModel>>;
  onBeforeCreate?: ModelFormOnBeforeCreate<BaseModel> | undefined;
  formSteps?: unknown;
}

async function captureTable(
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<CapturedTable> {
  modelTableCalls = [];

  render(<Page {...PAGE_PROPS} />);
  await flush();

  expect(modelTableCalls.length).toBeGreaterThan(0);

  const props: CapturedTable = modelTableCalls[
    modelTableCalls.length - 1
  ] as unknown as CapturedTable;

  cleanup();

  return props;
}

interface IdentityPage {
  label: string;
  page: React.FunctionComponent<PageComponentProps>;
  modelType: { new (): BaseModel };
  identityKey: string;
  identityTitle: string;
  identityPlaceholder: string;
  displayNamePlaceholder: string;
  displayNameHelp: string;
  submitButtonText: string;
}

const HOST_DISPLAY_NAME_HELP: string =
  "Starts as the host name, the way discovered hosts are named. Type a name of your own to show it instead. Telemetry is still matched by the host name.";

const IDENTITY_PAGES: Array<IdentityPage> = [
  {
    label: "Hosts",
    page: Hosts,
    modelType: Host,
    identityKey: "hostIdentifier",
    identityTitle: "Host Name (host.name)",
    identityPlaceholder: "host-prod-1",
    displayNamePlaceholder: "Production web server",
    displayNameHelp: HOST_DISPLAY_NAME_HELP,
    submitButtonText: "Create Host",
  },
  {
    label: "Docker Hosts",
    page: DockerHosts,
    modelType: DockerHost,
    identityKey: "hostIdentifier",
    identityTitle: "Host Name (host.name)",
    identityPlaceholder: "docker-host-prod-1",
    displayNamePlaceholder: "Production Docker host",
    displayNameHelp: HOST_DISPLAY_NAME_HELP,
    submitButtonText: "Create Docker Host",
  },
  {
    label: "Podman Hosts",
    page: PodmanHosts,
    modelType: PodmanHost,
    identityKey: "hostIdentifier",
    identityTitle: "Host Name (host.name)",
    identityPlaceholder: "podman-host-prod-1",
    displayNamePlaceholder: "Production Podman host",
    displayNameHelp: HOST_DISPLAY_NAME_HELP,
    submitButtonText: "Create Podman Host",
  },
  {
    label: "Kubernetes Clusters",
    page: KubernetesClusters,
    modelType: KubernetesCluster,
    identityKey: "clusterIdentifier",
    identityTitle: "Cluster Name (clusterName)",
    identityPlaceholder: "production-us-east-1",
    displayNamePlaceholder: "Production US East",
    displayNameHelp:
      "Starts as the cluster name, the way discovered clusters are named. Type a name of your own to show it instead. Telemetry is still matched by the cluster name.",
    submitButtonText: "Create Kubernetes Cluster",
  },
  {
    label: "RUM Applications",
    page: RumApplications,
    modelType: RumApplication,
    identityKey: "appIdentifier",
    identityTitle: "App Name (service.name)",
    identityPlaceholder: "storefront-web",
    displayNamePlaceholder: "Storefront",
    displayNameHelp:
      "Starts as the app name, the way discovered applications are named. Type a name of your own to show it instead. Telemetry is still matched by the app name.",
    submitButtonText: "Create RUM Application",
  },
  {
    label: "Serverless Functions",
    page: ServerlessFunctions,
    modelType: ServerlessFunction,
    identityKey: "functionIdentifier",
    identityTitle: "Function Name (faas.name)",
    identityPlaceholder: "checkout-handler",
    displayNamePlaceholder: "Checkout handler",
    displayNameHelp:
      "Starts as the function name, the way discovered functions are named. Type a name of your own to show it instead. Telemetry is still matched by the function name.",
    submitButtonText: "Create Serverless Function",
  },
];

async function renderCreateForm(data: {
  modelType: { new (): BaseModel };
  table: CapturedTable;
  submitButtonText: string;
}): Promise<ReturnType<typeof userEvent.setup>> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  await act(async (): Promise<void> => {
    render(
      <ModelForm<BaseModel>
        modelType={data.modelType}
        id="create-discovered-resource-test"
        name="Create"
        fields={data.table.formFields}
        formType={FormType.Create}
        onBeforeCreate={data.table.onBeforeCreate}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText={data.submitButtonText}
      />,
    );
  });

  await screen.findByRole("button", { name: data.submitButtonText });

  // Let BasicForm take its fields' defaults in before anything is typed.
  await act(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });

  return user;
}

function advancedButton(): HTMLElement {
  return screen.getByRole("button", { name: "More fields" });
}

beforeEach(() => {
  capturedSaves = [];
  modelTableCalls = [];
});

afterEach(() => {
  cleanup();
});

describe.each(IDENTITY_PAGES)(
  "Create on the $label page",
  (identityPage: IdentityPage) => {
    let table: CapturedTable;

    beforeEach(async () => {
      table = await captureTable(identityPage.page);
    });

    const identityInput: () => HTMLInputElement = (): HTMLInputElement => {
      return screen.getByPlaceholderText(
        identityPage.identityPlaceholder,
      ) as HTMLInputElement;
    };

    const displayNameInput: () => HTMLInputElement = (): HTMLInputElement => {
      return screen.getByPlaceholderText(
        identityPage.displayNamePlaceholder,
      ) as HTMLInputElement;
    };

    test("hands its table one page of fields, the identifier first", () => {
      expect(table.formSteps).toBeUndefined();
      expect(
        table.formFields.map((field: ModelField<BaseModel>): string => {
          return Object.keys(field.field || {})[0]!;
        }),
      ).toEqual([identityPage.identityKey, "name", "description", "labels"]);
    });

    test("asks only for the identifier, titled after its attribute, with the rest folded", async () => {
      await renderCreateForm({
        modelType: identityPage.modelType,
        table,
        submitButtonText: identityPage.submitButtonText,
      });

      expect(screen.getByText(identityPage.identityTitle)).toBeVisible();
      expect(identityInput()).toBeVisible();

      // One page: no step list, no Next.
      expect(screen.queryByRole("navigation", { name: "Progress" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

      expect(advancedButton()).toHaveAttribute("aria-expanded", "false");
      expect(displayNameInput()).not.toBeVisible();
      expect(setChips()).toEqual([]);

      // No Name of its own to fill in.
      expect(screen.queryByText("Name", { exact: true })).toBeNull();
    });

    test("fills the display name in as the identifier is typed, and keeps following it", async () => {
      const user: ReturnType<typeof userEvent.setup> = await renderCreateForm({
        modelType: identityPage.modelType,
        table,
        submitButtonText: identityPage.submitButtonText,
      });

      await user.type(identityInput(), "edge-7");

      await user.click(advancedButton());

      await waitFor(() => {
        expect(displayNameInput().value).toBe("edge-7");
      });
      expect(screen.getByText(identityPage.displayNameHelp)).toBeVisible();

      await user.type(identityInput(), "b");

      await waitFor(() => {
        expect(displayNameInput().value).toBe("edge-7b");
      });

      // A followed name is not "something set": folded, the header stays plain.
      await user.click(advancedButton());
      expect(setChips()).toEqual([]);
    });

    test("stops following once a display name of one's own is typed", async () => {
      const user: ReturnType<typeof userEvent.setup> = await renderCreateForm({
        modelType: identityPage.modelType,
        table,
        submitButtonText: identityPage.submitButtonText,
      });

      await user.type(identityInput(), "edge-7");
      await user.click(advancedButton());

      await waitFor(() => {
        expect(displayNameInput().value).toBe("edge-7");
      });

      fireEvent.change(displayNameInput(), {
        target: { value: "Edge in Frankfurt" },
      });

      await user.type(identityInput(), "b");

      // Given a moment to follow, it does not.
      await act(async (): Promise<void> => {
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 0);
        });
      });

      expect(displayNameInput().value).toBe("Edge in Frankfurt");

      // A name of one's own is something set: folded, the header says so.
      await user.click(advancedButton());
      expect(hasSetChip()).toBe(true);
    });

    test("creates the resource with the identifier and the name made from it", async () => {
      const user: ReturnType<typeof userEvent.setup> = await renderCreateForm({
        modelType: identityPage.modelType,
        table,
        submitButtonText: identityPage.submitButtonText,
      });

      await user.type(identityInput(), "edge-7");

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: identityPage.submitButtonText }),
        );
      });

      await waitFor(() => {
        expect(capturedSaves).toHaveLength(1);
      });

      const saved: JSONObject = capturedSaves[0]!.model;

      expect(saved[identityPage.identityKey]).toBe("edge-7");
      expect(saved["name"]).toBe("edge-7");
    });

    test("asks for the identifier, not a name, when nothing is typed", async () => {
      await renderCreateForm({
        modelType: identityPage.modelType,
        table,
        submitButtonText: identityPage.submitButtonText,
      });

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: identityPage.submitButtonText }),
        );
      });

      expect(
        await screen.findByText(`${identityPage.identityTitle} is required.`),
      ).toBeVisible();
      expect(capturedSaves).toHaveLength(0);
    });
  },
);

describe("Create on the Cloud Environments page", () => {
  let table: CapturedTable;

  beforeEach(async () => {
    table = await captureTable(CloudResources);
  });

  const displayNameInput: () => HTMLInputElement = (): HTMLInputElement => {
    return screen.getByPlaceholderText(
      "AWS ECS · us-east-1 · 123456789012",
    ) as HTMLInputElement;
  };

  test("hands its table one page: platform, account and region, then the folded rest", () => {
    expect(table.formSteps).toBeUndefined();
    expect(
      table.formFields.map((field: ModelField<BaseModel>): string => {
        return Object.keys(field.field || {})[0]!;
      }),
    ).toEqual([
      "cloudPlatform",
      "cloudAccountId",
      "cloudRegion",
      "name",
      "description",
      "labels",
    ]);
  });

  test("names the environment as its platform, region and account are filled in, and creates it with its key", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderCreateForm({
      modelType: CloudResource,
      table,
      submitButtonText: "Create Cloud Environment",
    });

    // One page: the Details step is gone.
    expect(screen.queryByRole("navigation", { name: "Progress" })).toBeNull();
    expect(advancedButton()).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("combobox", { name: "Cloud Platform" }));
    await user.click(
      await screen.findByRole("option", {
        name: "AWS ECS / Fargate (aws_ecs)",
      }),
    );

    await user.click(advancedButton());

    await waitFor(() => {
      expect(displayNameInput().value).toBe("AWS ECS");
    });

    await user.type(screen.getByPlaceholderText("us-east-1"), "us-east-1");

    await waitFor(() => {
      expect(displayNameInput().value).toBe("AWS ECS · us-east-1");
    });

    await user.type(
      screen.getByPlaceholderText("123456789012"),
      "123456789012",
    );

    await waitFor(() => {
      expect(displayNameInput().value).toBe(
        "AWS ECS · us-east-1 · 123456789012",
      );
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: "Create Cloud Environment" }),
      );
    });

    await waitFor(() => {
      expect(capturedSaves).toHaveLength(1);
    });

    const saved: JSONObject = capturedSaves[0]!.model;

    expect(saved["name"]).toBe("AWS ECS · us-east-1 · 123456789012");
    expect(saved["resourceIdentifier"]).toBe("aws_ecs|123456789012|us-east-1");
    expect(saved["cloudProvider"]).toBe("aws");
  });

  test("keeps a display name of one's own when the region changes", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderCreateForm({
      modelType: CloudResource,
      table,
      submitButtonText: "Create Cloud Environment",
    });

    await user.click(screen.getByRole("combobox", { name: "Cloud Platform" }));
    await user.click(
      await screen.findByRole("option", {
        name: "AWS ECS / Fargate (aws_ecs)",
      }),
    );
    await user.click(advancedButton());

    await waitFor(() => {
      expect(displayNameInput().value).toBe("AWS ECS");
    });

    fireEvent.change(displayNameInput(), {
      target: { value: "Checkout production" },
    });

    await user.type(screen.getByPlaceholderText("us-east-1"), "eu-west-1");

    expect(displayNameInput().value).toBe("Checkout production");
  });
});
