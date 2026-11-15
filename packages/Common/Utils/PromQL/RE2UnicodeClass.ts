import lookupTable from "../LookupTable";

/*
 * RE2'S UNICODE CLASSES: \pL, \p{Greek}, \p{^Lu}, \PN.
 *
 * Go's regexp/syntax reads \p{name} as one of Go's Unicode tables
 * (unicodeTable, parse.go): a general category (unicode.Categories: L, Lu,
 * Nd, ...), a script (unicode.Scripts: Greek, Han, ...), or Any. Prometheus
 * reads a pattern with two copies of that package (issue #8216):
 *
 *  - Its label matchers, =~ and !~, parse with github.com/grafana/regexp's
 *    copy, from before Go 1.25 (NewFastRegexMatcher, model/labels/regexp.go):
 *    a name is a table's own, as Go writes it - \p{Greek}, not \p{greek} or
 *    \p{Letter}.
 *  - label_replace() compiles with the Go toolchain's own regexp/syntax,
 *    which since Go 1.25 reads a name in any case and with any "_", "-" or
 *    space in it (canonicalName: \p{greek}, \p{Old Italic}), a category's
 *    long name (unicode.CategoryAliases: \p{Letter}), Assigned and ASCII.
 *
 * The names are those of Go 1.27's tables, which Prometheus 3.16.0 is built
 * with (Unicode 17.0.0). The code points of each are read from the running
 * engine's own property escapes, \p{gc=Lu} and \p{sc=Greek} (Node 26 reads
 * Unicode 17.0 too), once per table, when a pattern first names it. Each
 * table holds the same code points in both, compared one by one
 * (RE2UnicodeClass.test.ts holds the engine to that, so a Node release that
 * moves to another Unicode version fails there rather than matching
 * otherwise unseen).
 *
 * The surrogates, U+D800 to U+DFFF, are left out of every table: RE2 reads
 * UTF-8, which holds none, so no pattern matches one.
 */

// unicode.Categories, Go 1.27: the general categories, and LC.
const CATEGORY_NAMES: ReadonlySet<string> = new Set<string>(
  `C Cc Cf Cn Co Cs L LC Ll Lm Lo Lt Lu M Mc Me Mn N Nd Nl No P Pc Pd Pe Pf
  Pi Po Ps S Sc Sk Sm So Z Zl Zp Zs`.split(/\s+/),
);

// unicode.Scripts, Go 1.27 (Unicode 17.0.0): each script's long name.
const SCRIPT_NAMES: ReadonlySet<string> = new Set<string>(
  `Adlam Ahom Anatolian_Hieroglyphs Arabic Armenian Avestan Balinese Bamum
  Bassa_Vah Batak Bengali Beria_Erfe Bhaiksuki Bopomofo Brahmi Braille
  Buginese Buhid Canadian_Aboriginal Carian Caucasian_Albanian Chakma Cham
  Cherokee Chorasmian Common Coptic Cuneiform Cypriot Cypro_Minoan
  Cyrillic Deseret Devanagari Dives_Akuru Dogra Duployan
  Egyptian_Hieroglyphs Elbasan Elymaic Ethiopic Garay Georgian Glagolitic
  Gothic Grantha Greek Gujarati Gunjala_Gondi Gurmukhi Gurung_Khema Han
  Hangul Hanifi_Rohingya Hanunoo Hatran Hebrew Hiragana Imperial_Aramaic
  Inherited Inscriptional_Pahlavi Inscriptional_Parthian Javanese Kaithi
  Kannada Katakana Kawi Kayah_Li Kharoshthi Khitan_Small_Script Khmer
  Khojki Khudawadi Kirat_Rai Lao Latin Lepcha Limbu Linear_A Linear_B Lisu
  Lycian Lydian Mahajani Makasar Malayalam Mandaic Manichaean Marchen
  Masaram_Gondi Medefaidrin Meetei_Mayek Mende_Kikakui Meroitic_Cursive
  Meroitic_Hieroglyphs Miao Modi Mongolian Mro Multani Myanmar Nabataean
  Nag_Mundari Nandinagari New_Tai_Lue Newa Nko Nushu
  Nyiakeng_Puachue_Hmong Ogham Ol_Chiki Ol_Onal Old_Hungarian Old_Italic
  Old_North_Arabian Old_Permic Old_Persian Old_Sogdian Old_South_Arabian
  Old_Turkic Old_Uyghur Oriya Osage Osmanya Pahawh_Hmong Palmyrene
  Pau_Cin_Hau Phags_Pa Phoenician Psalter_Pahlavi Rejang Runic Samaritan
  Saurashtra Sharada Shavian Siddham Sidetic SignWriting Sinhala Sogdian
  Sora_Sompeng Soyombo Sundanese Sunuwar Syloti_Nagri Syriac Tagalog
  Tagbanwa Tai_Le Tai_Tham Tai_Viet Tai_Yo Takri Tamil Tangsa Tangut
  Telugu Thaana Thai Tibetan Tifinagh Tirhuta Todhri Tolong_Siki Toto
  Tulu_Tigalari Ugaritic Vai Vithkuqi Wancho Warang_Citi Yezidi Yi
  Zanabazar_Square`.split(/\s+/),
);

// unicode.CategoryAliases, Go 1.27: each category's long name, and three more.
const CATEGORY_ALIASES: ReadonlyMap<string, string> = lookupTable<string>({
  Cased_Letter: "LC",
  Close_Punctuation: "Pe",
  Combining_Mark: "M",
  Connector_Punctuation: "Pc",
  Control: "Cc",
  Currency_Symbol: "Sc",
  Dash_Punctuation: "Pd",
  Decimal_Number: "Nd",
  Enclosing_Mark: "Me",
  Final_Punctuation: "Pf",
  Format: "Cf",
  Initial_Punctuation: "Pi",
  Letter: "L",
  Letter_Number: "Nl",
  Line_Separator: "Zl",
  Lowercase_Letter: "Ll",
  Mark: "M",
  Math_Symbol: "Sm",
  Modifier_Letter: "Lm",
  Modifier_Symbol: "Sk",
  Nonspacing_Mark: "Mn",
  Number: "N",
  Open_Punctuation: "Ps",
  Other: "C",
  Other_Letter: "Lo",
  Other_Number: "No",
  Other_Punctuation: "Po",
  Other_Symbol: "So",
  Paragraph_Separator: "Zp",
  Private_Use: "Co",
  Punctuation: "P",
  Separator: "Z",
  Space_Separator: "Zs",
  Spacing_Mark: "Mc",
  Surrogate: "Cs",
  Symbol: "S",
  Titlecase_Letter: "Lt",
  Unassigned: "Cn",
  Uppercase_Letter: "Lu",
  cntrl: "Cc",
  digit: "Nd",
  punct: "P",
});

// The classes no table holds (unicodeTable): every code point, ...
const ANY: string = "Any";
// ... every code point Unicode assigns, \P{Cn} (label_replace() only), ...
const ASSIGNED: string = "Assigned";
// ... and U+0000 to U+007F (label_replace() only).
const ASCII: string = "ASCII";

/*
 * The tables Go folds under (?i): those unicode.FoldCategory and
 * unicode.FoldScript have a table of other cases for, and the three above.
 * Go reads every other table as it is under (?i) too, so (?i)\p{LC} is the
 * cased letters alone, without U+0345, which folds to ι and is a mark.
 */
const FOLDED_TABLES: ReadonlySet<string> = new Set<string>([
  "L",
  "Ll",
  "Lt",
  "Lu",
  "M",
  "Mn",
  "Common",
  "Greek",
  "Inherited",
  ANY,
  ASSIGNED,
  ASCII,
]);

const SURROGATE_FIRST: number = 0xd800;
const SURROGATE_LAST: number = 0xdfff;
const MAX_CODE_POINT: number = 0x10ffff;

/*
 * Go's canonicalName (regexp/syntax, parse.go): without "_", "-" or space,
 * its first character in upper case and the others in lower case, ASCII
 * letters only. So "old italic", "Old_Italic" and "OLD-ITALIC" are one name.
 */
const canonicalName: (name: string) => string = (name: string): string => {
  let canonical: string = "";
  let first: boolean = true;

  for (let index: number = 0; index < name.length; index++) {
    let codeUnit: number = name.charCodeAt(index);

    if (codeUnit === 0x5f || codeUnit === 0x2d || codeUnit === 0x20) {
      continue;
    }

    if (first) {
      if (codeUnit >= 0x61 && codeUnit <= 0x7a) {
        codeUnit -= 0x20;
      }

      first = false;
    } else if (codeUnit >= 0x41 && codeUnit <= 0x5a) {
      codeUnit += 0x20;
    }

    canonical += String.fromCharCode(codeUnit);
  }

  return canonical;
};

// The table each canonical name label_replace() reads names.
const TABLE_BY_CANONICAL_NAME: ReadonlyMap<string, string> = ((): Map<
  string,
  string
> => {
  /*
   * In the order unicodeTable looks a name up, the first found kept: the
   * classes no table holds and LC, a table's own name where it is already
   * canonical (a category before a script), then the categories' long
   * names and every script's canonical name.
   */
  const tables: Map<string, string> = new Map<string, string>([
    [ANY, ANY],
    [ASSIGNED, ASSIGNED],
    ["Ascii", ASCII],
    ["Lc", "LC"],
  ]);
  const add: (canonical: string, table: string) => void = (
    canonical: string,
    table: string,
  ): void => {
    if (!tables.has(canonical)) {
      tables.set(canonical, table);
    }
  };

  for (const table of [...CATEGORY_NAMES, ...SCRIPT_NAMES]) {
    if (table === canonicalName(table)) {
      add(table, table);
    }
  }

  for (const [alias, category] of CATEGORY_ALIASES) {
    add(canonicalName(alias), category);
  }

  for (const script of SCRIPT_NAMES) {
    add(canonicalName(script), script);
  }

  return tables;
})();

/*
 * The table \p{name} reads, by the name Go's tables give it ("L", "Greek",
 * "Any"; and "Assigned" and "ASCII" in label_replace()), or undefined for a
 * name Prometheus does not read: a label matcher reads a table's own name
 * as Go writes it, label_replace() any name canonicalName makes one of.
 */
export const unicodeTableName: (data: {
  name: string;
  readsAliases: boolean;
}) => string | undefined = (data: {
  name: string;
  readsAliases: boolean;
}): string | undefined => {
  if (data.readsAliases) {
    return TABLE_BY_CANONICAL_NAME.get(canonicalName(data.name));
  }

  return data.name === ANY ||
    CATEGORY_NAMES.has(data.name) ||
    SCRIPT_NAMES.has(data.name)
    ? data.name
    : undefined;
};

// Whether (?i) adds a table's other cases, as Go adds them (FOLDED_TABLES).
export const unicodeTableFolds: (table: string) => boolean = (
  table: string,
): boolean => {
  return FOLDED_TABLES.has(table);
};

/*
 * The class label_replace() reads by this name, as a label matcher writes
 * it - \p{L} for \p{Letter}, \p{Greek} for \p{greek} - for the sentence that
 * refuses it in a matcher; undefined when label_replace() reads no class by
 * that name either.
 */
export const unicodeClassAsMatchersWriteIt: (data: {
  name: string;
  negated: boolean;
}) => string | undefined = (data: {
  name: string;
  negated: boolean;
}): string | undefined => {
  const table: string | undefined = unicodeTableName({
    name: data.name,
    readsAliases: true,
  });

  switch (table) {
    case undefined:
      return undefined;
    case ASSIGNED:
      // Every code point but those Unicode leaves unassigned.
      return data.negated ? "\\p{Cn}" : "\\P{Cn}";
    case ASCII:
      return data.negated ? "[[:^ascii:]]" : "[[:ascii:]]";
    default:
      return `\\${data.negated ? "P" : "p"}{${table}}`;
  }
};

/*
 * The code points the running engine's property escape holds, as ranges
 * [first0, last0, first1, last1, ...]: each code point but the surrogates
 * tested once. `property` is gc=<category> or sc=<script>, a name of Go's
 * tables above.
 */
const readProperty: (property: string) => Array<number> = (
  property: string,
): Array<number> => {
  // Built from a table's name this file lists, never from a pattern's text.
  const holds: RegExp = new RegExp(`^\\p{${property}}$`, "u");
  const ranges: Array<number> = [];
  let start: number = -1;

  for (let codePoint: number = 0; codePoint <= MAX_CODE_POINT; codePoint++) {
    const member: boolean =
      (codePoint < SURROGATE_FIRST || codePoint > SURROGATE_LAST) &&
      holds.test(String.fromCodePoint(codePoint));

    if (member) {
      if (start < 0) {
        start = codePoint;
      }
    } else if (start >= 0) {
      ranges.push(start, codePoint - 1);
      start = -1;
    }
  }

  if (start >= 0) {
    ranges.push(start, MAX_CODE_POINT);
  }

  return ranges;
};

// Every code point the ranges leave out, but the surrogates.
const otherThan: (ranges: ReadonlyArray<number>) => Array<number> = (
  ranges: ReadonlyArray<number>,
): Array<number> => {
  const others: Array<number> = [];
  const add: (from: number, to: number) => void = (
    from: number,
    to: number,
  ): void => {
    const belowSurrogates: number = Math.min(to, SURROGATE_FIRST - 1);
    const aboveSurrogates: number = Math.max(from, SURROGATE_LAST + 1);

    if (from <= belowSurrogates) {
      others.push(from, belowSurrogates);
    }

    if (aboveSurrogates <= to) {
      others.push(aboveSurrogates, to);
    }
  };
  let next: number = 0;

  for (let index: number = 0; index < ranges.length; index += 2) {
    add(next, ranges[index]! - 1);
    next = ranges[index + 1]! + 1;
  }

  add(next, MAX_CODE_POINT);

  return others;
};

// The code points of each table read so far, by the table's name.
const membersByTable: Map<string, ReadonlyArray<number>> = new Map<
  string,
  ReadonlyArray<number>
>();

/*
 * The code points of a table unicodeTableName named, the surrogates left
 * out: ranges [first0, last0, first1, last1, ...], sorted, none touching
 * another.
 */
export const unicodeTableMembers: (table: string) => ReadonlyArray<number> = (
  table: string,
): ReadonlyArray<number> => {
  const known: ReadonlyArray<number> | undefined = membersByTable.get(table);

  if (known !== undefined) {
    return known;
  }

  let members: ReadonlyArray<number>;

  if (table === ANY) {
    members = otherThan([]);
  } else if (table === ASSIGNED) {
    members = otherThan(unicodeTableMembers("Cn"));
  } else if (table === ASCII) {
    members = [0x00, 0x7f];
  } else if (CATEGORY_NAMES.has(table)) {
    members = readProperty(`gc=${table}`);
  } else if (SCRIPT_NAMES.has(table)) {
    members = readProperty(`sc=${table}`);
  } else {
    throw new Error(`Go has no Unicode table named ${table}.`);
  }

  membersByTable.set(table, members);

  return members;
};

// Go's tables' names, for the test that holds the running engine to them.
export const UNICODE_CATEGORY_NAMES: ReadonlyArray<string> =
  Array.from(CATEGORY_NAMES);
export const UNICODE_SCRIPT_NAMES: ReadonlyArray<string> =
  Array.from(SCRIPT_NAMES);
