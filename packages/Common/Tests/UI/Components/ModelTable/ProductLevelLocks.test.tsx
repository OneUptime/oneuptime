import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PRODUCT'S PAGES LOCK WHAT ITS LEVEL DOES NOT ALLOW (#10289).
 *
 * A team given one product at a level ("Network Viewer", "Cloud Admin")
 * reads that product's pages as a project-wide role reads them there, and
 * no further: every product's list is the shared table, which locks its
 * Create, Edit and Delete by the model's own permission lists, and a
 * level is on those lists where the role it follows is
 * (Common/Types/Product/ProductLevels). So, drawn for each level:
 *
 *   - a product's Viewer sees its records' Create locked, saying why and
 *     naming the level that would let them;
 *   - its Member creates, edits and deletes them;
 *   - another product's Admin is locked out of it as a Viewer is;
 *   - a record only an admin changes - a cloud connection, with its
 *     credentials - is locked for the Member, and open to the Admin.
 *
 * The server holds every one of these too (ProductLevelsOverHttp, and
 * ProductLevelsEscalationOverHttp for what no level reaches).
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
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

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Permission, { PermissionHelper } from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

interface Product {
  name: string;
  modelType: { new (): BaseModel };
  singularName: string;
  viewer: Permission;
  member: Permission;
  admin: Permission;
  // Another product's Admin: locked out of this one.
  otherAdmin: Permission;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Network",
    modelType: NetworkDevice,
    singularName: "Network Device",
    viewer: Permission.NetworkViewer,
    member: Permission.NetworkMember,
    admin: Permission.NetworkAdmin,
    otherAdmin: Permission.CloudAdmin,
  },
  {
    name: "Kubernetes",
    modelType: KubernetesCluster,
    singularName: "Kubernetes Cluster",
    viewer: Permission.KubernetesViewer,
    member: Permission.KubernetesMember,
    admin: Permission.KubernetesAdmin,
    otherAdmin: Permission.DockerAdmin,
  },
];

const ROWS: Array<JSONObject> = [{ _id: "row-1", name: "core-1" }];

function propsFor(
  modelType: { new (): BaseModel },
  singularName: string,
): BaseModelTableProps<BaseModel> {
  const callbacks: BaseTableCallbacks<BaseModel> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): BaseModel => {
      return item as unknown as BaseModel;
    },
    getJSONFromModel: (item: BaseModel): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<BaseModel>> => {
      return {
        data: ROWS as unknown as Array<BaseModel>,
        count: ROWS.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<BaseModel>;

  return {
    modelType: modelType,
    id: "product-level-table",
    name: `${singularName}s`,
    singularName: singularName,
    pluralName: `${singularName}s`,
    userPreferencesKey: "product-level-table",
    urlStateKey: "product-level-table",
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    cardProps: { title: `${singularName}s`, description: "Records" },
    isCreateable: true,
    isEditable: true,
    isDeleteable: true,
    isViewable: false,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<BaseModel>;
}

function findButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement): boolean => {
        return (button.getAttribute("aria-label") || button.textContent || "")
          .trim()
          .startsWith(label);
      },
    ) || null
  );
}

async function drawFor(
  permissions: Array<Permission>,
  modelType: { new (): BaseModel },
  singularName: string,
): Promise<HTMLButtonElement> {
  permissionsForTest = [Permission.ProjectUser, ...permissions];
  PermissionGate.clearPermissionPropsCache();

  render(<BaseModelTable<BaseModel> {...propsFor(modelType, singularName)} />);

  await waitFor(() => {
    expect(findButton(`Create ${singularName}`)).not.toBeNull();
  });

  return findButton(`Create ${singularName}`)!;
}

function tooltipOf(button: HTMLButtonElement): string {
  fireEvent.mouseEnter(button.parentElement as HTMLElement);

  return screen.getByRole("tooltip").textContent || "";
}

beforeEach(() => {
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/products");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PRODUCTS)(
  "$name's records, drawn for each level",
  (product: Product) => {
    test("its Viewer sees Create locked, saying why and what would let them", async () => {
      const create: HTMLButtonElement = await drawFor(
        [product.viewer],
        product.modelType,
        product.singularName,
      );

      expect(create).toBeDisabled();

      /*
       * The permission of its kind is named, as for any reader: the one
       * that lets exactly this (PermissionGate.getReadPermissionsOfItsKind).
       */
      expect(tooltipOf(create)).toBe(
        `You do not have permission to create this ${product.singularName}. You need this permission: Create ${product.singularName}.`,
      );
    });

    test("its Member creates them", async () => {
      const create: HTMLButtonElement = await drawFor(
        [product.member],
        product.modelType,
        product.singularName,
      );

      expect(create).not.toBeDisabled();
    });

    test("its Admin creates them", async () => {
      const create: HTMLButtonElement = await drawFor(
        [product.admin],
        product.modelType,
        product.singularName,
      );

      expect(create).not.toBeDisabled();
    });

    test("another product's Admin is locked out, as a Viewer is", async () => {
      const create: HTMLButtonElement = await drawFor(
        [product.otherAdmin],
        product.modelType,
        product.singularName,
      );

      expect(create).toBeDisabled();
    });
  },
);

describe("a record only an admin changes: a cloud connection, with its credentials", () => {
  test.each([
    ["Cloud Viewer", Permission.CloudViewer, true],
    ["Cloud Member", Permission.CloudMember, true],
    ["Network Admin", Permission.NetworkAdmin, true],
    ["Cloud Admin", Permission.CloudAdmin, false],
  ] as Array<[string, Permission, boolean]>)(
    "%s (%s): Create Cloud Connection is locked: %s",
    async (_name: string, permission: Permission, isLocked: boolean) => {
      const create: HTMLButtonElement = await drawFor(
        [permission],
        CloudConnection,
        "Cloud Connection",
      );

      if (isLocked) {
        expect(create).toBeDisabled();
        expect(tooltipOf(create)).toContain(
          PermissionHelper.getTitle(Permission.CloudAdmin),
        );
      } else {
        expect(create).not.toBeDisabled();
      }
    },
  );
});
