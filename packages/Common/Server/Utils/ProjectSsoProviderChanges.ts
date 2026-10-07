import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOidc from "../../Models/DatabaseModels/GlobalOidc";
import GlobalSso from "../../Models/DatabaseModels/GlobalSso";
import Project from "../../Models/DatabaseModels/Project";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import DatabaseService from "../Services/DatabaseService";
import GlobalOidcProjectService from "../Services/GlobalOidcProjectService";
import GlobalOidcService from "../Services/GlobalOidcService";
import GlobalSsoProjectService from "../Services/GlobalSsoProjectService";
import GlobalSsoService from "../Services/GlobalSsoService";
import ProjectOidcService from "../Services/ProjectOidcService";
import ProjectService from "../Services/ProjectService";
import ProjectSsoService from "../Services/ProjectSsoService";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import ProjectSsoProviderStanding, {
  ProjectSsoProviderType,
} from "./ProjectSsoProviderStanding";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "./Realtime/RealtimeAccessChanges";

/*
 * TURNING A PROJECT'S SSO PROVIDER OFF, OR DELETING IT, ENDS THE SIGN-INS IT
 * GAVE.
 *
 * What the project's SAML and OIDC provider services do when a write turns a
 * provider off or on, or deletes it (ProjectSsoService, ProjectOidcService):
 *
 *   - turning one off writes when (signInsEndedAt), in the same write: the
 *     sign-ins it gave before then stop counting, and turning it on again
 *     does not bring them back (ProjectSsoProviderStanding);
 *   - every server forgets what it knew about the project's providers and
 *     asks the live updates open in the project again, as their joins were
 *     asked (RealtimeAccessChanges, SignInRulesChanged): a page signed in
 *     with a provider that was turned off or deleted stops hearing, and is
 *     told to sign in again, at once. A provider turned on is announced
 *     too, so no server keeps answering "off" for a minute;
 *   - a project that requires SSO keeps a way in: the last provider that
 *     can sign people in to it, or the one provider it requires, cannot be
 *     turned off or deleted until Require SSO for Login is turned off.
 *
 * Any other change - a new certificate or client secret, other addresses,
 * other teams, a new name - leaves the sign-ins the provider gave as they
 * are: they were checked when they were made, and the next sign-in uses
 * the new settings.
 */

// A provider row, as these hooks read it.
export interface ProjectSsoProviderRow {
  id: string;
  projectId: string;
  isOn: boolean;
}

/*
 * What a write does to providers' sign-ins, worked out before it runs and
 * acted on once it has (carryForward).
 */
export interface ProjectSsoProviderWrite {
  // Providers that were on, and that the write turns off or deletes.
  takenAway: Array<ProjectSsoProviderRow>;
  // Providers that were off, and that the write turns on.
  turnedOn: Array<ProjectSsoProviderRow>;
}

export const LAST_SSO_PROVIDER_MESSAGE: string =
  "This project requires SSO, and this is the last SSO provider people can sign in to it with. Turn off Require SSO for Login first, so people can still sign in.";

export const REQUIRED_SSO_PROVIDER_MESSAGE: string =
  "This project requires sign-in with this SSO provider. Turn off Require SSO for Login first, so people can still sign in.";

interface GlobalProviderRow {
  id: ObjectID;
  restrictToAttachedProjects: boolean;
}

export default class ProjectSsoProviderChanges {
  /*
   * Before an update (the service's onBeforeUpdate, after the caller's
   * write permission has narrowed the rows): which providers it turns off
   * or on, refused when it would leave a project that requires SSO with no
   * provider to sign in with. Null for an update that leaves Enabled alone
   * - a new certificate or secret included - which changes nobody's
   * sign-in.
   */
  public static async beforeUpdate<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<ProjectSsoProviderWrite | null> {
    const isEnabled: unknown = ProjectSsoProviderChanges.getWrittenIsEnabled(
      data.updateBy.data,
    );

    if (isEnabled === undefined) {
      return null;
    }

    const rows: Array<ProjectSsoProviderRow> =
      await ProjectSsoProviderChanges.readRows({
        service: data.service,
        query: data.updateBy.query,
        limit: data.updateBy.limit,
        skip: data.updateBy.skip,
      });

    const write: ProjectSsoProviderWrite = {
      takenAway: rows.filter((row: ProjectSsoProviderRow): boolean => {
        return isEnabled === false && row.isOn;
      }),
      turnedOn: rows.filter((row: ProjectSsoProviderRow): boolean => {
        return isEnabled === true && !row.isOn;
      }),
    };

    await ProjectSsoProviderChanges.assertProjectsKeepASignIn({
      providerType: data.providerType,
      takenAway: write.takenAway,
    });

    return write;
  }

  /*
   * The last step before an update is written (the service's
   * onUpdatePermitted, once every permission check has passed): an update
   * that turns a provider off writes when, in the same write, so a provider
   * is never off without the time its sign-ins ended. An update that turns
   * none off - every provider it names is off already - keeps the times
   * they have. One that turns several off gives each the same time, one
   * that was off already included: a provider that is off gives no
   * sign-ins, so a later time ends none that an earlier one did not.
   */
  public static async beforeWrite<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<void> {
    if (
      ProjectSsoProviderChanges.getWrittenIsEnabled(data.updateBy.data) !==
      false
    ) {
      return;
    }

    const rows: Array<ProjectSsoProviderRow> =
      await ProjectSsoProviderChanges.readRows({
        service: data.service,
        query: data.updateBy.query,
        limit: data.updateBy.limit,
        skip: data.updateBy.skip,
      });

    if (
      !rows.some((row: ProjectSsoProviderRow): boolean => {
        return row.isOn;
      })
    ) {
      return;
    }

    (data.updateBy.data as unknown as Record<string, unknown>)[
      "signInsEndedAt"
    ] = OneUptimeDate.getCurrentDate();
  }

  // After an update (onUpdateSuccess): the providers' projects, announced.
  public static afterUpdate(data: {
    write: ProjectSsoProviderWrite | null | undefined;
    updatedItemIds: Array<ObjectID>;
  }): void {
    if (!data.write) {
      return;
    }

    ProjectSsoProviderChanges.announce(
      ProjectSsoProviderChanges.getProjectsOfWritten(
        [...data.write.takenAway, ...data.write.turnedOn],
        data.updatedItemIds,
      ),
    );
  }

  /*
   * Before a delete (onBeforeDelete, with the rows the caller may delete):
   * the providers it takes away that were on, refused when that would leave
   * a project that requires SSO with no provider to sign in with.
   */
  public static async beforeDelete<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    deleteBy: DeleteBy<TModel>;
  }): Promise<ProjectSsoProviderWrite> {
    const rows: Array<ProjectSsoProviderRow> =
      await ProjectSsoProviderChanges.readRows({
        service: data.service,
        query: data.deleteBy.query,
        limit: data.deleteBy.limit,
        skip: data.deleteBy.skip,
      });

    const write: ProjectSsoProviderWrite = {
      takenAway: rows.filter((row: ProjectSsoProviderRow): boolean => {
        return row.isOn;
      }),
      turnedOn: [],
    };

    await ProjectSsoProviderChanges.assertProjectsKeepASignIn({
      providerType: data.providerType,
      takenAway: write.takenAway,
    });

    return write;
  }

  // After a delete (onDeleteSuccess): the deleted providers' projects, announced.
  public static afterDelete(data: {
    write: ProjectSsoProviderWrite | null | undefined;
    deletedItemIds: Array<ObjectID>;
  }): void {
    if (!data.write) {
      return;
    }

    ProjectSsoProviderChanges.announce(
      ProjectSsoProviderChanges.getProjectsOfWritten(
        data.write.takenAway,
        data.deletedItemIds,
      ),
    );
  }

  /*
   * A project that requires SSO keeps a provider to sign in with: one it
   * requires by id (requireSsoWithSsoProviderId) cannot go, and without one
   * the last provider that is on - the project's SAML and OIDC providers
   * and the instance's global providers that sign people in to it - cannot
   * either. Read from the database, not a cache: the requirement may have
   * changed on another server a moment ago.
   */
  public static async assertProjectsKeepASignIn(data: {
    providerType: ProjectSsoProviderType;
    takenAway: Array<ProjectSsoProviderRow>;
  }): Promise<void> {
    const takenAwayByProject: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const row of data.takenAway) {
      const ids: Set<string> =
        takenAwayByProject.get(row.projectId) || new Set<string>();
      ids.add(row.id);
      takenAwayByProject.set(row.projectId, ids);
    }

    for (const [projectId, takenAwayIds] of takenAwayByProject) {
      const project: Project | null = await ProjectService.findOneById({
        id: new ObjectID(projectId),
        select: {
          _id: true,
          requireSsoForLogin: true,
          requireSsoWithSsoProviderId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project || !project.requireSsoForLogin) {
        continue;
      }

      const requiredProviderId: string | null =
        project.requireSsoWithSsoProviderId
          ? project.requireSsoWithSsoProviderId.toString().toLowerCase()
          : null;

      if (requiredProviderId) {
        if (takenAwayIds.has(requiredProviderId)) {
          throw new BadDataException(REQUIRED_SSO_PROVIDER_MESSAGE);
        }

        // Only that provider lets anyone in: this one never did.
        continue;
      }

      if (
        await ProjectSsoProviderChanges.hasAnotherProviderOn({
          projectId: new ObjectID(projectId),
          providerType: data.providerType,
          takenAwayIds: takenAwayIds,
        })
      ) {
        continue;
      }

      throw new BadDataException(LAST_SSO_PROVIDER_MESSAGE);
    }
  }

  /*
   * Whether anything but the providers a write takes away still signs
   * people in to the project: another of its SAML or OIDC providers that is
   * on, or a global provider that is on and signs people in to it.
   */
  private static async hasAnotherProviderOn(data: {
    projectId: ObjectID;
    providerType: ProjectSsoProviderType;
    takenAwayIds: Set<string>;
  }): Promise<boolean> {
    const projectProviders: Array<{
      providerType: ProjectSsoProviderType;
      rows: Array<BaseModel>;
    }> = [
      {
        providerType: SsoProviderType.ProjectSSO,
        rows: await ProjectSsoService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
          },
          select: {
            _id: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
      },
      {
        providerType: SsoProviderType.ProjectOIDC,
        rows: await ProjectOidcService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
          },
          select: {
            _id: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
      },
    ];

    for (const providers of projectProviders) {
      for (const row of providers.rows) {
        const id: string | undefined = row.id?.toString().toLowerCase();

        if (!id) {
          continue;
        }

        if (
          providers.providerType === data.providerType &&
          data.takenAwayIds.has(id)
        ) {
          continue;
        }

        return true;
      }
    }

    return await ProjectSsoProviderChanges.hasGlobalProviderOn(data.projectId);
  }

  /*
   * Whether a global SSO or OIDC provider that is on signs people in to the
   * project: every project, unless the instance restricted it to the
   * projects attached to it (UserMiddleware.isGlobalSsoTokenAuthorizedForProject).
   */
  private static async hasGlobalProviderOn(
    projectId: ObjectID,
  ): Promise<boolean> {
    const globalSsoProviders: Array<GlobalSso> = await GlobalSsoService.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        restrictToAttachedProjects: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const provider of ProjectSsoProviderChanges.toGlobalRows(
      globalSsoProviders,
    )) {
      if (
        !provider.restrictToAttachedProjects ||
        (await GlobalSsoProjectService.doesProviderGovernProject({
          globalSsoId: provider.id,
          projectId: projectId,
        }))
      ) {
        return true;
      }
    }

    const globalOidcProviders: Array<GlobalOidc> =
      await GlobalOidcService.findBy({
        query: {
          isEnabled: true,
        },
        select: {
          _id: true,
          restrictToAttachedProjects: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const provider of ProjectSsoProviderChanges.toGlobalRows(
      globalOidcProviders,
    )) {
      if (
        !provider.restrictToAttachedProjects ||
        (await GlobalOidcProjectService.doesProviderGovernProject({
          globalOidcId: provider.id,
          projectId: projectId,
        }))
      ) {
        return true;
      }
    }

    return false;
  }

  private static toGlobalRows(
    providers: Array<GlobalSso | GlobalOidc>,
  ): Array<GlobalProviderRow> {
    const rows: Array<GlobalProviderRow> = [];

    for (const provider of providers) {
      if (!provider.id) {
        continue;
      }

      rows.push({
        id: provider.id,
        restrictToAttachedProjects: Boolean(
          provider.restrictToAttachedProjects,
        ),
      });
    }

    return rows;
  }

  /*
   * Every server forgets what it knew about the projects' providers and
   * asks the live updates open in them again (RealtimeAccessChanges). This
   * server forgets at once, before anything else is asked.
   */
  private static announce(projectIds: Array<string>): void {
    for (const projectId of new Set<string>(projectIds)) {
      ProjectSsoProviderStanding.forget(projectId);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: projectId,
      });
    }
  }

  // The projects of the rows the write actually wrote.
  private static getProjectsOfWritten(
    rows: Array<ProjectSsoProviderRow>,
    writtenIds: Array<ObjectID>,
  ): Array<string> {
    const written: Set<string> = new Set<string>(
      writtenIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    return rows
      .filter((row: ProjectSsoProviderRow): boolean => {
        return written.has(row.id);
      })
      .map((row: ProjectSsoProviderRow): string => {
        return row.projectId;
      });
  }

  /*
   * The Enabled switch an update writes - true or false, as DatabaseService
   * stores it by the time the hooks run - or undefined when it leaves it
   * alone. Only the write's own field counts, never one it inherits.
   */
  private static getWrittenIsEnabled(data: unknown): boolean | undefined {
    if (
      !data ||
      typeof data !== "object" ||
      !Object.prototype.hasOwnProperty.call(data, "isEnabled")
    ) {
      return undefined;
    }

    const isEnabled: unknown = (data as Record<string, unknown>)["isEnabled"];

    return typeof isEnabled === "boolean" ? isEnabled : undefined;
  }

  // The rows a write names: their ids, projects, and whether they are on.
  private static async readRows<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    query: Query<TModel>;
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
  }): Promise<Array<ProjectSsoProviderRow>> {
    const rows: Array<TModel> = await data.service.findAllBy({
      query: data.query,
      select: {
        _id: true,
        projectId: true,
        isEnabled: true,
      } as unknown as Select<TModel>,
      limit: data.limit,
      skip: data.skip,
      props: {
        isRoot: true,
      },
    });

    const providerRows: Array<ProjectSsoProviderRow> = [];

    for (const row of rows) {
      const record: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      const id: string | undefined = row.id?.toString().toLowerCase();
      const projectId: string | undefined = record["projectId"]
        ? String(record["projectId"]).toLowerCase()
        : undefined;

      if (!id || !projectId) {
        continue;
      }

      providerRows.push({
        id: id,
        projectId: projectId,
        isOn: record["isEnabled"] === true,
      });
    }

    return providerRows;
  }
}
