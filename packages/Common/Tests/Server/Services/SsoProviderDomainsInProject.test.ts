import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROVIDER SERVES ONLY ITS OWN PROJECT'S DOMAINS (#9824).
 *
 * "Sign in with SSO" offers a project's SAML or OIDC provider to an address
 * on one of the verified domains the provider lists (ProjectSSO.domains,
 * ProjectOIDC.domains). A provider that could list another project's
 * domain would be offered to that organization's people under its name. So
 * every domain a save names must be a Domain of the provider's own project:
 * the project check every service whose records name others makes
 * (ProjectReferencesService, ProjectReferenceCheck), which ProjectSsoService
 * and ProjectOidcService now make too. It answers another project's domain
 * word for word as one that does not exist, naming the field and the id the
 * caller sent, and reads nothing else first.
 *
 * The teams stay SsoProviderTeamGrant's (SsoProviderTeamGrant.test.ts): the
 * project check leaves them alone, so a team is never looked up twice.
 *
 * These run the services' real create and update hooks. The database is a
 * stub of the project's records (stubProjectDirectory): DOMAIN_A and
 * DOMAIN_B are the project's, FOREIGN_DOMAIN another project's.
 */

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here hashes passwords.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Domain from "../../../Models/DatabaseModels/Domain";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ProjectReferenceCheck, {
  ProjectReferenceColumn,
} from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import SsoProviderTeamGrant from "../../../Server/Utils/SsoProviderTeamGrant";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

const PROJECT_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000002",
);
const PROVIDER_ID: string = "d0000000-0000-4000-8000-0000000000aa";

const DOMAIN_A: string = "d0000000-0000-4000-8000-0000000000a1";
const DOMAIN_B: string = "d0000000-0000-4000-8000-0000000000a2";
// The same name as DOMAIN_A, verified by another project.
const FOREIGN_DOMAIN: string = "d0000000-0000-4000-8000-0000000000f1";
// An id no domain has, in any project.
const MISSING_DOMAIN: string = "d0000000-0000-4000-8000-0000000000e1";

// A Project Admin of the project, through the API.
const ADMIN: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("d0000000-0000-4000-8000-000000000003"),
};

// A workflow's step writes as root, with its project's tenant.
const WORKFLOW: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

// OneUptime's own write: root, with no project on the request.
const SERVER: DatabaseCommonInteractionProps = {
  isRoot: true,
};

// A master admin, in the provider's project.
const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  isMasterAdmin: true,
  tenantId: PROJECT_ID,
  userId: new ObjectID("d0000000-0000-4000-8000-000000000004"),
};

interface ProviderCase {
  label: string;
  service: DatabaseService<BaseModel>;
  make: () => BaseModel;
}

const PROVIDERS: Array<ProviderCase> = [
  {
    label: "a SAML provider",
    service: ProjectSsoService as unknown as DatabaseService<BaseModel>,
    make: (): BaseModel => {
      const provider: ProjectSSO = new ProjectSSO();
      provider.projectId = PROJECT_ID;
      provider.name = "Okta";
      provider.issuerURL = "http://www.okta.com/exk1";
      provider.publicCertificate = "certificate";
      return provider;
    },
  },
  {
    label: "an OIDC provider",
    service: ProjectOidcService as unknown as DatabaseService<BaseModel>,
    make: (): BaseModel => {
      const provider: ProjectOIDC = new ProjectOIDC();
      provider.projectId = PROJECT_ID;
      provider.name = "Okta";
      provider.issuerURL = "https://dev-123456.okta.com/oauth2/default";
      provider.clientId = "client-id";
      provider.clientSecret = "client-secret";
      return provider;
    },
  },
];

type HookFunction = (input: unknown) => Promise<unknown>;

function callHook(
  service: DatabaseService<BaseModel>,
  hook: "onBeforeCreate" | "onBeforeUpdate",
  input: unknown,
): Promise<unknown> {
  return (service as unknown as Record<string, HookFunction>)[hook]!.call(
    service,
    input,
  );
}

function domainsOf(ids: Array<string>): Array<Domain> {
  return ids.map((id: string): Domain => {
    const domain: Domain = new Domain();
    domain._id = id;
    return domain;
  });
}

function withDomains(provider: BaseModel, ids: Array<string>): BaseModel {
  (provider as unknown as Record<string, unknown>)["domains"] = domainsOf(ids);
  return provider;
}

async function refusalOf(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  return null;
}

let directory: ProjectDirectoryStub;

beforeEach(() => {
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: { Domain: [DOMAIN_A, DOMAIN_B] },
    elsewhere: [FOREIGN_DOMAIN],
  });

  // The caller may create and edit providers: these tests are about domains.
  jest
    .spyOn(ModelPermission, "checkCreatePermissions")
    .mockImplementation((): void => {
      // allowed
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(PROVIDERS)("$label", (providerCase: ProviderCase) => {
  test("checks its domains with the project check, and its teams with SsoProviderTeamGrant", () => {
    const service: DatabaseService<BaseModel> = providerCase.service;

    expect(service).toBeInstanceOf(ProjectReferencesService);

    const checked: Array<string> = ProjectReferenceCheck.getCheckedColumns(
      service.getModel(),
      [],
      ["teams"],
    ).map((column: ProjectReferenceColumn): string => {
      return column.column;
    });

    expect(checked).toEqual(["domains"]);
    expect(
      (
        service as unknown as {
          getListsCheckedByService: () => Array<string>;
        }
      ).getListsCheckedByService(),
    ).toEqual(["teams"]);
  });

  describe.each([
    ["a Project Admin", ADMIN],
    ["a workflow's step", WORKFLOW],
    ["OneUptime itself", SERVER],
    ["a master admin", MASTER_ADMIN],
  ])("created by %s", (_who: string, props: DatabaseCommonInteractionProps) => {
    test("with its project's domains: accepted", async () => {
      await expect(
        callHook(providerCase.service, "onBeforeCreate", {
          data: withDomains(providerCase.make(), [DOMAIN_A, DOMAIN_B]),
          props: props,
        }),
      ).resolves.toBeDefined();

      // Looked up in the provider's own project, and nowhere else.
      expect(directory.recordLookups).toEqual([
        {
          model: "Domain",
          projectId: PROJECT_ID.toString(),
          ids: [DOMAIN_A, DOMAIN_B],
        },
      ]);
    });

    test("with another project's domain: refused, naming the field and the id", async () => {
      const error: Error | null = await refusalOf(
        callHook(providerCase.service, "onBeforeCreate", {
          data: withDomains(providerCase.make(), [DOMAIN_A, FOREIGN_DOMAIN]),
          props: props,
        }),
      );

      expect(error).toBeInstanceOf(ProjectScopedReferenceException);
      expect(error?.message).toContain(
        "references records that are not in this project",
      );
      expect(error?.message).toContain(`Domains "${FOREIGN_DOMAIN}"`);
      // The project's own domain is not named.
      expect(error?.message).not.toContain(DOMAIN_A);
      // Nothing of another project was read.
      expect(
        directory.recordLookups.every(
          (lookup: { projectId: string }): boolean => {
            return lookup.projectId === PROJECT_ID.toString();
          },
        ),
      ).toBe(true);
    });

    test("with a domain that does not exist: refused in the same words", async () => {
      const foreign: Error | null = await refusalOf(
        callHook(providerCase.service, "onBeforeCreate", {
          data: withDomains(providerCase.make(), [FOREIGN_DOMAIN]),
          props: props,
        }),
      );
      const missing: Error | null = await refusalOf(
        callHook(providerCase.service, "onBeforeCreate", {
          data: withDomains(providerCase.make(), [MISSING_DOMAIN]),
          props: props,
        }),
      );

      expect(foreign).toBeInstanceOf(ProjectScopedReferenceException);
      expect(missing).toBeInstanceOf(ProjectScopedReferenceException);
      expect(missing?.message.split(MISSING_DOMAIN).join(FOREIGN_DOMAIN)).toBe(
        foreign?.message,
      );
    });
  });

  test("a create with no domains reads none", async () => {
    await expect(
      callHook(providerCase.service, "onBeforeCreate", {
        data: providerCase.make(),
        props: ADMIN,
      }),
    ).resolves.toBeDefined();

    expect(directory.recordLookups).toEqual([]);
  });

  test("the domain check comes before the teams are weighed", async () => {
    const teamCheck: jest.SpiedFunction<
      typeof SsoProviderTeamGrant.assertCanCreate
    > = jest.spyOn(SsoProviderTeamGrant, "assertCanCreate");

    await refusalOf(
      callHook(providerCase.service, "onBeforeCreate", {
        data: withDomains(providerCase.make(), [FOREIGN_DOMAIN]),
        props: ADMIN,
      }),
    );

    expect(teamCheck).not.toHaveBeenCalled();
  });

  /*
   * The teams are SsoProviderTeamGrant's to check: the project check never
   * looks a team up as well.
   */
  test("the project check never looks a team up", async () => {
    jest
      .spyOn(SsoProviderTeamGrant, "assertCanCreate")
      .mockResolvedValue(undefined);

    const provider: BaseModel = withDomains(providerCase.make(), [DOMAIN_A]);
    (provider as unknown as Record<string, unknown>)["teams"] = [
      { _id: "d0000000-0000-4000-8000-0000000000c1" },
    ];

    await expect(
      callHook(providerCase.service, "onBeforeCreate", {
        data: provider,
        props: ADMIN,
      }),
    ).resolves.toBeDefined();

    expect(
      directory.recordLookups.map((lookup: { model: string }): string => {
        return lookup.model;
      }),
    ).toEqual(["Domain"]);
  });

  describe("an update", () => {
    const updateBy: (data: Record<string, unknown>) => unknown = (
      data: Record<string, unknown>,
    ): unknown => {
      return {
        query: { _id: PROVIDER_ID },
        data: data,
        props: ADMIN,
        limit: 1,
        skip: 0,
      };
    };

    // The provider as it is saved: with DOMAIN_A, and a domain from before.
    const storeProvider: (domains: Array<string>) => void = (
      domains: Array<string>,
    ): void => {
      const provider: BaseModel = withDomains(providerCase.make(), domains);
      provider._id = PROVIDER_ID;

      jest
        .spyOn(providerCase.service, "findBy")
        .mockResolvedValue([provider] as never);
      stubRowsCallerMayWriteLikeFindBy(
        providerCase.service,
        jest.spyOn(providerCase.service, "findBy"),
      );
    };

    // The base class's hook: the provider service's own reads the database.
    const baseUpdate: (data: Record<string, unknown>) => Promise<unknown> = (
      data: Record<string, unknown>,
    ): Promise<unknown> => {
      const hook: HookFunction = (
        ProjectReferencesService.prototype as unknown as Record<
          string,
          HookFunction
        >
      )["onBeforeUpdate"]!;

      return hook.call(providerCase.service, updateBy(data));
    };

    test("that adds another project's domain is refused by the provider's own hook", async () => {
      storeProvider([]);

      const error: Error | null = await refusalOf(
        callHook(
          providerCase.service,
          "onBeforeUpdate",
          updateBy({ domains: domainsOf([DOMAIN_A, FOREIGN_DOMAIN]) }),
        ),
      );

      expect(error).toBeInstanceOf(ProjectScopedReferenceException);
      expect(error?.message).toContain(`Domains "${FOREIGN_DOMAIN}"`);
    });

    test("that adds its project's domains is accepted", async () => {
      storeProvider([]);

      await expect(
        baseUpdate({ domains: domainsOf([DOMAIN_A, DOMAIN_B]) }),
      ).resolves.toBeDefined();
    });

    /*
     * The Dashboard sends the whole list back on every save, so a domain the
     * provider already holds is not asked about again.
     */
    test("that saves back what the provider already holds is accepted", async () => {
      storeProvider([DOMAIN_A, FOREIGN_DOMAIN]);

      await expect(
        baseUpdate({ domains: domainsOf([DOMAIN_A, FOREIGN_DOMAIN]) }),
      ).resolves.toBeDefined();

      // What it holds exempts nothing else.
      await expect(
        baseUpdate({ domains: domainsOf([DOMAIN_A, MISSING_DOMAIN]) }),
      ).rejects.toBeInstanceOf(ProjectScopedReferenceException);
    });

    test("that removes every domain needs no lookup", async () => {
      storeProvider([DOMAIN_A]);

      await expect(baseUpdate({ domains: [] })).resolves.toBeDefined();

      expect(directory.recordLookups).toEqual([]);
    });
  });
});

describe("for a provider of another project", () => {
  test("the project's own domain is another project's", async () => {
    const provider: BaseModel = withDomains(PROVIDERS[0]!.make(), [DOMAIN_A]);
    (provider as unknown as Record<string, unknown>)["projectId"] =
      OTHER_PROJECT_ID;

    const error: Error | null = await refusalOf(
      callHook(PROVIDERS[0]!.service, "onBeforeCreate", {
        data: provider,
        props: SERVER,
      }),
    );

    expect(error).toBeInstanceOf(ProjectScopedReferenceException);
    expect(error?.message).toContain(`Domains "${DOMAIN_A}"`);
  });
});
