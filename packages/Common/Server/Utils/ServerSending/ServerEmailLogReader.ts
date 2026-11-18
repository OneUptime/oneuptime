import Project from "../../../Models/DatabaseModels/Project";
import ServerEmailLog from "../../../Models/DatabaseModels/ServerEmailLog";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ServerEmailLogUtil, {
  SERVER_EMAIL_LOG_PAGE_SIZE,
  ServerEmailLogAnswer,
  ServerEmailLogEntry,
  ServerEmailLogQuery,
  ServerEmailLogStatus,
  getServerEmailLogRetentionInDays,
} from "../../../Types/Email/ServerEmailLog";
import MailStatus from "../../../Types/Mail/MailStatus";
import ObjectID from "../../../Types/ObjectID";
import { IsBillingEnabled } from "../../EnvironmentConfig";
import ProjectService from "../../Services/ProjectService";
import ServerEmailLogService from "../../Services/ServerEmailLogService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Query from "../../Types/Database/Query";

/*
 * One page of the server's email log (#6878, Types/Email/ServerEmailLog),
 * newest first, for GET /global-config/email-log - master admins only, the
 * route's to check. Read as root: the table grants nobody a read.
 */
export default class ServerEmailLogReader {
  public static async read(
    query: ServerEmailLogQuery,
  ): Promise<ServerEmailLogAnswer> {
    const where: Query<ServerEmailLog> = query.failedOnly
      ? { status: MailStatus.Error }
      : {};

    // One more than a page, to know whether there is another.
    const rows: Array<ServerEmailLog> = await ServerEmailLogService.findBy({
      query: where,
      select: {
        _id: true,
        createdAt: true,
        toEmail: true,
        subject: true,
        templateType: true,
        status: true,
        statusMessage: true,
        projectId: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      skip: query.skip,
      limit: SERVER_EMAIL_LOG_PAGE_SIZE + 1,
      props: {
        isRoot: true,
      },
    });

    const page: Array<ServerEmailLog> = rows.slice(
      0,
      SERVER_EMAIL_LOG_PAGE_SIZE,
    );

    const projectNames: Map<string, string> =
      await ServerEmailLogReader.readProjectNames(page);

    return {
      entries: page.map((row: ServerEmailLog): ServerEmailLogEntry => {
        const projectId: string | null = row.projectId
          ? row.projectId.toString()
          : null;

        return {
          id: row._id?.toString() || "",
          at: OneUptimeDate.toString(
            row.createdAt || OneUptimeDate.getCurrentDate(),
          ),
          toEmail: row.toEmail?.toString() || "",
          subject: row.subject || null,
          templateName: ServerEmailLogReader.toTemplateName(row.templateType),
          status:
            row.status === MailStatus.Success
              ? ServerEmailLogStatus.Sent
              : ServerEmailLogStatus.Failed,
          statusMessage: row.statusMessage || null,
          projectId: projectId,
          projectName: projectId ? projectNames.get(projectId) || null : null,
        };
      }),
      hasMore: rows.length > SERVER_EMAIL_LOG_PAGE_SIZE,
      retentionInDays: getServerEmailLogRetentionInDays(IsBillingEnabled),
    };
  }

  // "ForgotPassword.hbs" is the template ForgotPassword.
  public static toTemplateName(
    templateType: string | null | undefined,
  ): string | null {
    if (!templateType) {
      return null;
    }

    return templateType.replace(/\.hbs$/i, "") || null;
  }

  // The names of the projects the rows were sent for, those that still exist.
  private static async readProjectNames(
    rows: Array<ServerEmailLog>,
  ): Promise<Map<string, string>> {
    const ids: Array<string> = Array.from(
      new Set(
        rows
          .map((row: ServerEmailLog): string => {
            return row.projectId ? row.projectId.toString() : "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      ),
    );

    const names: Map<string, string> = new Map<string, string>();

    if (ids.length === 0) {
      return names;
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        _id: QueryHelper.any(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
      },
      skip: 0,
      limit: ids.length,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      if (project._id && project.name) {
        names.set(project._id.toString(), project.name);
      }
    }

    return names;
  }

  // The page a request's query asks for.
  public static readQuery(query: {
    [name: string]: unknown;
  }): ServerEmailLogQuery {
    return ServerEmailLogUtil.readQuery(query);
  }
}
