import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";

/*
 * Which of a cloud's flavors, images and networks a signed test boot asks for, chosen from
 * its own inventory, so the command works as written on most clouds. A choice is only a
 * start: the person running it knows what their credential can reach, and can change it.
 * Pure, so a test can read every choice. React-free, as the guides are.
 */

const GIB: number = 1024 * 1024 * 1024;

/*
 * The smallest flavor that has a disk of its own: one with none asks for a boot from a
 * volume, and a test boot should need nothing else.
 */
export function chooseOpenStackTraceFlavor(
  rows: ReadonlyArray<OpenStackResource>,
): string | null {
  const named: Array<OpenStackResource> = rows.filter(
    (row: OpenStackResource): boolean => {
      return Boolean(row.name);
    },
  );
  const withDisk: Array<OpenStackResource> = named.filter(
    (row: OpenStackResource): boolean => {
      return (row.diskCapacityBytes || 0) >= GIB;
    },
  );
  const candidates: Array<OpenStackResource> =
    withDisk.length > 0 ? withDisk : named;
  const sorted: Array<OpenStackResource> = [...candidates].sort(
    (a: OpenStackResource, b: OpenStackResource): number => {
      return (
        (a.memoryCapacityBytes || 0) - (b.memoryCapacityBytes || 0) ||
        (a.vcpuCapacity || 0) - (b.vcpuCapacity || 0) ||
        (a.diskCapacityBytes || 0) - (b.diskCapacityBytes || 0)
      );
    },
  );

  return sorted[0]?.name || null;
}

/*
 * An image that can boot, and the small test image most clouds keep if there is one, because
 * a boot's time should not be spent copying a big one.
 */
export function chooseOpenStackTraceImage(
  rows: ReadonlyArray<OpenStackResource>,
): string | null {
  const active: Array<OpenStackResource> = rows.filter(
    (row: OpenStackResource): boolean => {
      return Boolean(row.name) && (row.status || "").toLowerCase() === "active";
    },
  );
  const test: OpenStackResource | undefined = active.find(
    (row: OpenStackResource): boolean => {
      return (row.name || "").toLowerCase().includes("cirros");
    },
  );

  return (test || active[0])?.name || null;
}

// The names clouds usually give the network instances cannot be plugged into directly.
const EXTERNAL_NETWORK_WORDS: ReadonlyArray<string> = [
  "public",
  "external",
  "ext-net",
  "provider",
];

/*
 * A network an instance can be plugged into. What a row says does not include whether it is
 * external, so a name that says so is passed over if another is there. By name when one
 * network has it, or else by id, because admin credentials see every project's "private".
 */
export function chooseOpenStackTraceNetwork(
  rows: ReadonlyArray<OpenStackResource>,
): string | null {
  const named: Array<OpenStackResource> = rows.filter(
    (row: OpenStackResource): boolean => {
      return Boolean(row.name) && Boolean(row.externalId);
    },
  );
  const internal: Array<OpenStackResource> = named.filter(
    (row: OpenStackResource): boolean => {
      const name: string = (row.name || "").toLowerCase();

      return !EXTERNAL_NETWORK_WORDS.some((word: string): boolean => {
        return name.includes(word);
      });
    },
  );
  const chosen: OpenStackResource | undefined = internal[0] || named[0];

  if (!chosen) {
    return null;
  }

  const sharesItsName: boolean =
    named.filter((row: OpenStackResource): boolean => {
      return row.name === chosen.name;
    }).length > 1;

  return sharesItsName ? chosen.externalId! : chosen.name!;
}
