import { describe, expect, test } from "@jest/globals";
import yaml from "js-yaml";
import {
  isPlainYamlString,
  printYaml,
  printYamlDocuments,
  quoteYamlString,
  toYamlTrailingComment,
  Yaml,
  YamlNode,
} from "../../../Utils/DeveloperDocs/Yaml";

/*
 * The YAML writer behind the Developer > Crossplane pages. What matters most
 * is that the API server reads back exactly the value that was written: a
 * manifest that takes a record over is applied to it, and a value read back
 * as something else - "on" as a boolean, a description without its last
 * line break - is a change the provider would make to the real record.
 * kubectl reads YAML 1.1, so YAML 1.1's booleans are quoted too, though
 * js-yaml (YAML 1.2) would read them as strings anyway.
 */

// What a parser reads from one written value.
function roundTrip(value: string): unknown {
  return (
    yaml.load(
      printYaml(Yaml.map([Yaml.entry("value", Yaml.string(value))])),
    ) as {
      value: unknown;
    }
  ).value;
}

const AWKWARD_STRINGS: Array<string> = [
  "",
  " ",
  "plain text",
  "Checkout API",
  "*/5 * * * *",
  "#16a34a",
  "False",
  "True",
  "yes",
  "No",
  "on",
  "OFF",
  "y",
  "N",
  "null",
  "~",
  "123",
  "0x1F",
  "1e3",
  "-1",
  ".inf",
  "2026-11-19",
  "12:30:45",
  "key: value",
  "a #hash",
  "ends with colon:",
  "- dash",
  "? question",
  "@at",
  "`tick",
  "&anchor",
  "!tag",
  "|pipe",
  ">fold",
  "%percent",
  "{{monitorSecrets.api_token}}",
  "[flow]",
  "'single'",
  '"double"',
  " leading space",
  "trailing space ",
  "tab\there",
  "line\nbreak",
  "three\nshort\nlines",
  "three\nshort\nlines\n",
  "three\nshort\nlines\n\n",
  "one\n\nblank in the middle\nand more",
  " starts\nwith\na space",
  "trailing \nspace\non a line",
  "carriage\r\nreturn\r\nlines",
  "control \u0001 character",
  "line \u2028 separator",
  "byte order \uFEFF mark",
  "next line \u0085 mark",
  "Überwachung ✓ 監視 مراقبة",
  "https://example.com/health?check=1&full=true",
  "/api/status",
  "back\\slash",
  "C:\\path\\to",
  "emoji 🚀 rocket",
  "<incident severity id>",
  "6b1d0e2a-1234-4b2c-9d8e-0123456789ab",
  "12345678-1234-1234-1234-123456789012",
];

describe("strings read back as they were written", () => {
  test.each(
    AWKWARD_STRINGS.map((value: string): [string] => {
      return [value];
    }),
  )("%j", (value: string) => {
    expect(roundTrip(value)).toBe(value);
  });

  test("in a list, as a key's value and as a key", () => {
    for (const value of AWKWARD_STRINGS.filter((text: string): boolean => {
      return text.length > 0;
    })) {
      const written: string = printYaml(
        Yaml.map([
          Yaml.entry("list", Yaml.list([Yaml.string(value)])),
          Yaml.entry("map", Yaml.map([Yaml.entry(value, Yaml.string(value))])),
        ]),
      );

      expect(yaml.load(written)).toEqual({
        list: [value],
        map: { [value]: value },
      });
    }
  });
});

describe("plain strings", () => {
  test("are written as they are when nothing could read them otherwise", () => {
    for (const value of [
      "Checkout API",
      "Website",
      "https://example.com",
      "/api/status",
      "crossplane.io/external-name",
      "Is Online",
      "Überwachung",
      "_underscore",
      // A record's ID, though it may start with a digit.
      "6b1d0e2a-1234-4b2c-9d8e-0123456789ab",
      "12345678-1234-1234-1234-123456789012",
    ]) {
      expect({ value, plain: isPlainYamlString(value) }).toEqual({
        value,
        plain: true,
      });
    }
  });

  test("never a word YAML 1.1 or 1.2 reads as a boolean or a null", () => {
    for (const value of [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "n",
      "N",
      "no",
      "NO",
      "true",
      "True",
      "false",
      "FALSE",
      "on",
      "On",
      "off",
      "Off",
      "null",
      "Null",
      "NULL",
      "~",
    ]) {
      expect({ value, plain: isPlainYamlString(value) }).toEqual({
        value,
        plain: false,
      });
    }

    // kubectl's reading of "on" was a boolean: it stays a string.
    expect(printYaml(Yaml.map([Yaml.entry("value", Yaml.string("on"))]))).toBe(
      'value: "on"\n',
    );
  });

  test("never a number, a date or a time", () => {
    for (const value of [
      "1",
      "1.5",
      "-1",
      "+1",
      "0x1F",
      "0o7",
      "1e3",
      "2026-11-19",
      "12:30",
    ]) {
      expect({ value, plain: isPlainYamlString(value) }).toEqual({
        value,
        plain: false,
      });
    }
  });

  test("never one that starts a comment, a mapping, an anchor or a flow collection", () => {
    for (const value of [
      "#ff0000",
      "a: b",
      "a #b",
      "end:",
      "*/5 * * * *",
      "&a",
      "!a",
      "{{x}}",
      "[a]",
      "- a",
      "? a",
      "'a'",
      '"a"',
      "|a",
      ">a",
      "%a",
      "@a",
      "`a",
    ]) {
      expect({ value, plain: isPlainYamlString(value) }).toEqual({
        value,
        plain: false,
      });
    }
  });
});

describe("quoted strings", () => {
  test("escape quotes, backslashes and whitespace characters as JSON does", () => {
    expect(quoteYamlString('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteYamlString("C:\\path")).toBe('"C:\\\\path"');
    expect(quoteYamlString("a\nb\rc\td")).toBe('"a\\nb\\rc\\td"');
  });

  test("escape what YAML would read as a line break or drop", () => {
    expect(quoteYamlString("a\u2028b")).toBe('"a\\u2028b"');
    expect(quoteYamlString("a\u0085b")).toBe('"a\\u0085b"');
    expect(quoteYamlString("a\uFEFFb")).toBe('"a\\uFEFFb"');
    expect(quoteYamlString("a\u0001b")).toBe('"a\\u0001b"');
  });

  test("keep unicode text as it is", () => {
    expect(quoteYamlString("Überwachung ✓ 監視")).toBe('"Überwachung ✓ 監視"');
  });
});

describe("multi-line strings", () => {
  test("are a literal block from three lines on, with the line breaks they end in", () => {
    expect(
      printYaml(Yaml.map([Yaml.entry("code", Yaml.string("one\ntwo\nthree"))])),
    ).toBe("code: |-\n  one\n  two\n  three\n");
    expect(
      printYaml(
        Yaml.map([Yaml.entry("code", Yaml.string("one\ntwo\nthree\n"))]),
      ),
    ).toBe("code: |\n  one\n  two\n  three\n");
    // More than one line break at the end stays quoted, so no copy drops it.
    expect(
      printYaml(
        Yaml.map([
          Yaml.entry("code", Yaml.string("one\ntwo\nthree\n\n")),
          Yaml.entry("next", Yaml.string("value")),
        ]),
      ),
    ).toBe('code: "one\\ntwo\\nthree\\n\\n"\nnext: value\n');
  });

  test("stay quoted below three lines", () => {
    expect(
      printYaml(Yaml.map([Yaml.entry("text", Yaml.string("one\ntwo"))])),
    ).toBe('text: "one\\ntwo"\n');
  });

  test("stay quoted when a block would not read back the same", () => {
    for (const value of [
      " leading\nspace\nhere",
      "trailing \nspace\nhere",
      "only\n   \nspaces",
      "carriage\r\nreturn\r\nhere",
      "a\ttab\nin\nhere",
    ]) {
      const written: string = printYaml(
        Yaml.map([Yaml.entry("text", Yaml.string(value))]),
      );

      expect({ value, block: written.startsWith("text: |") }).toEqual({
        value,
        block: false,
      });
      expect((yaml.load(written) as { text: string }).text).toBe(value);
    }
  });

  test("keep their indentation inside a list of maps", () => {
    const value: string = "line one\n  indented\nline three\n";
    const written: string = printYaml(
      Yaml.map([
        Yaml.entry(
          "steps",
          Yaml.list([Yaml.map([Yaml.entry("customCode", Yaml.string(value))])]),
        ),
      ]),
    );

    expect(written).toBe(
      "steps:\n  - customCode: |\n      line one\n        indented\n      line three\n",
    );
    expect(yaml.load(written)).toEqual({ steps: [{ customCode: value }] });
  });
});

describe("layout", () => {
  test("indents two spaces a level, a list's items under their key", () => {
    const written: string = printYaml(
      Yaml.map([
        Yaml.entry(
          "apiVersion",
          Yaml.string("crossplane.oneuptime.com/v1alpha1"),
        ),
        Yaml.entry(
          "spec",
          Yaml.map([
            Yaml.entry(
              "forProvider",
              Yaml.map([
                Yaml.entry("name", Yaml.string("Checkout API")),
                Yaml.entry(
                  "labels",
                  Yaml.list([Yaml.string("a"), Yaml.string("b")]),
                ),
                Yaml.entry("count", Yaml.number(3)),
                Yaml.entry("isEnabled", Yaml.bool(true)),
                Yaml.entry("nothing", Yaml.null()),
              ]),
            ),
          ]),
        ),
      ]),
    );

    expect(written).toBe(
      [
        "apiVersion: crossplane.oneuptime.com/v1alpha1",
        "spec:",
        "  forProvider:",
        "    name: Checkout API",
        "    labels:",
        "      - a",
        "      - b",
        "    count: 3",
        "    isEnabled: true",
        "    nothing: null",
        "",
      ].join("\n"),
    );
  });

  test("starts a list's map on the dash's line", () => {
    const written: string = printYaml(
      Yaml.map([
        Yaml.entry(
          "monitorSteps",
          Yaml.list([
            Yaml.map([
              Yaml.entry(
                "monitorDestination",
                Yaml.string("https://example.com"),
              ),
              Yaml.entry(
                "criteria",
                Yaml.list([
                  Yaml.map([
                    Yaml.entry("name", Yaml.string("Online")),
                    Yaml.entry("filterType", Yaml.string("True")),
                  ]),
                ]),
              ),
            ]),
          ]),
        ),
      ]),
    );

    expect(written).toBe(
      [
        "monitorSteps:",
        "  - monitorDestination: https://example.com",
        "    criteria:",
        "      - name: Online",
        '        filterType: "True"',
        "",
      ].join("\n"),
    );
    expect(yaml.load(written)).toEqual({
      monitorSteps: [
        {
          monitorDestination: "https://example.com",
          criteria: [{ name: "Online", filterType: "True" }],
        },
      ],
    });
  });

  test("writes an empty map, an empty list and a flow list on the key's line", () => {
    const written: string = printYaml(
      Yaml.map([
        Yaml.entry("managementPolicies", Yaml.flowList(["Observe"])),
        Yaml.entry("forProvider", Yaml.map([])),
        Yaml.entry("labels", Yaml.list([])),
      ]),
    );

    expect(written).toBe(
      'managementPolicies: ["Observe"]\nforProvider: {}\nlabels: []\n',
    );
    expect(yaml.load(written)).toEqual({
      managementPolicies: ["Observe"],
      forProvider: {},
      labels: [],
    });
  });

  // A manifest that writes no field still says what it left out, and why.
  test("keeps an empty map's comments, under its {}", () => {
    const written: string = printYaml(
      Yaml.map([
        Yaml.entry(
          "forProvider",
          Yaml.map([
            Yaml.comment("Left to OneUptime: labels.\nWrite it here."),
          ]),
        ),
        Yaml.entry("kind", Yaml.string("Label")),
      ]),
    );

    expect(written).toBe(
      "forProvider: {}\n  # Left to OneUptime: labels.\n  # Write it here.\nkind: Label\n",
    );
    expect(yaml.load(written)).toEqual({ forProvider: {}, kind: "Label" });
  });

  test("separates documents with ---", () => {
    const written: string = printYamlDocuments([
      Yaml.map([Yaml.entry("kind", Yaml.string("Label"))]),
      {
        comments: ["The monitor."],
        body: Yaml.map([Yaml.entry("kind", Yaml.string("Monitor"))]),
      },
    ]);

    expect(written).toBe("kind: Label\n---\n# The monitor.\nkind: Monitor\n");
    expect(yaml.loadAll(written)).toEqual([
      { kind: "Label" },
      { kind: "Monitor" },
    ]);
  });
});

describe("comments", () => {
  test("name the record an ID stands for, after the value", () => {
    const written: string = printYaml(
      Yaml.map([
        Yaml.entry(
          "incidentSeverityId",
          Yaml.string("6b1d0e2a-1234-4b2c-9d8e-0123456789ab"),
          "Critical Incident",
        ),
        Yaml.entry(
          "labels",
          Yaml.list([
            {
              value: Yaml.string("7a8b9c0d-1234-4b2c-9d8e-0123456789ab"),
              comment: "production",
            },
          ]),
        ),
      ]),
    );

    expect(written).toBe(
      [
        "incidentSeverityId: 6b1d0e2a-1234-4b2c-9d8e-0123456789ab # Critical Incident",
        "labels:",
        "  - 7a8b9c0d-1234-4b2c-9d8e-0123456789ab # production",
        "",
      ].join("\n"),
    );
    expect(yaml.load(written)).toEqual({
      incidentSeverityId: "6b1d0e2a-1234-4b2c-9d8e-0123456789ab",
      labels: ["7a8b9c0d-1234-4b2c-9d8e-0123456789ab"],
    });
  });

  test("a name with a line break in it stays one comment", () => {
    expect(toYamlTrailingComment("prod\nkey: injected")).toBe(
      "prod key: injected",
    );

    const written: string = printYaml(
      Yaml.map([Yaml.entry("id", Yaml.string("x"), "prod\nkey: injected")]),
    );

    expect(yaml.load(written)).toEqual({ id: "x" });
  });

  test("a long name is cut short", () => {
    expect(toYamlTrailingComment("a".repeat(100))).toHaveLength(60);
  });

  test("a comment line goes before the entry it is about, one line per line", () => {
    const written: string = printYaml(
      Yaml.map([
        Yaml.entry("name", Yaml.string("x")),
        Yaml.comment(
          "Secrets are not shown here: password.\nThey stay as they are.",
        ),
      ]),
    );

    expect(written).toBe(
      "name: x\n# Secrets are not shown here: password.\n# They stay as they are.\n",
    );
    expect(yaml.load(written)).toEqual({ name: "x" });
  });
});

describe("scalars", () => {
  test("numbers, booleans and null are written as YAML reads them", () => {
    const node: YamlNode = Yaml.map([
      Yaml.entry("int", Yaml.number(5)),
      Yaml.entry("float", Yaml.number(99.5)),
      Yaml.entry("negative", Yaml.number(-2)),
      Yaml.entry("yes", Yaml.bool(false)),
      Yaml.entry("none", Yaml.null()),
    ]);

    expect(yaml.load(printYaml(node))).toEqual({
      int: 5,
      float: 99.5,
      negative: -2,
      yes: false,
      none: null,
    });
    // A key YAML 1.1 reads as a boolean is quoted too.
    expect(printYaml(node)).toContain('"yes": false');
  });
});
