import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GHSA-xx95-gmcf-7q86, defence in depth.
 *
 * Closing the column ACL stops requests that go through permission checks,
 * but every writer of this column writes with `props: { isRoot: true }`, which
 * skips those checks entirely. These hooks run regardless of isRoot, so a
 * route that writes a repository row carrying an installation ID its project
 * does not own is refused at the service boundary — before the row exists to
 * be traded for a token.
 */

type ServiceInternals = {
  onBeforeCreate: (createBy: CreateBy<CodeRepository>) => Promise<unknown>;
  onBeforeUpdate: (updateBy: UpdateBy<CodeRepository>) => Promise<unknown>;
};

const service: ServiceInternals =
  CodeRepositoryService as unknown as ServiceInternals;

describe("CodeRepositoryService installation-to-project binding", () => {
  let ownProjectId: ObjectID;
  let victimInstallationId: string;
  let ownInstallationId: string;
  let bindingSpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    ownProjectId = ObjectID.generate();
    ownInstallationId = "11111111";
    victimInstallationId = "99999999";

    /*
     * Model the real helper: bound only for (ownProjectId, ownInstallationId).
     */
    bindingSpy = jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          installationId: string;
        }): Promise<boolean> => {
          return (
            data.projectId.toString() === ownProjectId.toString() &&
            data.installationId === ownInstallationId
          );
        },
      );

    findBySpy = jest.spyOn(CodeRepositoryService, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function buildCreateBy(data: {
    projectId?: ObjectID | undefined;
    installationId?: string | undefined;
    tenantId?: ObjectID | undefined;
  }): CreateBy<CodeRepository> {
    const repository: CodeRepository = new CodeRepository();
    repository.name = "my-service";
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    repository.organizationName = "my-org";
    repository.repositoryName = "my-service";

    if (data.projectId) {
      repository.projectId = data.projectId;
    }

    if (data.installationId !== undefined) {
      repository.gitHubAppInstallationId = data.installationId;
    }

    return {
      data: repository,
      props: {
        isRoot: true,
        tenantId: data.tenantId,
      },
    };
  }

  describe("onBeforeCreate", () => {
    /*
     * The exploit's step 2: a row in the attacker's OWN project naming the
     * victim's installation. Every later authorization check compares the
     * row's projectId to the caller's tenant and passes, so this is the last
     * place the lie can be caught.
     */
    test("rejects a row in your own project that names another tenant's installation", async () => {
      await expect(
        service.onBeforeCreate(
          buildCreateBy({
            projectId: ownProjectId,
            installationId: victimInstallationId,
          }),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("rejects even when the write is made as root", async () => {
      const createBy: CreateBy<CodeRepository> = buildCreateBy({
        projectId: ownProjectId,
        installationId: victimInstallationId,
      });

      expect(createBy.props.isRoot).toBe(true);

      await expect(service.onBeforeCreate(createBy)).rejects.toBeInstanceOf(
        BadDataException,
      );
    });

    test("allows the legitimate import: an installation the project owns", async () => {
      await expect(
        service.onBeforeCreate(
          buildCreateBy({
            projectId: ownProjectId,
            installationId: ownInstallationId,
          }),
        ),
      ).resolves.toBeDefined();
    });

    // Repositories connected by other means (GitLab, manual) are unaffected.
    test("allows a row with no installation id at all and never checks a binding", async () => {
      await expect(
        service.onBeforeCreate(buildCreateBy({ projectId: ownProjectId })),
      ).resolves.toBeDefined();

      expect(bindingSpy).not.toHaveBeenCalled();
    });

    test("checks the binding against the row's own project", async () => {
      await service.onBeforeCreate(
        buildCreateBy({
          projectId: ownProjectId,
          installationId: ownInstallationId,
        }),
      );

      expect(bindingSpy).toHaveBeenCalledTimes(1);

      const args: { projectId: ObjectID; installationId: string } = bindingSpy
        .mock.calls[0]![0] as {
        projectId: ObjectID;
        installationId: string;
      };

      expect(args.projectId.toString()).toBe(ownProjectId.toString());
      expect(args.installationId).toBe(ownInstallationId);
    });

    // Falls back to the tenant when the row does not carry its project inline.
    test("uses props.tenantId when the row has no projectId", async () => {
      await expect(
        service.onBeforeCreate(
          buildCreateBy({
            tenantId: ownProjectId,
            installationId: ownInstallationId,
          }),
        ),
      ).resolves.toBeDefined();

      const args: { projectId: ObjectID } = bindingSpy.mock.calls[0]![0] as {
        projectId: ObjectID;
      };
      expect(args.projectId.toString()).toBe(ownProjectId.toString());
    });

    /*
     * A projectless row would otherwise skip the check entirely and leave an
     * unattributable installation ID in the table.
     */
    test("rejects an installation id with no project to check it against", async () => {
      await expect(
        service.onBeforeCreate(
          buildCreateBy({ installationId: ownInstallationId }),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
    });
  });

  describe("onBeforeUpdate", () => {
    function buildUpdateBy(
      installationId: string | null,
    ): UpdateBy<CodeRepository> {
      return {
        query: { projectId: ownProjectId },
        data: {
          gitHubAppInstallationId: installationId,
        } as unknown as CodeRepository,
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      } as unknown as UpdateBy<CodeRepository>;
    }

    function mockAffectedRows(projectIds: Array<ObjectID | undefined>): void {
      findBySpy.mockResolvedValue(
        projectIds.map((projectId: ObjectID | undefined) => {
          const repository: CodeRepository = new CodeRepository();
          repository.id = ObjectID.generate();
          if (projectId) {
            repository.projectId = projectId;
          }
          return repository;
        }),
      );
    }

    test("rejects repointing an existing row at another tenant's installation", async () => {
      mockAffectedRows([ownProjectId]);

      await expect(
        service.onBeforeUpdate(buildUpdateBy(victimInstallationId)),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("allows setting the installation the row's project owns", async () => {
      mockAffectedRows([ownProjectId]);

      await expect(
        service.onBeforeUpdate(buildUpdateBy(ownInstallationId)),
      ).resolves.toBeDefined();
    });

    /*
     * This is how the `installation.deleted` webhook tears a disconnected
     * installation out of the database — it must never be blocked.
     */
    test("always allows clearing the installation id", async () => {
      await expect(
        service.onBeforeUpdate(buildUpdateBy(null)),
      ).resolves.toBeDefined();

      expect(bindingSpy).not.toHaveBeenCalled();
      expect(findBySpy).not.toHaveBeenCalled();
    });

    /*
     * updateBy matches by query, so a single write can span rows in several
     * projects. One unbound row is enough to leak a token, so the whole write
     * must fail — not just the offending row.
     */
    test("rejects a multi-row update when any affected row's project is unbound", async () => {
      mockAffectedRows([ownProjectId, ObjectID.generate()]);

      await expect(
        service.onBeforeUpdate(buildUpdateBy(ownInstallationId)),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("checks every affected row, not just the first", async () => {
      const secondProjectId: ObjectID = ObjectID.generate();
      mockAffectedRows([ownProjectId, secondProjectId]);

      try {
        await service.onBeforeUpdate(buildUpdateBy(ownInstallationId));
      } catch {
        // expected — the second row is unbound
      }

      const checkedProjectIds: Array<string> = bindingSpy.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { projectId: ObjectID }).projectId.toString();
        },
      );

      expect(checkedProjectIds).toContain(ownProjectId.toString());
      expect(checkedProjectIds).toContain(secondProjectId.toString());
    });

    test("rejects when an affected row has no project", async () => {
      mockAffectedRows([undefined]);

      await expect(
        service.onBeforeUpdate(buildUpdateBy(ownInstallationId)),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("reads the affected rows as root so the check cannot be blinded by permissions", async () => {
      mockAffectedRows([ownProjectId]);

      await service.onBeforeUpdate(buildUpdateBy(ownInstallationId));

      const findArgs: { props: { isRoot?: boolean } } = findBySpy.mock
        .calls[0]![0] as {
        props: { isRoot?: boolean };
      };
      expect(findArgs.props.isRoot).toBe(true);
    });
  });
});
