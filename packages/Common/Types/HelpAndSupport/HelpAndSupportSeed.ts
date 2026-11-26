import { JSONObject } from "../JSON";
import {
  HELP_ITEMS,
  HELP_ITEM_CHOICES,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  HelpItemChange,
  HelpItemSetting,
  getDefaultHelpAndSupportSettings,
  isHelpItem,
  readHelpAndSupportSettings,
  readHelpItemChange,
  toHelpAndSupportJSON,
  withHelpItemChanged,
} from "./HelpAndSupport";

/*
 * HELP AND SUPPORT FROM THE SERVER'S CONFIGURATION, WHILE NOTHING IS SAVED
 * (#10938).
 *
 * Teams that run OneUptime from GitOps set Admin Dashboard > Settings > Help
 * and Support in the Helm chart (helpAndSupport.*) or in config.env
 * (HELP_AND_SUPPORT_*), rather than on the page after each fresh install.
 * Each value seeds the page's setting once, while nothing is saved there
 * yet - a new server's first start, or the first start with a value set of
 * a server whose page was never saved - and never again: from then on the
 * page holds the settings, and a value an admin changes there is never
 * overwritten by a restart. A value changed in the configuration later is
 * not applied; the server's log says so, and the page is where it changes.
 *
 * Each value is checked as the page checks it (readHelpItemChange): a link
 * takes https, http or mailto only, an address must be one valid address,
 * and the message is plain text. A value that would be refused is left out
 * and said in the log, and the others are seeded.
 *
 * What a value may be, setting by setting:
 *
 *   supportEmail   an email address, or "hidden"
 *   chat           a link (Slack, Microsoft Teams or any https link), or "hidden"
 *   requestDemo    "shown" or "hidden" (true or false work too)
 *   giveFeedback   an email address, a link, or "hidden"
 *   helpLink       a link, or "hidden"
 *   gitHub         "shown" or "hidden" (true or false work too)
 *   mobileApp      a link (an app catalogue, a device manager), or "hidden"
 *   inviteMessage  plain text, up to 1000 characters
 *
 * Empty, or "default", leaves a setting on OneUptime's default.
 *
 * What was seeded is kept beside the settings (SEEDED_ITEMS_KEY), so the
 * page says where a value came from until an admin changes it.
 */

// The environment variable that seeds each setting.
export const HELP_AND_SUPPORT_SEED_VARIABLES: Readonly<
  Record<HelpItem, string>
> = {
  [HelpItem.SupportEmail]: "HELP_AND_SUPPORT_SUPPORT_EMAIL",
  [HelpItem.Chat]: "HELP_AND_SUPPORT_CHAT",
  [HelpItem.RequestDemo]: "HELP_AND_SUPPORT_REQUEST_DEMO",
  [HelpItem.GiveFeedback]: "HELP_AND_SUPPORT_GIVE_FEEDBACK",
  [HelpItem.HelpLink]: "HELP_AND_SUPPORT_HELP_LINK",
  [HelpItem.GitHub]: "HELP_AND_SUPPORT_GITHUB",
  [HelpItem.MobileApp]: "HELP_AND_SUPPORT_MOBILE_APP",
  [HelpItem.InviteMessage]: "HELP_AND_SUPPORT_INVITE_MESSAGE",
};

// The Helm value that sets each variable: helpAndSupport.<the setting's key>.
export const getHelpAndSupportHelmValue: (item: HelpItem) => string = (
  item: HelpItem,
): string => {
  return `helpAndSupport.${item}`;
};

/*
 * Where the settings keep which items were seeded and not changed since:
 * beside the items, under a key no item has, so every reader of the
 * settings (readHelpAndSupportSettings) passes over it.
 */
export const SEEDED_ITEMS_KEY: string = "seededFromConfiguration";

// The words a value may be, read without regard to case.
const DEFAULT_WORDS: ReadonlyArray<string> = ["default"];
const HIDDEN_WORDS: ReadonlyArray<string> = ["hidden", "hide"];
// For the two settings that are only shown or hidden.
const SHOWN_WORDS: ReadonlyArray<string> = ["shown", "show", "true", "yes"];
const SWITCH_HIDDEN_WORDS: ReadonlyArray<string> = ["false", "no"];

// The settings that are only shown or hidden.
const SWITCH_ITEMS: ReadonlyArray<HelpItem> = [
  HelpItem.RequestDemo,
  HelpItem.GitHub,
];

// A value written with its scheme, as a link is: "https:", "mailto:".
const HAS_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:/i;

/*
 * The words a refusal says, in English: the server's log is read in
 * English, and a value named here is the operator's to fix.
 */
export const HelpAndSupportSeedProblems: {
  wordNotAChoice: string;
  notShownOrHidden: string;
} = {
  wordNotAChoice:
    "This setting cannot be hidden. Leave it empty to keep OneUptime's default.",
  notShownOrHidden: 'Use "shown" or "hidden".',
};

export interface HelpAndSupportSeedProblem {
  item: HelpItem;
  variable: string;
  // Why the value was left out, in English.
  problem: string;
}

export interface HelpAndSupportSeed {
  // Each setting the configuration moves off its default, checked.
  changes: Array<HelpItemChange>;
  // Each value it sets that the page would refuse.
  problems: Array<HelpAndSupportSeedProblem>;
}

type Environment = Readonly<Record<string, string | undefined>>;

/*
 * What one value asks for, before it is checked: the choice and the value
 * the page would post, or null for nothing (empty, or the default).
 */
const toChoice: (
  item: HelpItem,
  raw: string,
) => { choice: string; value: string | null } | null = (
  item: HelpItem,
  raw: string,
): { choice: string; value: string | null } | null => {
  const text: string = raw.trim();
  const word: string = text.toLowerCase();

  if (!text || DEFAULT_WORDS.includes(word)) {
    return null;
  }

  if (SWITCH_ITEMS.includes(item)) {
    if (SHOWN_WORDS.includes(word)) {
      return null;
    }

    if (HIDDEN_WORDS.includes(word) || SWITCH_HIDDEN_WORDS.includes(word)) {
      return { choice: HelpChoice.Hidden, value: null };
    }

    // A word the setting does not know: refused below.
    return { choice: text, value: null };
  }

  if (HIDDEN_WORDS.includes(word)) {
    return { choice: HelpChoice.Hidden, value: null };
  }

  const choices: ReadonlyArray<HelpChoice> = HELP_ITEM_CHOICES[item];

  if (choices.includes(HelpChoice.Text)) {
    return { choice: HelpChoice.Text, value: raw };
  }

  if (
    choices.includes(HelpChoice.Link) &&
    (HAS_SCHEME.test(text) || !choices.includes(HelpChoice.Email))
  ) {
    return { choice: HelpChoice.Link, value: text };
  }

  return { choice: HelpChoice.Email, value: text };
};

// Why a choice that is not one of a setting's was asked for.
const getChoiceProblem: (item: HelpItem) => string = (
  item: HelpItem,
): string => {
  return SWITCH_ITEMS.includes(item)
    ? HelpAndSupportSeedProblems.notShownOrHidden
    : HelpAndSupportSeedProblems.wordNotAChoice;
};

/*
 * What the configuration seeds (`environment`: process.env, as config.env
 * or the Helm chart set it), each value checked as the page checks it.
 */
export const readHelpAndSupportSeed: (
  environment: Environment,
) => HelpAndSupportSeed = (environment: Environment): HelpAndSupportSeed => {
  const seed: HelpAndSupportSeed = { changes: [], problems: [] };

  for (const item of HELP_ITEMS) {
    const variable: string = HELP_AND_SUPPORT_SEED_VARIABLES[item];
    const raw: string | undefined = environment[variable];

    if (typeof raw !== "string") {
      continue;
    }

    const asked: { choice: string; value: string | null } | null = toChoice(
      item,
      raw,
    );

    if (!asked) {
      continue;
    }

    if (
      !(HELP_ITEM_CHOICES[item] as ReadonlyArray<string>).includes(asked.choice)
    ) {
      seed.problems.push({
        item: item,
        variable: variable,
        problem: getChoiceProblem(item),
      });
      continue;
    }

    const change: HelpItemChange | string = readHelpItemChange({
      item: item,
      choice: asked.choice,
      value: asked.value,
    });

    if (typeof change === "string") {
      seed.problems.push({ item: item, variable: variable, problem: change });
      continue;
    }

    seed.changes.push(change);
  }

  return seed;
};

/*
 * The settings as a seed writes them, beside which items it seeded, or
 * null when it moves nothing off its default (nothing is written then, so a
 * value set later still seeds).
 */
export const toSeededHelpAndSupportJSON: (
  seed: HelpAndSupportSeed,
) => JSONObject | null = (seed: HelpAndSupportSeed): JSONObject | null => {
  if (seed.changes.length === 0) {
    return null;
  }

  let settings: HelpAndSupportSettings = getDefaultHelpAndSupportSettings();

  for (const change of seed.changes) {
    settings = withHelpItemChanged(settings, change);
  }

  return {
    ...toHelpAndSupportJSON(settings),
    [SEEDED_ITEMS_KEY]: seed.changes.map((change: HelpItemChange): string => {
      return change.item;
    }),
  };
};

/*
 * The items the settings say were seeded and are still as seeded: an item
 * an admin changed since - or put back on its default - is no longer one.
 */
export const readSeededItems: (stored: unknown) => Array<HelpItem> = (
  stored: unknown,
): Array<HelpItem> => {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return [];
  }

  const listed: unknown = (stored as Record<string, unknown>)[SEEDED_ITEMS_KEY];

  if (!Array.isArray(listed)) {
    return [];
  }

  const settings: HelpAndSupportSettings = readHelpAndSupportSettings(stored);

  return HELP_ITEMS.filter((item: HelpItem): boolean => {
    return (
      listed.includes(item) &&
      isHelpItem(item) &&
      settings[item].choice !== HelpChoice.Default
    );
  });
};

/*
 * The settings as the page saves them after one change, keeping the record
 * of what was seeded - but for the item changed, which is the admin's own
 * from now on. The settings themselves are what the change makes them
 * (toHelpAndSupportJSON of the settings after it).
 */
export const withSeededItemsKept: (data: {
  stored: unknown;
  next: HelpAndSupportSettings;
  changedItem: HelpItem;
}) => JSONObject = (data: {
  stored: unknown;
  next: HelpAndSupportSettings;
  changedItem: HelpItem;
}): JSONObject => {
  const json: JSONObject = toHelpAndSupportJSON(data.next);
  const seeded: Array<HelpItem> = readSeededItems(data.stored).filter(
    (item: HelpItem): boolean => {
      return item !== data.changedItem;
    },
  );

  return seeded.length > 0 ? { ...json, [SEEDED_ITEMS_KEY]: seeded } : json;
};

/*
 * The configured values that differ from what the settings hold: set in
 * the configuration, and not applied, because the settings were saved (or
 * seeded) before. For the server's log, which says the page is where they
 * change.
 */
export const getUnappliedSeedItems: (data: {
  seed: HelpAndSupportSeed;
  settings: HelpAndSupportSettings;
}) => Array<HelpItem> = (data: {
  seed: HelpAndSupportSeed;
  settings: HelpAndSupportSettings;
}): Array<HelpItem> => {
  return data.seed.changes
    .filter((change: HelpItemChange): boolean => {
      const held: HelpItemSetting = data.settings[change.item];

      return (
        held.choice !== change.setting.choice ||
        held.value !== change.setting.value
      );
    })
    .map((change: HelpItemChange): HelpItem => {
      return change.item;
    });
};
