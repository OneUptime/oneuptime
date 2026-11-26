import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { SECURITY_EVENT_ARRIVAL_QUERY_KEY } from "../../../../Types/SecurityEvent/SecurityEventArrival";
import { describe, expect, test } from "@jest/globals";

/*
 * A scheduled hunt counts the events that arrived in its run's window as
 * the person it runs as, and its notification opens the Events page on the
 * same events, as whoever opens it (#10488). Both carry the range under the
 * synthetic key `securityEventArrival`. The column check that refuses any
 * query key that is not a column has to let it through - it only narrows,
 * and the statement generator compiles it - while every other key that is
 * not a column is still refused.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// A member of the project, as a signed-in member's props carry them.
function member(): DatabaseCommonInteractionProps {
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
  ).checkQueryPermission(SecurityEvent, query, member());
}

describe("the column check and a read of what arrived", () => {
  test("the range is among the keys that are not columns and only narrow", () => {
    expect(
      (
        ModelPermission as unknown as {
          getExcludedColumnNames: () => Array<string>;
        }
      ).getExcludedColumnNames(),
    ).toContain(SECURITY_EVENT_ARRIVAL_QUERY_KEY);
  });

  test("a read carrying a range is let through", () => {
    expect(() => {
      checkQuery({
        projectId: PROJECT_ID,
        [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: {
          arrivedAfter: "2026-10-29T10:58:00.000Z",
          arrivedUntil: "2026-10-29T11:58:00.000Z",
        },
      });
    }).not.toThrow();
  });

  test("any other key that is not a column is still refused", () => {
    expect(() => {
      checkQuery({
        projectId: PROJECT_ID,
        securityEventArrivals: {
          arrivedAfter: "2026-10-29T10:58:00.000Z",
          arrivedUntil: "2026-10-29T11:58:00.000Z",
        },
      });
    }).toThrow(BadDataException);
  });
});
