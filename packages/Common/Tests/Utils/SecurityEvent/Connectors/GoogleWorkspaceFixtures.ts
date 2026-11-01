import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * Google Workspace activities as the Admin SDK Reports API returns them
 * (developers.google.com/admin-sdk/reports/reference/rest/v1/activities):
 * an actor, when and from where, and its events with their parameters.
 * Made-up domain, people and documentation addresses. Not a test file
 * itself.
 */

// The events each application writes, with the type Google files them under.
const EVENT_TYPES: Record<string, Record<string, string>> = {
  login: {
    login_success: "login",
    login_failure: "login",
    login_challenge: "login",
    logout: "logout",
    suspicious_login: "account_warning",
    suspicious_login_less_secure_app: "account_warning",
    suspicious_programmatic_login: "account_warning",
    gov_attack_warning: "attack_warning",
    account_disabled_hijacked: "account_warning",
  },
  admin: {
    ASSIGN_ROLE: "DELEGATED_ADMIN_SETTINGS",
    GRANT_ADMIN_PRIVILEGE: "USER_SETTINGS",
    REVOKE_ADMIN_PRIVILEGE: "USER_SETTINGS",
    CREATE_USER: "USER_SETTINGS",
    DELETE_USER: "USER_SETTINGS",
    SUSPEND_USER: "USER_SETTINGS",
    TURN_OFF_2_STEP_VERIFICATION: "USER_SETTINGS",
    ADD_GROUP_MEMBER: "GROUP_SETTINGS",
    AUTHORIZE_API_CLIENT_ACCESS: "SECURITY_SETTINGS",
    CHANGE_APPLICATION_SETTING: "APPLICATION_SETTINGS",
  },
  token: { authorize: "auth", revoke: "auth" },
  saml: { login_success: "login", login_failure: "login" },
  user_accounts: {
    "2sv_disable": "2sv_change",
    "2sv_enroll": "2sv_change",
    password_change: "password_change",
    recovery_email_change: "recovery_info_change",
  },
  drive: {
    download: "access",
    change_document_visibility: "acl_change",
    change_user_access: "acl_change",
    view: "access",
  },
};

export function googleWorkspaceActivity(
  application: string,
  eventName: string,
  parameters: Array<JSONObject> = [],
  overrides: JSONObject = {},
): JSONObject {
  return {
    kind: "admin#reports#activity",
    id: {
      time: "2026-10-30T09:45:12.345Z",
      uniqueQualifier: "-7461213048771283016",
      applicationName: application,
      customerId: "C03az79cb",
    },
    etag: '"JDMC8884sebSctZ17CIssbQ/LsQJTV4F0vDB9pUMtk4ndPBR5EY"',
    actor: {
      callerType: "USER",
      email: "alice@example.com",
      profileId: "114511147312345678901",
    },
    ipAddress: "203.0.113.7",
    events: [
      {
        type: EVENT_TYPES[application]?.[eventName] || "other",
        name: eventName,
        parameters: parameters as Array<JSONValue>,
      },
    ],
    ...overrides,
  };
}
