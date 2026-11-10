import TwilioConfigUses from "./TwilioConfigUse";
import { TwilioMessageKind } from "../../Utils/Project/TwilioAccount";

/*
 * WHICH OF A PROJECT'S TWILIO CONFIGS ITS SMS GO THROUGH, AND WHICH ITS CALLS.
 *
 * SMS and calls to the people in a project - on-call alerts, notifications,
 * verification codes - go through the project's default Twilio config. A
 * config is used for calls and SMS, for SMS only or for calls only
 * (TwilioConfigUse), and a project used to have exactly one default. So a
 * project whose numbers could not do both - in some countries no one number
 * does, and Twilio sells numbers for calls only and numbers for SMS only -
 * made a config for each, and then could make only one of them its default:
 * making the calls config the default took the default from the SMS config,
 * and its SMS went through OneUptime's own account (issue #6574).
 *
 * So a project has a default for SMS and a default for calls, and a config
 * is the default for what it is used for:
 *
 *   - Set as Project Default (ProjectCallSMSConfig.isProjectDefault written
 *     true) makes a config the default for everything it is used for, and
 *     takes that - and only that - from the configs that had it. A config
 *     used for SMS only and one used for calls only are the default
 *     together; a config used for calls and SMS takes both;
 *   - a config keeps what it is the default for while it is a default and
 *     is used for it: a config made "SMS only" stops being the default for
 *     calls;
 *   - SMS or calls that no config is the default for go to a default config
 *     that is used for them: when the SMS default is deleted or stops being
 *     the default, a default config used for calls and SMS takes the SMS
 *     back, and a default that starts being used for calls too takes the
 *     calls when no config has them. Nothing moves from one config to
 *     another by itself;
 *   - a config that is the default for nothing is not a default.
 *
 * What a config is the default for is kept in isProjectDefaultForSms and
 * isProjectDefaultForCalls, which only the server writes, by this rule,
 * once a write has been saved (ProjectCallSMSConfigService); isProjectDefault
 * reads true while it is the default for either. The senders read the
 * default for the kind of message they send.
 *
 * Kept free of server and React code: the server, the dashboards and the
 * tests read the same rule.
 */

// SMS first, as every list of the two in the product names them.
export const TWILIO_MESSAGE_KINDS: ReadonlyArray<TwilioMessageKind> = [
  TwilioMessageKind.SMS,
  TwilioMessageKind.Call,
];

// The columns a config's place as a project default is kept in.
export interface TwilioConfigDefaultFlags {
  // The default for anything: SMS, calls or both.
  isProjectDefault: boolean;
  // The project's SMS go through it.
  isProjectDefaultForSms: boolean;
  // The project's calls go through it.
  isProjectDefaultForCalls: boolean;
}

// The column that says a config is the default for this kind of message.
export type TwilioConfigDefaultColumn =
  | "isProjectDefaultForSms"
  | "isProjectDefaultForCalls";

/*
 * One of a project's configs, as the rule reads it once a write has been
 * saved: what it is used for, and where it stands as a default. Flags are
 * read as stored: anything but true is false.
 */
export interface ProjectTwilioConfigDefaultRow {
  id: string;
  use: unknown;
  isProjectDefault?: unknown;
  isProjectDefaultForSms?: unknown;
  isProjectDefaultForCalls?: unknown;
}

// What the rule says one config should hold, and the config it is for.
export interface TwilioConfigDefaultChange {
  id: string;
  flags: TwilioConfigDefaultFlags;
}

const isTrue: (value: unknown) => boolean = (value: unknown): boolean => {
  return value === true;
};

// Ids compared as the database compares them: a uuid in any case.
const sameId: (left: string, right: string) => boolean = (
  left: string,
  right: string,
): boolean => {
  return left.toLowerCase() === right.toLowerCase();
};

export default class TwilioConfigDefaults {
  public static getDefaultColumn(
    kind: TwilioMessageKind,
  ): TwilioConfigDefaultColumn {
    return kind === TwilioMessageKind.SMS
      ? "isProjectDefaultForSms"
      : "isProjectDefaultForCalls";
  }

  // Whether a config used for this sends this kind of message.
  public static isUsedFor(use: unknown, kind: TwilioMessageKind): boolean {
    return kind === TwilioMessageKind.SMS
      ? TwilioConfigUses.sendsSms(use)
      : TwilioConfigUses.makesCalls(use);
  }

  // What a config used for this sends: SMS, calls, or both - SMS first.
  public static getKindsUsedFor(use: unknown): Array<TwilioMessageKind> {
    return TWILIO_MESSAGE_KINDS.filter((kind: TwilioMessageKind): boolean => {
      return TwilioConfigDefaults.isUsedFor(use, kind);
    });
  }

  // Whether the project's messages of this kind go through the config.
  public static isDefaultFor(
    config: Partial<Record<TwilioConfigDefaultColumn, unknown>>,
    kind: TwilioMessageKind,
  ): boolean {
    return isTrue(config[TwilioConfigDefaults.getDefaultColumn(kind)]);
  }

  // What the config is the project default for: SMS, calls, both or nothing.
  public static getDefaultKinds(
    config: Partial<Record<TwilioConfigDefaultColumn, unknown>>,
  ): Array<TwilioMessageKind> {
    return TWILIO_MESSAGE_KINDS.filter((kind: TwilioMessageKind): boolean => {
      return TwilioConfigDefaults.isDefaultFor(config, kind);
    });
  }

  /*
   * What Set as Project Default would make the config the default for, that
   * it is not yet: everything it is used for, less what it already is the
   * default for. Empty when it is the default for everything it is used for.
   */
  public static getKindsToTake(
    config: { use: unknown } & Partial<
      Record<TwilioConfigDefaultColumn, unknown>
    >,
  ): Array<TwilioMessageKind> {
    return TwilioConfigDefaults.getKindsUsedFor(config.use).filter(
      (kind: TwilioMessageKind): boolean => {
        return !TwilioConfigDefaults.isDefaultFor(config, kind);
      },
    );
  }

  /*
   * THE RULE. Given every config of one project as it stands once a write
   * has been saved - in the order they were made - and the configs that
   * write made the default, what each config should hold:
   *
   *   1. a config the write made the default takes everything it is used
   *      for (of several made the default by one write, the first takes
   *      what both are used for);
   *   2. a config keeps what it is the default for, while it is a default
   *      and is used for it;
   *   3. what no config is the default for goes to a default used for it;
   *   4. a config that is the default for nothing is not a default.
   *
   * A config the write made the default that no longer reads as one - a
   * later write turned it off - takes nothing: what the table holds now is
   * what counts.
   */
  public static getProjectDefaults(data: {
    configs: ReadonlyArray<ProjectTwilioConfigDefaultRow>;
    madeDefaultIds?: ReadonlyArray<string> | undefined;
  }): Map<string, TwilioConfigDefaultFlags> {
    const madeDefaultIds: ReadonlyArray<string> = data.madeDefaultIds || [];

    const isMadeDefault: (config: ProjectTwilioConfigDefaultRow) => boolean = (
      config: ProjectTwilioConfigDefaultRow,
    ): boolean => {
      return (
        isTrue(config.isProjectDefault) &&
        madeDefaultIds.some((id: string): boolean => {
          return sameId(id, config.id);
        })
      );
    };

    // The config each kind of message goes through, by its id.
    const holders: Map<TwilioMessageKind, string> = new Map();

    // 1. Taken by a config the write made the default.
    for (const config of data.configs) {
      if (!isMadeDefault(config)) {
        continue;
      }

      for (const kind of TwilioConfigDefaults.getKindsUsedFor(config.use)) {
        if (!holders.has(kind)) {
          holders.set(kind, config.id);
        }
      }
    }

    // 2. Kept by the config that is the default for it, while it still can be.
    for (const kind of TWILIO_MESSAGE_KINDS) {
      if (holders.has(kind)) {
        continue;
      }

      const keeper: ProjectTwilioConfigDefaultRow | undefined =
        data.configs.find((config: ProjectTwilioConfigDefaultRow): boolean => {
          return (
            isTrue(config.isProjectDefault) &&
            TwilioConfigDefaults.isDefaultFor(config, kind) &&
            TwilioConfigDefaults.isUsedFor(config.use, kind)
          );
        });

      if (keeper) {
        holders.set(kind, keeper.id);
      }
    }

    // 3. Left to nobody: a default used for it takes it.
    for (const kind of TWILIO_MESSAGE_KINDS) {
      if (holders.has(kind)) {
        continue;
      }

      const taker: ProjectTwilioConfigDefaultRow | undefined =
        data.configs.find((config: ProjectTwilioConfigDefaultRow): boolean => {
          return (
            isTrue(config.isProjectDefault) &&
            TwilioConfigDefaults.isUsedFor(config.use, kind)
          );
        });

      if (taker) {
        holders.set(kind, taker.id);
      }
    }

    // 4. Each config's flags; a default for nothing is not a default.
    const defaults: Map<string, TwilioConfigDefaultFlags> = new Map();

    for (const config of data.configs) {
      const isProjectDefaultForSms: boolean =
        holders.get(TwilioMessageKind.SMS) === config.id;
      const isProjectDefaultForCalls: boolean =
        holders.get(TwilioMessageKind.Call) === config.id;

      defaults.set(config.id, {
        isProjectDefault: isProjectDefaultForSms || isProjectDefaultForCalls,
        isProjectDefaultForSms,
        isProjectDefaultForCalls,
      });
    }

    return defaults;
  }

  /*
   * The writes that bring the configs to what the rule says, in the order
   * they are made: first every config gives up what it is no longer the
   * default for, then each takes what it newly is. So no two configs are
   * the default for one kind of message while the writes are made one by
   * one - not even when two configs swap what they hold (one made "SMS
   * only" and the default in one write, while the other default takes its
   * calls). A config that only gives something up, or only takes, is
   * written once; one that does both, twice. A config whose flags stay as
   * they are is not written.
   */
  public static getProjectDefaultChanges(data: {
    configs: ReadonlyArray<ProjectTwilioConfigDefaultRow>;
    madeDefaultIds?: ReadonlyArray<string> | undefined;
  }): Array<TwilioConfigDefaultChange> {
    const defaults: Map<string, TwilioConfigDefaultFlags> =
      TwilioConfigDefaults.getProjectDefaults(data);

    const givingUp: Array<TwilioConfigDefaultChange> = [];
    const taking: Array<TwilioConfigDefaultChange> = [];

    for (const config of data.configs) {
      const flags: TwilioConfigDefaultFlags | undefined = defaults.get(
        config.id,
      );

      if (!flags) {
        continue;
      }

      const stored: TwilioConfigDefaultFlags = {
        isProjectDefault: isTrue(config.isProjectDefault),
        isProjectDefaultForSms: isTrue(config.isProjectDefaultForSms),
        isProjectDefaultForCalls: isTrue(config.isProjectDefaultForCalls),
      };

      // What it holds both now and once settled: what it keeps.
      const kept: TwilioConfigDefaultFlags = {
        isProjectDefault: stored.isProjectDefault && flags.isProjectDefault,
        isProjectDefaultForSms:
          stored.isProjectDefaultForSms && flags.isProjectDefaultForSms,
        isProjectDefaultForCalls:
          stored.isProjectDefaultForCalls && flags.isProjectDefaultForCalls,
      };

      if (!areSameFlags(kept, stored)) {
        givingUp.push({ id: config.id, flags: kept });
      }

      if (!areSameFlags(flags, kept)) {
        taking.push({ id: config.id, flags: flags });
      }
    }

    return [...givingUp, ...taking];
  }
}

function areSameFlags(
  left: TwilioConfigDefaultFlags,
  right: TwilioConfigDefaultFlags,
): boolean {
  return (
    left.isProjectDefault === right.isProjectDefault &&
    left.isProjectDefaultForSms === right.isProjectDefaultForSms &&
    left.isProjectDefaultForCalls === right.isProjectDefaultForCalls
  );
}
