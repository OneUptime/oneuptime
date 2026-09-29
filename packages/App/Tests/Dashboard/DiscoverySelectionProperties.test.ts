import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostCounts,
  DiscoveredHostFilter,
  ShownDiscoveredHost,
  areAllShownHostsSelected,
  countDiscoveredHosts,
  countSelectableShownHosts,
  filterDiscoveredHosts,
  getDiscoveredHostsToImport,
  getInitialSelection,
  getShownDiscoveredHosts,
  isSelectableDiscoveredHost,
  markDiscoveredHostsAsRegistered,
  toggleSelectionForShownHosts,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";

/*
 * WHY THIS FILE EXISTS
 *
 * DiscoveredHostFilter.test.ts pins the SNMP / No SNMP filter (#3322) against
 * hand-written scans: five hosts, one of each interesting shape, chosen by
 * someone who already knew which shapes were interesting. That catches the bugs
 * somebody thought of.
 *
 * The bugs that reach an operator are the combinations nobody thought of — a
 * blank address that is also duplicated, a legacy row that is also
 * already-registered, one address appearing once as an SNMP responder and again
 * as a ping-only row (`discoveredDevices` is jsonb written straight from the
 * probe's payload, so nothing forbids it). At the size the issue reports —
 * 2,866 SNMP hosts and 2,890 ping-only ones in a single scan — every rare shape
 * is present many times over, and a rule that only holds for tidy input is a
 * rule that does not hold.
 *
 * So this file asserts LAWS rather than examples, over a few hundred generated
 * scans: the two groups partition the scan, each badge equals the list under it,
 * Import is always a subset of what is on screen, a tick never removes a device,
 * "select all" is a per-group flip, and a row's React key does not move when the
 * filter does. The corpus — not the author's imagination — decides which
 * combinations get tested.
 *
 * DETERMINISM IS NOT OPTIONAL HERE. Math.random() would surface a counterexample
 * once in CI and never again, which is worse than not testing: it costs the
 * reader's trust and hands them nothing to debug. The generator below is a
 * seeded LCG driven by a fixed seed table, so the corpus is identical on every
 * machine and every run, and a failure prints the seed and the exact scan.
 */

/*
 * A 32-bit linear congruential generator (Numerical Recipes constants).
 *
 * Deliberately tiny and self-contained: the point is a reproducible byte
 * stream, not statistical quality, and taking a PRNG dependency for a test
 * corpus would be a worse trade than eight lines of arithmetic.
 */
class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    // Unsigned, and never zero — a zero seed still advances, but reads badly.
    this.state = seed >>> 0 || 1;
  }

  public nextUint32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;

    return this.state;
  }

  /** An integer in [0, bound). Callers never pass 0. */
  public nextInt(bound: number): number {
    return this.nextUint32() % bound;
  }

  public chance(percent: number): boolean {
    return this.nextInt(100) < percent;
  }

  public pick<T>(values: Array<T>): T {
    /*
     * `as T` rather than `!` because the value arrays deliberately contain
     * `undefined` — that is the legacy `snmpReachable` — and `!` would strip it
     * out of the type and therefore out of the corpus.
     */
    return values[this.nextInt(values.length)] as T;
  }
}

/*
 * Fixed seeds. Changing this table changes the corpus, which is exactly why it
 * is a table and not a clock: a failure quotes its seed, and re-running the file
 * reproduces that scan byte for byte.
 */
const SEEDS: Array<number> = [
  1, 7, 42, 1337, 3322, 90210, 20260821, 4294967291,
];

const SCANS_PER_SEED: number = 45;

const FILTERS: Array<DiscoveredHostFilter> = [
  DiscoveredHostFilter.All,
  DiscoveredHostFilter.Snmp,
  DiscoveredHostFilter.NoSnmp,
];

/*
 * An address that is deliberately absent from every generated scan: a selection
 * can outlive the hosts it was made against, and a stale key must not conjure
 * an import out of nothing.
 */
const FOREIGN_ADDRESS: string = "192.168.254.254";

/** One generated case: a scan plus the tick state the operator is holding. */
interface GeneratedScan {
  seed: number;
  index: number;
  hosts: Array<DiscoveredNetworkDevice>;
  selection: Record<string, boolean>;
}

function addressesOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return hosts.map((host: DiscoveredNetworkDevice) => {
    return host.ipAddress;
  });
}

/*
 * Addresses are unique per row unless the generator deliberately repeats one, so
 * two rows sharing an address always do so on purpose and object identity stays
 * a usable way to tell rows apart in the laws below.
 */
function nextIpAddress(data: {
  random: SeededRandom;
  index: number;
  addressesSoFar: Array<string>;
}): string {
  /*
   * A blank address is a real row shape: the probe can report a host it could
   * not name, and the address is both the checkbox key and the imported
   * device's hostname, so blanks have to fall out of selection everywhere.
   */
  if (data.random.chance(8)) {
    return "";
  }

  /*
   * A repeated address is the shape that breaks naive code: one checkbox
   * governs every row carrying it, so a single tick can span both groups.
   */
  if (data.addressesSoFar.length > 0 && data.random.chance(22)) {
    return data.random.pick(data.addressesSoFar);
  }

  return `10.7.${Math.floor(data.index / 256)}.${data.index % 256}`;
}

function generateHosts(random: SeededRandom): Array<DiscoveredNetworkDevice> {
  // Includes 0, because an empty scan is a state the dialog actually ships in.
  const size: number = random.nextInt(26);

  const hosts: Array<DiscoveredNetworkDevice> = [];
  const addressesSoFar: Array<string> = [];

  for (let index: number = 0; index < size; index++) {
    const ipAddress: string = nextIpAddress({
      random: random,
      index: index,
      addressesSoFar: addressesSoFar,
    });

    if (ipAddress !== "") {
      addressesSoFar.push(ipAddress);
    }

    hosts.push({
      ipAddress: ipAddress,
      sysName: random.chance(50) ? `host-${index}` : undefined,
      /*
       * `undefined` is the legacy row, written before ping-only sweeps existed,
       * and has to read as SNMP everywhere. Generating it as often as the other
       * two keeps it out of the "rare shape nobody covered" category.
       */
      snmpReachable: random.pick<boolean | undefined>([true, false, undefined]),
      isAlreadyRegistered: random.pick<boolean | undefined>([
        true,
        false,
        undefined,
        undefined,
      ]),
    });
  }

  return hosts;
}

/*
 * The tick state, drawn from the states the dialog actually reaches: the
 * pre-checked opening selection, nothing ticked, one group cleared with the
 * bulk control, and arbitrary hand-ticking (including a key for an address that
 * is not in this scan at all).
 */
function generateSelection(data: {
  random: SeededRandom;
  hosts: Array<DiscoveredNetworkDevice>;
}): Record<string, boolean> {
  const mode: number = data.random.nextInt(10);

  if (mode <= 2) {
    return getInitialSelection(data.hosts);
  }

  if (mode === 3) {
    return {};
  }

  if (mode === 4 || mode === 5) {
    return toggleSelectionForShownHosts({
      hosts: data.hosts,
      filter:
        mode === 4 ? DiscoveredHostFilter.Snmp : DiscoveredHostFilter.NoSnmp,
      selectedIpAddresses: getInitialSelection(data.hosts),
    });
  }

  const selection: Record<string, boolean> = {};

  const candidates: Array<string> = [
    ...new Set<string>(addressesOf(data.hosts)),
    FOREIGN_ADDRESS,
  ];

  candidates.forEach((address: string): void => {
    const roll: number = data.random.nextInt(10);

    if (roll < 5) {
      selection[address] = true;
    } else if (roll < 8) {
      selection[address] = false;
    }
  });

  return selection;
}

function buildCorpus(): Array<GeneratedScan> {
  const corpus: Array<GeneratedScan> = [];

  SEEDS.forEach((seed: number): void => {
    const random: SeededRandom = new SeededRandom(seed);

    for (let index: number = 0; index < SCANS_PER_SEED; index++) {
      const hosts: Array<DiscoveredNetworkDevice> = generateHosts(random);

      corpus.push({
        seed: seed,
        index: index,
        hosts: hosts,
        selection: generateSelection({ random: random, hosts: hosts }),
      });
    }
  });

  return corpus;
}

/*
 * Built once. Every law runs over the same corpus, so a scan that breaks one of
 * them can be read against the others.
 */
const CORPUS: Array<GeneratedScan> = buildCorpus();

/*
 * Small comparison helpers, so one scan can cost one assertion instead of one
 * assertion per row — at this corpus size that is the difference between a
 * two-minute suite and a five-second one.
 */
function sameRows(
  left: Array<DiscoveredNetworkDevice>,
  right: Array<DiscoveredNetworkDevice>,
): boolean {
  return (
    left.length === right.length &&
    left.every((host: DiscoveredNetworkDevice, position: number) => {
      // Identity, not equality: duplicate rows can be value-identical.
      return host === right[position];
    })
  );
}

function sameStrings(left: Array<string>, right: Array<string>): boolean {
  return (
    left.length === right.length &&
    left.every((value: string, position: number) => {
      return value === right[position];
    })
  );
}

/** A selection compared by content, key order ignored. */
function selectionSignature(selection: Record<string, boolean>): string {
  return Object.keys(selection)
    .sort()
    .map((key: string) => {
      return `${key}=${String(selection[key])}`;
    })
    .join(",");
}

function importAddresses(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
  selectedIpAddresses: Record<string, boolean>;
}): Array<string> {
  return addressesOf(getDiscoveredHostsToImport(data));
}

/** The addresses one group offers a checkbox for. */
function selectableAddressesShown(data: {
  hosts: Array<DiscoveredNetworkDevice>;
  filter: DiscoveredHostFilter;
}): Set<string> {
  const addresses: Set<string> = new Set<string>();

  filterDiscoveredHosts(data).forEach((host: DiscoveredNetworkDevice): void => {
    if (isSelectableDiscoveredHost(host)) {
      addresses.add(host.ipAddress);
    }
  });

  return addresses;
}

/*
 * Only the first few counterexamples are described in full. Beyond that the
 * scans stop being evidence and start being noise, and rendering hundreds of
 * them costs more than the law did.
 */
const MAX_REPORTED_VIOLATIONS: number = 4;

/*
 * Runs one law over every generated scan and returns the counterexamples.
 *
 * Each one carries the seed and the exact scan. Without that, a broken law
 * reports "expected true, received false" about a scan the reader cannot see
 * and cannot reproduce — which is how property suites end up deleted rather
 * than debugged. With it, the failure names the seed (re-run the file, get the
 * same corpus), the scan's index within that seed, and the hosts and ticks
 * involved.
 */
function findViolations(
  check: (scan: GeneratedScan, report: (problem: string) => void) => void,
): Array<string> {
  const described: Array<string> = [];
  let total: number = 0;

  CORPUS.forEach((scan: GeneratedScan): void => {
    check(scan, (problem: string): void => {
      total = total + 1;

      if (described.length < MAX_REPORTED_VIOLATIONS) {
        described.push(
          [
            problem,
            `  seed=${scan.seed} scan=#${scan.index}`,
            `  hosts=${JSON.stringify(scan.hosts)}`,
            `  selection=${JSON.stringify(scan.selection)}`,
          ].join("\n"),
        );
      }
    });
  });

  if (total > described.length) {
    described.push(`...and ${total - described.length} more counterexamples`);
  }

  return described;
}

describe("the SNMP / No SNMP split, over every generated scan", () => {
  test("the two groups partition the scan — never both, never neither, order kept", () => {
    /*
     * A host that could land in both groups would be imported twice by an
     * operator working group by group; one that could land in neither would be
     * invisible under every filter while still being counted by All. Both
     * render perfectly.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const snmp: Array<DiscoveredNetworkDevice> = filterDiscoveredHosts({
            hosts: scan.hosts,
            filter: DiscoveredHostFilter.Snmp,
          });
          const noSnmp: Array<DiscoveredNetworkDevice> = filterDiscoveredHosts({
            hosts: scan.hosts,
            filter: DiscoveredHostFilter.NoSnmp,
          });

          // Disjoint, by row identity rather than by address: duplicates exist.
          const inBoth: Array<DiscoveredNetworkDevice> = snmp.filter(
            (host: DiscoveredNetworkDevice) => {
              return noSnmp.includes(host);
            },
          );

          if (inBoth.length > 0) {
            report(
              `PARTITION: ${inBoth.length} row(s) are in both the SNMP and No SNMP groups`,
            );
          }

          if (snmp.length + noSnmp.length !== scan.hosts.length) {
            report(
              `PARTITION: groups hold ${snmp.length}+${noSnmp.length} rows but the scan has ${scan.hosts.length}`,
            );
          }

          // Each group keeps the probe's order, and together they are the scan.
          if (
            !sameRows(
              scan.hosts.filter((host: DiscoveredNetworkDevice) => {
                return snmp.includes(host);
              }),
              snmp,
            )
          ) {
            report("PARTITION: the SNMP group is not the scan's own order");
          }

          if (
            !sameRows(
              scan.hosts.filter((host: DiscoveredNetworkDevice) => {
                return noSnmp.includes(host);
              }),
              noSnmp,
            )
          ) {
            report("PARTITION: the No SNMP group is not the scan's own order");
          }

          if (
            !sameRows(
              filterDiscoveredHosts({
                hosts: scan.hosts,
                filter: DiscoveredHostFilter.All,
              }),
              scan.hosts,
            )
          ) {
            report("PARTITION: All is not the scan itself");
          }
        },
      ),
    ).toEqual([]);
  });

  test("every badge equals the length of the list it filters to", () => {
    /*
     * The badge is what an operator checks against the probe's own ICMP/SNMP
     * tallies before trusting the dialog at all. A badge computed from a
     * different predicate than the list underneath it is what makes them stop.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const counts: DiscoveredHostCounts = countDiscoveredHosts(scan.hosts);

          if (counts.all !== scan.hosts.length) {
            report(
              `COUNTS: all badge reads ${counts.all} for ${scan.hosts.length} rows`,
            );
          }

          if (counts.snmp + counts.noSnmp !== counts.all) {
            report(
              `COUNTS: ${counts.snmp}+${counts.noSnmp} does not add up to ${counts.all}`,
            );
          }

          const shownSnmp: number = filterDiscoveredHosts({
            hosts: scan.hosts,
            filter: DiscoveredHostFilter.Snmp,
          }).length;
          const shownNoSnmp: number = filterDiscoveredHosts({
            hosts: scan.hosts,
            filter: DiscoveredHostFilter.NoSnmp,
          }).length;

          if (counts.snmp !== shownSnmp) {
            report(
              `COUNTS: SNMP badge reads ${counts.snmp} but the group shows ${shownSnmp}`,
            );
          }

          if (counts.noSnmp !== shownNoSnmp) {
            report(
              `COUNTS: No SNMP badge reads ${counts.noSnmp} but the group shows ${shownNoSnmp}`,
            );
          }
        },
      ),
    ).toEqual([]);
  });

  test("the rows rendered are the rows filtered, each pointing back at its own place in the scan", () => {
    /*
     * `scanIndex` is what the React key is built from. If it ever stopped
     * indexing the UNFILTERED array, the key would change on a filter click,
     * React would remount the row, and CheckboxElement — which seeds itself
     * from `initialValue` and only reconciles in a passive effect — would paint
     * it unchecked for a frame. Strictly increasing is the other half of the
     * same guarantee: two rows sharing an index would share a key.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const shown: Array<ShownDiscoveredHost> = getShownDiscoveredHosts({
              hosts: scan.hosts,
              filter: filter,
            });
            const filtered: Array<DiscoveredNetworkDevice> =
              filterDiscoveredHosts({ hosts: scan.hosts, filter: filter });

            if (
              !sameRows(
                shown.map((row: ShownDiscoveredHost) => {
                  return row.host;
                }),
                filtered,
              )
            ) {
              report(
                `SHOWN ROWS: ${filter} renders different rows than it filters to`,
              );
            }

            const misindexed: Array<ShownDiscoveredHost> = shown.filter(
              (row: ShownDiscoveredHost) => {
                return scan.hosts[row.scanIndex] !== row.host;
              },
            );

            if (misindexed.length > 0) {
              report(
                `SHOWN ROWS: ${filter} carries ${misindexed.length} scanIndex value(s) that do not point back at their own row`,
              );
            }

            const outOfOrder: Array<ShownDiscoveredHost> = shown.filter(
              (row: ShownDiscoveredHost, position: number) => {
                return (
                  position > 0 &&
                  row.scanIndex <= shown[position - 1]!.scanIndex
                );
              },
            );

            if (outOfOrder.length > 0) {
              report(
                `SHOWN ROWS: ${filter} scanIndex sequence is not strictly increasing`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });

  test("a row's key is the same under All as under its own group", () => {
    /*
     * Stability stated directly: the (address, scanIndex) pair a row is keyed
     * by must not depend on which filter is active, or every row remounts on
     * every filter change and the whole selection appears to blank out and snap
     * back — in a dialog whose only job is deciding what is ticked.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const keyUnderAll: Map<DiscoveredNetworkDevice, string> = new Map<
            DiscoveredNetworkDevice,
            string
          >();

          getShownDiscoveredHosts({
            hosts: scan.hosts,
            filter: DiscoveredHostFilter.All,
          }).forEach((row: ShownDiscoveredHost): void => {
            keyUnderAll.set(row.host, `${row.host.ipAddress}-${row.scanIndex}`);
          });

          [DiscoveredHostFilter.Snmp, DiscoveredHostFilter.NoSnmp].forEach(
            (filter: DiscoveredHostFilter): void => {
              getShownDiscoveredHosts({
                hosts: scan.hosts,
                filter: filter,
              }).forEach((row: ShownDiscoveredHost): void => {
                const groupKey: string = `${row.host.ipAddress}-${row.scanIndex}`;

                if (groupKey !== keyUnderAll.get(row.host)) {
                  report(
                    `KEY STABILITY: a row keyed ${String(
                      keyUnderAll.get(row.host),
                    )} under All is keyed ${groupKey} under ${filter}`,
                  );
                }
              });
            },
          );
        },
      ),
    ).toEqual([]);
  });
});

describe("what pressing Import can possibly do, over every generated scan", () => {
  test("the import list is always a deduplicated, ticked, selectable subset of what is on screen", () => {
    /*
     * The expensive failure in #3322 lives here: the dialog opens fully
     * pre-checked, so anything that lets Import reach past the active filter
     * creates the thousands of devices the operator just filtered away — and
     * the dialog still says it worked. Being a SUBSEQUENCE rather than merely a
     * subset also pins that the import runs in scan order, and uniqueness pins
     * that one checkbox creates one device however many rows the probe reported
     * for that address.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const shown: Array<DiscoveredNetworkDevice> = filterDiscoveredHosts(
              { hosts: scan.hosts, filter: filter },
            );
            const toImport: Array<DiscoveredNetworkDevice> =
              getDiscoveredHostsToImport({
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: scan.selection,
              });

            if (
              !sameRows(
                shown.filter((host: DiscoveredNetworkDevice) => {
                  return toImport.includes(host);
                }),
                toImport,
              )
            ) {
              report(
                `IMPORT SUBSET: ${filter} imports rows that are not the shown rows in shown order`,
              );
            }

            const notSelectable: Array<DiscoveredNetworkDevice> =
              toImport.filter((host: DiscoveredNetworkDevice) => {
                return !isSelectableDiscoveredHost(host);
              });

            if (notSelectable.length > 0) {
              report(
                `IMPORT SUBSET: ${filter} imports ${notSelectable.length} row(s) that have no checkbox`,
              );
            }

            const notTicked: Array<DiscoveredNetworkDevice> = toImport.filter(
              (host: DiscoveredNetworkDevice) => {
                return !scan.selection[host.ipAddress];
              },
            );

            if (notTicked.length > 0) {
              report(
                `IMPORT SUBSET: ${filter} imports ${notTicked.length} row(s) nobody ticked`,
              );
            }

            const addresses: Array<string> = addressesOf(toImport);

            if (new Set<string>(addresses).size !== addresses.length) {
              report(
                `IMPORT SUBSET: ${filter} would create more than one device for the same address`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });

  test("ticking one address only ever adds that address, and unticking it only ever removes it", () => {
    /*
     * Monotonicity. A checkbox is the one control here an operator uses without
     * thinking, so it has to be local: ticking a host must never drop an
     * unrelated device out of the import — silent data loss the dialog still
     * reports as success — and unticking must never pull one in.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const candidates: Array<string> = [
            ...new Set<string>(addressesOf(scan.hosts)),
            FOREIGN_ADDRESS,
          ];

          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const base: Array<string> = importAddresses({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });

            candidates.forEach((address: string): void => {
              const withoutCandidate: Array<string> = base.filter(
                (candidate: string) => {
                  return candidate !== address;
                },
              );

              const ticked: Array<string> = importAddresses({
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: { ...scan.selection, [address]: true },
              });
              const unticked: Array<string> = importAddresses({
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: { ...scan.selection, [address]: false },
              });

              // Ticking adds at most that address and removes nothing.
              if (
                !sameStrings(
                  ticked.filter((candidate: string) => {
                    return candidate !== address;
                  }),
                  withoutCandidate,
                )
              ) {
                report(
                  `MONOTONICITY: ticking ${address || "(blank)"} under ${filter} changed the import list beyond that address`,
                );
              }

              // Unticking removes exactly that address and adds nothing.
              if (!sameStrings(unticked, withoutCandidate)) {
                report(
                  `MONOTONICITY: unticking ${address || "(blank)"} under ${filter} did not leave exactly the rest of the import list`,
                );
              }
            });
          });
        },
      ),
    ).toEqual([]);
  });

  test("the opening selection offers exactly what every group has to offer", () => {
    /*
     * The dialog opens on All with everything pre-checked, and the operator's
     * first move is a filter click. If the pre-check were computed per group,
     * or missed a shape — a legacy row, a duplicate — that first click would
     * land on a group that is not actually full, and the bulk control would
     * read "Select all" over an already-complete list.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const initial: Record<string, boolean> = getInitialSelection(
            scan.hosts,
          );

          const expectedKeys: Array<string> = Array.from(
            selectableAddressesShown({
              hosts: scan.hosts,
              filter: DiscoveredHostFilter.All,
            }),
          ).sort();

          if (!sameStrings(Object.keys(initial).sort(), expectedKeys)) {
            report(
              "INITIAL SELECTION: the opening ticks are not exactly the selectable addresses",
            );
          }

          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const selectable: number = countSelectableShownHosts({
              hosts: scan.hosts,
              filter: filter,
            });

            const offered: number = importAddresses({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: initial,
            }).length;

            if (offered !== selectable) {
              report(
                `INITIAL SELECTION: ${filter} opens offering ${offered} of its ${selectable} selectable hosts`,
              );
            }

            if (
              areAllShownHostsSelected({
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: initial,
              }) !==
              selectable > 0
            ) {
              report(
                `INITIAL SELECTION: ${filter} does not read as fully selected on open`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });

  test("importing a group empties that group and leaves the badges where they were", () => {
    /*
     * Group-by-group importing is the intended flow, and `isAlreadyRegistered`
     * is computed server-side at probe-upload time and then frozen into the
     * jsonb — nothing recomputes it on read — so the page has to overlay what it
     * just imported or those hosts come back pre-checked and Import creates
     * duplicates. The badges must NOT move while that happens: they describe
     * the sweep, not the operator's progress through it.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const badgesBefore: DiscoveredHostCounts = countDiscoveredHosts(
            scan.hosts,
          );

          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const imported: Array<string> = importAddresses({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });

            const marked: Array<DiscoveredNetworkDevice> =
              markDiscoveredHostsAsRegistered({
                hosts: scan.hosts,
                importedIpAddresses: new Set<string>(imported),
              });

            if (marked.length !== scan.hosts.length) {
              report(
                `IMPORT THEN RETIRE: marking ${filter} changed the scan from ${scan.hosts.length} rows to ${marked.length}`,
              );
            }

            const badgesAfter: DiscoveredHostCounts =
              countDiscoveredHosts(marked);

            if (
              badgesAfter.all !== badgesBefore.all ||
              badgesAfter.snmp !== badgesBefore.snmp ||
              badgesAfter.noSnmp !== badgesBefore.noSnmp
            ) {
              report(
                `IMPORT THEN RETIRE: importing ${filter} moved the badges from ${JSON.stringify(badgesBefore)} to ${JSON.stringify(badgesAfter)}`,
              );
            }

            // Pressing Import again on the same group would create nothing.
            const leftOver: Array<string> = importAddresses({
              hosts: marked,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });

            if (leftOver.length > 0) {
              report(
                `IMPORT THEN RETIRE: ${filter} still offers ${leftOver.length} host(s) after importing it`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });
});

describe("the bulk select-all control, over every generated scan", () => {
  test("one press flips whether the group is full, and a group with nothing to tick is left alone", () => {
    /*
     * The control is what replaces "scroll 2,890 rows and uncheck them one at a
     * time", so a press that lands on neither state is the feature not
     * existing. The empty-group case is separate on purpose:
     * `areAllShownHostsSelected` refuses to be vacuously true so the control
     * reads "Select all" and stays disabled rather than offering to clear a
     * selection that is not there — and the press must then be a no-op on the
     * WHOLE selection, not merely on that group.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const selectable: number = countSelectableShownHosts({
              hosts: scan.hosts,
              filter: filter,
            });

            const before: boolean = areAllShownHostsSelected({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });

            const toggled: Record<string, boolean> =
              toggleSelectionForShownHosts({
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: scan.selection,
              });

            const after: boolean = areAllShownHostsSelected({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: toggled,
            });

            if (selectable === 0) {
              if (before || after) {
                report(
                  `SELECT-ALL FLIP: ${filter} has nothing selectable but reads as fully selected`,
                );
              }

              if (
                selectionSignature(toggled) !==
                selectionSignature(scan.selection)
              ) {
                report(
                  `SELECT-ALL FLIP: pressing over an empty ${filter} group changed the selection`,
                );
              }

              return;
            }

            if (after === before) {
              report(
                `SELECT-ALL FLIP: one press left ${filter} reading "${String(before)}" for fully-selected`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });

  test("pressing twice more lands back where the first press did", () => {
    /*
     * The honest shape of "toggle involution": the control is NOT an involution
     * on an arbitrary selection, because the first press normalises a
     * half-ticked group to fully ticked. From there it alternates, so the third
     * press equals the first — exactly, over the WHOLE selection object, which
     * is also how ticks belonging to the group that is NOT on screen are pinned
     * to survive the round trip.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const first: Record<string, boolean> = toggleSelectionForShownHosts(
              {
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: scan.selection,
              },
            );
            const second: Record<string, boolean> =
              toggleSelectionForShownHosts({
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: first,
              });
            const third: Record<string, boolean> = toggleSelectionForShownHosts(
              {
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: second,
              },
            );

            if (selectionSignature(third) !== selectionSignature(first)) {
              report(
                `TOGGLE ALTERNATION: a third press on ${filter} gave ${selectionSignature(third)} where the first gave ${selectionSignature(first)}`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });

  test("two presses leave the group empty, unless it started full", () => {
    /*
     * Where the alternation lands, stated as an import list rather than as a
     * flag. From a partly-ticked group: press one fills it, press two clears
     * it, so the group imports nothing. From a full group it runs the other way
     * and the group comes back complete. Getting this backwards is the "I
     * cleared it and it imported everything anyway" bug.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const startedFull: boolean = areAllShownHostsSelected({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });

            const twice: Record<string, boolean> = toggleSelectionForShownHosts(
              {
                hosts: scan.hosts,
                filter: filter,
                selectedIpAddresses: toggleSelectionForShownHosts({
                  hosts: scan.hosts,
                  filter: filter,
                  selectedIpAddresses: scan.selection,
                }),
              },
            );

            const expectedCount: number = startedFull
              ? countSelectableShownHosts({
                  hosts: scan.hosts,
                  filter: filter,
                })
              : 0;

            const actualCount: number = importAddresses({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: twice,
            }).length;

            if (actualCount !== expectedCount) {
              report(
                `TOGGLE LANDING: two presses on ${filter} (started ${startedFull ? "full" : "not full"}) left ${actualCount} hosts to import, expected ${expectedCount}`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });

  test("clearing one group only ever touches addresses that group offers", () => {
    /*
     * Locality, stated the way the data actually allows. The intended move is
     * "clear the 2,866 SNMP hosts, keep the 2,890 ping-only ones ticked", and
     * the bulk control must not reach outside the group on screen to do it.
     *
     * The caveat is real, and is why this is a restriction rather than plain
     * equality: `discoveredDevices` is jsonb off the probe, so ONE address can
     * appear as an SNMP row and again as a ping-only row, and a single checkbox
     * governs both. Where that happens the other group's import genuinely
     * changes — that is one tick, not two. So the law is that nothing OUTSIDE
     * the pressed group's own addresses moves, and that a scan whose groups
     * share no address sees no change at all.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const pairs: Array<Array<DiscoveredHostFilter>> = [
            [DiscoveredHostFilter.Snmp, DiscoveredHostFilter.NoSnmp],
            [DiscoveredHostFilter.NoSnmp, DiscoveredHostFilter.Snmp],
          ];

          pairs.forEach((pair: Array<DiscoveredHostFilter>): void => {
            const pressed: DiscoveredHostFilter = pair[0]!;
            const other: DiscoveredHostFilter = pair[1]!;

            const touched: Set<string> = selectableAddressesShown({
              hosts: scan.hosts,
              filter: pressed,
            });

            const before: Array<string> = importAddresses({
              hosts: scan.hosts,
              filter: other,
              selectedIpAddresses: scan.selection,
            });
            const after: Array<string> = importAddresses({
              hosts: scan.hosts,
              filter: other,
              selectedIpAddresses: toggleSelectionForShownHosts({
                hosts: scan.hosts,
                filter: pressed,
                selectedIpAddresses: scan.selection,
              }),
            });

            const untouchedBefore: Array<string> = before.filter(
              (address: string) => {
                return !touched.has(address);
              },
            );
            const untouchedAfter: Array<string> = after.filter(
              (address: string) => {
                return !touched.has(address);
              },
            );

            if (!sameStrings(untouchedAfter, untouchedBefore)) {
              report(
                `TOGGLE LOCALITY: pressing ${pressed} changed ${other} hosts it does not even show`,
              );
            }

            const sharesAnAddress: boolean = Array.from(
              selectableAddressesShown({ hosts: scan.hosts, filter: other }),
            ).some((address: string) => {
              return touched.has(address);
            });

            if (!sharesAnAddress && !sameStrings(after, before)) {
              report(
                `TOGGLE LOCALITY: pressing ${pressed} changed the ${other} import list even though the groups share no address`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });

  test("'all selected' is exactly 'the import list is the whole group'", () => {
    /*
     * The bulk control's label and the submit button's count are read together,
     * one line apart. If "all selected" were judged by any other arithmetic —
     * counting duplicate rows twice, say, or counting already-registered hosts
     * — the control would claim the group was full while the button underneath
     * offered a smaller number.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            const selectable: number = countSelectableShownHosts({
              hosts: scan.hosts,
              filter: filter,
            });
            const importedCount: number = importAddresses({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            }).length;

            if (importedCount > selectable) {
              report(
                `SELECT-ALL CONSISTENCY: ${filter} would import ${importedCount} hosts from a group offering ${selectable} checkboxes`,
              );
            }

            const readsFull: boolean = areAllShownHostsSelected({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });

            if (
              readsFull !== (selectable > 0 && importedCount === selectable)
            ) {
              report(
                `SELECT-ALL CONSISTENCY: ${filter} reads "${String(readsFull)}" for fully-selected with ${importedCount} of ${selectable} ticked`,
              );
            }
          });
        },
      ),
    ).toEqual([]);
  });
});

describe("the rules keep their hands off React's state, over every generated scan", () => {
  test("no rule mutates the scan or the selection it was handed", () => {
    /*
     * All of these read straight out of React state. A rule that wrote back
     * into `discoveredDevices` or into the selection record would mutate state
     * in place, so the next render would compare equal to itself and skip — the
     * dialog would simply stop updating, with nothing in the console.
     */
    expect(
      findViolations(
        (scan: GeneratedScan, report: (problem: string) => void): void => {
          const hostsBefore: string = JSON.stringify(scan.hosts);
          const rowsBefore: Array<DiscoveredNetworkDevice> = [...scan.hosts];
          const selectionBefore: string = JSON.stringify(scan.selection);

          FILTERS.forEach((filter: DiscoveredHostFilter): void => {
            countDiscoveredHosts(scan.hosts);
            filterDiscoveredHosts({ hosts: scan.hosts, filter: filter });
            getShownDiscoveredHosts({ hosts: scan.hosts, filter: filter });
            countSelectableShownHosts({ hosts: scan.hosts, filter: filter });
            getInitialSelection(scan.hosts);
            getDiscoveredHostsToImport({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });
            areAllShownHostsSelected({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });
            toggleSelectionForShownHosts({
              hosts: scan.hosts,
              filter: filter,
              selectedIpAddresses: scan.selection,
            });
            markDiscoveredHostsAsRegistered({
              hosts: scan.hosts,
              importedIpAddresses: new Set<string>(addressesOf(scan.hosts)),
            });
          });

          if (JSON.stringify(scan.hosts) !== hostsBefore) {
            report("PURITY: the scan's rows were changed in place");
          }

          if (JSON.stringify(scan.selection) !== selectionBefore) {
            report("PURITY: the selection record was written to");
          }

          /*
           * Value equality alone would not notice rows being reordered into the
           * same multiset, or replaced by equal-valued copies — both of which
           * break identity-based React keys just as badly.
           */
          if (!sameRows(scan.hosts, rowsBefore)) {
            report(
              "PURITY: the scan's array was reordered or its rows swapped",
            );
          }
        },
      ),
    ).toEqual([]);
  });
});

describe("the corpus these laws are checked against", () => {
  test("really contains every shape the laws are about", () => {
    /*
     * The one way a property suite lies: if the generator drifted — a changed
     * seed table, a tweaked probability, a `size` that accidentally became zero
     * — every law above would still pass, vacuously, over scans containing none
     * of the shapes the rules exist for. This asserts the corpus covers them, so
     * that a green run above means something.
     */
    const shapes: Record<string, number> = {};

    const record: (shape: string) => void = (shape: string): void => {
      shapes[shape] = (shapes[shape] || 0) + 1;
    };

    CORPUS.forEach((scan: GeneratedScan): void => {
      if (scan.hosts.length === 0) {
        record("an empty scan");
      }

      if (scan.hosts.length >= 20) {
        record("a scan with 20+ hosts");
      }

      const seen: Set<string> = new Set<string>();

      scan.hosts.forEach((host: DiscoveredNetworkDevice): void => {
        if (host.snmpReachable === undefined) {
          record("a legacy row with no snmpReachable");
        }

        if (host.snmpReachable === true) {
          record("an SNMP responder");
        }

        if (host.snmpReachable === false) {
          record("a ping-only host");
        }

        if (host.ipAddress === "") {
          record("a blank address");
        }

        if (host.isAlreadyRegistered === true) {
          record("an already-registered host");
        }

        if (host.ipAddress !== "" && seen.has(host.ipAddress)) {
          record("a duplicated address");
        }

        seen.add(host.ipAddress);
      });

      const snmpAddresses: Set<string> = selectableAddressesShown({
        hosts: scan.hosts,
        filter: DiscoveredHostFilter.Snmp,
      });
      const noSnmpAddresses: Set<string> = selectableAddressesShown({
        hosts: scan.hosts,
        filter: DiscoveredHostFilter.NoSnmp,
      });

      if (
        Array.from(snmpAddresses).some((address: string) => {
          return noSnmpAddresses.has(address);
        })
      ) {
        record("one address in both groups");
      }

      FILTERS.forEach((filter: DiscoveredHostFilter): void => {
        const selectable: number = countSelectableShownHosts({
          hosts: scan.hosts,
          filter: filter,
        });

        if (selectable === 0) {
          record("a group with nothing selectable");

          return;
        }

        const importedCount: number = importAddresses({
          hosts: scan.hosts,
          filter: filter,
          selectedIpAddresses: scan.selection,
        }).length;

        if (importedCount === selectable) {
          record("a fully selected group");
        } else if (importedCount === 0) {
          record("a group with nothing ticked");
        } else {
          record("a partly selected group");
        }
      });
    });

    const requiredShapes: Array<string> = [
      "an empty scan",
      "a scan with 20+ hosts",
      "a legacy row with no snmpReachable",
      "an SNMP responder",
      "a ping-only host",
      "a blank address",
      "an already-registered host",
      "a duplicated address",
      "one address in both groups",
      "a group with nothing selectable",
      "a fully selected group",
      "a group with nothing ticked",
      "a partly selected group",
    ];

    expect(
      requiredShapes.filter((shape: string) => {
        return (shapes[shape] || 0) === 0;
      }),
    ).toEqual([]);

    // Enough scans that the laws are exercised rather than sampled.
    expect(CORPUS.length).toBe(SEEDS.length * SCANS_PER_SEED);
    expect(CORPUS.length).toBeGreaterThanOrEqual(300);
  });
});
