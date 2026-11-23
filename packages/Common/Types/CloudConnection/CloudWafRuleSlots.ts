import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../SecurityBlocklist/SecurityBlock";
import {
  getAwsExternalIdForProject,
  getAwsExternalIdSuffix,
} from "./CloudConnectionSetupCommands";

/*
 * THE BLOCKLIST HELD IN RULES OF A CLOUD WAF POLICY (#10348, #10349).
 *
 * Azure WAF's custom rules and Google Cloud Armor's basic rules hold their
 * addresses themselves - there is no list for a rule to reference, as AWS
 * WAF's IP sets and Cloudflare's lists are - and each holds only so many:
 * an Azure match condition 540 or 600 ranges, a Cloud Armor rule 10. So the
 * blocklist is spread over rules of OneUptime's own in the policy, its
 * "slots": OneUptimeBlock1, 2, ... each at a priority of its own, each
 * holding as many addresses as its kind of rule takes.
 *
 *   - What a pass removes is taken out of every slot that holds it.
 *   - What it adds goes into the slots there are, the lowest number first,
 *     then into new slots at the lowest free priorities, up to the most
 *     slots OneUptime takes of a policy, so the customer keeps room for
 *     rules of their own. The oldest blocks are added first: a policy that
 *     is full turns away the newest.
 *   - A slot someone turned off or changed by hand (isFrozen) takes nothing
 *     new: OneUptime never puts it back behind their back (Put It Back
 *     does). What it holds is still taken out when its block ends.
 *   - A slot that holds nothing any more is deleted: neither cloud keeps a
 *     rule that matches nothing.
 *
 * Free priorities are the ones no rule takes, lowest first, before the
 * customer's first rule that lets a request through (an Allow rule): a
 * rule evaluated before OneUptime's that allows a request would let a
 * blocked address in. A rule of theirs that blocks, logs or challenges may
 * come first - it lets nothing through that OneUptime's would stop.
 * OneUptime never renumbers a rule of the customer's: with no priority
 * free, a block that needs a new slot is not applied, and says why.
 *
 * Pure, so the rules are pinned in plain tests.
 */

// One of OneUptime's rules in a policy, as a pass reads and writes it.
export interface CloudWafValueSlot {
  // OneUptime's number for it: OneUptimeBlock<index>.
  index: number;
  priority: number;
  // What it holds, as blocks write values: "35.205.11.131", "35.205.11.0/24".
  values: Array<string>;
  // Turned off or changed by hand: it takes nothing new until it is put back.
  isFrozen: boolean;
}

// Why an address a pass was asked to add is not in a slot.
export enum CloudWafSlotRefusal {
  // Every slot OneUptime may take is full.
  Full = "full",
  // A new slot is needed and no priority is free before the customer's first Allow rule.
  NoFreePriority = "noFreePriority",
}

export interface CloudWafSlotAddition {
  value: string;
  isDone: boolean;
  // The slot that holds it, when it is held.
  slotIndex?: number | undefined;
  refusal?: CloudWafSlotRefusal | undefined;
}

export interface CloudWafSlotPlan {
  // Every slot as it is to be: changed, new and untouched, emptied ones left out.
  slots: Array<CloudWafValueSlot>;
  // The slots there were whose values changed (and that still hold something).
  changed: Array<CloudWafValueSlot>;
  // The new slots.
  created: Array<CloudWafValueSlot>;
  // The slots there were that hold nothing now: to take out of the policy.
  emptied: Array<CloudWafValueSlot>;
  // What became of each address asked for, in the order asked.
  added: Array<CloudWafSlotAddition>;
  // Whether anything differs from the slots there were.
  isChanged: boolean;
}

// An address's key, as blocks are matched: "35.205.11.131/32" is 35.205.11.131.
export function getCloudWafValueKey(value: string): string {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  return read ? read.value : (value || "").trim().toLowerCase();
}

/*
 * The free priorities of a policy, lowest first: in [lowest, highest], not
 * taken by any rule, and before the first rule that lets a request through
 * (passPriority) when there is one.
 */
export function getCloudWafFreePriorities(data: {
  usedPriorities: ReadonlyArray<number>;
  passPriority: number | null;
  lowest: number;
  highest: number;
  // The most to list: a pass never needs more than the slots it may still make.
  limit: number;
}): Array<number> {
  const used: Set<number> = new Set(data.usedPriorities);
  const last: number =
    data.passPriority === null
      ? data.highest
      : Math.min(data.highest, data.passPriority - 1);
  const free: Array<number> = [];

  for (
    let priority: number = data.lowest;
    priority <= last && free.length < data.limit;
    priority++
  ) {
    if (!used.has(priority)) {
      free.push(priority);
    }
  }

  return free;
}

/*
 * The plan for a pass: the slots with what is removed taken out, what is
 * added put in - existing slots first, then new ones at the free
 * priorities - and what became of each address.
 */
export function planCloudWafValueSlots(data: {
  slots: ReadonlyArray<CloudWafValueSlot>;
  // The oldest first.
  add: ReadonlyArray<string>;
  remove: ReadonlyArray<string>;
  // How many addresses one slot holds.
  perSlot: number;
  // The most slots OneUptime takes of the policy, those there are included.
  maxSlots: number;
  // For new slots, lowest first.
  freePriorities: ReadonlyArray<number>;
  // The lowest number a new slot may take: one past any OneUptime used before.
  nextIndex?: number | undefined;
}): CloudWafSlotPlan {
  const removing: Set<string> = new Set(data.remove.map(getCloudWafValueKey));
  const working: Array<CloudWafValueSlot> = data.slots
    .map((slot: CloudWafValueSlot): CloudWafValueSlot => {
      return {
        index: slot.index,
        priority: slot.priority,
        values: slot.values.filter((value: string): boolean => {
          return !removing.has(getCloudWafValueKey(value));
        }),
        isFrozen: slot.isFrozen,
      };
    })
    .sort((a: CloudWafValueSlot, b: CloudWafValueSlot): number => {
      return a.index - b.index;
    });

  const held: Map<string, number> = new Map();

  for (const slot of working) {
    for (const value of slot.values) {
      held.set(getCloudWafValueKey(value), slot.index);
    }
  }

  const created: Array<CloudWafValueSlot> = [];
  const free: Array<number> = [...data.freePriorities];
  let nextIndex: number = Math.max(
    data.nextIndex || 1,
    ...working.map((slot: CloudWafValueSlot): number => {
      return slot.index + 1;
    }),
    1,
  );
  const added: Array<CloudWafSlotAddition> = [];

  for (const value of data.add) {
    const key: string = getCloudWafValueKey(value);
    const holder: number | undefined = held.get(key);

    if (holder !== undefined) {
      added.push({ value, isDone: true, slotIndex: holder });
      continue;
    }

    let slot: CloudWafValueSlot | undefined = working.find(
      (candidate: CloudWafValueSlot): boolean => {
        return !candidate.isFrozen && candidate.values.length < data.perSlot;
      },
    );

    if (!slot) {
      const slots: number = working.filter(
        (candidate: CloudWafValueSlot): boolean => {
          return candidate.values.length > 0 || !candidate.isFrozen;
        },
      ).length;

      if (slots >= data.maxSlots) {
        added.push({
          value,
          isDone: false,
          refusal: CloudWafSlotRefusal.Full,
        });
        continue;
      }

      const priority: number | undefined = free.shift();

      if (priority === undefined) {
        added.push({
          value,
          isDone: false,
          refusal: CloudWafSlotRefusal.NoFreePriority,
        });
        continue;
      }

      slot = { index: nextIndex, priority, values: [], isFrozen: false };
      nextIndex++;
      working.push(slot);
      created.push(slot);
    }

    slot.values.push(value);
    held.set(key, slot.index);
    added.push({ value, isDone: true, slotIndex: slot.index });
  }

  const before: Map<number, CloudWafValueSlot> = new Map(
    data.slots.map((slot: CloudWafValueSlot): [number, CloudWafValueSlot] => {
      return [slot.index, slot];
    }),
  );
  const sameValues: (a: Array<string>, b: Array<string>) => boolean = (
    a: Array<string>,
    b: Array<string>,
  ): boolean => {
    return (
      a.length === b.length &&
      a.every((value: string, index: number): boolean => {
        return getCloudWafValueKey(value) === getCloudWafValueKey(b[index]!);
      })
    );
  };

  const slots: Array<CloudWafValueSlot> = [];
  const changed: Array<CloudWafValueSlot> = [];
  const emptied: Array<CloudWafValueSlot> = [];

  for (const slot of working) {
    const was: CloudWafValueSlot | undefined = before.get(slot.index);

    if (slot.values.length === 0) {
      // A slot there was that holds nothing now - or held nothing before either - goes.
      if (was) {
        emptied.push(was);
      }

      continue;
    }

    slots.push(slot);

    if (was && !sameValues(was.values, slot.values)) {
      changed.push(slot);
    }
  }

  return {
    slots,
    changed,
    created: created.filter((slot: CloudWafValueSlot): boolean => {
      return slot.values.length > 0;
    }),
    emptied,
    added,
    isChanged:
      changed.length > 0 ||
      emptied.length > 0 ||
      created.some((slot: CloudWafValueSlot): boolean => {
        return slot.values.length > 0;
      }),
  };
}

/*
 * What tells one project's rules in a cloud WAF policy from another's: the
 * first eight hexadecimal digits of its external id, as its AWS role and
 * its AWS WAF IP sets carry them ("oneuptime-1a2b3c4d-block-ipv4"). Two
 * OneUptime projects that pick one policy each keep rules of their own:
 * each project's reconciler rewrites its own rules whole, and would
 * otherwise take the other's blocks out.
 */
export function getCloudWafProjectSuffix(projectId: string): string {
  return getAwsExternalIdSuffix(getAwsExternalIdForProject(projectId));
}
