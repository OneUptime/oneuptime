import { describe, expect, test } from "@jest/globals";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  CONTEXT_AFTER,
  CONTEXT_BEFORE,
  DataTypeDetector,
} from "../../../Utils/DataSecurity/Detector";
import GOVERNMENT_ID_DETECTORS from "../../../Utils/DataSecurity/Detectors/GovernmentIdDetectors";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";

/*
 * GOVERNMENT IDS, FOUND THE WAY THE SCANNER FINDS THEM.
 *
 * Each detector runs here as TextScanner runs it: every match of its
 * pattern, normalized and validated, kept only with a word of its type
 * nearby when it requires one, and counted apart when it is a published
 * sample. The valid values are worked out with each ID's own algorithm
 * (independently of the detectors) or are published examples; each type
 * also gets a wrong check digit, a value inside a longer token, its
 * placeholders and samples, and a check of whether it counts on its own.
 */

interface Found {
  value: string;
  start: number;
  end: number;
  sample: boolean;
}

const WORD_CHARACTER: RegExp = /[A-Za-z0-9]/;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

// Whether a word stands on its own in the text, as TextScanner reads it.
function containsWord(text: string, word: string): boolean {
  let index: number = text.indexOf(word);

  while (index >= 0) {
    const joinedBefore: boolean =
      isWordCharacter(word[0]) && isWordCharacter(text[index - 1]);
    const joinedAfter: boolean =
      isWordCharacter(word[word.length - 1]) &&
      isWordCharacter(text[index + word.length]);

    if (!joinedBefore && !joinedAfter) {
      return true;
    }

    index = text.indexOf(word, index + 1);
  }

  return false;
}

// What one detector finds in a text, run as the scanner runs it.
function scanWith(detector: DataTypeDetector, text: string): Array<Found> {
  const found: Array<Found> = [];
  const lowerText: string = text.toLowerCase();

  if (
    detector.quickCheck &&
    !detector.quickCheck(detector.quickCheckLowerCase ? lowerText : text)
  ) {
    return found;
  }

  for (const match of text.matchAll(detector.pattern)) {
    const raw: string | undefined = match[detector.valueGroup || 0];

    if (raw === undefined || match.index === undefined) {
      continue;
    }

    const start: number = match.index + Math.max(0, match[0].indexOf(raw));
    const end: number = start + raw.length;
    const value: string = detector.normalize ? detector.normalize(raw) : raw;

    if (detector.validate && !detector.validate(value, raw)) {
      continue;
    }

    const around: string = lowerText.slice(
      Math.max(0, start - (detector.contextBefore ?? CONTEXT_BEFORE)),
      end + (detector.contextAfter ?? CONTEXT_AFTER),
    );
    const confirmed: boolean = (detector.keywords || []).some(
      (keyword: string): boolean => {
        return containsWord(around, keyword);
      },
    );

    if (detector.requiresContext && !confirmed) {
      continue;
    }

    found.push({
      value,
      start,
      end,
      sample: Boolean(detector.isTestValue?.(value)),
    });
  }

  return found;
}

function detectorsOf(id: string): Array<DataTypeDetector> {
  return GOVERNMENT_ID_DETECTORS.filter(
    (detector: DataTypeDetector): boolean => {
      return detector.dataTypeId === id;
    },
  );
}

/*
 * What all of a type's detectors find, one finding per stretch of
 * characters, as the scanner counts a type's detectors as one.
 */
function scanType(id: string, text: string): Array<Found> {
  const found: Array<Found> = [];

  for (const detector of detectorsOf(id)) {
    for (const candidate of scanWith(detector, text)) {
      const overlaps: boolean = found.some((other: Found): boolean => {
        return candidate.start < other.end && other.start < candidate.end;
      });

      if (!overlaps) {
        found.push(candidate);
      }
    }
  }

  return found.sort((a: Found, b: Found): number => {
    return a.start - b.start;
  });
}

// The values found as findings; samples are counted apart.
function findings(id: string, text: string): Array<string> {
  return scanType(id, text)
    .filter((found: Found): boolean => {
      return !found.sample;
    })
    .map((found: Found): string => {
      return found.value;
    });
}

// The values found and counted apart as published samples.
function samples(id: string, text: string): Array<string> {
  return scanType(id, text)
    .filter((found: Found): boolean => {
      return found.sample;
    })
    .map((found: Found): string => {
      return found.value;
    });
}

// A value as the type's detectors normalize it.
function normalized(id: string, value: string): string {
  const detector: DataTypeDetector = detectorsOf(id)[0]!;

  return detector.normalize ? detector.normalize(value) : value;
}

interface IdCase {
  id: string;
  // Two valid values, as people type them.
  valid: [string, string];
  // A word that names the type.
  keyword: string;
  // Whether the first value counts with no word around it.
  alone: boolean;
  // A wrong check digit, or a value the format's rules refuse.
  invalid: Array<string>;
  // Placeholders: refused.
  placeholders?: Array<string>;
  // Published samples: found, and counted apart.
  samples?: Array<string>;
}

const CASES: Array<IdCase> = [
  {
    id: "us-ssn",
    valid: ["536-22-1234", "212 48 7710"],
    keyword: "SSN",
    alone: true,
    invalid: ["000-22-1234", "666-22-1234", "536-00-1234", "536-22-0000"],
    placeholders: ["123-45-6789", "111-11-1111"],
    samples: ["078-05-1120", "219-09-9999", "457-55-5462"],
  },
  {
    id: "us-itin",
    valid: ["912-73-4567", "978 91 2301"],
    keyword: "ITIN",
    alone: true,
    invalid: ["912-69-4567", "912-93-4567", "812-73-4567"],
    placeholders: ["999-99-9999"],
    samples: ["987-65-4320", "987-65-4329"],
  },
  {
    id: "us-ein",
    valid: ["36-4217890", "951873042"],
    keyword: "EIN",
    alone: false,
    invalid: ["07-4218835", "89-3317290"],
    placeholders: ["12-3456789", "22-2222222"],
  },
  {
    id: "us-passport",
    valid: ["A21847390", "563207914"],
    keyword: "US passport",
    alone: false,
    invalid: ["A2184739", "AB2184739"],
    placeholders: ["000000000", "123456789"],
  },
  {
    id: "us-drivers-license",
    valid: ["D5823091", "S530-460-81-312-0"],
    keyword: "license number",
    alone: false,
    invalid: ["D5823", "ABC5823091"],
    placeholders: ["11111111", "D1234567"],
  },
  {
    id: "uk-nino",
    valid: ["JG 10 37 84 C", "PR428163B"],
    keyword: "NINO",
    alone: true,
    invalid: ["GB 10 37 84 C", "TN428163B", "DA428163B", "JG103784E"],
    placeholders: ["JG 12 34 56 C", "JG000000A"],
  },
  {
    id: "uk-passport",
    valid: ["534712986", "AB4821936"],
    keyword: "UK passport",
    alone: false,
    invalid: ["53471298", "ABC4821936"],
    placeholders: ["000000000"],
  },
  {
    id: "uk-driving-licence",
    valid: ["SMITH801152JA9AB", "LEE99 856231 J99 XY"],
    keyword: "driving licence",
    alone: true,
    invalid: ["SMITH813152JA9AB", "SMITH801322JA9AB", "LE9E9856231J99XY"],
    samples: ["MORGA657054SM9IJ"],
  },
  {
    id: "ca-sin",
    valid: ["130 213 341", "562-116-780"],
    keyword: "SIN",
    alone: false,
    invalid: ["130 213 342", "046 454 286", "802 133 413"],
    placeholders: ["111 111 111"],
  },
  {
    id: "mx-curp",
    valid: ["GOCC850312HJCMRR00", "PEMA020730MDFRRNA1"],
    keyword: "CURP",
    alone: true,
    invalid: ["GOCC850312HJCMRR01", "GOCC850231HJCMRR00", "GOCC850312HZZMRR00"],
    samples: ["HEGG560427MVZRRL04", "BOXW310820HNERXN09"],
  },
  {
    id: "mx-rfc",
    valid: ["GOCC850312Q81", "CAM980312LP7"],
    keyword: "RFC",
    alone: false,
    invalid: ["GOCC850230Q81", "GOCC850312Q8B"],
    samples: ["XAXX010101000", "XEXX010101000"],
  },
  {
    id: "br-cpf",
    valid: ["390.533.447-05", "85351346893"],
    keyword: "CPF",
    alone: true,
    invalid: ["390.533.447-06", "853.513.468-39"],
    placeholders: ["111.111.111-11", "000.000.000-00"],
    samples: ["123.456.789-09", "111.444.777-35", "529.982.247-25"],
  },
  {
    id: "br-cnpj",
    valid: ["45.997.418/0001-53", "A1.B2C.3D4/0001-93"],
    keyword: "CNPJ",
    alone: true,
    invalid: ["45.997.418/0001-54", "A1.B2C.3D4/0001-94", "A1B2C3D4000193"],
    placeholders: ["11.111.111/1111-11"],
    samples: ["11.222.333/0001-81", "00.000.000/0001-91", "12.ABC.345/01DE-35"],
  },
  {
    id: "ar-cuit",
    valid: ["20-31245678-9", "30712345655"],
    keyword: "CUIT",
    alone: true,
    invalid: ["20-31245678-0", "21-31245678-9"],
    placeholders: ["20-11111111-2"],
  },
  {
    id: "cl-rut",
    valid: ["15.764.329-0", "10234569-K"],
    keyword: "RUT",
    alone: false,
    invalid: ["15.764.329-1", "10234569-0"],
    placeholders: ["11.111.111-1"],
  },
  {
    id: "es-dni",
    valid: ["48291037-F", "70356218T"],
    keyword: "DNI",
    alone: true,
    invalid: ["48291037G", "48291037-I"],
    placeholders: ["12345678Z", "00000000T"],
  },
  {
    id: "es-nie",
    valid: ["X4931027B", "Y-2805613-H"],
    keyword: "NIE",
    alone: true,
    invalid: ["X4931027C", "W4931027B"],
    placeholders: ["X1234567L"],
  },
  {
    id: "pt-nif",
    valid: ["215 476 387", "506138747"],
    keyword: "NIF",
    alone: false,
    invalid: ["215476388", "415476387"],
    placeholders: ["111111111"],
  },
  {
    id: "fr-nir",
    valid: ["1 85 05 78 006 084 91", "269054958815780"],
    keyword: "INSEE",
    alone: true,
    invalid: ["185057800608492", "585057800608491", "185137800608491"],
    samples: ["2 55 08 14 168 025 38"],
  },
  {
    id: "de-tax-id",
    valid: ["57 203 819 562", "28432629710"],
    keyword: "Steuer-ID",
    alone: true,
    invalid: [
      "57203819563",
      "47203815964",
      "22284361596",
      "47203815479",
      "07203819562",
    ],
    samples: ["86095742719", "36574261809", "65929970489"],
  },
  {
    id: "it-codice-fiscale",
    valid: ["BNCGPP75L12F205T", "VRDLCU92T52A944V"],
    keyword: "codice fiscale",
    alone: true,
    invalid: ["BNCGPP75L12F205U", "BNCGPP75B30F205T"],
    samples: ["RSSMRA80A01H501U"],
  },
  {
    id: "nl-bsn",
    valid: ["192837461", "5371.82.068"],
    keyword: "BSN",
    alone: false,
    invalid: ["192837462"],
    placeholders: ["000000000", "111111111"],
    samples: ["123456782", "111222333"],
  },
  {
    id: "be-national-number",
    valid: ["90.02.14-153.70", "05112328809"],
    keyword: "national number",
    alone: true,
    invalid: ["90.02.14-153.71", "05112328810", "90021400029"],
    samples: ["85.07.30-033.28"],
  },
  {
    id: "pl-pesel",
    valid: ["85072309132", "02251407382"],
    keyword: "PESEL",
    alone: true,
    invalid: ["85072309133", "85132309132"],
    samples: ["44051401359"],
  },
  {
    id: "se-personnummer",
    valid: ["811218-9876", "19640823-3234"],
    keyword: "personnummer",
    alone: true,
    invalid: ["811218-9877", "811232-9876"],
    samples: ["19121212-1212", "121212-1212"],
  },
  {
    id: "no-fodselsnummer",
    valid: ["15038712486", "031262 45660"],
    keyword: "fødselsnummer",
    alone: true,
    invalid: ["15038712487", "15038712496"],
    samples: ["15888712310"],
  },
  {
    id: "dk-cpr",
    valid: ["070589-1234", "2111023856"],
    keyword: "CPR",
    alone: false,
    invalid: ["310289-1234", "070589-12345"],
    placeholders: ["000000-0000"],
  },
  {
    id: "fi-hetu",
    valid: ["080372-1522", "150205A2399"],
    keyword: "henkilötunnus",
    alone: true,
    invalid: ["080372-1523", "300272-152E", "080372-0016"],
    samples: ["131052-308T", "010101-900R"],
  },
  {
    id: "ie-ppsn",
    valid: ["6413298J", "8261703JB"],
    keyword: "PPS number",
    alone: true,
    invalid: ["6413298K", "8261703JA"],
    placeholders: ["1234567T", "1234567FA"],
  },
  {
    id: "ch-ahv",
    valid: ["756.3047.5009.62", "7569473125809"],
    keyword: "AHV",
    alone: true,
    invalid: ["756.3047.5009.63", "757.3047.5009.62"],
    placeholders: ["756.1234.5678.97"],
  },
  {
    id: "ro-cnp",
    valid: ["1850312401233", "6040229521110"],
    keyword: "CNP",
    alone: true,
    invalid: ["1850312401234", "1850230401233", "1850312601233"],
  },
  {
    id: "bg-egn",
    valid: ["7501020018", "0542154321"],
    keyword: "EGN",
    alone: true,
    invalid: ["7501020019", "7513020018"],
    samples: ["7523169263", "7552010005"],
  },
  {
    id: "hr-oib",
    valid: ["84730192659", "69435151530"],
    keyword: "OIB",
    alone: false,
    invalid: ["84730192658"],
    placeholders: ["11111111111"],
  },
  {
    id: "gr-amka",
    valid: ["12038512344", "29070158232"],
    keyword: "AMKA",
    alone: true,
    invalid: ["12038512345", "32038512344"],
  },
  {
    id: "tr-tckn",
    valid: ["38472910510", "72930485110"],
    keyword: "TC Kimlik",
    alone: true,
    invalid: ["38472910511", "38472910520", "08472910510"],
    samples: ["10000000146", "11111111110", "12345678950"],
  },
  {
    id: "il-teudat-zehut",
    valid: ["203847561", "03917428-9"],
    keyword: "teudat zehut",
    alone: false,
    invalid: ["203847562"],
    placeholders: ["000000000"],
  },
  {
    id: "za-id",
    valid: ["850312 5123 088", "0106050456180"],
    keyword: "ID number",
    alone: true,
    invalid: ["8503125123089", "8503125123388", "8513125123088"],
    samples: ["8001015009087"],
  },
  {
    id: "ae-emirates-id",
    valid: ["784-1987-4321956-4", "784200165392141"],
    keyword: "Emirates ID",
    alone: true,
    invalid: ["784-1987-4321956-5", "785-1987-4321956-4", "784209943219567"],
  },
  {
    id: "sa-national-id",
    valid: ["1093847562", "2140395860"],
    keyword: "iqama",
    alone: false,
    invalid: ["1093847563", "3093847562"],
  },
  {
    id: "in-aadhaar",
    valid: ["4918 3027 4655", "7359-0284-6117"],
    keyword: "Aadhaar",
    alone: true,
    invalid: ["4918 3027 4656", "1918 3027 4655"],
    placeholders: ["2222 2222 2222"],
    samples: ["9999 9999 0019"],
  },
  {
    id: "in-pan",
    valid: ["BNZPM2501F", "AFZPK7190K"],
    keyword: "PAN",
    alone: true,
    invalid: ["BNZDM2501F", "BNZPM0000F"],
    samples: ["AAAPL1234C", "AAAPZ1234C"],
  },
  {
    id: "cn-resident-id",
    valid: ["440308198507210126", "31010420030215126X"],
    keyword: "身份证",
    alone: true,
    invalid: [
      "440308198507210127",
      "990308198507210126",
      "440308198502300126",
      "440308209907210126",
    ],
    samples: ["11010519491231002X"],
  },
  {
    id: "jp-my-number",
    valid: ["4839 2017 5636", "702158394604"],
    keyword: "My Number",
    alone: false,
    invalid: ["4839 2017 5637"],
    samples: ["1234 5678 9018"],
  },
  {
    id: "kr-rrn",
    valid: ["850312-1549837", "020615-4391856"],
    keyword: "주민등록번호",
    alone: false,
    invalid: ["851312-1549837", "850230-1549837", "850312-9549837"],
  },
  {
    id: "sg-nric",
    valid: ["S8392017C", "T0215839B"],
    keyword: "NRIC",
    alone: true,
    invalid: ["S8392017D", "A8392017C"],
    placeholders: ["S1234567D", "T1234567J"],
  },
  {
    id: "hk-hkid",
    valid: ["C668668(9)", "XA472915(0)"],
    keyword: "HKID",
    alone: true,
    invalid: ["C668668(8)", "XA472915(1)"],
    placeholders: ["A123456(3)"],
  },
  {
    id: "tw-national-id",
    valid: ["F128754365", "Q219384757"],
    keyword: "身分證",
    alone: true,
    invalid: ["F128754366", "F328754365"],
    placeholders: ["A123456789"],
  },
  {
    id: "th-national-id",
    valid: ["1-1017-02034-95-7", "3100902156725"],
    keyword: "Thai ID",
    alone: false,
    invalid: ["1-1017-02034-95-8", "9-1017-02034-95-7"],
  },
  {
    id: "my-mykad",
    valid: ["750423-08-5143", "011231142286"],
    keyword: "MyKad",
    alone: false,
    invalid: ["750423-17-5143", "750431-08-5143", "750423-08-0000"],
  },
  {
    id: "id-nik",
    valid: ["3174055208900003", "3273011507850012"],
    keyword: "NIK",
    alone: false,
    invalid: ["9974055208900003", "3174055208900000", "3174053208900003"],
  },
  {
    id: "au-tfn",
    valid: ["475 382 192", "37 182 647"],
    keyword: "TFN",
    alone: false,
    invalid: ["475 382 193"],
    samples: ["123 456 782"],
  },
  {
    id: "nz-ird",
    valid: ["35-182-063", "128-734-181"],
    keyword: "IRD",
    alone: false,
    invalid: ["35-182-064", "160-000-008"],
    samples: ["49-091-850", "136-410-132"],
  },
  {
    id: "ru-snils",
    valid: ["112-233-445 95", "15348269784"],
    keyword: "СНИЛС",
    alone: true,
    invalid: ["112-233-445 96", "001-001-998 00"],
  },
  {
    id: "ru-inn",
    valid: ["5001007329", "500312874689"],
    keyword: "ИНН",
    alone: false,
    invalid: ["5001007328", "500312874698"],
    samples: ["7707083893"],
  },
  {
    id: "passport-number",
    valid: ["PA7193846", "K4821093"],
    keyword: "passport",
    alone: false,
    invalid: ["PASSPORT1", "ABCD12345"],
    placeholders: ["X1234567"],
    samples: ["C01X00T47"],
  },
];

describe("GOVERNMENT_ID_DETECTORS", () => {
  test("has a detector for every government ID of the catalog, and only for them", () => {
    const catalogIds: Array<string> = DATA_TYPE_CATALOG.filter(
      (info: DataTypeInfo): boolean => {
        return info.category === DataCategory.GovernmentId;
      },
    )
      .map((info: DataTypeInfo): string => {
        return info.id;
      })
      .sort();
    const detectorIds: Array<string> = [
      ...new Set(
        GOVERNMENT_ID_DETECTORS.map((detector: DataTypeDetector): string => {
          return detector.dataTypeId;
        }),
      ),
    ].sort();

    expect(detectorIds).toEqual(catalogIds);
    expect(detectorIds).toHaveLength(55);
  });

  test("every type here has a case below", () => {
    expect(
      CASES.map((idCase: IdCase): string => {
        return idCase.id;
      }).sort(),
    ).toEqual(
      [
        ...new Set(
          GOVERNMENT_ID_DETECTORS.map((detector: DataTypeDetector): string => {
            return detector.dataTypeId;
          }),
        ),
      ].sort(),
    );
  });

  test("every pattern is global", () => {
    for (const detector of GOVERNMENT_ID_DETECTORS) {
      expect(detector.pattern.flags).toContain("g");
    }
  });
});

describe.each(CASES)("$id", (idCase: IdCase) => {
  const { id, keyword }: IdCase = idCase;

  test("finds both valid values in text, separators and all", () => {
    const text: string = `First ${keyword}: ${idCase.valid[0]}; and the other ${keyword} ${idCase.valid[1]}.`;

    expect(findings(id, text)).toEqual([
      normalized(id, idCase.valid[0]),
      normalized(id, idCase.valid[1]),
    ]);
  });

  test("refuses a wrong check digit and what the format's rules refuse", () => {
    for (const value of idCase.invalid) {
      expect(findings(id, `${keyword}: ${value}.`)).toEqual([]);
    }
  });

  test("does not take a value from inside a longer token", () => {
    const value: string = idCase.valid[0];

    for (const text of [
      `${keyword}: X${value}`,
      `${keyword}: ${value}X`,
      `${keyword}: 7${value}`,
      `${keyword}: ${value}7`,
    ]) {
      expect(findings(id, text)).not.toContain(normalized(id, value));
    }
  });

  test(
    idCase.alone
      ? "counts on its own, with no word around it"
      : "counts only beside a word that names it",
    () => {
      const value: string = idCase.valid[0];
      const expected: Array<string> = [normalized(id, value)];

      expect(findings(id, `Value ${value} kept.`)).toEqual(
        idCase.alone ? expected : [],
      );
      expect(findings(id, `${keyword} ${value} kept.`)).toEqual(expected);
    },
  );

  test("refuses placeholders and counts published samples apart", () => {
    for (const value of idCase.placeholders || []) {
      expect(scanType(id, `${keyword}: ${value}.`)).toEqual([]);
    }

    for (const value of idCase.samples || []) {
      const text: string = `${keyword}: ${value}.`;

      expect(findings(id, text)).toEqual([]);
      expect(samples(id, text)).toEqual([normalized(id, value)]);
    }
  });
});

describe("the rules of each ID", () => {
  test("an SSN in its groups counts alone, nine bare digits only beside a word", () => {
    expect(findings("us-ssn", "Employee 536-22-1234 joined.")).toEqual([
      "536221234",
    ]);
    expect(findings("us-ssn", "SSN: 536.22.1234.")).toEqual(["536221234"]);
    expect(findings("us-ssn", "Order 536221234 shipped.")).toEqual([]);
    expect(findings("us-ssn", "SSN 536221234 on file.")).toEqual(["536221234"]);
  });

  test("an SSN is not taken from a longer chain of groups, nor from mixed ones", () => {
    expect(findings("us-ssn", "SSN: 536-22-1234-56")).toEqual([]);
    expect(findings("us-ssn", "SSN: 1-536-22-1234")).toEqual([]);
    expect(findings("us-ssn", "SSN: 536-22 1234")).toEqual([]);
  });

  test("the advertising range is no SSN (9xx) but is an ITIN sample", () => {
    expect(scanType("us-ssn", "SSN 987-65-4320")).toEqual([]);
    expect(samples("us-itin", "ITIN 987-65-4320")).toEqual(["987654320"]);
  });

  test("an ITIN's group is one the IRS issues ITINs in", () => {
    for (const group of ["50", "65", "70", "88", "90", "92", "94", "99"]) {
      expect(findings("us-itin", `ITIN 912-${group}-4567`)).toEqual([
        `912${group}4567`,
      ]);
    }

    for (const group of ["49", "66", "69", "89", "93"]) {
      expect(findings("us-itin", `ITIN 912-${group}-4567`)).toEqual([]);
    }

    expect(findings("us-itin", "Order 912734567 shipped.")).toEqual([]);
    expect(findings("us-itin", "ITIN 912734567")).toEqual(["912734567"]);
  });

  test("a NINO is read in lower case and without its spaces", () => {
    expect(findings("uk-nino", "ni number jg103784c")).toEqual(["JG103784C"]);
  });

  test("a driving licence's month is the birth month, plus 50 for a woman", () => {
    expect(findings("uk-driving-licence", "LEE99856231J99XY")).toEqual([
      "LEE99856231J99XY",
    ]);
    expect(findings("uk-driving-licence", "LEE99863231J99XY")).toEqual([]);
  });

  test("a CURP's homoclave says the century: a digit before 2000, a letter after", () => {
    // 29 February is a real day in 2000 and not in 1900.
    expect(findings("mx-curp", "CURP GOCC000229HJCMRRA5")).toEqual([
      "GOCC000229HJCMRRA5",
    ]);
    expect(findings("mx-curp", "CURP GOCC000229HJCMRR05")).toEqual([]);
  });

  test("an RFC keeps its Ñ and &, and a company's has three letters", () => {
    expect(findings("mx-rfc", "RFC: PEÑA850312AB1")).toEqual(["PEÑA850312AB1"]);
    expect(findings("mx-rfc", "RFC: A&B050711RT5")).toEqual(["A&B050711RT5"]);
    expect(findings("mx-rfc", "RFC: GOCC-850312-Q81")).toEqual([
      "GOCC850312Q81",
    ]);
  });

  test("an alphanumeric CNPJ is read grouped, its letters counted from 17", () => {
    expect(findings("br-cnpj", "CNPJ 7K.Q9M.Z2X/0001-90")).toEqual([
      "7KQ9MZ2X000190",
    ]);
    expect(findings("br-cnpj", "CNPJ 7K.Q9M.Z2X/0001-91")).toEqual([]);
  });

  test("a woman's CUIT that would need a check digit of 10 is 23 and 4", () => {
    expect(findings("ar-cuit", "CUIL 23-28461534-4")).toEqual(["23284615344"]);
    expect(findings("ar-cuit", "CUIL 23-28461534-3")).toEqual([]);
  });

  test("a RUT's check digit may be K, in either case", () => {
    expect(findings("cl-rut", "RUT 10.234.569-k")).toEqual(["10234569K"]);
  });

  test("Corsica's 2A and 2B count as 19 and 18 in a NIR's key", () => {
    expect(findings("fr-nir", "NIR 1 75 02 2A 123 456 87")).toEqual([
      "175022A12345687",
    ]);
    expect(findings("fr-nir", "NIR 283112B04521866")).toEqual([
      "283112B04521866",
    ]);
    expect(findings("fr-nir", "NIR 175022A12345688")).toEqual([]);
  });

  test("a Steuer-ID repeats exactly one digit, twice or three times apart", () => {
    // 28432629710 has three 2s, none three in a row; 65929970489 has 9, 9 side by side.
    expect(findings("de-tax-id", "IdNr 28432629710")).toEqual(["28432629710"]);
    expect(samples("de-tax-id", "IdNr 65929970489")).toEqual(["65929970489"]);
    expect(findings("de-tax-id", "IdNr 22284361596")).toEqual([]);
  });

  test("a codice fiscale's omocodia letters stand for digits", () => {
    expect(findings("it-codice-fiscale", "CF BNCGPP75L12F20RO")).toEqual([
      "BNCGPP75L12F20RO",
    ]);
    expect(findings("it-codice-fiscale", "cf bncgpp75l12f205t")).toEqual([
      "BNCGPP75L12F205T",
    ]);
  });

  test("a Belgian number's key from 2000 has a 2 in front, and dates there", () => {
    // Born 29 February 2000: the 2000 key passes, the 1900 one names no day.
    expect(findings("be-national-number", "00.02.29-123.20")).toEqual([
      "00022912320",
    ]);
    expect(findings("be-national-number", "00.02.29-123.88")).toEqual([]);
  });

  test("a PESEL's month carries the century", () => {
    expect(findings("pl-pesel", "PESEL 99811012348")).toEqual(["99811012348"]);
    expect(findings("pl-pesel", "PESEL 99931012348")).toEqual([]);
  });

  test("a personnummer may carry its century, a + past 100, or a coordination day", () => {
    expect(findings("se-personnummer", "personnummer 196408233234")).toEqual([
      "196408233234",
    ]);
    expect(findings("se-personnummer", "personnummer 811218+9876")).toEqual([
      "8112189876",
    ]);
    expect(
      findings("se-personnummer", "samordningsnummer 701063-2383"),
    ).toEqual(["7010632383"]);
  });

  test("a fødselsnummer may be a D-number or an H-number", () => {
    expect(findings("no-fodselsnummer", "fnr 55038712399")).toEqual([
      "55038712399",
    ]);
    expect(findings("no-fodselsnummer", "fnr 15488712338")).toEqual([
      "15488712338",
    ]);
  });

  test("a HETU's century sign may be any of the 2023 signs", () => {
    expect(findings("fi-hetu", "hetu 010199Y123Y")).toEqual(["010199Y123Y"]);
    expect(findings("fi-hetu", "hetu 150205B2399")).toEqual(["150205B2399"]);
    expect(findings("fi-hetu", "hetu 150205G2399")).toEqual([]);
  });

  test("a PPS number's 2013 second letter counts in the check, an old one does not", () => {
    expect(findings("ie-ppsn", "PPSN 5730914BA")).toEqual(["5730914BA"]);
    expect(findings("ie-ppsn", "PPSN 6413298JW")).toEqual(["6413298JW"]);
  });

  test("a CNP of a foreign resident may be of either century", () => {
    expect(findings("ro-cnp", "CNP 7850312401234")).toEqual(["7850312401234"]);
  });

  test("an Aadhaar number in its groups counts alone, bare only beside a word", () => {
    expect(findings("in-aadhaar", "Ref 491830274655 kept.")).toEqual([]);
    expect(findings("in-aadhaar", "Aadhaar 491830274655")).toEqual([
      "491830274655",
    ]);
  });

  test("an Aadhaar number is not taken from a card number's groups", () => {
    expect(findings("in-aadhaar", "Card 4918 3027 4655 1234 kept.")).toEqual(
      [],
    );
    expect(findings("in-aadhaar", "Card 1234 4918 3027 4655 kept.")).toEqual(
      [],
    );
  });

  test("a resident ID's check character X may be written in lower case", () => {
    expect(findings("cn-resident-id", "ID 31010420030215126x")).toEqual([
      "31010420030215126X",
    ]);
  });

  test("an NRIC or FIN checks against its own series' table", () => {
    for (const value of ["F7351942W", "G6042817X", "M4271839K"]) {
      expect(findings("sg-nric", `FIN ${value}`)).toEqual([value]);
    }

    expect(findings("sg-nric", "FIN M4271839X")).toEqual([]);
  });

  test("an HKID's check may be A, with or without its brackets", () => {
    for (const value of ["Z683141(A)", "Z683141A", "Z683141 (A)"]) {
      expect(findings("hk-hkid", `HKID ${value}`)).toEqual(["Z683141A"]);
    }
  });

  test("a Taiwanese resident foreigner's number has 8 or 9 for sex", () => {
    expect(findings("tw-national-id", "UI No. A800012345")).toEqual([
      "A800012345",
    ]);
  });

  test("an IRD number falls back to the secondary weights", () => {
    expect(findings("nz-ird", "IRD 102-938-470")).toEqual(["102938470"]);
  });

  test("a passport number is read in any case", () => {
    expect(findings("passport-number", "passport no. pa7193846")).toEqual([
      "PA7193846",
    ]);
  });
});

describe("a passport's country", () => {
  // The types the whole scanner reports in a text, every detector competing.
  const typesIn: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return findSensitiveValues(text).map((match: TextMatch): string => {
      return match.dataTypeId;
    });
  };

  test("beside 'passport' alone, a number is a passport of no country: nothing tells a US one from a UK one", () => {
    for (const value of ["563207914", "534712986", "A21847390"]) {
      const types: Array<string> = typesIn(`Passport number: ${value}`);

      expect(types).toContain("passport-number");
      expect(types).not.toContain("us-passport");
      expect(types).not.toContain("uk-passport");
    }
  });

  test("beside words that name the country, it is that country's passport, and only that", () => {
    expect(typesIn("US passport: 563207914")).toEqual(["us-passport"]);
    expect(typesIn("u.s. passport no 563207914")).toEqual(["us-passport"]);
    expect(typesIn("British passport: 534712986")).toEqual(["uk-passport"]);
    expect(typesIn("HMPO ref passport 534712986")).toEqual(["uk-passport"]);
  });

  test("a column named for one country's passports is that country's", () => {
    expect(typesIn("passport 563207914")).not.toContain("us-passport");
    expect(typesIn("usa passport 563207914")).toEqual(["us-passport"]);
    expect(typesIn("gb passport 534712986")).toEqual(["uk-passport"]);
  });
});
