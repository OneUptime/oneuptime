import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";
import zlib from "zlib";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import {
  classifyContent,
  ContentClassification,
  ContentFormat,
} from "../../../../Server/Utils/DataSecurity/Content/ContentClassifier";
import {
  ContentScanOptions,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { FingerprintAccumulator } from "../../../../Server/Utils/DataSecurity/Fingerprint";
import { compileCustomDataType } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";
import { ScanDetector } from "../../../../Utils/DataSecurity/TextScanner";
import { buildDocx, buildPptx, buildXlsx, buildZip } from "./ZipFixture";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * ONE OBJECT, READ AS WHAT IT IS.
 *
 * Every format the classifier reads is read here the way a bucket holds
 * it: CSV and TSV with and without a header, JSON whole and cut short,
 * JSON lines, .env / .ini / .properties, YAML, XML, HTML, DOCX, XLSX and
 * PPTX built as the archives they are, key files, gzip by its magic
 * number. Each says where it found what (a field's path, or "" for free
 * text), how many records it read and how many held sensitive data. Binary
 * formats are not read, and say so; a zip bomb is refused; and a value of
 * megabytes on one line - in a process whose regular expressions are no
 * longer optimized - finishes quickly, whatever the format.
 *
 * No value here is anyone's: the card numbers are made to pass Luhn when
 * the test runs, and the addresses belong to made-up companies.
 */

function luhnComplete(prefix: string): string {
  for (let digit: number = 0; digit < 10; digit++) {
    const candidate: string = prefix + digit;
    let sum: number = 0;
    let double: boolean = false;

    for (let index: number = candidate.length - 1; index >= 0; index--) {
      let value: number = Number(candidate[index]);

      if (double) {
        value *= 2;

        if (value > 9) {
          value -= 9;
        }
      }

      sum += value;
      double = !double;
    }

    if (sum % 10 === 0) {
      return candidate;
    }
  }

  throw new Error("No check digit fits.");
}

interface Person {
  name: string;
  email: string;
  ssn: string;
  card: string;
}

const PEOPLE: Array<Person> = [];

for (let index: number = 0; index < 20; index++) {
  PEOPLE.push({
    name: `User ${index}`,
    email: `user${index}.smith@acme-corp.com`,
    ssn: `${536 + index}-${40 + index}-${4300 + index}`,
    card: luhnComplete(`45391488034364${index % 10}`),
  });
}

function options(
  overrides: Partial<ContentScanOptions> = {},
): ContentScanOptions {
  return {
    limits: {
      maxObjects: 100,
      maxBytesPerObject: 1024 * 1024,
      maxBytesTotal: 64 * 1024 * 1024,
      maxRowsPerTable: 1000,
      maxTables: 100,
      deadline: new Date(Date.now() + 60_000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-project-key",
    ...overrides,
  };
}

function classify(
  name: string,
  data: Buffer | string,
  extra: {
    options?: ContentScanOptions;
    fingerprints?: FingerprintAccumulator;
    isTruncated?: boolean;
  } = {},
): ContentClassification {
  return classifyContent({
    name,
    bytes: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"),
    options: extra.options || options(),
    fingerprints:
      extra.fingerprints || new FingerprintAccumulator("test-project-key"),
    isTruncated: extra.isTruncated,
  });
}

function locationOf(
  result: ContentClassification,
  location: string,
): LocationFindings | undefined {
  return result.locations.find((found: LocationFindings) => {
    return found.location === location;
  });
}

function finding(
  result: ContentClassification,
  location: string,
  dataTypeId: string,
): FieldClassification | undefined {
  return locationOf(result, location)?.classifications.find(
    (classification: FieldClassification) => {
      return classification.dataTypeId === dataTypeId;
    },
  );
}

function dataTypesAt(
  result: ContentClassification,
  location: string,
): Array<string> {
  return (locationOf(result, location)?.classifications || [])
    .map((classification: FieldClassification) => {
      return classification.dataTypeId;
    })
    .sort();
}

function csvOf(people: Array<Person>, delimiter: string = ","): string {
  return [
    ["name", "email", "ssn", "card", "password"].join(delimiter),
    ...people.map((person: Person, index: number) => {
      return [
        person.name,
        person.email,
        person.ssn,
        person.card,
        `pw${index}secret`,
      ].join(delimiter);
    }),
  ].join("\n");
}

describe("delimited text", () => {
  test("a CSV with a header row is classified by column", () => {
    const result: ContentClassification = classify(
      "exports/users.csv",
      csvOf(PEOPLE),
    );

    expect(result.format).toBe(ContentFormat.Csv);
    expect(result.recordCount).toBe(20);
    expect(result.recordsWithSensitive).toBe(20);
    expect(locationOf(result, "email")?.locationKind).toBe(
      DataStoreLocationKind.Field,
    );
    expect(finding(result, "email", "email-address")).toMatchObject({
      confidence: DataConfidence.High,
      matchCount: 20,
      valueCount: 20,
      matchRatio: 1,
    });
    expect(dataTypesAt(result, "ssn")).toEqual(["us-ssn"]);
    expect(dataTypesAt(result, "card")).toEqual(["credit-card-number"]);
    // Masked, never whole.
    expect(
      finding(result, "card", "credit-card-number")?.maskedSamples[0],
    ).toMatch(/^\*{4} \*{4} \*{4} [0-9]{4}$/);
    expect(result.plaintextPasswordFields).toEqual(["password"]);
  });

  test("a TSV reads the same, and a CSV without a header by column number", () => {
    const tsv: ContentClassification = classify(
      "exports/users.tsv",
      csvOf(PEOPLE, "\t"),
    );

    expect(tsv.format).toBe(ContentFormat.Tsv);
    expect(dataTypesAt(tsv, "email")).toEqual(["email-address"]);

    const headless: ContentClassification = classify(
      "exports/users.csv",
      csvOf(PEOPLE).split("\n").slice(1).join("\n"),
    );

    expect(headless.recordCount).toBe(20);
    expect(dataTypesAt(headless, "column2")).toEqual(["email-address"]);
    expect(dataTypesAt(headless, "column3")).toEqual(["us-ssn"]);
  });

  test("quoted cells keep their commas, quotes and line breaks", () => {
    const result: ContentClassification = classify(
      "exports/notes.csv",
      [
        "id,note,email",
        `1,"Moved, ""urgent""\nsee ticket",${PEOPLE[0]!.email}`,
        `2,"plain",${PEOPLE[1]!.email}`,
      ].join("\r\n"),
    );

    expect(result.recordCount).toBe(2);
    expect(finding(result, "email", "email-address")?.matchCount).toBe(2);
    expect(locationOf(result, "note")).toBeUndefined();
  });

  test("the last row of an object cut short is not read", () => {
    const text: string = csvOf(PEOPLE.slice(0, 3)) + "\nUser 9,user9.smi";
    const result: ContentClassification = classify("exports/users.csv", text, {
      isTruncated: true,
    });

    expect(result.recordCount).toBe(3);
    expect(finding(result, "email", "email-address")?.valueCount).toBe(3);
  });
});

describe("JSON", () => {
  test("an array of records is read by path", () => {
    const result: ContentClassification = classify(
      "data/users.json",
      JSON.stringify(
        PEOPLE.map((person: Person) => {
          return {
            name: person.name,
            contact: { email: person.email },
            ssn: person.ssn,
          };
        }),
      ),
    );

    expect(result.format).toBe(ContentFormat.Json);
    expect(result.recordCount).toBe(20);
    expect(dataTypesAt(result, "contact.email")).toEqual(["email-address"]);
    expect(dataTypesAt(result, "ssn")).toEqual(["us-ssn"]);
  });

  test("a document cut short is read as far as it goes", () => {
    const whole: string = JSON.stringify(
      {
        customers: PEOPLE.map((person: Person) => {
          return { name: person.name, email: person.email };
        }),
      },
      null,
      2,
    );
    const result: ContentClassification = classify(
      "data/customers.json",
      whole.slice(0, Math.floor(whole.length * 0.6)),
      { isTruncated: true },
    );

    expect(result.format).toBe(ContentFormat.Json);
    expect(result.recordCount).toBeGreaterThan(5);
    expect(
      finding(result, "customers[].email", "email-address")?.confidence,
    ).toBe(DataConfidence.High);
  });

  test("JSON lines are records, one a line", () => {
    const result: ContentClassification = classify(
      "data/events.ndjson",
      PEOPLE.map((person: Person) => {
        return JSON.stringify({ user: { email: person.email }, count: 1 });
      }).join("\n"),
    );

    expect(result.format).toBe(ContentFormat.JsonLines);
    expect(result.recordCount).toBe(20);
    expect(dataTypesAt(result, "user.email")).toEqual(["email-address"]);
  });

  test("a log line that only starts like JSON is read as the text it is", () => {
    const result: ContentClassification = classify(
      "logs/app",
      `[2026-10-27 10:00:00] INFO login ${PEOPLE[0]!.email}\n[2026-10-27 10:00:01] INFO ok\n`,
    );

    expect(result.format).toBe(ContentFormat.Text);
    expect(dataTypesAt(result, "")).toEqual(["email-address"]);
  });
});

describe("configuration files", () => {
  test(".env: keys are fields, and a password kept as it is is reported", () => {
    const result: ContentClassification = classify(
      "deploy/.env",
      [
        "# settings",
        "export DB_PASSWORD=hunter2secret",
        "DATABASE_URL=postgres://admin:S3cretPassw0rd@db.internal:5432/app",
        "API_URL=https://api.acme-corp.com # the public one",
      ].join("\n"),
    );

    expect(result.format).toBe(ContentFormat.KeyValue);
    expect(result.plaintextPasswordFields).toEqual(["DB_PASSWORD"]);
    expect(dataTypesAt(result, "DATABASE_URL")).toEqual(["password-in-url"]);
    expect(
      finding(result, "DATABASE_URL", "password-in-url")?.maskedSamples[0],
    ).not.toContain("S3cretPassw0rd");
  });

  test(".ini and .properties: sections and dotted keys make the path", () => {
    const ini: ContentClassification = classify(
      "config/app.ini",
      "[database]\nuser = app\npassword = Tr0ub4dor&3\n[mail]\nfrom = billing@acme-corp.com\n",
    );

    expect(ini.plaintextPasswordFields).toEqual(["database.password"]);
    expect(dataTypesAt(ini, "mail.from")).toEqual(["email-address"]);

    const properties: ContentClassification = classify(
      "config/application.properties",
      "spring.datasource.password=Tr0ub4dor&3\nsupport.email=help@acme-corp.com\n",
    );

    expect(properties.plaintextPasswordFields).toEqual([
      "spring.datasource.password",
    ]);
    expect(dataTypesAt(properties, "support.email")).toEqual(["email-address"]);
  });

  test("YAML: keys nest by indentation, lists fold into [], block text is one value", () => {
    const result: ContentClassification = classify(
      "deploy/values.yaml",
      [
        "database:",
        "  host: db.internal",
        "  password: hunter2secret",
        "users:",
        `  - ${PEOPLE[0]!.email}`,
        `  - ${PEOPLE[1]!.email}`,
        "servers:",
        "  - name: a",
        `    admin_email: ${PEOPLE[2]!.email}`,
        "notes: |",
        `  call ${PEOPLE[3]!.email}`,
        "  after five",
      ].join("\n"),
    );

    expect(result.format).toBe(ContentFormat.Yaml);
    expect(result.plaintextPasswordFields).toEqual(["database.password"]);
    expect(finding(result, "users[]", "email-address")?.matchCount).toBe(2);
    expect(dataTypesAt(result, "servers[].admin_email")).toEqual([
      "email-address",
    ]);
    expect(dataTypesAt(result, "notes")).toEqual(["email-address"]);
  });
});

describe("markup", () => {
  test("XML is read as its text and its attribute values", () => {
    const result: ContentClassification = classify(
      "feeds/users.xml",
      `<?xml version="1.0"?><users><user email="${PEOPLE[0]!.email}"><name>Alice</name></user><user><email>${PEOPLE[1]!.email}</email></user></users>`,
    );

    expect(result.format).toBe(ContentFormat.Xml);
    expect(locationOf(result, "")?.locationKind).toBe(
      DataStoreLocationKind.Text,
    );
    expect(finding(result, "", "email-address")?.matchCount).toBe(2);
  });

  test("HTML is read as its text, a script's text included, a style's not", () => {
    const result: ContentClassification = classify(
      "site/index.html",
      `<html><head><style>.contact { content: "${PEOPLE[5]!.email}"; }</style><script>var contact = "${PEOPLE[0]!.email}";</script></head><body><table><tr><td>${PEOPLE[1]!.email}</td><td>12</td></tr></table></body></html>`,
    );

    expect(result.format).toBe(ContentFormat.Html);
    expect(finding(result, "", "email-address")?.matchCount).toBe(2);
  });
});

describe("Office documents", () => {
  test("a DOCX is read as its paragraphs, its runs joined", () => {
    const card: string = PEOPLE[0]!.card;
    const result: ContentClassification = classify(
      "docs/letter.docx",
      buildDocx([
        "Dear customer,",
        `Your email ${PEOPLE[0]!.email} is on file.`,
        `Card ${card}`,
      ]),
    );

    expect(result.format).toBe(ContentFormat.Word);
    expect(result.recordCount).toBe(1);
    expect(result.recordsWithSensitive).toBe(1);
    expect(dataTypesAt(result, "")).toEqual([
      "credit-card-number",
      "email-address",
    ]);
  });

  test("an XLSX is read by sheet and column, its first row the names", () => {
    const result: ContentClassification = classify(
      "docs/people.xlsx",
      buildXlsx("Customers", [
        ["Name", "Email", "SSN", "Visits"],
        ...PEOPLE.slice(0, 10).map((person: Person, index: number) => {
          return [person.name, person.email, person.ssn, index];
        }),
      ]),
    );

    expect(result.format).toBe(ContentFormat.Excel);
    expect(result.recordCount).toBe(10);
    expect(dataTypesAt(result, "Customers.Email")).toEqual(["email-address"]);
    expect(dataTypesAt(result, "Customers.SSN")).toEqual(["us-ssn"]);
  });

  test("a PPTX is read as its slides", () => {
    const result: ContentClassification = classify(
      "docs/deck.pptx",
      buildPptx(["Q3 review", `Contact ${PEOPLE[0]!.email}`]),
    );

    expect(result.format).toBe(ContentFormat.PowerPoint);
    expect(dataTypesAt(result, "")).toEqual(["email-address"]);
  });

  test("a document named for another format is known by what it holds", () => {
    const result: ContentClassification = classify(
      "uploads/attachment.bin",
      buildDocx([`Reach me at ${PEOPLE[0]!.email}`]),
    );

    expect(result.format).toBe(ContentFormat.Word);
  });

  test("a zip bomb is refused, and says so", () => {
    const result: ContentClassification = classify(
      "docs/report.docx",
      buildZip([
        {
          name: "word/document.xml",
          data: Buffer.alloc(4 * 1024 * 1024, 0x41),
          declaredUncompressedSize: 512,
        },
      ]),
    );

    expect(result.locations).toEqual([]);
    expect(result.warnings[0]).toMatch(/^not scanned: refused as a zip bomb/);
  });

  test("a ZIP archive that is no document is not read", () => {
    const result: ContentClassification = classify(
      "backups/archive.zip",
      buildZip([{ name: "users.csv", data: csvOf(PEOPLE) }]),
    );

    expect(result.locations).toEqual([]);
    expect(result.warnings).toEqual([
      "not scanned: a ZIP archive is not supported yet",
    ]);
  });
});

describe("keys", () => {
  test("a PEM file's private key is found", () => {
    const block: string = [
      "-----BEGIN " + "PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7".repeat(3),
      "-----END " + "PRIVATE KEY-----",
    ].join("\n");
    const result: ContentClassification = classify("keys/server.pem", block);

    expect(result.format).toBe(ContentFormat.KeyFile);
    expect(dataTypesAt(result, "")).toEqual(["private-key"]);
    expect(finding(result, "", "private-key")?.maskedSamples[0]).toContain(
      "(hidden)",
    );
  });

  test("a PKCS #12 key store is reported by its name: its content is binary", () => {
    const result: ContentClassification = classify(
      "keys/store.p12",
      Buffer.from([0x30, 0x82, 0x0a, 0x00, 0x02, 0x01, 0x03, 0x30, 0x82, 0x09]),
    );

    expect(finding(result, "", "private-key")).toMatchObject({
      confidence: DataConfidence.Medium,
      foundByName: true,
    });
  });
});

describe("gzip", () => {
  test("is inflated first, known by its magic number with or without .gz", () => {
    const gzipped: Buffer = zlib.gzipSync(Buffer.from(csvOf(PEOPLE)));
    const named: ContentClassification = classify(
      "exports/users.csv.gz",
      gzipped,
    );

    expect(named.format).toBe(ContentFormat.Csv);
    expect(dataTypesAt(named, "email")).toEqual(["email-address"]);

    const unnamed: ContentClassification = classify(
      "exports/users-0001",
      gzipped,
    );

    expect(unnamed.format).toBe(ContentFormat.Text);
    expect(dataTypesAt(unnamed, "")).toContain("email-address");
  });

  test("the first bytes of a large gzip object give what they hold", () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 20_000; index++) {
      lines.push(
        `2026-10-27T10:00:00Z login user${index}.smith@acme-corp.com from 10.0.${index % 250}.7`,
      );
    }

    const gzipped: Buffer = zlib.gzipSync(Buffer.from(lines.join("\n")));
    const result: ContentClassification = classify(
      "logs/app.log.gz",
      gzipped.subarray(0, 16 * 1024),
      { isTruncated: true },
    );

    expect(result.recordCount).toBeGreaterThan(100);
    expect(dataTypesAt(result, "")).toContain("email-address");
  });
});

describe("binary content", () => {
  test.each([
    [
      "img/logo.png",
      "PNG image",
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0],
    ],
    ["img/photo.jpg", "JPEG image", [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]],
    [
      "warehouse/part-0001.parquet",
      "Parquet",
      [0x50, 0x41, 0x52, 0x31, 0x15, 0x04],
    ],
    ["warehouse/part-0001.avro", "Avro", [0x4f, 0x62, 0x6a, 0x01, 0x04, 0x14]],
    [
      "docs/scan.pdf",
      "PDF",
      [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3],
    ],
    ["data/blob.bin", "binary content", [0x41, 0x42, 0x00, 0x43]],
  ])(
    "%s is not read: %s",
    (name: string, format: string, bytes: Array<number>) => {
      const result: ContentClassification = classify(name, Buffer.from(bytes));

      expect(result.locations).toEqual([]);
      expect(result.recordCount).toBe(0);
      expect(result.warnings).toEqual([
        `not scanned: ${format} is not supported yet`,
      ]);
    },
  );

  test("a CSV whose first cell spells a magic number is still text", () => {
    const result: ContentClassification = classify(
      "data/orc.csv",
      `ORC,email\nalpha,${PEOPLE[0]!.email}\nbeta,${PEOPLE[1]!.email}\n`,
    );

    expect(result.format).toBe(ContentFormat.Csv);
    expect(dataTypesAt(result, "email")).toEqual(["email-address"]);
  });

  test("UTF-16 with its byte order mark is decoded, not refused", () => {
    const text: string = `name,email\nAlice,${PEOPLE[0]!.email}\nBob,${PEOPLE[1]!.email}\n`;
    const result: ContentClassification = classify(
      "exports/excel-export.csv",
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
    );

    expect(dataTypesAt(result, "email")).toEqual(["email-address"]);
  });
});

describe("free text", () => {
  test("a log's lines are its records; each finding keeps the confidence it earned", () => {
    const result: ContentClassification = classify(
      "logs/app.log",
      [
        `[2026-10-27 10:00:00] INFO login ${PEOPLE[0]!.email}`,
        "[2026-10-27 10:00:01] INFO ok",
        `[2026-10-27 10:00:02] WARN card ${PEOPLE[0]!.card} declined`,
        "",
      ].join("\n"),
    );

    expect(result.format).toBe(ContentFormat.Text);
    expect(result.recordCount).toBe(3);
    expect(result.recordsWithSensitive).toBe(2);
    expect(finding(result, "", "email-address")).toMatchObject({
      confidence: DataConfidence.High,
      isFreeText: true,
      valueCount: 3,
      valuesWithMatch: 1,
    });
    expect(dataTypesAt(result, "")).toEqual([
      "credit-card-number",
      "email-address",
    ]);
  });

  test("an empty object holds nothing", () => {
    expect(classify("logs/empty.log", "").format).toBe(ContentFormat.Empty);
    expect(classify("logs/blank.log", "\n\n  \n").locations).toEqual([]);
  });
});

describe("what the project says", () => {
  test("its own data types are found, by pattern and by field name", () => {
    const detector: ScanDetector | null = compileCustomDataType({
      dataTypeId: "custom:employee-id",
      pattern: "EMP-[0-9]{6}",
      keywords: ["employee"],
      nameHints: ["employee id"],
    });
    const scanOptions: ContentScanOptions = options({
      customDetectors: [detector!],
      extraHints: [
        { dataTypeId: "custom:employee-id", hints: ["employee id"] },
      ],
    });
    const csv: ContentClassification = classify(
      "hr/staff.csv",
      "employee_id,email\nEMP-123456,a.b@acme-corp.com\nEMP-654321,c.d@acme-corp.com\n",
      { options: scanOptions },
    );

    expect(dataTypesAt(csv, "employee_id")).toEqual(["custom:employee-id"]);
    expect(dataTypesAt(csv, "email")).toEqual(["email-address"]);

    const text: ContentClassification = classify(
      "hr/notes.txt",
      "Badge for employee EMP-246810 was reissued.",
      { options: scanOptions },
    );

    expect(dataTypesAt(text, "")).toEqual(["custom:employee-id"]);
  });

  test("a data type turned off is not looked for, and an allowed value is no finding", () => {
    const disabled: ContentClassification = classify(
      "exports/users.csv",
      csvOf(PEOPLE),
      { options: options({ disabledDataTypeIds: new Set(["email-address"]) }) },
    );

    expect(locationOf(disabled, "email")).toBeUndefined();

    const allowed: ContentClassification = classify(
      "logs/support.log",
      `mail from support@acme-corp.com\nmail from ${PEOPLE[0]!.email}\n`,
      {
        options: options({ allowedValues: new Set(["support@acme-corp.com"]) }),
      },
    );

    expect(finding(allowed, "", "email-address")?.matchCount).toBe(1);
  });
});

describe("fingerprints", () => {
  test("every High value found feeds the scan's fingerprints", () => {
    const fingerprints: FingerprintAccumulator = new FingerprintAccumulator(
      "test-project-key",
    );

    classify("exports/users.csv", csvOf(PEOPLE), { fingerprints });
    classify("logs/app.log", `login ${PEOPLE[0]!.email}\n`, { fingerprints });

    const sketches: Record<
      string,
      Array<number>
    > = fingerprints.getFingerprints();

    expect(Object.keys(sketches)).toEqual(
      expect.arrayContaining(["email-address", "us-ssn", "credit-card-number"]),
    );
    expect(sketches["email-address"]).toHaveLength(128);
  });
});

describe("megabytes on one line", () => {
  test.each([
    ["logs/huge.log", "text"],
    ["exports/huge.csv", "csv"],
    ["data/huge.json", "json"],
    ["feeds/huge.xml", "xml"],
    ["deploy/huge.yaml", "yaml"],
    ["deploy/huge.env", "env"],
  ])(
    "%s of 5 MB on one line finishes quickly",
    (name: string, shape: string) => {
      const email: string = PEOPLE[0]!.email;
      const blob: string = "QUJD".repeat((5 * 1024 * 1024) / 4);
      const texts: Record<string, string> = {
        text: `login ${email} ${blob}`,
        csv: `${email},${blob}`,
        json: `{"email":"${email}","blob":"${blob}"}`,
        xml: `<a email="${email}">${blob}</a>`,
        yaml: `email: ${email}\nblob: ${blob}`,
        env: `EMAIL=${email}\nBLOB=${blob}`,
      };
      // Each attempt classifies afresh: classify() makes new options each time.
      const timed: FastestRun<ContentClassification> = fastestRun({
        run: (): ContentClassification => {
          return classify(name, texts[shape]!);
        },
        limitInMs: 15_000,
      });

      expect(timed.inMs).toBeLessThan(15_000);
      expect(JSON.stringify(timed.result.locations)).toContain("email-address");
    },
  );
});

/*
 * The same, in a node process whose regular expressions are no longer
 * optimized - the state a long-running server reaches, where a quantifier
 * over megabytes runs V8 out of stack (AGENTS.md, "Megabyte-long values").
 * esbuild bundles the classifier in that process, as the screenshot email
 * test does.
 */
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

describe("megabytes on one line, where V8 compiles regular expressions unoptimized", () => {
  test("every format is read without running out of stack", () => {
    const output: string = childProcess.execFileSync(
      process.execPath,
      [
        "--no-regexp-optimization",
        "-e",
        String.raw`
          const esbuild = require("esbuild");
          const path = require("path");
          const built = esbuild.buildSync({
            stdin: {
              contents: [
                'export { classifyContent } from "./Server/Utils/DataSecurity/Content/ContentClassifier";',
                'export { FingerprintAccumulator } from "./Server/Utils/DataSecurity/Fingerprint";',
              ].join("\n"),
              resolveDir: process.cwd(),
              loader: "ts",
              sourcefile: "content-classifier.ts",
            },
            bundle: true,
            platform: "node",
            format: "cjs",
            packages: "external",
            tsconfig: path.join(process.cwd(), "tsconfig.json"),
            write: false,
            logLevel: "silent",
          });
          const bundle = { exports: {} };
          new Function("module", "exports", "require", built.outputFiles[0].text)(
            bundle,
            bundle.exports,
            require,
          );
          const { classifyContent, FingerprintAccumulator } = bundle.exports;
          const blob = "QUJD".repeat(1024 * 1024);
          const email = "user0.smith@acme-corp.com";
          const inputs = [
            ["logs/huge.log", "login " + email + " " + blob],
            ["exports/huge.csv", email + "," + blob],
            ["data/huge.json", '{"email":"' + email + '","blob":"' + blob + '"}'],
            ["feeds/huge.xml", '<a email="' + email + '">' + blob + "</a>"],
            ["deploy/huge.yaml", "email: " + email + "\nblob: " + blob],
            ["deploy/huge.env", "EMAIL=" + email + "\nBLOB=" + blob],
            ["site/huge.html", "<p>" + email + "</p><p>" + "<b>".repeat(500000) + "</p>"],
          ];
          const report = inputs.map(([name, text]) => {
            try {
              const result = classifyContent({
                name,
                bytes: Buffer.from(text),
                options: {
                  limits: { maxObjects: 1, maxBytesPerObject: 1, maxBytesTotal: 1, maxRowsPerTable: 1, maxTables: 1, deadline: new Date(Date.now() + 60000) },
                  customDetectors: [],
                  extraHints: [],
                  disabledDataTypeIds: new Set(),
                  allowedValues: new Set(),
                  exclusions: [],
                  fingerprintKey: "k",
                },
                fingerprints: new FingerprintAccumulator("k"),
              });
              return { name, ok: true, found: JSON.stringify(result.locations).includes("email-address") };
            } catch (error) {
              return { name, ok: false, error: String((error && error.message) || error).split("\n")[0] };
            }
          });
          process.stdout.write(JSON.stringify(report));
          process.exit(0);
        `,
      ],
      {
        cwd: COMMON_ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 240_000,
      },
    );

    const report: Array<{
      name: string;
      ok: boolean;
      found?: boolean;
      error?: string;
    }> = JSON.parse(output);

    expect(report).toHaveLength(7);

    for (const entry of report) {
      expect(entry).toEqual({ name: entry.name, ok: true, found: true });
    }
  }, 300_000);
});
