import ProjectService from "../../../Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * A GitHub App installation ID is a small, guessable integer, and the single
 * GitHub App JWT this instance holds will mint a `ghs_` token for ANY of them
 * (GitHubUtil.getInstallationAccessToken does not — and cannot — know which
 * tenant asked). So the installation ID alone is not a capability: on its own
 * it is just an attacker-supplied number.
 *
 * Project.gitHubAppInstallationId is the ONE authoritative record of which
 * project an installation belongs to. It is written only by the GitHub App
 * install callback, and only after GitHub itself has confirmed — via the
 * OAuth user-to-server round trip — that the person completing the install
 * controls that installation. Both `create` and `update` on that column are
 * closed to API callers, so nothing outside that callback can assert a
 * binding.
 *
 * Every path that turns an installation ID into GitHub access must therefore
 * re-derive the binding from here rather than trusting the ID it was handed.
 * Checking that a CodeRepository row is in the caller's project is NOT enough
 * on its own: the attacker owns their own project, so they control both sides
 * of that comparison.
 */
export default class GitHubInstallationBinding {
  /*
   * The installation this project owns, or null if it has none. Callers
   * filtering a whole project's repositories should read it once and compare
   * in memory rather than asking per row — every row in such a list shares
   * the same project, so the answer cannot differ between them.
   */
  @CaptureSpan()
  public static async getBoundInstallationId(
    projectId: ObjectID,
  ): Promise<string | null> {
    const project: Project | null = await ProjectService.findOneBy({
      query: {
        _id: projectId.toString(),
      },
      select: {
        _id: true,
        gitHubAppInstallationId: true,
      },
      props: {
        isRoot: true,
      },
    });

    return project?.gitHubAppInstallationId || null;
  }

  // True only if `installationId` is the installation bound to `projectId`.
  @CaptureSpan()
  public static async isInstallationBoundToProject(data: {
    projectId: ObjectID;
    installationId: string;
  }): Promise<boolean> {
    if (!data.installationId) {
      return false;
    }

    const project: Project | null = await ProjectService.findOneBy({
      query: {
        _id: data.projectId.toString(),
        gitHubAppInstallationId: data.installationId.toString(),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(project);
  }

  /*
   * Convenience for the many callers that hold a CodeRepository row and are
   * about to use its installation ID against GitHub. Returns false for a row
   * that carries no project or no installation, so a half-populated row can
   * never be mistaken for a permitted one.
   *
   * Row-level checks like this stay necessary even with the write boundary
   * closed, because a database that was exploited before the fix can still
   * hold rows whose installation ID never belonged to their project.
   */
  @CaptureSpan()
  public static async isRepositoryInstallationBound(repository: {
    projectId?: ObjectID | undefined;
    gitHubAppInstallationId?: string | undefined;
  }): Promise<boolean> {
    if (!repository.projectId || !repository.gitHubAppInstallationId) {
      return false;
    }

    return GitHubInstallationBinding.isInstallationBoundToProject({
      projectId: repository.projectId,
      installationId: repository.gitHubAppInstallationId,
    });
  }

  /*
   * Fail-closed variant for the places where continuing without a binding
   * would hand out cross-tenant access.
   */
  @CaptureSpan()
  public static async assertInstallationBoundToProject(data: {
    projectId: ObjectID;
    installationId: string;
  }): Promise<void> {
    const isBound: boolean =
      await GitHubInstallationBinding.isInstallationBoundToProject(data);

    if (!isBound) {
      /*
       * Deliberately vague: a probing caller must not be able to tell
       * "this installation belongs to someone else" from "no such
       * installation", or the error itself becomes the enumeration oracle
       * this check exists to close.
       */
      throw new BadDataException(
        "This GitHub App installation is not connected to this project. Please connect the repository from Project Settings using the GitHub App.",
      );
    }
  }
}
