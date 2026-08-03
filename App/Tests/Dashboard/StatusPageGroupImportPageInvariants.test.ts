import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The import modal and the Groups page are React components, and the App
 * suite runs in a plain Node environment with no renderer — so the defects
 * pinned below, which all live in a prop or a conditional rather than in
 * extractable logic, are pinned by reading the sources, the same way
 * NetworkSitePageInvariants.test.ts pins the Network Sites import.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line
 * cannot turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

/*
 * The same source with its comments removed. Assertions about what the code
 * DOES have to read the code, not the commentary — a comment naming the very
 * thing a test asserts is absent would otherwise fail it.
 */
function readCode(...relativeParts: Array<string>): string {
  const raw: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativeParts),
    "utf8",
  );
  return squash(
    raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "),
  );
}

const MODAL: Array<string> = [
  "Components",
  "StatusPage",
  "ImportGroupsFromCsvModal.tsx",
];
const GROUPS_PAGE: Array<string> = [
  "Pages",
  "StatusPages",
  "View",
  "Groups.tsx",
];

describe("the Groups table owns the CSV import", () => {
  const source: string = readSource(...GROUPS_PAGE);

  test("the table offers an Import from CSV card button", () => {
    expect(source).toContain(squash('title: "Import from CSV",'));
    expect(source).toContain("setShowImportModal(true);");
  });

  /*
   * BaseModelTable promotes the first NORMAL/PRIMARY-styled button to the
   * header slot and hides the rest behind the ⋯ menu. An OUTLINE style is
   * what keeps this one in the overflow, next to Refresh and Filter, instead
   * of competing with "Create Status Page Group".
   */
  test("it is styled so it stays in the overflow menu", () => {
    const buttonBlock: string = source
      .split('title: "Import from CSV",')[1]!
      .split("} as CardButtonSchema")[0]!;
    expect(buttonBlock).toContain("buttonStyle: ButtonStyleType.OUTLINE,");
    expect(buttonBlock).not.toContain("ButtonStyleType.NORMAL");
    expect(buttonBlock).not.toContain("ButtonStyleType.PRIMARY");
  });

  test("the modal is rendered from the page", () => {
    expect(source).toContain("<ImportGroupsFromCsvModal");
    expect(source).toContain("setShowImportModal(false);");
  });

  /*
   * A group belongs to one status page and one project, and the modal has no
   * route of its own to read them from. Handing them down is what keeps an
   * imported group on the page the user is actually looking at.
   */
  test("the modal is told which status page and project to import into", () => {
    expect(source).toContain("statusPageId={modelId}");
    expect(source).toContain("projectId={ProjectUtil.getCurrentProjectId()!}");
  });

  /*
   * The import creates rows the table is already showing a page of. Without
   * the toggle reaching it, the user closes the modal onto a table that does
   * not contain what they just imported.
   */
  test("a completed import refreshes the table behind the modal", () => {
    const completeBody: string = source
      .split("onImportComplete={() => {")[1]!
      .split("}}")[0]!;
    expect(completeBody).toContain("setRefreshToggle(Date.now().toString());");
    expect(source).toContain(
      squash(
        "<ModelTable<StatusPageGroup> modelType={StatusPageGroup} refreshToggle={refreshToggle}",
      ),
    );
  });
});

describe("the import modal disarms a stale parse", () => {
  const source: string = readSource(...MODAL);

  /*
   * importGroups() runs off parseResult, never off the textarea's current
   * text. Editing the CSV after previewing would therefore import the
   * pre-edit rows — a typo "fixed" in the box still persisted.
   */
  test("typing in the textarea drops the previous parse", () => {
    const onChangeBody: string = source
      .split("onChange={(value: string) => {")[1]!
      .split("}}")[0]!;
    expect(onChangeBody).toContain("setCsvText(value);");
    expect(onChangeBody).toContain("setParseResult(null);");
    expect(onChangeBody).toContain("setRowResults([]);");
  });

  test("the Import button is still gated on a live parse", () => {
    expect(source).toContain(
      squash(
        "const canImport: boolean = Boolean( parseResult && rows.length > 0 && parseErrors.length === 0, );",
      ),
    );
    expect(source).toContain("(!hasImported && !canImport)");
  });

  /*
   * A second press of a still-armed Import would replay the whole file
   * against a status page that already contains most of it — every created
   * row coming back as a duplicate-name failure.
   */
  test("a finished run turns the submit button into Done", () => {
    expect(source).toContain("setHasImported(true);");
    expect(source).toContain(squash('hasImported ? "Done"'));
    expect(source).toContain(
      squash("if (hasImported) { props.onClose(); return; }"),
    );
  });

  // Closing mid-run would leave the create loop writing into an unmounted tree.
  test("the modal cannot be dismissed while the import is running", () => {
    expect(source).toContain(
      squash(
        "onClose={() => { if (isImporting) { return; } props.onClose(); }}",
      ),
    );
  });
});

/*
 * StatusPageGroupCsv.test.ts proves STATUS_PAGE_GROUP_CSV_EXAMPLE parses
 * cleanly. That guarantee is only worth something if the file the user is
 * actually handed — and the placeholder they read — is that same constant,
 * rather than a second copy that drifts from it.
 */
describe("the template the modal hands out is the tested example", () => {
  const code: string = readCode(...MODAL);

  test("the download and the placeholder both come from the shared constant", () => {
    expect(code).toContain("placeholder={STATUS_PAGE_GROUP_CSV_EXAMPLE}");
    expect(code).toContain(
      squash(
        'content: `${STATUS_PAGE_GROUP_CSV_EXAMPLE}\\n`, filename: "status-page-groups-template.csv",',
      ),
    );
  });

  test("the modal defines no example CSV of its own", () => {
    expect(code).not.toContain("const EXAMPLE_CSV");
  });
});

describe("the import modal reads the status page at import time", () => {
  const code: string = readCode(...MODAL);

  /*
   * The existing groups are what parent references resolve against, what a
   * duplicate name is checked against, and where the nesting depths come
   * from. Fetching them when the modal MOUNTS would make a group the user
   * created from the table a moment earlier invisible to the import — so the
   * fetch belongs inside the run, and the modal must not carry a mount-time
   * effect for it.
   */
  test("existing groups are fetched inside the import, not on mount", () => {
    const importBody: string = code
      .split("const importGroups: PromiseVoidFunction")[1]!
      .split("const rows: Array<ParsedStatusPageGroupRow>")[0]!;
    expect(importBody).toContain("ModelAPI.getList<StatusPageGroup>({");
    expect(code).not.toContain("useEffect(");
  });

  /*
   * Groups are unique per status page, not per project. A query that forgot
   * the statusPageId would resolve parents from a different status page and
   * refuse names that are free on this one.
   */
  test("the query is scoped to this status page and project", () => {
    const query: string = code
      .split("ModelAPI.getList<StatusPageGroup>({")[1]!
      .split("});")[0]!;
    expect(query).toContain("statusPageId: props.statusPageId,");
    expect(query).toContain("projectId: props.projectId,");
    // parentStatusPageGroupId is what the depth walk needs.
    expect(query).toContain("parentStatusPageGroupId: true,");
  });

  test("depth comes from the shared group tree util", () => {
    expect(code).toContain(
      squash(
        "depth: StatusPageGroupTreeUtil.getDepth({ statusPageGroup: group, statusPageGroups: existing.data, }),",
      ),
    );
  });
});

describe("the import modal writes only what the file says", () => {
  const code: string = readCode(...MODAL);

  const createBody: string = code
    .split("const createGroup: CreateStatusPageGroupFunction")[1]!
    .split("const importGroups:")[0]!;

  /*
   * StatusPageGroupService assigns the next `order` on create and renumbers
   * the siblings around it. Sending an order of our own would shuffle the
   * groups that were already on the page.
   */
  test("order is never written", () => {
    expect(createBody).not.toContain("group.order");
  });

  /*
   * A blank cell means "use the default". Writing the parser's `undefined`
   * as a value would send an explicit null and override the column default —
   * which is how an import silently collapses every group on a page whose
   * author only filled in the name column.
   */
  test.each([
    ["isExpandedByDefault"],
    ["showCurrentStatus"],
    ["showUptimePercent"],
    ["uptimePercentPrecision"],
    ["viewMode"],
  ])("%s is only written when the row supplies it", (field: string) => {
    expect(createBody).toContain(
      squash(
        `if (row.${field} !== undefined) { group.${field} = row.${field}; }`,
      ),
    );
  });

  test("description is only written when it is not blank", () => {
    expect(createBody).toContain(
      squash(
        'if (row.description !== "") { group.description = row.description; }',
      ),
    );
  });

  /*
   * Nothing renders the axis columns on a List group. The parser already
   * refuses a row that fills them in without Grid, and this is the second
   * half of the same rule: even a Grid-shaped leftover cannot reach a group
   * that is not a grid.
   */
  test("axis fields are written only for a Grid group", () => {
    expect(createBody).toContain(
      squash("if (row.viewMode === StatusPageGroupViewMode.Grid) {"),
    );

    const gridBlock: string = createBody
      .split("if (row.viewMode === StatusPageGroupViewMode.Grid) {")[1]!
      .split("const response:")[0]!;

    for (const field of [
      "rowAxisLabel",
      "rowAxisValues",
      "columnAxisLabel",
      "columnAxisValues",
    ]) {
      expect(gridBlock).toContain(`group.${field} = row.${field};`);
      // ...and nowhere else.
      expect(createBody.split(`group.${field} =`).length - 1).toBe(1);
    }
  });

  /*
   * The parent id comes from the runner, which has already created the
   * parent. Reading it off the row's parentName here instead would send a
   * name where the API wants an id.
   */
  test("the parent is set from the id the runner resolved", () => {
    expect(createBody).toContain(
      squash(
        "if (parentStatusPageGroupId) { group.parentStatusPageGroupId = new ObjectID(parentStatusPageGroupId); }",
      ),
    );
    expect(createBody).not.toContain("row.parentName");
  });
});
