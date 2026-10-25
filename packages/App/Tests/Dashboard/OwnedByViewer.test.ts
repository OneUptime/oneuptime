import { describe, expect, test } from "@jest/globals";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import ObjectID from "Common/Types/ObjectID";
import { isOwnedByViewer } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/OwnedByViewer";
import { ResourceOwnerEntry } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";

/*
 * Whether the person signed in owns a row, as the list read its owners -
 * the incidents, alerts, episodes and maintenance lists offer Assign to Me
 * on a row only when it is not theirs. Unknown while the owners are being
 * read, so the row offers it until the list knows; a team the viewer is in
 * owning the row is not the viewer owning it.
 */

const VIEWER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const userOwner: (id: string) => ResourceOwnerEntry = (
  id: string,
): ResourceOwnerEntry => {
  const user: User = new User();
  user._id = id;

  return { kind: "user", user: user };
};

const teamOwner: () => ResourceOwnerEntry = (): ResourceOwnerEntry => {
  const team: Team = new Team();
  team._id = VIEWER_ID;

  return { kind: "team", team: team };
};

describe("isOwnedByViewer", () => {
  test("is true when the viewer is one of the row's owners", () => {
    expect(
      isOwnedByViewer({
        owners: [userOwner(OTHER_ID), userOwner(VIEWER_ID)],
        viewerId: new ObjectID(VIEWER_ID),
      }),
    ).toBe(true);
  });

  test("matches the viewer's id whatever its case", () => {
    expect(
      isOwnedByViewer({
        owners: [userOwner(VIEWER_ID.toUpperCase())],
        viewerId: VIEWER_ID,
      }),
    ).toBe(true);
  });

  test("is false when only others own it, or nobody does", () => {
    expect(
      isOwnedByViewer({
        owners: [userOwner(OTHER_ID)],
        viewerId: VIEWER_ID,
      }),
    ).toBe(false);
    expect(isOwnedByViewer({ owners: [], viewerId: VIEWER_ID })).toBe(false);
  });

  test("a team owning it is not the viewer owning it", () => {
    expect(
      isOwnedByViewer({ owners: [teamOwner()], viewerId: VIEWER_ID }),
    ).toBe(false);
  });

  test("is unknown while the owners are being read, or nobody is signed in", () => {
    expect(
      isOwnedByViewer({ owners: undefined, viewerId: VIEWER_ID }),
    ).toBeUndefined();
    expect(
      isOwnedByViewer({ owners: [userOwner(VIEWER_ID)], viewerId: null }),
    ).toBeUndefined();
    expect(
      isOwnedByViewer({ owners: [userOwner(VIEWER_ID)], viewerId: "" }),
    ).toBeUndefined();
  });
});
