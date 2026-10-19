import ProjectSCIMUser from "Common/Models/DatabaseModels/ProjectSCIMUser";
import { ProjectSCIMUserRecordData } from "Common/Server/Services/ProjectSCIMUserService";
import ColumnLength from "Common/Types/Database/ColumnLength";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * ---------------------------------------------------------------------------
 * THE SCIM USER A PROJECT CONNECTION ANSWERS WITH.
 *
 * A SCIM user is the identity provider's record of a person: the userName,
 * externalId, names and emails it sent, and whether it has them active. The
 * connection keeps what was last sent (ProjectSCIMUser) and answers with it,
 * so what an identity provider reads back is what it wrote - a deactivated
 * user is still there, inactive; a cleared display name is cleared. Okta's
 * and Microsoft Entra ID's validation suites read every attribute back after
 * they write it.
 *
 * The OneUptime account behind it is another thing: its email address is how
 * the person signs in, everywhere, and changes only as
 * ProjectSCIMAccountPolicy allows. getAccountEmail and getAccountName say what
 * the identity provider would have the account be.
 *
 * In a ScimUserResource an attribute that is absent was never sent, and the
 * answer falls back to the account's own value; one that is null was
 * cleared, and is left out of the answer. "" is a value like any other.
 * ---------------------------------------------------------------------------
 */

export const SCIM_USER_SCHEMA: string =
  "urn:ietf:params:scim:schemas:core:2.0:User";

// Longer text than this is cut: what a record's columns hold.
export const MAX_SCIM_USER_TEXT_LENGTH: number = ColumnLength.LongText;

// More emails than this are not kept.
export const MAX_SCIM_USER_EMAILS: number = 10;

// An email's type ("work", "home") is short.
const MAX_SCIM_EMAIL_TYPE_LENGTH: number = 50;

// Longer than any address (RFC 5321 allows 254 characters).
const MAX_EMAIL_ADDRESS_LENGTH: number = 320;

// A PATCH path longer than this names nothing OneUptime keeps.
const MAX_SCIM_PATH_LENGTH: number = 256;

const USER_SCHEMA_PREFIX: string = `${SCIM_USER_SCHEMA.toLowerCase()}:`;

export interface ScimUserNameParts {
  givenName?: string | null;
  familyName?: string | null;
  formatted?: string | null;
}

export interface ScimUserEmail {
  value: string;
  type?: string | undefined;
  primary?: boolean | undefined;
}

export interface ScimUserResource {
  userName?: string | null;
  externalId?: string | null;
  displayName?: string | null;
  name?: ScimUserNameParts | null;
  emails?: Array<ScimUserEmail> | null;
  active?: boolean;
}

// The account a SCIM user is, as the answer reads it.
export interface ScimUserAccount {
  id: ObjectID;
  email: string;
  name: string;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

const isObject: (value: unknown) => value is JSONObject = (
  value: unknown,
): value is JSONObject => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

// Text as SCIM sends it: a string, cut to fit; a number or boolean, written out.
const readText: (value: unknown) => string | null | undefined = (
  value: unknown,
): string | null | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.substring(0, MAX_SCIM_USER_TEXT_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
};

/*
 * `active` as SCIM sends it: a boolean, or - from Microsoft Entra ID - the
 * strings "True" and "False".
 */
export const readScimActive: (value: unknown) => boolean | undefined = (
  value: unknown,
): boolean | undefined => {
  const active: unknown =
    typeof value === "string" ? value.trim().toLowerCase() : value;

  if (active === true || active === "true") {
    return true;
  }

  if (active === false || active === "false") {
    return false;
  }

  return undefined;
};

// The value of `object`'s key `name`, whatever its case (RFC 7643, 2.1).
const getAttribute: (object: JSONObject, name: string) => unknown = (
  object: JSONObject,
  name: string,
): unknown => {
  const lowerCaseName: string = name.toLowerCase();

  for (const key of Object.keys(object)) {
    if (key.toLowerCase() === lowerCaseName) {
      return object[key];
    }
  }

  return undefined;
};

const hasAttribute: (object: JSONObject, name: string) => boolean = (
  object: JSONObject,
  name: string,
): boolean => {
  const lowerCaseName: string = name.toLowerCase();

  return Object.keys(object).some((key: string): boolean => {
    return key.toLowerCase() === lowerCaseName;
  });
};

const NAME_PARTS: ReadonlyArray<keyof ScimUserNameParts> = [
  "givenName",
  "familyName",
  "formatted",
];

const readName: (value: unknown) => ScimUserNameParts | null | undefined = (
  value: unknown,
): ScimUserNameParts | null | undefined => {
  if (value === null) {
    return null;
  }

  if (!isObject(value)) {
    return undefined;
  }

  const name: ScimUserNameParts = {};

  for (const part of NAME_PARTS) {
    if (!hasAttribute(value, part)) {
      continue;
    }

    const text: string | null | undefined = readText(getAttribute(value, part));

    if (text !== undefined) {
      name[part] = text;
    }
  }

  return name;
};

const readEmail: (value: unknown) => ScimUserEmail | null = (
  value: unknown,
): ScimUserEmail | null => {
  if (!isObject(value)) {
    return null;
  }

  const address: unknown = getAttribute(value, "value");

  if (typeof address !== "string") {
    return null;
  }

  const email: ScimUserEmail = {
    value: address.substring(0, MAX_SCIM_USER_TEXT_LENGTH),
  };

  const type: unknown = getAttribute(value, "type");

  if (typeof type === "string") {
    email.type = type.substring(0, MAX_SCIM_EMAIL_TYPE_LENGTH);
  }

  const primary: boolean | undefined = readScimActive(
    getAttribute(value, "primary"),
  );

  if (primary !== undefined) {
    email.primary = primary;
  }

  return email;
};

const readEmails: (
  value: unknown,
) => Array<ScimUserEmail> | null | undefined = (
  value: unknown,
): Array<ScimUserEmail> | null | undefined => {
  if (value === null) {
    return null;
  }

  const entries: Array<unknown> | null = Array.isArray(value)
    ? value
    : isObject(value)
      ? [value]
      : null;

  if (!entries) {
    return undefined;
  }

  const emails: Array<ScimUserEmail> = [];

  for (const entry of entries) {
    const email: ScimUserEmail | null = readEmail(entry);

    if (email) {
      emails.push(email);
    }

    if (emails.length >= MAX_SCIM_USER_EMAILS) {
      break;
    }
  }

  return emails;
};

/*
 * What a whole user (POST, PUT) asks the connection to keep. Attributes
 * OneUptime does not keep - a title, a phone number, a password - are left
 * out.
 */
export const readScimUserResource: (body: unknown) => ScimUserResource = (
  body: unknown,
): ScimUserResource => {
  const resource: ScimUserResource = {};

  if (!isObject(body)) {
    return resource;
  }

  applyAttributes(resource, "replace", body);

  return resource;
};

const withoutUserSchema: (path: string) => string = (path: string): string => {
  return path.toLowerCase().startsWith(USER_SCHEMA_PREFIX)
    ? path.substring(USER_SCHEMA_PREFIX.length)
    : path;
};

// A filter on emails, as a value path writes it: [type eq "work"].
interface EmailSelector {
  attribute: "type" | "primary" | "value";
  value: string | boolean;
}

/*
 * emails, emails.value, emails[type eq "work"], emails[type eq "work"].value,
 * emails[primary eq true].value: what an emails PATCH path selects, or null
 * when the path is not about emails. `subAttribute` is "value" when the path
 * ends with it.
 */
const readEmailsPath: (path: string) => {
  selector: EmailSelector | null;
  subAttribute: "value" | null;
} | null = (
  path: string,
): {
  selector: EmailSelector | null;
  subAttribute: "value" | null;
} | null => {
  const lowerCasePath: string = path.toLowerCase();

  if (!lowerCasePath.startsWith("emails")) {
    return null;
  }

  let rest: string = path.substring("emails".length).trim();
  let selector: EmailSelector | null = null;

  if (rest.startsWith("[")) {
    const end: number = rest.indexOf("]");

    if (end < 0) {
      return null;
    }

    const filter: string = rest.substring(1, end).trim();
    rest = rest.substring(end + 1).trim();

    // attribute eq value, with the value quoted or a boolean.
    const parts: Array<string> = filter.split(/\s+/);

    if (parts.length < 3 || parts[1]!.toLowerCase() !== "eq") {
      return null;
    }

    const attribute: string = parts[0]!.toLowerCase();
    const rawValue: string = parts.slice(2).join(" ");

    if (
      attribute !== "type" &&
      attribute !== "primary" &&
      attribute !== "value"
    ) {
      return null;
    }

    let value: string | boolean;

    if (rawValue.length >= 2 && rawValue.startsWith('"')) {
      if (!rawValue.endsWith('"')) {
        return null;
      }

      value = rawValue.substring(1, rawValue.length - 1);
    } else if (readScimActive(rawValue) !== undefined) {
      value = readScimActive(rawValue)!;
    } else {
      return null;
    }

    selector = { attribute: attribute, value: value };
  }

  if (rest === "") {
    return { selector: selector, subAttribute: null };
  }

  if (rest.toLowerCase() === ".value") {
    return { selector: selector, subAttribute: "value" };
  }

  return null;
};

const emailMatches: (
  email: ScimUserEmail,
  selector: EmailSelector | null,
) => boolean = (
  email: ScimUserEmail,
  selector: EmailSelector | null,
): boolean => {
  if (!selector) {
    return true;
  }

  if (selector.attribute === "primary") {
    return Boolean(email.primary) === Boolean(selector.value);
  }

  if (selector.attribute === "type") {
    return (
      typeof email.type === "string" &&
      email.type.toLowerCase() === String(selector.value).toLowerCase()
    );
  }

  return email.value.toLowerCase() === String(selector.value).toLowerCase();
};

// A new email the selector would match: { value, type: "work" } for [type eq "work"].
const newEmailFor: (
  value: string,
  selector: EmailSelector | null,
) => ScimUserEmail = (
  value: string,
  selector: EmailSelector | null,
): ScimUserEmail => {
  const email: ScimUserEmail = { value: value };

  if (selector?.attribute === "type" && typeof selector.value === "string") {
    email.type = selector.value;
  }

  if (
    selector?.attribute === "primary" &&
    typeof selector.value === "boolean"
  ) {
    email.primary = selector.value;
  }

  return email;
};

const applyEmailsPath: (
  resource: ScimUserResource,
  op: string,
  path: {
    selector: EmailSelector | null;
    subAttribute: "value" | null;
  },
  value: unknown,
) => void = (
  resource: ScimUserResource,
  op: string,
  path: {
    selector: EmailSelector | null;
    subAttribute: "value" | null;
  },
  value: unknown,
): void => {
  const current: Array<ScimUserEmail> = resource.emails
    ? resource.emails.map((email: ScimUserEmail): ScimUserEmail => {
        return { ...email };
      })
    : [];

  // The whole attribute: emails.
  if (!path.selector && !path.subAttribute) {
    if (op === "remove") {
      resource.emails = null;
      return;
    }

    const emails: Array<ScimUserEmail> | null | undefined = readEmails(value);

    if (emails === undefined) {
      return;
    }

    resource.emails =
      op === "add" && emails
        ? [...current, ...emails].slice(0, MAX_SCIM_USER_EMAILS)
        : emails;
    return;
  }

  if (op === "remove") {
    if (path.subAttribute && !path.selector) {
      // emails.value: no address is left.
      resource.emails = null;
      return;
    }

    const remaining: Array<ScimUserEmail> = current.filter(
      (email: ScimUserEmail): boolean => {
        return !emailMatches(email, path.selector);
      },
    );

    resource.emails = remaining.length > 0 ? remaining : null;
    return;
  }

  // emails[...].value or emails.value: the address of the matching emails.
  if (path.subAttribute) {
    const address: string | null | undefined = readText(value);

    if (address === undefined) {
      return;
    }

    if (address === null) {
      const remaining: Array<ScimUserEmail> = current.filter(
        (email: ScimUserEmail): boolean => {
          return !emailMatches(email, path.selector);
        },
      );

      resource.emails = remaining.length > 0 ? remaining : null;
      return;
    }

    let matched: boolean = false;

    const emails: Array<ScimUserEmail> = current.map(
      (email: ScimUserEmail): ScimUserEmail => {
        if (!emailMatches(email, path.selector)) {
          return email;
        }

        matched = true;
        return { ...email, value: address };
      },
    );

    if (!matched) {
      emails.push(newEmailFor(address, path.selector));
    }

    resource.emails = emails.slice(0, MAX_SCIM_USER_EMAILS);
    return;
  }

  // emails[...]: the matching emails, replaced by the ones sent.
  const sent: Array<ScimUserEmail> | null | undefined = readEmails(value);

  if (!sent) {
    return;
  }

  const withSelector: Array<ScimUserEmail> = sent.map(
    (email: ScimUserEmail): ScimUserEmail => {
      return { ...newEmailFor(email.value, path.selector), ...email };
    },
  );

  const kept: Array<ScimUserEmail> = current.filter(
    (email: ScimUserEmail): boolean => {
      return !emailMatches(email, path.selector);
    },
  );

  resource.emails = [...kept, ...withSelector].slice(0, MAX_SCIM_USER_EMAILS);
};

/*
 * Applies one attribute a request names - by a PATCH path, or as a key of a
 * whole user or of a PATCH value - to `resource`.
 */
const applyPath: (
  resource: ScimUserResource,
  op: string,
  rawPath: string,
  value: unknown,
) => void = (
  resource: ScimUserResource,
  op: string,
  rawPath: string,
  value: unknown,
): void => {
  if (rawPath.length > MAX_SCIM_PATH_LENGTH) {
    return;
  }

  const path: string = withoutUserSchema(rawPath.trim());
  const lowerCasePath: string = path.toLowerCase();

  switch (lowerCasePath) {
    case "username":
    case "externalid":
    case "displayname": {
      const attribute: "userName" | "externalId" | "displayName" =
        lowerCasePath === "username"
          ? "userName"
          : lowerCasePath === "externalid"
            ? "externalId"
            : "displayName";

      if (op === "remove") {
        resource[attribute] = null;
        return;
      }

      const text: string | null | undefined = readText(value);

      if (text !== undefined) {
        resource[attribute] = text;
      }

      return;
    }

    case "active": {
      // Removing active is not a request to deactivate.
      if (op === "remove") {
        return;
      }

      const active: boolean | undefined = readScimActive(value);

      if (active !== undefined) {
        resource.active = active;
      }

      return;
    }

    case "name": {
      if (op === "remove") {
        resource.name = null;
        return;
      }

      const name: ScimUserNameParts | null | undefined = readName(value);

      if (name === undefined) {
        return;
      }

      resource.name =
        name === null ? null : { ...(resource.name || {}), ...name };
      return;
    }

    case "name.givenname":
    case "name.familyname":
    case "name.formatted": {
      const part: keyof ScimUserNameParts =
        lowerCasePath === "name.givenname"
          ? "givenName"
          : lowerCasePath === "name.familyname"
            ? "familyName"
            : "formatted";

      const text: string | null | undefined =
        op === "remove" ? null : readText(value);

      if (text === undefined) {
        return;
      }

      resource.name = { ...(resource.name || {}), [part]: text };
      return;
    }
  }

  const emailsPath: {
    selector: EmailSelector | null;
    subAttribute: "value" | null;
  } | null = readEmailsPath(path);

  if (emailsPath) {
    applyEmailsPath(resource, op, emailsPath, value);
  }

  // Anything else is an attribute OneUptime does not keep.
};

// Every attribute of `attributes`, as if each were a path of its own.
const applyAttributes: (
  resource: ScimUserResource,
  op: string,
  attributes: JSONObject,
) => void = (
  resource: ScimUserResource,
  op: string,
  attributes: JSONObject,
): void => {
  for (const key of Object.keys(attributes)) {
    applyPath(resource, op, key, attributes[key]);
  }
};

const cloneResource: (resource: ScimUserResource) => ScimUserResource = (
  resource: ScimUserResource,
): ScimUserResource => {
  const clone: ScimUserResource = { ...resource };

  if (resource.name) {
    clone.name = { ...resource.name };
  }

  if (resource.emails) {
    clone.emails = resource.emails.map(
      (email: ScimUserEmail): ScimUserEmail => {
        return { ...email };
      },
    );
  }

  return clone;
};

/*
 * `current` with a PATCH request's Operations applied, in order (RFC 7644,
 * section 3.5.2): add, replace and remove, with or without a path, in any
 * case - Microsoft Entra ID sends "Replace" - and Entra ID's forms of
 * multi-attribute replace ({"name.givenName": ...} as one value). Operations
 * on attributes OneUptime does not keep, or that it cannot read, are left
 * alone. `current` is not changed.
 */
export const applyScimUserPatch: (
  current: ScimUserResource,
  operations: unknown,
) => ScimUserResource = (
  current: ScimUserResource,
  operations: unknown,
): ScimUserResource => {
  const resource: ScimUserResource = cloneResource(current);

  if (!Array.isArray(operations)) {
    return resource;
  }

  for (const operation of operations) {
    if (!isObject(operation) || typeof operation["op"] !== "string") {
      continue;
    }

    const op: string = operation["op"].toLowerCase();

    if (op !== "add" && op !== "replace" && op !== "remove") {
      continue;
    }

    const path: unknown = operation["path"];
    const value: unknown = operation["value"];

    if (path === undefined || path === null || path === "") {
      // A remove names what it removes.
      if (op !== "remove" && isObject(value)) {
        applyAttributes(resource, op, value);
      }

      continue;
    }

    if (typeof path === "string") {
      applyPath(resource, op, path, value);
    }
  }

  return resource;
};

// What a record holds, as a ScimUserResource.
export const getScimUserResourceOfRecord: (
  record: ProjectSCIMUser,
) => ScimUserResource = (record: ProjectSCIMUser): ScimUserResource => {
  const resource: ScimUserResource = {};

  if (record.userName !== undefined) {
    resource.userName = record.userName;
  }

  if (record.externalId !== undefined) {
    resource.externalId = record.externalId;
  }

  if (typeof record.isActive === "boolean") {
    resource.active = record.isActive;
  }

  const attributes: unknown = record.scimAttributes;

  if (isObject(attributes)) {
    if ("displayName" in attributes) {
      const displayName: string | null | undefined = readText(
        attributes["displayName"],
      );

      if (displayName !== undefined) {
        resource.displayName = displayName;
      }
    }

    if ("name" in attributes) {
      const name: ScimUserNameParts | null | undefined = readName(
        attributes["name"],
      );

      if (name !== undefined) {
        resource.name = name;
      }
    }

    if ("emails" in attributes) {
      const emails: Array<ScimUserEmail> | null | undefined = readEmails(
        attributes["emails"],
      );

      if (emails !== undefined) {
        resource.emails = emails;
      }
    }
  }

  return resource;
};

/*
 * The SCIM user an account is before its connection keeps anything of it -
 * a member of the project the identity provider has not written - as the
 * answer shows it: what a PATCH to such a user starts from.
 */
export const getScimUserResourceOfAccount: (
  account: ScimUserAccount,
) => ScimUserResource = (account: ScimUserAccount): ScimUserResource => {
  const name: { givenName: string; familyName: string; formatted: string } =
    splitName(getDisplayName(account));

  return {
    userName: account.email,
    displayName: name.formatted,
    name: name,
    emails: [{ value: account.email, type: "work", primary: true }],
    active: true,
  };
};

// What a record of `resource` holds.
export const getRecordDataOfScimUserResource: (data: {
  resource: ScimUserResource;
  projectId: ObjectID;
  projectScimId: ObjectID;
  userId: ObjectID;
  isActive: boolean;
}) => ProjectSCIMUserRecordData = (data: {
  resource: ScimUserResource;
  projectId: ObjectID;
  projectScimId: ObjectID;
  userId: ObjectID;
  isActive: boolean;
}): ProjectSCIMUserRecordData => {
  const scimAttributes: JSONObject = {};

  if (data.resource.displayName !== undefined) {
    scimAttributes["displayName"] = data.resource.displayName;
  }

  if (data.resource.name !== undefined) {
    scimAttributes["name"] = data.resource.name as JSONObject | null;
  }

  if (data.resource.emails !== undefined) {
    scimAttributes["emails"] = data.resource.emails as unknown as JSONObject;
  }

  return {
    projectId: data.projectId,
    projectScimId: data.projectScimId,
    userId: data.userId,
    isActive: data.isActive,
    userName:
      data.resource.userName === undefined ? null : data.resource.userName,
    externalId:
      data.resource.externalId === undefined ? null : data.resource.externalId,
    scimAttributes: scimAttributes,
  };
};

const isEmailAddress: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return (
    typeof value === "string" &&
    value.length <= MAX_EMAIL_ADDRESS_LENGTH &&
    Email.isValid(value.trim())
  );
};

/*
 * The address the identity provider would have the account sign in with:
 * its userName when that is an address, else its primary email, its work
 * email, or its first - or null, when it sent no address at all.
 */
export const getAccountEmail: (resource: ScimUserResource) => string | null = (
  resource: ScimUserResource,
): string | null => {
  if (isEmailAddress(resource.userName)) {
    return resource.userName.trim();
  }

  const emails: Array<ScimUserEmail> = resource.emails || [];

  const candidates: Array<ScimUserEmail | undefined> = [
    emails.find((email: ScimUserEmail): boolean => {
      return email.primary === true;
    }),
    emails.find((email: ScimUserEmail): boolean => {
      return email.type?.toLowerCase() === "work";
    }),
    emails[0],
  ];

  for (const candidate of candidates) {
    if (candidate && isEmailAddress(candidate.value)) {
      return candidate.value.trim();
    }
  }

  return null;
};

/*
 * The name the identity provider would have the account carry: the
 * formatted name, else the given and family names, else the display name -
 * or "", when it sent none.
 */
export const getAccountName: (resource: ScimUserResource) => string = (
  resource: ScimUserResource,
): string => {
  const name: ScimUserNameParts = resource.name || {};

  if (typeof name.formatted === "string" && name.formatted.trim()) {
    return name.formatted.trim();
  }

  const givenAndFamily: string = [name.givenName, name.familyName]
    .filter((part: string | null | undefined): part is string => {
      return typeof part === "string" && part.trim() !== "";
    })
    .map((part: string): string => {
      return part.trim();
    })
    .join(" ");

  if (givenAndFamily) {
    return givenAndFamily;
  }

  return typeof resource.displayName === "string"
    ? resource.displayName.trim()
    : "";
};

const getDisplayName: (account: ScimUserAccount) => string = (
  account: ScimUserAccount,
): string => {
  return account.name || account.email.split("@")[0] || "Unknown User";
};

const splitName: (fullName: string) => {
  givenName: string;
  familyName: string;
  formatted: string;
} = (
  fullName: string,
): { givenName: string; familyName: string; formatted: string } => {
  const parts: Array<string> = fullName.trim().split(/\s+/);

  return {
    givenName: parts[0] || "",
    familyName: parts.slice(1).join(" "),
    formatted: fullName,
  };
};

/*
 * The SCIM user to answer with: what the identity provider sent, where it
 * sent something, and the account's own values where it did not. A user the
 * connection keeps no record of is active.
 */
export const renderScimUser: (data: {
  account: ScimUserAccount;
  record: ProjectSCIMUser | null;
  // Where the user is: <SCIM base URL>/Users/<id>.
  location: string;
}) => JSONObject = (data: {
  account: ScimUserAccount;
  record: ProjectSCIMUser | null;
  location: string;
}): JSONObject => {
  const sent: ScimUserResource = data.record
    ? getScimUserResourceOfRecord(data.record)
    : {};
  const derived: { givenName: string; familyName: string; formatted: string } =
    splitName(getDisplayName(data.account));

  const user: JSONObject = {
    schemas: [SCIM_USER_SCHEMA],
    id: data.account.id.toString(),
  };

  if (typeof sent.externalId === "string") {
    user["externalId"] = sent.externalId;
  }

  user["userName"] = sent.userName ? sent.userName : data.account.email;

  if (sent.name === undefined) {
    user["name"] = { ...derived };
  } else if (sent.name !== null) {
    const name: JSONObject = {};

    for (const part of NAME_PARTS) {
      const value: string | null | undefined = sent.name[part];

      if (typeof value === "string") {
        name[part] = value;
      }
    }

    if (!("formatted" in sent.name)) {
      const formatted: string = [sent.name.givenName, sent.name.familyName]
        .filter((part: string | null | undefined): part is string => {
          return typeof part === "string" && part !== "";
        })
        .join(" ");

      if (formatted) {
        name["formatted"] = formatted;
      }
    }

    user["name"] = name;
  }

  if (sent.displayName === undefined) {
    user["displayName"] = derived.formatted;
  } else if (sent.displayName !== null) {
    user["displayName"] = sent.displayName;
  }

  if (sent.emails === undefined) {
    user["emails"] = [
      { value: data.account.email, type: "work", primary: true },
    ];
  } else if (sent.emails !== null && sent.emails.length > 0) {
    user["emails"] = sent.emails.map((email: ScimUserEmail): JSONObject => {
      const entry: JSONObject = { value: email.value };

      if (email.type !== undefined) {
        entry["type"] = email.type;
      }

      if (email.primary !== undefined) {
        entry["primary"] = email.primary;
      }

      return entry;
    });
  }

  user["active"] = data.record ? data.record.isActive !== false : true;

  const created: Date | undefined =
    data.record?.createdAt || data.account.createdAt;
  const lastModified: Date | undefined =
    data.record?.updatedAt || data.account.updatedAt;

  user["meta"] = {
    resourceType: "User",
    ...(created ? { created: new Date(created).toISOString() } : {}),
    ...(lastModified
      ? { lastModified: new Date(lastModified).toISOString() }
      : {}),
    location: data.location,
  };

  return user;
};
