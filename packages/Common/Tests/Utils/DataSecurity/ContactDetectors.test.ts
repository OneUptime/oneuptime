import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import CONTACT_DETECTORS, {
  hasCountryCallingCode,
  isDocumentationIpv4,
  isPlausibleBirthDate,
  isPublicIpv4,
  isPublicIpv6,
  isTestEmail,
  isTestPhoneNumber,
  isValidEmail,
  isValidVin,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import {
  classifyField,
  FieldClassification,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";

/*
 * CONTACT AND IDENTITY, AS THE SCANNER FINDS THEM.
 *
 * Each type is found where it turns up - a log line, a CSV cell, JSON - and
 * refused where it nearly does: an image asset named like an email, a
 * private address, a clock, a number inside a longer one. Documentation's
 * own values (example.com, 555-0100, 192.0.2.0/24) are counted apart as
 * test values. The detectors of this file run alone, so what another
 * family finds cannot hide what this one misses.
 */

interface Found {
  dataTypeId: string;
  value: string;
  confidence: DataConfidence;
  isTestValue: boolean;
}

function scan(text: string): Array<Found> {
  return findSensitiveValues(text, { detectors: CONTACT_DETECTORS }).map(
    (match: TextMatch) => {
      return {
        dataTypeId: match.dataTypeId,
        value: text.slice(match.start, match.end),
        confidence: match.confidence,
        isTestValue: match.isTestValue,
      };
    },
  );
}

function found(
  dataTypeId: string,
  value: string,
  confidence: DataConfidence,
  isTestValue: boolean = false,
): Found {
  return { dataTypeId, value, confidence, isTestValue };
}

function expectFound(text: string, expected: Array<Found>): void {
  expect([text, scan(text)]).toEqual([text, expected]);
}

function expectNothingOf(dataTypeId: string, texts: Array<string>): void {
  for (const text of texts) {
    expect([
      text,
      scan(text).filter((match: Found) => {
        return match.dataTypeId === dataTypeId;
      }),
    ]).toEqual([text, []]);
  }
}

function classified(
  fieldPath: string,
  values: Array<unknown>,
  dataTypeId: string,
): FieldClassification | undefined {
  return classifyField(fieldPath, values, {
    detectors: CONTACT_DETECTORS,
  }).find((result: FieldClassification) => {
    return result.dataTypeId === dataTypeId;
  });
}

const H: DataConfidence = DataConfidence.High;
const M: DataConfidence = DataConfidence.Medium;
const L: DataConfidence = DataConfidence.Low;

describe("email-address", () => {
  test("is found in a log line, a CSV cell and JSON, and High on its own", () => {
    expectFound("2026-10-27T10:15:02Z INFO login ok user=jane.doe@acme.io", [
      found("email-address", "jane.doe@acme.io", H),
    ]);
    expectFound("name,email\nJane,jane.doe+news@sub.acme.co.uk", [
      found("email-address", "jane.doe+news@sub.acme.co.uk", H),
    ]);
    expectFound('{"owner":"Jane.Doe@Acme.IO"}', [
      found("email-address", "Jane.Doe@Acme.IO", H),
    ]);
  });

  test("is normalized to lower case", () => {
    const matches: Array<TextMatch> = findSensitiveValues(
      "to: Jane.Doe@Acme.IO",
      { detectors: CONTACT_DETECTORS },
    );

    expect(
      matches.map((match: TextMatch) => {
        return match.normalized;
      }),
    ).toEqual(["jane.doe@acme.io"]);
  });

  test("refuses image assets and files named like an email", () => {
    expectNothingOf("email-address", [
      "<img src=logo@2x.png>",
      "icon@3x.webp, sprite@2x.svg",
      "import bundle@1.2.3.js",
      "theme@dark.css",
    ]);
  });

  test("refuses malformed addresses and a top-level label that is too short", () => {
    expectNothingOf("email-address", [
      "jane..doe@acme.io",
      ".jane@acme.io",
      "jane.@acme.io",
      "jane@-acme.io",
      "jane@acme-.io",
      "jane@acme..io",
      "a@b.c",
      "user@localhost",
    ]);
  });

  test("is not found inside a longer token", () => {
    expectNothingOf("email-address", [
      "jane.doe@acme.io9",
      "jane.doe@acme.io-x",
    ]);
  });

  test("counts documentation and reserved domains as test values", () => {
    expectFound(
      "mail test@example.com, qa@foo.test, y@sub.example.org and z@demo.invalid",
      [
        found("email-address", "test@example.com", H, true),
        found("email-address", "qa@foo.test", H, true),
        found("email-address", "y@sub.example.org", H, true),
        found("email-address", "z@demo.invalid", H, true),
      ],
    );
  });

  test("isValidEmail and isTestEmail say why", () => {
    expect(isValidEmail("jane@acme.io")).toBe(true);
    expect(isValidEmail("logo@2x.png")).toBe(false);
    expect(isValidEmail("@acme.io")).toBe(false);
    expect(isValidEmail("jane@acme." + "a".repeat(64) + ".io")).toBe(false);
    expect(isTestEmail("jane@EXAMPLE.com")).toBe(true);
    expect(isTestEmail("jane@localhost")).toBe(true);
    expect(isTestEmail("jane@example.co")).toBe(false);
  });
});

describe("phone-number", () => {
  test("is found in international format, Medium alone and High next to phone words", () => {
    expectFound("+81 3-1234-5678", [
      found("phone-number", "+81 3-1234-5678", M),
    ]);
    expectFound("Call me on +1 (415) 555-2671 tomorrow", [
      found("phone-number", "+1 (415) 555-2671", H),
    ]);
    expectFound('{"mobile":"+49 30 901820"}', [
      found("phone-number", "+49 30 901820", H),
    ]);
  });

  test("is found in North American formats", () => {
    expectFound("(415) 555-2671", [found("phone-number", "(415) 555-2671", M)]);
    expectFound("415-555-2671", [found("phone-number", "415-555-2671", M)]);
    expectFound("cell: 415.555.2671", [
      found("phone-number", "415.555.2671", H),
    ]);
  });

  test("finds a UK mobile, Low alone and High next to phone words", () => {
    expectFound("07911 123456", [found("phone-number", "07911 123456", L)]);
    expectFound("mobile 07911 123456", [
      found("phone-number", "07911 123456", M),
    ]);
    // Unspaced, it is also a national number, which phone words make High.
    expectFound("mobile 07911123456", [
      found("phone-number", "07911123456", H),
    ]);
  });

  test("refuses calling codes that do not exist, unbalanced brackets and runs of separators", () => {
    expectNothingOf("phone-number", [
      "+999 1234 5678",
      "+1 (415 555-2671",
      "+1 415--555---2671",
      "ref +12345",
      "a+44 20 7946 1234",
    ]);
  });

  test("refuses N11 service codes and numbers inside longer ones", () => {
    expectNothingOf("phone-number", [
      "911-555-2671",
      "415-911-2671",
      "115-555-2671",
      "415-155-2671",
      "1415-555-2671",
      "415-555-26711",
      "v415-555-2671",
    ]);
  });

  test("takes a bare national number only next to phone words", () => {
    expectFound("tel 0201234567", [found("phone-number", "0201234567", H)]);
    expectNothingOf("phone-number", ["id 0201234567", "0201234567"]);
  });

  test("refuses placeholder digit runs", () => {
    expectNothingOf("phone-number", [
      "phone 123456789",
      "phone: 9876543210",
      "+1111111111",
      "phone 0000000000",
    ]);
  });

  test("counts the numbers set aside for fiction as test values", () => {
    expectFound("call (212) 555-0123", [
      found("phone-number", "(212) 555-0123", H, true),
    ]);
    expectFound("call +44 20 7946 0958", [
      found("phone-number", "+44 20 7946 0958", H, true),
    ]);
    expectFound("call (212) 555-0200", [
      found("phone-number", "(212) 555-0200", H),
    ]);
    expect(isTestPhoneNumber("12125550199")).toBe(true);
    expect(isTestPhoneNumber("2125550100")).toBe(true);
    expect(isTestPhoneNumber("2125550200")).toBe(false);
    expect(isTestPhoneNumber("447700900123")).toBe(true);
    expect(isTestPhoneNumber("07700900123")).toBe(true);
    expect(isTestPhoneNumber("07700800123")).toBe(false);
  });

  test("hasCountryCallingCode knows the codes in use", () => {
    expect(hasCountryCallingCode("14155552671")).toBe(true);
    expect(hasCountryCallingCode("442079460958")).toBe(true);
    expect(hasCountryCallingCode("8613800138000")).toBe(true);
    expect(hasCountryCallingCode("99912345678")).toBe(false);
    expect(hasCountryCallingCode("2851234567")).toBe(false);
  });

  test("is found by its shape in a column named for it", () => {
    const result: FieldClassification | undefined = classified(
      "customer_phone",
      ["0161 496 0723", "0161 496 0854", "020 7946 1234"],
      "phone-number",
    );

    expect(result).toMatchObject({
      confidence: H,
      matchCount: 3,
      valuesWithMatch: 3,
      nameHinted: true,
    });
    expect(
      classified("notes", ["0161 496 0723", "0161 496 0854"], "phone-number"),
    ).toBeUndefined();
  });
});

describe("postal-address", () => {
  test("is a house number, a street name and a street type", () => {
    expectFound("Ship to: 1600 Pennsylvania Avenue NW", [
      found("postal-address", "1600 Pennsylvania Avenue", H),
    ]);
    expectFound("lives at 221B Baker Street, London", [
      found("postal-address", "221B Baker Street", H),
    ]);
    expectFound("742 Evergreen Terrace", [
      found("postal-address", "742 Evergreen Terrace", M),
    ]);
    expectFound("10 Downing St.", [
      found("postal-address", "10 Downing St.", M),
    ]);
  });

  test("refuses numbers with words that are not a street, and a number inside a token", () => {
    expectNothingOf("postal-address", [
      "12 apples on 3 Main shelves",
      "x12 High Street",
      "12 high street",
    ]);
  });

  test("is found by its shape in an address column", () => {
    expect(
      classified(
        "billing_address",
        ["12 rue de Rivoli, Paris", "8 Unter den Linden, Berlin"],
        "postal-address",
      ),
    ).toMatchObject({ confidence: H, matchCount: 2, nameHinted: true });
  });
});

describe("postal-code", () => {
  test("finds a UK postcode with its space, and a Canadian postal code", () => {
    expectFound("SW1A 1AA", [found("postal-code", "SW1A 1AA", M)]);
    expectFound("Postcode: EC1A 1BB", [found("postal-code", "EC1A 1BB", H)]);
    expectFound("K1A 0B1", [found("postal-code", "K1A 0B1", L)]);
    expectFound("postal code: K1A0B1", [found("postal-code", "K1A0B1", M)]);
  });

  test("refuses the letters a code never uses and codes inside longer tokens", () => {
    expectNothingOf("postal-code", [
      "SW1A 1CA",
      "XSW1A 1AA",
      "sw1a 1aa",
      "D1A 0B1",
      "K1A 0B1X",
    ]);
  });

  test("takes a US ZIP only next to words that say so", () => {
    expectFound("zip 94105", [found("postal-code", "94105", H)]);
    expectFound("zip: 94105-1234", [found("postal-code", "94105-1234", H)]);
    expectNothingOf("postal-code", [
      "94105",
      "zip 00000",
      "zip 941055",
      "zip code 9410",
    ]);
  });

  test("is found in a ZIP column of bare numbers", () => {
    expect(
      classified("zip_code", [94105, "10001", "60614-2201"], "postal-code"),
    ).toMatchObject({ confidence: H, matchCount: 3, nameHinted: true });
  });
});

describe("date-of-birth", () => {
  test("is a real date next to words that say it is a birth date", () => {
    expectFound("dob: 1985-03-12", [found("date-of-birth", "1985-03-12", H)]);
    expectFound("DOB 12/03/1985", [found("date-of-birth", "12/03/1985", H)]);
    expectFound("date of birth: 31.12.1999", [
      found("date-of-birth", "31.12.1999", H),
    ]);
    expectFound("birthday March 12, 1985", [
      found("date-of-birth", "March 12, 1985", H),
    ]);
    expectFound("born 12 Mar 1985", [found("date-of-birth", "12 Mar 1985", H)]);
    expectFound("Geburtsdatum: 12.03.1985", [
      found("date-of-birth", "12.03.1985", H),
    ]);
  });

  test("is no birth date without those words", () => {
    expectNothingOf("date-of-birth", ["1985-03-12", "invoice date 1985-03-12"]);
  });

  test("refuses dates that are not real or not a plausible birth year", () => {
    expectNothingOf("date-of-birth", [
      "dob: 1985-02-30",
      "dob: 2023-02-29",
      "dob 13/13/1985",
      "dob: 1899-01-01",
      "dob: 2099-01-01",
    ]);
    expectFound("dob: 2024-02-29", [found("date-of-birth", "2024-02-29", H)]);
  });

  test("isPlausibleBirthDate reads every way people write a date", () => {
    const thisYear: number = new Date().getUTCFullYear();

    expect(isPlausibleBirthDate("1985-03-12")).toBe(true);
    expect(isPlausibleBirthDate("03/12/1985")).toBe(true);
    expect(isPlausibleBirthDate("31/12/1985")).toBe(true);
    expect(isPlausibleBirthDate("12 March 1985")).toBe(true);
    expect(isPlausibleBirthDate("March 12, 1985")).toBe(true);
    expect(isPlausibleBirthDate(`${thisYear}-01-01`)).toBe(true);
    expect(isPlausibleBirthDate(`${thisYear + 1}-01-01`)).toBe(false);
    expect(isPlausibleBirthDate("31/31/1985")).toBe(false);
    expect(isPlausibleBirthDate("1985-03")).toBe(false);
  });

  test("is found in a column named for it, from the date a Date value becomes", () => {
    expect(
      classified(
        "date_of_birth",
        [new Date(Date.UTC(1985, 2, 12)), "1990-07-01", "12/31/1979"],
        "date-of-birth",
      ),
    ).toMatchObject({ confidence: H, matchCount: 3, nameHinted: true });
  });
});

describe("ip-address", () => {
  test("finds a public IPv4 address, High next to address words", () => {
    expectFound("remote_addr=81.2.69.142", [
      found("ip-address", "81.2.69.142", H),
    ]);
    expectFound("8.8.8.8", [found("ip-address", "8.8.8.8", M)]);
    expectFound("172.32.5.4", [found("ip-address", "172.32.5.4", M)]);
  });

  test("refuses private, loopback, link-local, shared, benchmark, multicast and reserved addresses", () => {
    expectNothingOf("ip-address", [
      "client 10.1.2.3",
      "client 172.16.5.4",
      "client 192.168.0.1",
      "client 127.0.0.1",
      "client 169.254.1.1",
      "client 100.64.0.1",
      "client 198.18.0.1",
      "client 0.0.0.0",
      "client 224.0.0.1",
      "client 255.255.255.255",
    ]);
  });

  test("refuses octets out of range and addresses inside longer dotted runs", () => {
    expectNothingOf("ip-address", [
      "81.2.69.256",
      "081.2.69.142",
      "1.2.3.4.5",
      "v81.2.69.142.1",
    ]);
  });

  test("is Low next to words that say it is a version", () => {
    expectFound("version 1.2.3.4", [found("ip-address", "1.2.3.4", L)]);
    expectFound("build 81.2.69.142", [found("ip-address", "81.2.69.142", L)]);
  });

  test("counts documentation addresses as test values", () => {
    expectFound(
      '203.0.113.7 - - [27/Oct/2026:10:15:02 +0000] "GET / HTTP/1.1" 200',
      [found("ip-address", "203.0.113.7", M, true)],
    );
    expectFound("client 198.51.100.23", [
      found("ip-address", "198.51.100.23", H, true),
    ]);
    expect(isDocumentationIpv4("192.0.2.1")).toBe(true);
    expect(isDocumentationIpv4("192.0.20.1")).toBe(false);
  });

  test("finds IPv6 written out and compressed", () => {
    expectFound("x-forwarded-for: 2a00:1450:4001:81b::200e", [
      found("ip-address", "2a00:1450:4001:81b::200e", H),
    ]);
    expectFound("2606:4700:4700::1111", [
      found("ip-address", "2606:4700:4700::1111", M),
    ]);
    expectFound("2a00:1450:4001:081b:0000:0000:0000:200e", [
      found("ip-address", "2a00:1450:4001:081b:0000:0000:0000:200e", M),
    ]);
  });

  test("refuses clocks, MAC addresses and IPv6 addresses that point at no one", () => {
    expectNothingOf("ip-address", [
      "at 12:30:45",
      "at 12:30:45.123",
      "00:1a:2b:3c:4d:5e",
      "::1",
      "fe80::1%eth0",
      "fd00::1",
      "ff02::1",
      "std::vector",
      "1:2:3:4:5:6:7:8:9",
    ]);
  });

  test("counts the IPv6 documentation prefix as a test value however it is written", () => {
    expectFound("client 2001:db8::1", [
      found("ip-address", "2001:db8::1", H, true),
    ]);
    expectFound("2001:0db8:85a3::8a2e:370:7334", [
      found("ip-address", "2001:0db8:85a3::8a2e:370:7334", M, true),
    ]);
  });

  test("isPublicIpv4 and isPublicIpv6 draw the lines", () => {
    expect(isPublicIpv4("172.15.255.255")).toBe(true);
    expect(isPublicIpv4("172.31.0.1")).toBe(false);
    expect(isPublicIpv4("100.63.0.1")).toBe(true);
    expect(isPublicIpv4("1.2.3")).toBe(false);
    expect(isPublicIpv6("2a00:1450::1")).toBe(true);
    expect(isPublicIpv6("2a00::1::2")).toBe(false);
    expect(isPublicIpv6("2a00:1:2:3:4:5:6")).toBe(false);
    expect(isPublicIpv6("2a00:12345::1")).toBe(false);
    expect(isPublicIpv6("fe80::1")).toBe(false);
  });
});

describe("mac-address", () => {
  test("is six pairs with one separator throughout", () => {
    expectFound("mac 00:1A:2B:3C:4D:5E", [
      found("mac-address", "00:1A:2B:3C:4D:5E", H),
    ]);
    expectFound("hwaddr 00-1a-2b-3c-4d-5e", [
      found("mac-address", "00-1a-2b-3c-4d-5e", H),
    ]);
    expectFound("00:1a:2b:3c:4d:5e", [
      found("mac-address", "00:1a:2b:3c:4d:5e", M),
    ]);
  });

  test("refuses mixed separators, the zero and broadcast addresses and longer runs", () => {
    expectNothingOf("mac-address", [
      "00:1a-2b:3c:4d:5e",
      "00:00:00:00:00:00",
      "ff:ff:ff:ff:ff:ff",
      "00:1a:2b:3c:4d:5e:6f",
      "0:1a:2b:3c:4d:5e",
    ]);
  });

  test("is normalized to lower case with colons", () => {
    expect(
      findSensitiveValues("hwaddr 00-1A-2B-3C-4D-5E", {
        detectors: CONTACT_DETECTORS,
      })[0]?.normalized,
    ).toBe("00:1a:2b:3c:4d:5e");
  });
});

describe("advertising-id", () => {
  const id: string = ["6D92078A", "8246", "4BA4", "AE5B", "76104861E7DC"].join(
    "-",
  );

  test("is a UUID only next to the words that name one", () => {
    expectFound(`idfa=${id}`, [found("advertising-id", id, H)]);
    expectNothingOf("advertising-id", [id, `request id ${id}`]);
  });

  test("counts the zeroed ID of a device that turned tracking off as a test value", () => {
    const zero: string = "00000000-0000-0000-0000-000000000000";

    expectFound(`gaid: ${zero}`, [found("advertising-id", zero, H, true)]);
  });

  test("is found in a column named for it", () => {
    expect(
      classified("idfa", [id, id.toLowerCase()], "advertising-id"),
    ).toMatchObject({
      confidence: H,
      matchCount: 2,
      distinctValues: 1,
    });
  });
});

describe("geolocation", () => {
  test("finds a precise latitude and longitude pair", () => {
    expectFound("location 37.774929,-122.419416", [
      found("geolocation", "37.774929,-122.419416", H),
    ]);
    expectFound("37.774929, -122.419416", [
      found("geolocation", "37.774929, -122.419416", M),
    ]);
  });

  test("takes one coordinate only next to its name", () => {
    expectFound("lat: 37.774929", [found("geolocation", "37.774929", H)]);
    expectNothingOf("geolocation", ["37.774929", "version 3.14159265"]);
  });

  test("refuses imprecise, impossible and null-island coordinates", () => {
    expectNothingOf("geolocation", [
      "lat 37.77",
      "91.123456, 10.123456",
      "lng 200.123456",
      "0.0000, 0.0000",
    ]);
  });

  test("is found in latitude and longitude columns", () => {
    expect(
      classified(
        "pickup.latitude",
        [37.774929, 40.712776, -33.86882],
        "geolocation",
      ),
    ).toMatchObject({ confidence: H, matchCount: 3, nameHinted: true });
  });
});

describe("vehicle-identification-number", () => {
  test("is seventeen characters with a valid check digit", () => {
    expectFound("VIN: 1HGCM82633A004352", [
      found("vehicle-identification-number", "1HGCM82633A004352", M),
    ]);
    expectFound("1HGCM82633A004352", [
      found("vehicle-identification-number", "1HGCM82633A004352", L),
    ]);
  });

  test("refuses a wrong check digit, a wrong length, the letters a VIN never uses and placeholders", () => {
    expectNothingOf("vehicle-identification-number", [
      "1HGCM82633A004353",
      "1HGCM82633A00435",
      "1HGCM82633A0043521",
      "1HGCM82O33A004352",
      "11111111111111111",
    ]);
    expect(isValidVin("1HGCM82633A004352")).toBe(true);
    expect(isValidVin("1HGCM82633A004353")).toBe(false);
    expect(isValidVin("12345678901234567")).toBe(false);
  });
});

describe("every contact detector", () => {
  test("finds nothing in plain prose and numbers that are not personal", () => {
    expect(
      scan(
        "The deploy at 12:30:45 took 3.5 seconds; 42 pods restarted, build 7 of 9 passed.",
      ),
    ).toEqual([]);
  });

  test("finds each value once when several sit in one line", () => {
    expect(
      scan(
        "user=jane.doe@acme.io ip=81.2.69.142 phone=+1 (415) 555-2671 dob=1985-03-12",
      ).map((match: Found) => {
        return match.dataTypeId;
      }),
    ).toEqual(["email-address", "ip-address", "phone-number", "date-of-birth"]);
  });
});
