import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The per-domain role tiers (MonitorAdmin/Member/Viewer and the ten families
 * beside it) were rolled out family by family: one commit renamed the legacy
 * "Manager" role inside each model's own access lists, and nothing ever asked
 * which models a role holder also needs. Every gap that produced issue #3305 is
 * of that shape - a model filed under the wrong family, or under none.
 *
 * The gaps are invisible to review because they are gaps: the list looks
 * perfectly ordinary, it simply omits three entries that its sibling two files
 * over has. StatusPageOwnerTeam carried the StatusPage tiers while
 * StatusPageOwnerRule did not; nothing in either file hinted at the difference.
 *
 * So this sweeps every model whose name puts it in a domain and asks whether
 * its read list admits that domain's roles. Anything that legitimately does not
 * is listed below with the reason, and that list may only shrink.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

/*
 * Model-name prefix -> role family, matched first-wins, so the order is part of
 * the mapping and not decoration. Two prefixes have to sit where they are:
 * IncomingCallPolicy* belongs to the on-call family rather than to a family of
 * its own, and ScheduledMaintenance* has to be tried before any shorter prefix
 * that is a prefix of it. Adding a family means thinking about where it goes in
 * this list, not appending to the end.
 */
const DOMAIN_PREFIXES: Array<[string, string]> = [
  ["ScheduledMaintenance", "ScheduledMaintenance"],
  ["IncomingCallPolicy", "OnCall"],
  ["OnCallDutyPolicy", "OnCall"],
  ["StatusPage", "StatusPage"],
  ["Telemetry", "Telemetry"],
  ["Incident", "Incident"],
  ["Alert", "Alert"],
  ["Monitor", "Monitor"],
  ["Workflow", "Workflow"],
  ["Runbook", "Runbook"],
];

/*
 * Models that belong to a domain but are not named for it, so no prefix will
 * ever reach them. A per-user saved view of logs, metrics or traces is a
 * telemetry object whatever its class is called - and all three were readable
 * only by the project-wide roles, so a Telemetry Admin could not open a view
 * they had saved themselves.
 *
 * This is the sweep's blind spot written down. A name-based sweep cannot find
 * these on its own; the only defence is naming them.
 */
const DOMAIN_BY_MODEL: Record<string, string> = {
  LogSavedView: "Telemetry",
  MetricSavedView: "Telemetry",
  TraceSavedView: "Telemetry",
};

/*
 * Models in a domain whose read list deliberately does not admit that domain's
 * roles, and why. Every entry here is a table a domain role holder is meant to
 * be kept out of, not a table nobody got round to.
 *
 * This list may only shrink. A new entry means either a real omission of the
 * #3305 kind, or a new table that has to justify itself here.
 */
const NOT_READABLE_BY_THEIR_DOMAIN_ROLES: Array<string> = [
  /*
   * The telemetry ingestion key is the credential a collector authenticates
   * with, and usage billing is billing. Neither is telemetry data.
   */
  "TelemetryIngestionKey",
  "TelemetryUsageBilling",

  /*
   * Secrets and credentials. These hold the values a monitor or runbook step
   * authenticates with; the whole point of them is that the people who
   * configure the resource cannot read them back.
   */
  "MonitorSecret",
  "RunbookCredential",
  "RunbookSecret",

  /*
   * Identity configuration for a status page, and the audit trail of the
   * directory syncs against it. Administering who may sign in to a status page
   * is a project-administration job, not a status-page-authoring one, which is
   * why these sit on the Settings tiers instead.
   */
  "StatusPageOIDC",
  "StatusPageSCIM",
  "StatusPageSCIMLog",
  "StatusPageSSO",

  /*
   * Session rows for status page visitors. Nobody reads this table through the
   * API at all - its access lists are empty and the service reaches it as root.
   */
  "StatusPagePrivateUserSession",

  /*
   * The inbound call policy and its escalation rules are configured under
   * Settings -> Calls rather than alongside on-call schedules, so they follow
   * the Settings tiers. Their label and owner rules follow their owner models,
   * which are on-call.
   */
  "IncomingCallPolicy",
  "IncomingCallPolicyEscalationRule",
];

type ModelNameFunction = (modelType: ModelType) => string;

const modelName: ModelNameFunction = (modelType: ModelType): string => {
  return new modelType().tableName || modelType.name;
};

type DomainOfFunction = (name: string) => string | null;

const domainOf: DomainOfFunction = (name: string): string | null => {
  if (DOMAIN_BY_MODEL[name]) {
    return DOMAIN_BY_MODEL[name] as string;
  }

  for (const [prefix, family] of DOMAIN_PREFIXES) {
    if (name.startsWith(prefix)) {
      return family;
    }
  }

  return null;
};

type TiersOfFunction = (family: string) => Array<Permission>;

const tiersOf: TiersOfFunction = (family: string): Array<Permission> => {
  return [
    `${family}Admin` as Permission,
    `${family}Member` as Permission,
    `${family}Viewer` as Permission,
  ];
};

describe("Domain role tier coverage", () => {
  /*
   * Guards the table above: every family it names has to be a real set of role
   * permissions. A typo would silently make the whole sweep vacuous for that
   * family, and the sweep would keep passing while covering nothing.
   */
  test("every family named here really has three role tiers", () => {
    const rolePermissions: Set<string> = new Set(
      PermissionHelper.getRolePermissionProps().map(
        (props: PermissionProps) => {
          return props.permission.toString();
        },
      ),
    );

    const unknown: Array<string> = [];

    const families: Array<string> = [
      ...DOMAIN_PREFIXES.map(([, family]: [string, string]) => {
        return family;
      }),
      ...Object.values(DOMAIN_BY_MODEL),
    ];

    for (const family of families) {
      for (const tier of tiersOf(family)) {
        if (!rolePermissions.has(tier.toString())) {
          unknown.push(tier.toString());
        }
      }
    }

    expect(unknown.sort()).toEqual([]);
  });

  test("a model in a domain is readable by that domain's roles", () => {
    const missing: Array<string> = [];
    let checked: number = 0;

    for (const modelType of MODEL_TYPES) {
      const name: string = modelName(modelType);
      const family: string | null = domainOf(name);

      if (!family) {
        continue;
      }

      checked++;

      const read: Array<Permission> =
        new modelType().readRecordPermissions || [];

      const absent: Array<Permission> = tiersOf(family).filter(
        (tier: Permission) => {
          return !read.includes(tier);
        },
      );

      if (absent.length > 0) {
        missing.push(name);
      }
    }

    expect(missing.sort()).toEqual(
      NOT_READABLE_BY_THEIR_DOMAIN_ROLES.slice().sort(),
    );

    /*
     * A sweep that stops matching anything passes just as quietly as one that
     * finds nothing wrong. Renaming a model family, or reordering
     * DOMAIN_PREFIXES so a longer prefix hides behind a shorter one, would do
     * exactly that.
     */
    expect(checked).toBeGreaterThan(100);
  });

  /*
   * The exemptions have to stay honest. If somebody gives one of these tables
   * its domain's roles, the entry must go with it - otherwise it sits there
   * excusing a model that no longer needs excusing, and the next real omission
   * hides behind a list nobody trusts any more.
   */
  test("no exemption is stale", () => {
    const modelsByName: Map<string, ModelType> = new Map(
      MODEL_TYPES.map((modelType: ModelType): [string, ModelType] => {
        return [modelName(modelType), modelType];
      }),
    );

    const stale: Array<string> = [];

    for (const name of NOT_READABLE_BY_THEIR_DOMAIN_ROLES) {
      const modelType: ModelType | undefined = modelsByName.get(name);

      if (!modelType) {
        stale.push(`${name} (no such model)`);
        continue;
      }

      const family: string | null = domainOf(name);

      if (!family) {
        stale.push(`${name} (no longer resolves to a domain)`);
        continue;
      }

      const read: Array<Permission> =
        new modelType().readRecordPermissions || [];

      if (
        tiersOf(family).every((tier: Permission) => {
          return read.includes(tier);
        })
      ) {
        stale.push(`${name} (now readable by ${family} roles)`);
      }
    }

    expect(stale.sort()).toEqual([]);
  });

  /*
   * Same reason as the shared-resource sweep: the table gate is the first of
   * two. A column that an ordinary project member can read but the domain's own
   * roles cannot turns a working list request into a permission error on
   * whichever field the page selects.
   */
  test("columns follow their table into the domain's roles", () => {
    const missing: Array<string> = [];
    let checked: number = 0;

    for (const modelType of MODEL_TYPES) {
      const name: string = modelName(modelType);
      const family: string | null = domainOf(name);

      if (!family) {
        continue;
      }

      const model: BaseModel = new modelType();
      const tiers: Array<Permission> = tiersOf(family);

      const tableIsInDomain: boolean = tiers.every((tier: Permission) => {
        return (model.readRecordPermissions || []).includes(tier);
      });

      if (!tableIsInDomain) {
        continue;
      }

      for (const column of model.getTableColumns().columns) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        if (!accessControl?.read?.includes(Permission.ProjectMember)) {
          continue;
        }

        checked++;

        for (const tier of tiers) {
          if (!accessControl.read.includes(tier)) {
            missing.push(`${name}.${column} is missing ${tier}`);
          }
        }
      }
    }

    expect(missing.sort()).toEqual([]);
    expect(checked).toBeGreaterThan(500);
  });
});
