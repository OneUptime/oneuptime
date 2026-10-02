/*
 * Which monitors may use a monitor secret (issue #1467).
 *
 * A secret has exactly one access mode, and the mode alone decides:
 *
 *   - All Monitors: every monitor in the secret's project, including monitors
 *     created after the secret.
 *   - Specific Monitors: the monitors in the secret's `monitors` list. This was
 *     the only mode before #1467, so it is the default and every secret that
 *     existed then has it.
 *   - Monitors With Labels: monitors that carry at least one of the labels in
 *     the secret's `labels` list. A monitor gains or loses the secret as its
 *     labels change.
 *
 * Only the list that belongs to the mode is read. MonitorSecretService empties
 * the other one whenever the mode is written, but a list written over the API
 * without a mode can still sit there unused, and it must never grant anything:
 * a forgotten `monitors` list on a label-scoped secret would hand the secret to
 * monitors that carry none of the labels.
 *
 * No mode reaches across projects. The service checks that both lists name
 * this project's records, but a row written before that check existed can hold
 * another project's monitor or label, so a project mismatch denies whatever the
 * lists say.
 */
enum MonitorSecretAccess {
  AllMonitors = "All Monitors",
  SpecificMonitors = "Specific Monitors",
  MonitorsWithLabels = "Monitors With Labels",
}

// The relation lists a mode can read. Each mode reads at most one.
export type MonitorSecretAccessList = "monitors" | "labels";

export const MONITOR_SECRET_ACCESS_LISTS: ReadonlyArray<MonitorSecretAccessList> =
  ["monitors", "labels"];

/*
 * The secret's side of the question, as plain ids so a caller can build it
 * from whatever it read (a model, a raw row, a test fixture) without the
 * matcher caring which.
 */
export interface MonitorSecretGrant {
  projectId: string | undefined;
  // As stored. Anything that is not a known mode grants nothing.
  monitorAccess: string | undefined;
  monitorIds: Array<string>;
  labelIds: Array<string>;
}

/*
 * The monitor's side. `monitorId` is undefined for a monitor that is not saved
 * yet: a test run from the Create Monitor form, which belongs to a project but
 * is nobody's listed monitor and carries no labels.
 */
export interface MonitorSecretGrantee {
  monitorId: string | undefined;
  projectId: string | undefined;
  labelIds: Array<string>;
}

export class MonitorSecretAccessUtil {
  // What a secret gets when nobody says otherwise. Matches the column default.
  public static readonly DEFAULT_ACCESS: MonitorSecretAccess =
    MonitorSecretAccess.SpecificMonitors;

  public static readonly ALL_ACCESS_MODES: ReadonlyArray<MonitorSecretAccess> =
    [
      MonitorSecretAccess.AllMonitors,
      MonitorSecretAccess.SpecificMonitors,
      MonitorSecretAccess.MonitorsWithLabels,
    ];

  public static isValid(value: unknown): value is MonitorSecretAccess {
    return (
      typeof value === "string" &&
      MonitorSecretAccessUtil.ALL_ACCESS_MODES.includes(
        value as MonitorSecretAccess,
      )
    );
  }

  // The list a mode reads, or null for All Monitors, which reads neither.
  public static getListUsedBy(
    access: MonitorSecretAccess,
  ): MonitorSecretAccessList | null {
    switch (access) {
      case MonitorSecretAccess.SpecificMonitors:
        return "monitors";
      case MonitorSecretAccess.MonitorsWithLabels:
        return "labels";
      default:
        return null;
    }
  }

  // The lists a mode leaves unread: what a write of that mode empties.
  public static getListsUnusedBy(
    access: MonitorSecretAccess,
  ): Array<MonitorSecretAccessList> {
    const used: MonitorSecretAccessList | null =
      MonitorSecretAccessUtil.getListUsedBy(access);

    return MONITOR_SECRET_ACCESS_LISTS.filter(
      (list: MonitorSecretAccessList): boolean => {
        return list !== used;
      },
    );
  }

  /*
   * The rule itself. Project first, then the mode, then only the mode's own
   * list. Ids are compared case-insensitively: Postgres reads uuids back in
   * lower case, while an ObjectID keeps whatever case it was built from.
   */
  public static canMonitorUseSecret(data: {
    secret: MonitorSecretGrant;
    monitor: MonitorSecretGrantee;
  }): boolean {
    const secretProjectId: string | null = MonitorSecretAccessUtil.normalizeId(
      data.secret.projectId,
    );
    const monitorProjectId: string | null = MonitorSecretAccessUtil.normalizeId(
      data.monitor.projectId,
    );

    if (
      !secretProjectId ||
      !monitorProjectId ||
      secretProjectId !== monitorProjectId
    ) {
      return false;
    }

    switch (data.secret.monitorAccess) {
      case MonitorSecretAccess.AllMonitors:
        return true;

      case MonitorSecretAccess.SpecificMonitors: {
        const monitorId: string | null = MonitorSecretAccessUtil.normalizeId(
          data.monitor.monitorId,
        );

        if (!monitorId) {
          return false;
        }

        return data.secret.monitorIds.some((id: string): boolean => {
          return MonitorSecretAccessUtil.normalizeId(id) === monitorId;
        });
      }

      case MonitorSecretAccess.MonitorsWithLabels: {
        const monitorLabelIds: Set<string> = new Set();

        for (const labelId of data.monitor.labelIds) {
          const normalized: string | null =
            MonitorSecretAccessUtil.normalizeId(labelId);

          if (normalized) {
            monitorLabelIds.add(normalized);
          }
        }

        return data.secret.labelIds.some((id: string): boolean => {
          const normalized: string | null =
            MonitorSecretAccessUtil.normalizeId(id);

          return normalized !== null && monitorLabelIds.has(normalized);
        });
      }

      default:
        return false;
    }
  }

  private static normalizeId(id: string | undefined | null): string | null {
    const normalized: string = (id || "").toString().trim().toLowerCase();

    return normalized || null;
  }
}

export default MonitorSecretAccess;
