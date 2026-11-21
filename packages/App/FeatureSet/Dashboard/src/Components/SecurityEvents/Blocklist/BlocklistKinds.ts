import {
  ADDRESS_FIELD_DESCRIPTION,
  ADDRESS_FIELD_PLACEHOLDER,
  ADDRESS_FIELD_TITLE,
  ADDRESS_COLUMN_TITLE,
  BLOCKLIST_EMPTY_DESCRIPTION,
  BLOCK_ADDRESS_DESCRIPTION,
  BLOCK_ADDRESS_TITLE,
  BLOCK_PLURAL,
  BLOCK_SINGULAR,
  BLOCK_DOMAIN_DESCRIPTION,
  BLOCK_DOMAIN_TITLE,
  BLOCK_FILE_DESCRIPTION,
  BLOCK_FILE_TITLE,
  DOMAINS_EMPTY_DESCRIPTION,
  DOMAIN_COLUMN_TITLE,
  DOMAIN_FIELD_DESCRIPTION,
  DOMAIN_FIELD_PLACEHOLDER,
  DOMAIN_FIELD_TITLE,
  DOMAIN_PLURAL,
  DOMAIN_SINGULAR,
  FILES_EMPTY_DESCRIPTION,
  FILE_COLUMN_TITLE,
  FILE_FIELD_DESCRIPTION,
  FILE_FIELD_PLACEHOLDER,
  FILE_FIELD_TITLE,
  FILE_PLURAL,
  FILE_SINGULAR,
  NOT_A_DOMAIN_OR_URL,
  NOT_A_FILE_HASH,
} from "./BlocklistCopy";
import {
  SECURITY_BLOCK_ADDRESS_TYPES,
  SECURITY_BLOCK_DEFAULT_DURATION,
  SECURITY_BLOCK_FILE_TYPES,
  SECURITY_BLOCK_SENTENCES,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockIndicatorValue,
  SecurityBlockSentence,
  getSecurityBlockValueSentence,
  readSecurityBlockIndicator,
} from "Common/Types/SecurityBlocklist/SecurityBlock";

/*
 * THE BLOCKLIST, BY WHAT IT HOLDS (#10346): the page groups its blocks in a
 * tab of each kind - addresses at the edge (or everywhere), domains and
 * URLs and files on every machine - and each tab blocks its own kind, with
 * the words and the field that kind takes. React-free, so the rules are
 * pinned in a plain test.
 */

export enum BlocklistKind {
  Addresses = "Addresses",
  DomainsAndUrls = "DomainsAndUrls",
  Files = "Files",
}

export const BLOCKLIST_KINDS: ReadonlyArray<BlocklistKind> = [
  BlocklistKind.Addresses,
  BlocklistKind.DomainsAndUrls,
  BlocklistKind.Files,
];

export interface BlocklistKindWords {
  // The tab's name, and the list's plural: "Addresses".
  plural: string;
  singular: string;
  // The column that shows the value.
  valueColumnTitle: string;
  // The dialog that blocks one, and its button: "Block Address".
  blockTitle: string;
  blockDescription: string;
  fieldTitle: string;
  fieldDescription: string;
  fieldPlaceholder: string;
  emptyDescription: string;
}

export const BLOCKLIST_KIND_WORDS: Readonly<
  Record<BlocklistKind, BlocklistKindWords>
> = {
  [BlocklistKind.Addresses]: {
    plural: BLOCK_PLURAL,
    singular: BLOCK_SINGULAR,
    valueColumnTitle: ADDRESS_COLUMN_TITLE,
    blockTitle: BLOCK_ADDRESS_TITLE,
    blockDescription: BLOCK_ADDRESS_DESCRIPTION,
    fieldTitle: ADDRESS_FIELD_TITLE,
    fieldDescription: ADDRESS_FIELD_DESCRIPTION,
    fieldPlaceholder: ADDRESS_FIELD_PLACEHOLDER,
    emptyDescription: BLOCKLIST_EMPTY_DESCRIPTION,
  },
  [BlocklistKind.DomainsAndUrls]: {
    plural: DOMAIN_PLURAL,
    singular: DOMAIN_SINGULAR,
    valueColumnTitle: DOMAIN_COLUMN_TITLE,
    blockTitle: BLOCK_DOMAIN_TITLE,
    blockDescription: BLOCK_DOMAIN_DESCRIPTION,
    fieldTitle: DOMAIN_FIELD_TITLE,
    fieldDescription: DOMAIN_FIELD_DESCRIPTION,
    fieldPlaceholder: DOMAIN_FIELD_PLACEHOLDER,
    emptyDescription: DOMAINS_EMPTY_DESCRIPTION,
  },
  [BlocklistKind.Files]: {
    plural: FILE_PLURAL,
    singular: FILE_SINGULAR,
    valueColumnTitle: FILE_COLUMN_TITLE,
    blockTitle: BLOCK_FILE_TITLE,
    blockDescription: BLOCK_FILE_DESCRIPTION,
    fieldTitle: FILE_FIELD_TITLE,
    fieldDescription: FILE_FIELD_DESCRIPTION,
    fieldPlaceholder: FILE_FIELD_PLACEHOLDER,
    emptyDescription: FILES_EMPTY_DESCRIPTION,
  },
};

/*
 * How long a tab's dialog blocks for unless chosen: an address for a day -
 * soon someone else's - a domain or a URL for 7 days and a file for 30, as
 * the Response Plan's one click blocks them: a file's hash is never anyone
 * else's.
 */
export const BLOCKLIST_KIND_DEFAULT_DURATIONS: Readonly<
  Record<BlocklistKind, SecurityBlockDuration>
> = {
  [BlocklistKind.Addresses]: SECURITY_BLOCK_DEFAULT_DURATION,
  [BlocklistKind.DomainsAndUrls]: SecurityBlockDuration.SevenDays,
  [BlocklistKind.Files]: SecurityBlockDuration.ThirtyDays,
};

// The kinds of value each tab holds.
export const BLOCKLIST_KIND_TYPES: Readonly<
  Record<BlocklistKind, ReadonlyArray<SecurityBlockIndicatorType>>
> = {
  [BlocklistKind.Addresses]: SECURITY_BLOCK_ADDRESS_TYPES,
  [BlocklistKind.DomainsAndUrls]: [
    SecurityBlockIndicatorType.Domain,
    SecurityBlockIndicatorType.Url,
  ],
  [BlocklistKind.Files]: SECURITY_BLOCK_FILE_TYPES,
};

// The tab a block of this kind of value is listed in.
export function getBlocklistKind(
  indicatorType: SecurityBlockIndicatorType | string | undefined | null,
): BlocklistKind {
  for (const kind of BLOCKLIST_KINDS) {
    if (
      (BLOCKLIST_KIND_TYPES[kind] as ReadonlyArray<string>).includes(
        indicatorType || "",
      )
    ) {
      return kind;
    }
  }

  return BlocklistKind.Addresses;
}

// What a tab's field says when what was typed is a value, but of another tab's kind.
const OTHER_KIND_SENTENCES: Readonly<Record<BlocklistKind, string>> = {
  [BlocklistKind.Addresses]: SECURITY_BLOCK_SENTENCES.notAnAddress,
  [BlocklistKind.DomainsAndUrls]: NOT_A_DOMAIN_OR_URL,
  [BlocklistKind.Files]: NOT_A_FILE_HASH,
};

// What a tab's field says while nothing is typed.
const ENTER_SENTENCES: Readonly<Record<BlocklistKind, string>> = {
  [BlocklistKind.Addresses]: SECURITY_BLOCK_SENTENCES.enterAddress,
  [BlocklistKind.DomainsAndUrls]: NOT_A_DOMAIN_OR_URL,
  [BlocklistKind.Files]: NOT_A_FILE_HASH,
};

/*
 * What is wrong with what was typed in a tab's dialog, as a sentence with
 * its values, or null: the shared rules' answer (missing, not a value,
 * a range too wide, a URL too long...), else - for a value of another kind
 * - what this tab takes.
 */
export function getBlocklistKindSentence(data: {
  kind: BlocklistKind;
  value: unknown;
  mayBlockWideRanges: boolean;
}): SecurityBlockSentence | null {
  const text: string = typeof data.value === "string" ? data.value.trim() : "";

  // Nothing typed: this tab's own words for what it takes.
  if (!text) {
    return { template: ENTER_SENTENCES[data.kind], values: {} };
  }

  const read: SecurityBlockIndicatorValue | null =
    readSecurityBlockIndicator(text);

  if (read && getBlocklistKind(read.indicatorType) !== data.kind) {
    return { template: OTHER_KIND_SENTENCES[data.kind], values: {} };
  }

  const sentence: SecurityBlockSentence | null = getSecurityBlockValueSentence({
    value: text,
    mayBlockWideRanges: data.mayBlockWideRanges,
  });

  // Not a value of any kind: say what this tab takes, not every kind there is.
  if (sentence && sentence.template === SECURITY_BLOCK_SENTENCES.notAValue) {
    return { template: OTHER_KIND_SENTENCES[data.kind], values: {} };
  }

  return sentence;
}
