import IP from "../../Types/IP/IP";

/*
 * HOW LIKE A DEVICE A THING FROM ELSEWHERE IS, BY ITS NAMES AND SERIAL
 * NUMBER - a Meraki appliance a router may be (issue #5762), a device a
 * discovery found - so that a picker can offer the likely ones first.
 *
 * "Link to a Meraki appliance" lists every appliance a project's Meraki
 * connections report: hundreds, for an estate of branches. The router a
 * person is looking at is nearly always named after the same branch as its
 * appliance - "ST2207EDGEGW01" beside "STORE 2207 MX" - so the appliances
 * whose names share that much come first, and the person confirms one.
 *
 * Only an ORDER, never a match: nothing here ties two things together, a
 * person does, so the rules may be generous - and each is one a picker can
 * say on screen. The best one found counts:
 *
 *   1. the same serial number, case and padding aside              100
 *   2. the same name, case, spaces and punctuation aside            90
 *   3. one name holds the other whole (four characters or more)     70
 *   4. a number written with three digits or more in both, its
 *      leading zeros aside ("012" is "12") - the branch, store or
 *      unit number most estates name their things by                50
 *   5. a word of four letters or more in both that is not one
 *      every network device's name could have (router, meraki...)   30
 *
 * LIKELY_NAME_SCORE (50) is where "likely" starts: a shared word alone
 * ("Leeds") is a hint, not enough to be offered first.
 *
 * An address is never a name here. A device's polled address, or a name
 * that is one, would be likened by its octets: 10.20.113.5 is not store 113.
 *
 * Pure, and linear in the names' length: names are typed by people and
 * reported by controllers, so they are read character by character, never
 * by a pattern that can backtrack.
 */

export enum NameLikenessReason {
  SerialNumber = "serialNumber",
  Name = "name",
  NameWithin = "nameWithin",
  Number = "number",
  Word = "word",
}

export interface NameLikeness {
  // 0 when nothing is alike.
  score: number;
  reason?: NameLikenessReason | undefined;
  // The number or word both have (rules 4 and 5), as the other side writes it.
  shared?: string | undefined;
}

export const NAME_LIKENESS_SCORES: Readonly<
  Record<NameLikenessReason, number>
> = {
  [NameLikenessReason.SerialNumber]: 100,
  [NameLikenessReason.Name]: 90,
  [NameLikenessReason.NameWithin]: 70,
  [NameLikenessReason.Number]: 50,
  [NameLikenessReason.Word]: 30,
};

// Where "likely" starts: a shared number, or better.
export const LIKELY_NAME_SCORE: number = 50;

// The shortest name rule 3 compares whole, and the shortest word rule 5 does.
export const MIN_NAME_WITHIN_LENGTH: number = 4;
export const MIN_SHARED_WORD_LENGTH: number = 4;
// The fewest digits a shared number is written with, leading zeros included.
export const MIN_SHARED_NUMBER_LENGTH: number = 3;

/*
 * The longest text read of any one name: a device's name and the names
 * controllers report are a few dozen characters, and a picker never needs
 * more to tell two apart.
 */
export const MAX_LIKENESS_NAME_LENGTH: number = 255;

/*
 * Words every network device could be called by, in the languages names
 * are written in most: no hint which device a name is of.
 */
export const GENERIC_NAME_WORDS: ReadonlySet<string> = new Set<string>([
  "access",
  "appliance",
  "backup",
  "branch",
  "campus",
  "cisco",
  "core",
  "device",
  "edge",
  "firewall",
  "gateway",
  "internet",
  "main",
  "meraki",
  "network",
  "office",
  "point",
  "primary",
  "router",
  "secondary",
  "security",
  "site",
  "spare",
  "store",
  "switch",
  "teleworker",
  "unit",
  "uplink",
  "warm",
  "wireless",
]);

const LETTER: RegExp = /^\p{L}$/u;

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isLetter(character: string): boolean {
  return LETTER.test(character);
}

/*
 * A name worth reading: text, cut to MAX_LIKENESS_NAME_LENGTH, and never an
 * address (see the header).
 */
function readName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const name: string = value.trim().substring(0, MAX_LIKENESS_NAME_LENGTH);

  return name && !IP.isIP(name) ? name : "";
}

export function toSerialKey(value: unknown): string {
  return typeof value === "string"
    ? value.trim().substring(0, MAX_LIKENESS_NAME_LENGTH).toUpperCase()
    : "";
}

/*
 * A name with its case, spaces and punctuation taken out: "ST-2207 edge
 * gw/01" is "st2207edgegw01". Letters of every script stay.
 */
export function toCompactName(value: unknown): string {
  const name: string = readName(value).toLowerCase();
  let compact: string = "";

  for (const character of name) {
    if (isDigit(character) || isLetter(character)) {
      compact += character;
    }
  }

  return compact;
}

export interface NameTokens {
  // Runs of three digits or more as written, their leading zeros taken off.
  numbers: Array<string>;
  // Runs of letters, in lower case, four or more, generic ones left out.
  words: Array<string>;
}

/*
 * A name's numbers and words: the runs of digits and of letters it is made
 * of, whatever separates them - "ST2207EDGEGW01" is st, 2207, edgegw, 01.
 */
export function getNameTokens(value: unknown): NameTokens {
  const name: string = readName(value).toLowerCase();
  const numbers: Array<string> = [];
  const words: Array<string> = [];
  let run: string = "";
  let runKind: "digit" | "letter" | null = null;

  const endRun: () => void = (): void => {
    /*
     * A number as long as it is written ("012" is a branch number of three
     * digits), compared without its leading zeros ("012" is "12" is "0012").
     */
    if (runKind === "digit" && run.length >= MIN_SHARED_NUMBER_LENGTH) {
      let start: number = 0;

      while (start < run.length - 1 && run[start] === "0") {
        start++;
      }

      const number: string = run.substring(start);

      if (!numbers.includes(number)) {
        numbers.push(number);
      }
    } else if (
      runKind === "letter" &&
      run.length >= MIN_SHARED_WORD_LENGTH &&
      !GENERIC_NAME_WORDS.has(run) &&
      !words.includes(run)
    ) {
      words.push(run);
    }

    run = "";
    runKind = null;
  };

  for (const character of name) {
    const kind: "digit" | "letter" | null = isDigit(character)
      ? "digit"
      : isLetter(character)
        ? "letter"
        : null;

    if (kind !== runKind) {
      endRun();
    }

    if (kind) {
      run += character;
      runKind = kind;
    }
  }

  endRun();

  return { numbers, words };
}

function liken(reason: NameLikenessReason, shared?: string): NameLikeness {
  return {
    score: NAME_LIKENESS_SCORES[reason],
    reason,
    ...(shared ? { shared } : {}),
  };
}

/*
 * How like the device the other thing is, by the rules in the header: the
 * best rule any of the device's names meets with any of the other's.
 */
export function getNameLikeness(data: {
  // The device: its names (its name, its system name, its host name) and serial numbers.
  names: Array<unknown>;
  serials?: Array<unknown> | undefined;
  // The other: its names (its own, and its network's) and its serial number.
  otherNames: Array<unknown>;
  otherSerial?: unknown;
}): NameLikeness {
  const otherSerial: string = toSerialKey(data.otherSerial);

  if (
    otherSerial &&
    (data.serials || []).some((serial: unknown): boolean => {
      return toSerialKey(serial) === otherSerial;
    })
  ) {
    return liken(NameLikenessReason.SerialNumber);
  }

  const names: Array<string> = data.names.map(readName).filter(Boolean);
  const otherNames: Array<string> = data.otherNames
    .map(readName)
    .filter(Boolean);

  if (names.length === 0 || otherNames.length === 0) {
    return { score: 0 };
  }

  const compact: Array<string> = names.map(toCompactName).filter(Boolean);
  const otherCompact: Array<string> = otherNames
    .map(toCompactName)
    .filter(Boolean);

  // Rule 2: the same name.
  for (const name of compact) {
    if (otherCompact.includes(name)) {
      return liken(NameLikenessReason.Name);
    }
  }

  // Rule 3: one name holds the other whole.
  for (const name of compact) {
    for (const other of otherCompact) {
      const shorter: string = name.length <= other.length ? name : other;
      const longer: string = name.length <= other.length ? other : name;

      if (
        shorter.length >= MIN_NAME_WITHIN_LENGTH &&
        longer.includes(shorter)
      ) {
        return liken(NameLikenessReason.NameWithin);
      }
    }
  }

  const tokens: Array<NameTokens> = names.map(getNameTokens);
  const numbers: Set<string> = new Set<string>(
    tokens.flatMap((token: NameTokens): Array<string> => {
      return token.numbers;
    }),
  );
  const words: Set<string> = new Set<string>(
    tokens.flatMap((token: NameTokens): Array<string> => {
      return token.words;
    }),
  );
  const otherTokens: Array<NameTokens> = otherNames.map(getNameTokens);

  // Rule 4: a number in both. The longest one says the most.
  const sharedNumbers: Array<string> = otherTokens
    .flatMap((token: NameTokens): Array<string> => {
      return token.numbers;
    })
    .filter((number: string): boolean => {
      return numbers.has(number);
    })
    .sort((a: string, b: string): number => {
      return b.length - a.length;
    });

  if (sharedNumbers[0]) {
    return liken(NameLikenessReason.Number, sharedNumbers[0]);
  }

  // Rule 5: a word in both.
  const sharedWord: string | undefined = otherTokens
    .flatMap((token: NameTokens): Array<string> => {
      return token.words;
    })
    .find((word: string): boolean => {
      return words.has(word);
    });

  if (sharedWord) {
    return liken(NameLikenessReason.Word, sharedWord);
  }

  return { score: 0 };
}

export function isLikelyName(likeness: NameLikeness): boolean {
  return likeness.score >= LIKELY_NAME_SCORE;
}
