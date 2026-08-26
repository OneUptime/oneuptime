import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Status Page > Resources is a React page, and the App suite runs in a plain
 * Node environment with no renderer — so the invariants pinned below, which all
 * live in a prop, a query or a conditional rather than in extractable logic,
 * are pinned by reading the source, the same way
 * StatusPageGroupImportPageInvariants.test.ts pins the CSV import.
 *
 * This page absorbed Status Page > Groups. Groups and the monitors inside them
 * were two pages joined by a "Manage Groups" button, which meant building a
 * status page was a loop of navigating between them; the hierarchy and the
 * selected group's contents are one screen now. Everything the Groups page was
 * the only place to do — create, rename, nest, reorder, delete, import from CSV
 * — had to arrive here intact, and a rewrite of this size is exactly where a
 * capability goes quietly missing.
 *
 * What the page DRAWS is not tested here and does not need to be: the shape of
 * the hierarchy is StatusPageGroupHierarchyViewUtil's and
 * StatusPageResourceExplorerUtil's (Common/Tests/Utils/StatusPage), the tree
 * itself is ResourceGroupNavigator's
 * (Common/Tests/UI/Components/StatusPage/ResourceGroupNavigator.test.tsx), and
 * the page's behaviour under a mocked API is
 * Common/Tests/App/StatusPage/StatusPageResourceExplorer.test.tsx. What is left
 * is the wiring.
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

const RESOURCES_PAGE: Array<string> = [
  "Pages",
  "StatusPages",
  "View",
  "Resources.tsx",
];

const GROUPS_ROUTE: Array<string> = [
  "Pages",
  "StatusPages",
  "View",
  "Groups.tsx",
];

const SIDE_MENU: Array<string> = [
  "Pages",
  "StatusPages",
  "View",
  "SideMenu.tsx",
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

const code: string = readCode(...RESOURCES_PAGE);

function between(start: string, end: string): string {
  const afterStart: string | undefined = code.split(start)[1];

  if (afterStart === undefined) {
    throw new Error(`Resources.tsx no longer contains ${start}`);
  }

  const block: string | undefined = afterStart.split(end)[0];

  if (block === undefined) {
    throw new Error(`Resources.tsx no longer contains ${end} after ${start}`);
  }

  return block;
}

describe("groups and their monitors are one page", () => {
  /*
   * The headline change. Two pages meant the hierarchy was built in one place
   * and filled in another, with a button in the middle whose only job was to
   * leave the page you were working on.
   */
  test("nothing on the page navigates to a groups page any more", () => {
    expect(code).not.toContain("STATUS_PAGE_VIEW_GROUPS");
    expect(code).not.toContain("Manage Groups");
  });

  test("the hierarchy is drawn by the shared navigator", () => {
    expect(code).toContain("<ResourceGroupNavigator");
    expect(code).toContain(
      'import ResourceGroupNavigator from "Common/UI/Components/StatusPage/ResourceGroupNavigator"',
    );
  });

  test("the flat ModelTable is gone from both halves", () => {
    expect(code).not.toContain("ModelTable");
    expect(code).not.toContain("enableDragAndDrop");
  });

  /*
   * Every group action the Groups page owned is reachable from a row of the
   * tree. A hierarchy you can only look at is the half of that page that did
   * not survive.
   */
  test.each([
    ["onAddSubGroup="],
    ["onEditGroup="],
    ["onDeleteGroup="],
    ["onMoveGroupUp="],
    ["onMoveGroupDown="],
    ["onShowGroupId="],
  ])("the navigator is wired for %s", (prop: string) => {
    expect(between("<ResourceGroupNavigator", "/>")).toContain(prop);
  });

  /*
   * The pane names exactly one group, so it is the other obvious place to act
   * on that group — and the only one on a touch screen, where there is no
   * hover to reveal a row's cluster.
   */
  test.each([
    ["onCreateGroup="],
    ["onEditGroup="],
    ["onAddSubGroup="],
    ["onDeleteGroup="],
  ])("the pane is wired for %s", (prop: string) => {
    expect(between("<StatusPageResourcePanel", "/>")).toContain(prop);
  });

  test("the rows and the counts come from the shared util", () => {
    expect(code).toContain("StatusPageResourceExplorerUtil.getNavigatorRows(");
    expect(code).toContain(
      "StatusPageResourceExplorerUtil.buildResourceCountIndex(",
    );
  });

  test("the tree is handed the current expansion and search state", () => {
    const rowsCall: string = between(
      "StatusPageResourceExplorerUtil.getNavigatorRows(",
      "});",
    );

    expect(rowsCall).toContain("statusPageGroups: groups,");
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
      'dataTestId="status-page-resource-group-search"',
      "/>",
    );

    expect(searchInput).toContain("setSearchText(value);");
    expect(searchInput).not.toContain("fetchGroups");
  });

  /*
   * The old page is a redirect, not a deletion: links to it exist in bookmarks,
   * in runbooks and in other people's documentation.
   */
  test("the old groups URL still lands somewhere, replacing itself in history", () => {
    const redirect: string = readCode(...GROUPS_ROUTE);

    expect(redirect).toContain("STATUS_PAGE_VIEW_RESOURCES");
    expect(redirect).toContain("<Navigate");
    expect(redirect).toContain("replace={true}");
  });

  test("the side menu offers one entry rather than two", () => {
    const sideMenu: string = readCode(...SIDE_MENU);

    expect(sideMenu).toContain("STATUS_PAGE_VIEW_RESOURCES");
    expect(sideMenu).not.toContain("STATUS_PAGE_VIEW_GROUPS");
  });

  /*
   * Monitor Rules writes resources onto this page, and it is how a group
   * filled from a label stays filled - the whole of #3418. It used to be filed
   * under Advanced, three sections below the screen its work shows up on, and
   * the person who filed that issue never found it. Somebody populating a
   * group is standing here.
   */
  test("the rules that write resources sit beside the resources", () => {
    const sideMenu: string = readCode(...SIDE_MENU);

    const resourcesSection: string | undefined = sideMenu
      .split('<SideMenuSection title="Resources">')[1]
      ?.split("</SideMenuSection>")[0];

    const advancedSection: string | undefined = sideMenu
      .split('<SideMenuSection title="Advanced">')[1]
      ?.split("</SideMenuSection>")[0];

    expect(resourcesSection).toContain("STATUS_PAGE_VIEW_MONITOR_RULES");
    expect(advancedSection).not.toContain("STATUS_PAGE_VIEW_MONITOR_RULES");
  });
});

describe("the group fetch", () => {
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
    expect(listCall).toContain("projectId: projectId,");
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
   * Every column below is drawn on a row, drawn in the pane header, or needed
   * to build the tree. A missing one is not an error, it is a badge or a whole
   * level that silently stops appearing.
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
    ["rowAxisLabel"],
    ["columnAxisLabel"],
    ["rowAxisValues"],
    ["columnAxisValues"],
  ])("selects %s, which a row draws or the tree needs", (field: string) => {
    expect(between("select: {", "},")).toContain(`${field}: true,`);
  });
});

/*
 * The counting invariant from issue #3042, at the point where it is decided.
 * The behaviour is proved against a mocked API in
 * Common/Tests/App/StatusPage/StatusPageResourceExplorer.test.tsx; what is
 * pinned here is the shape of the request that makes it affordable.
 */
describe("the count pass", () => {
  const countCall: string = between(
    "await ModelAPI.getList<StatusPageResource>(",
    "});",
  );

  test("is one request for the whole status page, not one per group", () => {
    const query: string = countCall.split("query: {")[1]!.split("},")[0]!;

    expect(query).toContain("statusPageId: modelId,");
    expect(query).toContain("projectId: projectId,");
    /* Unscoped by group - that is what makes it one request rather than N. */
    expect(query).not.toContain("statusPageGroupId");
    expect(code).not.toContain("ModelAPI.count(");
  });

  test("reads only what a count needs", () => {
    const select: string = countCall.split("select: {")[1]!.split("},")[0]!;

    expect(select).toContain("_id: true,");
    expect(select).toContain("statusPageGroupId: true,");
    expect(select).not.toContain("displayName");
    expect(select).not.toContain("monitor:");
  });
});

describe("permissions", () => {
  /*
   * The tables used to gate their own buttons. Nothing else does it now, so the
   * page has to — and it has to ask the models, not guess from a role. Two
   * models, separately: a viewer may well be allowed to add a monitor to a
   * status page without being allowed to restructure it.
   */
  test("are read from both models the same way the tables read them", () => {
    expect(code).toContain(
      "const permissions: Array<Permission> = PermissionUtil.getAllPermissions();",
    );

    for (const check of [
      "resourceModel.hasCreatePermissions(permissions)",
      "resourceModel.hasUpdatePermissions(permissions)",
      "resourceModel.hasDeletePermissions(permissions)",
      "groupModel.hasCreatePermissions(permissions)",
      "groupModel.hasUpdatePermissions(permissions)",
      "groupModel.hasDeletePermissions(permissions)",
    ]) {
      expect(code).toContain(check);
    }
  });

  test("a master admin keeps the access they had", () => {
    expect(code).toContain(
      "const isMasterAdmin: boolean = User.isMasterAdmin();",
    );
    expect(code.split("isMasterAdmin ||").length - 1).toBeGreaterThanOrEqual(6);
  });

  test("the tree is told what the viewer may do to a group", () => {
    const tree: string = between("<ResourceGroupNavigator", "/>");

    expect(tree).toContain("isCreateable={canCreateGroup}");
    expect(tree).toContain("isEditable={canEditGroup}");
    expect(tree).toContain("isDeleteable={canDeleteGroup}");
  });

  test("the pane is told what the viewer may do to both", () => {
    const pane: string = between("<StatusPageResourcePanel", "/>");

    expect(pane).toContain("canCreate={canCreate}");
    expect(pane).toContain("canEdit={canEdit}");
    expect(pane).toContain("canDelete={canDelete}");
    expect(pane).toContain("canCreateGroup={canCreateGroup}");
    expect(pane).toContain("canEditGroup={canEditGroup}");
    expect(pane).toContain("canDeleteGroup={canDeleteGroup}");
  });

  test("the create-group button is not drawn for someone who cannot create", () => {
    expect(
      between(
        "const buttons: Array<CardButtonSchema | ReactElement> = [];",
        "return buttons;",
      ),
    ).toContain("if (canCreateGroup) {");
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
   * A group written into a collapsed branch, refetched and then not shown reads
   * exactly like the create having failed - and it is the whole path down to it
   * that has to open, not only its immediate parent, because the parent can be
   * collapsed inside a collapsed grandparent.
   */
  test("the whole path down to the new group is opened, so it is actually visible", () => {
    const onSuccess: string = between(
      "onSuccess={(item: StatusPageGroup)",
      "formProps={",
    );

    expect(onSuccess).toContain("fetchGroups()");
    expect(onSuccess).toContain("setExpandedGroupIds(");
    expect(onSuccess).toContain(
      "StatusPageResourceExplorerUtil.getGroupIdsToReveal(",
    );
  });

  /*
   * The reveal reads the hierarchy the refetch just returned. `groups` is the
   * list from the render that built this callback - the one from before the
   * write - and it does not contain the group being revealed, so revealing
   * against it silently does nothing.
   */
  test("the reveal reads the refetched hierarchy, not the stale one in state", () => {
    const onSuccess: string = between(
      "onSuccess={(item: StatusPageGroup)",
      "formProps={",
    );

    expect(onSuccess).toContain(
      ".then((refreshedGroups: Array<StatusPageGroup>) =>",
    );
    expect(onSuccess).toContain("statusPageGroups: refreshedGroups,");
    expect(onSuccess).not.toContain("statusPageGroups: groups,");
  });

  /*
   * A group is created in order to put monitors in it. Leaving the pane on the
   * group that happened to be selected before makes the next step a hunt
   * through the tree for something that was just created.
   */
  test("the pane opens on the group that was just created", () => {
    const onSuccess: string = between(
      "onSuccess={(item: StatusPageGroup)",
      "formProps={",
    );

    expect(onSuccess).toContain("statusPageGroupId: writtenGroupId,");
    expect(onSuccess).toContain("wasCreate");
  });

  test("editing an existing group is the same form, in update mode", () => {
    expect(code).toContain("modelIdToEdit={groupIdToEdit || undefined}");
    expect(code).toContain(
      squash(
        "formType: groupFormMode === GroupFormMode.Create ? FormType.Create : FormType.Update,",
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

    expect(options).toContain("statusPageGroups: groups,");
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
   * page holds that list, refetches it after every write, and the options are
   * computed from it — so a group created a moment ago is still selectable
   * without a second round trip.
   */
  test("is built from the list the page already holds", () => {
    expect(code).not.toContain("fetchDropdownOptions");
    expect(between('title: "Parent Group",', "},")).toContain(
      "dropdownOptions: getParentGroupOptions(),",
    );
  });
});

describe("reordering a group", () => {
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
  const deleteBody: string = between(
    "const deleteGroup: PromiseVoidFunction",
    "const getParentGroupOptions:",
  );

  /*
   * The cascade is at the database level: sub groups, the resources in them and
   * any monitor rules pointing at them all go. Nothing on the row says so, so
   * the confirmation has to.
   */
  test("the confirmation says what else goes with it", () => {
    const description: string = between(
      "const getDeleteDescription: GetDeleteDescriptionFunction",
      "const getGroupFormFields:",
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
    expect(deleteBody).toContain("await ModelAPI.deleteItem<StatusPageGroup>(");
    expect(deleteBody).toContain("id: groupToDelete.id,");
    expect(deleteBody).toContain("await fetchGroups();");
  });

  /*
   * The cascade takes the resources in the group and in every group under it,
   * and the page has no way of knowing how many that was — so the badges are
   * re-read rather than adjusted. This is the one write on the page where that
   * is true.
   */
  test("the counts are re-read, because the cascade moved numbers nobody counted", () => {
    expect(deleteBody).toContain("await fetchResourceCounts();");
  });

  /*
   * A pane still pointed at a group that has just been deleted sits there
   * fetching something that no longer exists.
   */
  test("a selection inside the deleted subtree is moved out of it", () => {
    expect(deleteBody).toContain(
      "StatusPageGroupTreeUtil.getDescendantGroups(",
    );
    expect(deleteBody).toContain(
      "removedGroupIds.has(selection.statusPageGroupId)",
    );
    expect(deleteBody).toContain(
      "type: StatusPageResourceSelectionType.Ungrouped,",
    );
  });

  test("a failed delete leaves the confirmation open, carrying the reason", () => {
    expect(deleteBody).toContain(
      "setDeleteGroupError(API.getFriendlyMessage(err));",
    );
    expect(between("<ConfirmModal", "/>")).toContain(
      "error={deleteGroupError || undefined}",
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
      "if (hasAppliedDefaultExpansion || groups.length === 0)",
      "}, [groups, hasAppliedDefaultExpansion]);",
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

  /*
   * Opening and closing a branch is the chevron's job, and a search opens the
   * ancestors of whatever it matched. A pair of "expand all / collapse all"
   * buttons above the tree spent a permanent row of the sidebar on two things
   * nobody reaches for on a hierarchy they can already see.
   */
  test("there is no expand-all / collapse-all row above the tree", () => {
    expect(code).not.toContain("status-page-resource-expand-all");
    expect(code).not.toContain("status-page-resource-collapse-all");
  });
});

describe("what the operator sees while nothing is on screen", () => {
  /*
   * The page refetches the hierarchy after every group write. A loader keyed on
   * isLoading alone would blank the whole screen — and unmount the pane, which
   * would re-read the selected group's resources — every time a group was
   * renamed.
   */
  test("only a first load shows a loader, not every refetch", () => {
    expect(code).toContain(
      squash(
        "if (isLoading && groups.length === 0) { return <ComponentLoader />; }",
      ),
    );
  });

  /*
   * A hierarchy that is already on screen is the last thing the server agreed
   * to. Replacing it with a full page error because a refetch failed throws
   * away the only working copy the operator had.
   */
  test("a failed load replaces the page only when there is nothing to replace", () => {
    expect(code).toContain(
      squash(
        "if (error && groups.length === 0) { return <ErrorMessage message={error} onRefreshClick={reloadGroups} />; }",
      ),
    );
    expect(code).toContain("{groupActionError || error ? (");
  });

  /*
   * Both of those decisions are about the BODY. Hoisting them to the top of the
   * component would unmount the modals with it - and the CSV import fires its
   * refetch while its own results table is still open, on a status page that by
   * definition has no groups yet, which is exactly when the loader guard bites.
   */
  test("the modals are rendered beside the body, never inside a branch of it", () => {
    expect(code).toContain(
      squash("return ( <Fragment> {getBody()} {getModals()} </Fragment> );"),
    );
    expect(code.split("{getModals()}").length - 1).toBe(1);
  });

  /*
   * A reorder that the server refused leaves a banner. Reading the hierarchy
   * again is the operator saying "show me what is actually there" - a banner
   * about a write that is no longer the current state outlives its truth, and
   * it wins the `||` so it also hides any real error from that refetch.
   */
  test("a refetch clears the last failed write's banner", () => {
    expect(
      between("const fetchGroups: FetchGroupsFunction", "try {"),
    ).toContain('setGroupActionError("");');
  });
});

/*
 * The group form is the one part of the Groups page that was worth carrying
 * over verbatim: it is the whole surface of a status page group, and a field
 * quietly dropped in a merge is a setting an operator can no longer reach at
 * all.
 */
describe("the group form survived the merge intact", () => {
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

/*
 * The resource form was already on this page and is unchanged, but it shares
 * the page with the group form now — and two multi step ModelForms in one file
 * is exactly the shape where one quietly ends up rendering the other's fields.
 */
describe("the resource form is still its own form", () => {
  test.each([
    ["Monitor Details", "monitor-details"],
    ["Advanced", "advanced"],
  ])("keeps the %s step", (title: string, id: string) => {
    expect(code).toContain(squash(`{ title: "${title}", id: "${id}", },`));
  });

  test("the pane is handed the resource fields and steps, not the group's", () => {
    const pane: string = between("<StatusPageResourcePanel", "/>");

    expect(pane).toContain("baseFormFields={formFields}");
    expect(pane).toContain("formSteps={FORM_STEPS}");
  });

  test("a monitor group can still be published instead of a monitor", () => {
    expect(code).toContain("field: { monitorGroup: true, },");
    expect(code).toContain("field: { monitor: true, },");
    expect(code).toContain(
      "props.currentProject?.isFeatureFlagMonitorGroupsEnabled",
    );
  });
});
