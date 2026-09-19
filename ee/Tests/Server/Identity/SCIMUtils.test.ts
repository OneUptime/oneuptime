import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  extractEmailFromSCIM,
  extractUserUpdateFromSCIM,
} from "../../../Server/Identity/Utils/SCIMUtils";

const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

type PatchBodyFunction = (operations: Array<JSONValue>) => JSONObject;

const patchBody: PatchBodyFunction = (
  operations: Array<JSONValue>,
): JSONObject => {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
};

describe("extractUserUpdateFromSCIM full resources", () => {
  test("extracts an Okta-style PUT deactivation without losing the email", () => {
    const update: JSONObject = extractUserUpdateFromSCIM({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: "existing-user",
      active: false,
      userName: "user@example.com",
      emails: [{ value: "user@example.com", type: "work", primary: true }],
      displayName: "Existing User",
    });

    expect(update["active"]).toBe(false);
    expect(extractEmailFromSCIM(update)).toBe("user@example.com");
    expect(update["id"]).toBeUndefined();
    expect(update["schemas"]).toBeUndefined();
    expect(update["displayName"]).toBeUndefined();
  });

  test("preserves the existing userName precedence over emails for PUT", () => {
    const update: JSONObject = extractUserUpdateFromSCIM({
      userName: "login@example.com",
      emails: [{ value: "work@example.com", type: "work" }],
    });

    expect(extractEmailFromSCIM(update)).toBe("login@example.com");
    expect(update["emails"]).toEqual([
      { value: "work@example.com", type: "work" },
    ]);
    expect(update["active"]).toBeUndefined();
  });

  test("uses the first resource email when userName is absent", () => {
    const update: JSONObject = extractUserUpdateFromSCIM({
      emails: [
        { value: "first@example.com", type: "work" },
        { value: "second@example.com", type: "home" },
      ],
    });

    expect(extractEmailFromSCIM(update)).toBe("first@example.com");
  });

  test("leaves active unspecified when the payload has no active attribute", () => {
    expect(extractUserUpdateFromSCIM({})).toEqual({});
  });

  test.each(["False", "false", "FALSE"])(
    "normalizes the full-resource string %s to false",
    (active: string) => {
      expect(extractUserUpdateFromSCIM({ active })["active"]).toBe(false);
    },
  );
});

describe("extractUserUpdateFromSCIM PatchOp active updates", () => {
  test("extracts the exact Entra ID PatchOp sent for an unassigned user", () => {
    const update: JSONObject = extractUserUpdateFromSCIM({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Replace", path: "active", value: false }],
    });

    expect(update).toEqual({ active: false });
  });

  test("accepts Operations without requiring the optional schema wrapper", () => {
    expect(
      extractUserUpdateFromSCIM({
        Operations: [{ op: "Replace", path: "active", value: false }],
      }),
    ).toEqual({ active: false });
  });

  test("recognizes attribute names and paths case-insensitively", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        { op: "Replace", value: { ACTIVE: true, USERNAME: "old@example.com" } },
        { op: "Replace", path: "Active", value: false },
        { op: "Replace", path: "UserName", value: "new@example.com" },
        {
          op: "Replace",
          path: 'Emails[TYPE EQ "WORK"].Value',
          value: "work@example.com",
        },
      ]),
    );

    expect(update["active"]).toBe(false);
    expect(update["userName"]).toBe("new@example.com");
    expect(update["emails"]).toEqual([
      expect.objectContaining({ value: "work@example.com", type: "work" }),
    ]);
  });

  test.each(["add", "Add", "ADD", "replace", "Replace", "rEpLaCe"])(
    "recognizes the operation name %s case-insensitively",
    (op: string) => {
      expect(
        extractUserUpdateFromSCIM(
          patchBody([{ op, path: "active", value: false }]),
        )["active"],
      ).toBe(false);
    },
  );

  test.each(["False", "false", "FALSE", "fAlSe"])(
    "normalizes PatchOp active string %s to false",
    (value: string) => {
      expect(
        extractUserUpdateFromSCIM(
          patchBody([{ op: "Replace", path: "active", value }]),
        )["active"],
      ).toBe(false);
    },
  );

  test.each([true, "true", "True", "TRUE"])(
    "keeps reactivation value %s true instead of treating it as deactivation",
    (value: string | boolean) => {
      expect(
        extractUserUpdateFromSCIM(
          patchBody([{ op: "Replace", path: "active", value }]),
        )["active"],
      ).toBe(true);
    },
  );

  test.each(["Add", "Replace"])(
    "extracts supported attributes from a no-path %s object",
    (op: string) => {
      const update: JSONObject = extractUserUpdateFromSCIM(
        patchBody([
          {
            op,
            value: {
              active: "False",
              userName: "renamed@example.com",
              emails: [{ value: "work@example.com", type: "work" }],
              displayName: "Ignored Name",
            },
          },
        ]),
      );

      expect(update).toEqual({
        active: false,
        userName: "renamed@example.com",
        emails: [{ value: "work@example.com", type: "work" }],
      });
      expect(extractEmailFromSCIM(update)).toBe("renamed@example.com");
    },
  );

  test("processes a reactivation after a deactivation in request order", () => {
    expect(
      extractUserUpdateFromSCIM(
        patchBody([
          { op: "Replace", path: "active", value: false },
          { op: "Replace", value: { active: true } },
        ]),
      )["active"],
    ).toBe(true);
  });

  test("processes a deactivation after a reactivation in request order", () => {
    expect(
      extractUserUpdateFromSCIM(
        patchBody([
          { op: "Add", value: { active: true } },
          { op: "Replace", path: "active", value: "False" },
        ]),
      )["active"],
    ).toBe(false);
  });

  test.each(["remove", "Remove", "rEmOvE"])(
    "%s active clears a pending update without deprovisioning the user",
    (op: string) => {
      const update: JSONObject = extractUserUpdateFromSCIM(
        patchBody([
          { op: "Replace", path: "active", value: false },
          { op, path: "active", value: false },
        ]),
      );

      expect(update["active"]).toBeUndefined();
    },
  );

  test("removing active alone does not mean active=false", () => {
    expect(
      extractUserUpdateFromSCIM(patchBody([{ op: "Remove", path: "active" }]))[
        "active"
      ],
    ).toBeUndefined();
  });

  test("ignores a no-path remove object rather than applying its attributes", () => {
    expect(
      extractUserUpdateFromSCIM(
        patchBody([
          {
            op: "Remove",
            value: { active: false, userName: "user@example.com" },
          },
        ]),
      ),
    ).toEqual({});
  });

  test("allows an explicit active update after a remove operation", () => {
    expect(
      extractUserUpdateFromSCIM(
        patchBody([
          { op: "Remove", path: "active" },
          { op: "Add", path: "active", value: false },
        ]),
      )["active"],
    ).toBe(false);
  });
});

describe("extractUserUpdateFromSCIM PatchOp email updates", () => {
  test("replaces the userName used as the user email", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        { op: "Replace", path: "userName", value: "new@example.com" },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("new@example.com");
  });

  test("extracts an email replacement containing the entire emails array", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          path: "emails",
          value: [{ value: "new@example.com", type: "work", primary: true }],
        },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("new@example.com");
    expect(update["emails"]).toEqual([
      { value: "new@example.com", type: "work", primary: true },
    ]);
  });

  test.each(["Add", "Replace"])(
    "extracts a filtered work email value from a %s operation",
    (op: string) => {
      const update: JSONObject = extractUserUpdateFromSCIM(
        patchBody([
          {
            op,
            path: 'emails[type eq "work"].value',
            value: "new@example.com",
          },
        ]),
      );

      expect(extractEmailFromSCIM(update)).toBe("new@example.com");
      expect(update["emails"]).toEqual([
        expect.objectContaining({ value: "new@example.com", type: "work" }),
      ]);
    },
  );

  test("extracts an unfiltered emails.value replacement", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        { op: "Replace", path: "emails.value", value: "new@example.com" },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("new@example.com");
  });

  test.each([
    { value: { value: "new@example.com", primary: true } },
    { value: [{ value: "new@example.com", primary: true }] },
  ])(
    "extracts filtered work email objects and arrays: $value",
    ({ value }: { value: JSONValue }) => {
      const update: JSONObject = extractUserUpdateFromSCIM(
        patchBody([{ op: "Replace", path: 'emails[type eq "work"]', value }]),
      );

      expect(extractEmailFromSCIM(update)).toBe("new@example.com");
      expect(update["emails"]).toEqual([
        expect.objectContaining({ value: "new@example.com", type: "work" }),
      ]);
    },
  );

  test("uses the last replacement of the same filtered email", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: "old@example.com",
        },
        {
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: "new@example.com",
        },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("new@example.com");
  });

  test("a filtered email object replacement preserves its position before other types", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          path: "emails",
          value: [
            { value: "old@example.com", type: "work" },
            { value: "home@example.com", type: "home" },
          ],
        },
        {
          op: "Replace",
          path: 'emails[type eq "work"]',
          value: { value: "new@example.com" },
        },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("new@example.com");
    expect(update["emails"]).toEqual([
      { value: "new@example.com", type: "work" },
      { value: "home@example.com", type: "home" },
    ]);
  });

  test("a no-path Add appends emails without discarding a prior work email", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          path: "emails",
          value: [{ value: "work@example.com", type: "work" }],
        },
        {
          op: "Add",
          value: { emails: [{ value: "home@example.com", type: "home" }] },
        },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("work@example.com");
    expect(update["emails"]).toEqual([
      { value: "work@example.com", type: "work" },
      { value: "home@example.com", type: "home" },
    ]);
  });

  test("removing userName allows a supplied email to be used instead", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          value: {
            userName: "login@example.com",
            emails: [{ value: "email@example.com", type: "work" }],
          },
        },
        { op: "Remove", path: "userName" },
      ]),
    );

    expect(update["userName"]).toBeUndefined();
    expect(extractEmailFromSCIM(update)).toBe("email@example.com");
  });

  test("removing emails clears an earlier replacement without erasing userName", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          value: {
            userName: "login@example.com",
            emails: [{ value: "email@example.com", type: "work" }],
          },
        },
        { op: "Remove", path: "emails" },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("login@example.com");
    expect(update["emails"]).toBeUndefined();
  });

  test("removing a filtered work email preserves a pending home email", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          path: "emails",
          value: [
            { value: "work@example.com", type: "work" },
            { value: "home@example.com", type: "home" },
          ],
        },
        { op: "Remove", path: 'emails[type eq "work"].value' },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("home@example.com");
    expect(update["emails"]).toEqual([
      { value: "home@example.com", type: "home" },
    ]);
  });

  test("removing a different email type does not clear the pending work email", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: "work@example.com",
        },
        { op: "Remove", path: 'emails[type eq "home"]' },
      ]),
    );

    expect(extractEmailFromSCIM(update)).toBe("work@example.com");
  });
});

describe("extractUserUpdateFromSCIM malformed and unsupported updates", () => {
  test.each([
    { value: null },
    { value: 0 },
    { value: 1 },
    { value: "" },
    { value: "0" },
    { value: "disabled" },
    { value: [] },
    { value: {} },
  ])(
    "does not coerce invalid active value $value into deactivation",
    ({ value }: { value: JSONValue }) => {
      expect(
        extractUserUpdateFromSCIM({ active: value })["active"],
      ).toBeUndefined();
      expect(
        extractUserUpdateFromSCIM(
          patchBody([{ op: "Replace", path: "active", value }]),
        )["active"],
      ).toBeUndefined();
    },
  );

  test("ignores malformed operations while still applying valid operations", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        null,
        "Replace",
        0,
        [],
        {},
        { path: "active", value: false },
        { op: 1, path: "active", value: false },
        { op: "Replace", path: 1, value: { active: false } },
        { op: "Replace", path: "active" },
        { op: "Replace", value: false },
        { op: "Replace", value: [{ active: false }] },
        { op: "Replace", path: "userName", value: "valid@example.com" },
      ]),
    );

    expect(update["active"]).toBeUndefined();
    expect(extractEmailFromSCIM(update)).toBe("valid@example.com");
  });

  test("a later invalid active value does not discard a valid prior update", () => {
    expect(
      extractUserUpdateFromSCIM(
        patchBody([
          { op: "Replace", path: "active", value: false },
          { op: "Replace", path: "active", value: "invalid" },
        ]),
      )["active"],
    ).toBe(false);
  });

  test.each(["Delete", "Test", "Move", ""])(
    "ignores unsupported operation %s even when its value is false",
    (op: string) => {
      expect(
        extractUserUpdateFromSCIM(
          patchBody([{ op, path: "active", value: false }]),
        ),
      ).toEqual({});
    },
  );

  test("ignores unsupported paths without accidentally finding nested active", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        { op: "Replace", path: "name.active", value: false },
        { op: "Replace", path: "displayName", value: { active: false } },
        {
          op: "Replace",
          path: 'emails[type ne "work"].value',
          value: "wrong@example.com",
        },
      ]),
    );

    expect(update).toEqual({});
  });

  test("ignores malformed email and userName values safely", () => {
    const update: JSONObject = extractUserUpdateFromSCIM(
      patchBody([
        {
          op: "Replace",
          path: "userName",
          value: { value: "wrong@example.com" },
        },
        {
          op: "Replace",
          path: "emails",
          value: [null, 1, {}, { value: false }],
        },
        { op: "Replace", path: 'emails[type eq "work"].value', value: false },
      ]),
    );

    expect(update["active"]).toBeUndefined();
    expect(extractEmailFromSCIM(update)).toBe("");
  });

  test.each<JSONValue>([null, false, "Operations", {}])(
    "does not throw for a malformed Operations container: %j",
    (Operations: JSONValue) => {
      expect(() => {
        extractUserUpdateFromSCIM({ schemas: [PATCH_SCHEMA], Operations });
      }).not.toThrow();
    },
  );

  test("does not mutate an input resource or its email objects", () => {
    const resource: JSONObject = {
      active: "False",
      userName: "user@example.com",
      emails: [{ value: "email@example.com", type: "work", primary: true }],
    };
    const before: string = JSON.stringify(resource);

    extractUserUpdateFromSCIM(resource);

    expect(JSON.stringify(resource)).toBe(before);
  });

  test("does not mutate operations while replacing and removing email updates", () => {
    const body: JSONObject = patchBody([
      {
        op: "Replace",
        value: {
          active: "False",
          emails: [
            { value: "old@example.com", type: "work" },
            { value: "home@example.com", type: "home" },
          ],
        },
      },
      {
        op: "Replace",
        path: 'emails[type eq "work"].value',
        value: "new@example.com",
      },
      { op: "Remove", path: 'emails[type eq "home"]' },
    ]);
    const before: string = JSON.stringify(body);

    extractUserUpdateFromSCIM(body);

    expect(JSON.stringify(body)).toBe(before);
  });
});
