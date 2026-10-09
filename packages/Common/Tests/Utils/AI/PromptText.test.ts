import PromptText, {
  FittedText,
  formatCount,
  formatSize,
  MAX_DRAFT_PROMPT_FIELD_LENGTH,
  MAX_PROMPT_FIELD_LENGTH,
  MIN_ENCODED_RUN_LENGTH,
  PromptMessagesResult,
  PromptTextResult,
} from "../../../Utils/AI/PromptText";
import { getInlineImageTypeOfBase64 } from "../../../Utils/Markdown/InlineImageDataUri";
import { AIPromptOmissions } from "../../../Types/AI/AIChatTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * What a model is given of a record's text (issue #4587). A synthetic
 * monitor's screenshot reaches an incident's description as an image that
 * carries itself - hundreds of kilobytes of base64 - and an investigation
 * sent it, whole, with every call to the model. These pin that every
 * embedded file becomes a short note saying what it was, that a long field
 * is cut with a note saying how much is missing, and that text with neither
 * comes back exactly as it was.
 */

// Real 1x1 images, as Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_1X1: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const GIF: string = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const WEBP: string =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

// A screenshot of `kilobytes` KB: a JPEG's first bytes, then its "pixels".
function jpegScreenshot(kilobytes: number): string {
  const bytes: Buffer = Buffer.alloc(kilobytes * 1024);

  // Deterministic noise, so the base64 looks like a real photo's.
  let seed: number = 7;
  for (let index: number = 0; index < bytes.length; index++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[index] = seed & 0xff;
  }

  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;

  return bytes.toString("base64");
}

// `bytes` bytes of noise as base64: an encoded file that is not an image.
function noiseBase64(bytes: number): string {
  const buffer: Buffer = Buffer.alloc(bytes);
  let seed: number = 11;

  for (let index: number = 0; index < buffer.length; index++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buffer[index] = (seed >> 8) & 0xff;
  }

  // Not the first byte of any image the sniffer knows.
  buffer[0] = 0x01;

  return buffer.toString("base64");
}

function pngScreenshot(kilobytes: number): string {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(kilobytes * 1024 - 8, 0x5a),
  ]).toString("base64");
}

function omit(text: string): string {
  return PromptText.omitEmbeddedData(text).text;
}

function omissionsOf(text: string): AIPromptOmissions {
  return PromptText.omitEmbeddedData(text).omissions;
}

function noOmissionsBut(
  partial: Partial<AIPromptOmissions>,
): AIPromptOmissions {
  return { ...PromptText.noOmissions(), ...partial };
}

describe("PromptText.omitEmbeddedData - a screenshot in a description", () => {
  test("the template the docs give: the image is a note, the words stay", () => {
    const screenshot: string = jpegScreenshot(340);
    const description: string = [
      "Login check failed: Timeout 30000ms exceeded waiting for #login.",
      "",
      `![Login page](data:image/jpeg;base64,${screenshot})`,
      "",
      "Retried from 3 probes.",
    ].join("\n");

    expect(omit(description)).toBe(
      [
        "Login check failed: Timeout 30000ms exceeded waiting for #login.",
        "",
        "![Login page]([image omitted: JPEG, 340 KB])",
        "",
        "Retried from 3 probes.",
      ].join("\n"),
    );
    expect(omissionsOf(description)).toEqual(
      noOmissionsBut({ imageCount: 1, imageBytes: 340 * 1024 }),
    );
  });

  test("the issue's own template: an image with no alt text", () => {
    const screenshot: string = jpegScreenshot(256);

    expect(omit(`![](data:image/jpeg;base64,${screenshot})`)).toBe(
      "![]([image omitted: JPEG, 256 KB])",
    );
  });

  test.each([
    ["PNG", PNG],
    ["JPEG", JPEG_1X1],
    ["GIF", GIF],
    ["WebP", WEBP],
  ])("a %s is named by what it is", (name: string, base64: string) => {
    const bytes: number = Buffer.from(base64, "base64").length;

    expect(omit(`![x](data:image/png;base64,${base64})`)).toBe(
      `![x]([image omitted: ${name}, ${formatSize(bytes)}])`,
    );
  });

  test("an image is named by its bytes, not by what its URL claims", () => {
    // Templates write image/png for every screenshot; a script may take a JPEG.
    expect(omit(`data:image/png;base64,${JPEG_1X1}`)).toContain(
      "[image omitted: JPEG,",
    );
  });

  test("an image of a type no browser shows inline is still an image", () => {
    const svg: string = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ).toString("base64");

    expect(omit(`![logo](data:image/svg+xml;base64,${svg})`)).toBe(
      "![logo]([image omitted: image/svg+xml, 46 bytes])",
    );
    expect(omissionsOf(`data:image/svg+xml;base64,${svg}`)).toEqual(
      noOmissionsBut({ imageCount: 1, imageBytes: 46 }),
    );
  });

  test("HTML, CSS, JSON, autolinks and link definitions lose their data too", () => {
    const image: string = `data:image/png;base64,${PNG}`;
    const note: string = "[image omitted: PNG, 70 bytes]";

    expect(omit(`<img src="${image}" alt="Login">`)).toBe(
      `<img src="${note}" alt="Login">`,
    );
    expect(omit(`<img src='${image}'>`)).toBe(`<img src='${note}'>`);
    expect(omit(`background: url(${image}) no-repeat;`)).toBe(
      `background: url(${note}) no-repeat;`,
    );
    expect(omit(JSON.stringify({ screenshot: image }))).toBe(
      JSON.stringify({ screenshot: note }),
    );
    expect(omit(`<${image}>`)).toBe(`<${note}>`);
    expect(omit(`![Login][shot]\n\n[shot]: ${image}`)).toBe(
      `![Login][shot]\n\n[shot]: ${note}`,
    );
  });

  test("a data: URL in prose, in a code span and in a code block is left out too", () => {
    const image: string = `data:image/png;base64,${PNG}`;

    expect(omit(`See ${image} for the page.`)).toBe(
      "See [image omitted: PNG, 70 bytes] for the page.",
    );
    expect(omit(`\`${image}\``)).toBe("`[image omitted: PNG, 70 bytes]`");
    expect(omit(`\`\`\`\n${image}\n\`\`\``)).toBe(
      "```\n[image omitted: PNG, 70 bytes]\n```",
    );
  });

  test("any case, parameters, padding and back-to-back images", () => {
    expect(omit(`DATA:IMAGE/PNG;BASE64,${PNG}`)).toBe(
      "[image omitted: PNG, 70 bytes]",
    );
    expect(omit(`data:image/png;name=shot.png;base64,${PNG}`)).toBe(
      "[image omitted: PNG, 70 bytes]",
    );
    expect(omit(`data:image/png;base64,${PNG}data:image/gif;base64,${GIF}`)).toBe(
      "[image omitted: PNG, 70 bytes][image omitted: GIF, 42 bytes]",
    );
    // The padding goes with the data, nothing after it does.
    expect(omit(`data:image/png;base64,${PNG}==tail`)).toBe(
      "[image omitted: PNG, 70 bytes]==tail",
    );
  });

  test("any other file is a file, named by its media type", () => {
    const pdf: string = Buffer.from("%PDF-1.4 hello").toString("base64");

    expect(omit(`[report](data:application/pdf;base64,${pdf})`)).toBe(
      "[report]([file omitted: application/pdf, 14 bytes])",
    );
    expect(omit(`data:;base64,${pdf}`)).toBe("[file omitted: 14 bytes]");
    expect(omissionsOf(`data:application/pdf;base64,${pdf}`)).toEqual(
      noOmissionsBut({ encodedDataCount: 1, encodedDataBytes: 14 }),
    );
  });

  test("a media type too long or too odd to name is left unnamed", () => {
    const type: string = `application/${"x".repeat(80)}`;

    expect(omit(`data:${type};base64,${PNG}`)).toBe(
      "[image omitted: PNG, 70 bytes]",
    );
    expect(omit(`data:${type};base64,QUJD`)).toBe("[file omitted: 3 bytes]");
  });

  test("several images are counted together", () => {
    const text: string = [
      `![one](data:image/png;base64,${pngScreenshot(10)})`,
      `![two](data:image/jpeg;base64,${jpegScreenshot(20)})`,
      `[log](data:text/plain;base64,${Buffer.from("hello").toString("base64")})`,
    ].join("\n");

    expect(omissionsOf(text)).toEqual(
      noOmissionsBut({
        imageCount: 2,
        imageBytes: 30 * 1024,
        encodedDataCount: 1,
        encodedDataBytes: 5,
      }),
    );
  });
});

describe("PromptText.omitEmbeddedData - what stays", () => {
  test.each([
    ["a data: URL that is text", "data:,Hello%2C%20World"],
    ["a text data: URL", "data:text/plain,hello world"],
    ["an SVG written out", "data:image/svg+xml;utf8,<svg xmlns='x'></svg>"],
    [
      "a template before it is rendered",
      "![x](data:image/png;base64,{{syntheticResponses.0.screenshots.login}})",
    ],
    ["a colon after the word data", "metadata: 5 rows; data: none"],
    ["base64 that is not after a comma", "data:image/png;base64 iVBORw0KGgo"],
    ["a media type over 256 characters", `data:${"a".repeat(300)};base64,QUJD`],
  ])("%s", (_label: string, text: string) => {
    const result: PromptTextResult = PromptText.omitEmbeddedData(text);

    expect(result.text).toBe(text);
    expect(result.omissions).toEqual(PromptText.noOmissions());
  });

  test("text without embedded data comes back as the very same string", () => {
    const texts: Array<string> = [
      "",
      "Database connection pool exhausted on db-1 (max 100).",
      "# Heading\n\n- a list\n- **bold** and `code`\n\n| a | b |\n|---|---|",
      '{"error":"timeout","host":"10.0.0.1","took_ms":30001}',
      "Ünïcödé, 日本語, emoji 🚨🔥, RTL שלום",
      `A sha256: ${"ab".repeat(32)}, a JWT: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig`,
      `An SSH key: ssh-rsa ${"A".repeat(700)} user@host`,
      "A".repeat(MIN_ENCODED_RUN_LENGTH - 1),
      "line one\r\nline two\ttabbed",
    ];

    for (const text of texts) {
      const result: PromptTextResult = PromptText.omitEmbeddedData(text);

      expect(result.text).toBe(text);
      expect(result.omissions).toEqual(PromptText.noOmissions());
    }
  });

  test("random text of every printable shape comes back unchanged", () => {
    // Words, punctuation and short base64-looking tokens, but no data: URL.
    const alphabet: string =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/= .,;:!?()[]{}<>\"'`#*_-\n\t|~@$%^&";
    let seed: number = 42;

    for (let sample: number = 0; sample < 200; sample++) {
      let text: string = "";
      const length: number = 1 + (sample * 37) % 3000;

      for (let index: number = 0; index < length; index++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        text += alphabet[seed % alphabet.length];
      }

      // A run of 1,024 base64 characters in a row is all but impossible here.
      expect(PromptText.omitEmbeddedData(text).text).toBe(text);
    }
  });

  test("base64url is not base64: a run with - and _ in it stays", () => {
    const text: string = `${"ab-_".repeat(400)}`;

    expect(omit(text)).toBe(text);
  });
});

describe("PromptText.omitEmbeddedData - base64 with no data: URL around it", () => {
  test("a screenshot placed without its prefix is an image", () => {
    const screenshot: string = pngScreenshot(225);

    expect(omit(`Screenshot: ${screenshot}\nEnd.`)).toBe(
      "Screenshot: [image omitted: PNG, 225 KB]\nEnd.",
    );
    expect(omissionsOf(screenshot)).toEqual(
      noOmissionsBut({ imageCount: 1, imageBytes: 225 * 1024 }),
    );
  });

  test("a long run that is not an image is encoded data, sized as text", () => {
    const blob: string = noiseBase64(3000);

    expect(omit(`{"payload":"${blob}"}`)).toBe(
      `{"payload":"[encoded data omitted: 4 KB]"}`,
    );
    expect(omissionsOf(blob)).toEqual(
      noOmissionsBut({ encodedDataCount: 1, encodedDataBytes: blob.length }),
    );
  });

  test.each([
    ["one letter repeated", "x".repeat(8000)],
    ["a DNA sequence", "ACGTTGCA".repeat(500)],
    ["a hex dump", "0123456789abcdef".repeat(256)],
    ["upper-case words run together", "CHECKOUTFAILED".repeat(200)],
    ["digits", "0123456789".repeat(300)],
  ])("%s is text, however long", (_label: string, text: string) => {
    // Base64 of a file holds upper- and lower-case letters and digits.
    expect(omit(`(${text})`)).toBe(`(${text})`);
  });

  test(`the run must be ${MIN_ENCODED_RUN_LENGTH} characters long`, () => {
    const blob: string = noiseBase64(3000);
    const short: string = blob.slice(0, MIN_ENCODED_RUN_LENGTH - 1);
    const long: string = blob.slice(0, MIN_ENCODED_RUN_LENGTH);

    expect(omit(`x ${short} y`)).toBe(`x ${short} y`);
    expect(omit(`x ${long} y`)).toBe("x [encoded data omitted: 1 KB] y");
  });

  test("its padding goes with it", () => {
    // 1,000 bytes: 1,336 characters, the last two of them padding.
    const run: string = noiseBase64(1000);

    expect(run.endsWith("==")).toBe(true);
    expect(omit(`(${run})`)).toBe("([encoded data omitted: 1 KB])");
  });

  test("text that runs into a data: URL keeps its words", () => {
    expect(omit(`xdata:image/png;base64,${PNG}`)).toBe(
      "x[image omitted: PNG, 70 bytes]",
    );
  });
});

describe("PromptText.fitToLength", () => {
  test("a text that fits comes back as it is", () => {
    const text: string = "a".repeat(100);

    expect(PromptText.fitToLength(text, 100)).toEqual({
      text: text,
      omittedCharacters: 0,
    });
  });

  test("a longer text ends at a word, with how much is missing", () => {
    const text: string = `${"word ".repeat(30)}${"z".repeat(100)}`;
    const fitted: FittedText = PromptText.fitToLength(text, 52);

    expect(fitted.text).toBe(
      `${"word ".repeat(10).trimEnd()}… [${formatCount(text.length - 49)} more characters omitted]`,
    );
    expect(fitted.omittedCharacters).toBe(text.length - 49);
  });

  test("with no word end close by, it cuts where it must", () => {
    const text: string = "x".repeat(500);
    const fitted: FittedText = PromptText.fitToLength(text, 200);

    expect(fitted.text).toBe(`${"x".repeat(200)}… [300 more characters omitted]`);
  });

  test("it never keeps half of a character", () => {
    const text: string = `${"a".repeat(9)}🚨${"b".repeat(100)}`;
    const fitted: FittedText = PromptText.fitToLength(text, 10);

    expect(fitted.text.startsWith(`${"a".repeat(9)}…`)).toBe(true);
    expect(fitted.text).not.toContain("\ud83d");
  });

  test("it never keeps half of a note it wrote", () => {
    const text: string = `${"a".repeat(80)}[image omitted: PNG, 340 KB]${"b".repeat(200)}`;
    const fitted: FittedText = PromptText.fitToLength(text, 90);

    expect(fitted.text).toBe(
      `${"a".repeat(80)}… [${formatCount(text.length - 80)} more characters omitted]`,
    );
  });

  test("a bracket that is not a note can be cut like any text", () => {
    const text: string = `${"a".repeat(80)}[see below${"b".repeat(200)}`;

    // Cut at the word end before "below", not before the bracket.
    expect(
      PromptText.fitToLength(text, 90).text.startsWith(
        `${"a".repeat(80)}[see… [`,
      ),
    ).toBe(true);
  });
});

describe("PromptText.field", () => {
  test("nothing is the empty string", () => {
    expect(PromptText.field(null)).toBe("");
    expect(PromptText.field(undefined)).toBe("");
    expect(PromptText.field("")).toBe("");
  });

  test("a short field comes back as it is", () => {
    expect(PromptText.field("Disk full on db-1")).toBe("Disk full on db-1");
  });

  test("the limit applies after the screenshot is left out", () => {
    // 3 MB of base64 and 200 characters of words: the words all fit.
    const words: string = "The checkout page returned 502 for 4 minutes. ".repeat(4);
    const description: string = `${words}\n\n![Checkout](data:image/png;base64,${pngScreenshot(2300)})`;

    expect(description.length).toBeGreaterThan(3_000_000);
    expect(PromptText.field(description)).toBe(
      `${words}\n\n![Checkout]([image omitted: PNG, 2.2 MB])`,
    );
  });

  test(`a field is held to ${MAX_PROMPT_FIELD_LENGTH} characters by default`, () => {
    const text: string = "log line\n".repeat(1000);
    const field: string = PromptText.field(text);

    expect(field.length).toBeLessThan(MAX_PROMPT_FIELD_LENGTH + 60);
    expect(field).toMatch(/… \[[\d,]+ more characters omitted\]$/);
  });

  test("a draft takes more of a field", () => {
    const text: string = "detail ".repeat(3000);

    expect(
      PromptText.field(text, { maxLength: MAX_DRAFT_PROMPT_FIELD_LENGTH })
        .length,
    ).toBeGreaterThan(MAX_DRAFT_PROMPT_FIELD_LENGTH - 64);
    expect(
      PromptText.field(text, { maxLength: MAX_DRAFT_PROMPT_FIELD_LENGTH }),
    ).toContain("more characters omitted]");
  });

  test("what was left out adds up across fields", () => {
    const omissions: AIPromptOmissions = PromptText.noOmissions();

    PromptText.field(`![a](data:image/png;base64,${PNG})`, { omissions });
    PromptText.field(`![b](data:image/gif;base64,${GIF})`, { omissions });
    // 5,000 characters: cut after the 800th "word ", at the 4,000th.
    PromptText.field("word ".repeat(1000), { omissions });
    PromptText.field("short", { omissions });

    expect(omissions).toEqual({
      imageCount: 2,
      imageBytes: 70 + 42,
      encodedDataCount: 0,
      encodedDataBytes: 0,
      shortenedTextCount: 1,
      omittedCharacterCount: 1001,
    });
  });

  test("a value that is not a string is read as text", () => {
    expect(PromptText.field(42 as unknown as string)).toBe("42");
  });
});

describe("PromptText.omitEmbeddedDataFromMessages", () => {
  interface Message {
    role: string;
    content: string;
    toolCallId?: string | undefined;
  }

  test("messages with nothing embedded are the very same array", () => {
    const messages: Array<Message> = [
      { role: "system", content: "You are an SRE." },
      { role: "user", content: "Why is checkout down?" },
    ];
    const result: PromptMessagesResult<Message> =
      PromptText.omitEmbeddedDataFromMessages(messages);

    expect(result.messages).toBe(messages);
    expect(result.omissions).toEqual(PromptText.noOmissions());
  });

  test("only the messages that held embedded data are copied", () => {
    const system: Message = { role: "system", content: "You are an SRE." };
    const tool: Message = {
      role: "tool",
      toolCallId: "call_1",
      content: `description=![x](data:image/png;base64,${PNG})`,
    };
    const messages: Array<Message> = [system, tool];
    const result: PromptMessagesResult<Message> =
      PromptText.omitEmbeddedDataFromMessages(messages);

    expect(result.messages).not.toBe(messages);
    expect(result.messages[0]).toBe(system);
    expect(result.messages[1]).toEqual({
      role: "tool",
      toolCallId: "call_1",
      content: "description=![x]([image omitted: PNG, 70 bytes])",
    });
    // The caller's own messages are untouched.
    expect(tool.content).toContain(PNG);
    expect(result.omissions).toEqual(
      noOmissionsBut({ imageCount: 1, imageBytes: 70 }),
    );
  });
});

describe("PromptText.describeOmissions", () => {
  test("nothing left out says nothing", () => {
    expect(PromptText.describeOmissions(PromptText.noOmissions())).toBeNull();
    expect(PromptText.describeOmissions(null)).toBeNull();
    expect(PromptText.hasOmissions(PromptText.noOmissions())).toBe(false);
  });

  test("says what was left out, in one line per kind", () => {
    expect(
      PromptText.describeOmissions(
        noOmissionsBut({ imageCount: 1, imageBytes: 340 * 1024 }),
      ),
    ).toBe("Left out 1 embedded image (340 KB): AI reads text, not images.");
    expect(
      PromptText.describeOmissions(
        noOmissionsBut({
          imageCount: 2,
          imageBytes: 2.5 * 1024 * 1024,
          encodedDataCount: 1,
          encodedDataBytes: 4096,
          shortenedTextCount: 3,
          omittedCharacterCount: 12345,
        }),
      ),
    ).toBe(
      "Left out 2 embedded images (2.5 MB): AI reads text, not images. Left out 4 KB of encoded data: AI reads text only. Shortened 3 long texts: 12,345 characters left out.",
    );
  });

  test("names no product, which an installation can rename", () => {
    const sentence: string | null = PromptText.describeOmissions(
      noOmissionsBut({
        imageCount: 1,
        imageBytes: 1,
        encodedDataCount: 1,
        encodedDataBytes: 1,
        shortenedTextCount: 1,
        omittedCharacterCount: 1,
      }),
    );

    expect(sentence).not.toMatch(/OneUptime/i);
  });
});

describe("formatSize and formatCount", () => {
  test.each([
    [0, "0 bytes"],
    [1, "1 byte"],
    [1023, "1,023 bytes"],
    [1024, "1 KB"],
    [340 * 1024, "340 KB"],
    [1024 * 1024, "1 MB"],
    [2.4 * 1024 * 1024, "2.4 MB"],
    [12 * 1024 * 1024, "12 MB"],
  ])("%d bytes is %s", (bytes: number, size: string) => {
    expect(formatSize(bytes)).toBe(size);
  });

  test("counts are written the same way on every server", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("getInlineImageTypeOfBase64", () => {
  test("reads the first bytes only", () => {
    expect(getInlineImageTypeOfBase64(PNG)?.mimeType).toBe("image/png");
    expect(getInlineImageTypeOfBase64(JPEG_1X1)?.mimeType).toBe("image/jpeg");
    expect(getInlineImageTypeOfBase64(GIF)?.mimeType).toBe("image/gif");
    expect(getInlineImageTypeOfBase64(WEBP)?.mimeType).toBe("image/webp");
    expect(getInlineImageTypeOfBase64("QUJDREVGR0hJSktMTU5PUA==")).toBeNull();
    expect(getInlineImageTypeOfBase64("not base64 at all!")).toBeNull();
    expect(getInlineImageTypeOfBase64("")).toBeNull();
  });
});

describe("PromptText on megabytes", () => {
  test("a 12 MB screenshot is left out in linear time", () => {
    const screenshot: string = pngScreenshot(12 * 1024);
    const description: string = `Before.\n![x](data:image/png;base64,${screenshot})\nAfter.`;
    const startedAt: number = Date.now();
    const result: PromptTextResult = PromptText.omitEmbeddedData(description);

    expect(result.text).toBe("Before.\n![x]([image omitted: PNG, 12 MB])\nAfter.");
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("16 MB of text with nothing embedded is read once and kept", () => {
    const text: string = "GET /api/checkout 502 upstream timed out\n".repeat(
      400_000,
    );
    const startedAt: number = Date.now();
    const result: PromptTextResult = PromptText.omitEmbeddedData(text);

    expect(result.text).toBe(text);
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(PromptText.field(text).length).toBeLessThan(
      MAX_PROMPT_FIELD_LENGTH + 60,
    );
  });

  test("a run of 16 MB of base64 with no prefix is one note", () => {
    const run: string = noiseBase64(12 * 1024 * 1024);

    expect(omit(run)).toBe("[encoded data omitted: 16 MB]");
  });
});
