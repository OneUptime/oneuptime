import {
  CLIPBOARD_WRITER_FILE,
  ClipboardWriteFinding,
  ClipboardWriteKind,
  ClipboardWriteSite,
  IMAGE_CLIPBOARD_FILES,
  REPOSITORY_ROOT,
  disallowedClipboardWrites,
  findClipboardWriteSites,
  formatClipboardWriteFindings,
  listClipboardScanFiles,
  scanClipboardWrites,
} from "../ClipboardWrites";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5132: the status page's Subscribe to calendar dialog awaited
 * navigator.clipboard?.writeText(...) and then said "Copied!". On a status
 * page served over plain http - a self-hosted install reached by a LAN
 * hostname - there is no navigator.clipboard: the optional call resolves to
 * undefined, nothing is copied, and the dialog said "Copied!" anyway. A
 * dozen other copy buttons wrote to navigator.clipboard themselves and
 * failed their own ways - a tick over an empty clipboard, a click that threw,
 * a button that did nothing.
 *
 * Text reaches the clipboard through Common/UI/Utils/Clipboard.ts alone now,
 * and this guard holds it there: it reads every browser module (each
 * feature set's src, Common/UI, and ee/Dashboard and ee/AdminDashboard when
 * the checkout has ee/) and fails on any other direct navigator.clipboard
 * access or copy command, naming the file and the line. The detector
 * (Common/Tests/ClipboardWrites.ts) is pinned on snippets first - every
 * spelling it must catch, and what it must leave alone - and only then run
 * over the tree, with checks that the walk really read it.
 */

function kinds(sites: Array<ClipboardWriteSite>): Array<string> {
  return sites.map((site: ClipboardWriteSite): string => {
    return `${site.kind} @${site.line}: ${site.text}`;
  });
}

function sitesIn(source: string, fileName: string = "Fixture.tsx"): Array<string> {
  return kinds(findClipboardWriteSites(fileName, source));
}

describe("the detector finds every way of reaching the clipboard", () => {
  test("the status page dialog's old copy: an optional call on navigator.clipboard", () => {
    expect(
      sitesIn(
        [
          "const copy = async () => {",
          "  await navigator.clipboard?.writeText(props.copyUrl);",
          "  setIsCopied(true);",
          "};",
        ].join("\n"),
      ),
    ).toEqual([
      `${ClipboardWriteKind.NavigatorClipboard} @2: navigator.clipboard`,
    ]);
  });

  test.each([
    ["a plain call", "navigator.clipboard.writeText(text);"],
    ["an optional access", "void navigator?.clipboard?.writeText(text);"],
    ["through window", "window.navigator.clipboard.writeText(text);"],
    ["through globalThis", "globalThis.navigator.clipboard.writeText(text);"],
    ["through self", "self.navigator.clipboard.writeText(text);"],
    ["by index", 'navigator["clipboard"].writeText(text);'],
    ["a non-null assertion", "navigator!.clipboard.writeText(text);"],
    ["in parentheses", "(navigator).clipboard.writeText(text);"],
    ["a cast", "(navigator as Navigator).clipboard.writeText(text);"],
    ["kept in a variable", "const c = navigator.clipboard; c.writeText(t);"],
    ["a feature check", 'if ("writeText" in navigator.clipboard) {}'],
    ["an image write", "navigator.clipboard.write([item]);"],
    ["a read", "await navigator.clipboard.readText();"],
  ])("%s", (_name: string, source: string) => {
    const found: Array<ClipboardWriteSite> = findClipboardWriteSites(
      "Fixture.ts",
      source,
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe(ClipboardWriteKind.NavigatorClipboard);
  });

  test("destructured from navigator", () => {
    expect(sitesIn("const { clipboard } = navigator;")).toEqual([
      `${ClipboardWriteKind.NavigatorClipboard} @1: { clipboard } = navigator`,
    ]);
    expect(sitesIn("const { clipboard: board } = window.navigator;")).toEqual(
      [
        `${ClipboardWriteKind.NavigatorClipboard} @1: { clipboard: board } = window.navigator`,
      ],
    );
  });

  test.each([
    ['document.execCommand("copy")'],
    ["document.execCommand('copy')"],
    ['document.execCommand("cut")'],
    ['document.execCommand("Copy")'],
    ['window.document.execCommand("copy")'],
    ['document["execCommand"]("copy")'],
  ])("the copy command: %s", (call: string) => {
    expect(sitesIn(`const ok = ${call};`)).toEqual([
      `${ClipboardWriteKind.CopyCommand} @1: ${call}`,
    ]);
  });

  test("in a .tsx module's JSX too", () => {
    expect(
      sitesIn(
        [
          "const Button = () => (",
          "  <button onClick={() => navigator.clipboard.writeText(text)}>",
          "    Copy",
          "  </button>",
          ");",
        ].join("\n"),
        "Button.tsx",
      ),
    ).toEqual([
      `${ClipboardWriteKind.NavigatorClipboard} @2: navigator.clipboard`,
    ]);
  });

  test("one finding per access, on its own line", () => {
    expect(
      sitesIn(
        [
          "if (navigator.clipboard) {",
          "  void navigator.clipboard.writeText(a);",
          "}",
          'document.execCommand("copy");',
        ].join("\n"),
      ),
    ).toEqual([
      `${ClipboardWriteKind.NavigatorClipboard} @1: navigator.clipboard`,
      `${ClipboardWriteKind.NavigatorClipboard} @2: navigator.clipboard`,
      `${ClipboardWriteKind.CopyCommand} @4: document.execCommand("copy")`,
    ]);
  });
});

describe("the detector leaves alone what is not a clipboard write", () => {
  test.each([
    ["a comment that names it", "// navigator.clipboard is absent on plain http"],
    ["a block comment", "/* await navigator.clipboard?.writeText(x) */"],
    ["a string", 'const why = "navigator.clipboard is undefined";'],
    ["a template", "const why = `navigator.clipboard is ${state}`;"],
    ["the helper", "await Clipboard.copyToClipboard(text);"],
    ["the hook", "await clipboard.copy(text, key);"],
    ["another object's clipboard", "event.clipboardData.setData('x', y);"],
    ["a paste handler", "const data = event.clipboardData;"],
    ["a field named clipboard", "const support = props.clipboard;"],
    ["navigator's other parts", "const lang = navigator.language;"],
    ["an editing command", 'document.execCommand("insertText", false, t);'],
    ["a command named by a variable", "document.execCommand(command, false, v);"],
    ["a look-alike that is not navigator", "const x = nav.clipboard;"],
  ])("%s", (_name: string, source: string) => {
    expect(sitesIn(source)).toEqual([]);
  });
});

describe("the allowed files", () => {
  test("only Clipboard.ts and the image writers may reach the clipboard", () => {
    const findings: Array<ClipboardWriteFinding> = [
      {
        file: CLIPBOARD_WRITER_FILE,
        line: 1,
        kind: ClipboardWriteKind.NavigatorClipboard,
        text: "navigator.clipboard",
      },
      ...Object.keys(IMAGE_CLIPBOARD_FILES).map(
        (file: string): ClipboardWriteFinding => {
          return {
            file: file,
            line: 1,
            kind: ClipboardWriteKind.NavigatorClipboard,
            text: "navigator.clipboard",
          };
        },
      ),
      {
        file: "packages/App/FeatureSet/StatusPage/src/Components/MaintenanceCalendar/MaintenanceCalendarModal.tsx",
        line: 79,
        kind: ClipboardWriteKind.NavigatorClipboard,
        text: "navigator.clipboard",
      },
    ];

    expect(disallowedClipboardWrites(findings)).toEqual([
      findings[findings.length - 1],
    ]);
  });

  test("each image writer says why it may", () => {
    for (const [file, why] of Object.entries(IMAGE_CLIPBOARD_FILES)) {
      expect({ file, saysWhy: why.length > 40 }).toEqual({
        file,
        saysWhy: true,
      });
    }
  });

  test("a finding is reported with its file, its line and what to do", () => {
    const message: string = formatClipboardWriteFindings([
      {
        file: "packages/Common/UI/Components/Example.tsx",
        line: 12,
        kind: ClipboardWriteKind.NavigatorClipboard,
        text: "navigator.clipboard",
      },
    ]);

    expect(message).toContain(
      "packages/Common/UI/Components/Example.tsx:12  navigator.clipboard",
    );
    expect(message).toContain("Clipboard.copyToClipboard");
    expect(message).toContain("useClipboardCopy");
    expect(message).toContain("#5132");
    expect(formatClipboardWriteFindings([])).toBe("");
  });
});

describe("the browser code of the whole product", () => {
  const files: Array<string> = listClipboardScanFiles(REPOSITORY_ROOT);
  const findings: Array<ClipboardWriteFinding> = scanClipboardWrites(
    REPOSITORY_ROOT,
    files,
  );

  function relative(file: string): string {
    return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
  }

  test("is really read: every app's source and the shared UI", () => {
    const read: Set<string> = new Set<string>(files.map(relative));

    expect(files.length).toBeGreaterThan(1000);

    for (const expected of [
      CLIPBOARD_WRITER_FILE,
      "packages/App/FeatureSet/StatusPage/src/Components/MaintenanceCalendar/MaintenanceCalendarModal.tsx",
      "packages/Common/UI/Components/CopyTextButton/CopyTextButton.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/AIChat/ChatMessageList.tsx",
      "packages/App/FeatureSet/Accounts/src/App.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/App.tsx",
      "packages/App/FeatureSet/PublicDashboard/src/App.tsx",
      ...Object.keys(IMAGE_CLIPBOARD_FILES),
    ]) {
      expect({ file: expected, read: read.has(expected) }).toEqual({
        file: expected,
        read: true,
      });
    }

    if (fs.existsSync(path.join(REPOSITORY_ROOT, "ee"))) {
      expect(read.has("ee/AdminDashboard/Health/QueryConsole.tsx")).toBe(true);
    }
  });

  test("the one writer is found where it writes: the async clipboard, then the copy command", () => {
    const writer: Array<ClipboardWriteFinding> = findings.filter(
      (finding: ClipboardWriteFinding): boolean => {
        return finding.file === CLIPBOARD_WRITER_FILE;
      },
    );

    expect(
      writer.some((finding: ClipboardWriteFinding): boolean => {
        return finding.kind === ClipboardWriteKind.NavigatorClipboard;
      }),
    ).toBe(true);
    expect(
      writer.some((finding: ClipboardWriteFinding): boolean => {
        return finding.kind === ClipboardWriteKind.CopyCommand;
      }),
    ).toBe(true);
  });

  test("nothing else writes to the clipboard directly", () => {
    expect(formatClipboardWriteFindings(disallowedClipboardWrites(findings))).toBe(
      "",
    );
  });

  test("an image writer never writes text itself: that goes through Clipboard.ts", () => {
    for (const file of Object.keys(IMAGE_CLIPBOARD_FILES)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );
      const sites: Array<ClipboardWriteSite> = findClipboardWriteSites(
        file,
        source,
      );

      // Still an image writer: drop it from the list once it is not.
      expect({ file, reachesClipboard: sites.length > 0 }).toEqual({
        file,
        reachesClipboard: true,
      });
      expect({ file, writesText: source.includes(".writeText(") }).toEqual({
        file,
        writesText: false,
      });
      expect(
        sites.filter((site: ClipboardWriteSite): boolean => {
          return site.kind === ClipboardWriteKind.CopyCommand;
        }),
      ).toEqual([]);
    }
  });
});
