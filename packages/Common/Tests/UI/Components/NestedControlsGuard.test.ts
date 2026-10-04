import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  NestedControlInSource,
  nestingKey,
  scanNestedControls,
} from "../../Helpers/NestedControlsScan";

/*
 * No control is drawn inside another control. See Tests/Helpers/
 * NestedControlsScan.ts for what is read and why, and Tests/Helpers/
 * NestedControls.ts for the same rule over a rendered DOM.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

/*
 * The nestings kept on purpose, by file, each with its reason. A control a
 * person can only reach this way is never one of them: each has another way
 * in from the keyboard. A new nesting fails the guard until it is taken
 * apart or listed here; an entry whose nesting is gone fails it too, so the
 * list cannot outlive what it excuses.
 */
const DELIBERATE_NESTINGS: Record<
  string,
  { nestings: Array<string>; reason: string }
> = {
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeline.tsx":
    {
      nestings: ["div[role=slider] > button"],
      reason:
        "The replay's notice markers are pinned to the slider track at the moment they mark. A screen reader works the slider with its arrow keys, and the same notices are rows in the rail beside the player, selectable there.",
    },
  "packages/Common/UI/Components/Navbar/NavBarMenuModal.tsx": {
    nestings: ["div[role=option] > Link"],
    reason:
      "The products menu is a listbox the search box drives (arrow keys, Enter opens the active product). Each option wraps a real link so a pointer can open a product in a new tab; the keyboard never needs the link.",
  },
  "packages/Common/UI/Components/Workflow/ValuePicker/ValuePickerMenu.tsx": {
    nestings: ["div[role=option] > button"],
    reason:
      "The workflow value picker is a listbox its search box drives. The small 'Use a field inside' arrow is a pointer shortcut (tabIndex -1) for ArrowRight on the active option, which does the same.",
  },
};

interface ProjectScan {
  files: Array<string>;
  nestings: Array<NestedControlInSource>;
}

let cachedScan: ProjectScan | null = null;

function scanProject(): ProjectScan {
  if (cachedScan) {
    return cachedScan;
  }

  const files: Array<string> = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    });

  const nestings: Array<NestedControlInSource> = [];

  for (const file of files) {
    nestings.push(
      ...scanNestedControls(relative(file), fs.readFileSync(file, "utf8")),
    );
  }

  cachedScan = { files, nestings };

  return cachedScan;
}

function isDeliberate(nesting: NestedControlInSource): boolean {
  return Boolean(
    DELIBERATE_NESTINGS[nesting.file]?.nestings.includes(nestingKey(nesting)),
  );
}

describe("the detector", () => {
  const IMPORTS: string = [
    'import React from "react";',
    'import Button from "Common/UI/Components/Button/Button";',
    'import Link from "Common/UI/Components/Link/Link";',
    'import Toggle from "Common/UI/Components/Toggle/Toggle";',
    'import { NavLink } from "react-router-dom";',
    'import { createPortal } from "react-dom";',
  ].join("\n");

  function scan(jsx: string): Array<string> {
    return scanNestedControls(
      "Example.tsx",
      `${IMPORTS}\nexport const X = () => (\n${jsx}\n);\n`,
    ).map(nestingKey);
  }

  test.each([
    [
      "a button in a button (the dropdown's Clear button)",
      '<button type="button">Members<button aria-label="Clear">x</button></button>',
      "button > button",
    ],
    [
      "a span acting as a button in a button (the filter chip's clear)",
      '<button>Status<span role="button" tabIndex={0}>x</span></button>',
      "button > span[role=button]",
    ],
    [
      "a shared Button in a role=button header (the runbook step)",
      '<div role="button" tabIndex={0}>Step 1<Button title="Delete" /></div>',
      "div[role=button] > Button",
    ],
    [
      "a drag handle in a role=button header",
      '<div role="button"><div {...provided.dragHandleProps}>grip</div></div>',
      "div[role=button] > div",
    ],
    [
      "a button in an option",
      '<ul role="listbox"><li role="option"><button>Use it</button></li></ul>',
      "li[role=option] > button",
    ],
    [
      "a link in a link",
      '<a href="/a">Open <Link to={route}>details</Link></a>',
      "a > Link",
    ],
    [
      "an input in a shared Button",
      "<Button><input /></Button>",
      "Button > input",
    ],
    [
      "a switch in a router link",
      "<NavLink to={x}><Toggle value={on} onChange={setOn} /></NavLink>",
      "NavLink > Toggle",
    ],
    [
      "an element made focusable at run time, in a tab",
      '<div role="tab"><span tabIndex={isOpen ? 0 : -1}>x</span></div>',
      "div[role=tab] > span",
    ],
    [
      "a control in a list mapped inside a button",
      "<button>{items.map((item) => { return <a key={item} href={item}>{item}</a>; })}</button>",
      "button > a",
    ],
  ])("flags %s", (_name: string, jsx: string, expected: string) => {
    expect(scan(jsx)).toEqual([expected]);
  });

  test.each([
    [
      "two buttons side by side (the fix)",
      '<div className="relative"><button>Members</button><button aria-label="Clear">x</button></div>',
    ],
    [
      "a chip's remove button in a span",
      '<span className="chip">Members<button aria-label="Remove Members">x</button></span>',
    ],
    [
      "icons, text and a hidden placeholder inside a button",
      '<button><span aria-hidden="true" className="h-4 w-4" /><svg /><span>Members</span></button>',
    ],
    [
      "an element only focusable from script, in an option",
      '<div role="option"><span tabIndex={-1}>x</span></div>',
    ],
    [
      "a hidden input in a button",
      '<button><input type="hidden" value="1" /></button>',
    ],
    [
      "a control passed in an attribute of a button component",
      "<Button title={<a href='/x'>x</a>} />",
    ],
    [
      "a portalled menu opened from a button",
      "<button>{open && createPortal(<div><button>Item</button></div>, document.body)}</button>",
    ],
    [
      "role=presentation on a button inside a button",
      '<button><button role="presentation">x</button></button>',
    ],
    ["a label around its input", "<label>Name <input /></label>"],
    [
      "a control inside a group that is not one control",
      '<div role="listbox"><button role="option">A</button><button role="option">B</button></div>',
    ],
    [
      "a comment or a string that only mentions a button",
      "<button>{/* <button> */}{'<button>'}</button>",
    ],
  ])("lets through %s", (_name: string, jsx: string) => {
    expect(scan(jsx)).toEqual([]);
  });

  test("reports the line of the inner control", () => {
    const found: Array<NestedControlInSource> = scanNestedControls(
      "Example.tsx",
      [
        IMPORTS,
        "export const X = () => (",
        "  <button>",
        "    Members",
        '    <button aria-label="Clear">x</button>',
        "  </button>",
        ");",
      ].join("\n"),
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.line).toBe(IMPORTS.split("\n").length + 4);
  });
});

describe("controls across the project", () => {
  test("the scan reads the shared pickers and the pages that draw them", () => {
    const files: Array<string> = scanProject().files.map(relative);

    for (const expected of [
      "packages/Common/UI/Components/EntityDropdown/EntityDropdown.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipButton.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/NoteTemplateMenu.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/App.tsx",
      "packages/App/FeatureSet/StatusPage/src/App.tsx",
    ]) {
      expect(files).toContain(expected);
    }
  });

  test("no control is drawn inside another control", () => {
    const offenders: Array<string> = scanProject()
      .nestings.filter((nesting: NestedControlInSource): boolean => {
        return !isDeliberate(nesting);
      })
      .map((nesting: NestedControlInSource): string => {
        return `${nesting.file}:${nesting.line} ${nestingKey(nesting)}`;
      });

    expect(offenders).toEqual([]);
  });

  test("every deliberate nesting is still drawn, with its reason", () => {
    const drawn: Set<string> = new Set<string>(
      scanProject().nestings.map((nesting: NestedControlInSource): string => {
        return `${nesting.file} ${nestingKey(nesting)}`;
      }),
    );

    for (const [file, entry] of Object.entries(DELIBERATE_NESTINGS)) {
      expect(entry.reason.length).toBeGreaterThan(40);

      for (const nesting of entry.nestings) {
        expect(drawn).toContain(`${file} ${nesting}`);
      }
    }
  });

  test("the shared pickers this rule was written for stay apart", () => {
    const files: Array<string> = [
      "packages/Common/UI/Components/EntityDropdown/EntityDropdown.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipButton.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipValueInput.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDateRange.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/NoteTemplateMenu.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx",
    ];

    for (const file of files) {
      expect(DELIBERATE_NESTINGS[file]).toBeUndefined();
      expect(
        scanNestedControls(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        ).map(nestingKey),
      ).toEqual([]);
    }
  });
});
