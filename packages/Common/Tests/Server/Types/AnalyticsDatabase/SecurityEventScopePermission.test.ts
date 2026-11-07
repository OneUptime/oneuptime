import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { SECURITY_EVENT_SCOPE_QUERY_KEY } from "../../../../Types/SecurityEvent/SecurityEventScope";
import { describe, expect, test } from "@jest/globals";

/*
 * A network device's Security Events page (issue #5769) narrows every read
 * of security events with the synthetic key `securityEventScope`. The
 * column check that refuses any query key that is not a column has to let
 * it through - it only narrows, and the statement generator compiles it -
 * while every other key that is not a column is still refused.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// A Security Viewer of the project, as a signed-in member's props carry it.
function securityViewer(): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function checkQuery(query: Record<string, unknown>): void {
  (
    ModelPermission as unknown as {
      checkQueryPermission: (
        modelType: typeof SecurityEvent,
        query: Record<string, unknown>,
        props: DatabaseCommonInteractionProps,
      ) => void;
    }
  ).checkQueryPermission(SecurityEvent, query, securityViewer());
}

describe("the column check and a record's security event scope", () => {
  test("the scope is among the keys that are not columns and only narrow", () => {
    expect(
      (
        ModelPermission as unknown as {
          getExcludedColumnNames: () => Array<string>;
        }
      ).getExcludedColumnNames(),
    ).toContain(SECURITY_EVENT_SCOPE_QUERY_KEY);
  });

  test("a read carrying the scope is let through", () => {
    expect(() => {
      checkQuery({
        projectId: PROJECT_ID,
        [SECURITY_EVENT_SCOPE_QUERY_KEY]: {
          observables: ["core-fw-01"],
          attributeKey: "networkDevice.id",
          attributeValues: ["33333333-3333-4333-8333-333333333333"],
        },
      });
    }).not.toThrow();
  });

  test("any other key that is not a column is still refused", () => {
    expect(() => {
      checkQuery({
        projectId: PROJECT_ID,
        securityEventScopes: { observables: ["core-fw-01"] },
      });
    }).toThrow(BadDataException);
  });
});
