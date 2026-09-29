import GitHubInstallationBinding from "../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import ProjectService from "../../../../Server/Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { getColumnAccessControl } from "../../../../Types/Database/AccessControl/ColumnAccessControl";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GHSA-xx95-gmcf-7q86. A GitHub App installation ID is a small integer, and
 * the single GitHub App JWT this instance holds mints a write-scoped `ghs_`
 * token for whichever installation it is handed. So "which project owns this
 * installation?" has to be answered from a record only the verified install
 * callback can write — never from the request, and never from a row the
 * caller was able to create in a project they happen to own.
 */

describe("GitHubInstallationBinding", () => {
  let projectId: ObjectID;
  let findOneBySpy: jest.SpyInstance;

  beforeEach(() => {
    projectId = ObjectID.generate();
    findOneBySpy = jest.spyOn(ProjectService, "findOneBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockBoundProject(project: Project | null): void {
    findOneBySpy.mockResolvedValue(project);
  }

  function boundProject(): Project {
    const project: Project = new Project();
    project.id = projectId;
    return project;
  }

  describe("isInstallationBoundToProject", () => {
    test("returns true when the project owns the installation", async () => {
      mockBoundProject(boundProject());

      await expect(
        GitHubInstallationBinding.isInstallationBoundToProject({
          projectId: projectId,
          installationId: "12345678",
        }),
      ).resolves.toBe(true);
    });

    test("returns false when no project row matches project + installation", async () => {
      mockBoundProject(null);

      await expect(
        GitHubInstallationBinding.isInstallationBoundToProject({
          projectId: projectId,
          installationId: "99999999",
        }),
      ).resolves.toBe(false);
    });

    /*
     * The whole point: the query must be AND-ed on both the project and the
     * installation. Matching on the project alone would return true for any
     * installation ID the caller invented.
     */
    test("queries on BOTH the project id and the installation id", async () => {
      mockBoundProject(boundProject());

      await GitHubInstallationBinding.isInstallationBoundToProject({
        projectId: projectId,
        installationId: "12345678",
      });

      expect(findOneBySpy).toHaveBeenCalledTimes(1);

      const findArgs: {
        query: { _id?: string; gitHubAppInstallationId?: string };
        props: { isRoot?: boolean };
      } = findOneBySpy.mock.calls[0]![0] as {
        query: { _id?: string; gitHubAppInstallationId?: string };
        props: { isRoot?: boolean };
      };

      expect(findArgs.query._id).toBe(projectId.toString());
      expect(findArgs.query.gitHubAppInstallationId).toBe("12345678");
      expect(findArgs.props.isRoot).toBe(true);
    });

    /*
     * An empty installation ID must never be treated as "bound" — otherwise a
     * project with no GitHub connection at all would match every repository
     * row whose installation ID had been cleared.
     */
    test("returns false for an empty installation id without querying", async () => {
      await expect(
        GitHubInstallationBinding.isInstallationBoundToProject({
          projectId: projectId,
          installationId: "",
        }),
      ).resolves.toBe(false);

      expect(findOneBySpy).not.toHaveBeenCalled();
    });

    test("does not treat a different project's installation as bound", async () => {
      // The service query is what enforces this; simulate the DB finding nothing.
      mockBoundProject(null);

      await expect(
        GitHubInstallationBinding.isInstallationBoundToProject({
          projectId: ObjectID.generate(),
          installationId: "12345678",
        }),
      ).resolves.toBe(false);
    });
  });

  /*
   * The bulk-filter path. Callers listing a whole project's repositories read
   * the binding once and compare in memory — every row in such a list is in
   * the same project, so a per-row query would ask the same question N times.
   */
  describe("getBoundInstallationId", () => {
    test("returns the installation the project owns", async () => {
      const project: Project = boundProject();
      project.gitHubAppInstallationId = "12345678";
      mockBoundProject(project);

      await expect(
        GitHubInstallationBinding.getBoundInstallationId(projectId),
      ).resolves.toBe("12345678");
    });

    /*
     * Null, never "" or undefined: callers compare a row's installation ID
     * against this, and an empty string would match a row whose ID had been
     * cleared.
     */
    test("returns null for a project with no GitHub connection", async () => {
      mockBoundProject(boundProject());

      await expect(
        GitHubInstallationBinding.getBoundInstallationId(projectId),
      ).resolves.toBeNull();
    });

    test("returns null when the project does not exist", async () => {
      mockBoundProject(null);

      await expect(
        GitHubInstallationBinding.getBoundInstallationId(projectId),
      ).resolves.toBeNull();
    });

    test("reads as root, so a caller's permissions cannot blind the check", async () => {
      mockBoundProject(boundProject());

      await GitHubInstallationBinding.getBoundInstallationId(projectId);

      const findArgs: {
        query: { _id?: string };
        props: { isRoot?: boolean };
      } = findOneBySpy.mock.calls[0]![0] as {
        query: { _id?: string };
        props: { isRoot?: boolean };
      };

      expect(findArgs.query._id).toBe(projectId.toString());
      expect(findArgs.props.isRoot).toBe(true);
    });
  });

  describe("assertInstallationBoundToProject", () => {
    test("resolves quietly when the binding exists", async () => {
      mockBoundProject(boundProject());

      await expect(
        GitHubInstallationBinding.assertInstallationBoundToProject({
          projectId: projectId,
          installationId: "12345678",
        }),
      ).resolves.toBeUndefined();
    });

    test("throws BadDataException when the binding is missing", async () => {
      mockBoundProject(null);

      await expect(
        GitHubInstallationBinding.assertInstallationBoundToProject({
          projectId: projectId,
          installationId: "99999999",
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    /*
     * The error must not confirm that the installation exists elsewhere, or
     * the failure message becomes the enumeration oracle the fix removed.
     */
    test("does not leak the installation id or another tenant's existence", async () => {
      mockBoundProject(null);

      let thrown: Error | null = null;

      try {
        await GitHubInstallationBinding.assertInstallationBoundToProject({
          projectId: projectId,
          installationId: "99999999",
        });
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown!.message).not.toContain("99999999");
      expect(thrown!.message.toLowerCase()).not.toContain("another");
    });
  });
});

/*
 * The binding is only trustworthy if nothing outside the verified install
 * callback can write it. These assertions pin the column ACLs that make that
 * true — a future permission tidy-up that re-opens either column silently
 * reopens the vulnerability, so it should fail here first.
 */
describe("Installation-id columns are not client-writable", () => {
  test("CodeRepository.gitHubAppInstallationId cannot be created or updated by any API caller", () => {
    const accessControl: ColumnAccessControl = getColumnAccessControl(
      new CodeRepository(),
      "gitHubAppInstallationId",
    );

    expect(accessControl.create).toEqual([]);
    expect(accessControl.update).toEqual([]);
  });

  test("Project.gitHubAppInstallationId cannot be created or updated by any API caller", () => {
    const accessControl: ColumnAccessControl = getColumnAccessControl(
      new Project(),
      "gitHubAppInstallationId",
    );

    expect(accessControl.create).toEqual([]);
    expect(accessControl.update).toEqual([]);
  });

  /*
   * Specifically the permissions an attacker gets for free by creating their
   * own project. Being able to write either column from one of these is the
   * whole exploit.
   */
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateCodeRepository,
    Permission.EditCodeRepository,
    Permission.EditProject,
  ])(
    "%s cannot write either installation-id column",
    (permission: Permission) => {
      const repositoryAccessControl: ColumnAccessControl =
        getColumnAccessControl(new CodeRepository(), "gitHubAppInstallationId");
      const projectAccessControl: ColumnAccessControl = getColumnAccessControl(
        new Project(),
        "gitHubAppInstallationId",
      );

      expect(repositoryAccessControl.create).not.toContain(permission);
      expect(repositoryAccessControl.update).not.toContain(permission);
      expect(projectAccessControl.create).not.toContain(permission);
      expect(projectAccessControl.update).not.toContain(permission);
    },
  );

  // Reading it stays available — the dashboard shows connection status from it.
  test("the column remains readable so the dashboard can show connection status", () => {
    const accessControl: ColumnAccessControl = getColumnAccessControl(
      new CodeRepository(),
      "gitHubAppInstallationId",
    );

    expect(accessControl.read.length).toBeGreaterThan(0);
  });
});
