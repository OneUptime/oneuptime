import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DomainService from "../../../Server/Services/DomainService";
import FormDomainService from "../../../Server/Services/FormDomainService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import logger from "../../../Server/Utils/Logger";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A NEW CUSTOM DOMAIN STARTS WITH NO CERTIFICATE ORDERED OR SERVED (#8907).
 *
 * Whether OneUptime has ordered a custom domain's free certificate
 * (isSslOrdered), and whether the domain serves it yet (isSslProvisioned),
 * are OneUptime's record of the certificate, kept by the sweeps and Check
 * now. A form's domain never took them from a request. A status page's and
 * a dashboard's took them from whoever added the domain, so one could be
 * added "provisioned" - for a status page, subscribers' links went to its
 * https address before its CNAME record was even checked - or "ordered",
 * which kept it out of the sweep that orders first certificates. Now, for
 * all three kinds, through the whole create with the tables in memory:
 *
 *   - nobody may create either column, or change it;
 *   - what the dashboard's Add Custom Domain sends goes through for every
 *     role that may add a domain, and the domain is saved with neither;
 *   - a member's own "ordered" or "provisioned" - a script's, a record read
 *     and sent back whole - is dropped, and the domain is saved with
 *     neither;
 *   - someone who may add domains but not read them is refused for sending
 *     either, by its name, and nothing is saved;
 *   - OneUptime's own creates and a server admin's start with neither too,
 *     and with no certificate reissue asked for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "89070000-0000-4000-8000-000000000001",
);

interface DomainKind {
  name: string;
  modelType: { new (): BaseModel };
  service: DatabaseService<BaseModel>;
  // The column the domain names its status page, dashboard or form by.
  parentColumn: string;
  // Who may add a domain of this kind and read it.
  addersWhoRead: Array<[string, Array<Permission>]>;
  // The permission that adds a domain of this kind and nothing else.
  addOnly: Permission;
  // Who may add one and read its parent, but not the domain.
  addersWhoDoNotRead: Array<[string, Array<Permission>]>;
}

const KINDS: Array<DomainKind> = [
  {
    name: "a status page's",
    modelType: StatusPageDomain,
    service: StatusPageDomainService as unknown as DatabaseService<BaseModel>,
    parentColumn: "statusPageId",
    addersWhoRead: [
      ["a Project Owner", [Permission.ProjectOwner]],
      ["a Project Admin", [Permission.ProjectAdmin]],
      ["a project member", [Permission.ProjectMember]],
      ["a Status Page Admin", [Permission.StatusPageAdmin]],
      ["a Status Page Member", [Permission.StatusPageMember]],
    ],
    addOnly: Permission.CreateStatusPageDomain,
    addersWhoDoNotRead: [
      [
        "someone who may add status page domains and read status pages",
        [Permission.CreateStatusPageDomain, Permission.ReadProjectStatusPage],
      ],
    ],
  },
  {
    name: "a dashboard's",
    modelType: DashboardDomain,
    service: DashboardDomainService as unknown as DatabaseService<BaseModel>,
    parentColumn: "dashboardId",
    addersWhoRead: [
      ["a Project Owner", [Permission.ProjectOwner]],
      ["a Project Admin", [Permission.ProjectAdmin]],
      ["a project member", [Permission.ProjectMember]],
      ["a Settings Admin", [Permission.SettingsAdmin]],
      ["a Settings Member", [Permission.SettingsMember]],
    ],
    addOnly: Permission.CreateDashboardDomain,
    addersWhoDoNotRead: [
      [
        "someone who may add dashboard domains and read dashboards",
        [Permission.CreateDashboardDomain, Permission.ReadDashboard],
      ],
    ],
  },
  {
    name: "a form's",
    modelType: FormDomain,
    service: FormDomainService as unknown as DatabaseService<BaseModel>,
    parentColumn: "formId",
    addersWhoRead: [
      ["a Project Owner", [Permission.ProjectOwner]],
      ["a Project Admin", [Permission.ProjectAdmin]],
    ],
    addOnly: Permission.CreateFormDomain,
    addersWhoDoNotRead: [],
  },
];

const SSL_COLUMNS: Array<string> = ["isSslOrdered", "isSslProvisioned"];

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the create to be refused, but it went through.");
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});

  // The project's own domain the custom domain is a name under: verified.
  jest.spyOn(DomainService, "findOneBy").mockResolvedValue({
    domain: "acme.com",
    isVerified: true,
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("adding $name custom domain", (kind: DomainKind) => {
  let domains: InMemoryTable;

  beforeEach(() => {
    // Every kind's table: the name is looked up in all three.
    const tables: Map<unknown, InMemoryTable> = new Map<
      unknown,
      InMemoryTable
    >();

    for (const service of [
      StatusPageDomainService,
      DashboardDomainService,
      FormDomainService,
    ]) {
      tables.set(
        service,
        useInMemoryTable(service as unknown as DatabaseService<BaseModel>, []),
      );
    }

    domains = tables.get(kind.service)!;
  });

  // What the dashboard's Add Custom Domain sends (AddCustomDomainModal).
  function addedOnTheDashboard(extra?: Record<string, unknown>): BaseModel {
    const domain: BaseModel = new kind.modelType();

    Object.assign(domain as unknown as Record<string, unknown>, {
      subdomain: "status",
      domainId: ObjectID.generate(),
      projectId: PROJECT_ID,
      [kind.parentColumn]: ObjectID.generate(),
      isCustomCertificate: false,
      ...extra,
    });

    return domain;
  }

  // Everything that says a certificate is on its way, or there already.
  const CERTIFICATE_STATE: Record<string, unknown> = {
    isSslOrdered: true,
    isSslProvisioned: true,
    certificateReissueRequestedAt: new Date("2026-11-01T09:00:00.000Z"),
  };

  function saved(): StoredRow {
    expect(domains.inserts).toHaveLength(1);
    return domains.inserts[0]!;
  }

  /*
   * Saved as not ordered and not served - false, or left out for the
   * column's default, which is false - with no reissue asked for.
   */
  function expectNoCertificate(row: StoredRow): void {
    for (const column of SSL_COLUMNS) {
      expect([
        column,
        row[column] === undefined || row[column] === false,
      ]).toEqual([column, true]);
    }

    expect(row["certificateReissueRequestedAt"]).toBeUndefined();
  }

  test("nobody may create or change whether its certificate is ordered or served, and everyone who reads the domain may read it", () => {
    const model: BaseModel = new kind.modelType();

    for (const column of SSL_COLUMNS) {
      const lists: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect([column, lists?.create, lists?.update]).toEqual([column, [], []]);
      expect([...(lists?.read || [])].sort()).toEqual(
        [...model.getReadPermissions()].sort(),
      );
      expect(model.getTableColumnMetadata(column).computed).toBe(true);
      // What a create that leaves it out starts with.
      expect(model.getTableColumnMetadata(column).defaultValue).toBe(false);
    }
  });

  test.each(kind.addersWhoRead)(
    "what Add Custom Domain sends goes through for %s, saved with no certificate ordered or served",
    async (_who: string, permissions: Array<Permission>) => {
      await kind.service.create({
        data: addedOnTheDashboard(),
        props: member(permissions),
      });

      const row: StoredRow = saved();
      expectNoCertificate(row);
      expect(row["fullDomain"]).toBe("status.acme.com");
    },
  );

  test.each(kind.addersWhoRead)(
    "%s's own 'ordered' and 'provisioned' are dropped: the domain is saved with neither",
    async (_who: string, permissions: Array<Permission>) => {
      await kind.service.create({
        data: addedOnTheDashboard(CERTIFICATE_STATE),
        props: member(permissions),
      });

      expectNoCertificate(saved());
    },
  );

  test.each(SSL_COLUMNS)(
    "someone who may add domains but not read them is refused for sending %s, by its name, and nothing is saved",
    async (column: string) => {
      const error: unknown = await refusalOf(
        kind.service.create({
          data: addedOnTheDashboard({ [column]: true }),
          props: member([kind.addOnly]),
        }),
      );

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as ColumnWriteRefusedException).columnName).toBe(column);
      expect(domains.inserts).toEqual([]);
    },
  );

  if (kind.addersWhoDoNotRead.length > 0) {
    test.each(kind.addersWhoDoNotRead)(
      "%s - but not its domains - adds one with what Add Custom Domain sends",
      async (_who: string, permissions: Array<Permission>) => {
        await kind.service.create({
          data: addedOnTheDashboard(),
          props: member(permissions),
        });

        expectNoCertificate(saved());
      },
    );
  }

  test.each([
    ["OneUptime itself", { isRoot: true }],
    [
      "a server admin",
      { isMasterAdmin: true, userId: ObjectID.generate(), ...ON_HIGHEST_PLAN },
    ],
  ])(
    "created by %s, it starts with no certificate ordered, served or reissued, whatever the create said",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      await kind.service.create({
        data: addedOnTheDashboard(CERTIFICATE_STATE),
        props: props,
      });

      expectNoCertificate(saved());
    },
  );
});
