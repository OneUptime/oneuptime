import {
  CompiledPromQLRegex,
  compilePromQLRegex,
  describePromQLPatternProblem,
  MAX_WRITTEN_PATTERN_LENGTH,
  PromQLPatternError,
} from "../../../Utils/PromQL/PromQLRegex";
import {
  UNICODE_CATEGORY_NAMES,
  UNICODE_SCRIPT_NAMES,
  unicodeClassAsMatchersWriteIt,
  unicodeTableFolds,
  unicodeTableMembers,
  unicodeTableName,
} from "../../../Utils/PromQL/RE2UnicodeClass";
import { MAX_PATTERN_LENGTH } from "../../../Utils/LinearRegExp/LinearRegExp";
import { PatternProblemError } from "../../../Utils/LinearRegExp/PatternProblem";
import { describe, expect, test } from "@jest/globals";

/*
 * RE2's Unicode classes in PromQL label patterns (issue #8216): \pL,
 * \p{Lu}, \p{Greek}, \PN, \p{^Han}, in a bracket or outside one, read as
 * Prometheus 3.16.0 reads them - its label matchers by the names of Go
 * 1.27's tables as written, its label_replace() by any name Go's own
 * regexp/syntax reads (RE2UnicodeClass.ts). Every answer marked as
 * Prometheus' is what Prometheus v0.316.0's own code answered
 * (labels.NewFastRegexMatcher, and github.com/grafana/regexp for
 * label_replace()), built with Go 1.27.4.
 */

// FNV-1a of a table's ranges, written out: one number for the whole table.
const fingerprintOf: (ranges: ReadonlyArray<number>) => string = (
  ranges: ReadonlyArray<number>,
): string => {
  const text: string = ranges.join(",");
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
};

const codePointsIn: (ranges: ReadonlyArray<number>) => number = (
  ranges: ReadonlyArray<number>,
): number => {
  let count: number = 0;

  for (let index: number = 0; index < ranges.length; index += 2) {
    count += ranges[index + 1]! - ranges[index]! + 1;
  }

  return count;
};

/*
 * Go 1.27's tables (Unicode 17.0.0), the surrogates left out: [name, code
 * points, ranges, fingerprint of the ranges], from the code points Go's
 * regexp/syntax parses \p{name} into. The running engine's property escapes
 * must hold the same: when a Node release moves to another Unicode version,
 * this fails, and the tables are read again from the Go that Prometheus is
 * built with before they are changed here.
 */
const GO_TABLES: ReadonlyArray<[string, number, number, string]> = [
  ["Any", 1112064, 2, "34543d28"],
  ["C", 952433, 742, "a34c3348"],
  ["Cc", 65, 2, "02bbdd14"],
  ["Cf", 170, 21, "7c066b0a"],
  ["Cn", 814730, 735, "bc2912fa"],
  ["Co", 137468, 3, "9e650d31"],
  ["Cs", 0, 0, "811c9dc5"],
  ["L", 145672, 684, "fd639958"],
  ["LC", 4200, 144, "775c6a68"],
  ["Ll", 2283, 664, "38a098df"],
  ["Lm", 410, 79, "f8348ec0"],
  ["Lo", 141062, 537, "32a6999d"],
  ["Lt", 31, 10, "990a02c4"],
  ["Lu", 1886, 655, "f04d730e"],
  ["M", 2543, 327, "36e5ae5e"],
  ["Mc", 471, 193, "b834812d"],
  ["Me", 13, 5, "d6f6c72b"],
  ["Mn", 2059, 365, "3b3dcf8f"],
  ["N", 1924, 146, "4b444deb"],
  ["Nd", 770, 72, "abd9d178"],
  ["Nl", 239, 13, "45a861b9"],
  ["No", 915, 72, "ed279706"],
  ["P", 856, 199, "f9e15cf8"],
  ["Pc", 10, 6, "38211be3"],
  ["Pd", 27, 20, "979b4bd7"],
  ["Pe", 77, 76, "943b461a"],
  ["Pf", 10, 10, "d13c47a3"],
  ["Pi", 12, 11, "1d879ee9"],
  ["Po", 641, 194, "2ee1f2e4"],
  ["Ps", 79, 79, "3950720f"],
  ["S", 8617, 242, "46f30869"],
  ["Sc", 64, 21, "608dcb18"],
  ["Sk", 125, 31, "29338455"],
  ["Sm", 960, 67, "29687ceb"],
  ["So", 7468, 193, "c3a05b0a"],
  ["Z", 19, 8, "f5c86e0a"],
  ["Zl", 1, 1, "4bc9aadd"],
  ["Zp", 1, 1, "16c3dfdf"],
  ["Zs", 17, 7, "9771f23f"],
  ["Adlam", 88, 3, "241a5dd7"],
  ["Ahom", 65, 3, "7d5585cb"],
  ["Anatolian_Hieroglyphs", 583, 1, "df81bbb6"],
  ["Arabic", 1413, 56, "11921b79"],
  ["Armenian", 96, 4, "debe11a1"],
  ["Avestan", 61, 2, "b3ce04d3"],
  ["Balinese", 127, 2, "872c7027"],
  ["Bamum", 657, 2, "5282f5a4"],
  ["Bassa_Vah", 36, 2, "557dbb14"],
  ["Batak", 56, 2, "d0f277ac"],
  ["Bengali", 96, 14, "ab4455f7"],
  ["Beria_Erfe", 50, 2, "352001f7"],
  ["Bhaiksuki", 97, 4, "282917be"],
  ["Bopomofo", 77, 3, "044d58a9"],
  ["Brahmi", 115, 3, "2c233578"],
  ["Braille", 256, 1, "c929a73f"],
  ["Buginese", 30, 2, "e381c160"],
  ["Buhid", 20, 1, "1c9215e6"],
  ["Canadian_Aboriginal", 726, 3, "412feefd"],
  ["Carian", 49, 1, "ef1298d4"],
  ["Caucasian_Albanian", 53, 2, "69f91ca8"],
  ["Chakma", 71, 2, "5c565ca0"],
  ["Cham", 83, 4, "b2dbd274"],
  ["Cherokee", 172, 3, "1de475ba"],
  ["Chorasmian", 28, 1, "161dc1a0"],
  ["Common", 9123, 176, "a7b5a276"],
  ["Coptic", 137, 3, "d1bd48ad"],
  ["Cuneiform", 1234, 4, "97d119d1"],
  ["Cypriot", 55, 6, "5bb9b3aa"],
  ["Cypro_Minoan", 99, 1, "2fa335cc"],
  ["Cyrillic", 508, 10, "904c89e7"],
  ["Deseret", 80, 1, "9c6acc8c"],
  ["Devanagari", 164, 5, "d17ce9ca"],
  ["Dives_Akuru", 72, 8, "9fbd1251"],
  ["Dogra", 60, 1, "9e8ba994"],
  ["Duployan", 143, 5, "79389aad"],
  ["Egyptian_Hieroglyphs", 5105, 2, "64bff40f"],
  ["Elbasan", 40, 1, "929f0042"],
  ["Elymaic", 23, 1, "835f4a73"],
  ["Ethiopic", 523, 36, "a75d6708"],
  ["Garay", 69, 3, "f1756f22"],
  ["Georgian", 173, 10, "c68ca836"],
  ["Glagolitic", 134, 6, "7cd98118"],
  ["Gothic", 27, 1, "7d4d3c7f"],
  ["Grantha", 85, 15, "21603917"],
  ["Greek", 518, 36, "674b3e71"],
  ["Gujarati", 91, 14, "5722d784"],
  ["Gunjala_Gondi", 63, 6, "6202e47b"],
  ["Gurmukhi", 80, 16, "3707fc5e"],
  ["Gurung_Khema", 58, 1, "40a116f1"],
  ["Han", 103351, 21, "c8716162"],
  ["Hangul", 11739, 14, "958c9c6e"],
  ["Hanifi_Rohingya", 50, 2, "c6468eb1"],
  ["Hanunoo", 21, 1, "950010e1"],
  ["Hatran", 26, 3, "7a87df40"],
  ["Hebrew", 134, 9, "705fa1a5"],
  ["Hiragana", 381, 6, "9fb037db"],
  ["Imperial_Aramaic", 31, 2, "5e928f16"],
  ["Inherited", 684, 30, "2f22c0ac"],
  ["Inscriptional_Pahlavi", 27, 2, "2ab8a1c2"],
  ["Inscriptional_Parthian", 30, 2, "3441099f"],
  ["Javanese", 90, 3, "92f18319"],
  ["Kaithi", 68, 2, "272be5ac"],
  ["Kannada", 92, 13, "29cc0694"],
  ["Katakana", 321, 14, "d8e24ade"],
  ["Kawi", 87, 3, "007bf27c"],
  ["Kayah_Li", 47, 2, "b72580d5"],
  ["Kharoshthi", 68, 8, "7bf9aa2a"],
  ["Khitan_Small_Script", 472, 3, "6d2b5810"],
  ["Khmer", 146, 4, "63a702e6"],
  ["Khojki", 65, 2, "c2bf5e97"],
  ["Khudawadi", 69, 2, "cd9eae86"],
  ["Kirat_Rai", 58, 1, "b9292196"],
  ["Lao", 83, 11, "f31cf1b0"],
  ["Latin", 1492, 36, "2b5eb4da"],
  ["Lepcha", 74, 3, "5af780e5"],
  ["Limbu", 68, 5, "d7473e7a"],
  ["Linear_A", 341, 3, "ba5d2a8d"],
  ["Linear_B", 211, 7, "6b60ef7e"],
  ["Lisu", 49, 2, "fe18b6e1"],
  ["Lycian", 29, 1, "95e3de4f"],
  ["Lydian", 27, 2, "1158a086"],
  ["Mahajani", 39, 1, "702de686"],
  ["Makasar", 25, 1, "32bceb29"],
  ["Malayalam", 118, 7, "26d2acec"],
  ["Mandaic", 29, 2, "3faf3c5a"],
  ["Manichaean", 51, 2, "a250fdba"],
  ["Marchen", 68, 3, "4787ddf4"],
  ["Masaram_Gondi", 75, 7, "27800eb2"],
  ["Medefaidrin", 91, 1, "30233461"],
  ["Meetei_Mayek", 79, 3, "dd8e3db3"],
  ["Mende_Kikakui", 213, 2, "cf5715d3"],
  ["Meroitic_Cursive", 90, 3, "2aa80448"],
  ["Meroitic_Hieroglyphs", 32, 1, "11d267e7"],
  ["Miao", 149, 3, "4e0332ea"],
  ["Modi", 79, 2, "eec5dea5"],
  ["Mongolian", 168, 6, "7c822548"],
  ["Mro", 43, 3, "236b80d5"],
  ["Multani", 38, 5, "99b1602c"],
  ["Myanmar", 243, 4, "6eb56589"],
  ["Nabataean", 40, 2, "3d608c1e"],
  ["Nag_Mundari", 42, 1, "a4b4c5c6"],
  ["Nandinagari", 65, 3, "a90a8e0d"],
  ["New_Tai_Lue", 83, 4, "5f714b66"],
  ["Newa", 97, 2, "157c4229"],
  ["Nko", 62, 2, "c33250e1"],
  ["Nushu", 397, 2, "369561aa"],
  ["Nyiakeng_Puachue_Hmong", 71, 4, "f161e646"],
  ["Ogham", 29, 1, "2e304f9d"],
  ["Ol_Chiki", 48, 1, "54a0cc57"],
  ["Ol_Onal", 44, 2, "6e0496fb"],
  ["Old_Hungarian", 108, 3, "8d59c2b7"],
  ["Old_Italic", 39, 2, "d962adce"],
  ["Old_North_Arabian", 32, 1, "f59ed237"],
  ["Old_Permic", 43, 1, "39df60ba"],
  ["Old_Persian", 50, 2, "bf9ebdc3"],
  ["Old_Sogdian", 40, 1, "18315745"],
  ["Old_South_Arabian", 32, 1, "f7fcbbb2"],
  ["Old_Turkic", 73, 1, "8a2bc67b"],
  ["Old_Uyghur", 26, 1, "d887e1ec"],
  ["Oriya", 91, 14, "139a9ecf"],
  ["Osage", 72, 2, "40002490"],
  ["Osmanya", 40, 2, "8ef6fce7"],
  ["Pahawh_Hmong", 127, 5, "38a99a30"],
  ["Palmyrene", 32, 1, "2a1fa85e"],
  ["Pau_Cin_Hau", 57, 1, "daa34112"],
  ["Phags_Pa", 56, 1, "d5cb444a"],
  ["Phoenician", 29, 2, "bdee36c0"],
  ["Psalter_Pahlavi", 29, 3, "09bc839e"],
  ["Rejang", 37, 2, "354df715"],
  ["Runic", 86, 2, "745bb258"],
  ["Samaritan", 61, 2, "4b78af7c"],
  ["Saurashtra", 82, 2, "5eb04614"],
  ["Sharada", 104, 2, "0620665b"],
  ["Shavian", 48, 1, "ccd205ee"],
  ["Siddham", 92, 2, "968ca75d"],
  ["Sidetic", 26, 1, "4f10bdde"],
  ["SignWriting", 672, 3, "8643b9df"],
  ["Sinhala", 111, 13, "d4f6db3f"],
  ["Sogdian", 42, 1, "8ffb6500"],
  ["Sora_Sompeng", 35, 2, "d762bde7"],
  ["Soyombo", 83, 1, "49dafa68"],
  ["Sundanese", 72, 2, "dccaf0ee"],
  ["Sunuwar", 44, 2, "14847fed"],
  ["Syloti_Nagri", 45, 1, "172d6660"],
  ["Syriac", 88, 4, "18ae9dbf"],
  ["Tagalog", 23, 2, "be5f5ca9"],
  ["Tagbanwa", 18, 3, "6d5fba28"],
  ["Tai_Le", 35, 2, "c276355f"],
  ["Tai_Tham", 127, 5, "b7e87cbc"],
  ["Tai_Viet", 72, 2, "3b784fdc"],
  ["Tai_Yo", 55, 3, "3bcfdece"],
  ["Takri", 68, 2, "63a25194"],
  ["Tamil", 123, 18, "954be415"],
  ["Tangsa", 89, 2, "0a245a86"],
  ["Tangut", 7059, 4, "84db71d2"],
  ["Telugu", 101, 13, "a1caa9fb"],
  ["Thaana", 50, 1, "7a9dbe60"],
  ["Thai", 86, 2, "c5fc28db"],
  ["Tibetan", 207, 7, "492eaa59"],
  ["Tifinagh", 59, 3, "bab18b56"],
  ["Tirhuta", 82, 2, "eb6cd5e4"],
  ["Todhri", 52, 1, "b7415e1d"],
  ["Tolong_Siki", 54, 2, "94f782e2"],
  ["Toto", 31, 1, "ca83c17a"],
  ["Tulu_Tigalari", 80, 11, "db1fc457"],
  ["Ugaritic", 31, 2, "663bf857"],
  ["Vai", 300, 1, "9c01263a"],
  ["Vithkuqi", 70, 8, "fb5cc514"],
  ["Wancho", 59, 2, "ae95bfd9"],
  ["Warang_Citi", 84, 2, "4a69b7dc"],
  ["Yezidi", 47, 3, "6770a4a5"],
  ["Yi", 1220, 2, "d390ac71"],
  ["Zanabazar_Square", 72, 1, "34003742"],
];

describe("the Unicode tables are Go's", () => {
  test("Go 1.27's categories and scripts, each once", () => {
    const names: Array<string> = GO_TABLES.map(
      (row: [string, number, number, string]): string => {
        return row[0];
      },
    );

    expect([...UNICODE_CATEGORY_NAMES, ...UNICODE_SCRIPT_NAMES]).toEqual(
      names.slice(1),
    );
    expect(UNICODE_CATEGORY_NAMES).toHaveLength(38);
    expect(UNICODE_SCRIPT_NAMES).toHaveLength(174);
    expect(new Set<string>(names).size).toBe(names.length);
  });

  test.each(GO_TABLES)(
    "%s holds %d code points in %d ranges, as Go's table does",
    (name: string, codePoints: number, ranges: number, fingerprint: string) => {
      const members: ReadonlyArray<number> = unicodeTableMembers(name);

      expect({
        name,
        codePoints: codePointsIn(members),
        ranges: members.length / 2,
        fingerprint: fingerprintOf(members),
      }).toEqual({ name, codePoints, ranges, fingerprint });
    },
  );

  test("leaves the surrogates out of every table, Cs too, and keeps each read once", () => {
    for (const name of ["Any", "C", "Cs", "Cn", "Common"]) {
      const members: ReadonlyArray<number> = unicodeTableMembers(name);

      for (let index: number = 0; index < members.length; index += 2) {
        expect(members[index + 1]! < 0xd800 || members[index]! > 0xdfff).toBe(
          true,
        );
      }

      expect(unicodeTableMembers(name)).toBe(members);
    }

    expect(unicodeTableMembers("Cs")).toEqual([]);
    expect(unicodeTableMembers("ASCII")).toEqual([0x00, 0x7f]);
    // Assigned: every code point but the unassigned ones.
    expect(
      codePointsIn(unicodeTableMembers("Assigned")) +
        codePointsIn(unicodeTableMembers("Cn")),
    ).toBe(codePointsIn(unicodeTableMembers("Any")));
  });

  test("names no table that is not Go's", () => {
    expect(() => {
      return unicodeTableMembers("Unknown");
    }).toThrow("Go has no Unicode table named Unknown.");
  });
});

describe("a class's name, as each of Prometheus' readers reads it", () => {
  /*
   * [name, the table a label matcher reads, the table label_replace()
   * reads], null for a name it refuses. Prometheus answered each.
   */
  test.each([
    ["L", "L", "L"],
    ["Lu", "Lu", "Lu"],
    ["LC", "LC", "LC"],
    ["Cn", "Cn", "Cn"],
    ["Any", "Any", "Any"],
    ["Greek", "Greek", "Greek"],
    ["Old_Italic", "Old_Italic", "Old_Italic"],
    ["SignWriting", "SignWriting", "SignWriting"],
    ["Nko", "Nko", "Nko"],
    ["Common", "Common", "Common"],
    // Go 1.25's regexp/syntax: any case, and "_", "-" or " " anywhere.
    ["Letter", null, "L"],
    ["letter", null, "L"],
    ["LETTER", null, "L"],
    ["l", null, "L"],
    ["Uppercase Letter", null, "Lu"],
    ["uppercase-letter", null, "Lu"],
    ["Cased_Letter", null, "LC"],
    ["lc", null, "LC"],
    ["Lc", null, "LC"],
    ["greek", null, "Greek"],
    ["GREEK", null, "Greek"],
    ["_Greek", null, "Greek"],
    ["Greek_", null, "Greek"],
    ["old italic", null, "Old_Italic"],
    ["OldItalic", null, "Old_Italic"],
    ["signwriting", null, "SignWriting"],
    ["common", null, "Common"],
    ["any", null, "Any"],
    ["ANY", null, "Any"],
    ["Assigned", null, "Assigned"],
    ["assigned", null, "Assigned"],
    ["ASCII", null, "ASCII"],
    ["Ascii", null, "ASCII"],
    ["ascii", null, "ASCII"],
    ["digit", null, "Nd"],
    ["Digit", null, "Nd"],
    ["punct", null, "P"],
    ["cntrl", null, "Cc"],
    ["Other", null, "C"],
    // No table, for either: a script's code, Unknown, a typo, an object's member.
    ["Grek", null, null],
    ["Latn", null, null],
    ["Zzzz", null, null],
    ["Unknown", null, null],
    ["L&", null, null],
    ["", null, null],
    ["Foo", null, null],
    ["1", null, null],
    ["\u{E9}", null, null],
    ["L\u{E9}", null, null],
    ["constructor", null, null],
    ["toString", null, null],
    ["__proto__", null, null],
    ["hasOwnProperty", null, null],
  ] as Array<[string, string | null, string | null]>)(
    "\\p{%s}: a label matcher reads %s, label_replace() %s",
    (name: string, matcher: string | null, labelReplace: string | null) => {
      expect(unicodeTableName({ name, readsAliases: false }) ?? null).toBe(
        matcher,
      );
      expect(unicodeTableName({ name, readsAliases: true }) ?? null).toBe(
        labelReplace,
      );
    },
  );

  test("a name label_replace() reads is written for a matcher by its table's own name", () => {
    expect(
      unicodeClassAsMatchersWriteIt({ name: "Letter", negated: false }),
    ).toBe("\\p{L}");
    expect(
      unicodeClassAsMatchersWriteIt({ name: "letter", negated: true }),
    ).toBe("\\P{L}");
    expect(
      unicodeClassAsMatchersWriteIt({ name: "old italic", negated: false }),
    ).toBe("\\p{Old_Italic}");
    expect(
      unicodeClassAsMatchersWriteIt({ name: "Assigned", negated: false }),
    ).toBe("\\P{Cn}");
    expect(
      unicodeClassAsMatchersWriteIt({ name: "ascii", negated: true }),
    ).toBe("[[:^ascii:]]");
    expect(
      unicodeClassAsMatchersWriteIt({ name: "Grek", negated: false }),
    ).toBeUndefined();
  });

  test("folds under (?i) the tables Go has other cases for, and no other", () => {
    // unicode.FoldCategory and unicode.FoldScript, Go 1.27, and Any, Assigned and ASCII.
    const folded: Array<string> = [
      ...UNICODE_CATEGORY_NAMES,
      ...UNICODE_SCRIPT_NAMES,
      "Any",
      "Assigned",
      "ASCII",
    ].filter(unicodeTableFolds);

    expect(folded).toEqual([
      "L",
      "Ll",
      "Lt",
      "Lu",
      "M",
      "Mn",
      "Common",
      "Greek",
      "Inherited",
      "Any",
      "Assigned",
      "ASCII",
    ]);
  });
});

/*
 * Patterns with Unicode classes, each matching the value or not as
 * Prometheus' label matcher answered. JavaScript's own RegExp reads the
 * written pattern the same way, over the text the pattern reads.
 */
const UNICODE_ROWS: ReadonlyArray<[string, string, boolean]> = [
  ["\\pL", "a", true],
  ["\\pL", "\u{E9}", true],
  ["\\pL", "\u{4E2D}", true],
  ["\\pL", "\u{3B1}", true],
  ["\\pL", "\u{42F}", true],
  ["\\pL", "\u{10400}", true],
  ["\\pL", "\u{20000}", true],
  ["\\pL", "1", false],
  ["\\pL", "_", false],
  ["\\pL", " ", false],
  ["\\pL", "\u{1F600}", false],
  ["\\pL", "\u{345}", false],
  ["\\pL", "\u{1C5}", true],
  ["\\pL", "", false],
  ["\\pL+", "h\u{E9}llo", true],
  ["\\pL+", "\u{4E2D}\u{6587}", true],
  ["\\pL+", "abc1", false],
  ["\\p{L}", "a", true],
  ["\\p{L}", "1", false],
  ["\\p{^L}", "a", false],
  ["\\p{^L}", "1", true],
  ["\\p{^L}", "\u{1F600}", true],
  ["\\PL", "a", false],
  ["\\PL", "1", true],
  ["\\P{^L}", "a", true],
  ["\\P{^L}", "1", false],
  ["\\pLu", "Au", true],
  ["\\pLu", "A", false],
  ["\\pLu", "au", true],
  ["\\p{Lu}", "A", true],
  ["\\p{Lu}", "a", false],
  ["\\p{Lu}", "\u{3A9}", true],
  ["\\p{Lu}", "\u{3C9}", false],
  ["\\p{Lu}", "\u{1C5}", false],
  ["\\p{Lu}", "\u{10400}", true],
  ["\\p{Lu}", "\u{10428}", false],
  ["\\p{Lu}", "\u{1D400}", true],
  ["\\p{Ll}", "a", true],
  ["\\p{Ll}", "A", false],
  ["\\p{Ll}", "\u{DF}", true],
  ["\\p{Ll}", "\u{10428}", true],
  ["\\p{Lt}", "\u{1C5}", true],
  ["\\p{Lt}", "\u{1C4}", false],
  ["\\p{Lt}", "\u{1C6}", false],
  ["\\p{LC}", "a", true],
  ["\\p{LC}", "A", true],
  ["\\p{LC}", "\u{1C5}", true],
  ["\\p{LC}", "\u{4E2D}", false],
  ["\\p{LC}", "\u{345}", false],
  ["\\p{Lm}", "\u{2B0}", true],
  ["\\p{Lm}", "a", false],
  ["\\p{Lo}", "\u{4E2D}", true],
  ["\\p{Lo}", "a", false],
  ["\\p{Lo}", "\u{AA}", true],
  ["\\p{N}", "1", true],
  ["\\p{N}", "\u{661}", true],
  ["\\p{N}", "\u{B2}", true],
  ["\\p{N}", "\u{2167}", true],
  ["\\p{N}", "a", false],
  ["\\pN", "\u{B2}", true],
  ["\\p{Nd}", "1", true],
  ["\\p{Nd}", "\u{661}", true],
  ["\\p{Nd}", "\u{B2}", false],
  ["\\p{Nd}", "\u{2167}", false],
  ["\\p{Nl}", "\u{2167}", true],
  ["\\p{Nl}", "1", false],
  ["\\p{No}", "\u{B2}", true],
  ["\\p{No}", "1", false],
  ["\\p{P}", "!", true],
  ["\\p{P}", "\u{AB}", true],
  ["\\p{P}", "a", false],
  ["\\p{S}", "+", true],
  ["\\p{S}", "\u{20AC}", true],
  ["\\p{S}", "\u{1F600}", true],
  ["\\p{S}", "a", false],
  ["\\p{Sc}", "\u{20AC}", true],
  ["\\p{Sc}", "$", true],
  ["\\p{Sc}", "a", false],
  ["\\p{Z}", " ", true],
  ["\\p{Z}", "\u{3000}", true],
  ["\\p{Z}", "\u{2028}", true],
  ["\\p{Z}", "a", false],
  ["\\p{Zs}", " ", true],
  ["\\p{Zs}", "\u{3000}", true],
  ["\\p{Zs}", "\u{2028}", false],
  ["\\p{C}", "\u{0}", true],
  ["\\p{C}", "\u{200B}", true],
  ["\\p{C}", "\u{378}", true],
  ["\\p{C}", "\u{E000}", true],
  ["\\p{C}", "a", false],
  ["\\p{Cc}", "\u{0}", true],
  ["\\p{Cc}", "\u{9}", true],
  ["\\p{Cc}", "\u{85}", true],
  ["\\p{Cf}", "\u{200B}", true],
  ["\\p{Cf}", "\u{AD}", true],
  ["\\p{Cf}", "a", false],
  ["\\p{Cn}", "\u{378}", true],
  ["\\p{Cn}", "a", false],
  ["\\p{Co}", "\u{E000}", true],
  ["\\p{Co}", "a", false],
  ["\\p{Cs}", "\u{D83D}", false],
  ["\\p{Cs}", "a", false],
  ["\\p{Cs}", "\u{1F600}", false],
  ["\\P{Cs}", "a", true],
  ["\\P{Cs}", "\u{1F600}", true],
  ["\\p{M}", "\u{300}", true],
  ["\\p{M}", "\u{903}", true],
  ["\\p{M}", "a", false],
  ["\\p{Mn}", "\u{300}", true],
  ["\\p{Mn}", "\u{345}", true],
  ["\\p{Greek}", "\u{3B1}", true],
  ["\\p{Greek}", "\u{3A9}", true],
  ["\\p{Greek}", "a", false],
  ["\\p{Greek}", "\u{B5}", false],
  ["\\p{Greek}", "\u{345}", false],
  ["\\p{Greek}", "\u{1FB3}", true],
  ["\\p{Greek}+", "\u{3B1}\u{3B2}\u{3B3}", true],
  ["\\p{Greek}+", "\u{3B1}\u{3B2}c", false],
  ["\\P{Greek}", "\u{3B1}", false],
  ["\\P{Greek}", "a", true],
  ["\\p{^Greek}", "\u{3B1}", false],
  ["\\p{^Greek}", "a", true],
  ["\\p{Han}", "\u{4E2D}", true],
  ["\\p{Han}", "\u{20000}", true],
  ["\\p{Han}", "a", false],
  ["\\p{Han}", "\u{3007}", true],
  ["\\p{Han}+", "\u{4E2D}\u{6587}", true],
  ["\\p{Han}+", "\u{4E2D}a", false],
  ["\\p{Latin}", "a", true],
  ["\\p{Latin}", "\u{E9}", true],
  ["\\p{Latin}", "\u{212A}", true],
  ["\\p{Latin}", "\u{3B1}", false],
  ["\\p{Cyrillic}", "\u{42F}", true],
  ["\\p{Cyrillic}", "a", false],
  ["\\p{Common}", "1", true],
  ["\\p{Common}", " ", true],
  ["\\p{Common}", "\u{B5}", true],
  ["\\p{Common}", "a", false],
  ["\\p{Inherited}", "\u{300}", true],
  ["\\p{Inherited}", "\u{345}", true],
  ["\\p{Inherited}", "a", false],
  ["\\p{Deseret}", "\u{10400}", true],
  ["\\p{Deseret}", "\u{10428}", true],
  ["\\p{Deseret}", "a", false],
  ["\\p{Old_Italic}", "\u{10300}", true],
  ["\\p{Old_Italic}", "a", false],
  ["\\p{Any}", "a", true],
  ["\\p{Any}", "\u{1F600}", true],
  ["\\p{Any}", "\u{378}", true],
  ["\\p{Any}", "", false],
  ["\\p{Any}*", "anything at all \u{1F600}", true],
  ["\\P{Any}", "a", false],
  ["\\P{Any}", "\u{1F600}", false],
  ["[\\pL]", "a", true],
  ["[\\pL]", "1", false],
  ["[^\\pL]", "a", false],
  ["[^\\pL]", "1", true],
  ["[^\\pL]", "\u{1F600}", true],
  ["[\\pL\\pN]+", "abc123", true],
  ["[\\pL\\pN]+", "abc-123", false],
  ["[\\p{Greek}\\d]+", "\u{3B1}1", true],
  ["[\\p{Greek}\\d]+", "a1", false],
  ["[^\\p{Lu}a]", "A", false],
  ["[^\\p{Lu}a]", "a", false],
  ["[^\\p{Lu}a]", "b", true],
  ["[^\\p{Lu}a]", "1", true],
  ["[\\P{Han}]", "\u{4E2D}", false],
  ["[\\P{Han}]", "a", true],
  ["[^\\P{Han}]", "\u{4E2D}", true],
  ["[^\\P{Han}]", "a", false],
  ["[\\p{Han}\\p{Greek}]{2}", "\u{4E2D}\u{3B1}", true],
  ["[\\p{Han}\\p{Greek}]{2}", "\u{4E2D}a", false],
  ["(?i)\\p{Lu}", "a", true],
  ["(?i)\\p{Lu}", "A", true],
  ["(?i)\\p{Lu}", "1", false],
  ["(?i)\\p{Lu}", "\u{345}", true],
  ["(?i)\\p{Lu}", "\u{17F}", true],
  ["(?i)\\p{Lu}", "\u{212A}", true],
  ["(?i)\\p{Lu}", "\u{10428}", true],
  ["(?i)\\p{Ll}", "A", true],
  ["(?i)\\p{Ll}", "a", true],
  ["(?i)\\p{Ll}", "\u{212A}", true],
  ["(?i)\\P{Lu}", "a", false],
  ["(?i)\\P{Lu}", "A", false],
  ["(?i)\\P{Lu}", "1", true],
  ["(?i)[^\\p{Lu}]", "a", false],
  ["(?i)[^\\p{Lu}]", "A", false],
  ["(?i)[^\\p{Lu}]", "1", true],
  ["(?i)\\p{LC}", "\u{345}", false],
  ["(?i)\\p{LC}", "a", true],
  ["(?i)\\p{LC}", "A", true],
  ["(?i)\\pL", "\u{345}", true],
  ["(?i)\\pL", "a", true],
  ["(?i)\\p{Greek}", "\u{B5}", true],
  ["(?i)\\p{Greek}", "\u{3B1}", true],
  ["(?i)\\p{Greek}", "\u{345}", true],
  ["(?i)\\p{Latin}", "\u{212A}", true],
  ["(?i)\\p{Latin}", "k", true],
  ["(?i)\\p{Common}", "\u{B5}", true],
  ["(?i)\\p{Common}", "\u{3BC}", true],
  ["(?i)\\p{Inherited}", "\u{345}", true],
  ["(?i)\\p{Inherited}", "\u{3B9}", true],
  ["(?i)\\p{Inherited}", "\u{399}", true],
  ["(?i)\\p{Cherokee}", "\u{13A0}", true],
  ["(?i)\\p{Cherokee}", "\u{AB70}", true],
  ["(?i)\\p{Lt}", "\u{1C5}", true],
  ["(?i)\\p{Lt}", "\u{1C4}", true],
  ["(?i)\\p{Lt}", "\u{1C6}", true],
  ["(?i)\\p{Mn}", "\u{345}", true],
  ["(?i)\\p{Mn}", "\u{3B9}", true],
  ["(?i)\\p{M}", "\u{345}", true],
  ["(?i)\\p{M}", "\u{3B9}", true],
  ["\\pLa", "\u{3B1}a", true],
  ["\\pLa", "aa", true],
  ["a\\pL*b", "ab", true],
  ["a\\pL*b", "a\u{3B1}\u{3B2}b", true],
  ["a\\pL*b", "a1b", false],
  ["\\pL|\\pN", "a", true],
  ["\\pL|\\pN", "1", true],
  ["\\pL|\\pN", "!", false],
  ["(\\pL)(\\pN)", "a1", true],
  ["(\\pL)(\\pN)", "1a", false],
  ["\\pL.", "a\u{1F600}", true],
  ["\\pL.", "\u{1F600}a", false],
];

describe("a Unicode class matches what Prometheus' does", () => {
  test.each(UNICODE_ROWS)(
    "%s matching %j is %s, as in Prometheus",
    (pattern: string, value: string, matches: boolean) => {
      const compiled: CompiledPromQLRegex = compilePromQLRegex(pattern);

      expect(compiled.test(value)).toBe(matches);
      expect(
        new RegExp(compiled.regex.source, compiled.regex.flags).test(
          compiled.textOf(value),
        ),
      ).toBe(matches);
      // label_replace() reads the class the same way.
      expect(
        compilePromQLRegex(pattern, {
          captures: true,
          unicodeClassAliases: true,
        }).exec(value) !== null,
      ).toBe(matches);
    },
  );

  test("before #8216, \\pL was refused; it is a class of letters now", () => {
    const letters: CompiledPromQLRegex = compilePromQLRegex("\\pL+");

    expect(letters.test("h\u{E9}llo")).toBe(true);
    expect(letters.test("pL")).toBe(true);
    expect(letters.test("p1")).toBe(false);
  });

  /*
   * Go folds a table under (?i) only where it has a table of other cases
   * for it (unicodeTableFolds): (?i)\pL holds U+0345, the iota subscript,
   * which folds to the capital iota, and (?i)\p{LC} does not, though LC
   * holds the capital iota. JavaScript's i flag would add it, so such a
   * class is matched as written, in a (?-i:...) group.
   */
  test("(?i) folds \\pL and leaves \\p{LC} as it is, as Go does", () => {
    const iotaSubscript: string = "\u{345}";

    expect(compilePromQLRegex("(?i)\\pL").test(iotaSubscript)).toBe(true);
    expect(compilePromQLRegex("(?i)\\p{LC}").test(iotaSubscript)).toBe(false);
    expect(compilePromQLRegex("(?i)\\P{LC}").test("\u{3B9}")).toBe(false);
    expect(compilePromQLRegex("(?i)\\P{LC}").test(iotaSubscript)).toBe(true);
    expect(compilePromQLRegex("(?i)[\\p{LC}x]").test(iotaSubscript)).toBe(
      false,
    );
    expect(compilePromQLRegex("(?i)[\\p{LC}x]").test("X")).toBe(true);
    expect(compilePromQLRegex("(?i)\\p{LC}").regex.source).toContain("(?-i:");
    // Without (?i), and for a table Go folds, no group is written.
    expect(compilePromQLRegex("\\p{LC}").regex.source).not.toContain("(?-i:");
    expect(compilePromQLRegex("(?i)\\pL").regex.source).not.toContain("(?-i:");
  });

  test("a class Go does not fold still repeats, and still folds the letters around it", () => {
    const compiled: CompiledPromQLRegex = compilePromQLRegex("(?i)k\\p{LC}+s");

    expect(compiled.test("\u{212A}ab\u{17F}")).toBe(true);
    expect(compiled.test("KABS")).toBe(true);
    expect(compiled.test("k\u{345}s")).toBe(false);
  });

  test("reads a class's characters beyond U+FFFF one each, as RE2 does", () => {
    const han: CompiledPromQLRegex = compilePromQLRegex("\\p{Han}{2}");

    // U+20000 and U+2A6DF are two characters, four code units.
    expect(han.test("\u{20000}\u{2A6DF}")).toBe(true);
    expect(han.test("\u{20000}")).toBe(false);
    expect(compilePromQLRegex("\\P{Han}").test("\u{1F600}")).toBe(true);
    expect(compilePromQLRegex("\\P{Han}").test("\u{20000}")).toBe(false);
  });
});

describe("a Unicode class Prometheus does not read is refused, saying why", () => {
  const refusalOf: (pattern: string, aliases: boolean) => unknown = (
    pattern: string,
    aliases: boolean,
  ): unknown => {
    try {
      compilePromQLRegex(pattern, { unicodeClassAliases: aliases });
    } catch (error: unknown) {
      return error;
    }

    return null;
  };

  test("label_replace() reads Go 1.25's names, a label matcher does not", () => {
    for (const pattern of [
      "\\p{Letter}",
      "\\p{greek}",
      "\\p{Assigned}",
      "\\p{ASCII}",
      "\\pl",
      "[\\p{old italic}]",
    ]) {
      expect(refusalOf(pattern, true)).toBeNull();
      expect(refusalOf(pattern, false)).toBeInstanceOf(PromQLPatternError);
    }

    expect(
      compilePromQLRegex("\\p{Letter}+", { unicodeClassAliases: true }).test(
        "abc",
      ),
    ).toBe(true);
    expect(
      compilePromQLRegex("\\p{Assigned}", { unicodeClassAliases: true }).test(
        "\u{378}",
      ),
    ).toBe(false);
    expect(
      compilePromQLRegex("\\p{ASCII}+", { unicodeClassAliases: true }).test(
        "a~\u{7F}",
      ),
    ).toBe(true);
    expect(
      compilePromQLRegex("(?i)\\p{ASCII}", { unicodeClassAliases: true }).test(
        "\u{212A}",
      ),
    ).toBe(true);
  });

  test("a name no reader has is refused by both, and said in a sentence", () => {
    for (const aliases of [false, true]) {
      const refusal: unknown = refusalOf("a\\p{Grek}", aliases);

      expect(refusal).toBeInstanceOf(PromQLPatternError);
      expect(describePromQLPatternProblem(refusal)).toBe(
        "uses the Unicode class \\p{Grek}, which Prometheus does not read either. A Unicode class names a general category, such as \\pL or \\p{Lu}, or a script, such as \\p{Greek} or \\p{Han}.",
      );
    }
  });
});

describe("a Unicode class written out stays inside what can run", () => {
  test("\\pL is one step, its letters up to U+FFFF one class", () => {
    const letters: CompiledPromQLRegex = compilePromQLRegex("\\pL");

    expect(letters.regex.steps).toBe(compilePromQLRegex("a").regex.steps);
    expect(letters.regex.source.length).toBeLessThan(MAX_PATTERN_LENGTH);
  });

  test("many classes may write out longer than the pattern limit, as Prometheus reads them (#8218)", () => {
    const pattern: string = "\\pL".repeat(40);
    const compiled: CompiledPromQLRegex = compilePromQLRegex(pattern);

    expect(compiled.regex.source.length).toBeGreaterThan(MAX_PATTERN_LENGTH);
    expect(compiled.test("a".repeat(40))).toBe(true);
    expect(compiled.test("a".repeat(39))).toBe(false);
  });

  test("but not past MAX_WRITTEN_PATTERN_LENGTH: refused as too large to run, said so", () => {
    let refusal: unknown = null;

    try {
      compilePromQLRegex("\\pL".repeat(300));
    } catch (error: unknown) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(PatternProblemError);
    expect((refusal as Error).message).toBe(
      `The pattern, written out for the matcher, is longer than ${MAX_WRITTEN_PATTERN_LENGTH} characters.`,
    );
    expect(describePromQLPatternProblem(refusal)).toBe(
      "is too large to run. Shorten it, or repeat its parts fewer times.",
    );
  });

  test("a bracket of many classes is read in time in line with them", () => {
    const started: number = Date.now();
    const compiled: CompiledPromQLRegex = compilePromQLRegex(
      `(?i)[${"\\pL\\PN".repeat(3000)}]`,
    );

    expect(compiled.test("a")).toBe(true);
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
