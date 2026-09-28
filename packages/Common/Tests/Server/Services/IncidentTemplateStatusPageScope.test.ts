import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import StatusPageReadAccess from "../../../Server/Utils/StatusPage/StatusPageReadAccess";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An incident template can limit the incidents declared from it to status
 * pages (IncidentTemplate.statusPages). IncidentTemplateService owns two
 * things about that list:
 *
 *   - isScopedToStatusPages follows writes to it and nothing else. It is how
 *     a template whose pages were all deleted (the join rows cascade away)
 *     still declares incidents limited - to nothing - instead of incidents
 *     that reach every status page listing their monitors;
 *   - the pages a non-root caller adds must be pages they can read. Incident
 *     members may edit templates, and a template's pages are copied onto
 *     every incident declared from it, so this is the same rule as picking an
 *     incident's pages.
 *
 * The database is stubbed: stored templates by a stub of findBy, and which
 * status pages the caller can read by a stub of the status page service.
 */

const projectId: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e01",
);
const templateId: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

const PAGE_A: string = "b0000000-0000-4000-8000-00000000000a";
const PAGE_B: string = "b0000000-0000-4000-8000-00000000000b";
const HIDDEN_PAGE_X: string = "b0000000-0000-4000-8000-0000000000f1";

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e02"),
  tenantId: projectId,
};

type OnBeforeCreate = (
  createBy: CreateBy<IncidentTemplate>,
) => Promise<OnCreate<IncidentTemplate>>;
type OnBeforeUpdate = (
  updateBy: UpdateBy<IncidentTemplate>,
) => Promise<OnUpdate<IncidentTemplate>>;

function statusPage(id: string): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = id;
  return page;
}

let storedTemplates: Array<IncidentTemplate> = [];
let readable: Array<string> | null = [];
let templateFindBy: MockFunction;
let statusPageFindBy: MockFunction;

function storedTemplate(statusPageIds: Array<string>): IncidentTemplate {
  const template: IncidentTemplate = new IncidentTemplate();
  template._id = templateId;
  template.projectId = projectId;
  template.statusPages = statusPageIds.map(statusPage);
  return template;
}

async function runBeforeCreate(
  data: IncidentTemplate,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): Promise<IncidentTemplate> {
  const onCreate: OnCreate<IncidentTemplate> = await (
    IncidentTemplateService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data, props });

  return onCreate.createBy.data;
}

async function runBeforeUpdate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): Promise<Record<string, unknown>> {
  const onUpdate: OnUpdate<IncidentTemplate> = await (
    IncidentTemplateService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: { _id: templateId },
    data: data as UpdateBy<IncidentTemplate>["data"],
    props: props,
    limit: 1,
    skip: 0,
  });

  return onUpdate.updateBy.data as unknown as Record<string, unknown>;
}

beforeEach(() => {
  storedTemplates = [storedTemplate([])];
  readable = [PAGE_A, PAGE_B];

  templateFindBy = getJestMockFunction();
  templateFindBy.mockImplementation(() => {
    return Promise.resolve(storedTemplates);
  });
  jest
    .spyOn(IncidentTemplateService, "findBy")
    .mockImplementation(templateFindBy as never);

  statusPageFindBy = getJestMockFunction();
  statusPageFindBy.mockImplementation(
    (findBy: { query: { _id: unknown } }): Promise<Array<StatusPage>> => {
      if (readable === null) {
        return Promise.reject(
          new NotAuthorizedException(
            "You do not have permissions to read Status Page.",
          ),
        );
      }

      const operator: { objectLiteralParameters?: Dictionary<unknown> } = findBy
        .query._id as { objectLiteralParameters?: Dictionary<unknown> };

      return Promise.resolve(
        (
          Object.values(operator.objectLiteralParameters || {}) as Array<
            Array<string>
          >
        )
          .flat()
          .map((id: string): string => {
            return id.toLowerCase();
          })
          .filter((id: string): boolean => {
            return readable!.includes(id);
          })
          .map(statusPage),
      );
    },
  );
  jest
    .spyOn(StatusPageService, "findBy")
    .mockImplementation(statusPageFindBy as never);

  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "getHeldRelationIds")
    .mockResolvedValue(new Map() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentTemplateService: isScopedToStatusPages follows the template's status pages", () => {
  test("a template created with pages is scoped", async () => {
    const created: IncidentTemplate = await runBeforeCreate(
      Object.assign(new IncidentTemplate(), {
        statusPages: [statusPage(PAGE_A)],
      }),
    );

    expect(created.isScopedToStatusPages).toBe(true);
  });

  test("a template created without pages is not, whatever the client sent", async () => {
    const created: IncidentTemplate = await runBeforeCreate(
      Object.assign(new IncidentTemplate(), {
        isScopedToStatusPages: true,
      }),
    );

    expect(created.isScopedToStatusPages).toBe(false);

    const empty: IncidentTemplate = await runBeforeCreate(
      Object.assign(new IncidentTemplate(), {
        statusPages: [],
        isScopedToStatusPages: true,
      }),
    );

    expect(empty.isScopedToStatusPages).toBe(false);
  });

  test("writing pages scopes it, and clearing them unscopes it", async () => {
    expect(
      (await runBeforeUpdate({ statusPages: [PAGE_A] }))[
        "isScopedToStatusPages"
      ],
    ).toBe(true);

    storedTemplates = [storedTemplate([PAGE_A])];

    expect(
      (await runBeforeUpdate({ statusPages: [] }))["isScopedToStatusPages"],
    ).toBe(false);
  });

  test("a client's flag is dropped; an update that does not write the list leaves the flag alone", async () => {
    const data: Record<string, unknown> = await runBeforeUpdate({
      name: "Region East outage",
      isScopedToStatusPages: false,
    });

    expect(data).not.toHaveProperty("isScopedToStatusPages");
  });
});

describe("IncidentTemplateService: the status pages a caller adds must be pages they can read", () => {
  test("creating a template with a page the caller cannot read is refused", async () => {
    readable = [PAGE_A];

    await expect(
      runBeforeCreate(
        Object.assign(new IncidentTemplate(), {
          statusPages: [statusPage(PAGE_A), statusPage(PAGE_B)],
        }),
      ),
    ).rejects.toThrow(
      StatusPageReadAccess.getRefusalMessage("incident template"),
    );
  });

  test("a caller without status page access cannot give a template pages", async () => {
    readable = null;

    await expect(
      runBeforeCreate(
        Object.assign(new IncidentTemplate(), {
          statusPages: [statusPage(PAGE_A)],
        }),
        {
          ...MEMBER_PROPS,
          userTenantAccessPermission: {
            [projectId.toString()]: {
              projectId: projectId,
              _type: "UserTenantAccessPermission",
              permissions: [
                {
                  _type: "UserPermission",
                  permission: Permission.IncidentMember,
                  labelIds: [],
                  isBlockPermission: false,
                },
              ],
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("adding a page the caller cannot read to a template is refused", async () => {
    readable = [PAGE_A];

    await expect(
      runBeforeUpdate({ statusPages: [PAGE_A, PAGE_B] }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a page the template already holds is not added, so it is not checked", async () => {
    readable = [PAGE_A];
    storedTemplates = [storedTemplate([PAGE_A, HIDDEN_PAGE_X])];

    const data: Record<string, unknown> = await runBeforeUpdate({
      statusPages: [PAGE_A, HIDDEN_PAGE_X],
    });

    expect(data["isScopedToStatusPages"]).toBe(true);
  });

  test("reads the templates as root, limited to the caller's project", async () => {
    await runBeforeUpdate({ statusPages: [PAGE_A] });

    const findBy: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = templateFindBy.mock.calls[0]![0];

    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.query["projectId"]).toBe(projectId);
    expect(findBy.query["_id"]).toBe(templateId);
  });

  test("a root caller adds any page", async () => {
    readable = null;

    const data: Record<string, unknown> = await runBeforeUpdate(
      { statusPages: [PAGE_B] },
      { isRoot: true },
    );

    expect(data["isScopedToStatusPages"]).toBe(true);
    expect(statusPageFindBy).not.toHaveBeenCalled();
    // Only the project lookup a root update without a tenant always makes.
    for (const call of templateFindBy.mock.calls) {
      expect(
        (call[0] as { select: Record<string, unknown> }).select,
      ).not.toHaveProperty("statusPages");
    }
  });

  test("clearing the list checks nothing", async () => {
    readable = null;
    storedTemplates = [storedTemplate([PAGE_A])];

    await runBeforeUpdate({ statusPages: [] });

    expect(statusPageFindBy).not.toHaveBeenCalled();
  });
});

describe("IncidentTemplate.isScopedToStatusPages column", () => {
  function access(column: string): {
    create: Array<Permission>;
    read: Array<Permission>;
    update: Array<Permission>;
  } {
    const columnAccess: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } = new IncidentTemplate().getColumnAccessControlFor(column) || {};

    return {
      create: (columnAccess.create || []).slice(),
      read: (columnAccess.read || []).slice(),
      update: (columnAccess.update || []).slice(),
    };
  }

  test("has the access control of the template's status pages", () => {
    expect(access("isScopedToStatusPages")).toEqual(access("statusPages"));
  });

  test("is computed, required, false by default and hidden from the API docs", () => {
    const template: IncidentTemplate = new IncidentTemplate();

    expect(template.getTableColumnMetadata("isScopedToStatusPages")).toEqual(
      expect.objectContaining({
        computed: true,
        required: true,
        hideColumnInDocumentation: true,
        defaultValue: false,
      }),
    );
  });
});
