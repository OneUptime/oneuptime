import { describe, expect, test } from "@jest/globals";
import {
  MAX_SCIM_USER_EMAILS,
  MAX_SCIM_USER_TEXT_LENGTH,
  ScimUserAccount,
  ScimUserResource,
  applyScimUserPatch,
  getAccountEmail,
  getAccountName,
  getRecordDataOfScimUserResource,
  getScimUserResourceOfAccount,
  getScimUserResourceOfRecord,
  readScimActive,
  readScimUserResource,
  renderScimUser,
} from "../../../Server/Identity/Utils/ProjectSCIMUserResource";
import ProjectSCIMUser from "Common/Models/DatabaseModels/ProjectSCIMUser";
import { ProjectSCIMUserRecordData } from "Common/Server/Services/ProjectSCIMUserService";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * The SCIM user a project connection keeps and answers with: what the
 * identity provider sent - read from a whole user, changed by PATCH - and the
 * account's own values where it sent nothing. Okta's spec and CRUD tests and
 * Microsoft Entra ID's gallery validation write each attribute and read it
 * back, so these hold the round trip.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SCIM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LOCATION: string = `https://oneuptime.example.com/identity/scim/v2/${SCIM_ID.toString()}/Users/${USER_ID.toString()}`;

const ACCOUNT: ScimUserAccount = {
  id: USER_ID,
  email: "dana.scully@example.com",
  name: "Dana Scully",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

// A record as the service reads it back, holding `resource`.
const recordOf: (
  resource: ScimUserResource,
  isActive?: boolean,
) => ProjectSCIMUser = (
  resource: ScimUserResource,
  isActive: boolean = true,
): ProjectSCIMUser => {
  const data: ProjectSCIMUserRecordData = getRecordDataOfScimUserResource({
    resource: resource,
    projectId: PROJECT_ID,
    projectScimId: SCIM_ID,
    userId: USER_ID,
    isActive: isActive,
  });

  const record: ProjectSCIMUser = new ProjectSCIMUser();
  record.projectId = data.projectId;
  record.projectScimId = data.projectScimId;
  record.userId = data.userId;
  record.isActive = data.isActive;
  record.userName = data.userName as string;
  record.externalId = data.externalId as string;
  // Stored as JSON: what comes back is what a JSON round trip leaves.
  record.scimAttributes = JSON.parse(JSON.stringify(data.scimAttributes));
  record.createdAt = new Date("2026-03-01T00:00:00.000Z");
  record.updatedAt = new Date("2026-03-02T00:00:00.000Z");

  return record;
};

const render: (record: ProjectSCIMUser | null) => JSONObject = (
  record: ProjectSCIMUser | null,
): JSONObject => {
  return renderScimUser({
    account: ACCOUNT,
    record: record,
    location: LOCATION,
  });
};

// What the identity provider reads back after keeping `resource`.
const roundTrip: (
  resource: ScimUserResource,
  isActive?: boolean,
) => JSONObject = (
  resource: ScimUserResource,
  isActive: boolean = true,
): JSONObject => {
  return render(recordOf(resource, isActive));
};

const patch: (
  current: ScimUserResource,
  ...operations: Array<JSONObject>
) => ScimUserResource = (
  current: ScimUserResource,
  ...operations: Array<JSONObject>
): ScimUserResource => {
  return applyScimUserPatch(current, operations);
};

const OKTA_USER: JSONObject = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: "Fox.Mulder@example.com",
  name: { givenName: "Fox", familyName: "Mulder" },
  emails: [{ primary: true, value: "fox.mulder@example.com", type: "work" }],
  displayName: "Fox Mulder",
  locale: "en-US",
  externalId: "00u1a2b3c4d5e6f7g8h9",
  groups: [],
  password: "placeholder-the-app-ignores",
  active: true,
};

describe("readScimUserResource - a whole user, as POST and PUT send it", () => {
  test("keeps userName, externalId, names, emails and active as sent", () => {
    expect(readScimUserResource(OKTA_USER)).toEqual({
      userName: "Fox.Mulder@example.com",
      name: { givenName: "Fox", familyName: "Mulder" },
      emails: [
        { value: "fox.mulder@example.com", type: "work", primary: true },
      ],
      displayName: "Fox Mulder",
      externalId: "00u1a2b3c4d5e6f7g8h9",
      active: true,
    });
  });

  test("leaves out what OneUptime does not keep: a password, a locale, groups", () => {
    const resource: ScimUserResource = readScimUserResource(OKTA_USER);

    expect(Object.keys(resource).sort()).toEqual(
      [
        "active",
        "displayName",
        "emails",
        "externalId",
        "name",
        "userName",
      ].sort(),
    );
  });

  test("attribute names are read whatever their case", () => {
    expect(
      readScimUserResource({
        USERNAME: "a@example.com",
        Active: "False",
        NAME: { GIVENNAME: "A" },
      }),
    ).toEqual({
      userName: "a@example.com",
      active: false,
      name: { givenName: "A" },
    });
  });

  test("a numeric externalId is kept as text", () => {
    expect(readScimUserResource({ externalId: 12345 }).externalId).toBe(
      "12345",
    );
  });

  test("text longer than a record holds is cut, and more emails than it keeps are dropped", () => {
    const resource: ScimUserResource = readScimUserResource({
      displayName: "x".repeat(MAX_SCIM_USER_TEXT_LENGTH + 50),
      emails: Array.from(
        { length: MAX_SCIM_USER_EMAILS + 5 },
        (_: unknown, i: number) => {
          return { value: `u${i}@example.com` };
        },
      ),
    });

    expect(resource.displayName).toHaveLength(MAX_SCIM_USER_TEXT_LENGTH);
    expect(resource.emails).toHaveLength(MAX_SCIM_USER_EMAILS);
  });

  test("an email without a string value is not an email", () => {
    expect(
      readScimUserResource({
        emails: [{ value: 42 }, "a@example.com", { value: "b@example.com" }],
      }).emails,
    ).toEqual([{ value: "b@example.com" }]);
  });

  test("a body that is not an object keeps nothing", () => {
    expect(readScimUserResource(null)).toEqual({});
    expect(readScimUserResource([OKTA_USER])).toEqual({});
  });
});

describe("readScimActive", () => {
  test("booleans and Entra ID's strings, in any case", () => {
    expect(readScimActive(true)).toBe(true);
    expect(readScimActive(false)).toBe(false);
    expect(readScimActive("True")).toBe(true);
    expect(readScimActive(" false ")).toBe(false);
  });

  test("anything else is not an answer", () => {
    expect(readScimActive("yes")).toBeUndefined();
    expect(readScimActive(1)).toBeUndefined();
    expect(readScimActive(null)).toBeUndefined();
  });
});

describe("applyScimUserPatch - Okta", () => {
  test("deactivates with a replace that has no path", () => {
    expect(
      patch(readScimUserResource(OKTA_USER), {
        op: "replace",
        value: { active: false },
      }).active,
    ).toBe(false);
  });

  test("reactivates the same way", () => {
    expect(
      patch(
        { ...readScimUserResource(OKTA_USER), active: false },
        { op: "replace", value: { active: true } },
      ).active,
    ).toBe(true);
  });
});

describe("applyScimUserPatch - Microsoft Entra ID", () => {
  const current: ScimUserResource = {
    userName: "abe.lincoln@contoso.com",
    externalId: "abe",
    displayName: "Abe Lincoln",
    name: { givenName: "Abe", familyName: "Lincoln" },
    emails: [{ value: "abe.lincoln@contoso.com", type: "work", primary: true }],
    active: true,
  };

  test("disables with Replace on active and the string False", () => {
    expect(
      patch(current, { op: "Replace", path: "active", value: "False" }).active,
    ).toBe(false);
  });

  test("replaces each attribute by its path", () => {
    expect(
      patch(
        current,
        { op: "Replace", path: "displayName", value: "Abe Lincoln - Updated" },
        { op: "Replace", path: "name.givenName", value: "Abraham" },
        { op: "Replace", path: "name.familyName", value: "Lincoln II" },
        { op: "Replace", path: "externalId", value: "abe-2" },
        {
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: "updated-abe@contoso.com",
        },
        { op: "Replace", path: "userName", value: "updated-abe@contoso.com" },
      ),
    ).toEqual({
      userName: "updated-abe@contoso.com",
      externalId: "abe-2",
      displayName: "Abe Lincoln - Updated",
      name: { givenName: "Abraham", familyName: "Lincoln II" },
      emails: [
        { value: "updated-abe@contoso.com", type: "work", primary: true },
      ],
      active: true,
    });
  });

  test("the SCIM 2.0 compliant form: several attributes in one replace without a path", () => {
    expect(
      patch(current, {
        op: "replace",
        value: {
          displayName: "Abe",
          "name.givenName": "A.",
          "name.familyName": "L.",
          active: false,
        },
      }),
    ).toMatchObject({
      displayName: "Abe",
      name: { givenName: "A.", familyName: "L." },
      active: false,
    });
  });

  test("Add sets an attribute the user did not have", () => {
    expect(
      patch(
        { userName: "a@contoso.com" },
        { op: "Add", path: "name.formatted", value: "Ann Example" },
        {
          op: "Add",
          path: 'emails[type eq "work"].value',
          value: "a@contoso.com",
        },
      ),
    ).toEqual({
      userName: "a@contoso.com",
      name: { formatted: "Ann Example" },
      emails: [{ value: "a@contoso.com", type: "work" }],
    });
  });

  test("a null or empty replace clears an attribute, as the null-update test sends it", () => {
    const cleared: ScimUserResource = patch(
      current,
      { op: "Replace", path: "displayName", value: "" },
      { op: "Replace", path: "name.givenName", value: null },
      { op: "Replace", path: "externalId", value: null },
    );

    expect(cleared.displayName).toBe("");
    expect(cleared.name).toEqual({ givenName: null, familyName: "Lincoln" });
    expect(cleared.externalId).toBe(null);
  });

  test("Remove on a path clears it, and Remove on active is not a deactivation", () => {
    const removed: ScimUserResource = patch(
      current,
      { op: "Remove", path: "displayName" },
      { op: "Remove", path: "active" },
      { op: "Remove", path: 'emails[type eq "work"]' },
    );

    expect(removed.displayName).toBe(null);
    expect(removed.active).toBe(true);
    expect(removed.emails).toBe(null);
  });

  test("an attribute under the user schema's URN is the attribute", () => {
    expect(
      patch(current, {
        op: "replace",
        path: "urn:ietf:params:scim:schemas:core:2.0:User:displayName",
        value: "Honest Abe",
      }).displayName,
    ).toBe("Honest Abe");
  });

  test("attributes OneUptime does not keep are left alone", () => {
    expect(
      patch(
        current,
        { op: "Replace", path: "title", value: "President" },
        {
          op: "Add",
          path: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager",
          value: { value: "someone" },
        },
        {
          op: "Replace",
          path: 'addresses[type eq "work"].formatted',
          value: "x",
        },
      ),
    ).toEqual(current);
  });
});

describe("applyScimUserPatch - emails", () => {
  const current: ScimUserResource = {
    emails: [
      { value: "work@example.com", type: "work", primary: true },
      { value: "home@example.com", type: "home" },
    ],
  };

  test("a value path changes only the matching email", () => {
    expect(
      patch(current, {
        op: "replace",
        path: 'emails[type eq "home"].value',
        value: "new-home@example.com",
      }).emails,
    ).toEqual([
      { value: "work@example.com", type: "work", primary: true },
      { value: "new-home@example.com", type: "home" },
    ]);
  });

  test("a primary filter selects the primary email", () => {
    expect(
      patch(current, {
        op: "replace",
        path: "emails[primary eq true].value",
        value: "primary@example.com",
      }).emails?.[0],
    ).toEqual({ value: "primary@example.com", type: "work", primary: true });
  });

  test("add on emails appends, replace on emails replaces", () => {
    expect(
      patch(current, {
        op: "add",
        path: "emails",
        value: [{ value: "other@example.com", type: "other" }],
      }).emails,
    ).toHaveLength(3);
    expect(
      patch(current, {
        op: "replace",
        path: "emails",
        value: [{ value: "only@example.com" }],
      }).emails,
    ).toEqual([{ value: "only@example.com" }]);
  });

  test("removing the matching email keeps the others", () => {
    expect(
      patch(current, { op: "remove", path: 'emails[type eq "home"]' }).emails,
    ).toEqual([{ value: "work@example.com", type: "work", primary: true }]);
  });

  test("a value path OneUptime cannot read is left alone", () => {
    expect(
      patch(current, {
        op: "replace",
        path: 'emails[display co "x"].value',
        value: "y@example.com",
      }),
    ).toEqual(current);
  });
});

describe("applyScimUserPatch - what it does not do", () => {
  test("it does not change the user it is given", () => {
    const current: ScimUserResource = readScimUserResource(OKTA_USER);
    const before: string = JSON.stringify(current);

    patch(
      current,
      { op: "replace", path: "name.givenName", value: "Changed" },
      {
        op: "replace",
        path: 'emails[type eq "work"].value',
        value: "x@example.com",
      },
      { op: "replace", value: { active: false } },
    );

    expect(JSON.stringify(current)).toBe(before);
  });

  test("malformed operations are skipped and the rest applied", () => {
    expect(
      applyScimUserPatch({ displayName: "A" }, [
        null,
        "replace",
        { op: 42 },
        { op: "move", path: "displayName", value: "B" },
        { op: "replace", path: 42, value: "C" },
        { op: "replace", path: "displayName", value: "D" },
      ]),
    ).toEqual({ displayName: "D" });
  });

  test("Operations that are not a list change nothing", () => {
    expect(applyScimUserPatch({ displayName: "A" }, { op: "replace" })).toEqual(
      {
        displayName: "A",
      },
    );
  });
});

describe("getAccountEmail and getAccountName", () => {
  test("the userName when it is an address", () => {
    expect(getAccountEmail(readScimUserResource(OKTA_USER))).toBe(
      "Fox.Mulder@example.com",
    );
  });

  test("else the primary, then the work, then the first email", () => {
    expect(
      getAccountEmail({
        userName: "fmulder",
        emails: [
          { value: "first@example.com" },
          { value: "work@example.com", type: "work" },
          { value: "primary@example.com", primary: true },
        ],
      }),
    ).toBe("primary@example.com");
    expect(
      getAccountEmail({
        userName: "fmulder",
        emails: [
          { value: "first@example.com" },
          { value: "work@example.com", type: "Work" },
        ],
      }),
    ).toBe("work@example.com");
    expect(
      getAccountEmail({
        userName: "fmulder",
        emails: [{ value: "first@example.com" }],
      }),
    ).toBe("first@example.com");
  });

  test("null when nothing sent is an address", () => {
    expect(getAccountEmail({ userName: "upd-1a2b3c4d" })).toBe(null);
    expect(getAccountEmail({})).toBe(null);
  });

  test("the formatted name, else given and family, else the display name", () => {
    expect(
      getAccountName({
        name: { formatted: "Dr. Dana Scully", givenName: "Dana" },
        displayName: "D",
      }),
    ).toBe("Dr. Dana Scully");
    expect(
      getAccountName({ name: { givenName: " Dana ", familyName: "Scully" } }),
    ).toBe("Dana Scully");
    expect(
      getAccountName({ name: { givenName: null }, displayName: "D S" }),
    ).toBe("D S");
    expect(getAccountName({})).toBe("");
  });
});

describe("renderScimUser - what the identity provider reads back", () => {
  test("a user the connection keeps no record of: the account, active", () => {
    expect(render(null)).toEqual({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: USER_ID.toString(),
      userName: "dana.scully@example.com",
      name: {
        givenName: "Dana",
        familyName: "Scully",
        formatted: "Dana Scully",
      },
      displayName: "Dana Scully",
      emails: [
        { value: "dana.scully@example.com", type: "work", primary: true },
      ],
      active: true,
      meta: {
        resourceType: "User",
        created: "2026-01-01T00:00:00.000Z",
        lastModified: "2026-01-02T00:00:00.000Z",
        location: LOCATION,
      },
    });
  });

  test("what Okta sent comes back as it was sent", () => {
    const user: JSONObject = roundTrip(readScimUserResource(OKTA_USER));

    expect(user).toMatchObject({
      id: USER_ID.toString(),
      externalId: "00u1a2b3c4d5e6f7g8h9",
      userName: "Fox.Mulder@example.com",
      name: { givenName: "Fox", familyName: "Mulder", formatted: "Fox Mulder" },
      displayName: "Fox Mulder",
      emails: [
        { value: "fox.mulder@example.com", type: "work", primary: true },
      ],
      active: true,
    });
    expect((user["meta"] as JSONObject)["created"]).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });

  test("a deactivated user is still there, inactive", () => {
    expect(roundTrip(readScimUserResource(OKTA_USER), false)["active"]).toBe(
      false,
    );
  });

  test("a cleared attribute is left out, an empty one is kept", () => {
    const user: JSONObject = roundTrip({
      userName: "a@example.com",
      displayName: "",
      name: { givenName: null, familyName: "Scully" },
      externalId: null,
      emails: null,
    });

    expect(user["displayName"]).toBe("");
    expect(user["name"]).toEqual({ familyName: "Scully", formatted: "Scully" });
    expect("externalId" in user).toBe(false);
    expect("emails" in user).toBe(false);
  });

  test("what was never sent falls back to the account", () => {
    const user: JSONObject = roundTrip({ userName: "a@example.com" });

    expect(user["userName"]).toBe("a@example.com");
    expect(user["displayName"]).toBe("Dana Scully");
    expect(user["emails"]).toEqual([
      { value: "dana.scully@example.com", type: "work", primary: true },
    ]);
  });

  test("Entra ID's update test: every value written is read back exactly", () => {
    const written: ScimUserResource = patch(
      roundTripResource(readScimUserResource(OKTA_USER)),
      { op: "Replace", path: "userName", value: "upd-1a2b3c4d" },
      { op: "Replace", path: "displayName", value: "upd-5e6f7a8b" },
      { op: "Replace", path: "externalId", value: "upd-9c0d1e2f" },
      { op: "Replace", path: "name.givenName", value: "upd-3a4b5c6d" },
      {
        op: "Replace",
        path: 'emails[type eq "work"].value',
        value: "upd-7e8f9a0b",
      },
    );

    expect(roundTrip(written)).toMatchObject({
      userName: "upd-1a2b3c4d",
      displayName: "upd-5e6f7a8b",
      externalId: "upd-9c0d1e2f",
      name: { givenName: "upd-3a4b5c6d", familyName: "Mulder" },
      emails: [{ value: "upd-7e8f9a0b", type: "work", primary: true }],
    });
  });
});

// What the record keeps of `resource`, read back.
const roundTripResource: (resource: ScimUserResource) => ScimUserResource = (
  resource: ScimUserResource,
): ScimUserResource => {
  return getScimUserResourceOfRecord(
    recordOf(resource, resource.active !== false),
  );
};

describe("records keep what they were given", () => {
  test("a resource survives a record unchanged", () => {
    const resource: ScimUserResource = readScimUserResource(OKTA_USER);

    expect(roundTripResource(resource)).toEqual(resource);
  });

  test("null survives, and an attribute kept as JSON that was never sent stays absent", () => {
    /*
     * userName and externalId are columns, where never sent and cleared are
     * both null - and both are left out of the answer alike.
     */
    expect(
      roundTripResource({ userName: "a@example.com", displayName: null }),
    ).toEqual({
      userName: "a@example.com",
      externalId: null,
      displayName: null,
      active: true,
    });
  });

  test("a member the identity provider has not written starts from the account", () => {
    expect(getScimUserResourceOfAccount(ACCOUNT)).toEqual({
      userName: "dana.scully@example.com",
      displayName: "Dana Scully",
      name: {
        givenName: "Dana",
        familyName: "Scully",
        formatted: "Dana Scully",
      },
      emails: [
        { value: "dana.scully@example.com", type: "work", primary: true },
      ],
      active: true,
    });
  });

  test("a record's columns hold the userName and externalId, the rest is JSON", () => {
    const data: ProjectSCIMUserRecordData = getRecordDataOfScimUserResource({
      resource: readScimUserResource(OKTA_USER),
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      userId: USER_ID,
      isActive: true,
    });

    expect(data.userName).toBe("Fox.Mulder@example.com");
    expect(data.externalId).toBe("00u1a2b3c4d5e6f7g8h9");
    expect(Object.keys(data.scimAttributes).sort()).toEqual([
      "displayName",
      "emails",
      "name",
    ]);
  });
});
