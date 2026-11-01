import {
  BUTTON_STATES_FILE,
  CORE_FRONTEND_DIRECTORIES,
  ENTERPRISE_FRONTEND_DIRECTORIES,
  FIELD_FACES,
  LOCKED_LOOK_ADVICE,
  LockedLookFinding,
  LockedLookKind,
  LockedLookScan,
  LockedLookSource,
  REPOSITORY_ROOT,
  UNKNOWN_ELEMENT,
  describeFinding,
  isDisabledVariantClass,
  isFieldFace,
  isOwnCursorClass,
  listFrontendFiles,
  readSources,
  resolveImportedModule,
} from "../Helpers/HandDrawnButtonLookScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every button that cannot be pressed looks it the same way: faded, with
 * the not-allowed cursor and no hover, whether Button draws it or it is
 * drawn by hand (a tile, a chip, a segmented control, a toolbar's or a
 * player's control) and takes the look from Button/ButtonStates. A busy one
 * keeps its look beside its spinner.
 *
 * About forty hand-drawn buttons used to say "locked" in looks of their own
 * - faded to 40%, 60% or 70%, words turned grey or a pale indigo, a wait or
 * an arrow cursor, and a hover that still came when they could not be
 * pressed - so one page could show three different "off"s, and a Refresh
 * that was only busy faded as if it had been turned off.
 *
 * The detector (Tests/Helpers/HandDrawnButtonLookScan) is pinned on inline
 * modules first - every shape it must catch and every one it must leave
 * alone - and then run over every frontend, with checks that it really read
 * them. ee/'s frontends are read when the checkout has them; the Enterprise
 * Edition Test job's ee/Tests/Server/HandDrawnButtonLockedLookGuard reads
 * them in CI, where this job runs without ee/.
 */

const scanOf: (sources: Array<LockedLookSource>) => Array<string> = (
  sources: Array<LockedLookSource>,
): Array<string> => {
  return new LockedLookScan(sources)
    .findAll()
    .map((finding: LockedLookFinding): string => {
      return `${finding.kind} ${describeFinding(finding)}`;
    });
};

const moduleOf: (text: string, file?: string) => LockedLookSource = (
  text: string,
  file?: string,
): LockedLookSource => {
  return { file: file || "packages/Common/UI/Components/Example.tsx", text };
};

describe("the classes the guard reads", () => {
  test("a disabled: utility, whatever comes before it", () => {
    expect(isDisabledVariantClass("disabled:opacity-60")).toBe(true);
    expect(isDisabledVariantClass("disabled:hover:bg-transparent")).toBe(true);
    expect(isDisabledVariantClass("md:disabled:opacity-50")).toBe(true);
    expect(isDisabledVariantClass("dark:disabled:text-gray-500")).toBe(true);
  });

  test("not a utility that only names the word, nor another state's variant", () => {
    expect(isDisabledVariantClass("opacity-50")).toBe(false);
    expect(isDisabledVariantClass("aria-disabled:opacity-50")).toBe(false);
    expect(isDisabledVariantClass("peer-disabled:opacity-50")).toBe(false);
    expect(isDisabledVariantClass("group-disabled:opacity-50")).toBe(false);
    expect(isDisabledVariantClass("disabled")).toBe(false);
  });

  test("the not-allowed cursor on its own", () => {
    expect(isOwnCursorClass("cursor-not-allowed")).toBe(true);
    expect(isOwnCursorClass("cursor-pointer")).toBe(false);
    // A variant of it is a disabled: utility, read as one.
    expect(isOwnCursorClass("disabled:cursor-not-allowed")).toBe(false);
  });
});

describe("the detector finds a locked look of its own", () => {
  test("on a hand-drawn button, written on the element", () => {
    expect(
      scanOf([
        moduleOf(
          `export const A = () => <button disabled={x} className="rounded px-2 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed">Go</button>;`,
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.DisabledVariant} packages/Common/UI/Components/Example.tsx:1 <button> disabled:opacity-60 disabled:cursor-not-allowed`,
    ]);
  });

  test("on a Button's className, which locks its own look already", () => {
    expect(
      scanOf([
        moduleOf(
          `export const A = () => <Button title="Go" className="w-full disabled:opacity-60" />;`,
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.DisabledVariant} packages/Common/UI/Components/Example.tsx:1 <Button> disabled:opacity-60`,
    ]);
  });

  test("in a branch of a template, written by hand with the not-allowed cursor", () => {
    expect(
      scanOf([
        moduleOf(
          [
            "export const A = (p) => (",
            "  <button",
            "    disabled={p.isLocked}",
            '    className={`rounded px-2 ${p.isLocked ? "cursor-not-allowed text-gray-300" : "hover:bg-gray-50"}`}',
            "  />",
            ");",
          ].join("\n"),
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.OwnCursor} packages/Common/UI/Components/Example.tsx:4 <button> cursor-not-allowed`,
    ]);
  });

  test("held in a constant the element names", () => {
    expect(
      scanOf([
        moduleOf(
          [
            'const NAV_BUTTON: string = "h-7 w-7 rounded-md disabled:opacity-40";',
            "export const A = () => <button className={NAV_BUTTON} />;",
          ].join("\n"),
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.DisabledVariant} packages/Common/UI/Components/Example.tsx:1 <button> disabled:opacity-40`,
    ]);
  });

  test("returned by a function the element calls", () => {
    expect(
      scanOf([
        moduleOf(
          [
            "const classOf = (locked: boolean): string => {",
            '  return locked ? "cursor-not-allowed opacity-40" : "hover:bg-gray-50";',
            "};",
            "export const A = (p) => <button className={`px-2 ${classOf(p.locked)}`} />;",
          ].join("\n"),
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.OwnCursor} packages/Common/UI/Components/Example.tsx:2 <button> cursor-not-allowed`,
    ]);
  });

  test("in a constant another module imports and draws", () => {
    expect(
      scanOf([
        moduleOf(
          'export const HEADER_BUTTON_CLASS_NAME: string = "h-9 rounded-md disabled:cursor-not-allowed disabled:opacity-50";',
          "packages/App/FeatureSet/Dashboard/src/Components/Header/HeaderLayout.ts",
        ),
        moduleOf(
          [
            'import { HEADER_BUTTON_CLASS_NAME } from "./HeaderLayout";',
            "export const A = () => <button className={HEADER_BUTTON_CLASS_NAME} />;",
          ].join("\n"),
          "packages/App/FeatureSet/Dashboard/src/Components/Header/Header.tsx",
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.DisabledVariant} packages/App/FeatureSet/Dashboard/src/Components/Header/HeaderLayout.ts:1 <button> disabled:cursor-not-allowed disabled:opacity-50`,
    ]);
  });

  test("on a label drawn as a choice", () => {
    expect(
      scanOf([
        moduleOf(
          'export const A = (p) => <label className={p.off ? "cursor-not-allowed opacity-60" : "cursor-pointer"}><input type="radio" /></label>;',
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.OwnCursor} packages/Common/UI/Components/Example.tsx:1 <label> cursor-not-allowed`,
    ]);
  });

  test("where the scan cannot follow it, it says so rather than letting it go", () => {
    expect(
      scanOf([
        moduleOf(
          'export class A { private look: string = "cursor-not-allowed opacity-40"; }',
        ),
      ]),
    ).toEqual([
      `${LockedLookKind.OwnCursor} packages/Common/UI/Components/Example.tsx:1 <${UNKNOWN_ELEMENT}> cursor-not-allowed`,
    ]);
  });
});

describe("the detector leaves alone", () => {
  test("a field you type in or pick from, which keeps its own locked look", () => {
    expect(
      scanOf([
        moduleOf(
          [
            'export const A = () => <input className="rounded border disabled:bg-gray-50 disabled:text-gray-500" />;',
            'export const B = () => <select className="disabled:cursor-not-allowed disabled:opacity-50" />;',
            'export const C = () => <textarea className="disabled:opacity-60" />;',
          ].join("\n"),
        ),
      ]),
    ).toEqual([]);
  });

  test("a group of fields a form pauses in", () => {
    expect(
      scanOf([
        moduleOf(
          'export const A = (p) => <fieldset disabled={p.isBusy} className="transition-opacity disabled:pointer-events-none disabled:opacity-50"><input /></fieldset>;',
        ),
      ]),
    ).toEqual([]);
  });

  test("a field face drawn by hand, as written in its own file - and nowhere else", () => {
    const face: (typeof FIELD_FACES)[number] = FIELD_FACES[0]!;
    const element: string = `export const A = (p) => <button className={p.disabled ? "${face.classText}" : ""} />;`;

    expect(scanOf([moduleOf(element, face.file)])).toEqual([]);
    expect(scanOf([moduleOf(element)])).toEqual([
      `${LockedLookKind.OwnCursor} packages/Common/UI/Components/Example.tsx:1 <button> cursor-not-allowed`,
    ]);
  });

  test("a field's look built up in a variable", () => {
    expect(
      scanOf([
        moduleOf(
          [
            "export const A = (p) => {",
            '  let className: string = "block w-full rounded-md";',
            "  if (p.disabled) {",
            '    className += " bg-gray-100 text-gray-500 cursor-not-allowed";',
            "  }",
            "  return <input className={className} disabled={p.disabled} />;",
            "};",
          ].join("\n"),
        ),
      ]),
    ).toEqual([]);
  });

  test("a button that takes the shared look", () => {
    expect(
      scanOf([
        moduleOf(
          [
            'import { getHandDrawnButtonStateClassName } from "../Button/ButtonStates";',
            "export const A = (p) => (",
            "  <button",
            "    disabled={p.isLocked || p.isBusy}",
            '    className={`rounded px-2 ${getHandDrawnButtonStateClassName({ isLocked: p.isLocked, isBusy: p.isBusy, hoverClassName: "hover:bg-gray-50" })}`}',
            "  />",
            ");",
          ].join("\n"),
        ),
      ]),
    ).toEqual([]);
  });

  test("ButtonStates itself, where the look is written", () => {
    expect(
      scanOf([
        moduleOf(
          'export const BUTTON_DISABLED_CLASS_NAME: string = "cursor-not-allowed opacity-50";',
          BUTTON_STATES_FILE,
        ),
      ]),
    ).toEqual([]);
  });

  test("words that only mention the classes, and a test of a class list", () => {
    expect(
      scanOf([
        moduleOf(
          [
            'export const MESSAGE: string = translateText("Use cursor-not-allowed for a locked button.");',
            'export const isLocked = (el: HTMLElement): boolean => el.className.includes("cursor-not-allowed");',
            'export const A = () => <span title="disabled:opacity-60">x</span>;',
          ].join("\n"),
        ),
      ]),
    ).toEqual([]);
  });

  test("another state's variant", () => {
    expect(
      scanOf([
        moduleOf(
          'export const A = () => <button className="peer-disabled:opacity-50 aria-disabled:opacity-50" />;',
        ),
      ]),
    ).toEqual([]);
  });
});

describe("the modules an import names", () => {
  test("a relative path, and Common's own", () => {
    expect(
      resolveImportedModule(
        "packages/App/FeatureSet/Dashboard/src/Components/A/B.tsx",
        "../C/D",
      ),
    ).toBe("packages/App/FeatureSet/Dashboard/src/Components/C/D");
    expect(
      resolveImportedModule(
        "packages/App/FeatureSet/Dashboard/src/Components/A/B.tsx",
        "Common/UI/Components/Button/ButtonStates",
      ),
    ).toBe("packages/Common/UI/Components/Button/ButtonStates");
    expect(
      resolveImportedModule(
        "packages/App/FeatureSet/Dashboard/src/Components/A/B.tsx",
        "react",
      ),
    ).toBeNull();
  });
});

describe("every frontend draws a locked button one way", () => {
  const hasEnterprise: boolean = fs.existsSync(
    path.join(REPOSITORY_ROOT, "ee"),
  );
  const directories: Array<string> = [
    ...CORE_FRONTEND_DIRECTORIES,
    ...(hasEnterprise ? ENTERPRISE_FRONTEND_DIRECTORIES : []),
  ];
  const files: Array<string> = directories.flatMap(
    (directory: string): Array<string> => {
      return listFrontendFiles(directory);
    },
  );

  test("the scan read every frontend", () => {
    expect(files.length).toBeGreaterThan(3000);

    for (const directory of CORE_FRONTEND_DIRECTORIES) {
      expect(
        files.some((file: string): boolean => {
          return file.startsWith(`${directory}/`);
        }),
      ).toBe(true);
    }

    expect(files).toEqual(
      expect.arrayContaining([
        BUTTON_STATES_FILE,
        "packages/Common/UI/Components/Button/Button.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer.tsx",
        "packages/App/FeatureSet/StatusPage/src/Components/LiveStatus/LastUpdated.tsx",
      ]),
    );
  });

  test("every field face it lets be is still written where it says, with its reason", () => {
    for (const face of FIELD_FACES) {
      expect(face.reason.length).toBeGreaterThan(20);

      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, face.file),
        "utf8",
      );

      // Stale entries go: the string it lets be is still in its file.
      expect(text.indexOf(face.classText)).not.toBe(-1);
    }

    // The list stays short: a field's face, never a button.
    expect(FIELD_FACES.length).toBeLessThanOrEqual(6);
  });

  test("a field face is let be only in its own file, and only as written", () => {
    const face: (typeof FIELD_FACES)[number] = FIELD_FACES[0]!;

    expect(isFieldFace(face.file, face.classText)).toBe(true);
    expect(isFieldFace(face.file, `  ${face.classText}  `)).toBe(true);
    expect(isFieldFace(face.file, `${face.classText} opacity-40`)).toBe(false);
    expect(
      isFieldFace("packages/Common/UI/Components/Example.tsx", face.classText),
    ).toBe(false);
  });

  test("no hand-drawn button says it is locked in a look of its own", () => {
    const findings: Array<string> = new LockedLookScan(readSources(files))
      .findAll()
      .map(describeFinding);

    if (findings.length > 0) {
      throw new Error(
        `${findings.length} class strings draw a locked look of their own:\n\n${findings.join("\n")}\n\n${LOCKED_LOOK_ADVICE}`,
      );
    }

    expect(findings).toEqual([]);
  });
});
