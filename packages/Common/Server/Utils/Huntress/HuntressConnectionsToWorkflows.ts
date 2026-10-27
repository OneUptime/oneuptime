import Project from "../../../Models/DatabaseModels/Project";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import User from "../../../Models/DatabaseModels/User";
import { IsBillingEnabled } from "../../EnvironmentConfig";
import GlobalCache from "../../Infrastructure/GlobalCache";
import ProjectService from "../../Services/ProjectService";
import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../Services/WorkflowService";
import PlanDowngradeOwnerNotice from "../Billing/PlanDowngradeOwnerNotice";
import PostgresErrorTranslator from "../Database/PostgresErrorTranslator";
import Encryption from "../Encryption";
import logger from "../Logger";
import {
  HUNTRESS_DELIVERY_CACHE_NAMESPACE,
  HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS,
} from "./HuntressWebhookHandler";
import URL from "../../../Types/API/URL";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import HuntressSeverity, {
  isHuntressSeverity,
} from "../../../Types/Huntress/HuntressSeverity";
import { parseHuntressOrganizationFilter } from "../../../Types/Huntress/HuntressOrganizationFilter";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SafeHtml from "../../../Types/SafeHtml";
import { HuntressTriggerSetting } from "../../../Types/Workflow/HuntressTrigger";
import {
  HUNTRESS_REPORT_ID_CUSTOM_FIELD,
  HuntressIncidentWorkflowOptions,
  buildHuntressIncidentWorkflowGraph,
} from "../../../Types/Workflow/Templates";
import WorkflowPlan from "../../../Types/Workflow/WorkflowPlan";

/*
 * HUNTRESS CONNECTIONS BECOME WORKFLOWS.
 *
 * Huntress used to be a connection of its own, under Incidents >
 * Integrations: each one received Huntress's signed webhooks at
 * /api/huntress/webhook/<connection id> and opened, paged, noted and
 * resolved incidents itself. Huntress is a workflow trigger now, and a
 * connection becomes the workflow that does exactly what it did, so
 * nothing changes for Huntress and nobody stops being paged:
 *
 *   - the workflow keeps the connection's id, so its old dashboard address
 *     forwards to it, and its webhook secret key is that id too, so the
 *     address Huntress posts to (/api/huntress/webhook/<id>, which the
 *     workflow service still answers) starts it;
 *   - it is signed with the connection's signing secret, and it is on;
 *   - its graph is the Huntress template's, with the connection's settings
 *     in it: the on-call policies it paged and for which reports, its
 *     labels, its organizations, the incident severities it opened at, and
 *     whether closing a report resolved the incident or only noted it
 *     (Templates.buildHuntressIncidentWorkflowGraph);
 *   - when Huntress last reached it, and why it last refused a request,
 *     carry over to the workflow's Huntress trigger.
 *
 * The incidents the connection opened keep their report's number in their
 * custom fields (huntressReportId), which is how the workflow finds the
 * incident of a report Huntress comments on or closes later; and the
 * webhook messages the connection applied in the last week are remembered,
 * so a delivery Huntress retries now starts nothing twice.
 *
 * On OneUptime Cloud, a project whose plan runs no workflows would have its
 * workflow refused: its owners are told once, by email, that it needs a
 * plan that does. Self-hosted installs have no plans.
 *
 * Nothing writes to the legacy tables ("HuntressConnection", its join
 * tables and "HuntressIncidentReport") any more. They are dropped once
 * every connection has its workflow (dropLegacyTables, run by the Workers'
 * data migration DropLegacyHuntressTables after the move). Safe to run
 * twice: a connection whose workflow exists is not copied again (its
 * incidents are still given their report's number, which only fills in
 * what is missing). Never throws for one connection: its failure is
 * logged, and the others go on.
 *
 * Run once by the Workers' data migration MoveHuntressConnectionsToWorkflows.
 * Kept here, beside the webhook, so it is tested against a migrated Postgres
 * (Tests/Server/Services/HuntressPostgres.test.ts) with the legacy tables
 * the migrations made.
 */

export type LegacyQuery = (
  sql: string,
  parameters?: Array<unknown>,
) => Promise<unknown>;

type LegacyTimestamp = Date | string | null;

// A HuntressConnection row as the Postgres driver returns it.
export interface LegacyHuntressConnectionRow {
  _id: string;
  projectId: string;
  name: string | null;
  signingSecret: string | null;
  pageOnCallFor: string | null;
  criticalIncidentSeverityId: string | null;
  highIncidentSeverityId: string | null;
  lowIncidentSeverityId: string | null;
  watchedOrganizations: string | null;
  resolveIncidentWhenReportCloses: boolean | null;
  lastEventReceivedAt: LegacyTimestamp;
  lastError: string | null;
  lastErrorAt: LegacyTimestamp;
  createdByUserId: string | null;
}

// A HuntressIncidentReport row, as much of it as the move reads.
export interface LegacyHuntressReportRow {
  huntressIncidentReportId: string;
  incidentId: string | null;
  appliedMessageIds: unknown;
  updatedAt: LegacyTimestamp;
}

export const LEGACY_TABLE_SQL: string = `SELECT to_regclass('"HuntressConnection"') IS NOT NULL AS "hasConnectionTable", to_regclass('"HuntressIncidentReport"') IS NOT NULL AS "hasReportTable"`;

export const LEGACY_CONNECTIONS_SQL: string = `SELECT "_id", "projectId", "name", "signingSecret", "pageOnCallFor", "criticalIncidentSeverityId", "highIncidentSeverityId", "lowIncidentSeverityId", "watchedOrganizations", "resolveIncidentWhenReportCloses", "lastEventReceivedAt", "lastError", "lastErrorAt", "createdByUserId" FROM "HuntressConnection" WHERE "deletedAt" IS NULL ORDER BY "_id"`;

export const LEGACY_POLICIES_SQL: string = `SELECT "onCallDutyPolicyId" FROM "HuntressConnectionOnCallDutyPolicy" WHERE "huntressConnectionId" = $1 ORDER BY "onCallDutyPolicyId"`;

export const LEGACY_LABELS_SQL: string = `SELECT "labelId" FROM "HuntressConnectionLabel" WHERE "huntressConnectionId" = $1 ORDER BY "labelId"`;

export const LEGACY_REPORTS_SQL: string = `SELECT "huntressIncidentReportId", "incidentId", "appliedMessageIds", "updatedAt" FROM "HuntressIncidentReport" WHERE "huntressConnectionId" = $1 AND "deletedAt" IS NULL`;

export const PROJECT_WORKFLOW_NAMES_SQL: string = `SELECT "name" FROM "Workflow" WHERE "projectId" = $1 AND "deletedAt" IS NULL`;

/*
 * The connections in use whose workflow is not there - its move failed, or
 * the workflow was deleted since: what they were set up to do is only in
 * the legacy tables, so those are kept. A workflow of the connection's id
 * is its own, whatever happened to it after.
 */
export const UNMOVED_CONNECTIONS_SQL: string = `SELECT COUNT(*)::int AS "unmoved" FROM "HuntressConnection" "connection" WHERE "connection"."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "Workflow" "workflow" WHERE "workflow"."_id" = "connection"."_id")`;

/*
 * The legacy tables, in one statement, so they go together or not at all:
 * the reports and the two join tables, which reference a connection, and
 * the connections. No other table references them.
 */
export const LEGACY_TABLES: Array<string> = [
  "HuntressIncidentReport",
  "HuntressConnectionLabel",
  "HuntressConnectionOnCallDutyPolicy",
  "HuntressConnection",
];

export const DROP_LEGACY_TABLES_SQL: string = `DROP TABLE IF EXISTS ${LEGACY_TABLES.map(
  (table: string): string => {
    return `"${table}"`;
  },
).join(", ")}`;

/*
 * Gives an incident its report's number, only when it has none yet: a
 * custom field of that name, set by hand or by an earlier run, is kept.
 */
export const BACKFILL_REPORT_ID_SQL: string = `UPDATE "Incident" SET "customFields" = COALESCE("customFields", '{}'::jsonb) || jsonb_build_object('${HUNTRESS_REPORT_ID_CUSTOM_FIELD}', $1::text) WHERE "_id" = $2 AND "projectId" = $3 AND NOT (COALESCE("customFields", '{}'::jsonb) ? '${HUNTRESS_REPORT_ID_CUSTOM_FIELD}')`;

// What the workflow says it was, in its description.
export const MOVED_WORKFLOW_DESCRIPTION: string =
  "Opens an incident for each Huntress incident report, as the Huntress connection this workflow was made from did. It was moved here when Huntress became a workflow trigger: Huntress still sends its reports to the same address, signed with the same secret.";

// The name a connection that had none is given.
export const DEFAULT_WORKFLOW_NAME: string = "Huntress";

/*
 * The owners' email says first what stopped, in the project's own name, so
 * the owner of several projects knows which one it is about.
 */
export function getPlanNoticeSubject(projectName?: string | null): string {
  return `Huntress reports stopped opening incidents in ${getProjectInSentence(projectName)}`;
}

// The project as a sentence names it: its name, or "your project".
function getProjectInSentence(projectName?: string | null): string {
  return projectName?.trim() || "your project";
}

export type ConnectionOutcome = "moved" | "already-moved" | "failed";

/*
 * What dropLegacyTables did: dropped them, found none (an install that
 * never had Huntress connections, or one that dropped them already), or
 * kept them for the connections that have no workflow.
 */
export type LegacyTablesOutcome = "dropped" | "no-tables" | "kept";

export interface LegacyTablesDropSummary {
  outcome: LegacyTablesOutcome;
  // The connections in use that have no workflow; 0 unless kept.
  unmoved: number;
}

export interface HuntressMoveSummary {
  moved: number;
  alreadyMoved: number;
  failed: number;
  incidentsLinked: number;
  ownersTold: number;
}

function toDate(value: LegacyTimestamp | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function readIdColumn(rows: unknown, column: string): Array<string> {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row: unknown): string => {
      const value: unknown =
        row && typeof row === "object"
          ? (row as Record<string, unknown>)[column]
          : null;

      return value ? String(value) : "";
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });
}

function readMessageIds(value: unknown): Array<string> {
  let ids: unknown = value;

  if (typeof ids === "string") {
    try {
      ids = JSON.parse(ids);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(ids)) {
    return [];
  }

  return ids.filter((id: unknown): id is string => {
    return typeof id === "string" && id.trim().length > 0;
  });
}

/*
 * The connection's settings, as the workflow's graph and its trigger's
 * settings hold them.
 */
export function getWorkflowOptions(data: {
  connection: LegacyHuntressConnectionRow;
  onCallPolicyIds: Array<string>;
  labelIds: Array<string>;
}): HuntressIncidentWorkflowOptions {
  const connection: LegacyHuntressConnectionRow = data.connection;
  const triggerSettings: JSONObject = {};

  // Kept as it was typed, one organization a line, when it names any.
  if (
    connection.watchedOrganizations &&
    parseHuntressOrganizationFilter(connection.watchedOrganizations).length > 0
  ) {
    triggerSettings[HuntressTriggerSetting.Organizations] =
      connection.watchedOrganizations;
  }

  const severities: Array<[HuntressTriggerSetting, string | null]> = [
    [
      HuntressTriggerSetting.CriticalIncidentSeverity,
      connection.criticalIncidentSeverityId,
    ],
    [
      HuntressTriggerSetting.HighIncidentSeverity,
      connection.highIncidentSeverityId,
    ],
    [
      HuntressTriggerSetting.LowIncidentSeverity,
      connection.lowIncidentSeverityId,
    ],
  ];

  for (const [setting, severityId] of severities) {
    if (severityId && ObjectID.isValidUUID(String(severityId))) {
      triggerSettings[setting] = String(severityId);
    }
  }

  return {
    triggerSettings,
    pages: data.onCallPolicyIds.length > 0,
    onCallPolicyIds: data.onCallPolicyIds,
    pageOnCallFor: isHuntressSeverity(connection.pageOnCallFor)
      ? connection.pageOnCallFor
      : HuntressSeverity.High,
    labelIds: data.labelIds,
    // On unless switched off, as the column defaulted.
    resolveWhenClosed: connection.resolveIncidentWhenReportCloses !== false,
  };
}

/*
 * The connection's signing secret, as the workflow saves it: decrypted (a
 * value written before the column was encrypted is plaintext already), and
 * only when it is still a secret Huntress could have issued.
 */
export async function readLegacySigningSecret(
  value: string | null,
): Promise<string | null> {
  if (!value) {
    return null;
  }

  try {
    const secret: string = Encryption.looksEncrypted(value)
      ? await Encryption.decrypt(value)
      : value;

    return WorkflowServiceClass.readWebhookSigningSecret(secret);
  } catch (err) {
    logger.error(
      `HuntressConnectionsToWorkflows: a signing secret could not be read, so its workflow refuses requests until one is saved: ${err}`,
    );

    return null;
  }
}

/*
 * The workflow's name: the connection's, unless another workflow of the
 * project has it - then the first of "<name> (2)", "<name> (3)", ... that
 * none has. Workflow names are unique within a project.
 */
export function getFreeWorkflowName(data: {
  name: string | null;
  takenNames: Array<string>;
}): string {
  const base: string = (data.name || "").trim() || DEFAULT_WORKFLOW_NAME;
  const taken: Set<string> = new Set(
    data.takenNames.map((name: string): string => {
      return name.trim().toLowerCase();
    }),
  );

  if (!taken.has(base.toLowerCase())) {
    return base;
  }

  for (let suffix: number = 2; ; suffix++) {
    const candidate: string = `${base} (${suffix})`;

    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

// The lowest plan whose projects run workflows (WorkflowPlan).
export const HUNTRESS_WORKFLOW_PLAN: PlanType = PlanType.Growth;

/*
 * What the owners of a project whose plan runs no workflows are told, as the
 * HTML their email places it in (SimpleMessage's info block, which writes it
 * as it is): what stopped and why, where to upgrade - with the link to the
 * project's Billing page when the dashboard's address is configured - and
 * that nothing changes in Huntress. Every value is escaped: the workflow's
 * name is the connection's, which a project member typed.
 */
export function getPlanNoticeHtml(data: {
  projectId: ObjectID;
  projectName?: string | null | undefined;
  plan: PlanType;
  workflowName: string;
}): string {
  const project: string = getProjectInSentence(data.projectName);

  const upgrade: string = SafeHtml.escape(
    "Upgrade the project in Project Settings > Billing and Invoices > Billing, and its Huntress reports open incidents again.",
  );

  const billingLink: URL | null = PlanDowngradeOwnerNotice.getSettingsLink(
    data.projectId,
  );

  const link: string | null = billingLink
    ? SafeHtml.escape(billingLink.toString())
    : null;

  return [
    SafeHtml.escape(
      `Huntress incident reports no longer open incidents or page anyone in ${project}. Huntress is now set up with a workflow, and workflows need the ${HUNTRESS_WORKFLOW_PLAN} plan or above, but ${project} is on the ${data.plan} plan.`,
    ),
    link ? `${upgrade} <br/> <a href="${link}">${link}</a>` : upgrade,
    SafeHtml.escape(
      `There is nothing to change in Huntress: your Huntress connection became the workflow "${data.workflowName}", which receives Huntress's reports at the same address, signed with the same secret, and does what the connection did.`,
    ),
    SafeHtml.escape("Project owners get this email once."),
  ].join(" <br/> <br/> ");
}

export default class HuntressConnectionsToWorkflows {
  public static async moveAll(
    query: LegacyQuery = HuntressConnectionsToWorkflows.defaultQuery(),
  ): Promise<HuntressMoveSummary> {
    const summary: HuntressMoveSummary = {
      moved: 0,
      alreadyMoved: 0,
      failed: 0,
      incidentsLinked: 0,
      ownersTold: 0,
    };

    const tables: unknown = await query(LEGACY_TABLE_SQL);
    const tableRow: Record<string, unknown> | undefined = Array.isArray(tables)
      ? (tables[0] as Record<string, unknown> | undefined)
      : undefined;

    if (!tableRow?.["hasConnectionTable"]) {
      // An install that never had Huntress connections: nothing to move.
      return summary;
    }

    const hasReportTable: boolean = Boolean(tableRow["hasReportTable"]);
    const rows: unknown = await query(LEGACY_CONNECTIONS_SQL);
    const connections: Array<LegacyHuntressConnectionRow> = Array.isArray(rows)
      ? (rows as Array<LegacyHuntressConnectionRow>)
      : [];

    // Projects whose owners were told already, so one project is told once.
    const projectsTold: Set<string> = new Set<string>();

    for (const connection of connections) {
      let outcome: ConnectionOutcome;
      let workflowName: string | null = null;

      try {
        const moved: { outcome: ConnectionOutcome; name: string | null } =
          await this.moveConnection({ connection, query });
        outcome = moved.outcome;
        workflowName = moved.name;
      } catch (err) {
        outcome = "failed";
        logger.error(
          `HuntressConnectionsToWorkflows: Huntress connection ${connection._id} of project ${connection.projectId} could not be moved to a workflow:`,
        );
        logger.error(err);
      }

      if (outcome === "moved") {
        summary.moved++;
      } else if (outcome === "already-moved") {
        summary.alreadyMoved++;
      } else {
        summary.failed++;
        continue;
      }

      if (hasReportTable) {
        try {
          summary.incidentsLinked += await this.carryOverReports({
            connection,
            query,
          });
        } catch (err) {
          logger.error(
            `HuntressConnectionsToWorkflows: the reports of Huntress connection ${connection._id} could not be carried over:`,
          );
          logger.error(err);
        }
      }

      if (
        outcome === "moved" &&
        workflowName &&
        !projectsTold.has(connection.projectId)
      ) {
        try {
          if (
            await this.tellOwnersIfPlanRunsNoWorkflows({
              projectId: new ObjectID(connection.projectId),
              workflowName,
            })
          ) {
            projectsTold.add(connection.projectId);
            summary.ownersTold++;
          }
        } catch (err) {
          logger.error(
            `HuntressConnectionsToWorkflows: the owners of project ${connection.projectId} could not be told about its plan:`,
          );
          logger.error(err);
        }
      }
    }

    return summary;
  }

  /*
   * Drops the legacy tables once every connection in use has its workflow,
   * so nothing a connection was set up to do is lost: a connection whose
   * move failed, or whose workflow was deleted since, keeps them all, and
   * the summary says how many such connections there are. The move is not
   * run again here: it would make again a workflow someone deleted.
   *
   * Nothing writes to the legacy tables, so no connection can appear
   * between the count and the drop. Two runners at once (the data
   * migration runner is not serialized): the drop is IF EXISTS, and a count
   * that finds the tables gone since is no failure. Any other failure to
   * read or drop reaches the caller.
   */
  public static async dropLegacyTables(
    query: LegacyQuery = HuntressConnectionsToWorkflows.defaultQuery(),
  ): Promise<LegacyTablesDropSummary> {
    const tables: { hasConnectionTable: boolean; hasReportTable: boolean } =
      await HuntressConnectionsToWorkflows.readLegacyTables(query);

    if (!tables.hasConnectionTable) {
      /*
       * No connections table: none to keep. A report table left without it
       * goes too.
       */
      if (tables.hasReportTable) {
        await query(DROP_LEGACY_TABLES_SQL);
        return { outcome: "dropped", unmoved: 0 };
      }

      return { outcome: "no-tables", unmoved: 0 };
    }

    let counted: unknown;

    try {
      counted = await query(UNMOVED_CONNECTIONS_SQL);
    } catch (err) {
      // Another runner dropped them meanwhile: nothing is left to do.
      if (
        !(await HuntressConnectionsToWorkflows.readLegacyTables(query))
          .hasConnectionTable
      ) {
        return { outcome: "no-tables", unmoved: 0 };
      }

      throw err;
    }

    const unmoved: number = Number(
      Array.isArray(counted)
        ? (counted[0] as Record<string, unknown> | undefined)?.["unmoved"]
        : NaN,
    );

    // A count that cannot be read keeps the tables, as connections would.
    if (!Number.isFinite(unmoved) || unmoved !== 0) {
      return {
        outcome: "kept",
        unmoved: Number.isFinite(unmoved) ? unmoved : 0,
      };
    }

    await query(DROP_LEGACY_TABLES_SQL);

    return { outcome: "dropped", unmoved: 0 };
  }

  // Which of the legacy tables are there.
  private static async readLegacyTables(
    query: LegacyQuery,
  ): Promise<{ hasConnectionTable: boolean; hasReportTable: boolean }> {
    const tables: unknown = await query(LEGACY_TABLE_SQL);
    const tableRow: Record<string, unknown> | undefined = Array.isArray(tables)
      ? (tables[0] as Record<string, unknown> | undefined)
      : undefined;

    return {
      hasConnectionTable: Boolean(tableRow?.["hasConnectionTable"]),
      hasReportTable: Boolean(tableRow?.["hasReportTable"]),
    };
  }

  /*
   * Makes the connection's workflow, unless it is there already (an earlier
   * run, or a concurrent one, made it).
   */
  public static async moveConnection(data: {
    connection: LegacyHuntressConnectionRow;
    query: LegacyQuery;
  }): Promise<{ outcome: ConnectionOutcome; name: string | null }> {
    const connection: LegacyHuntressConnectionRow = data.connection;
    const workflowId: ObjectID = new ObjectID(connection._id);

    const existing: Workflow | null = await WorkflowService.findOneById({
      id: workflowId,
      select: { _id: true, name: true },
      props: { isRoot: true },
    });

    if (existing) {
      return { outcome: "already-moved", name: existing.name || null };
    }

    const onCallPolicyIds: Array<string> = readIdColumn(
      await data.query(LEGACY_POLICIES_SQL, [connection._id]),
      "onCallDutyPolicyId",
    );
    const labelIds: Array<string> = readIdColumn(
      await data.query(LEGACY_LABELS_SQL, [connection._id]),
      "labelId",
    );
    const takenNames: Array<string> = (
      ((await data.query(PROJECT_WORKFLOW_NAMES_SQL, [
        connection.projectId,
      ])) as Array<{ name: string | null }>) || []
    )
      .map((row: { name: string | null }): string => {
        return row.name || "";
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      });

    const options: HuntressIncidentWorkflowOptions = getWorkflowOptions({
      connection,
      onCallPolicyIds,
      labelIds,
    });

    const workflow: Workflow = new Workflow();
    workflow.id = workflowId;
    workflow.projectId = new ObjectID(connection.projectId);
    workflow.name = getFreeWorkflowName({
      name: connection.name,
      takenNames,
    });
    workflow.description = MOVED_WORKFLOW_DESCRIPTION;
    workflow.isEnabled = true;
    workflow.graph = buildHuntressIncidentWorkflowGraph(options, (): string => {
      return ObjectID.generate().toString();
    });
    // The address Huntress posts to ends in the connection's id.
    workflow.webhookSecretKey = connection._id;

    const secret: string | null = await readLegacySigningSecret(
      connection.signingSecret,
    );

    if (secret) {
      workflow.webhookSigningSecret = secret;
    }

    if (
      connection.createdByUserId &&
      ObjectID.isValidUUID(connection.createdByUserId)
    ) {
      workflow.createdByUserId = new ObjectID(connection.createdByUserId);
    }

    try {
      await WorkflowService.create({
        data: workflow,
        props: { isRoot: true },
      });
    } catch (err) {
      // A concurrent run made it first.
      if (PostgresErrorTranslator.isUniqueViolation(err)) {
        return { outcome: "already-moved", name: workflow.name || null };
      }

      throw err;
    }

    // What Huntress last did, for the trigger's settings to show.
    const lastRequestAt: Date | null = toDate(connection.lastEventReceivedAt);
    const lastErrorAt: Date | null = toDate(connection.lastErrorAt);

    if (lastRequestAt || (connection.lastError && lastErrorAt)) {
      await WorkflowService.updateColumnsByIdWithoutHooks({
        id: workflowId,
        data: {
          ...(lastRequestAt ? { lastWebhookRequestAt: lastRequestAt } : {}),
          ...(connection.lastError && lastErrorAt
            ? {
                lastWebhookError: connection.lastError,
                lastWebhookErrorAt: lastErrorAt,
              }
            : {}),
        } as never,
        skipUpdateDateColumn: true,
      });
    }

    return { outcome: "moved", name: workflow.name || null };
  }

  /*
   * The connection's reports, carried over: each incident it opened is
   * given its report's number, and each webhook message it applied in the
   * last week is remembered for the workflow. Returns how many incidents
   * were given one.
   */
  public static async carryOverReports(data: {
    connection: LegacyHuntressConnectionRow;
    query: LegacyQuery;
    now?: Date | undefined;
  }): Promise<number> {
    const rows: unknown = await data.query(LEGACY_REPORTS_SQL, [
      data.connection._id,
    ]);
    const reports: Array<LegacyHuntressReportRow> = Array.isArray(rows)
      ? (rows as Array<LegacyHuntressReportRow>)
      : [];
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const rememberedSince: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS,
    );
    let linked: number = 0;

    for (const report of reports) {
      const reportId: string = String(report.huntressIncidentReportId || "");

      if (
        reportId &&
        report.incidentId &&
        ObjectID.isValidUUID(String(report.incidentId))
      ) {
        const result: unknown = await data.query(BACKFILL_REPORT_ID_SQL, [
          reportId,
          String(report.incidentId),
          data.connection.projectId,
        ]);

        linked += HuntressConnectionsToWorkflows.countUpdated(result);
      }

      const updatedAt: Date | null = toDate(report.updatedAt);

      if (!updatedAt || updatedAt.getTime() < rememberedSince.getTime()) {
        continue;
      }

      for (const messageId of readMessageIds(report.appliedMessageIds)) {
        try {
          await GlobalCache.setStringIfNotExists(
            HUNTRESS_DELIVERY_CACHE_NAMESPACE,
            `${data.connection._id}:${messageId}`,
            updatedAt.toISOString(),
            { expiresInSeconds: HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS },
          );
        } catch (err) {
          // Best effort: Huntress rarely retries a message it was answered.
          logger.error(
            `HuntressConnectionsToWorkflows: could not remember a message the connection applied: ${err}`,
          );
        }
      }
    }

    return linked;
  }

  /*
   * Tells the owners of a project whose plan runs no workflows - on
   * OneUptime Cloud, below Growth - that its Huntress workflow cannot run
   * until the plan changes. Returns whether they were told.
   */
  public static async tellOwnersIfPlanRunsNoWorkflows(data: {
    projectId: ObjectID;
    workflowName: string;
  }): Promise<boolean> {
    if (!IsBillingEnabled) {
      return false;
    }

    const plan: { plan: PlanType | null; isSubscriptionUnpaid: boolean } =
      await ProjectService.getCurrentPlan(data.projectId);

    if (!plan.plan || WorkflowPlan[plan.plan] > 0) {
      return false;
    }

    const owners: Array<User> = await ProjectService.getOwners(data.projectId);

    if (owners.length === 0) {
      return false;
    }

    const projectName: string | null =
      await HuntressConnectionsToWorkflows.readProjectName(data.projectId);

    const delivered: number = await ProjectService.sendEmailToOwnersAndWait({
      projectId: data.projectId,
      owners,
      subject: getPlanNoticeSubject(projectName),
      message: getPlanNoticeHtml({
        projectId: data.projectId,
        projectName: projectName,
        plan: plan.plan,
        workflowName: data.workflowName,
      }),
    });

    return delivered > 0;
  }

  /*
   * The project's name, for the owners' email; null when it cannot be read,
   * and the email says "your project" instead - it is still sent.
   */
  private static async readProjectName(
    projectId: ObjectID,
  ): Promise<string | null> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      return project?.name?.trim() || null;
    } catch (err) {
      logger.error(
        `HuntressConnectionsToWorkflows: could not read the name of project ${projectId.toString()} for its owners' email: ${err}`,
      );

      return null;
    }
  }

  private static countUpdated(result: unknown): number {
    /*
     * pg answers an UPDATE through TypeORM's query() as [rows, count]; a
     * driver that answers otherwise counts as no row changed.
     */
    if (Array.isArray(result) && typeof result[1] === "number") {
      return result[1];
    }

    return 0;
  }

  private static defaultQuery(): LegacyQuery {
    return async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      return await WorkflowService.getRepository().manager.query(
        sql,
        parameters,
      );
    };
  }
}
