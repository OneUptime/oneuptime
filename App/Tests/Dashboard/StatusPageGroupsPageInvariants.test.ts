import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Status Page > Groups is a React page, and the App suite runs in a plain Node
 * environment with no renderer — so the invariants pinned below, which all live
 * in a prop, a query or a conditional rather than in extractable logic, are
 * pinned by reading the source, the same way
 * StatusPageGroupImportPageInvariants.test.ts pins the CSV import.
 *
 * The tree's own behaviour is not tested here and does not need to be: the
 * shape of the hierarchy is StatusPageGroupHierarchyViewUtil's (see
 * Common/Tests/Utils/StatusPage/GroupHierarchyView.test.ts) and the drawing of
 * it is GroupHierarchy's (see
 * Common/Tests/UI/Components/StatusPage/GroupHierarchy.test.tsx). What is left
 * is the wiring — which is exactly the part a rewrite of this page can silently
 * drop.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line cannot
 * turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const GROUPS_PAGE: Array<string> = [
  "Pages",
  "StatusPages",
  "View",
  "Groups.tsx",
];

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

/*
 * The source with its comments removed. Assertions about what the code DOES
 * have to read the code, not the commentary — a comment naming the very thing a
 * test asserts is absent would otherwise fail it.
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

const code: string = readCode(...GROUPS_PAGE);

function between(start: string, end: string): string {
  const afterStart: string | undefined = code.split(start)[1];

  if (afterStart === undefined) {
    throw new Error(`Groups.tsx no longer contains ${start}`);
  }

  const block: string | undefined = afterStart.split(end)[0];

  if (block === undefined) {
    throw new Error(`Groups.tsx no longer contains ${end} after ${start}`);
  }

  return block;
}

describe("the page draws a hierarchy, not a table", () => {
  /*
   * The headline change. A table can tell an operator that "Market 1001" sits
   * under "Region 1000"; it cannot show them the shape of the thing they are
   * building, which is the only question anybody has in front of a tree.
   */
  test("the groups are rendered by the shared hierarchy component", () => {
    expect(code).toContain("<GroupHierarchy");
    expect(code).toContain(
      'import GroupHierarchy from "Common/UI/Components/StatusPage/GroupHierarchy"',
    );
  });

  test("the flat ModelTable is gone", () => {
    expect(code).not.toContain("ModelTable");
    expect(code).not.toContain("enableDragAndDrop");
  });

  /*
   * The rows and the counts are decisions about a tree, and they are tested
   * without a renderer in Common. A page that worked them out inline would be a
   * second, untested implementation of the same thing.
   */
  test("the rows and the summary come from the shared util", () => {
    expect(code).toContain(
      squash(
        "const rows: Array<StatusPageGroupHierarchyRow> = StatusPageGroupHierarchyViewUtil.getRows(",
      ),
    );
    expect(code).toContain("StatusPageGroupHierarchyViewUtil.getSummary(");
  });

  test("the tree is handed the current expansion and search state", () => {
    const rowsCall: string = between(
      "StatusPageGroupHierarchyViewUtil.getRows(",
      "});",
    );

    expect(rowsCall).toContain("statusPageGroups: statusPageGroups,");
    expect(rowsCall).toContain("expandedGroupIds: expandedGroupIds,");
    expect(rowsCall).toContain("searchText: searchText,");
  });

  /*
   * Searching a hierarchy has to filter the hierarchy, not a page of it — a
   * server round trip per keystroke would also be answering a different
   * question, since a match's ancestors are what give it its place.
   */
  test("searching filters what was already fetched rather than re-querying", () => {
    const searchInput: string = between(
      'dataTestId="status-page-groups-search"',
      "/>",
    );

    expect(searchInput).toContain("setSearchText(value);");
    expect(searchInput).not.toContain("fetchGroups");
  });
});

describe("the fetch", () => {
  const listCall: string = between(
    "await ModelAPI.getList<StatusPageGroup>(",
    "});",
  );

  /*
   * Groups are unique per status page, not per project. A query missing either
   * scope would draw a hierarchy belonging to something else.
   */
  test("is scoped to this status page and project", () => {
    expect(listCall).toContain("statusPageId: modelId,");
    expect(listCall).toContain(
      "projectId: ProjectUtil.getCurrentProjectId()!,",
    );
  });

  /*
   * The tree is built client side from the whole list — a parent that was left
   * on page two would strand every group under it at the top level.
   */
  test("reads the whole hierarchy in one go, not a page of it", () => {
    expect(listCall).toContain("limit: LIMIT_PER_PROJECT,");
    expect(listCall).toContain("skip: 0,");
  });

  test("sorts by order, which is what siblings are drawn in", () => {
    expect(listCall).toContain("order: SortOrder.Ascending,");
  });

  /*
   * Every column below is drawn on a row or is needed to build the tree. A
   * missing one is not an error, it is a badge or a whole level that silently
   * stops appearing.
   */
  test.each([
    ["_id"],
    ["name"],
    ["description"],
    ["order"],
    ["parentStatusPageGroupId"],
    ["isExpandedByDefault"],
    ["showUptimePercent"],
    ["viewMode"],
  ])("selects %s, which a row draws or the tree needs", (field: string) => {
    expect(between("select: {", "},")).toContain(`${field}: true,`);
  });
});

describe("permissions", () => {
  /*
   * The table used to gate its own buttons. Nothing else does it now, so the
   * page has to — and it has to ask the model, not guess from a role.
   */
  test("are read from the model the same way the table read them", () => {
    expect(code).toContain(
      "const permissions: Array<Permission> = PermissionUtil.getAllPermissions();",
    );
    expect(code).toContain("model.hasCreatePermissions(permissions)");
    expect(code).toContain("model.hasUpdatePermissions(permissions)");
    expect(code).toContain("model.hasDeletePermissions(permissions)");
  });

  test("a master admin keeps the access they had", () => {
    expect(code).toContain(
      "const isMasterAdmin: boolean = User.isMasterAdmin()",
    );
    expect(code.split("|| isMasterAdmin;").length - 1).toBeGreaterThanOrEqual(
      3,
    );
  });

  test("the tree is told what the viewer may do", () => {
    const tree: string = between("<GroupHierarchy", "/>");

    expect(tree).toContain("isCreateable={canCreate}");
    expect(tree).toContain("isEditable={canEdit}");
    expect(tree).toContain("isDeleteable={canDelete}");
  });

  test("the create button is not drawn for someone who cannot create", () => {
    expect(
      between(
        "const buttons: Array<CardButtonSchema | ReactElement>",
        "return buttons;",
      ),
    ).toContain("if (canCreate) {");
  });
});

describe("creating a group", () => {
  /*
   * A group belongs to one status page and one project, and the form has no
   * route of its own to read them from.
   */
  test("stamps the status page and the project onto the new group", () => {
    const onBeforeCreate: string = between("onBeforeCreate={(", "onSuccess={");

    expect(onBeforeCreate).toContain("item.statusPageId = modelId;");
    expect(onBeforeCreate).toContain(
      "item.projectId = new ObjectID(props.currentProject._id);",
    );
    expect(onBeforeCreate).toContain(
      'throw new BadDataException("Project ID cannot be null");',
    );
  });

  /*
   * "Add a sub group" is the whole point of a hierarchy view. Without the
   * parent pre-filled it is just the create form with extra steps.
   */
  test("a sub group is created with its parent already chosen", () => {
    expect(code).toContain("setParentGroupIdForCreate(");
    expect(between("initialValues={", "}}")).toContain(
      "parentStatusPageGroup: parentGroupIdForCreate,",
    );
  });

  /*
   * A sub group written under a collapsed parent, refetched and then not
   * shown reads exactly like the create having failed.
   */
  test("the parent is opened so the new sub group is actually visible", () => {
    const onSuccess: string = between(
      "onSuccess={(item: StatusPageGroup)",
      "}}",
    );

    expect(onSuccess).toContain("setExpandedGroupIds(");
    expect(onSuccess).toContain("fetchGroups()");
  });

  test("editing an existing group is the same form, in update mode", () => {
    expect(code).toContain("modelIdToEdit={groupIdToEdit || undefined}");
    expect(code).toContain(
      squash(
        "formType: formMode === GroupFormMode.Create ? FormType.Create : FormType.Update,",
      ),
    );
  });
});

describe("the parent picker", () => {
  /*
   * StatusPageGroupService refuses a parent that is the group itself, one of
   * its own sub groups, or too deep to hold the subtree being moved. Offering
   * any of the three is offering a choice that is already known to fail.
   */
  test("only offers parents the API would accept", () => {
    const options: string = between(
      "StatusPageGroupHierarchyViewUtil.getParentGroupCandidates(",
      "})",
    );

    expect(options).toContain("statusPageGroups: statusPageGroups,");
    expect(options).toContain("statusPageGroupId: groupIdToEdit?.toString(),");
  });

  /*
   * Two groups can easily be called "Region 1000" at different levels, so an
   * option is only unambiguous with its whole path on it.
   */
  test("labels every option with its full path", () => {
    expect(code).toContain(
      "label: StatusPageGroupHierarchyViewUtil.getGroupPathLabel(",
    );
  });

  /*
   * The picker used to re-fetch the group list every time the form opened. The
   * page now holds that list, refetches it after every write, and the options
   * are computed from it — so a group created a moment ago is still selectable
   * without a second round trip.
   */
  test("is built from the list the page already holds", () => {
    expect(code).not.toContain("fetchDropdownOptions");
    expect(between('title: "Parent Group",', "},")).toContain(
      "dropdownOptions: getParentGroupOptions(),",
    );
  });
});

describe("reordering", () => {
  /*
   * `order` is one flat sequence across the whole status page and the service
   * renumbers everything between the two rows on every write. Inventing an
   * order here rather than targeting the neighbour's would reshuffle groups
   * nobody touched.
   */
  test("targets the neighbouring sibling's order, worked out by the shared util", () => {
    const move: string = between(
      "const moveGroup: MoveGroupFunction",
      "const deleteGroup:",
    );

    expect(move).toContain(
      "StatusPageGroupHierarchyViewUtil.getReorderTargetOrder(",
    );
    expect(move).toContain("direction: direction,");
  });

  test("writes nothing at all when there is no neighbour that way", () => {
    expect(
      between("const moveGroup: MoveGroupFunction", "setBusyGroupId("),
    ).toContain("if (targetOrder === null) { return; }");
  });

  test("writes only the order column", () => {
    const update: string = between(
      "await ModelAPI.updateById<StatusPageGroup>(",
      "});",
    );

    expect(update).toContain("data: { order: targetOrder, },");
    expect(update).not.toContain("parentStatusPageGroupId");
  });

  /*
   * Two reorders in flight at once resolve against a hierarchy neither of them
   * saw, because the service renumbers siblings on every write.
   */
  test("locks the row while its write is in flight, and unlocks it after", () => {
    const move: string = between(
      "const moveGroup: MoveGroupFunction",
      "const deleteGroup:",
    );

    expect(move).toContain("setBusyGroupId(statusPageGroupId);");
    expect(move).toContain("setBusyGroupId(null);");
    expect(code).toContain("busyGroupId={busyGroupId}");
  });

  test("the hierarchy is re-read after a move, so the new order is what is drawn", () => {
    expect(
      between("const moveGroup: MoveGroupFunction", "const deleteGroup:"),
    ).toContain("await fetchGroups();");
  });
});

describe("deleting a group", () => {
  /*
   * The cascade is at the database level: sub groups, the resources in them and
   * any monitor rules pointing at them all go. Nothing on the row says so, so
   * the confirmation has to.
   */
  test("the confirmation says what else goes with it", () => {
    const description: string = between(
      "const getDeleteDescription: GetDeleteDescriptionFunction",
      "type RenderBodyFunction",
    );

    expect(description).toContain(
      "StatusPageGroupTreeUtil.getDescendantGroups(",
    );
    expect(description).toContain("nested inside it.");
    expect(description).toContain("monitor rules");
    expect(description).toContain("This cannot be undone.");
  });

  test("it is a destructive confirmation, not a normal one", () => {
    expect(between("<ConfirmModal", "/>")).toContain(
      "submitButtonType={ButtonStyleType.DANGER}",
    );
  });

  test("the delete is by id and the hierarchy is re-read afterwards", () => {
    const deleteBody: string = between(
      "const deleteGroup: PromiseVoidFunction",
      "const getParentGroupOptions:",
    );

    expect(deleteBody).toContain("await ModelAPI.deleteItem<StatusPageGroup>(");
    expect(deleteBody).toContain("id: groupToDelete.id,");
    expect(deleteBody).toContain("await fetchGroups();");
  });

  test("a failed delete leaves the confirmation open, carrying the reason", () => {
    const deleteBody: string = between(
      "const deleteGroup: PromiseVoidFunction",
      "const getParentGroupOptions:",
    );

    expect(deleteBody).toContain(
      "setDeleteError(API.getFriendlyMessage(err));",
    );
    expect(between("<ConfirmModal", "/>")).toContain(
      "error={deleteError || undefined}",
    );
  });
});

describe("expansion state", () => {
  /*
   * The page refetches after every write. Recomputing the default expansion on
   * each of those would re-collapse the branch the operator is working in.
   */
  test("the default is applied once, not on every refetch", () => {
    const effect: string = between(
      "if (hasAppliedDefaultExpansion || statusPageGroups.length === 0)",
      "}, [statusPageGroups, hasAppliedDefaultExpansion]);",
    );

    expect(effect).toContain("return; }");
    expect(effect).toContain(
      "StatusPageGroupHierarchyViewUtil.getDefaultExpandedGroupIds(",
    );
    expect(effect).toContain("setHasAppliedDefaultExpansion(true);");
  });

  /*
   * A hierarchy that arrives fully expanded is unreadable at any real size, and
   * one that arrives fully collapsed hides the fact that it nests at all.
   */
  test("one level of children is open on arrival", () => {
    expect(code).toContain("const AUTO_EXPAND_DEPTH: number = 1;");
    expect(code).toContain("maxAutoExpandDepth: AUTO_EXPAND_DEPTH,");
  });

  test("expand all and collapse all both go through the shared util", () => {
    expect(
      between("const expandAll: VoidFunction", "const collapseAll:"),
    ).toContain("StatusPageGroupHierarchyViewUtil.getExpandableGroupIds(");
    expect(between("const collapseAll: VoidFunction", "};")).toContain(
      "setExpandedGroupIds(new Set<string>());",
    );
  });
});

describe("what the operator sees while nothing is on screen", () => {
  test("a first load shows a loader rather than an empty tree", () => {
    expect(
      between("const renderBody: RenderBodyFunction", "if (error)"),
    ).toContain(
      "if (isLoading && statusPageGroups.length === 0) { return <ComponentLoader />; }",
    );
  });

  test("a failed load says so and offers to try again", () => {
    const errorBlock: string = between("if (error) { return (", ");");

    expect(errorBlock).toContain("<ErrorMessage message={error}");
    expect(errorBlock).toContain("onRefreshClick=");
  });

  test("a status page with no groups gets an empty state, not a blank card", () => {
    expect(code).toContain('id="status-page-groups-empty"');
  });

  /*
   * An empty tree under a search box that has text in it is a different message
   * from an empty tree on a status page with no groups.
   */
  test("a search that matches nothing says so, and says what to do", () => {
    const noMatch: string = between(
      'id="status-page-groups-no-search-match"',
      "/>",
    );

    expect(noMatch).toContain("icon={IconProp.Search}");
    expect(noMatch).toContain("Clear the search");
  });
});

/*
 * The form is the one part of the old page that was worth keeping verbatim: it
 * is the whole surface of a status page group, and a field quietly dropped in
 * a rewrite is a setting an operator can no longer reach at all.
 */
describe("the group form survived the rewrite intact", () => {
  test.each([
    ["Group Details", "group-details"],
    ["Layout", "layout"],
    ["Advanced", "advanced"],
  ])("keeps the %s step", (title: string, id: string) => {
    expect(code).toContain(squash(`{ title: "${title}", id: "${id}", },`));
  });

  test.each([
    ["name"],
    ["description"],
    ["parentStatusPageGroup"],
    ["isExpandedByDefault"],
    ["viewMode"],
    ["rowAxisLabel"],
    ["rowAxisValues"],
    ["columnAxisLabel"],
    ["columnAxisValues"],
    ["showCurrentStatus"],
    ["showUptimePercent"],
    ["uptimePercentPrecision"],
  ])("keeps the %s field", (field: string) => {
    expect(code).toContain(squash(`field: { ${field}: true, },`));
  });

  test("the grid axis fields are still only shown for a grid group", () => {
    expect(
      code.split("return item.viewMode === StatusPageGroupViewMode.Grid;")
        .length - 1,
    ).toBe(4);
  });

  test("uptime precision is still only shown when uptime is published", () => {
    expect(code).toContain("return Boolean(item.showUptimePercent);");
  });
});
