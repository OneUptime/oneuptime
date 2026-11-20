import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * WHO CAN REACH A DATA STORE (Data Security > Access, a store's Who Can
 * Reach It), FOR EACH READER OF ACCESSES (#10281).
 *
 * The table shows each grant with the store it reaches, and the store's
 * sensitivity. A relation reads a store's sensitivity only for who may read
 * the store, and a table's read is refused whole for one column the server
 * will not read: so a custom role that reads accesses and not stores was
 * shown an error in place of the list. The table now has the column only
 * for who may read it, and its read is the server's to answer for every
 * reader of accesses.
 *
 * The table is captured rather than drawn: what is under test is the
 * columns it is handed for each reader, and that the server's own check of
 * a select through a relation (QueryPermission.checkRelationQueryPermission)
 * takes the read those columns make.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import AccessTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/AccessTable";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Select from "../../../Server/Types/Database/Select";
import TableSelect from "../../../Types/BaseDatabase/Select";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Columns from "../../../UI/Components/ModelTable/Columns";
import { getRelationSelectFromColumns } from "../../../UI/Components/ModelTable/SelectFromColumns";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";

const PROJECT_ID: ObjectID = new ObjectID(
  "10281000-0000-4000-8000-000000000003",
);

interface Reader {
  name: string;
  permissions: Array<Permission>;
  readsStore: boolean;
}

const READERS: Array<Reader> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    readsStore: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    readsStore: true,
  },
  {
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    readsStore: true,
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    readsStore: true,
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    readsStore: true,
  },
  {
    name: "a custom role that reads accesses and not stores",
    permissions: [Permission.ReadDataStoreAccess],
    readsStore: false,
  },
];

function propsOf(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function columnsFor(
  permissions: Array<Permission>,
): Promise<Columns<DataStoreAccess>> {
  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  mockCapturedTableProps.length = 0;

  await act(async () => {
    render(
      <MemoryRouter>
        <AccessTable
          id="data-security-access-external"
          title="Who Can Reach It"
          description="Every grant that reaches a store."
          noItemsMessage="No grants yet."
          isExternal={true}
        />
      </MemoryRouter>,
    );
  });

  return mockCapturedTableProps[mockCapturedTableProps.length - 1]![
    "columns"
  ] as Columns<DataStoreAccess>;
}

// The store's columns the table's read takes through the relation.
function relationSelectOf(
  columns: Columns<DataStoreAccess>,
): TableSelect<DataStoreAccess> {
  return getRelationSelectFromColumns<DataStoreAccess>({
    columns: columns,
    model: new DataStoreAccess(),
  });
}

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("who can reach a store, for each reader of accesses", () => {
  test.each(
    READERS.map((reader: Reader): [string, Reader] => {
      return [reader.name, reader];
    }),
  )("%s", async (_who: string, reader: Reader) => {
    const columns: Columns<DataStoreAccess> = await columnsFor(
      reader.permissions,
    );
    const titles: Array<string> = columns.map((column: unknown): string => {
      return String((column as JSONObject)["title"] || "");
    });

    expect(titles).toContain("Data Store");
    expect(titles.includes("Store Sensitivity")).toBe(reader.readsStore);

    const store: JSONObject = (relationSelectOf(columns) as JSONObject)[
      "dataStore"
    ] as JSONObject;

    expect(Object.keys(store).sort()).toEqual(
      reader.readsStore
        ? ["kind", "name", "sensitivity"]
        : ["kind", "name"].sort(),
    );

    // The read the columns make is the server's to answer for this reader.
    expect(() => {
      QueryPermission.checkRelationQueryPermission(
        DataStoreAccess,
        {},
        { _id: true, ...relationSelectOf(columns) } as Select<DataStoreAccess>,
        propsOf(reader.permissions),
      );
    }).not.toThrow();
  });

  test("the read the table sent until now is refused whole for a custom role that reads accesses and not stores", async () => {
    const everyColumn: Columns<DataStoreAccess> = await columnsFor([
      Permission.ProjectOwner,
    ]);

    expect(() => {
      QueryPermission.checkRelationQueryPermission(
        DataStoreAccess,
        {},
        {
          _id: true,
          ...relationSelectOf(everyColumn),
        } as Select<DataStoreAccess>,
        propsOf([Permission.ReadDataStoreAccess]),
      );
    }).toThrow(
      "You do not have permissions to read sensitivity of Data Store through dataStore on Data Store Access. You need one of these permissions: Project Owner, Project Admin, Security Admin, Security Member, Security Viewer, Read Data Store.",
    );
  });
});
