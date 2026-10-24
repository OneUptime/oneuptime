import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A SECURITY CASE'S PRIORITY AND STATUS BECOME THE PROJECT'S OWN.
 *
 * They were fixed scales, written on each case as text: Critical, High,
 * Medium, Low or Informational, and New, Investigating, Contained or
 * Closed. Each project now keeps its own lists (Security Events > Settings >
 * Case Priorities and Case Statuses), which it can rename, recolour,
 * reorder and add to, and a case points at one of each by id. Nothing
 * changes for anybody: every project gets exactly the scale it read before,
 * and every case, playbook, setting, rule and saved view keeps what it had.
 *
 *   1. "SecurityCasePriority" and "SecurityCaseStatus", new tables: a
 *      project's priorities and statuses - name, colour, place, the archive
 *      switch every value records pick from has, and the flags that say
 *      what each built-in one means (which detection severity opens a case
 *      at a priority; which status is the new, acknowledged, contained and
 *      closed one).
 *   2. Every project gets the five priorities and four statuses it had,
 *      with the same names, order and colours, each the built-in one of its
 *      level or stage (SEEDED_PRIORITIES, SEEDED_STATUSES - the defaults a
 *      new project gets from ProjectService, held to them by a test).
 *   3. Every case is given the project's priority and status its text named
 *      (anything else - there was nothing else - reads as the old columns'
 *      defaults, Medium and New), and so are the priority people were told
 *      about it at and the one OneUptime AI suggested. Then the text columns
 *      go.
 *   4. What named a priority or a status by its text names it by id now: a
 *      playbook's minimum priority, a person's New Security Case minimum, a
 *      playbook's Set priority, Set status and Check threat intel steps (on
 *      the playbook and on every run that copied them), a Slack or Teams
 *      rule's Security Case Priority and Status conditions, and the case
 *      lists' saved views (convertSecurityCaseValueReferences).
 *
 * Generated with npm run generate-postgres-migration, which wrote the new
 * tables and columns but no data: it renamed "minimumPriority" and
 * "minimumSecurityCasePriority" before dropping them, and added the case's
 * two NOT NULL columns to a table that holds cases. The data steps, the
 * order (add nullable, fill, then NOT NULL) and this comment are written by
 * hand; the indexes and foreign keys on the three existing tables are built
 * online by AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000.
 *
 * One transaction: a stop part way rolls it all back, and the runner runs it
 * again from the start.
 */

export interface SeededValue {
  name: string;
  // The start of its slug; the project's id makes it unique.
  slug: string;
  description: string;
  color: string;
  order: number;
  // The built-in flag it carries.
  flag: string;
}

// The old text of a priority, and the flag of the project's priority it becomes.
export const LEGACY_PRIORITY_FLAGS: Readonly<Record<string, string>> = {
  Critical: "isCriticalPriority",
  High: "isHighPriority",
  Medium: "isMediumPriority",
  Low: "isLowPriority",
  Informational: "isInformationalPriority",
};

// The old text of a status, and the flag of the project's status it becomes.
export const LEGACY_STATUS_FLAGS: Readonly<Record<string, string>> = {
  New: "isNewStatus",
  Investigating: "isAcknowledgedStatus",
  Contained: "isContainedStatus",
  Closed: "isClosedStatus",
};

// What a case's text that names none of them reads as: the old columns' defaults.
export const FALLBACK_PRIORITY_FLAG: string = "isMediumPriority";
export const FALLBACK_STATUS_FLAG: string = "isNewStatus";

export const PRIORITY_FLAGS: ReadonlyArray<string> = Object.values(
  LEGACY_PRIORITY_FLAGS,
);
export const STATUS_FLAGS: ReadonlyArray<string> =
  Object.values(LEGACY_STATUS_FLAGS);

// The scale every project had: the same names, order and colours.
export const SEEDED_PRIORITIES: ReadonlyArray<SeededValue> = [
  {
    name: "Critical",
    slug: "critical",
    description: "An active attack or a confirmed breach. Respond immediately.",
    color: "#fd625e",
    order: 1,
    flag: "isCriticalPriority",
  },
  {
    name: "High",
    slug: "high",
    description: "Likely malicious. Look into it as soon as you can.",
    color: "#f1734f",
    order: 2,
    flag: "isHighPriority",
  },
  {
    name: "Medium",
    slug: "medium",
    description: "Suspicious, or of unknown weight. Look into it today.",
    color: "#ffbf53",
    order: 3,
    flag: "isMediumPriority",
  },
  {
    name: "Low",
    slug: "low",
    description: "Unlikely to be harmful, but worth a look.",
    color: "#3686be",
    order: 4,
    flag: "isLowPriority",
  },
  {
    name: "Informational",
    slug: "informational",
    description: "For the record. Nothing needs to be done.",
    color: "#6b7280",
    order: 5,
    flag: "isInformationalPriority",
  },
];

export const SEEDED_STATUSES: ReadonlyArray<SeededValue> = [
  {
    name: "New",
    slug: "new",
    description: "Nobody has looked at it yet.",
    color: "#fd625e",
    order: 1,
    flag: "isNewStatus",
  },
  {
    name: "Investigating",
    slug: "investigating",
    description: "Someone is working out what happened.",
    color: "#ffbf53",
    order: 2,
    flag: "isAcknowledgedStatus",
  },
  {
    name: "Contained",
    slug: "contained",
    description:
      "The threat can no longer do harm; the cleanup is still to do.",
    color: "#3686be",
    order: 3,
    flag: "isContainedStatus",
  },
  {
    name: "Closed",
    slug: "closed",
    description: "Done, with a verdict on what it was.",
    color: "#2ab57d",
    order: 4,
    flag: "isClosedStatus",
  },
];

// A quote inside an SQL string literal is written twice.
const SINGLE_QUOTE: RegExp = /'/g;

export function quoteLiteral(value: string): string {
  return `'${value.replace(SINGLE_QUOTE, "''")}'`;
}

/*
 * Every project gets each value, made unique by the project's id in its
 * slug (slugs are unique across projects). Projects deleted softly too:
 * their cases are still there.
 */
export function getSeedSql(data: {
  table: string;
  values: ReadonlyArray<SeededValue>;
  flags: ReadonlyArray<string>;
}): string {
  const flagColumns: string = data.flags
    .map((flag: string): string => {
      return `"${flag}"`;
    })
    .join(", ");

  const rows: string = data.values
    .map((value: SeededValue): string => {
      const flags: string = data.flags
        .map((flag: string): string => {
          return flag === value.flag ? "true" : "false";
        })
        .join(", ");

      return `(${quoteLiteral(value.name)}, ${quoteLiteral(value.slug)}, ${quoteLiteral(value.description)}, ${quoteLiteral(value.color)}, ${value.order}, ${flags})`;
    })
    .join(", ");

  const valueFlagColumns: string = data.flags
    .map((flag: string): string => {
      return `d."${flag}"`;
    })
    .join(", ");

  return `INSERT INTO "${data.table}" ("projectId", "name", "slug", "description", "color", "order", ${flagColumns}, "version") SELECT p."_id", d."name", d."slug" || '-' || REPLACE(p."_id"::text, '-', ''), d."description", d."color", d."order", ${valueFlagColumns}, 1 FROM "Project" AS p CROSS JOIN (VALUES ${rows}) AS d("name", "slug", "description", "color", "order", ${flagColumns})`;
}

/*
 * The flag, in a CASE on `column`, of the value each old text becomes:
 * WHEN 'High' THEN v."isHighPriority" ... With a fallback, any other text
 * (and none) becomes the fallback's value; without one, it becomes none.
 */
export function getLegacyMatchSql(data: {
  column: string;
  alias: string;
  legacy: Readonly<Record<string, string>>;
  fallbackFlag?: string | undefined;
}): string {
  const whens: string = Object.entries(data.legacy)
    .map(([text, flag]: [string, string]): string => {
      return `WHEN ${quoteLiteral(text)} THEN ${data.alias}."${flag}"`;
    })
    .join(" ");

  const otherwise: string = data.fallbackFlag
    ? ` ELSE ${data.alias}."${data.fallbackFlag}"`
    : " ELSE false";

  return `(CASE ${data.column} ${whens}${otherwise} END)`;
}

/*
 * Gives each row of `table` the id of its project's value its old text in
 * `fromColumn` named, in `toColumn`. Rows whose text names none are given
 * the fallback's, or left empty without one.
 */
export function getBackfillSql(data: {
  table: string;
  fromColumn: string;
  toColumn: string;
  valueTable: string;
  legacy: Readonly<Record<string, string>>;
  fallbackFlag?: string | undefined;
}): string {
  return `UPDATE "${data.table}" AS r SET "${data.toColumn}" = v."_id" FROM "${data.valueTable}" AS v WHERE v."projectId" = r."projectId" AND ${getLegacyMatchSql(
    {
      column: `r."${data.fromColumn}"`,
      alias: "v",
      legacy: data.legacy,
      fallbackFlag: data.fallbackFlag,
    },
  )}`;
}

// A project's values, by the old text that named each: { High: "<id>", ... }.
export interface LegacyValueIds {
  priorities: Record<string, string>;
  statuses: Record<string, string>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mapLegacy(
  value: unknown,
  ids: Record<string, string>,
): string | undefined {
  return typeof value === "string" ? ids[value] : undefined;
}

/*
 * A playbook's steps (or a run's copy of them) with each priority and
 * status named by id: Set priority's `priority` becomes `priorityId`, Set
 * status's `status` becomes `statusId` (its verdict kept), Check threat
 * intel's `raisePriorityTo` becomes `raisePriorityToId`. A text that names
 * none of them is left out, as the step's own check would have refused it.
 */
export function convertPlaybookSteps(
  steps: unknown,
  ids: LegacyValueIds,
): { steps: unknown; changed: boolean } {
  if (!Array.isArray(steps)) {
    return { steps, changed: false };
  }

  let changed: boolean = false;

  const converted: Array<unknown> = steps.map((step: unknown): unknown => {
    if (!isObject(step) || !isObject(step["config"])) {
      return step;
    }

    const config: JsonObject = { ...(step["config"] as JsonObject) };
    let stepChanged: boolean = false;

    if (step["action"] === "Set Case Priority" && "priority" in config) {
      const id: string | undefined = mapLegacy(
        config["priority"],
        ids.priorities,
      );
      delete config["priority"];

      if (id) {
        config["priorityId"] = id;
      }

      stepChanged = true;
    }

    if (step["action"] === "Set Case Status" && "status" in config) {
      const id: string | undefined = mapLegacy(config["status"], ids.statuses);
      delete config["status"];

      if (id) {
        config["statusId"] = id;
      }

      stepChanged = true;
    }

    if (
      step["action"] === "Check Threat Intel" &&
      "raisePriorityTo" in config
    ) {
      const id: string | undefined = mapLegacy(
        config["raisePriorityTo"],
        ids.priorities,
      );
      delete config["raisePriorityTo"];

      if (id) {
        config["raisePriorityToId"] = id;
      }

      stepChanged = true;
    }

    if (!stepChanged) {
      return step;
    }

    changed = true;

    return { ...step, config };
  });

  return { steps: changed ? converted : steps, changed };
}

const PRIORITY_CHECK_ON: string = "Security Case Priority";
const STATUS_CHECK_ON: string = "Security Case Status";

/*
 * A Slack or Teams rule's conditions with Security Case Priority and
 * Security Case Status matched by id, as every other value is: one text or
 * a list of them. A text that names none of them is dropped from the list.
 */
export function convertNotificationRule(
  rule: unknown,
  ids: LegacyValueIds,
): { rule: unknown; changed: boolean } {
  if (!isObject(rule) || !Array.isArray(rule["filters"])) {
    return { rule, changed: false };
  }

  let changed: boolean = false;

  const filters: Array<unknown> = (rule["filters"] as Array<unknown>).map(
    (filter: unknown): unknown => {
      if (!isObject(filter)) {
        return filter;
      }

      const map: Record<string, string> | null =
        filter["checkOn"] === PRIORITY_CHECK_ON
          ? ids.priorities
          : filter["checkOn"] === STATUS_CHECK_ON
            ? ids.statuses
            : null;

      if (!map) {
        return filter;
      }

      const value: unknown = filter["value"];

      if (Array.isArray(value)) {
        changed = true;

        return {
          ...filter,
          value: value
            .map((item: unknown): string | undefined => {
              return mapLegacy(item, map);
            })
            .filter((item: string | undefined): item is string => {
              return Boolean(item);
            }),
        };
      }

      if (typeof value === "string") {
        changed = true;

        return { ...filter, value: mapLegacy(value, map) || "" };
      }

      return filter;
    },
  );

  return { rule: changed ? { ...rule, filters } : rule, changed };
}

/*
 * A saved view of the case lists, filtering by the new id columns: a
 * filter on "priority" or "status" - one text, or the list an Includes
 * holds - becomes one on "securityCasePriorityId" or "securityCaseStatusId".
 * A sort on either is dropped: there is no text to sort by any more, and
 * the lists sort by their own columns.
 */
export function convertCaseListView(
  view: { query: unknown; sort: unknown },
  ids: LegacyValueIds,
): { query: unknown; sort: unknown; changed: boolean } {
  let changed: boolean = false;
  let query: unknown = view.query;
  let sort: unknown = view.sort;

  const keys: Array<[string, string, Record<string, string>]> = [
    ["priority", "securityCasePriorityId", ids.priorities],
    ["status", "securityCaseStatusId", ids.statuses],
  ];

  if (isObject(query)) {
    const next: JsonObject = { ...query };

    for (const [from, to, map] of keys) {
      if (!(from in next)) {
        continue;
      }

      const value: unknown = next[from];
      delete next[from];
      changed = true;

      if (typeof value === "string") {
        const id: string | undefined = mapLegacy(value, map);

        if (id) {
          next[to] = id;
        }

        continue;
      }

      if (isObject(value) && Array.isArray(value["value"])) {
        const values: Array<string> = (value["value"] as Array<unknown>)
          .map((item: unknown): string | undefined => {
            return mapLegacy(item, map);
          })
          .filter((item: string | undefined): item is string => {
            return Boolean(item);
          });

        if (values.length > 0) {
          next[to] = { ...value, value: values };
        }
      }
    }

    query = next;
  }

  if (isObject(sort)) {
    const next: JsonObject = { ...sort };

    for (const [from] of keys) {
      if (from in next) {
        delete next[from];
        changed = true;
      }
    }

    sort = next;
  }

  return { query, sort, changed };
}

// The lists of the case queue, as their saved views are filed (the case table's id).
export const CASE_LIST_TABLE_IDS: ReadonlyArray<string> = [
  "security-cases-table",
];

export class AddSecurityCasePrioritiesAndStatuses1807200000000
  implements MigrationInterface
{
  public name: string = "AddSecurityCasePrioritiesAndStatuses1807200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. The tables.
    await queryRunner.query(
      `CREATE TABLE "SecurityCasePriority" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "color" character varying(10) NOT NULL, "isCriticalPriority" boolean NOT NULL DEFAULT false, "isHighPriority" boolean NOT NULL DEFAULT false, "isMediumPriority" boolean NOT NULL DEFAULT false, "isLowPriority" boolean NOT NULL DEFAULT false, "isInformationalPriority" boolean NOT NULL DEFAULT false, "order" smallint NOT NULL, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_bd25f12fc366fcf2012a65ff9ca" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5ee8dde39cc07c8835ce9dfba" ON "SecurityCasePriority" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c00e23944388b054aad5dba770" ON "SecurityCasePriority" ("projectId", "order") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseStatus" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "color" character varying(10) NOT NULL, "isNewStatus" boolean NOT NULL DEFAULT false, "isAcknowledgedStatus" boolean NOT NULL DEFAULT false, "isContainedStatus" boolean NOT NULL DEFAULT false, "isClosedStatus" boolean NOT NULL DEFAULT false, "order" smallint NOT NULL, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4acffd55ea20573bfeeecae1622" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b50cbc86765a0ba89132442430" ON "SecurityCaseStatus" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f822f29c59716b9247ed0344c" ON "SecurityCaseStatus" ("projectId", "order") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" ADD CONSTRAINT "FK_b5ee8dde39cc07c8835ce9dfbae" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" ADD CONSTRAINT "FK_796ccda10de15c0c4d9be63ef67" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" ADD CONSTRAINT "FK_e97acad296e748d93a341f7d84c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" ADD CONSTRAINT "FK_ddfe33560801cef57c57c7752a4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" ADD CONSTRAINT "FK_b50cbc86765a0ba89132442430b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" ADD CONSTRAINT "FK_747d0c28cc80529417fa1cfd058" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" ADD CONSTRAINT "FK_8a7e06954a615df93c18fbe2e83" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" ADD CONSTRAINT "FK_2849e27ac567081a0ce0337eb35" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // 2. Every project's scale, as it had it.
    await queryRunner.query(
      getSeedSql({
        table: "SecurityCasePriority",
        values: SEEDED_PRIORITIES,
        flags: PRIORITY_FLAGS,
      }),
    );
    await queryRunner.query(
      getSeedSql({
        table: "SecurityCaseStatus",
        values: SEEDED_STATUSES,
        flags: STATUS_FLAGS,
      }),
    );

    // 3. Every case's priority and status, by id.
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "securityCaseStatusId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "securityCasePriorityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "notifiedSecurityCasePriorityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiSuggestedSecurityCasePriorityId" uuid`,
    );
    await queryRunner.query(
      getBackfillSql({
        table: "SecurityCase",
        fromColumn: "status",
        toColumn: "securityCaseStatusId",
        valueTable: "SecurityCaseStatus",
        legacy: LEGACY_STATUS_FLAGS,
        fallbackFlag: FALLBACK_STATUS_FLAG,
      }),
    );
    await queryRunner.query(
      getBackfillSql({
        table: "SecurityCase",
        fromColumn: "priority",
        toColumn: "securityCasePriorityId",
        valueTable: "SecurityCasePriority",
        legacy: LEGACY_PRIORITY_FLAGS,
        fallbackFlag: FALLBACK_PRIORITY_FLAG,
      }),
    );
    await queryRunner.query(
      getBackfillSql({
        table: "SecurityCase",
        fromColumn: "notifiedPriority",
        toColumn: "notifiedSecurityCasePriorityId",
        valueTable: "SecurityCasePriority",
        legacy: LEGACY_PRIORITY_FLAGS,
      }),
    );
    await queryRunner.query(
      getBackfillSql({
        table: "SecurityCase",
        fromColumn: "aiSuggestedPriority",
        toColumn: "aiSuggestedSecurityCasePriorityId",
        valueTable: "SecurityCasePriority",
        legacy: LEGACY_PRIORITY_FLAGS,
      }),
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ALTER COLUMN "securityCaseStatusId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ALTER COLUMN "securityCasePriorityId" SET NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b845ed92cfae3be744524365ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d861cfa4e61db2db02aeaf7908"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18bfa595b4bb4f4c15745b0f07"`,
    );
    await queryRunner.query(`ALTER TABLE "SecurityCase" DROP COLUMN "status"`);
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "priority"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "notifiedPriority"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiSuggestedPriority"`,
    );

    // 4. A playbook's minimum and a person's notification minimum, by id.
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" ADD "minimumSecurityCasePriorityId" uuid`,
    );
    await queryRunner.query(
      getBackfillSql({
        table: "SecurityPlaybook",
        fromColumn: "minimumPriority",
        toColumn: "minimumSecurityCasePriorityId",
        valueTable: "SecurityCasePriority",
        legacy: LEGACY_PRIORITY_FLAGS,
      }),
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" DROP COLUMN "minimumPriority"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "minimumSecurityCasePriorityId" uuid`,
    );
    await queryRunner.query(
      getBackfillSql({
        table: "UserNotificationSetting",
        fromColumn: "minimumSecurityCasePriority",
        toColumn: "minimumSecurityCasePriorityId",
        valueTable: "SecurityCasePriority",
        legacy: LEGACY_PRIORITY_FLAGS,
      }),
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "minimumSecurityCasePriority"`,
    );

    // ... and every reference held in JSON.
    await this.convertSecurityCaseValueReferences(queryRunner);
  }

  /*
   * The JSON that named a priority or a status by its text: playbooks'
   * steps, runs' copies of them, Slack and Teams rules and saved views of
   * the case lists. Few rows, read one project's values at a time.
   */
  public async convertSecurityCaseValueReferences(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const idsByProject: Map<string, LegacyValueIds> = new Map();

    const getIds: (projectId: string) => Promise<LegacyValueIds> = async (
      projectId: string,
    ): Promise<LegacyValueIds> => {
      const known: LegacyValueIds | undefined = idsByProject.get(projectId);

      if (known) {
        return known;
      }

      const ids: LegacyValueIds = { priorities: {}, statuses: {} };

      const priorities: Array<Record<string, unknown>> =
        await queryRunner.query(
          `SELECT "_id", ${PRIORITY_FLAGS.map((flag: string): string => {
            return `"${flag}"`;
          }).join(
            ", ",
          )} FROM "SecurityCasePriority" WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
          [projectId],
        );

      for (const [text, flag] of Object.entries(LEGACY_PRIORITY_FLAGS)) {
        const row: Record<string, unknown> | undefined = priorities.find(
          (candidate: Record<string, unknown>): boolean => {
            return candidate[flag] === true;
          },
        );

        if (row) {
          ids.priorities[text] = String(row["_id"]);
        }
      }

      const statuses: Array<Record<string, unknown>> = await queryRunner.query(
        `SELECT "_id", ${STATUS_FLAGS.map((flag: string): string => {
          return `"${flag}"`;
        }).join(
          ", ",
        )} FROM "SecurityCaseStatus" WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
        [projectId],
      );

      for (const [text, flag] of Object.entries(LEGACY_STATUS_FLAGS)) {
        const row: Record<string, unknown> | undefined = statuses.find(
          (candidate: Record<string, unknown>): boolean => {
            return candidate[flag] === true;
          },
        );

        if (row) {
          ids.statuses[text] = String(row["_id"]);
        }
      }

      idsByProject.set(projectId, ids);

      return ids;
    };

    const stepFilter: string = `("steps"::text LIKE '%Set Case Priority%' OR "steps"::text LIKE '%Set Case Status%' OR "steps"::text LIKE '%Check Threat Intel%')`;

    for (const table of ["SecurityPlaybook", "SecurityPlaybookRun"]) {
      const rows: Array<Record<string, unknown>> = await queryRunner.query(
        `SELECT "_id", "projectId", "steps" FROM "${table}" WHERE "steps" IS NOT NULL AND ${stepFilter}`,
      );

      for (const row of rows) {
        const result: { steps: unknown; changed: boolean } =
          convertPlaybookSteps(
            row["steps"],
            await getIds(String(row["projectId"])),
          );

        if (result.changed) {
          await queryRunner.query(
            `UPDATE "${table}" SET "steps" = $1::jsonb WHERE "_id" = $2`,
            [JSON.stringify(result.steps), row["_id"]],
          );
        }
      }
    }

    const rules: Array<Record<string, unknown>> = await queryRunner.query(
      `SELECT "_id", "projectId", "notificationRule" FROM "WorkspaceNotificationRule" WHERE "eventType" = 'Security Case' AND "notificationRule" IS NOT NULL`,
    );

    for (const row of rules) {
      const result: { rule: unknown; changed: boolean } =
        convertNotificationRule(
          row["notificationRule"],
          await getIds(String(row["projectId"])),
        );

      if (result.changed) {
        await queryRunner.query(
          `UPDATE "WorkspaceNotificationRule" SET "notificationRule" = $1::jsonb WHERE "_id" = $2`,
          [JSON.stringify(result.rule), row["_id"]],
        );
      }
    }

    const views: Array<Record<string, unknown>> = await queryRunner.query(
      `SELECT "_id", "projectId", "query", "sort" FROM "TableView" WHERE "tableId" = ANY($1)`,
      [[...CASE_LIST_TABLE_IDS]],
    );

    for (const row of views) {
      const result: { query: unknown; sort: unknown; changed: boolean } =
        convertCaseListView(
          { query: row["query"], sort: row["sort"] },
          await getIds(String(row["projectId"])),
        );

      if (result.changed) {
        await queryRunner.query(
          `UPDATE "TableView" SET "query" = $1::jsonb, "sort" = $2::jsonb WHERE "_id" = $3`,
          [
            JSON.stringify(result.query ?? null),
            JSON.stringify(result.sort ?? null),
            row["_id"],
          ],
        );
      }
    }
  }

  /*
   * Back to text: each case, playbook and setting gets the old name of the
   * built-in value it is at (a value of the project's own reads as the old
   * columns' defaults, Medium and New), then the tables go. The references
   * held in JSON keep their ids.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "minimumSecurityCasePriority" character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "UserNotificationSetting" AS r SET "minimumSecurityCasePriority" = ${this.getLegacyTextSql("v", LEGACY_PRIORITY_FLAGS)} FROM "SecurityCasePriority" AS v WHERE v."_id" = r."minimumSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "minimumSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" ADD "minimumPriority" character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "SecurityPlaybook" AS r SET "minimumPriority" = ${this.getLegacyTextSql("v", LEGACY_PRIORITY_FLAGS)} FROM "SecurityCasePriority" AS v WHERE v."_id" = r."minimumSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" DROP COLUMN "minimumSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiSuggestedPriority" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "notifiedPriority" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "priority" character varying(100) NOT NULL DEFAULT 'Medium'`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "status" character varying(100) NOT NULL DEFAULT 'New'`,
    );
    await queryRunner.query(
      `UPDATE "SecurityCase" AS r SET "priority" = COALESCE(${this.getLegacyTextSql("v", LEGACY_PRIORITY_FLAGS)}, 'Medium') FROM "SecurityCasePriority" AS v WHERE v."_id" = r."securityCasePriorityId"`,
    );
    await queryRunner.query(
      `UPDATE "SecurityCase" AS r SET "status" = COALESCE(${this.getLegacyTextSql("v", LEGACY_STATUS_FLAGS)}, 'New') FROM "SecurityCaseStatus" AS v WHERE v."_id" = r."securityCaseStatusId"`,
    );
    await queryRunner.query(
      `UPDATE "SecurityCase" AS r SET "notifiedPriority" = ${this.getLegacyTextSql("v", LEGACY_PRIORITY_FLAGS)} FROM "SecurityCasePriority" AS v WHERE v."_id" = r."notifiedSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `UPDATE "SecurityCase" AS r SET "aiSuggestedPriority" = ${this.getLegacyTextSql("v", LEGACY_PRIORITY_FLAGS)} FROM "SecurityCasePriority" AS v WHERE v."_id" = r."aiSuggestedSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiSuggestedSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "notifiedSecurityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "securityCasePriorityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "securityCaseStatusId"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18bfa595b4bb4f4c15745b0f07" ON "SecurityCase" ("projectId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d861cfa4e61db2db02aeaf7908" ON "SecurityCase" ("priority") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b845ed92cfae3be744524365ad" ON "SecurityCase" ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" DROP CONSTRAINT "FK_2849e27ac567081a0ce0337eb35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" DROP CONSTRAINT "FK_8a7e06954a615df93c18fbe2e83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" DROP CONSTRAINT "FK_747d0c28cc80529417fa1cfd058"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStatus" DROP CONSTRAINT "FK_b50cbc86765a0ba89132442430b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" DROP CONSTRAINT "FK_ddfe33560801cef57c57c7752a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" DROP CONSTRAINT "FK_e97acad296e748d93a341f7d84c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" DROP CONSTRAINT "FK_796ccda10de15c0c4d9be63ef67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" DROP CONSTRAINT "FK_b5ee8dde39cc07c8835ce9dfbae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f822f29c59716b9247ed0344c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b50cbc86765a0ba89132442430"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseStatus"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c00e23944388b054aad5dba770"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5ee8dde39cc07c8835ce9dfba"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCasePriority"`);
  }

  // The old text of the built-in value a row is, or null for one of the project's own.
  private getLegacyTextSql(
    alias: string,
    legacy: Readonly<Record<string, string>>,
  ): string {
    const whens: string = Object.entries(legacy)
      .map(([text, flag]: [string, string]): string => {
        return `WHEN ${alias}."${flag}" THEN ${quoteLiteral(text)}`;
      })
      .join(" ");

    return `(CASE ${whens} ELSE NULL END)`;
  }
}
