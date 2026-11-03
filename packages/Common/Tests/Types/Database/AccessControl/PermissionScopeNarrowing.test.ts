import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import PermissionScopeNarrowing, {
  NarrowedBy,
} from "../../../../Types/Database/AccessControl/PermissionScopeNarrowing";
import Permission from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH SCOPES MEAN WHAT THEY SAY FOR A PERMISSION
 * (Types/Database/AccessControl/PermissionScopeNarrowing): the answers an
 * Add Permission dialog offers, All first, then Owned where owners narrow
 * the permission, then Labels where labels do. Whether the lists match the
 * server is PermissionScopeNarrowingGuard's to say; this is what the
 * dashboard reads from them.
 */

// One permission from each list, and one from none.
const BOTH: Permission = Permission.CreateWorkflow;
const LABELS_ONLY: Permission = PermissionScopeNarrowing
  .NARROWED_BY_LABELS[0] as Permission;
const OWNERS_ONLY: Permission = Permission.ReadSecurityCaseNote;
const NEITHER: Permission = Permission.CreateProjectTeam;

describe("PermissionScopeNarrowing", () => {
  test("each list holds permissions, so every kind of answer is offered somewhere", () => {
    expect(
      PermissionScopeNarrowing.NARROWED_BY_LABELS_AND_OWNERS.length,
    ).toBeGreaterThan(0);
    expect(PermissionScopeNarrowing.NARROWED_BY_LABELS.length).toBeGreaterThan(
      0,
    );
    expect(PermissionScopeNarrowing.NARROWED_BY_OWNERS.length).toBeGreaterThan(
      0,
    );
  });

  test("getNarrowedBy names the list a permission is in, and null for none", () => {
    expect(PermissionScopeNarrowing.getNarrowedBy(BOTH)).toBe(
      NarrowedBy.LabelsAndOwners,
    );
    expect(PermissionScopeNarrowing.getNarrowedBy(LABELS_ONLY)).toBe(
      NarrowedBy.Labels,
    );
    expect(PermissionScopeNarrowing.getNarrowedBy(OWNERS_ONLY)).toBe(
      NarrowedBy.Owners,
    );
    expect(PermissionScopeNarrowing.getNarrowedBy(NEITHER)).toBeNull();
  });

  test("a permission narrowed by both is narrowed by labels and by owners", () => {
    expect(PermissionScopeNarrowing.isNarrowedByLabels(BOTH)).toBe(true);
    expect(PermissionScopeNarrowing.isNarrowedByOwners(BOTH)).toBe(true);
    expect(PermissionScopeNarrowing.isNarrowedByAnyScope(BOTH)).toBe(true);
  });

  test("a permission narrowed by labels only is not narrowed by owners", () => {
    expect(PermissionScopeNarrowing.isNarrowedByLabels(LABELS_ONLY)).toBe(true);
    expect(PermissionScopeNarrowing.isNarrowedByOwners(LABELS_ONLY)).toBe(
      false,
    );
    expect(PermissionScopeNarrowing.isNarrowedByAnyScope(LABELS_ONLY)).toBe(
      true,
    );
  });

  test("a permission narrowed by owners only is not narrowed by labels", () => {
    expect(PermissionScopeNarrowing.isNarrowedByLabels(OWNERS_ONLY)).toBe(
      false,
    );
    expect(PermissionScopeNarrowing.isNarrowedByOwners(OWNERS_ONLY)).toBe(true);
    expect(PermissionScopeNarrowing.isNarrowedByAnyScope(OWNERS_ONLY)).toBe(
      true,
    );
  });

  test("a permission no scope narrows is narrowed by nothing", () => {
    expect(PermissionScopeNarrowing.isNarrowedByLabels(NEITHER)).toBe(false);
    expect(PermissionScopeNarrowing.isNarrowedByOwners(NEITHER)).toBe(false);
    expect(PermissionScopeNarrowing.isNarrowedByAnyScope(NEITHER)).toBe(false);
  });

  test.each([
    [
      "both",
      BOTH,
      [PermissionScope.All, PermissionScope.Owned, PermissionScope.Labels],
    ],
    ["labels only", LABELS_ONLY, [PermissionScope.All, PermissionScope.Labels]],
    ["owners only", OWNERS_ONLY, [PermissionScope.All, PermissionScope.Owned]],
    ["neither", NEITHER, [PermissionScope.All]],
  ])(
    "getScopes for a permission narrowed by %s offers All first, then only what narrows it",
    (
      _kind: string,
      permission: Permission,
      expected: Array<PermissionScope>,
    ) => {
      expect(PermissionScopeNarrowing.getScopes(permission)).toEqual(expected);
    },
  );

  test("a role that reaches the whole project by definition is offered All alone", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SettingsMember,
      Permission.BillingViewer,
    ]) {
      expect(PermissionScopeNarrowing.getScopes(permission)).toEqual([
        PermissionScope.All,
      ]);
    }
  });

  test("a value that is no permission at all is narrowed by nothing", () => {
    expect(
      PermissionScopeNarrowing.getScopes("NotAPermission" as Permission),
    ).toEqual([PermissionScope.All]);
  });

  test("the answers come back as a new list each time, so a caller may change its own", () => {
    const first: Array<PermissionScope> =
      PermissionScopeNarrowing.getScopes(BOTH);
    first.pop();

    expect(PermissionScopeNarrowing.getScopes(BOTH)).toHaveLength(3);
  });
});
