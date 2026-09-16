import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Query from "Common/Types/BaseDatabase/Query";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import { escapeWildcards } from "Common/Types/BaseDatabase/WildcardPattern";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  planShortDeviceName,
  planShortDeviceNames,
  ShortDeviceNamePlan,
  ShortDeviceNameRename,
  ShortenableDevice,
} from "Common/Utils/NetworkDiscovery/ShortDeviceNamePlanner";

/*
 * The bulk half of short device names (OneUptime issue #3678).
 *
 * The scan setting names what discovery imports from now on by its short
 * hostname — "wb-0660-kds01" rather than "wb-0660-kds01.wbhq.com". It does
 * nothing for the devices already in the project under their full DNS names,
 * and re-running the scan does not rename them either: a host whose address is
 * already registered is skipped on import, by design. Editing hundreds of
 * names one Overview page at a time is exactly what the issue was filed about,
 * so this is the fix for the existing fleet: select them, confirm, done.
 *
 * WHAT DECIDES A RENAME. The rules live in ShortDeviceNamePlanner, which is
 * pure and tested on its own; this hook is only the part that talks to the
 * server around it:
 *
 *   1. the whole selection is planned once, up front, so two selected devices
 *      that would end up with the same short name are BOTH skipped — the
 *      outcome must not depend on the order the table happened to be sorted
 *      in;
 *   2. each device is re-read before it is touched, and skipped if its name
 *      changed since it was selected — the operator confirmed the name they
 *      saw, not whatever somebody typed in another tab since;
 *   3. the short name is checked against the rest of the project, because
 *      name uniqueness is enforced only when a device is CREATED, never on
 *      update: without this check the action would happily leave two devices
 *      called "kds01" and the next import of either would fail confusingly;
 *   4. the write is exactly `{ name }`, or `{ name, dnsName }` when the full
 *      name is being kept as the DNS name — nothing else the device carries
 *      is this action's business.
 *
 * Confirm-only, like "Clear SNMP Credential Profile": there is nothing to ask
 * the operator beyond "yes", so there is no modal and the hook returns only
 * its bulk actions.
 */

export interface BulkShortenDeviceNamesResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
}

export const SHORTEN_DEVICE_NAMES_ACTION_TITLE: string =
  "Shorten Names to Hostname";

/*
 * How many "old → new" lines the confirmation shows. Enough to recognise what
 * is about to happen on a real estate; the rest are counted, not listed — a
 * confirm dialog listing 900 renames is one nobody reads.
 */
export const MAX_CONFIRM_EXAMPLES: number = 5;

/*
 * The outcomes this hook adds to the planner's own skip messages, worded once
 * so the tests can pin them. Reported through the FAILED list with the
 * "Skipped:" prefix, for the same reason every other device bulk action does:
 * the progress modal has exactly two lists, and a device left untouched is
 * honestly in neither — "succeeded" would claim it was renamed.
 */
export const SKIPPED_NAME_CHANGED_MESSAGE: string =
  "Skipped: the name changed since it was selected.";

export const DEVICE_NOT_FOUND_MESSAGE: string =
  "This device could not be read. It may have been deleted since the list was loaded.";

/*
 * The collision with a device OUTSIDE the batch. Names the device that holds
 * the name (as the server spells it), so the operator knows which of the two
 * to rename by hand rather than hunting for it.
 */
export function buildNameTakenMessage(data: {
  newName: string;
  existingDeviceName: string;
}): string {
  return `Skipped: another device is already named "${data.existingDeviceName}", so this one cannot also be renamed "${data.newName}". Rename one of them individually.`;
}

/*
 * The planner's view of a device. `id` is only used by the planner to label
 * its plans; the hook pairs plans with items by position, so an item without
 * an id still gets a plan (and fails on its own in the loop).
 */
function toShortenableDevice(device: NetworkDevice): ShortenableDevice {
  return {
    id: device._id?.toString() || "",
    name: device.name,
    hostname: device.hostname,
    sysName: device.sysName,
    dnsName: device.dnsName,
  };
}

/*
 * What the operator is told before anything happens.
 *
 * The examples are planned from the rows as the table loaded them, which is
 * what the operator is looking at; each device is re-planned from a fresh
 * read when the action runs, so a row that changed in the meantime is
 * reported, never renamed on stale data.
 *
 * The warnings are the side effects a rename has that are NOT obvious from
 * "the name changes", each of which has surprised someone on another bulk
 * action:
 *
 *   - a name is one of the fields site-assignment rules match, so the rules
 *     run again for every renamed device and can move one to a different site
 *     (the full name kept as the DNS name is what keeps a "*.corp.com" rule
 *     matching);
 *   - label and owner rules run only when a device is created, so a rule
 *     written against the full name will not un-apply itself, and a rule
 *     written against the short one will not apply until it is Run Now;
 *   - Ping monitors are named after the device when they are created, and are
 *     not renamed with it;
 *   - metrics carry the device name as an attribute, so a chart grouped by it
 *     shows the renamed device as a new series from the rename onwards;
 *   - uniqueness is checked device by device as the action runs, which is the
 *     best it can do without a database constraint.
 */
export function buildShortenDeviceNamesConfirmMessage(
  items: Array<NetworkDevice>,
): string {
  const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames(
    items.map(toShortenableDevice),
  );

  const renames: Array<ShortDeviceNameRename> = plans.filter(
    (plan: ShortDeviceNamePlan): plan is ShortDeviceNameRename => {
      return plan.kind === "rename";
    },
  );

  const skippedCount: number = plans.length - renames.length;
  const lines: Array<string> = [];

  if (renames.length === 0) {
    lines.push(
      items.length === 1
        ? "This device's name is not a fully qualified hostname that can be shortened, so it will be left as it is."
        : "None of these devices has a fully qualified hostname that can be shortened on its own, so none will be renamed. Devices that would end up sharing a short name are left as they are.",
    );
  } else {
    lines.push(
      items.length === 1
        ? "This device will be renamed to its hostname, dropping the domain:"
        : `${renames.length} of the ${items.length} selected devices will be renamed to their hostname, dropping the domain${
            renames.length > MAX_CONFIRM_EXAMPLES ? ". For example" : ""
          }:`,
    );

    for (const rename of renames.slice(0, MAX_CONFIRM_EXAMPLES)) {
      lines.push(`  ${rename.currentName} → ${rename.newName}`);
    }

    if (renames.length > MAX_CONFIRM_EXAMPLES) {
      lines.push(`  …and ${renames.length - MAX_CONFIRM_EXAMPLES} more.`);
    }

    if (skippedCount > 0) {
      lines.push(
        "",
        `${skippedCount} ${
          skippedCount === 1 ? "device is" : "devices are"
        } left as ${
          skippedCount === 1 ? "it is" : "they are"
        }: a name that is not a fully qualified hostname has no domain to drop, and devices that would end up sharing a short name are not renamed.`,
      );
    }
  }

  lines.push(
    "",
    "When a device has no DNS Name, its full name is kept as its DNS Name, so it can still be searched for - unless that name is also the device's SNMP System Name (which keeps it already), or is 80 characters or longer and may have been cut short at import.",
    "Site-assignment rules run again for every renamed device.",
    "Label and owner rules are not applied again — use Run Now on a rule that matches device names.",
    "Existing Ping monitors keep their current names.",
    "Metric series labelled with the device name start a new series under the new name.",
    "A device is skipped if another device already has its short name, or if its name changed since it was selected.",
  );

  return lines.join("\n");
}

function useBulkShortenDeviceNames(): BulkShortenDeviceNamesResult {
  /*
   * One device. Returns the "Skipped:" message when it was left alone, null
   * when it was renamed; anything that goes wrong is thrown to the loop, which
   * reports it against the device.
   *
   * `batchPlan` is this device's plan from the up-front pass over the whole
   * selection, which is the only place an in-batch collision can be seen.
   */
  type ShortenOneFunction = (
    item: NetworkDevice,
    batchPlan: ShortDeviceNamePlan | undefined,
  ) => Promise<string | null>;

  const shortenOne: ShortenOneFunction = async (
    item: NetworkDevice,
    batchPlan: ShortDeviceNamePlan | undefined,
  ): Promise<string | null> => {
    if (!item.id) {
      throw new BadDataException("Item ID not found");
    }

    const itemId: ObjectID = item.id;

    /*
     * Re-read the device rather than trusting the row. The rows were fetched
     * when the page loaded, and the plan written below — including whether
     * the old name is kept as the DNS name — has to be made on what the
     * device holds NOW: a DNS name filled in since, or a sysName that now
     * equals the name, changes the answer.
     */
    const device: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>({
      modelType: NetworkDevice,
      id: itemId,
      select: {
        _id: true,
        name: true,
        hostname: true,
        sysName: true,
        dnsName: true,
        projectId: true,
      },
    });

    if (!device) {
      throw new BadDataException(DEVICE_NOT_FOUND_MESSAGE);
    }

    /*
     * The operator confirmed a rename of the name on the row. If somebody has
     * renamed the device since — even only in case — the confirmation was for
     * a different name, and overwriting a name a person just chose is the one
     * outcome this action must never have. Compared only when the row carries
     * a name at all: the page always selects it, and a row without one has
     * nothing to be stale against.
     */
    if (
      typeof item.name === "string" &&
      item.name !== String(device.name ?? "")
    ) {
      return SKIPPED_NAME_CHANGED_MESSAGE;
    }

    const plan: ShortDeviceNamePlan = planShortDeviceName(
      toShortenableDevice(device),
    );

    if (plan.kind === "skip") {
      return plan.reason;
    }

    /*
     * An in-batch collision found by the up-front pass. The single-device plan
     * above cannot see it — it knows nothing of the rest of the selection —
     * so the up-front verdict stands: the device renamed would otherwise be
     * whichever one the loop reached first.
     */
    if (batchPlan && batchPlan.kind === "skip") {
      return batchPlan.reason;
    }

    /*
     * Is the short name already taken by a device outside the selection?
     *
     * `Wildcard` compiles server-side to `ILIKE` over a pattern built by
     * toLikePattern, which escapes the LIKE metacharacters `%` and `_`, and
     * the name is passed through escapeWildcards first so any `*`, `?` or
     * `\` in it is a literal too. That makes this a case-insensitive EXACT
     * match — the same comparison the create-time uniqueness check makes
     * (`LOWER(name) = ...`), which a plain string (case-sensitive equality)
     * or `Search` (a substring match) would not be.
     *
     * Two rows at most: the device itself cannot match (its current name is
     * the long one), so the first row that is not this device is the
     * conflict, and one is all the message needs. Archived devices count, as
     * they do at create time — an archived device can be restored.
     */
    const projectId: ObjectID | null =
      device.projectId || ProjectUtil.getCurrentProjectId();

    const query: Query<NetworkDevice> = {
      name: new Wildcard<string>(escapeWildcards(plan.newName)),
    };

    if (projectId) {
      query.projectId = projectId;
    }

    const existing: ListResult<NetworkDevice> =
      await ModelAPI.getList<NetworkDevice>({
        modelType: NetworkDevice,
        query: query,
        limit: 2,
        skip: 0,
        select: {
          _id: true,
          name: true,
        },
        sort: {},
      });

    const conflictingDevice: NetworkDevice | undefined = existing.data.find(
      (other: NetworkDevice): boolean => {
        return other._id?.toString() !== itemId.toString();
      },
    );

    if (conflictingDevice) {
      return buildNameTakenMessage({
        newName: plan.newName,
        existingDeviceName: conflictingDevice.name || plan.newName,
      });
    }

    /*
     * The name, and the DNS name only when the plan keeps one. Sending
     * `dnsName: undefined` would still name the column in the request, and a
     * column this action did not mean to write is not one it should be
     * seen writing.
     */
    const updateData: JSONObject = {
      name: plan.newName,
    };

    if (plan.dnsName) {
      updateData["dnsName"] = plan.dnsName;
    }

    await ModelAPI.updateById<NetworkDevice>({
      id: itemId,
      modelType: NetworkDevice,
      data: updateData,
    });

    return null;
  };

  /*
   * The per-item loop, run straight out of the confirm dialog. Takes the
   * action props explicitly, like the other confirm-only actions: there is no
   * modal state to read them from.
   */
  type ShortenDevicesFunction = (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
  ) => Promise<void>;

  const shortenDevices: ShortenDevicesFunction = async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      actionProps;

    onBulkActionStart();

    const totalItems: Array<NetworkDevice> = [...items];
    const inProgressItems: Array<NetworkDevice> = [...items];
    const successItems: Array<NetworkDevice> = [];
    const failedItems: Array<BulkActionFailed<NetworkDevice>> = [];

    /*
     * Planned once over the rows, and paired with them by position — the
     * planner returns one plan per device, in order — so a selection holding
     * the same id twice, or an item with no id, cannot pick up another
     * device's plan.
     */
    const batchPlans: Array<ShortDeviceNamePlan> = planShortDeviceNames(
      totalItems.map(toShortenableDevice),
    );

    for (let index: number = 0; index < totalItems.length; index++) {
      const item: NetworkDevice = totalItems[index]!;

      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        const skippedMessage: string | null = await shortenOne(
          item,
          batchPlans[index],
        );

        if (skippedMessage) {
          failedItems.push({
            item: item,
            failedMessage: skippedMessage,
          });
        } else {
          successItems.push(item);
        }
      } catch (err) {
        failedItems.push({
          item: item,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
  };

  /*
   * Bulk actions are handed straight to the table's action bar, which never
   * checks permissions — so a viewer could otherwise rename every device they
   * had selected. This is an update of the records it touches.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ) => BulkActionButtonSchema<NetworkDevice>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ): BulkActionButtonSchema<NetworkDevice> => {
    /*
     * Same rule as the other bulk hooks: "not allowed, and nothing honest to
     * say" (the permission snapshot is still loading) leaves the action alone
     * rather than accusing the user of a permission they may hold.
     */
    if (updateGate.isAllowed || !updateGate.disabledReason) {
      return action;
    }

    return {
      ...action,
      disabled: true,
      tooltip: updateGate.disabledReason,
    };
  };

  /*
   * Offered when at least one selected device has a name that could be
   * shortened on its own. A selection of "Core Switch" and "10.0.0.5" would
   * only ever produce a list of "Skipped" rows, so the action is withheld from
   * it. A selection whose only shortenable devices collide with each other
   * keeps it: that is a real outcome the operator should be told about, not a
   * button that silently vanishes. An empty selection reads as visible, the
   * convention every bulk-action hook here follows.
   */
  type HasShortenableDeviceFunction = (items: Array<NetworkDevice>) => boolean;

  const hasShortenableDevice: HasShortenableDeviceFunction = (
    items: Array<NetworkDevice>,
  ): boolean => {
    if (items.length === 0) {
      return true;
    }

    return items.some((item: NetworkDevice): boolean => {
      return planShortDeviceName(toShortenableDevice(item)).kind === "rename";
    });
  };

  const shortenDeviceNamesAction: BulkActionButtonSchema<NetworkDevice> = {
    title: SHORTEN_DEVICE_NAMES_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Scissors,
    isVisible: hasShortenableDevice,
    confirmTitle: (items: Array<NetworkDevice>): string => {
      return `Shorten the ${
        items.length === 1
          ? "name of 1 device"
          : `names of ${items.length} devices`
      } to the hostname?`;
    },
    confirmMessage: (items: Array<NetworkDevice>): string => {
      return buildShortenDeviceNamesConfirmMessage(items);
    },
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      await shortenDevices(actionProps);
    },
  };

  return {
    bulkActions: [gateAction(shortenDeviceNamesAction)],
  };
}

export default useBulkShortenDeviceNames;
