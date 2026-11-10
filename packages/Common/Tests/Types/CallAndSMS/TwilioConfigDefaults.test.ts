import TwilioConfigDefaults, {
  ProjectTwilioConfigDefaultRow,
  TWILIO_MESSAGE_KINDS,
  TwilioConfigDefaultChange,
  TwilioConfigDefaultFlags,
} from "../../../Types/CallAndSMS/TwilioConfigDefaults";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A PROJECT HAS A DEFAULT TWILIO CONFIG FOR SMS AND ONE FOR CALLS (#6574).
 *
 * A project whose numbers cannot do both - Twilio sells numbers for calls
 * only and for SMS only, and in some countries no one number does both -
 * makes a config used for SMS only and one used for calls only. With one
 * default per project, making the calls config the default took the default
 * from the SMS config, and the project's SMS went through OneUptime's own
 * account. These pin the rule that replaced it (Types/CallAndSMS/
 * TwilioConfigDefaults), which the server runs once a write is saved:
 *
 *   1. a config the write made the default takes everything it is used for;
 *   2. a config keeps what it is the default for, while it is a default and
 *      is used for it;
 *   3. what no config is the default for goes to a default used for it;
 *   4. a config that is the default for nothing is not a default.
 *
 * First by the stories people meet - the customer's own first - then by
 * properties over seeded random projects and writes.
 */

const SMS: TwilioMessageKind = TwilioMessageKind.SMS;
const CALL: TwilioMessageKind = TwilioMessageKind.Call;

const BOTH: TwilioConfigUse = TwilioConfigUse.CallsAndSms;
const SMS_ONLY: TwilioConfigUse = TwilioConfigUse.SmsOnly;
const CALLS_ONLY: TwilioConfigUse = TwilioConfigUse.CallsOnly;

// A config: its id, its use, and what it is the default for ("sms", "calls").
type Holds = "" | "sms" | "calls" | "both";

function config(
  id: string,
  use: unknown,
  holds: Holds = "",
): ProjectTwilioConfigDefaultRow {
  const sms: boolean = holds === "sms" || holds === "both";
  const calls: boolean = holds === "calls" || holds === "both";

  return {
    id: id,
    use: use,
    isProjectDefault: sms || calls,
    isProjectDefaultForSms: sms,
    isProjectDefaultForCalls: calls,
  };
}

// The config as a write left it: switched on or off, its flags as stored.
function switched(
  row: ProjectTwilioConfigDefaultRow,
  isProjectDefault: boolean,
): ProjectTwilioConfigDefaultRow {
  return { ...row, isProjectDefault: isProjectDefault };
}

function used(
  row: ProjectTwilioConfigDefaultRow,
  use: unknown,
): ProjectTwilioConfigDefaultRow {
  return { ...row, use: use };
}

// What the rule leaves each config the default for, as "sms"/"calls"/"both"/"".
function holdings(data: {
  configs: Array<ProjectTwilioConfigDefaultRow>;
  madeDefaultIds?: Array<string>;
}): Record<string, Holds> {
  const result: Record<string, Holds> = {};

  for (const [id, flags] of TwilioConfigDefaults.getProjectDefaults(data)) {
    result[id] = holdsOf(flags);
  }

  return result;
}

function holdsOf(flags: TwilioConfigDefaultFlags): Holds {
  if (flags.isProjectDefaultForSms && flags.isProjectDefaultForCalls) {
    return "both";
  }

  if (flags.isProjectDefaultForSms) {
    return "sms";
  }

  if (flags.isProjectDefaultForCalls) {
    return "calls";
  }

  return "";
}

describe("the columns and kinds", () => {
  test("SMS is kept in isProjectDefaultForSms and calls in isProjectDefaultForCalls, SMS first", () => {
    expect(TwilioConfigDefaults.getDefaultColumn(SMS)).toBe(
      "isProjectDefaultForSms",
    );
    expect(TwilioConfigDefaults.getDefaultColumn(CALL)).toBe(
      "isProjectDefaultForCalls",
    );
    expect(TWILIO_MESSAGE_KINDS).toEqual([SMS, CALL]);
  });

  test.each([
    [BOTH, [SMS, CALL]],
    [SMS_ONLY, [SMS]],
    [CALLS_ONLY, [CALL]],
    // Every config made before the choice, and a value that is not a use.
    [undefined, [SMS, CALL]],
    [null, [SMS, CALL]],
    ["Fax only", [SMS, CALL]],
  ] as Array<[unknown, Array<TwilioMessageKind>]>)(
    "a config used for %p sends %p",
    (use: unknown, kinds: Array<TwilioMessageKind>) => {
      expect(TwilioConfigDefaults.getKindsUsedFor(use)).toEqual(kinds);

      for (const kind of TWILIO_MESSAGE_KINDS) {
        expect(TwilioConfigDefaults.isUsedFor(use, kind)).toBe(
          kinds.includes(kind),
        );
      }
    },
  );

  test("only a stored true makes a config the default for a kind", () => {
    for (const value of [false, undefined, null, "true", 1, {}]) {
      expect(
        TwilioConfigDefaults.isDefaultFor(
          { isProjectDefaultForSms: value, isProjectDefaultForCalls: value },
          SMS,
        ),
      ).toBe(false);
    }

    expect(
      TwilioConfigDefaults.getDefaultKinds({
        isProjectDefaultForSms: true,
        isProjectDefaultForCalls: true,
      }),
    ).toEqual([SMS, CALL]);
    expect(
      TwilioConfigDefaults.getDefaultKinds({ isProjectDefaultForCalls: true }),
    ).toEqual([CALL]);
    expect(TwilioConfigDefaults.getDefaultKinds({})).toEqual([]);
  });

  test("what Set as Project Default would take: what the config is used for and is not yet the default for", () => {
    expect(TwilioConfigDefaults.getKindsToTake(config("a", BOTH))).toEqual([
      SMS,
      CALL,
    ]);
    expect(
      TwilioConfigDefaults.getKindsToTake(config("a", BOTH, "calls")),
    ).toEqual([SMS]);
    expect(
      TwilioConfigDefaults.getKindsToTake(config("a", BOTH, "sms")),
    ).toEqual([CALL]);
    expect(
      TwilioConfigDefaults.getKindsToTake(config("a", BOTH, "both")),
    ).toEqual([]);
    expect(TwilioConfigDefaults.getKindsToTake(config("a", SMS_ONLY))).toEqual([
      SMS,
    ]);
    expect(
      TwilioConfigDefaults.getKindsToTake(config("a", SMS_ONLY, "sms")),
    ).toEqual([]);
    expect(
      TwilioConfigDefaults.getKindsToTake(config("a", CALLS_ONLY)),
    ).toEqual([CALL]);
  });
});

describe("the customer's project: numbers for SMS, and others for calls (#6574)", () => {
  test("an SMS-only config and a calls-only config are the project default together", () => {
    // The SMS config is the default; the calls config is made the default.
    expect(
      holdings({
        configs: [
          config("sms", SMS_ONLY, "sms"),
          switched(config("calls", CALLS_ONLY), true),
        ],
        madeDefaultIds: ["calls"],
      }),
    ).toEqual({ sms: "sms", calls: "calls" });

    // And the other way round.
    expect(
      holdings({
        configs: [
          switched(config("sms", SMS_ONLY), true),
          config("calls", CALLS_ONLY, "calls"),
        ],
        madeDefaultIds: ["sms"],
      }),
    ).toEqual({ sms: "sms", calls: "calls" });
  });

  test("the first config, made the default as it is saved, takes only what it is used for", () => {
    expect(
      holdings({
        configs: [switched(config("calls", CALLS_ONLY), true)],
        madeDefaultIds: ["calls"],
      }),
    ).toEqual({ calls: "calls" });
  });

  test("making the calls config the default again changes nothing", () => {
    const configs: Array<ProjectTwilioConfigDefaultRow> = [
      config("sms", SMS_ONLY, "sms"),
      config("calls", CALLS_ONLY, "calls"),
    ];

    expect(
      TwilioConfigDefaults.getProjectDefaultChanges({
        configs: configs,
        madeDefaultIds: ["calls"],
      }),
    ).toEqual([]);
  });
});

describe("Set as Project Default", () => {
  test("a config used for calls and SMS takes both, and the configs that had them stop being the default", () => {
    expect(
      holdings({
        configs: [
          config("sms", SMS_ONLY, "sms"),
          config("calls", CALLS_ONLY, "calls"),
          switched(config("both", BOTH), true),
        ],
        madeDefaultIds: ["both"],
      }),
    ).toEqual({ sms: "", calls: "", both: "both" });
  });

  test("a config used for SMS only takes the SMS from the default for both, which keeps the calls", () => {
    expect(
      holdings({
        configs: [
          config("both", BOTH, "both"),
          switched(config("sms", SMS_ONLY), true),
        ],
        madeDefaultIds: ["sms"],
      }),
    ).toEqual({ both: "calls", sms: "sms" });
  });

  test("a config used for calls and SMS that has the calls takes the SMS too", () => {
    expect(
      holdings({
        configs: [
          config("sms", SMS_ONLY, "sms"),
          config("both", BOTH, "calls"),
        ],
        madeDefaultIds: ["both"],
      }),
    ).toEqual({ sms: "", both: "both" });
  });

  test("of configs one write made the default, the first takes what they are both used for", () => {
    const configs: Array<ProjectTwilioConfigDefaultRow> = [
      switched(config("first", BOTH), true),
      switched(config("second", BOTH), true),
      switched(config("third", CALLS_ONLY), true),
    ];

    expect(
      holdings({
        configs: configs,
        madeDefaultIds: ["third", "second", "first"],
      }),
    ).toEqual({ first: "both", second: "", third: "" });

    expect(
      holdings({
        configs: [
          switched(config("sms", SMS_ONLY), true),
          switched(config("both", BOTH), true),
        ],
        madeDefaultIds: ["sms", "both"],
      }),
    ).toEqual({ sms: "sms", both: "calls" });
  });

  test("a config made the default that a later write turned off takes nothing: what the table holds counts", () => {
    expect(
      holdings({
        configs: [
          config("current", BOTH, "both"),
          switched(config("turned-off", BOTH), false),
        ],
        madeDefaultIds: ["turned-off"],
      }),
    ).toEqual({ current: "both", "turned-off": "" });
  });

  test("ids are compared as the database compares them, in any case", () => {
    const upper: string = "1A000000-0000-4000-8000-0000000000AB";

    expect(
      holdings({
        configs: [
          config("old", BOTH, "both"),
          switched(config(upper.toLowerCase(), BOTH), true),
        ],
        madeDefaultIds: [upper],
      }),
    ).toEqual({ old: "", [upper.toLowerCase()]: "both" });
  });
});

describe("Stop Using as Project Default, and deleting a default", () => {
  test("the SMS go back to the default for calls when it is used for SMS too", () => {
    expect(
      holdings({
        configs: [
          config("both", BOTH, "calls"),
          switched(config("sms", SMS_ONLY, "sms"), false),
        ],
      }),
    ).toEqual({ both: "both", sms: "" });
  });

  test("the SMS go to nobody when no other default is used for SMS: OneUptime's account sends them", () => {
    expect(
      holdings({
        configs: [
          config("calls", CALLS_ONLY, "calls"),
          switched(config("sms", SMS_ONLY, "sms"), false),
        ],
      }),
    ).toEqual({ calls: "calls", sms: "" });
  });

  test("a config that is no default never takes what was left: nothing becomes a default by itself", () => {
    expect(
      holdings({
        configs: [
          config("spare", BOTH),
          switched(config("default", BOTH, "both"), false),
        ],
      }),
    ).toEqual({ spare: "", default: "" });
  });

  test("a deleted default is a config the rule no longer reads", () => {
    // The SMS config was the default for SMS, and is gone.
    expect(
      holdings({
        configs: [config("both", BOTH, "calls")],
      }),
    ).toEqual({ both: "both" });

    expect(
      holdings({
        configs: [config("calls", CALLS_ONLY, "calls"), config("spare", BOTH)],
      }),
    ).toEqual({ calls: "calls", spare: "" });
  });
});

describe("changing what a default is used for", () => {
  test("a default made SMS only stops being the default for calls, which go to nobody", () => {
    expect(
      holdings({
        configs: [used(config("both", BOTH, "both"), SMS_ONLY)],
      }),
    ).toEqual({ both: "sms" });
  });

  test("a default made calls only, that had only the SMS, is no default", () => {
    expect(
      holdings({
        configs: [
          config("calls", CALLS_ONLY, "calls"),
          used(config("sms", BOTH, "sms"), CALLS_ONLY),
        ],
      }),
    ).toEqual({ calls: "calls", sms: "" });
  });

  test("a default that starts being used for calls too takes the calls when no config has them", () => {
    expect(
      holdings({
        configs: [used(config("sms", SMS_ONLY, "sms"), BOTH)],
      }),
    ).toEqual({ sms: "both" });
  });

  test("... and leaves them where they are when a config has them", () => {
    expect(
      holdings({
        configs: [
          config("calls", CALLS_ONLY, "calls"),
          used(config("sms", SMS_ONLY, "sms"), BOTH),
        ],
      }),
    ).toEqual({ calls: "calls", sms: "sms" });
  });
});

describe("a project the rule has not settled", () => {
  test("two configs that are each the default for SMS: the first made keeps it", () => {
    expect(
      holdings({
        configs: [config("first", BOTH, "sms"), config("second", BOTH, "sms")],
      }),
    ).toEqual({ first: "both", second: "" });
  });

  test("a default with no flags - one stored before them - takes what nobody has", () => {
    expect(
      holdings({
        configs: [
          { id: "legacy", use: BOTH, isProjectDefault: true },
          config("spare", BOTH),
        ],
      }),
    ).toEqual({ legacy: "both", spare: "" });
  });

  test("flags on a config that is no default are read as nothing", () => {
    expect(
      holdings({
        configs: [
          {
            id: "off",
            use: BOTH,
            isProjectDefault: false,
            isProjectDefaultForSms: true,
            isProjectDefaultForCalls: true,
          },
        ],
      }),
    ).toEqual({ off: "" });
  });

  test("a project with no config has no default", () => {
    expect(TwilioConfigDefaults.getProjectDefaults({ configs: [] }).size).toBe(
      0,
    );
    expect(
      TwilioConfigDefaults.getProjectDefaultChanges({
        configs: [],
        madeDefaultIds: ["gone"],
      }),
    ).toEqual([]);
  });
});

describe("the writes the rule makes", () => {
  test("only the configs whose flags change, those that give something up first", () => {
    const changes: Array<TwilioConfigDefaultChange> =
      TwilioConfigDefaults.getProjectDefaultChanges({
        configs: [
          switched(config("new", BOTH), true),
          config("spare", SMS_ONLY),
          config("old", BOTH, "both"),
        ],
        madeDefaultIds: ["new"],
      });

    expect(changes).toEqual([
      {
        id: "old",
        flags: {
          isProjectDefault: false,
          isProjectDefaultForSms: false,
          isProjectDefaultForCalls: false,
        },
      },
      {
        id: "new",
        flags: {
          isProjectDefault: true,
          isProjectDefaultForSms: true,
          isProjectDefaultForCalls: true,
        },
      },
    ]);
  });

  /*
   * One write makes "b" the default and used for SMS only: it takes the
   * SMS from "a", and gives up its calls - which "a", a default used for
   * calls too, takes. Written whole, one after the other, either order
   * leaves two defaults for one kind between them; so each first gives up,
   * then each takes.
   */
  test("two configs that swap what they hold give up first, then take", () => {
    const changes: Array<TwilioConfigDefaultChange> =
      TwilioConfigDefaults.getProjectDefaultChanges({
        configs: [
          config("a", BOTH, "sms"),
          used(config("b", BOTH, "calls"), SMS_ONLY),
        ],
        madeDefaultIds: ["b"],
      });

    expect(
      changes.map((change: TwilioConfigDefaultChange) => {
        return [change.id, holdsOf(change.flags)];
      }),
    ).toEqual([
      ["a", ""],
      ["b", ""],
      ["a", "calls"],
      ["b", "sms"],
    ]);

    // Both stay switched on throughout: neither stops being a default.
    for (const change of changes) {
      expect(change.flags.isProjectDefault).toBe(true);
    }
  });

  test("a default that keeps what it has and stops being one is written off", () => {
    expect(
      TwilioConfigDefaults.getProjectDefaultChanges({
        configs: [
          {
            id: "stale",
            use: BOTH,
            isProjectDefault: true,
            isProjectDefaultForSms: false,
            isProjectDefaultForCalls: false,
          },
          config("holder", BOTH, "both"),
        ],
      }),
    ).toEqual([
      {
        id: "stale",
        flags: {
          isProjectDefault: false,
          isProjectDefaultForSms: false,
          isProjectDefaultForCalls: false,
        },
      },
    ]);
  });
});

/*
 * PROPERTIES, over seeded random projects and the writes people make to
 * them: a project the rule settled, then one write - configs made the
 * default, switched off, used for something else, deleted - and the rule
 * run on what the table holds then.
 */

const USES: Array<unknown> = [BOTH, SMS_ONLY, CALLS_ONLY, undefined];
const HOLDS: Array<Holds> = ["", "sms", "calls", "both"];

interface Write {
  before: Array<ProjectTwilioConfigDefaultRow>;
  configs: Array<ProjectTwilioConfigDefaultRow>;
  madeDefaultIds: Array<string>;
}

function pick<ItemType>(
  items: Array<ItemType>,
  random: SeededRandom,
): ItemType {
  return items[random(items.length)]!;
}

// Any project: flags as a broken or old table may hold them.
function anyProject(
  random: SeededRandom,
): Array<ProjectTwilioConfigDefaultRow> {
  const count: number = random(7);
  const configs: Array<ProjectTwilioConfigDefaultRow> = [];

  for (let index: number = 0; index < count; index++) {
    const row: ProjectTwilioConfigDefaultRow = config(
      `config-${index}`,
      pick(USES, random),
      pick(HOLDS, random),
    );

    // Now and then a default with no flags, or flags with no default.
    if (random(5) === 0) {
      row.isProjectDefault = !row.isProjectDefault;
    }

    configs.push(row);
  }

  return configs;
}

// A project as the rule leaves it.
function settled(
  configs: Array<ProjectTwilioConfigDefaultRow>,
): Array<ProjectTwilioConfigDefaultRow> {
  const defaults: Map<string, TwilioConfigDefaultFlags> =
    TwilioConfigDefaults.getProjectDefaults({ configs: configs });

  return configs.map((row: ProjectTwilioConfigDefaultRow) => {
    return { ...row, ...defaults.get(row.id)! };
  });
}

// One write to a settled project, as the table holds it after the write.
function aWrite(random: SeededRandom): Write {
  const before: Array<ProjectTwilioConfigDefaultRow> = settled(
    anyProject(random),
  );
  const madeDefaultIds: Array<string> = [];
  const configs: Array<ProjectTwilioConfigDefaultRow> = [];

  for (const row of before) {
    const action: number = random(6);

    if (action === 0) {
      // Set as Project Default (or a create saved as the default).
      madeDefaultIds.push(row.id);
      configs.push(switched(row, true));
    } else if (action === 1) {
      // Stop Using as Project Default.
      configs.push(switched(row, false));
    } else if (action === 2) {
      configs.push(used(row, pick(USES, random)));
    } else if (action === 3 && random(2) === 0) {
      // Deleted.
      continue;
    } else {
      configs.push(row);
    }
  }

  return { before, configs, madeDefaultIds };
}

const SEEDS: Array<number> = [6574, 1, 2, 3, 42, 2718];
const WRITES_PER_SEED: number = 400;

function forEveryWrite(check: (write: Write) => void): void {
  for (const seed of SEEDS) {
    const random: SeededRandom = seededRandom(seed);

    for (let index: number = 0; index < WRITES_PER_SEED; index++) {
      check(aWrite(random));
    }
  }
}

function holderOf(
  defaults: Map<string, TwilioConfigDefaultFlags>,
  kind: TwilioMessageKind,
): Array<string> {
  return Array.from(defaults.entries())
    .filter(([, flags]: [string, TwilioConfigDefaultFlags]) => {
      return TwilioConfigDefaults.isDefaultFor(flags, kind);
    })
    .map(([id]: [string, TwilioConfigDefaultFlags]) => {
      return id;
    });
}

function rowOf(
  configs: Array<ProjectTwilioConfigDefaultRow>,
  id: string,
): ProjectTwilioConfigDefaultRow | undefined {
  return configs.find((row: ProjectTwilioConfigDefaultRow) => {
    return row.id === id;
  });
}

describe("over any project and any write", () => {
  test("each kind of message has one default at most, used for it, and switched on", () => {
    forEveryWrite((write: Write) => {
      const defaults: Map<string, TwilioConfigDefaultFlags> =
        TwilioConfigDefaults.getProjectDefaults(write);

      for (const kind of TWILIO_MESSAGE_KINDS) {
        const holders: Array<string> = holderOf(defaults, kind);

        expect(holders.length).toBeLessThanOrEqual(1);

        for (const id of holders) {
          const row: ProjectTwilioConfigDefaultRow = rowOf(write.configs, id)!;
          expect(TwilioConfigDefaults.isUsedFor(row.use, kind)).toBe(true);
          expect(row.isProjectDefault).toBe(true);
        }
      }

      for (const flags of defaults.values()) {
        expect(flags.isProjectDefault).toBe(
          flags.isProjectDefaultForSms || flags.isProjectDefaultForCalls,
        );
      }

      // Every config the write left is said something of; no other.
      expect(Array.from(defaults.keys()).sort()).toEqual(
        write.configs
          .map((row: ProjectTwilioConfigDefaultRow) => {
            return row.id;
          })
          .sort(),
      );
    });
  });

  test("a config the write made the default holds everything it is used for, unless one made before it in the same write took it", () => {
    forEveryWrite((write: Write) => {
      const defaults: Map<string, TwilioConfigDefaultFlags> =
        TwilioConfigDefaults.getProjectDefaults(write);
      const made: Array<ProjectTwilioConfigDefaultRow> = write.configs.filter(
        (row: ProjectTwilioConfigDefaultRow) => {
          return write.madeDefaultIds.includes(row.id);
        },
      );

      for (const kind of TWILIO_MESSAGE_KINDS) {
        const firstMadeForKind: ProjectTwilioConfigDefaultRow | undefined =
          made.find((row: ProjectTwilioConfigDefaultRow) => {
            return TwilioConfigDefaults.isUsedFor(row.use, kind);
          });

        if (firstMadeForKind) {
          expect(holderOf(defaults, kind)).toEqual([firstMadeForKind.id]);
        }
      }
    });
  });

  test("a kind no config was made the default for stays with the config that had it, while it can", () => {
    forEveryWrite((write: Write) => {
      const defaults: Map<string, TwilioConfigDefaultFlags> =
        TwilioConfigDefaults.getProjectDefaults(write);

      for (const kind of TWILIO_MESSAGE_KINDS) {
        const madeForKind: boolean = write.configs.some(
          (row: ProjectTwilioConfigDefaultRow) => {
            return (
              write.madeDefaultIds.includes(row.id) &&
              TwilioConfigDefaults.isUsedFor(row.use, kind)
            );
          },
        );
        const keeper: ProjectTwilioConfigDefaultRow | undefined =
          write.configs.find((row: ProjectTwilioConfigDefaultRow) => {
            return (
              row.isProjectDefault === true &&
              TwilioConfigDefaults.isDefaultFor(row, kind) &&
              TwilioConfigDefaults.isUsedFor(row.use, kind)
            );
          });

        if (!madeForKind && keeper) {
          expect(holderOf(defaults, kind)).toEqual([keeper.id]);
        }
      }
    });
  });

  test("a kind with no default is one no switched-on config is used for: nothing that could send it is left unused", () => {
    forEveryWrite((write: Write) => {
      const defaults: Map<string, TwilioConfigDefaultFlags> =
        TwilioConfigDefaults.getProjectDefaults(write);

      for (const kind of TWILIO_MESSAGE_KINDS) {
        if (holderOf(defaults, kind).length > 0) {
          continue;
        }

        expect(
          write.configs.filter((row: ProjectTwilioConfigDefaultRow) => {
            return (
              row.isProjectDefault === true &&
              TwilioConfigDefaults.isUsedFor(row.use, kind)
            );
          }),
        ).toEqual([]);
      }
    });
  });

  test("a project the rule settled stays as it is: settling it again changes nothing", () => {
    forEveryWrite((write: Write) => {
      const after: Array<ProjectTwilioConfigDefaultRow> = settled(
        write.configs,
      );

      expect(
        TwilioConfigDefaults.getProjectDefaultChanges({ configs: after }),
      ).toEqual([]);
      expect(
        TwilioConfigDefaults.getProjectDefaultChanges({
          configs: write.before,
        }),
      ).toEqual([]);
    });
  });

  test("the writes, made one by one, end where the rule says - and never leave two defaults for one kind on the way", () => {
    forEveryWrite((write: Write) => {
      const changes: Array<TwilioConfigDefaultChange> =
        TwilioConfigDefaults.getProjectDefaultChanges(write);
      const defaults: Map<string, TwilioConfigDefaultFlags> =
        TwilioConfigDefaults.getProjectDefaults(write);

      // The table as the write left it, then after each of the rule's writes.
      const table: Map<string, ProjectTwilioConfigDefaultRow> = new Map(
        write.configs.map((row: ProjectTwilioConfigDefaultRow) => {
          return [row.id, { ...row }];
        }),
      );

      const holdersNow: (kind: TwilioMessageKind) => number = (
        kind: TwilioMessageKind,
      ): number => {
        return Array.from(table.values()).filter(
          (row: ProjectTwilioConfigDefaultRow) => {
            return TwilioConfigDefaults.isDefaultFor(row, kind);
          },
        ).length;
      };

      for (const change of changes) {
        // Every change changes something.
        const row: ProjectTwilioConfigDefaultRow = table.get(change.id)!;
        expect({
          isProjectDefault: row.isProjectDefault === true,
          isProjectDefaultForSms: row.isProjectDefaultForSms === true,
          isProjectDefaultForCalls: row.isProjectDefaultForCalls === true,
        }).not.toEqual(change.flags);

        table.set(change.id, { ...row, ...change.flags });

        for (const kind of TWILIO_MESSAGE_KINDS) {
          // The write itself may leave a broken table; the rule's never adds to it.
          const holdersBefore: number = write.configs.filter(
            (stored: ProjectTwilioConfigDefaultRow) => {
              return TwilioConfigDefaults.isDefaultFor(stored, kind);
            },
          ).length;

          expect(holdersNow(kind)).toBeLessThanOrEqual(
            Math.max(1, holdersBefore),
          );
        }
      }

      for (const [id, flags] of defaults) {
        const row: ProjectTwilioConfigDefaultRow = table.get(id)!;

        expect({
          isProjectDefault: row.isProjectDefault === true,
          isProjectDefaultForSms: row.isProjectDefaultForSms === true,
          isProjectDefaultForCalls: row.isProjectDefaultForCalls === true,
        }).toEqual(flags);
      }
    });
  });

  test("the writes really vary: every story above happens among them", () => {
    let madeDefault: number = 0;
    let stopped: number = 0;
    let twoDefaults: number = 0;
    let smsOnlyAndCallsOnly: number = 0;

    forEveryWrite((write: Write) => {
      const defaults: Map<string, TwilioConfigDefaultFlags> =
        TwilioConfigDefaults.getProjectDefaults(write);
      const holders: Set<string> = new Set([
        ...holderOf(defaults, SMS),
        ...holderOf(defaults, CALL),
      ]);

      madeDefault += write.madeDefaultIds.length > 0 ? 1 : 0;
      stopped += write.configs.some((row: ProjectTwilioConfigDefaultRow) => {
        const was: ProjectTwilioConfigDefaultRow | undefined = rowOf(
          write.before,
          row.id,
        );
        return was?.isProjectDefault === true && row.isProjectDefault !== true;
      })
        ? 1
        : 0;
      twoDefaults += holders.size === 2 ? 1 : 0;
      smsOnlyAndCallsOnly +=
        holders.size === 2 &&
        Array.from(holders).every((id: string) => {
          const use: unknown = rowOf(write.configs, id)!.use;
          return use === SMS_ONLY || use === CALLS_ONLY;
        })
          ? 1
          : 0;
    });

    const total: number = SEEDS.length * WRITES_PER_SEED;

    expect(madeDefault).toBeGreaterThan(total / 4);
    expect(stopped).toBeGreaterThan(total / 10);
    expect(twoDefaults).toBeGreaterThan(total / 20);
    expect(smsOnlyAndCallsOnly).toBeGreaterThan(0);
  });
});
