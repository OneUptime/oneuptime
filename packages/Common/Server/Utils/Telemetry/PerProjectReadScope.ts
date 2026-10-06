import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import { FindOperator, Raw } from "typeorm";

/*
 * A READ ACROSS THE CALLER'S PROJECTS IS SCOPED PROJECT BY PROJECT.
 *
 * A read that names no project, or asks for several, reads each project the
 * caller belongs to with the grants they hold THERE - the table check weighs
 * each project's grants on its own (TenantPermission). A scope that narrows
 * rows by resource (TelemetryReadScope) therefore differs from project to
 * project, and is applied as one condition on a row's id:
 *
 *   - a row of a project where the caller reads everything matches;
 *   - a row of a project where their scope is narrower matches when that
 *     project's own condition holds;
 *   - a row of a project whose grants refuse the read matches nothing, as
 *     the table check leaves that project out too.
 *
 * Used by the services whose reads follow a scope of their own (the metric
 * catalogue, exception groups), so a read cannot step around the scope by
 * leaving the project out of the request.
 */
/*
 * The caller's props in each of their projects, one object per request and
 * project: the scope of a project is worked out once a request
 * (ModelPermission caches it by props), however many reads ask.
 */
const projectPropsCache: WeakMap<
  DatabaseCommonInteractionProps,
  Map<string, DatabaseCommonInteractionProps>
> = new WeakMap<
  DatabaseCommonInteractionProps,
  Map<string, DatabaseCommonInteractionProps>
>();

export default class PerProjectReadScope {
  // The caller's props in one of their projects (see projectPropsCache).
  public static getProjectProps(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): DatabaseCommonInteractionProps {
    let byProject: Map<string, DatabaseCommonInteractionProps> | undefined =
      projectPropsCache.get(props);

    if (!byProject) {
      byProject = new Map<string, DatabaseCommonInteractionProps>();
      projectPropsCache.set(props, byProject);
    }

    const key: string = projectId.toString();
    let projectProps: DatabaseCommonInteractionProps | undefined =
      byProject.get(key);

    if (!projectProps) {
      projectProps = {
        ...props,
        tenantId: projectId,
        isMultiTenantRequest: false,
      };
      byProject.set(key, projectProps);
    }

    return projectProps;
  }

  // A read that names no single project.
  public static isAcrossProjects(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return !props.tenantId || Boolean(props.isMultiTenantRequest);
  }

  /*
   * The condition on a row's id (`_id`) for a read across the caller's
   * projects, or null when every project's rows are read in full (or the
   * caller names no project at all, so there is nothing to read).
   *
   * `getClauseInProject` answers for one project, given the caller's props
   * in it: a condition on the row's id (a FindOperator built with Raw), null
   * when the caller reads all of that project's rows, or a thrown
   * NotAuthorizedException when the project's grants refuse the read.
   */
  public static async getClauseAcrossProjects(data: {
    props: DatabaseCommonInteractionProps;
    tableName: string;
    getClauseInProject: (
      projectProps: DatabaseCommonInteractionProps,
    ) => Promise<FindWhereProperty<any> | null>;
  }): Promise<FindWhereProperty<any> | null> {
    const projectIds: Array<ObjectID> =
      data.props.userGlobalAccessPermission?.projectIds || [];

    if (projectIds.length === 0) {
      return null;
    }

    type ProjectClause =
      | { projectId: string; isRefused: true }
      | {
          projectId: string;
          isRefused: false;
          clause: FindWhereProperty<any> | null;
        };

    // Every project's condition at once: the lookups of one do not wait on another's.
    const projectClauses: Array<ProjectClause> = await Promise.all(
      projectIds.map(async (projectId: ObjectID): Promise<ProjectClause> => {
        try {
          return {
            projectId: projectId.toString(),
            isRefused: false,
            clause: await data.getClauseInProject(
              PerProjectReadScope.getProjectProps(data.props, projectId),
            ),
          };
        } catch (err) {
          if (err instanceof NotAuthorizedException) {
            return { projectId: projectId.toString(), isRefused: true };
          }
          throw err;
        }
      }),
    );

    const wideProjectIds: Array<string> = [];
    const limitedClauses: Array<{
      projectId: string;
      clause: FindWhereProperty<any>;
    }> = [];

    for (const projectClause of projectClauses) {
      if (projectClause.isRefused) {
        continue;
      }

      if (projectClause.clause) {
        limitedClauses.push({
          projectId: projectClause.projectId,
          clause: projectClause.clause,
        });
      } else {
        wideProjectIds.push(projectClause.projectId);
      }
    }

    /*
     * No project narrows the rows: the projects whose grants refuse the read
     * are left out by the table check already.
     */
    if (limitedClauses.length === 0) {
      return null;
    }

    const table: string = data.tableName.replace(/"/g, '""');
    const inProjects: (alias: string, parameter: string) => string = (
      alias: string,
      parameter: string,
    ): string => {
      return `${alias} IN (SELECT "${table}"."_id" FROM "${table}" WHERE "${table}"."projectId" IN (:...${parameter}))`;
    };

    const parameters: Record<string, unknown> = {};
    const parts: Array<(alias: string) => string> = [];

    if (wideProjectIds.length > 0) {
      const wideRid: string = "scopeWide_" + Text.generateRandomText(10);
      parameters[wideRid] = wideProjectIds;
      parts.push((alias: string): string => {
        return inProjects(alias, wideRid);
      });
    }

    for (const limited of limitedClauses) {
      const projectRid: string = "scopeProject_" + Text.generateRandomText(10);
      parameters[projectRid] = [limited.projectId];
      const operator: FindOperator<unknown> =
        limited.clause as FindOperator<unknown>;
      Object.assign(parameters, operator.objectLiteralParameters || {});
      parts.push((alias: string): string => {
        return `(${inProjects(alias, projectRid)} AND ${operator.getSql!(alias)})`;
      });
    }

    return Raw((alias: string): string => {
      return `(${parts
        .map((part: (alias: string) => string): string => {
          return part(alias);
        })
        .join(" OR ")})`;
    }, parameters);
  }
}
