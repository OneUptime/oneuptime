// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * ONE NAME FOR A KIND OF CLOUD RESOURCE, IN SPANISH TOO (#7659).
 *
 * The catalog's labels are the clouds' product names - "Virtual Machine",
 * "Load Balancer", "Network Interface" - drawn as written in every language,
 * as every docs language writes them in its tables of supported resources.
 * A Spanish account page said "Virtual Machine" in its rows and in its Type
 * filter's chip, but "Máquina virtual" in the same filter's menu; and a
 * resource's Connected Resources said "Interfaz de red" and "Balanceador de
 * carga" beside "Virtual Machine Scale Set": seven of the catalog's labels
 * are also words the Dashboard translates, and those two places looked
 * every label up. Now the menu, its chip, the rows and the cards all name a
 * kind by the catalog's label, and a type the catalog only names in words -
 * a subnet - reads in the reader's words ("Subred") wherever it shows.
 *
 * The real account page and the real cards, in Spanish, over a fake
 * ModelAPI. CloudResourceTypeNamesGuard keeps every other place that names
 * a type to the same rule.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may read every cloud resource.
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
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
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudRelationshipKind } from "../../../Types/Cloud/CloudInventory";
import {
  AZURE_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
} from "../../../Types/Cloud/CloudResourceCatalog";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import CloudResourceInventoryCards from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceInventoryCards";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CloudAccountResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Resources";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { PROJECT_ID } from "./SideMenuHarness";

const SPANISH: Record<string, string> = readDashboardLocale("es");

const ACCOUNT_ROW_ID: string = "70000000-0000-4000-8000-000000000001";
const SUBSCRIPTION: string = "00000000-0000-4000-8000-0000000000aa";
const GROUP: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/web`;
const TABLE_ID: string = "cloud-account-resources-table";
const VIRTUAL_MACHINE: string = "Microsoft.Compute/virtualMachines";

const ACCOUNT: CloudAccount = Object.assign(new CloudAccount(), {
  _id: ACCOUNT_ROW_ID,
  name: "Production",
  provider: CloudProvider.Azure,
  accountId: SUBSCRIPTION,
});

function resource(data: {
  id: string;
  name: string;
  type: string;
  path: string;
  relationships?: Array<{
    kind: CloudRelationshipKind;
    target: string;
    targetType: string;
  }>;
}): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: data.id,
    name: data.name,
    cloudProvider: CloudProvider.Azure,
    cloudAccountId: SUBSCRIPTION,
    cloudResourceType: data.type,
    cloudRegion: "westeurope",
    providerResourceId: `${GROUP}/providers/${data.path}`,
    cloudRelationships: data.relationships || [],
  });
}

const LOAD_BALANCER_PATH: string = "Microsoft.Network/loadBalancers/web-lb";
const SUBNET_ID: string = `${GROUP}/providers/Microsoft.Network/virtualNetworks/vnet/subnets/default`;

// A virtual machine, its scale set and network interface, and their load balancer.
const VM: CloudResource = resource({
  id: "70000000-0000-4000-8000-000000000011",
  name: "web-01",
  type: VIRTUAL_MACHINE,
  path: "Microsoft.Compute/virtualMachines/web-01",
});
const SCALE_SET: CloudResource = resource({
  id: "70000000-0000-4000-8000-000000000012",
  name: "web-vmss",
  type: "Microsoft.Compute/virtualMachineScaleSets",
  path: "Microsoft.Compute/virtualMachineScaleSets/web-vmss",
});
const NETWORK_INTERFACE: CloudResource = resource({
  id: "70000000-0000-4000-8000-000000000013",
  name: "web-01-nic",
  type: "Microsoft.Network/networkInterfaces",
  path: "Microsoft.Network/networkInterfaces/web-01-nic",
  relationships: [
    {
      kind: CloudRelationshipKind.AttachedTo,
      target: `${GROUP}/providers/${LOAD_BALANCER_PATH}`,
      targetType: "Microsoft.Network/loadBalancers",
    },
  ],
});
const LOAD_BALANCER: CloudResource = resource({
  id: "70000000-0000-4000-8000-000000000014",
  name: "web-lb",
  type: "Microsoft.Network/loadBalancers",
  path: LOAD_BALANCER_PATH,
  relationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: VM.providerResourceId as string,
      targetType: VIRTUAL_MACHINE,
    },
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: SCALE_SET.providerResourceId as string,
      targetType: "Microsoft.Compute/virtualMachineScaleSets",
    },
    {
      kind: CloudRelationshipKind.RunsIn,
      target: SUBNET_ID,
      targetType: "Microsoft.Network/virtualNetworks/subnets",
    },
  ],
});

const RESOURCES: Array<CloudResource> = [
  VM,
  SCALE_SET,
  NETWORK_INTERFACE,
  LOAD_BALANCER,
];

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/cloud/accounts`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      es: { translation: SPANISH },
      en: { translation: readDashboardLocale("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<BaseModel | null> => {
        return options.modelType === CloudAccount ? ACCOUNT : null;
      },
    );
  // The account's resources - of the type the filter asks for, if it asks.
  const listed: (query: unknown) => Array<CloudResource> = (
    query: unknown,
  ): Array<CloudResource> => {
    const type: unknown = (query as Record<string, unknown> | undefined)?.[
      "cloudResourceType"
    ];

    return RESOURCES.filter((row: CloudResource): boolean => {
      return (
        type === undefined ||
        JSON.stringify(type).includes(row.cloudResourceType as string)
      );
    });
  };
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query?: unknown;
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> =
          options.modelType === CloudResource ? listed(options.query) : [];

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query?: unknown;
      }): Promise<number> => {
        return options.modelType === CloudResource
          ? listed(options.query).length
          : 0;
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The account's Resources, opened from a link that filters it to its virtual machines.
async function renderAccountResourcesOfType(type: string): Promise<void> {
  const params: Record<string, string> = TableFilterUrlState.getLinkQueryParams(
    TABLE_ID,
    { filter: { cloudResourceType: type } },
  );
  const search: string = Object.keys(params)
    .map((name: string): string => {
      return `${name}=${params[name]}`;
    })
    .join("&");

  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/cloud/accounts/${ACCOUNT_ROW_ID}/resources?${search}`,
  );

  await act(async () => {
    render(
      <MemoryRouter>
        <CloudAccountResources {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
  await settle();
}

// The chip over the list that starts with a filter's name.
function chipOf(field: string): HTMLElement {
  const chip: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(".rounded-full"),
  ).find((element: HTMLElement): boolean => {
    return (element.textContent || "").startsWith(`${field} `);
  });

  if (!chip) {
    throw new Error(`No chip for ${field}`);
  }

  return chip;
}

// A filter's row in the Filter dialog, found by its label.
function filterRowOf(field: string): HTMLElement {
  const label: HTMLElement = screen.getByText(field, { selector: "label" });

  return label.parentElement!.parentElement as HTMLElement;
}

/*
 * Edit Filters, then the Type filter's menu: the type it has picked, and
 * every type it offers.
 */
async function openTypeMenu(): Promise<{
  picked: string;
  options: Array<string>;
}> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: SPANISH["Edit Filters"]! }),
    );
  });
  await settle();

  const typeRow: HTMLElement = filterRowOf(SPANISH["Type"]!);
  const picked: string =
    within(typeRow).getByTestId("dropdown-value-label").textContent || "";

  await act(async () => {
    fireEvent.keyDown(within(typeRow).getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
  });

  const menu: HTMLElement | null =
    document.querySelector<HTMLElement>(".ou-select__menu");

  if (!menu) {
    throw new Error("The Type menu did not open");
  }

  const options: Array<string> = within(menu)
    .getAllByTestId("dropdown-option-label")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });

  return { picked, options };
}

// What a connected resource is, beside its name on the Connected Resources card.
function kindNextTo(text: string): string {
  const item: HTMLElement = screen.getByText(text).closest("li")!;

  return within(item).queryByTestId("cloud-connection-type")?.textContent || "";
}

const AZURE_LABELS: Array<string> = AZURE_RESOURCE_TYPES.map(
  (descriptor: CloudResourceTypeDescriptor): string => {
    return descriptor.label;
  },
);

describe("the words the cases below lean on", () => {
  test("Spanish has its own words for some of the catalog's labels, and for a subnet", () => {
    for (const label of [
      "Virtual Machine",
      "Load Balancer",
      "Network Interface",
      "Subnet",
    ]) {
      expect(SPANISH[label]).toBeTruthy();
      expect(SPANISH[label]).not.toBe(label);
    }

    for (const label of [
      "Virtual Machine",
      "Load Balancer",
      "Network Interface",
    ]) {
      expect(AZURE_LABELS).toContain(label);
    }
    expect(AZURE_LABELS).not.toContain("Subnet");
  });
});

describe("a Spanish cloud account's resources, filtered to a type", () => {
  test("the rows, the chip, the picked type and the Type menu name it by the catalog's label", async () => {
    await renderAccountResourcesOfType(VIRTUAL_MACHINE);

    // The row: what it is and where, under its name.
    expect(await screen.findByText("web-01")).toBeInTheDocument();
    expect(screen.getByTestId("cloud-account-resource-where").textContent).toBe(
      "Virtual Machine · westeurope",
    );

    // The chip: "Tipo es Virtual Machine".
    expect(chipOf(SPANISH["Type"]!).textContent).toBe(
      `${SPANISH["Type"]} es Virtual Machine`,
    );

    // The Filter dialog: the picked type, and the menu of every Azure type.
    const menu: { picked: string; options: Array<string> } =
      await openTypeMenu();

    expect(menu.picked).toBe("Virtual Machine");
    expect(menu.options).toEqual(
      [...AZURE_LABELS].sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    );
    for (const spanish of [
      SPANISH["Virtual Machine"],
      SPANISH["Load Balancer"],
      SPANISH["Network Interface"],
    ]) {
      expect(menu.options).not.toContain(spanish);
    }
  });
});

describe("a Spanish resource's connections", () => {
  test("name each listed kind as the account's Type filter does, and a subnet in Spanish", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <CloudResourceInventoryCards resource={LOAD_BALANCER} />
        </MemoryRouter>,
      );
    });
    await settle();

    expect(
      await screen.findByText(SPANISH["Connected Resources"]!),
    ).toBeInTheDocument();

    const kinds: Record<string, string> = {
      "web-01": kindNextTo("web-01"),
      "web-vmss": kindNextTo("web-vmss"),
      "web-01-nic": kindNextTo("web-01-nic"),
      [SUBNET_ID]: kindNextTo(SUBNET_ID),
    };

    expect(kinds).toEqual({
      "web-01": "Virtual Machine",
      "web-vmss": "Virtual Machine Scale Set",
      "web-01-nic": "Network Interface",
      [SUBNET_ID]: SPANISH["Subnet"],
    });

    // The account's Type filter, in the same Spanish: the same words.
    cleanup();
    await renderAccountResourcesOfType(VIRTUAL_MACHINE);
    expect(await screen.findByText("web-01")).toBeInTheDocument();

    const menu: { picked: string; options: Array<string> } =
      await openTypeMenu();

    expect(menu.picked).toBe(kinds["web-01"]);
    expect(menu.options).toEqual(
      expect.arrayContaining([
        kinds["web-01"],
        kinds["web-vmss"],
        kinds["web-01-nic"],
      ]),
    );
    // A subnet is no type of its own in the catalog: never in the menu.
    expect(menu.options).not.toContain(kinds[SUBNET_ID]);
  });
});
