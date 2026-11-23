import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreatePermission from "../../../Server/Types/Database/Permissions/CreatePermission";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";

/*
 * A RECORD AS A CREATE'S COLUMN CHECKS WILL READ IT (#8952).
 *
 * A service that checks a create's columns itself before the create starts
 * (OnCallDutyPolicyChildService, on an on-call row as it was handed in)
 * first does to the record what the create does before its own checks
 * (DatabaseService.takeOutWhatTheServerSetsOnCreate): who did something to
 * it is taken out, for OneUptime to stamp, and a value in a server-set
 * column is held to its create list - dropped when the caller may read the
 * column, refused with its name when they may not, kept when they may
 * create it. So the early check asks what the create asks, and is never
 * looser than the create for what a caller sends.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "89520000-0000-4000-8000-0000000000f1",
);
const SOMEONE_ELSE: ObjectID = new ObjectID(
  "89520000-0000-4000-8000-0000000000f2",
);

// The helper is protected: a service's own early check calls it.
class ServiceThatChecksEarly<
  TBaseModel extends Incident | StatusPageSubscriber,
> extends DatabaseService<TBaseModel> {
  public takeOut(createBy: CreateBy<TBaseModel>): void {
    this.takeOutWhatTheServerSetsOnCreate(createBy);
  }
}

const subscribers: ServiceThatChecksEarly<StatusPageSubscriber> =
  new ServiceThatChecksEarly<StatusPageSubscriber>(StatusPageSubscriber);
const incidents: ServiceThatChecksEarly<Incident> =
  new ServiceThatChecksEarly<Incident>(Incident);

function member(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function subscriber(values: Record<string, unknown>): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  Object.assign(row as unknown as Record<string, unknown>, {
    projectId: PROJECT_ID,
    statusPageId: ObjectID.generate(),
    subscriberEmail: "ada@acme.com",
    ...values,
  });
  return row;
}

function value(row: unknown, column: string): unknown {
  return (row as Record<string, unknown>)[column];
}

describe("who did something to the record", () => {
  test("is taken out of a person's create, under both names, and the early check then lets it through", () => {
    const props: DatabaseCommonInteractionProps = member(
      Permission.StatusPageAdmin,
    );
    const row: StatusPageSubscriber = subscriber({
      createdByUserId: SOMEONE_ELSE,
      createdByUser: { _id: SOMEONE_ELSE.toString() },
    });

    // As handed in, the row is refused: nobody may give a new record its creator.
    expect(() => {
      CreatePermission.checkCreatePermissions(StatusPageSubscriber, row, props);
    }).toThrow(ColumnWriteRefusedException);

    subscribers.takeOut({ data: row, props: props });

    expect(value(row, "createdByUserId")).toBeUndefined();
    expect(value(row, "createdByUser")).toBeUndefined();
    expect(() => {
      CreatePermission.checkCreatePermissions(StatusPageSubscriber, row, props);
    }).not.toThrow();
  });

  test("an API key's and a workflow's create (no person) are taken out the same way", () => {
    const props: DatabaseCommonInteractionProps = {
      ...customDomainCaller({
        permissions: [Permission.StatusPageAdmin],
        projectId: PROJECT_ID,
        isApiKey: true,
      }),
      ...ON_HIGHEST_PLAN,
    };
    const row: StatusPageSubscriber = subscriber({
      createdByUserId: SOMEONE_ELSE,
    });

    subscribers.takeOut({ data: row, props: props });

    expect(value(row, "createdByUserId")).toBeUndefined();
  });

  test("OneUptime's own write keeps the person it names", () => {
    const row: StatusPageSubscriber = subscriber({
      createdByUserId: SOMEONE_ELSE,
    });

    subscribers.takeOut({
      data: row,
      props: { isRoot: true, userId: SOMEONE_ELSE },
    });

    expect(String(value(row, "createdByUserId"))).toBe(SOMEONE_ELSE.toString());
  });
});

describe("a value in a server-set column", () => {
  test("is dropped when the caller may read the column, as the create drops it", () => {
    const row: StatusPageSubscriber = subscriber({
      unsubscribedAt: new Date("2026-11-01T00:00:00.000Z"),
      isAddedByTeam: true,
    });

    subscribers.takeOut({
      data: row,
      props: member(Permission.StatusPageAdmin),
    });

    expect(value(row, "unsubscribedAt")).toBeUndefined();
    expect(value(row, "isAddedByTeam")).toBeUndefined();
    expect(value(row, "subscriberEmail")).toBe("ada@acme.com");
  });

  test("is refused, by its name, when nobody may read the column: never looser than the create", () => {
    const row: StatusPageSubscriber = subscriber({
      unsubscribeToken: "a token the caller made up",
    });

    expect(() => {
      subscribers.takeOut({
        data: row,
        props: member(Permission.StatusPageAdmin),
      });
    }).toThrow(
      "User is not allowed to create on unsubscribeToken column of Status Page Subscriber.",
    );
  });

  test("is kept when the caller may create the column", () => {
    const state: IncidentState = new IncidentState();
    state._id = ObjectID.generate().toString();

    const incident: Incident = new Incident();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is down";
    incident.currentIncidentState = state;

    incidents.takeOut({
      data: incident,
      props: member(Permission.IncidentMember),
    });

    expect(incident.currentIncidentState).toBe(state);
  });

  test("is kept when OneUptime's own code marked it for the person it writes as", () => {
    const row: StatusPageSubscriber = subscriber({});
    ServerSetColumns.set(row, { isAddedByTeam: true });

    subscribers.takeOut({
      data: row,
      props: member(Permission.StatusPageAdmin),
    });

    expect(value(row, "isAddedByTeam")).toBe(true);
  });

  test("is kept, unasked, for OneUptime itself and a server admin", () => {
    for (const props of [{ isRoot: true }, { isMasterAdmin: true }]) {
      const row: StatusPageSubscriber = subscriber({
        unsubscribeToken: "OneUptime's own token",
        isAddedByTeam: true,
      });

      subscribers.takeOut({ data: row, props: props });

      expect(value(row, "unsubscribeToken")).toBe("OneUptime's own token");
      expect(value(row, "isAddedByTeam")).toBe(true);
    }
  });
});
