import { describe, expect, test } from "@jest/globals";
import {
  escapeHclString,
  formatHclObjectKey,
  Hcl,
  printHclDocument,
  printHclExpression,
  quoteHclString,
  shouldUseHeredoc,
  toHclTrailingComment,
} from "../../../Utils/DeveloperDocs/Hcl";

/*
 * The HCL writer behind the Developer > Terraform pages. What matters most is
 * that Terraform reads back exactly the string that was written: the
 * configuration is meant to be imported, and a value that comes back one
 * character different is a change `terraform plan` would apply to the real
 * resource. The layout rules are `terraform fmt`'s.
 */

describe("quoted strings", () => {
  test("escapes quotes, backslashes and whitespace characters", () => {
    expect(escapeHclString('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeHclString("C:\\path")).toBe("C:\\\\path");
    expect(escapeHclString("a\nb\rc\td")).toBe("a\\nb\\rc\\td");
  });

  test("doubles template sequences so they stay text", () => {
    expect(escapeHclString("Hello ${name}")).toBe("Hello $${name}");
    expect(escapeHclString("%{if x}y%{endif}")).toBe("%%{if x}y%%{endif}");
  });

  test("leaves a lone $ or % alone", () => {
    expect(escapeHclString("costs $5, 50% off")).toBe("costs $5, 50% off");
    expect(escapeHclString("${")).toBe("$${");
    expect(escapeHclString("$")).toBe("$");
  });

  test("writes other control characters as unicode escapes", () => {
    expect(escapeHclString("a\u0001b\u007f")).toBe("a\\u0001b\\u007f");
  });

  test("keeps unicode text as it is", () => {
    expect(quoteHclString("Überwachung ✓ 監視")).toBe('"Überwachung ✓ 監視"');
  });
});

describe("multi-line strings", () => {
  test("use a heredoc from three lines on", () => {
    expect(shouldUseHeredoc("one line")).toBe(false);
    expect(shouldUseHeredoc("two\nlines")).toBe(false);
    expect(shouldUseHeredoc("three\nshort\nlines")).toBe(true);
  });

  test("stay quoted when they hold a carriage return or a control character", () => {
    expect(shouldUseHeredoc("a\r\nb\r\nc")).toBe(false);
    expect(shouldUseHeredoc("a\nb\u0000\nc")).toBe(false);
  });

  test("a value ending in a newline is a plain heredoc", () => {
    expect(printHclExpression(Hcl.string("body {\n  color: red;\n}\n"))).toBe(
      "<<EOT\nbody {\n  color: red;\n}\nEOT",
    );
  });

  test("a value without a final newline is wrapped in chomp()", () => {
    expect(printHclExpression(Hcl.string("a\nb\nc"))).toBe(
      "chomp(<<EOT\na\nb\nc\nEOT\n)",
    );
  });

  test("keeps the value's own indentation (no <<- trimming)", () => {
    const printed: string = printHclDocument([
      Hcl.block(
        "resource",
        ["x", "y"],
        [Hcl.attribute("css", Hcl.string("  indented\n    more\n  end\n"))],
      ),
    ]);

    expect(printed).toContain(
      "css = <<EOT\n  indented\n    more\n  end\nEOT\n",
    );
  });

  test("escapes template sequences inside the heredoc", () => {
    expect(printHclExpression(Hcl.string("a ${b}\n%{c}\nd\n"))).toBe(
      "<<EOT\na $${b}\n%%{c}\nd\nEOT",
    );
  });

  test("picks a marker no line of the value uses", () => {
    expect(printHclExpression(Hcl.string("one\nEOT\nthree\n"))).toBe(
      "<<EOT1\none\nEOT\nthree\nEOT1",
    );
  });

  test("an empty line in the value survives", () => {
    expect(printHclExpression(Hcl.string("a\n\nb\n"))).toBe(
      "<<EOT\na\n\nb\nEOT",
    );
  });
});

describe("scalars", () => {
  test("numbers, booleans, null and references", () => {
    expect(printHclExpression(Hcl.number(42))).toBe("42");
    expect(printHclExpression(Hcl.number(99.5))).toBe("99.5");
    expect(printHclExpression(Hcl.number(-3))).toBe("-3");
    expect(printHclExpression(Hcl.number(Number.NaN))).toBe("null");
    expect(printHclExpression(Hcl.bool(true))).toBe("true");
    expect(printHclExpression(Hcl.bool(false))).toBe("false");
    expect(printHclExpression(Hcl.null())).toBe("null");
    expect(printHclExpression(Hcl.raw("var.api_key"))).toBe("var.api_key");
  });
});

describe("lists", () => {
  test("short lists of plain values stay on one line", () => {
    expect(
      printHclExpression(Hcl.tuple([Hcl.string("a"), Hcl.string("b")])),
    ).toBe('["a", "b"]');
    expect(printHclExpression(Hcl.tuple([]))).toBe("[]");
  });

  test("long lists put one item per line, each with a comma", () => {
    const ids: Array<string> = [
      "0a1b2c3d-0000-4000-8000-000000000001",
      "0a1b2c3d-0000-4000-8000-000000000002",
      "0a1b2c3d-0000-4000-8000-000000000003",
    ];

    expect(
      printHclExpression(
        Hcl.tuple(
          ids.map((id: string) => {
            return Hcl.string(id);
          }),
        ),
      ),
    ).toBe(
      [
        "[",
        '  "0a1b2c3d-0000-4000-8000-000000000001",',
        '  "0a1b2c3d-0000-4000-8000-000000000002",',
        '  "0a1b2c3d-0000-4000-8000-000000000003",',
        "]",
      ].join("\n"),
    );
  });

  test("items with comments are written one per line", () => {
    expect(
      printHclExpression(
        Hcl.tuple([{ value: Hcl.string("id-1"), comment: "production" }]),
      ),
    ).toBe('[\n  "id-1", # production\n]');
  });

  test("lists of objects nest", () => {
    expect(
      printHclExpression(
        Hcl.tuple([Hcl.object([{ key: "a", value: Hcl.number(1) }])]),
      ),
    ).toBe("[\n  {\n    a = 1\n  },\n]");
  });
});

describe("objects", () => {
  test("align the = of their one-line values", () => {
    expect(
      printHclExpression(
        Hcl.object([
          { key: "check_on", value: Hcl.string("Is Online") },
          { key: "filter_type", value: Hcl.string("True") },
        ]),
      ),
    ).toBe('{\n  check_on    = "Is Online"\n  filter_type = "True"\n}');
  });

  test("an empty object is {}", () => {
    expect(printHclExpression(Hcl.object([]))).toBe("{}");
  });

  test("quote keys that are not plain identifiers, or that HCL reserves", () => {
    expect(formatHclObjectKey("checkOn")).toBe("checkOn");
    expect(formatHclObjectKey("api-key")).toBe("api-key");
    expect(formatHclObjectKey("Content Type")).toBe('"Content Type"');
    expect(formatHclObjectKey("1st")).toBe('"1st"');
    expect(formatHclObjectKey("for")).toBe('"for"');
    expect(formatHclObjectKey("null")).toBe('"null"');
    expect(formatHclObjectKey("true")).toBe('"true"');
    expect(formatHclObjectKey('a"b')).toBe('"a\\"b"');
  });
});

describe("function calls", () => {
  test("one-line arguments stay on one line", () => {
    expect(printHclExpression(Hcl.call("jsonencode", [Hcl.object([])]))).toBe(
      "jsonencode({})",
    );
  });

  test("a multi-line argument hugs the parentheses", () => {
    expect(
      printHclExpression(
        Hcl.call("jsonencode", [
          Hcl.object([{ key: "a", value: Hcl.number(1) }]),
        ]),
      ),
    ).toBe("jsonencode({\n  a = 1\n})");
  });
});

describe("documents", () => {
  test("align consecutive one-line attributes like terraform fmt", () => {
    expect(
      printHclDocument([
        Hcl.block(
          "resource",
          ["oneuptime_workflow", "report"],
          [
            Hcl.attribute("name", Hcl.string("Report")),
            Hcl.attribute("description", Hcl.string("Weekly")),
            Hcl.attribute("is_enabled", Hcl.bool(true)),
          ],
        ),
      ]),
    ).toBe(
      [
        'resource "oneuptime_workflow" "report" {',
        '  name        = "Report"',
        '  description = "Weekly"',
        "  is_enabled  = true",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("a multi-line value is not padded and ends the aligned run", () => {
    expect(
      printHclDocument([
        Hcl.block(
          "resource",
          ["x", "y"],
          [
            Hcl.attribute("ami", Hcl.string("ami-123")),
            Hcl.attribute("instance_type", Hcl.string("t2.micro")),
            Hcl.attribute(
              "tags",
              Hcl.object([{ key: "Name", value: Hcl.string("web") }]),
            ),
            Hcl.attribute("a", Hcl.number(1)),
            Hcl.attribute("long_name", Hcl.number(2)),
          ],
        ),
      ]),
    ).toBe(
      [
        'resource "x" "y" {',
        '  ami           = "ami-123"',
        '  instance_type = "t2.micro"',
        "  tags = {",
        '    Name = "web"',
        "  }",
        "  a         = 1",
        "  long_name = 2",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("a heredoc keeps its body at the start of the line inside a block", () => {
    expect(
      printHclDocument([
        Hcl.block(
          "resource",
          ["x", "y"],
          [
            Hcl.attribute("name", Hcl.string("A")),
            Hcl.attribute("code", Hcl.string("line 1\nline 2\nline 3")),
          ],
        ),
      ]),
    ).toBe(
      [
        'resource "x" "y" {',
        '  name = "A"',
        "  code = chomp(<<EOT",
        "line 1",
        "line 2",
        "line 3",
        "EOT",
        "  )",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("comments, blank lines and nested blocks", () => {
    expect(
      printHclDocument([
        Hcl.block(
          "terraform",
          [],
          [
            Hcl.block(
              "required_providers",
              [],
              [
                Hcl.attribute(
                  "oneuptime",
                  Hcl.object([
                    { key: "source", value: Hcl.string("oneuptime/oneuptime") },
                  ]),
                ),
              ],
            ),
          ],
        ),
        Hcl.blank(),
        Hcl.block(
          "provider",
          ["oneuptime"],
          [Hcl.comment("First line.\nSecond line.")],
        ),
        Hcl.blank(),
        Hcl.block("data", ["x", "y"], []),
      ]),
    ).toBe(
      [
        "terraform {",
        "  required_providers {",
        "    oneuptime = {",
        '      source = "oneuptime/oneuptime"',
        "    }",
        "  }",
        "}",
        "",
        'provider "oneuptime" {',
        "  # First line.",
        "  # Second line.",
        "}",
        "",
        'data "x" "y" {}',
        "",
      ].join("\n"),
    );
  });

  test("block labels are escaped", () => {
    expect(printHclDocument([Hcl.block("data", ['a"b', "${x}"], [])])).toBe(
      'data "a\\"b" "$${x}" {}\n',
    );
  });
});

/*
 * Trailing comments name the record an id stands for (`= "6b1d..." #
 * Critical Incident`). `terraform fmt` lines up the comments of
 * consecutive lines that have one, one space after the longest of those
 * lines, and a line without one ends the run; the printer must do the same,
 * or a configuration copied from the page is reformatted by the first
 * `terraform fmt`. (Every configuration the Developer pages generate was
 * also checked with `terraform fmt -check` and `terraform validate` against
 * the published provider while this was built.)
 */
describe("trailing comments", () => {
  test("follow an attribute's value", () => {
    expect(
      printHclDocument([
        Hcl.block(
          "resource",
          ["oneuptime_incident", "x"],
          [
            Hcl.attribute(
              "incident_severity_id",
              Hcl.string("6b1d"),
              "Critical Incident",
            ),
          ],
        ),
      ]),
    ).toBe(
      [
        'resource "oneuptime_incident" "x" {',
        '  incident_severity_id = "6b1d" # Critical Incident',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("on consecutive lines start in one column, after the = are lined up", () => {
    expect(
      printHclDocument([
        Hcl.block(
          "resource",
          ["oneuptime_incident", "x"],
          [
            Hcl.attribute("title", Hcl.string("Checkout")),
            Hcl.attribute("severity_id", Hcl.string("a1"), "Critical"),
            Hcl.attribute(
              "monitors",
              Hcl.tuple([Hcl.string("e1234")]),
              "Checkout API",
            ),
            Hcl.attribute("status_id", Hcl.string("d2"), "Degraded"),
          ],
        ),
      ]),
    ).toBe(
      [
        'resource "oneuptime_incident" "x" {',
        '  title       = "Checkout"',
        '  severity_id = "a1"      # Critical',
        '  monitors    = ["e1234"] # Checkout API',
        '  status_id   = "d2"      # Degraded',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("a line without a comment ends the run, and the next run lines up on its own", () => {
    expect(
      printHclDocument([
        Hcl.block(
          "resource",
          ["x", "y"],
          [
            Hcl.attribute("a", Hcl.string("long value here"), "first"),
            Hcl.attribute("b", Hcl.string("v")),
            Hcl.attribute("c", Hcl.string("short"), "second"),
          ],
        ),
      ]),
    ).toBe(
      [
        'resource "x" "y" {',
        '  a = "long value here" # first',
        '  b = "v"',
        '  c = "short" # second',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("list items carry their own, lined up with each other", () => {
    expect(
      printHclExpression(
        Hcl.tuple([
          { value: Hcl.string("a-much-longer-id"), comment: "first" },
          { value: Hcl.string("short"), comment: "second" },
        ]),
      ),
    ).toBe(
      [
        "[",
        '  "a-much-longer-id", # first',
        '  "short",            # second',
        "]",
      ].join("\n"),
    );
  });

  test("objects inside a value carry them too", () => {
    expect(
      printHclExpression(
        Hcl.object([
          {
            key: "monitor_status_id",
            value: Hcl.string("d3"),
            comment: "Offline",
          },
          { key: "create_incidents", value: Hcl.bool(true) },
        ]),
      ),
    ).toBe(
      [
        "{",
        '  monitor_status_id = "d3" # Offline',
        "  create_incidents  = true",
        "}",
      ].join("\n"),
    );
  });

  test("a value written over several lines takes none: its items carry theirs", () => {
    const printed: string = printHclDocument([
      Hcl.attribute(
        "labels",
        Hcl.tuple([
          { value: Hcl.string("l1"), comment: "production" },
          { value: Hcl.string("l2"), comment: "eu" },
        ]),
        "ignored",
      ),
    ]);

    expect(printed).not.toContain("ignored");
    expect(printed).toBe(
      ["labels = [", '  "l1", # production', '  "l2", # eu', "]", ""].join(
        "\n",
      ),
    );
  });

  test("an empty comment writes nothing", () => {
    expect(printHclDocument([Hcl.attribute("a", Hcl.string("b"), "   ")])).toBe(
      'a = "b"\n',
    );
  });
});

describe("the text of a trailing comment", () => {
  test("cannot break out of its line: a name with line breaks stays one comment", () => {
    const comment: string = toHclTrailingComment(
      'prod\nresource "x" "evil" {}\r\n\tdone',
    );

    expect(comment).toBe('prod resource "x" "evil" {} done');
    expect(comment).not.toMatch(/[\r\n\t]/);

    const printed: string = printHclDocument([
      Hcl.attribute(
        "team_id",
        Hcl.string("t1"),
        'Platform\nresource "oneuptime_team" "evil" {}',
      ),
    ]);

    expect(printed.split("\n")).toHaveLength(2);
    expect(printed).toBe(
      'team_id = "t1" # Platform resource "oneuptime_team" "evil" {}\n',
    );
  });

  test("control characters and runs of spaces collapse", () => {
    expect(toHclTrailingComment("a\u0000b   c\u007Fd")).toBe("a b c d");
  });

  test("a long name is cut short", () => {
    const comment: string = toHclTrailingComment("x".repeat(200));

    expect(Array.from(comment)).toHaveLength(60);
    expect(comment.endsWith("…")).toBe(true);
  });

  test("an accented value counts its characters, not its bytes, when lining up", () => {
    expect(
      printHclDocument([
        Hcl.attribute("a", Hcl.string("é"), "one"),
        Hcl.attribute("bb", Hcl.string("e"), "two"),
      ]),
    ).toBe(['a  = "é" # one', 'bb = "e" # two', ""].join("\n"));
  });
});
