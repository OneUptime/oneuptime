import Incident from "../../../Models/DatabaseModels/Incident";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentService from "../../../Server/Services/IncidentService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import BasePermission from "../../../Server/Types/Database/Permissions/BasePermission";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import IncidentCreatedResend from "../../../Types/StatusPage/IncidentCreatedResend";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
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
 * Sending the notification that an incident was created again.
 *
 * The notification keeps a record of the status pages it was sent to in full
 * (Incident.statusPagesNotifiedOnCreation), which the job skips. Phase 1a
 * already emptied that record when an update puts the status back to Pending
 * (the API route, and the dashboard's Resend of a success) - except after a
 * failure, where Retry resumes after the pages already reached. What is new
 * is 'Resend to all pages' (IncidentCreatedResend): a request that empties
 * the record whatever the notification's state, so a failed send can start
 * over. These tests pin how the two fit together:
 *
 *   - Success: a plain Pending and the request both reach every page;
 *   - Failed: a plain Pending (Retry) keeps the record and resumes, the
 *     request empties it;
 *   - the request is refused for a notification that never went out
 *     (Skipped) or is on its way (Pending, InProgress), and when the same
 *     update sets another status;
 *   - it is refused for a caller who may not write the notification columns,
 *     before anything is read;
 *   - it is written into the caller's own update, so the update's own column
 *     check still decides, and the publish and added-pages hooks leave it
 *     alone.
 *
 * The database is stubbed: stored incidents are served by a stub of findBy.
 */

const projectId: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e01",
);
const userId: ObjectID = new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e02");
const incidentId: string = "a1b2c3d4-0000-4000-8000-000000000001";
const secondIncidentId: string = "a1b2c3d4-0000-4000-8000-000000000002";

const PAGE_A: string = "b0000000-0000-4000-8000-00000000000a";
const PAGE_B: string = "b0000000-0000-4000-8000-00000000000b";
const PAGE_C: string = "b0000000-0000-4000-8000-00000000000c";

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

const MEMBER_PROPS: DatabaseCommonInteractionProps = makeProps([
  Permission.IncidentMember,
  Permission.StatusPageViewer,
]);

function statusPage(id: string): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = id;
  return page;
}

function storedIncident(overrides: Partial<Incident> = {}): Incident {
  const incident: Incident = new Incident();
  incident._id = incidentId;
  incident.projectId = projectId;
  incident.isVisibleOnStatusPage = true;
  incident.isPrivate = false;
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = true;
  incident.subscriberNotificationStatusOnIncidentCreated =
    StatusPageSubscriberNotificationStatus.Success;
  incident.statusPagesNotifiedOnCreation = [PAGE_A, PAGE_B];
  incident.statusPages = [];
  Object.assign(incident, overrides);
  return incident;
}

let storedIncidents: Array<Incident> = [];
let incidentFindBy: MockFunction;

function resendUpdate(data: {
  data?: Record<string, unknown>;
  props?: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject | undefined;
  query?: Record<string, unknown>;
}): UpdateBy<Incident> {
  return {
    query: (data.query || { _id: incidentId }) as UpdateBy<Incident>["query"],
    data: (data.data || {
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Pending,
    }) as UpdateBy<Incident>["data"],
    props: data.props || MEMBER_PROPS,
    miscDataProps:
      "miscDataProps" in data
        ? data.miscDataProps
        : IncidentCreatedResend.getMiscDataProps(),
    limit: 1,
    skip: 0,
  };
}

// The same update without the request: the dashboard's Retry, and the API.
function plainResendUpdate(
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): UpdateBy<Incident> {
  return resendUpdate({ props, miscDataProps: undefined });
}

async function runBeforeUpdate(
  updateBy: UpdateBy<Incident>,
): Promise<Record<string, unknown>> {
  const onUpdate: OnUpdate<Incident> = await (
    IncidentService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate(updateBy);

  return onUpdate.updateBy.data as unknown as Record<string, unknown>;
}

beforeEach(() => {
  storedIncidents = [storedIncident()];

  incidentFindBy = getJestMockFunction();
  incidentFindBy.mockImplementation(() => {
    return Promise.resolve(storedIncidents);
  });
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(incidentFindBy as never);

  jest.spyOn(StatusPageService, "findBy").mockImplementation(((findBy: {
    query: { _id: { objectLiteralParameters?: JSONObject } };
  }): Promise<Array<StatusPage>> => {
    const requested: Array<string> = (
      Object.values(findBy.query._id?.objectLiteralParameters || {}) as Array<
        Array<string>
      >
    ).flat();

    return Promise.resolve(
      requested.map((id: string) => {
        return statusPage(id);
      }),
    );
  }) as never);

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

describe("IncidentService.onBeforeUpdate: sending the 'created' notification again", () => {
  describe("after a success (Resend)", () => {
    test("the request queues it for every page: Pending, a message saying so, and an empty record", async () => {
      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({}),
      );

      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data["subscriberNotificationStatusMessage"]).toBe(
        IncidentCreatedResend.queuedMessage,
      );
      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    });

    test("the request alone, with no status, queues it too", async () => {
      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({ data: { title: "Renamed" } }),
      );

      expect(data["title"]).toBe("Renamed");
      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    });

    test("a plain Pending reaches every page too, as it always did - the request and it agree", async () => {
      const data: Record<string, unknown> =
        await runBeforeUpdate(plainResendUpdate());

      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    });

    test("a message the caller sends is kept", async () => {
      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessage: "Resent after the SMTP fix.",
          },
        }),
      );

      expect(data["subscriberNotificationStatusMessage"]).toBe(
        "Resent after the SMTP fix.",
      );
    });
  });

  describe("after a failure", () => {
    beforeEach(() => {
      storedIncidents = [
        storedIncident({
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Failed,
          statusPagesNotifiedOnCreation: [PAGE_A],
        }),
      ];
    });

    test("Retry (a plain Pending) resumes: the pages already reached keep their record", async () => {
      const data: Record<string, unknown> =
        await runBeforeUpdate(plainResendUpdate());

      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
    });

    test("'Resend to all pages' empties the record, so the pages already reached are sent it again", async () => {
      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({}),
      );

      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    });

    test("a failure from before the record existed has nothing to empty, and is sent to every page either way", async () => {
      storedIncidents = [
        storedIncident({
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Failed,
          statusPagesNotifiedOnCreation: undefined,
        }),
      ];

      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({}),
      );

      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    });
  });

  describe("refused, with the reason", () => {
    test.each([
      [
        StatusPageSubscriberNotificationStatus.Skipped,
        IncidentCreatedResend.skippedRefusalMessage,
      ],
      [
        StatusPageSubscriberNotificationStatus.Pending,
        IncidentCreatedResend.inFlightRefusalMessage,
      ],
      [
        StatusPageSubscriberNotificationStatus.InProgress,
        IncidentCreatedResend.inFlightRefusalMessage,
      ],
    ])(
      "for a notification that is %s",
      async (
        status: StatusPageSubscriberNotificationStatus,
        reason: string,
      ) => {
        storedIncidents = [
          storedIncident({
            subscriberNotificationStatusOnIncidentCreated: status,
          }),
        ];

        await expect(runBeforeUpdate(resendUpdate({}))).rejects.toThrow(
          new BadDataException(reason),
        );
      },
    );

    test("for a bulk update when any matched incident's notification did not go out", async () => {
      storedIncidents = [
        storedIncident(),
        storedIncident({
          _id: secondIncidentId,
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
        } as Partial<Incident>),
      ];

      await expect(
        runBeforeUpdate(
          resendUpdate({ query: { projectId: projectId.toString() } }),
        ),
      ).rejects.toThrow(IncidentCreatedResend.skippedRefusalMessage);
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Skipped,
      StatusPageSubscriberNotificationStatus.Failed,
    ])(
      "when the same update sets the status to %s",
      async (status: StatusPageSubscriberNotificationStatus) => {
        await expect(
          runBeforeUpdate(
            resendUpdate({
              data: { subscriberNotificationStatusOnIncidentCreated: status },
            }),
          ),
        ).rejects.toThrow(IncidentCreatedResend.conflictingStatusMessage);
        expect(incidentFindBy).not.toHaveBeenCalled();
      },
    );
  });

  describe("who may", () => {
    test.each([
      Permission.IncidentViewer,
      Permission.Viewer,
      Permission.ReadProjectIncident,
      Permission.CreateProjectIncident,
    ])(
      "%s may not, and is refused before the incident is read",
      async (role: Permission) => {
        storedIncidents = [
          storedIncident({
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          }),
        ];

        await expect(
          runBeforeUpdate(resendUpdate({ props: makeProps([role]) })),
        ).rejects.toThrow(
          new NotAuthorizedException(IncidentCreatedResend.noPermissionMessage),
        );
        expect(incidentFindBy).not.toHaveBeenCalled();
      },
    );

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
    ])(
      "%s may, and what the hook writes passes the update's own column check",
      async (role: Permission) => {
        const props: DatabaseCommonInteractionProps = makeProps([role]);
        const data: Record<string, unknown> = await runBeforeUpdate(
          resendUpdate({ props }),
        );

        expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);

        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            Incident,
            data as unknown as Incident,
            props,
            DatabaseRequestType.Update,
          );
        }).not.toThrow();
      },
    );

    test("the incidents are read with the caller's own permissions and the update's own query", async () => {
      const props: DatabaseCommonInteractionProps = makeProps([
        Permission.IncidentMember,
      ]);

      await runBeforeUpdate(resendUpdate({ props }));

      const reads: Array<{
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      }> = incidentFindBy.mock.calls.map((call: Array<unknown>) => {
        return call[0] as {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        };
      });

      const resendRead:
        | {
            query: Record<string, unknown>;
            select: Record<string, unknown>;
            props: DatabaseCommonInteractionProps;
          }
        | undefined = reads.find(
        (read: { select: Record<string, unknown> }) => {
          return (
            read.select["subscriberNotificationStatusOnIncidentCreated"] ===
              true && Object.keys(read.select).length === 2
          );
        },
      );

      expect(resendRead).toBeDefined();
      expect(resendRead!.props).toBe(props);
      expect(resendRead!.query["_id"]).toBe(incidentId);
    });

    test("when the caller can see none of the incidents it matches, nothing is queued", async () => {
      storedIncidents = [];

      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({ data: { title: "Renamed" } }),
      );

      expect(data).toEqual({ title: "Renamed" });
    });

    test("a client's own record never survives, even with the request", async () => {
      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Pending,
            statusPagesNotifiedOnCreation: [PAGE_C],
          },
        }),
      );

      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    });

    test("a root caller that writes the record itself keeps it", async () => {
      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({
          props: { isRoot: true },
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Pending,
            statusPagesNotifiedOnCreation: [PAGE_C],
          },
        }),
      );

      expect(data["statusPagesNotifiedOnCreation"]).toEqual([PAGE_C]);
    });
  });

  describe("next to the other ways of queueing it", () => {
    test("the added-pages checkbox on the same edit defers to it: every page, not only the added ones", async () => {
      storedIncidents = [
        storedIncident({
          statusPages: [statusPage(PAGE_A)],
          statusPagesNotifiedOnCreation: [PAGE_A],
        }),
      ];

      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({
          data: { statusPages: [PAGE_A, PAGE_B] },
          miscDataProps: {
            ...IncidentCreatedResend.getMiscDataProps(),
            ...IncidentScopeAddedPagesNotification.getMiscDataProps(),
          },
        }),
      );

      expect(data["subscriberNotificationStatusMessage"]).toBe(
        IncidentCreatedResend.queuedMessage,
      );
      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    });

    test("an ask that is not a real yes is not the request: a plain Pending after a failure still resumes", async () => {
      storedIncidents = [
        storedIncident({
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Failed,
        }),
      ];

      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({
          miscDataProps: { resendIncidentCreatedToAllStatusPages: "false" },
        }),
      );

      expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
    });

    test("publishing's own request does not empty the record", async () => {
      storedIncidents = [
        storedIncident({
          isVisibleOnStatusPage: false,
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
          statusPagesNotifiedOnCreation: [PAGE_A],
        }),
      ];

      const data: Record<string, unknown> = await runBeforeUpdate(
        resendUpdate({
          data: { isVisibleOnStatusPage: true },
          miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
        }),
      );

      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
    });
  });
});

/*
 * End to end through DatabaseService.updateOneById for a non-root caller:
 * the real hook, then the real permission checks, then the write. Only the
 * database, the label/access-control query rewrite, the success hooks and the
 * workflow, realtime and audit side effects are stubbed.
 */
describe("IncidentService.updateOneById: 'Resend to all pages'", () => {
  let saveMock: MockFunction;
  let updateMock: MockFunction;

  beforeEach(() => {
    saveMock = getJestMockFunction();
    saveMock.mockImplementation((item: unknown) => {
      return Promise.resolve(item);
    });
    updateMock = getJestMockFunction();
    updateMock.mockResolvedValue({ affected: 1 });

    jest
      .spyOn(
        IncidentService as unknown as {
          _findBy: (...args: Array<unknown>) => Promise<unknown>;
        },
        "_findBy",
      )
      .mockImplementation((() => {
        const row: Incident = new Incident();
        row._id = incidentId;
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
        save: saveMock,
      } as never);

    jest.spyOn(BasePermission, "checkPermissions").mockImplementation(((
      _modelType: unknown,
      query: unknown,
    ): Promise<unknown> => {
      return Promise.resolve({ query });
    }) as never);

    jest
      .spyOn(IncidentService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AuditLogService, "recordUpdate")
      .mockResolvedValue(undefined as never);
  });

  function saved(): Record<string, unknown> {
    const calls: Array<Array<unknown>> = [
      ...saveMock.mock.calls,
      ...updateMock.mock.calls,
    ];

    expect(calls).toHaveLength(1);

    const call: Array<unknown> = calls[0]!;

    return (call.length > 1 ? call[1] : call[0]) as Record<string, unknown>;
  }

  test("an incident member's request writes Pending, the message and an empty record in one write", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Failed,
      }),
    ];

    await IncidentService.updateOneById({
      id: new ObjectID(incidentId),
      data: {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      },
      miscDataProps: IncidentCreatedResend.getMiscDataProps(),
      props: makeProps([Permission.IncidentMember]),
    });

    const written: Record<string, unknown> = saved();

    expect(written["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(written["subscriberNotificationStatusMessage"]).toBe(
      IncidentCreatedResend.queuedMessage,
    );
    expect(written["statusPagesNotifiedOnCreation"]).toEqual([]);
  });

  test("an incident member's Retry after a failure writes Pending and keeps the record", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Failed,
      }),
    ];

    await IncidentService.updateOneById({
      id: new ObjectID(incidentId),
      data: {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessage:
          IncidentCreatedResend.retryQueuedMessage,
      },
      props: makeProps([Permission.IncidentMember]),
    });

    const written: Record<string, unknown> = saved();

    expect(written["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(written["statusPagesNotifiedOnCreation"]).toBeUndefined();
  });

  test.each([
    ["with the request", IncidentCreatedResend.getMiscDataProps()],
    ["without it (Retry, or the API route)", undefined],
  ])(
    "an incident viewer cannot send it again %s, and nothing is written",
    async (_label: string, miscDataProps: JSONObject | undefined) => {
      await expect(
        IncidentService.updateOneById({
          id: new ObjectID(incidentId),
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Pending,
          },
          miscDataProps: miscDataProps,
          props: makeProps([Permission.IncidentViewer]),
        }),
      ).rejects.toThrow(NotAuthorizedException);

      expect(saveMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    },
  );

  test("a skipped notification is refused and nothing is written", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
      }),
    ];

    await expect(
      IncidentService.updateOneById({
        id: new ObjectID(incidentId),
        data: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
        miscDataProps: IncidentCreatedResend.getMiscDataProps(),
        props: makeProps([Permission.IncidentMember]),
      }),
    ).rejects.toThrow(IncidentCreatedResend.skippedRefusalMessage);

    expect(saveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
