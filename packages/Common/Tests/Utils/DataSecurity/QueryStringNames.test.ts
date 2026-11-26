import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DataSecurityOccurrenceExcerpt,
  DataSecurityOccurrenceExcerptPart,
  DataSecurityOccurrenceExcerptPartKind,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import BUILT_IN_DETECTORS from "../../../Utils/DataSecurity/Detectors/Index";
import {
  classifyField,
  FieldClassification,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  buildOccurrenceExcerpt,
  maskSensitiveText,
} from "../../../Utils/DataSecurity/OccurrenceExcerpt";
import {
  findQueryStringNames,
  QueryStringName,
} from "../../../Utils/DataSecurity/QueryStringNames";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A PERSON'S NAME IN A URL'S QUERY STRING, BY THE PARAMETER'S NAME (#11034).
 *
 * Where the names-and-addresses model does not run - it is off, a probe has
 * none, its time ran out - a URL's query parameter is read as the field it
 * is: one named as a column of people's names would be (full_name,
 * firstName, filter[last_name]) holds a person's name, read as a query
 * string writes it - escapes read, a character's UTF-8 bytes too, a "+" a
 * space - and placed on the characters it is written with, so every
 * excerpt, sample and AI input hides it there. Each name is made up.
 */

const NAME: string = "Ottilie Quarrington";

function urlWith(query: string): string {
  return `GET https://shop.example.com/account?${query}&lang=en 200`;
}

// The written values the rule found in a text.
function writtenNames(text: string): Array<string> {
  return findQueryStringNames(text).map((name: QueryStringName): string => {
    return text.slice(name.start, name.end);
  });
}

function personNames(
  text: string,
  options: Parameters<typeof findSensitiveValues>[1] = {},
): Array<TextMatch> {
  return findSensitiveValues(text, options).filter(
    (match: TextMatch): boolean => {
      return match.dataTypeId === "person-name";
    },
  );
}

function shownText(excerpt: DataSecurityOccurrenceExcerpt): string {
  return excerpt.parts
    .map((part: DataSecurityOccurrenceExcerptPart): string => {
      return part.text;
    })
    .join("");
}

describe("a person's name a query parameter names", () => {
  test("the issue's: a name percent-encoded, its UTF-8 bytes too", () => {
    const text: string =
      "GET /profile?full_name=Jos%C3%A9%20Garc%C3%ADa&tab=orders 200";
    const [name] = findQueryStringNames(text);

    expect(text.slice(name!.start, name!.end)).toBe("Jos%C3%A9%20Garc%C3%ADa");
    expect(name!.normalized).toBe("José García");
    expect(name!.isTestValue).toBe(false);
  });

  test.each([
    ["first_name", "Ottilie"],
    ["firstName", "Ottilie"],
    ["FirstName", "Ottilie"],
    ["first-name", "Ottilie"],
    ["last_name", "Quarrington"],
    ["lastName", "Quarrington"],
    ["surname", "Quarrington"],
    ["forename", "Ottilie"],
    ["given_name", "Ottilie"],
    ["family_name", "Quarrington"],
    ["middle_name", "Mae"],
    ["maiden_name", "Hale"],
    ["fname", "Ottilie"],
    ["lname", "Quarrington"],
    ["fullname", "Ottilie%20Quarrington"],
    ["fullName", "Ottilie+Quarrington"],
    ["full_name", "Ottilie%20Quarrington"],
    ["customer_name", "Ottilie+Quarrington"],
    ["patient_name", "Ottilie%20Quarrington"],
    ["contact_name", "Ottilie%20Quarrington"],
    ["cardholder_name", "OTTILIE%20QUARRINGTON"],
    ["billing.first_name", "Ottilie"],
    ["user[first_name]", "Ottilie"],
    ["user%5Bfirst_name%5D", "Ottilie"],
    ["filter[last_name]", "Quarrington"],
    ["full%5Fname", "Ottilie%20Quarrington"],
  ])(
    "under %s, as a column of that name holds one",
    (key: string, value: string) => {
      const text: string = urlWith(`${key}=${value}`);

      expect(writtenNames(text)).toEqual([value]);
    },
  );

  test.each([
    [
      "a + for a space",
      "full_name=Lars+Eriksson",
      "Lars+Eriksson",
      "Lars Eriksson",
    ],
    [
      "escaped twice",
      "full_name=Lars%2520Eriksson",
      "Lars%2520Eriksson",
      "Lars Eriksson",
    ],
    [
      "a form's + escaped once more",
      "full_name=Lars%2BEriksson",
      "Lars%2BEriksson",
      "Lars Eriksson",
    ],
    [
      "an accent's combining mark",
      "first_name=Rene%CC%81e",
      "Rene%CC%81e",
      "Renée",
    ],
    [
      "another script",
      "full_name=%E5%BC%A0%E4%BC%9F",
      "%E5%BC%A0%E4%BC%9F",
      "张伟",
    ],
    [
      "an apostrophe and a hyphen",
      "last_name=O%27Brien-Smith",
      "O%27Brien-Smith",
      "O'Brien-Smith",
    ],
    [
      "an initial",
      "full_name=J.%20R.%20Quarrington",
      "J.%20R.%20Quarrington",
      "J. R. Quarrington",
    ],
  ])(
    "written with %s",
    (_label: string, query: string, written: string, reads: string) => {
      const text: string = urlWith(query);
      const found: Array<QueryStringName> = findQueryStringNames(text);

      expect(writtenNames(text)).toEqual([written]);
      expect(found[0]!.normalized).toBe(reads);
    },
  );

  test.each([
    [
      "a bare query string",
      "first_name=Ottilie&last_name=Quarrington",
      ["Ottilie", "Quarrington"],
    ],
    ["after a ;", "/account;first_name=Ottilie", ["Ottilie"]],
    [
      "after an HTML-escaped &",
      "/account?a=1&amp;first_name=Ottilie",
      ["Ottilie"],
    ],
    ["before a fragment", "/account?full_name=Ottilie#orders", ["Ottilie"]],
    [
      "in a JSON string",
      '{"url":"/account?full_name=Ottilie%20Quarrington","status":200}',
      ["Ottilie%20Quarrington"],
    ],
    [
      "in a log line, two of them",
      "redirect /a?first_name=Ottilie&b=2 then /c?last_name=Quarrington",
      ["Ottilie", "Quarrington"],
    ],
  ])("in %s", (_label: string, text: string, expected: Array<string>) => {
    expect(writtenNames(text)).toEqual(expected);
  });

  test("a placeholder's name is a test value, counted apart", () => {
    const [name] = findQueryStringNames(urlWith("full_name=Jane%20Doe"));

    expect(name!.normalized).toBe("Jane Doe");
    expect(name!.isTestValue).toBe(true);
  });
});

describe("what is no person's name", () => {
  test.each([
    [
      "a parameter named name alone: the model reads those",
      "name=Ottilie%20Quarrington",
    ],
    ["a product's name", "product_name=Blue%20Widget"],
    ["a file's name", "file_name=report"],
    ["a file's name, run together", "filename=report"],
    ["a host's name", "hostname=web"],
    ["a username", "username=ottilie"],
    ["a company's name", "company_name=Acme"],
    ["a city's name", "city_name=Lisbon"],
    ["a display name", "display_name=Ottilie"],
    ["a hint in the value", "q=first_name"],
    ["a sort by name", "sort=last_name"],
    ["a sort's direction", "sort[last_name]=desc"],
    ["an order's direction", "order%5Bfirst_name%5D=ASC"],
    ["null", "first_name=null"],
    ["undefined", "first_name=undefined"],
    ["true", "first_name=true"],
    ["a guest", "full_name=Guest"],
    ["no value", "last_name="],
    ["digits", "full_name=12345"],
    ["an email address", "full_name=ottilie%40example.com"],
    ["a wildcard", "first_name=%2A"],
    ["a file under fname", "fname=report.pdf"],
    ["an object printed", "first_name=%5Bobject%20Object%5D"],
  ])("%s", (_label: string, query: string) => {
    expect(writtenNames(urlWith(query))).toEqual([]);
  });

  test("a text with no = or no name in it is not read at all", () => {
    expect(findQueryStringNames("")).toEqual([]);
    expect(findQueryStringNames("Ottilie Quarrington signed in")).toEqual([]);
    expect(findQueryStringNames("GET /account?id=42&lang=en")).toEqual([]);
    expect(findQueryStringNames("first_name Ottilie")).toEqual([]);
  });
});

describe("every scan finds it, through the shared scanner", () => {
  const text: string = urlWith("full_name=Ottilie%20Quarrington");
  const written: string = "Ottilie%20Quarrington";

  test("as a person's name, High, on the characters it is written with", () => {
    const [match] = personNames(text);

    expect(text.slice(match!.start, match!.end)).toBe(written);
    expect(match!.normalized).toBe(NAME);
    expect(match!.confidence).toBe(DataConfidence.High);
    expect(match!.fromFieldName).toBe(true);
    expect(match!.fromModel).toBeUndefined();
  });

  test("with every built-in detector given, the project's own after them", () => {
    expect(
      personNames(text, { detectors: [...BUILT_IN_DETECTORS] }),
    ).toHaveLength(1);
  });

  test("not by a scan that runs some detectors alone, unless it asks", () => {
    const some: typeof BUILT_IN_DETECTORS = BUILT_IN_DETECTORS.slice(0, 3);

    expect(personNames(text, { detectors: some })).toEqual([]);
    expect(
      personNames(text, { detectors: [], readsQueryStringNames: true }),
    ).toHaveLength(1);
    expect(personNames(text, { readsQueryStringNames: false })).toEqual([]);
  });

  test("not when the project turned names off, or allows this one", () => {
    expect(
      personNames(text, { disabledDataTypeIds: new Set(["person-name"]) }),
    ).toEqual([]);
    expect(
      personNames(text, { allowedValues: new Set(["ottilie quarrington"]) }),
    ).toEqual([]);
  });

  test("beside the other data the URL holds", () => {
    const both: string = urlWith(
      "full_name=Ottilie+Quarrington&email=ottilie%40example.com",
    );

    expect(
      findSensitiveValues(both).map((match: TextMatch): Array<string> => {
        return [match.dataTypeId, both.slice(match.start, match.end)];
      }),
    ).toEqual([
      ["person-name", "Ottilie+Quarrington"],
      ["email-address", "ottilie%40example.com"],
    ]);
  });

  test("once, when the model found the same name", () => {
    const start: number = text.indexOf(written);
    const matches: Array<TextMatch> = findSensitiveValues(text, {}, [
      {
        dataTypeId: "person-name",
        start,
        end: start + written.length,
        score: 0.97,
      },
    ]);

    expect(
      matches.filter((match: TextMatch): boolean => {
        return match.dataTypeId === "person-name";
      }),
    ).toHaveLength(1);
  });
});

describe("hidden wherever a scan shows it", () => {
  const urls: Array<string> = [
    "GET /contacts?full_name=Lars+Eriksson&source=import 201",
    ...Array.from({ length: 9 }, (_value: unknown, index: number): string => {
      return `GET /contacts?page=${index + 2}&source=import 200`;
    }),
  ];

  test("a field of URLs: one in ten is a person's, High however few, its sample masked", () => {
    const names: FieldClassification | undefined = classifyField(
      "http.url",
      urls,
    ).find((classification: FieldClassification): boolean => {
      return classification.dataTypeId === "person-name";
    });

    expect(names).toBeDefined();
    expect(names!.confidence).toBe(DataConfidence.High);
    expect(names!.valuesWithMatch).toBe(1);
    expect(names!.maskedSamples).toEqual(["L****"]);
    expect(names!.foundByModel).toBeUndefined();
    expect(names!.foundByName).toBe(false);
  });

  test("a record's excerpt marks it where it is, masked, never shown", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value: urls[0]!,
      dataTypeId: "person-name",
      location: "http.url",
    });
    const shown: string = shownText(excerpt);

    expect(
      excerpt.parts.some((part: DataSecurityOccurrenceExcerptPart): boolean => {
        return (
          part.kind === DataSecurityOccurrenceExcerptPartKind.Match &&
          part.text === "L****"
        );
      }),
    ).toBe(true);
    expect(shown).toContain("full_name=");
    expect(shown).not.toContain("Lars");
    expect(shown).not.toContain("Eriksson");
  });

  test("another finding's excerpt masks it too", () => {
    const value: string =
      "GET /contacts?full_name=Lars+Eriksson&email=lars%40example.com 201";
    const shown: string = shownText(
      buildOccurrenceExcerpt({
        value,
        dataTypeId: "email-address",
        location: "http.url",
      }),
    );

    expect(shown).not.toContain("Lars");
    expect(shown).not.toContain("Eriksson");
  });

  test("a masked text never shows it", () => {
    const masked: { text: string; isMasked: boolean } = maskSensitiveText(
      urls[0]!,
    );

    expect(masked.isMasked).toBe(true);
    expect(masked.text).not.toContain("Lars");
  });
});

describe("in time in line with the text's length", () => {
  const LIMIT_IN_MS: number = 2000;
  const LENGTH: number = 400_000;

  function repeat(piece: string): string {
    return piece.repeat(Math.ceil(LENGTH / piece.length)).slice(0, LENGTH);
  }

  test.each([
    ["parameters named for a name without values", repeat("&full_name=")],
    ["names without end", repeat("&first_name=Ottilie")],
    ["one value without end", `first_name=${"a".repeat(LENGTH)}`],
    ["keys of name without =", repeat(`&${"name".repeat(16)}`)],
    ["keys of name up to = without values", repeat(`&${"name".repeat(15)}=`)],
    [
      "escapes without end in values",
      repeat(`&full_name=${"%C3%A9".repeat(42)}`),
    ],
    ["question marks without end", repeat("?")],
    ["brackets without end", repeat("&a[name][")],
  ])("reads %s", (_label: string, text: string) => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return findSensitiveValues(text).length;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
  });
});
