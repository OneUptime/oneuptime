import ObjectID from "../../Types/ObjectID";

/*
 * WHAT A MONITOR KEEPS WHEN ITS TEMPLATE CHANGES (OneUptime issues #11260,
 * #11266).
 *
 * A person links a monitor to another template, or unlinks it from its
 * template - one at a time, from Link Existing Monitors or Unlink from
 * Template, or a whole fleet at once (MonitorTemplateChangeRunner). An
 * import, an auto import rule and a network alert policy know the monitor
 * they made for a device by the template they made it from, so two things
 * are kept for them, in the same write that moves the monitor:
 *
 *   - the template it was created from (Monitor.createdFromMonitorTemplateId),
 *     when it is not recorded yet: the template it leaves, on a monitor made
 *     before the column existed. Recorded once and never moved after: a
 *     monitor counts for the template it was created from and the one it is
 *     linked to (DeviceMonitorDuplicates), so the rule that made it never
 *     makes it again beside it;
 *   - its alert policy lets it go (Monitor.networkAlertPolicyId): the policy
 *     owns the monitors it made from its template, and would delete one a
 *     person moved to another template and make it again. Let go, the monitor
 *     is the person's - the policy neither deletes it nor makes another for
 *     its device (NetworkAlertPolicyEngineService). OneUptime's own writes
 *     (root) keep the owner: they move nothing a person chose.
 *
 * Nothing changes for a write that leaves the monitor on the template it has.
 *
 * Pure: MonitorService reads the monitors the write moves and writes what
 * this says, once the write has passed every check (onUpdatePermitted).
 */

// What the monitor holds before the write, as far as this goes.
export interface StoredTemplateProvenance {
  monitorTemplateId?: ObjectID | string | null | undefined;
  createdFromMonitorTemplateId?: ObjectID | string | null | undefined;
  networkAlertPolicyId?: ObjectID | string | null | undefined;
}

// What the write adds to the monitor's own row: nothing, one, or both.
export interface TemplateChangeProvenancePatch {
  createdFromMonitorTemplateId?: ObjectID | undefined;
  networkAlertPolicyId?: null | undefined;
}

const toKey: (id: ObjectID | string | null | undefined) => string = (
  id: ObjectID | string | null | undefined,
): string => {
  return (id ? id.toString() : "").trim().toLowerCase();
};

export default class MonitorTemplateChangeProvenance {
  // Two template ids name the same template, or both name none.
  public static isSameTemplate(
    first: ObjectID | string | null | undefined,
    second: ObjectID | string | null | undefined,
  ): boolean {
    return toKey(first) === toKey(second);
  }

  /*
   * What a write of Monitor Template keeps on one monitor: nothing when the
   * monitor stays on the template it has.
   */
  public static getPatch(data: {
    stored: StoredTemplateProvenance;
    writtenMonitorTemplateId: ObjectID | string | null | undefined;
    // OneUptime's own write (root): an alert policy keeps the monitor.
    isOneUptimesOwnWrite: boolean;
  }): TemplateChangeProvenancePatch {
    if (
      this.isSameTemplate(
        data.stored.monitorTemplateId,
        data.writtenMonitorTemplateId,
      )
    ) {
      return {};
    }

    const patch: TemplateChangeProvenancePatch = {};

    if (
      !toKey(data.stored.createdFromMonitorTemplateId) &&
      toKey(data.stored.monitorTemplateId)
    ) {
      patch.createdFromMonitorTemplateId = new ObjectID(
        data.stored.monitorTemplateId!.toString(),
      );
    }

    if (toKey(data.stored.networkAlertPolicyId) && !data.isOneUptimesOwnWrite) {
      patch.networkAlertPolicyId = null;
    }

    return patch;
  }

  public static isEmpty(patch: TemplateChangeProvenancePatch): boolean {
    return Object.keys(patch).length === 0;
  }

  // Two patches that write the same columns with the same values.
  public static areEqual(
    first: TemplateChangeProvenancePatch,
    second: TemplateChangeProvenancePatch,
  ): boolean {
    const firstKeys: Array<string> = Object.keys(first).sort();
    const secondKeys: Array<string> = Object.keys(second).sort();

    if (firstKeys.join(",") !== secondKeys.join(",")) {
      return false;
    }

    return (
      toKey(first.createdFromMonitorTemplateId) ===
        toKey(second.createdFromMonitorTemplateId) &&
      first.networkAlertPolicyId === second.networkAlertPolicyId
    );
  }
}
