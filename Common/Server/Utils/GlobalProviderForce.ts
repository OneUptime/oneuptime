import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import ProjectService from "../Services/ProjectService";

/*
 * Reconciles the "force SSO for login" state that a Global SSO/OIDC provider
 * projects onto its attached projects.
 *
 * When a provider has `requireSsoForLogin` enabled, every project it is
 * attached to must enforce SSO pinned to THAT provider — i.e. the project's
 * `requireSsoForLogin = true` and `requireSsoWithSsoProviderId = providerId`.
 * When force is turned off, the provider is deleted, or a project is detached,
 * the pin this provider previously set must be removed so the project is no
 * longer locked to a provider that no longer applies.
 *
 * To avoid clobbering settings owned by other providers or by the project
 * itself, clearing only ever touches projects whose
 * `requireSsoWithSsoProviderId` currently points at THIS provider.
 *
 * This util only depends on ProjectService (which does not import the Global
 * provider services), so it is safe to call from any of them without creating
 * an import cycle.
 */
type SyncGlobalProviderForceFunction = (data: {
  providerId: ObjectID;
  force: boolean;
  attachedProjectIds: Array<ObjectID>;
}) => Promise<void>;

const syncGlobalProviderForce: SyncGlobalProviderForceFunction = async (data: {
  providerId: ObjectID;
  force: boolean;
  attachedProjectIds: Array<ObjectID>;
}): Promise<void> => {
  const { providerId, force, attachedProjectIds } = data;

  const attachedIdSet: Set<string> = new Set(
    attachedProjectIds.map((id: ObjectID) => {
      return id.toString();
    }),
  );

  // Projects currently pinned to this provider.
  const pinnedProjects: Array<Project> = await ProjectService.findBy({
    query: { requireSsoWithSsoProviderId: providerId },
    select: { _id: true },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: { isRoot: true },
  });

  // Clear the pin on projects that should no longer be forced by this provider
  // (force turned off, provider deleted, or project detached).
  for (const project of pinnedProjects) {
    const projectId: ObjectID | null = project.id;

    if (!projectId) {
      continue;
    }

    const shouldRemainForced: boolean =
      force && attachedIdSet.has(projectId.toString());

    if (!shouldRemainForced) {
      await ProjectService.updateOneById({
        id: projectId,
        data: {
          requireSsoForLogin: false,
          requireSsoWithSsoProviderId: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        props: { isRoot: true },
      });
    }
  }

  // Apply the pin to every currently-attached project.
  if (force) {
    for (const projectId of attachedProjectIds) {
      await ProjectService.updateOneById({
        id: projectId,
        data: {
          requireSsoForLogin: true,
          requireSsoWithSsoProviderId: providerId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        props: { isRoot: true },
      });
    }
  }
};

export default syncGlobalProviderForce;
