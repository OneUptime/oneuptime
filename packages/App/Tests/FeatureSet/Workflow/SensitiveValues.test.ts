import { JSONObject } from "Common/Types/JSON";
import { WORKFLOW_LOG_REDACTED_VALUE } from "../../../FeatureSet/Workflow/Utils/SecretRedaction";
import SensitiveValues, {
  CarriedValue,
  MIN_CARRIED_PIECE_LENGTH,
  MIN_CARRIED_STRING_LENGTH,
  carryValue,
} from "../../../FeatureSet/Workflow/Utils/SensitiveValues";
import { describe, expect, test } from "@jest/globals";

/*
 * VALUES A STEP MARKED SENSITIVE STAY SENSITIVE FOR THE REST OF THE RUN
 * (#11476): what is carried of each, and how a later step's values are
 * written down. Through the runner, end to end: RunWorkflowLogValues.
 */

const BASE64: string = Buffer.from("a picture of the checkout page").toString(
  "base64",
);
const ADDRESS: string = `https://oneuptime.example.com/file/image/access-token/${"ab".repeat(32)}`;

// What Get Files From Markdown hands on: one picture.
const FILES: Array<JSONObject> = [
  {
    name: "screenshot.png",
    mimeType: "image/png",
    sizeInBytes: 30,
    base64: BASE64,
    contentId: "image-0123456789abcdef01234567",
    urls: [ADDRESS],
    fields: ["description"],
  },
];

const FIELDS: Array<{ id: string; isSensitive?: boolean }> = [
  { id: "files", isSensitive: true },
  { id: "count" },
  { id: "leftOut", isSensitive: false },
];

describe("carryValue: what is carried of a value", () => {
  test("the thresholds", () => {
    expect(MIN_CARRIED_STRING_LENGTH).toBe(8);
    expect(MIN_CARRIED_PIECE_LENGTH).toBe(32);
  });

  test("a list's JSON, compact and indented, and each text in it of 32 characters or more: the bytes and the address", () => {
    const carried: CarriedValue | null = carryValue(FILES);

    expect(BASE64.length).toBeGreaterThanOrEqual(MIN_CARRIED_PIECE_LENGTH);
    expect(carried).toEqual({
      json: JSON.stringify(FILES),
      // As a later step is handed it whole: the value, or a text setting's indented JSON.
      wholeForms: [JSON.stringify(FILES), JSON.stringify(FILES, null, 2)],
      texts: [
        JSON.stringify(FILES),
        JSON.stringify(FILES, null, 2),
        BASE64,
        ADDRESS,
      ],
    });
  });

  test("not its short texts: a file's name, its type, a field's name, a content id", () => {
    const texts: Array<string> = carryValue(FILES)!.texts;

    for (const short of [
      "screenshot.png",
      "image/png",
      "description",
      "image-0123456789abcdef01234567",
    ]) {
      expect(texts).not.toContain(short);
    }
  });

  test("a text of eight characters or more is carried as it is", () => {
    expect(carryValue("s3cr3t-token")).toEqual({
      json: JSON.stringify("s3cr3t-token"),
      wholeForms: ["s3cr3t-token"],
      texts: ["s3cr3t-token"],
    });
  });

  test("a shorter text, a number, a boolean or nothing is not carried: every log is full of them", () => {
    for (const value of ["short", "", 42, 0, true, false, null]) {
      expect([value, carryValue(value as never)]).toEqual([value, null]);
    }
  });

  test("a list or an object with no long text in it is not carried", () => {
    expect(carryValue([{ name: "a.png", mimeType: "image/png" }])).toBeNull();
    expect(carryValue([])).toBeNull();
    expect(carryValue({})).toBeNull();
  });

  test("an object's long texts at any depth", () => {
    expect(
      carryValue({ outer: { inner: [{ deep: BASE64 }] } })!.texts,
    ).toContain(BASE64);
  });

  test("each text once", () => {
    expect(
      carryValue([{ base64: BASE64 }, { base64: BASE64 }])!.texts.filter(
        (text: string): boolean => {
          return text === BASE64;
        },
      ),
    ).toHaveLength(1);
  });
});

describe("SensitiveValues.carry", () => {
  test("only the returned values the step's own metadata marks sensitive", () => {
    const values: SensitiveValues = new SensitiveValues();

    values.carry(
      {
        files: FILES,
        count: 1,
        leftOut: [{ name: "page.png", urls: [ADDRESS + "ff"] }],
      } as unknown as JSONObject,
      FIELDS,
    );

    expect(values.getTexts()).toEqual([
      JSON.stringify(FILES),
      JSON.stringify(FILES, null, 2),
      BASE64,
      ADDRESS,
    ]);
    expect(values.isCarried(FILES)).toBe(true);
  });

  test("nothing for a step with no sensitive value, no values, or no metadata", () => {
    const values: SensitiveValues = new SensitiveValues();

    values.carry({ count: 1 }, FIELDS);
    values.carry(null, FIELDS);
    values.carry({ files: FILES as never }, null);
    values.carry({ files: FILES as never }, [{ id: "files" }]);

    expect(values.isEmpty()).toBe(true);
    expect(values.getTexts()).toEqual([]);
  });

  test("a sensitive value the step did not return carries nothing", () => {
    const values: SensitiveValues = new SensitiveValues();

    values.carry({ count: 0 }, FIELDS);

    expect(values.isEmpty()).toBe(true);
  });

  test("the same value from two steps is carried once", () => {
    const values: SensitiveValues = new SensitiveValues();

    values.carry({ files: FILES as never }, FIELDS);
    values.carry({ files: FILES as never }, FIELDS);

    expect(values.getTexts()).toEqual([
      JSON.stringify(FILES),
      JSON.stringify(FILES, null, 2),
      BASE64,
      ADDRESS,
    ]);
  });

  test("values of several steps add up", () => {
    const values: SensitiveValues = new SensitiveValues();
    const other: string = Buffer.from("another picture entirely").toString(
      "base64",
    );

    values.carry({ files: FILES as never }, FIELDS);
    values.carry({ token: "a-very-secret-token" }, [
      { id: "token", isSensitive: true },
    ]);
    values.carry({ files: [{ base64: other.repeat(2) }] as never }, FIELDS);

    expect(values.getTexts()).toEqual(
      expect.arrayContaining([BASE64, "a-very-secret-token", other.repeat(2)]),
    );
  });
});

describe("SensitiveValues.redactCarriedValues: a later step's values as they are written down", () => {
  const carrying: () => SensitiveValues = (): SensitiveValues => {
    const values: SensitiveValues = new SensitiveValues();
    values.carry({ files: FILES as never }, FIELDS);
    return values;
  };

  test("a value that is a carried one, whole, is the marker", () => {
    expect(
      carrying().redactCarriedValues({
        attachments: FILES as never,
        subject: "Checkout is down",
      }),
    ).toEqual({
      attachments: WORKFLOW_LOG_REDACTED_VALUE,
      subject: "Checkout is down",
    });
  });

  test("the same value, rebuilt from its JSON, is the same value", () => {
    expect(
      carrying().redactCarriedValues({
        attachments: JSON.parse(JSON.stringify(FILES)),
      }),
    ).toEqual({ attachments: WORKFLOW_LOG_REDACTED_VALUE });
  });

  test("as the text a step is handed it in - its JSON, indented or not - it is the same value", () => {
    expect(
      carrying().redactCarriedValues({
        indented: JSON.stringify(FILES, null, 2),
        compact: JSON.stringify(FILES),
        other: JSON.stringify([{ name: "other.png" }], null, 2),
      }),
    ).toEqual({
      indented: WORKFLOW_LOG_REDACTED_VALUE,
      compact: WORKFLOW_LOG_REDACTED_VALUE,
      other: JSON.stringify([{ name: "other.png" }], null, 2),
    });
  });

  test("a carried text, handed on whole, is the marker; a different text is not", () => {
    const values: SensitiveValues = new SensitiveValues();
    values.carry({ token: "a-very-secret-token" }, [
      { id: "token", isSensitive: true },
    ]);

    expect(
      values.redactCarriedValues({
        header: "a-very-secret-token",
        other: "a-different-token",
        count: 3,
      }),
    ).toEqual({
      header: WORKFLOW_LOG_REDACTED_VALUE,
      other: "a-different-token",
      count: 3,
    });
  });

  test("a value that only holds a carried one is left for the text redaction", () => {
    const wrapped: JSONObject = { attachments: { files: FILES } as never };

    expect(carrying().redactCarriedValues(wrapped)).toEqual(wrapped);
  });

  test("a copy: the values a step runs with are never changed", () => {
    const given: JSONObject = { attachments: FILES as never };

    carrying().redactCarriedValues(given);

    expect(given["attachments"]).toBe(FILES);
  });

  test("with nothing carried, the values themselves", () => {
    const given: JSONObject = { attachments: FILES as never };

    expect(new SensitiveValues().redactCarriedValues(given)).toBe(given);
  });

  test("isCarried: nothing and unserialisable values are not carried", () => {
    const values: SensitiveValues = carrying();
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;

    expect(values.isCarried(undefined as never)).toBe(false);
    expect(values.isCarried(null)).toBe(false);
    expect(values.isCarried(loop as never)).toBe(false);
    expect(values.isCarried([])).toBe(false);
  });
});
