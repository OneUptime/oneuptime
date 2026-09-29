import Incident from "../../../Models/DatabaseModels/Incident";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentService from "../../../Server/Services/IncidentService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import BasePermission from "../../../Server/Types/Database/Permissions/BasePermission";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Turning 'Visible on Status Page' on for an incident that was declared hidden
 * can also tell its status page subscribers it was created: the edit form's
 * "Notify subscribers that this incident was created" box travels as a misc
 * data prop, and IncidentService.onBeforeUpdate turns it into a Pending
 * 'created' notification in the same write (see IncidentCreatedRenotify).
 *
 * What must hold:
 *   - ticking it on publish re-queues a Skipped notification;
 *   - without the box, with notify-on-create off, or for an incident that is
 *     not actually being published, nothing is re-queued;
 *   - a notification that is not Skipped (sent, failed, pending, sending) is
 *     never re-queued, so publishing cannot email subscribers twice;
 *   - the API route of setting the status explicitly keeps working;
 *   - a non-root incident member can do it: the hook injects the status
 *     column before the column-permission check runs, and that check lets
 *     the incident roles through.
 *
 * The stored incident is served by a stub of findBy; everything else in the
 * hook that would reach a database is stubbed too.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

type OnBeforeUpdate = (
  updateBy: UpdateBy<Incident>,
) => Promise<OnUpdate<Incident>>;

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function storedIncident(overrides: Partial<Incident> = {}): Incident {
  const incident: Incident = new Incident();
  incident._id = incidentId.toString();
  incident.isVisibleOnStatusPage = false;
  incident.isPrivate = false;
  incident.subscriberNotificationStatusOnIncidentCreated =
    StatusPageSubscriberNotificationStatus.Skipped;
  incident.subscriberNotificationStatusMessage =
    IncidentCreatedRenotify.hiddenFromStatusPagesMessage;
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = true;
  Object.assign(incident, overrides);
  return incident;
}

let storedIncidents: Array<Incident> = [];
let findByMock: MockFunction;

function publishUpdate(data: {
  miscDataProps?: JSONObject | undefined;
  data?: Record<string, unknown>;
  props?: DatabaseCommonInteractionProps;
}): UpdateBy<Incident> {
  return {
    query: { _id: incidentId.toString() },
    data: {
      isVisibleOnStatusPage: true,
      isPrivate: false,
      ...(data.data || {}),
    } as UpdateBy<Incident>["data"],
    props: data.props || { isRoot: true },
    miscDataProps: data.miscDataProps,
    limit: 1,
    skip: 0,
  };
}

async function runHook(
  updateBy: UpdateBy<Incident>,
): Promise<Record<string, unknown>> {
  const onUpdate: OnUpdate<Incident> = await (
    IncidentService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate(updateBy);

  return onUpdate.updateBy.data as unknown as Record<string, unknown>;
}

beforeEach(() => {
  storedIncidents = [storedIncident()];

  findByMock = getJestMockFunction();
  findByMock.mockImplementation(() => {
    return Promise.resolve(storedIncidents);
  });

  jest.spyOn(IncidentService, "findBy").mockImplementation(findByMock as never);
  jest
    .spyOn(
      IncidentService as unknown as {
        validateProjectScopedReferences: () => Promise<void>;
      },
      "validateProjectScopedReferences",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentService.onBeforeUpdate: notify subscribers when a hidden incident is published", () => {
  test("re-queues the skipped 'created' notification when the box is ticked", async () => {
    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatusMessage"]).toBe(
      IncidentCreatedRenotify.queuedMessage,
    );
    // The edit itself goes through untouched.
    expect(data["isVisibleOnStatusPage"]).toBe(true);
  });

  test('accepts the string "true" a hand-written API request may send', async () => {
    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: {
          [IncidentCreatedRenotify.miscDataKey]: "true",
        },
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("re-queues an incident whose stored visibility is null, which the worker treats as hidden", async () => {
    storedIncidents = [
      storedIncident({ isVisibleOnStatusPage: null as unknown as boolean }),
    ];

    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("reads the stored incident as root, with the update's own query", async () => {
    await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
      }),
    );

    expect(findByMock).toHaveBeenCalledTimes(1);
    const findBy: Record<string, unknown> = findByMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(findBy["props"]).toEqual({ isRoot: true });
    expect(findBy["query"]).toEqual({ _id: incidentId.toString() });
    expect(findBy["select"]).toEqual(
      expect.objectContaining({
        isVisibleOnStatusPage: true,
        isPrivate: true,
        subscriberNotificationStatusOnIncidentCreated: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      }),
    );
  });

  describe("re-queues nothing", () => {
    function expectNothingQueued(data: Record<string, unknown>): void {
      expect(
        data["subscriberNotificationStatusOnIncidentCreated"],
      ).toBeUndefined();
      expect(data["subscriberNotificationStatusMessage"]).toBeUndefined();
    }

    test("when the box is absent", async () => {
      expectNothingQueued(await runHook(publishUpdate({})));
      // It does not even look at the stored incident.
      expect(findByMock).not.toHaveBeenCalled();
    });

    test("when the box is unticked", async () => {
      expectNothingQueued(
        await runHook(
          publishUpdate({
            miscDataProps: { [IncidentCreatedRenotify.miscDataKey]: false },
          }),
        ),
      );
    });

    test("when only the notify-about-this-update box is sent", async () => {
      expectNothingQueued(
        await runHook(
          publishUpdate({
            miscDataProps: SubscriberUpdateNotification.getMiscDataProps(),
          }),
        ),
      );
    });

    test("when notifying subscribers on creation is off for the incident", async () => {
      storedIncidents = [
        storedIncident({
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
          subscriberNotificationStatusMessage:
            "Notifications skipped as subscribers are not to be notified for this incident.",
        }),
      ];

      expectNothingQueued(
        await runHook(
          publishUpdate({
            miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
          }),
        ),
      );
    });

    test("when the update does not make the incident visible", async () => {
      expectNothingQueued(
        await runHook(
          publishUpdate({
            miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
            data: { isVisibleOnStatusPage: false },
          }),
        ),
      );
      expect(findByMock).not.toHaveBeenCalled();
    });

    test("when the update does not touch visibility at all", async () => {
      const updateBy: UpdateBy<Incident> = publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
      });
      delete (updateBy.data as Record<string, unknown>)[
        "isVisibleOnStatusPage"
      ];

      expectNothingQueued(await runHook(updateBy));
    });

    test("when the incident is made private in the same edit (private incidents are hidden)", async () => {
      const data: Record<string, unknown> = await runHook(
        publishUpdate({
          miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
          data: { isPrivate: true },
        }),
      );

      expect(data["isVisibleOnStatusPage"]).toBe(false);
      expectNothingQueued(data);
    });

    test("when the stored incident is private and the edit leaves it private", async () => {
      storedIncidents = [storedIncident({ isPrivate: true })];

      const updateBy: UpdateBy<Incident> = publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
      });
      delete (updateBy.data as Record<string, unknown>)["isPrivate"];

      expectNothingQueued(await runHook(updateBy));
    });

    test("when the incident is already visible", async () => {
      storedIncidents = [storedIncident({ isVisibleOnStatusPage: true })];

      expectNothingQueued(
        await runHook(
          publishUpdate({
            miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
          }),
        ),
      );
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.InProgress,
    ])(
      "when the 'created' notification is %s",
      async (status: StatusPageSubscriberNotificationStatus) => {
        storedIncidents = [
          storedIncident({
            subscriberNotificationStatusOnIncidentCreated: status,
          }),
        ];

        expectNothingQueued(
          await runHook(
            publishUpdate({
              miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
            }),
          ),
        );
      },
    );

    test("when the query matches no incident", async () => {
      storedIncidents = [];

      expectNothingQueued(
        await runHook(
          publishUpdate({
            miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
          }),
        ),
      );
    });

    test("when the update matches several incidents and one of them does not qualify", async () => {
      storedIncidents = [
        storedIncident(),
        storedIncident({
          _id: ObjectID.generate().toString(),
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Success,
        }),
      ];

      expectNothingQueued(
        await runHook(
          publishUpdate({
            miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
          }),
        ),
      );
    });
  });

  test("re-queues when the update matches several incidents and every one qualifies", async () => {
    storedIncidents = [
      storedIncident(),
      storedIncident({ _id: ObjectID.generate().toString() }),
    ];

    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("re-queues when the edit also makes a private incident public again", async () => {
    storedIncidents = [storedIncident({ isPrivate: true })];

    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
        data: { isPrivate: false },
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("leaves an explicitly written status alone: the API route of resetting it to Pending", async () => {
    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
        data: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessage: "Queued by the API",
        },
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatusMessage"]).toBe(
      "Queued by the API",
    );
    /*
     * The publish check reads nothing for it. The only read is the resend's
     * own: whether to empty the record of told pages so the API resend
     * reaches every page, as it always did.
     */
    for (const call of findByMock.mock.calls) {
      expect((call[0] as { select: Record<string, unknown> }).select).toEqual({
        _id: true,
        subscriberNotificationStatusOnIncidentCreated: true,
      });
    }
  });

  test("the API route still works without the box: a status reset to Pending is kept", async () => {
    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        data: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("a root write turning notify-on-create off wins over the box", async () => {
    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
        data: {
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
        },
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("works for a non-root incident member's edit as well", async () => {
    const data: Record<string, unknown> = await runHook(
      publishUpdate({
        miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
        props: makeProps([Permission.IncidentMember]),
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    // The lookup itself is root, whatever the caller's props.
    expect(
      (findByMock.mock.calls[0]![0] as Record<string, unknown>)["props"],
    ).toEqual({ isRoot: true });
  });
});

/*
 * The hook adds two columns to a non-root edit, and the column-permission
 * check runs after it (DatabaseService._updateBy). Both columns are computed
 * - exempt from the check only on create - so their update ACL has to let
 * every role that may publish an incident through, or ticking the box would
 * fail the whole edit with "not allowed to update".
 */
describe("Incident column permissions for the re-queued notification", () => {
  const INJECTED_COLUMNS: Array<string> = [
    "subscriberNotificationStatusOnIncidentCreated",
    "subscriberNotificationStatusMessage",
  ];

  function rolesThatCanUpdate(column: string): Array<Permission> {
    return (
      new Incident().getColumnAccessControlFor(column)?.update || []
    ).slice();
  }

  test("harness guard: the incident member role may publish an incident", () => {
    expect(rolesThatCanUpdate("isVisibleOnStatusPage")).toContain(
      Permission.IncidentMember,
    );
  });

  test.each(INJECTED_COLUMNS)(
    "every role that may change 'Visible on Status Page' may also write %s",
    (column: string) => {
      const allowed: Array<Permission> = rolesThatCanUpdate(column);

      for (const role of rolesThatCanUpdate("isVisibleOnStatusPage")) {
        expect(allowed).toContain(role);
      }
    },
  );

  test.each([
    Permission.IncidentMember,
    Permission.IncidentAdmin,
    Permission.ProjectMember,
    Permission.EditProjectIncident,
  ])(
    "the data the hook produces passes the column check for %s",
    async (role: Permission) => {
      const data: Record<string, unknown> = await runHook(
        publishUpdate({
          miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
          props: makeProps([role]),
        }),
      );

      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );

      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          Incident,
          data as unknown as Incident,
          makeProps([role]),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    },
  );

  test("harness guard: a viewer's edit is refused by the same check", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Incident,
        {
          isVisibleOnStatusPage: true,
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
        } as unknown as Incident,
        makeProps([Permission.IncidentViewer]),
        DatabaseRequestType.Update,
      );
    }).toThrow();
  });
});

/*
 * End to end through DatabaseService.updateOneById for a non-root incident
 * member: the real hook, then the real column check, then the write. Only the
 * database, the label/access-control query rewrite and the success hooks are
 * stubbed.
 */
describe("IncidentService.updateOneById publishes and re-queues for an incident member", () => {
  let updateMock: MockFunction;

  beforeEach(() => {
    updateMock = getJestMockFunction();
    updateMock.mockImplementation(() => {
      return Promise.resolve({ affected: 1 });
    });

    jest
      .spyOn(
        IncidentService as unknown as {
          _findBy: (...args: Array<unknown>) => Promise<unknown>;
        },
        "_findBy",
      )
      .mockImplementation((() => {
        const row: Incident = new Incident();
        row._id = incidentId.toString();
        row.projectId = projectId;
        return Promise.resolve([row]);
      }) as never);

    jest
      .spyOn(
        IncidentService as unknown as {
          onUpdateSuccess: (...args: Array<unknown>) => Promise<unknown>;
        },
        "onUpdateSuccess",
      )
      .mockImplementation(((onUpdate: unknown): Promise<unknown> => {
        return Promise.resolve(onUpdate);
      }) as never);

    jest
      .spyOn(
        IncidentService as unknown as { getRepository: () => unknown },
        "getRepository",
      )
      .mockReturnValue({
        update: updateMock,
        save: getJestMockFunction(),
      } as never);

    jest.spyOn(BasePermission, "checkPermissions").mockImplementation(((
      _modelType: unknown,
      query: unknown,
    ): Promise<unknown> => {
      return Promise.resolve({ query });
    }) as never);
  });

  function writtenColumns(): Record<string, unknown> {
    expect(updateMock).toHaveBeenCalledTimes(1);
    return updateMock.mock.calls[0]![1] as Record<string, unknown>;
  }

  test("with the box ticked, the write carries the visibility change and a Pending notification", async () => {
    await IncidentService.updateOneById({
      id: incidentId,
      data: { isVisibleOnStatusPage: true, isPrivate: false },
      miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
      props: makeProps([Permission.IncidentMember]),
    });

    const written: Record<string, unknown> = writtenColumns();

    expect(written["isVisibleOnStatusPage"]).toBe(true);
    expect(written["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(written["subscriberNotificationStatusMessage"]).toBe(
      IncidentCreatedRenotify.queuedMessage,
    );
  });

  test("without the box, only the visibility change is written", async () => {
    await IncidentService.updateOneById({
      id: incidentId,
      data: { isVisibleOnStatusPage: true, isPrivate: false },
      props: makeProps([Permission.IncidentMember]),
    });

    const written: Record<string, unknown> = writtenColumns();

    expect(written["isVisibleOnStatusPage"]).toBe(true);
    expect(
      written["subscriberNotificationStatusOnIncidentCreated"],
    ).toBeUndefined();
  });
});
