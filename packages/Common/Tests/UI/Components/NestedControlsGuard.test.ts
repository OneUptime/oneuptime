// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  ComponentControlIndex,
  ComponentControlKind,
  NestedControlInSource,
  RowWithoutNameLink,
  nestingKey,
  scanNestedControls,
  scanRowsWithControlsWithoutName,
} from "../../Helpers/NestedControlsScan";

/*
 * No control is drawn inside another control. See Tests/Helpers/
 * NestedControlsScan.ts for what is read and why, and Tests/Helpers/
 * NestedControls.ts for the same rule over a rendered DOM.
 *
 * Every module is read first, so a component is known for what its own
 * source draws (#10015): an (i) (InfoTooltip) and the attention pills are
 * buttons, AppLink is a link around what it is given, and a ResourcePartRow
 * handed `to` is the row's link unless it holds controls of its own. The
 * OpenStack Regions card drew a region's (i) inside its whole-row link, and
 * the guard, which knew a short list of shared components, never saw it
 * (#9728). A row with controls of its own links its name: that half of
 * ResourcePartRowControlsGuard folded in here too.
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
  "packages/Common/UI/Components/Navbar/NavBarMenuModal.tsx": {
    nestings: ["div[role=option] > Link", "div[role=option] > button"],
    reason:
      "The products menu is a listbox the search box drives (arrow keys, Enter opens the active product). Each option wraps a real link so a pointer can open a product in a new tab; the keyboard never needs the link. A card's pin (#6814) is a pointer shortcut too (tabIndex -1): the keyboard pins a product with Pin beside its page's title.",
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
  index: ComponentControlIndex;
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

  const modules: Array<{ file: string; sourceText: string }> = files.map(
    (file: string): { file: string; sourceText: string } => {
      return {
        file: relative(file),
        sourceText: fs.readFileSync(file, "utf8"),
      };
    },
  );
  // What every component is, from its own source, before any file is scanned.
  const index: ComponentControlIndex = new ComponentControlIndex(modules);

  const nestings: Array<NestedControlInSource> = [];

  for (const module of modules) {
    nestings.push(...scanNestedControls(module.file, module.sourceText, index));
  }

  cachedScan = { files, nestings, index };

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
      // The project's scan reads Button's own source, and knows it draws its title inside.
      "a control passed in an attribute of a button component whose source it has not read",
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

/*
 * A component that is a control, learned from its own source (#10015). The
 * modules below are the shapes of the real ones: an (i) is the shared
 * Tooltip around a <button>; an attention pill a <button> in a fragment
 * beside its dialog; a health pill a plain Pill when Healthy and an
 * attention pill otherwise; AppLink a router link around what it is given;
 * ResourcePartRow a link only with `to` and without `hasControls`.
 */
describe("the detector, for components that are controls", () => {
  const COMPONENTS: Array<{ file: string; sourceText: string }> = [
    {
      file: "packages/Common/UI/Components/Tooltip/Tooltip.tsx",
      sourceText: [
        'import React from "react";',
        'import Tippy from "@tippyjs/react";',
        "const Tooltip = (props) => {",
        "  return <Tippy content={props.text}>{props.children}</Tippy>;",
        "};",
        "export default Tooltip;",
      ].join("\n"),
    },
    {
      file: "packages/Common/UI/Components/Tooltip/InfoTooltip.tsx",
      sourceText: [
        'import React from "react";',
        'import Tooltip from "./Tooltip";',
        "const InfoTooltip = (props) => {",
        "  if (!props.text) {",
        "    return <></>;",
        "  }",
        "  return (",
        "    <Tooltip text={props.text}>",
        '      <button type="button" aria-label={props.label} />',
        "    </Tooltip>",
        "  );",
        "};",
        "export default InfoTooltip;",
      ].join("\n"),
    },
    {
      file: "packages/Common/UI/Components/Pill/Pill.tsx",
      sourceText: [
        'import React from "react";',
        "const Pill = (props) => {",
        "  return <span className='pill'>{props.text}</span>;",
        "};",
        "export default Pill;",
      ].join("\n"),
    },
    {
      file: "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionPill.tsx",
      sourceText: [
        'import React, { useState } from "react";',
        'import ResourceAttentionDialog from "./ResourceAttentionDialog";',
        "const ResourceAttentionPill = (props) => {",
        "  const [isOpen, setIsOpen] = useState(false);",
        "  return (",
        "    <>",
        '      <button type="button" onClick={() => { setIsOpen(true); }}>',
        "        <span>{props.label}</span>",
        "      </button>",
        "      {isOpen ? <ResourceAttentionDialog /> : <></>}",
        "    </>",
        "  );",
        "};",
        "export default ResourceAttentionPill;",
      ].join("\n"),
    },
    {
      file: "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceHealthPill.tsx",
      sourceText: [
        'import React from "react";',
        'import Pill from "Common/UI/Components/Pill/Pill";',
        'import ResourceAttentionPill from "./ResourceAttentionPill";',
        "const ResourceHealthPill = (props) => {",
        '  if (props.health === "Healthy") {',
        '    return <Pill text="Healthy" />;',
        "  }",
        "  return <ResourceAttentionPill label={props.health} />;",
        "};",
        "export default ResourceHealthPill;",
      ].join("\n"),
    },
    {
      file: "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartRow.tsx",
      sourceText: [
        'import React, { createContext, useContext } from "react";',
        'import Link from "Common/UI/Components/Link/Link";',
        "const RowRouteContext = createContext(null);",
        "const ResourcePartRow = (props) => {",
        "  if (!props.to) {",
        "    return <div>{props.children}</div>;",
        "  }",
        "  if (props.hasControls) {",
        "    return (",
        "      <RowRouteContext.Provider value={props.to}>",
        "        <div className='relative'>{props.children}</div>",
        "      </RowRouteContext.Provider>",
        "    );",
        "  }",
        "  return <Link to={props.to}>{props.children}</Link>;",
        "};",
        "export const ResourcePartRowName = (props) => {",
        "  const to = useContext(RowRouteContext);",
        "  if (!to) {",
        "    return <span>{props.children}</span>;",
        "  }",
        "  return <Link to={to}>{props.children}</Link>;",
        "};",
        "export const ResourcePartRowControls = (props) => {",
        "  return <span className='relative'>{props.children}</span>;",
        "};",
        "export default ResourcePartRow;",
      ].join("\n"),
    },
    {
      file: "packages/App/FeatureSet/Dashboard/src/Components/AppLink/AppLink.tsx",
      sourceText: [
        'import React from "react";',
        'import { Link } from "react-router-dom";',
        "const ReactDomLink = (props) => {",
        "  let children;",
        '  if (typeof props.children === "string") {',
        "    children = <span>{props.children}</span>;",
        "  } else {",
        "    children = props.children;",
        "  }",
        "  return <Link to={props.to}>{children}</Link>;",
        "};",
        "export default ReactDomLink;",
      ].join("\n"),
    },
    {
      // A tile that is one button and draws the title it is handed inside it.
      file: "packages/App/FeatureSet/Dashboard/src/Components/Example/ClickableTile.tsx",
      sourceText: [
        'import React from "react";',
        "const ClickableTile = ({ title, figure, onClick }) => {",
        "  const words = title || figure;",
        "  return (",
        '    <button type="button" onClick={onClick} aria-label={figure}>',
        "      <span>{words}</span>",
        "    </button>",
        "  );",
        "};",
        "export default ClickableTile;",
      ].join("\n"),
    },
  ];

  const PAGE_IMPORTS: string = [
    'import React from "react";',
    'import Button from "Common/UI/Components/Button/Button";',
    'import Link from "Common/UI/Components/Link/Link";',
    'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    'import ResourceAttentionPill from "../../Components/ResourcePart/ResourceAttentionPill";',
    'import ResourceHealthPill from "../../Components/ResourcePart/ResourceHealthPill";',
    "import ResourcePartRow, {",
    "  ResourcePartRowControls,",
    "  ResourcePartRowName,",
    '} from "../../Components/ResourcePart/ResourcePartRow";',
    'import AppLink from "../../Components/AppLink/AppLink";',
    'import ClickableTile from "../../Components/Example/ClickableTile";',
  ].join("\n");

  const PAGE_FILE: string =
    "packages/App/FeatureSet/Dashboard/src/Pages/Example/Index.tsx";

  function scanPage(jsx: string, before: string = ""): Array<string> {
    const sourceText: string = `${PAGE_IMPORTS}\n${before}\nexport const X = () => (\n${jsx}\n);\n`;
    const index: ComponentControlIndex = new ComponentControlIndex([
      ...COMPONENTS,
      { file: PAGE_FILE, sourceText: sourceText },
    ]);
    return scanNestedControls(PAGE_FILE, sourceText, index).map(nestingKey);
  }

  test("learns each one from its own source, through the modules it imports", () => {
    const index: ComponentControlIndex = new ComponentControlIndex(COMPONENTS);
    const kindOf: (file: string, name?: string) => unknown = (
      file: string,
      name: string = "default",
    ): unknown => {
      return index.getKindOfExport(
        COMPONENTS.find((component: { file: string }): boolean => {
          return component.file.endsWith(file);
        })!.file,
        name,
      );
    };

    expect({
      infoTooltip: kindOf("InfoTooltip.tsx"),
      tooltip: kindOf("Tooltip/Tooltip.tsx"),
      pill: kindOf("Pill.tsx"),
      attentionPill: kindOf("ResourceAttentionPill.tsx"),
      healthPill: kindOf("ResourceHealthPill.tsx"),
      rowName: kindOf("ResourcePartRow.tsx", "ResourcePartRowName"),
      rowControls: kindOf("ResourcePartRow.tsx", "ResourcePartRowControls"),
      appLink: kindOf("AppLink.tsx"),
      tile: kindOf("ClickableTile.tsx"),
    }).toEqual({
      infoTooltip: ComponentControlKind.SingleControl,
      // Draws what it is handed, and nothing of its own.
      tooltip: null,
      pill: null,
      attentionPill: ComponentControlKind.SingleControl,
      healthPill: ComponentControlKind.SingleControl,
      rowName: ComponentControlKind.SingleControl,
      rowControls: null,
      appLink: ComponentControlKind.SingleControl,
      tile: ComponentControlKind.SingleControl,
    });
  });

  interface FlaggedCase {
    name: string;
    jsx: string;
    expected: Array<string>;
    // What the page defines before it draws the element, when anything.
    before: string;
  }

  test.each<FlaggedCase>([
    {
      name: "an (i) in a link (the Regions card's health)",
      jsx: '<Link to={route}>RegionTwo<InfoTooltip label="Region health" text={text} /></Link>',
      expected: ["Link > InfoTooltip"],
      before: "",
    },
    {
      name: "a health pill in a row that is one link",
      jsx: '<ResourcePartRow to={route}><span>RegionTwo</span><ResourceHealthPill health="Degraded" /></ResourcePartRow>',
      expected: ["ResourcePartRow > ResourceHealthPill"],
      before: "",
    },
    {
      name: "an (i) in a row that is one link, written bare",
      jsx: '<ResourcePartRow to={route} hasControls={false}><InfoTooltip label="Health" text={text} /></ResourcePartRow>',
      expected: ["ResourcePartRow > InfoTooltip"],
      before: "",
    },
    {
      name: "an attention pill in a button",
      jsx: '<button type="button"><ResourceAttentionPill label="3 failed" /></button>',
      expected: ["button > ResourceAttentionPill"],
      before: "",
    },
    {
      name: "a shared Button in an AppLink",
      jsx: '<AppLink to={route}><Button title="Open" /></AppLink>',
      expected: ["AppLink > Button"],
      before: "",
    },
    {
      name: "an (i) handed in the title a tile draws inside its button",
      jsx: '<ClickableTile figure="12" title={<span>CPU <InfoTooltip label="CPU" text={text} /></span>} />',
      expected: ["ClickableTile > InfoTooltip"],
      before: "",
    },
    {
      name: "an (i) in a link a module keeps to itself",
      jsx: '<Line to={route}>RegionTwo<InfoTooltip label="Region health" text={text} /></Line>',
      expected: ["Line > InfoTooltip"],
      before:
        "const Line = (props) => { return <Link to={props.to}>{props.children}</Link>; };",
    },
  ])("flags $name", (flagged: FlaggedCase) => {
    expect(scanPage(flagged.jsx, flagged.before)).toEqual(flagged.expected);
  });

  test.each([
    [
      "a row with controls of its own: the name is the link, the pill beside it (the fix)",
      [
        "<ResourcePartRow to={route} hasControls={true}>",
        "  <ResourcePartRowName>RegionTwo</ResourcePartRowName>",
        "  <ResourcePartRowControls>",
        '    <ResourceHealthPill health="Degraded" />',
        '    <InfoTooltip label="Region health" text={text} />',
        "  </ResourcePartRowControls>",
        "</ResourcePartRow>",
      ].join("\n"),
    ],
    [
      "a row with no page to open, holding a pill",
      '<ResourcePartRow><ResourceHealthPill health="Degraded" /></ResourcePartRow>',
    ],
    [
      "an (i) beside a link",
      '<span><Link to={route}>RegionTwo</Link><InfoTooltip label="Region health" text={text} /></span>',
    ],
    [
      "an (i) handed to a tile in a prop it does not draw inside its button",
      '<ClickableTile figure="12" onClick={open} footer={<InfoTooltip label="CPU" text={text} />} />',
    ],
    [
      "a plain pill in a link",
      '<Link to={route}><Pill text="Healthy" /></Link>',
    ],
  ])("lets through %s", (_name: string, jsx: string) => {
    expect(scanPage(jsx)).toEqual([]);
  });
});

/*
 * A row with controls of its own links its name (#9728): a ResourcePartRow
 * handed `to` and `hasControls` draws no link of its own, so its name
 * (ResourcePartRowName) is the link, stretched over the row. One that draws
 * no name opens nothing at all. ResourcePartRowControlsGuard said this until
 * it folded into this guard (#10015).
 */
describe("the detector, for a row with controls of its own", () => {
  const ROW_IMPORTS: string = [
    'import React from "react";',
    "import ResourcePartRow, {",
    "  ResourcePartRowControls,",
    "  ResourcePartRowName,",
    '} from "../ResourcePart/ResourcePartRow";',
  ].join("\n");

  function rowsWithoutName(jsx: string): Array<number> {
    return scanRowsWithControlsWithoutName(
      "Example.tsx",
      `${ROW_IMPORTS}\nexport const X = () => (\n${jsx}\n);\n`,
    ).map((row: RowWithoutNameLink): number => {
      return row.line;
    });
  }

  test("a row with controls of its own and no name to link is a finding, at its line", () => {
    expect(
      rowsWithoutName(
        [
          "<ResourcePartRow to={route} hasControls={true}>",
          "  <span>RegionTwo</span>",
          "</ResourcePartRow>",
        ].join("\n"),
      ),
    ).toEqual([ROW_IMPORTS.split("\n").length + 2]);
  });

  test.each([
    [
      "a row that links its name, its controls beside it",
      "<ResourcePartRow to={route} hasControls={true}><ResourcePartRowName>RegionTwo</ResourcePartRowName><ResourcePartRowControls><span /></ResourcePartRowControls></ResourcePartRow>",
    ],
    [
      "a row whose name is nested deeper",
      "<ResourcePartRow to={route} hasControls><div><ResourcePartRowName>RegionTwo</ResourcePartRowName></div></ResourcePartRow>",
    ],
    [
      "a whole-row link",
      "<ResourcePartRow to={route}><span>RegionTwo</span></ResourcePartRow>",
    ],
    [
      "a row with no page to open",
      "<ResourcePartRow hasControls={true}><span>RegionTwo</span></ResourcePartRow>",
    ],
  ])("is no finding: %s", (_name: string, jsx: string) => {
    expect(rowsWithoutName(jsx)).toEqual([]);
  });
});

describe("controls across the project", () => {
  /*
   * Planted beside the real components, the nestings the guard used to miss
   * fail it: the Regions card as it was before #9728 (a whole-row link
   * around a region's (i)), a health pill in that row, and an attention
   * pill in an AppLink. Read against the project's own index, so each
   * component is what its own source says it is.
   */
  test("the guard fails the old Regions card, and the other nestings it used to miss, beside the real components", () => {
    const index: ComponentControlIndex = scanProject().index;
    const planted: string = [
      'import React from "react";',
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
      'import ResourcePartRow from "../ResourcePart/ResourcePartRow";',
      'import ResourceHealthPill from "../ResourcePart/ResourceHealthPill";',
      'import ResourceAttentionPill from "../ResourcePart/ResourceAttentionPill";',
      'import AppLink from "../AppLink/AppLink";',
      "export const OldRegionRow = (props) => (",
      '  <ResourcePartRow to={props.route} className="flex items-start gap-3">',
      '    <span className="text-sm font-medium">{props.regionName}</span>',
      '    <span className="inline-flex items-center gap-1">',
      '      <span className="rounded-full">{props.healthWord}</span>',
      '      <InfoTooltip label="Region health" text={props.healthText} />',
      "    </span>",
      "  </ResourcePartRow>",
      ");",
      "export const OtherRows = (props) => (",
      "  <div>",
      "    <ResourcePartRow to={props.route}>",
      "      <span>{props.regionName}</span>",
      '      <ResourceHealthPill health={props.health} isConnected={true} items={[]} testId="pill" words={props.words} />',
      "    </ResourcePartRow>",
      "    <AppLink to={props.route}>",
      '      <ResourceAttentionPill label="3 failed" tone="danger" testId="pill" hint="Show which" dialog={props.dialog} />',
      "    </AppLink>",
      "  </div>",
      ");",
    ].join("\n");

    expect(
      scanNestedControls(
        "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/PlantedOldRegionsCard.tsx",
        planted,
        index,
      ).map(nestingKey),
    ).toEqual([
      "ResourcePartRow > InfoTooltip",
      "ResourcePartRow > ResourceHealthPill",
      "AppLink > ResourceAttentionPill",
    ]);
  });

  test("every row with controls of its own links its name", () => {
    const findings: Array<string> = [];
    for (const file of scanProject().files) {
      const source: string = fs.readFileSync(file, "utf8");
      if (!source.includes("<ResourcePartRow")) {
        continue;
      }
      for (const row of scanRowsWithControlsWithoutName(
        relative(file),
        source,
      )) {
        findings.push(`${row.file}:${row.line}`);
      }
    }
    expect(findings).toEqual([]);
  });

  test("the Regions card is a row with controls of its own: its name the link, its pill and (i) beside it", () => {
    const card: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRegionsCard.tsx",
      ),
      "utf8",
    );
    expect(card).toContain("hasControls={true}");
    expect(card).toContain("<ResourcePartRowName");
    expect(card).toContain("<ResourcePartRowControls");
  });

  /*
   * The components the guard never saw (#10015): an (i) and the attention
   * pills draw a button, AppLink a link around what it is given, and a
   * health pill draws an attention pill. Each is learned from its own source.
   */
  test("the scan learns which components are controls from their own source", () => {
    const index: ComponentControlIndex = scanProject().index;

    expect({
      infoTooltip: index.getKindOfExport(
        "packages/Common/UI/Components/Tooltip/InfoTooltip.tsx",
        "default",
      ),
      attentionPill: index.getKindOfExport(
        "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionPill.tsx",
        "default",
      ),
      healthPill: index.getKindOfExport(
        "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceHealthPill.tsx",
        "default",
      ),
      appLink: index.getKindOfExport(
        "packages/App/FeatureSet/Dashboard/src/Components/AppLink/AppLink.tsx",
        "default",
      ),
      rowName: index.getKindOfExport(
        "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartRow.tsx",
        "ResourcePartRowName",
      ),
      rowControls: index.getKindOfExport(
        "packages/App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartRow.tsx",
        "ResourcePartRowControls",
      ),
      card: index.getKindOfExport(
        "packages/Common/UI/Components/Card/Card.tsx",
        "default",
      ),
    }).toEqual({
      infoTooltip: ComponentControlKind.SingleControl,
      attentionPill: ComponentControlKind.SingleControl,
      healthPill: ComponentControlKind.SingleControl,
      appLink: ComponentControlKind.SingleControl,
      rowName: ComponentControlKind.SingleControl,
      // A box beside the name, and a card, are no control themselves.
      rowControls: null,
      card: null,
    });
  });

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

  /*
   * The ones taken apart when the rule came in: the dropdown's Clear button,
   * the filter chips' clear "x", the note template list, the monitor criteria
   * and runbook step headers, and the replay timeline's notice markers. None
   * may come back as an exception.
   */
  test("the controls this rule was written for stay apart", () => {
    const files: Array<string> = [
      "packages/Common/UI/Components/EntityDropdown/EntityDropdown.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipButton.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipValueInput.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDateRange.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/NoteTemplateMenu.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeline.tsx",
      // A region's health pill and (i) sat inside its whole-row link (#9728).
      "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRegionsCard.tsx",
    ];

    for (const file of files) {
      expect(DELIBERATE_NESTINGS[file]).toBeUndefined();
      expect(
        scanNestedControls(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
          // Each component as its own source says it is.
          scanProject().index,
        ).map(nestingKey),
      ).toEqual([]);
    }
  });
});
