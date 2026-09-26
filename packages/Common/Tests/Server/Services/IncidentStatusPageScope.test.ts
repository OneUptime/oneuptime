import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import UserService from "../../../Server/Services/UserService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BasePermission from "../../../Server/Types/Database/Permissions/BasePermission";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import IncidentWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
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
 * An incident can be limited to some of the status pages its monitors reach
 * (Incident.statusPages). IncidentService owns everything that follows from a
 * write to that list:
 *
 *   - isScopedToStatusPages is derived from the list and never taken from a
 *     client, and it is never recomputed from what the join table holds;
 *   - the job's record of notified pages is never taken from a client;
 *   - a non-root editor's list keeps the scoped pages they cannot read
 *     (status pages are label-scoped, and a list write replaces the list);
 *   - the incident-created notification can be queued again for the pages an
 *     edit adds, depending on where that notification is;
 *   - a template's pages are copied onto an incident declared from it;
 *   - the feed records what was added and removed;
 *   - a non-root incident member can do all of it: the hook writes computed
 *     columns into their update, and the column check runs after the hook.
 *
 * The database is stubbed: stored incidents are served by a stub of findBy,
 * and which status pages the caller can read by a stub of the status page
 * service's findBy.
 */

const projectId: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e01",
);
const userId: ObjectID = new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e02");
const incidentId: string = "a1b2c3d4-0000-4000-8000-000000000001";
const secondIncidentId: string = "a1b2c3d4-0000-4000-8000-000000000002";
const templateId: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

const PAGE_A: string = "b0000000-0000-4000-8000-00000000000a";
const PAGE_B: string = "b0000000-0000-4000-8000-00000000000b";
const PAGE_C: string = "b0000000-0000-4000-8000-00000000000c";
// Pages behind a label the editor has no access to.
const HIDDEN_PAGE_X: string = "b0000000-0000-4000-8000-0000000000f1";
const HIDDEN_PAGE_Y: string = "b0000000-0000-4000-8000-0000000000f2";

type OnBeforeUpdate = (
  updateBy: UpdateBy<Incident>,
) => Promise<OnUpdate<Incident>>;
type OnBeforeCreate = (
  createBy: CreateBy<Incident>,
) => Promise<OnCreate<Incident>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<Incident>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Incident>>;

interface ScopeCarryForward {
  addedStatusPageIds: Array<string>;
  removedStatusPageIds: Array<string>;
  isScoped: boolean;
  notificationQueued: boolean;
}

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

function statusPage(id: string, name?: string): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = id;
  if (name) {
    page.name = name;
  }
  return page;
}

function storedIncident(
  overrides: Partial<Incident> & { statusPageIds?: Array<string> } = {},
): Incident {
  const incident: Incident = new Incident();
  incident._id = incidentId;
  incident.projectId = projectId;
  incident.isVisibleOnStatusPage = true;
  incident.isPrivate = false;
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = true;
  incident.subscriberNotificationStatusOnIncidentCreated =
    StatusPageSubscriberNotificationStatus.Success;

  const { statusPageIds, ...rest } = overrides;

  incident.statusPages = (statusPageIds || []).map((id: string) => {
    return statusPage(id);
  });

  Object.assign(incident, rest);
  return incident;
}

// What the database holds for the incidents an update matches.
let storedIncidents: Array<Incident> = [];
// The status pages the caller can read; null means no status page access.
let readableStatusPageIds: Array<string> | null = [];

let incidentFindBy: MockFunction;
let statusPageFindBy: MockFunction;

function savedStatusPageIds(data: Record<string, unknown>): Array<string> {
  return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
    data["statusPages"],
  );
}

function scopeUpdate(data: {
  data: Record<string, unknown>;
  props?: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject | undefined;
  query?: Record<string, unknown>;
}): UpdateBy<Incident> {
  return {
    query: (data.query || { _id: incidentId }) as UpdateBy<Incident>["query"],
    data: data.data as UpdateBy<Incident>["data"],
    props: data.props || MEMBER_PROPS,
    miscDataProps: data.miscDataProps,
    limit: 1,
    skip: 0,
  };
}

async function runBeforeUpdate(updateBy: UpdateBy<Incident>): Promise<{
  data: Record<string, unknown>;
  carryForward: Dictionary<{ statusPageScopeChange?: ScopeCarryForward }>;
}> {
  const onUpdate: OnUpdate<Incident> = await (
    IncidentService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate(updateBy);

  return {
    data: onUpdate.updateBy.data as unknown as Record<string, unknown>,
    carryForward: onUpdate.carryForward as Dictionary<{
      statusPageScopeChange?: ScopeCarryForward;
    }>,
  };
}

function scopeChangeOf(
  carryForward: Dictionary<{ statusPageScopeChange?: ScopeCarryForward }>,
  id: string = incidentId,
): ScopeCarryForward | undefined {
  return carryForward[id]?.statusPageScopeChange;
}

beforeEach(() => {
  storedIncidents = [storedIncident()];
  readableStatusPageIds = [PAGE_A, PAGE_B, PAGE_C];

  incidentFindBy = getJestMockFunction();
  incidentFindBy.mockImplementation(() => {
    return Promise.resolve(storedIncidents);
  });
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(incidentFindBy as never);

  statusPageFindBy = getJestMockFunction();
  statusPageFindBy.mockImplementation(
    (findBy: { query: { _id: unknown } }): Promise<Array<StatusPage>> => {
      if (readableStatusPageIds === null) {
        return Promise.reject(
          new NotAuthorizedException(
            "You do not have permissions to read Status Page.",
          ),
        );
      }

      // The ids are asked for with QueryHelper.any (a Raw IN operator).
      const operator: { objectLiteralParameters?: Dictionary<unknown> } = findBy
        .query._id as { objectLiteralParameters?: Dictionary<unknown> };
      const requested: Array<string> = (
        Object.values(operator.objectLiteralParameters || {}) as Array<
          Array<string>
        >
      )
        .flat()
        .map((id: string) => {
          return id.toLowerCase();
        });

      return Promise.resolve(
        requested
          .filter((id: string) => {
            return readableStatusPageIds!.includes(id);
          })
          .map((id: string) => {
            return statusPage(id);
          }),
      );
    },
  );
  jest
    .spyOn(StatusPageService, "findBy")
    .mockImplementation(statusPageFindBy as never);

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
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentService.onBeforeUpdate: isScopedToStatusPages follows statusPages", () => {
  test("scoping an incident sets the flag", async () => {
    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [PAGE_A, PAGE_B] } }),
    );

    expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B]);
    expect(data["isScopedToStatusPages"]).toBe(true);
  });

  test("clearing the scope clears the flag", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [] } }),
    );

    expect(savedStatusPageIds(data)).toEqual([]);
    expect(data["isScopedToStatusPages"]).toBe(false);
  });

  test("a null list clears the scope like an empty one", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: null } }),
    );

    expect(savedStatusPageIds(data)).toEqual([]);
    expect(data["isScopedToStatusPages"]).toBe(false);
  });

  test("writes the list as status page stubs, deduplicated, whatever shape it came in", async () => {
    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: {
          statusPages: [
            statusPage(PAGE_A, "Site A"),
            { _id: PAGE_B },
            PAGE_A.toUpperCase(),
            new ObjectID(PAGE_C),
          ],
        },
      }),
    );

    const written: Array<unknown> = data["statusPages"] as Array<unknown>;

    expect(written).toHaveLength(3);
    for (const entry of written) {
      expect(entry).toBeInstanceOf(StatusPage);
    }
    expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B, PAGE_C]);
  });

  test.each([
    ["a non-root editor", MEMBER_PROPS],
    ["a root caller", { isRoot: true } as DatabaseCommonInteractionProps],
  ])(
    "ignores the flag when %s sends it without a list",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      for (const value of [true, false]) {
        const { data } = await runBeforeUpdate(
          scopeUpdate({
            data: { isScopedToStatusPages: value, title: "renamed" },
            props,
          }),
        );

        expect(data).not.toHaveProperty("isScopedToStatusPages");
        expect(data["title"]).toBe("renamed");
      }

      // Nothing about the scope was read.
      expect(incidentFindBy).not.toHaveBeenCalled();
      expect(statusPageFindBy).not.toHaveBeenCalled();
    },
  );

  test("overrides a flag sent alongside the list", async () => {
    const scoped: Record<string, unknown> = (
      await runBeforeUpdate(
        scopeUpdate({
          data: { statusPages: [PAGE_A], isScopedToStatusPages: false },
        }),
      )
    ).data;

    expect(scoped["isScopedToStatusPages"]).toBe(true);

    const unscoped: Record<string, unknown> = (
      await runBeforeUpdate(
        scopeUpdate({
          data: { statusPages: [], isScopedToStatusPages: true },
        }),
      )
    ).data;

    expect(unscoped["isScopedToStatusPages"]).toBe(false);
  });

  test("an update that does not write the list leaves the flag alone", async () => {
    /*
     * The flag is never recomputed from what the join table holds: an
     * incident whose only page was deleted keeps its flag through every
     * later edit, and stays hidden rather than being widened.
     */
    storedIncidents = [
      storedIncident({ isScopedToStatusPages: true, statusPageIds: [] }),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { title: "Still investigating" } }),
    );

    expect(data).not.toHaveProperty("isScopedToStatusPages");
    expect(data).not.toHaveProperty("statusPages");
    expect(incidentFindBy).not.toHaveBeenCalled();
  });

  test("a client cannot write the record of notified pages", async () => {
    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPagesNotifiedOnCreation: [PAGE_A], title: "renamed" },
      }),
    );

    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
  });

  test("a root caller (the notification job) may write the record of notified pages", async () => {
    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPagesNotifiedOnCreation: [PAGE_A] },
        props: { isRoot: true },
      }),
    );

    expect(data["statusPagesNotifiedOnCreation"]).toEqual([PAGE_A]);
  });

  test("reads the matched incidents as root, with the update's own query", async () => {
    await runBeforeUpdate(scopeUpdate({ data: { statusPages: [PAGE_A] } }));

    expect(incidentFindBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = incidentFindBy.mock.calls[0]![0];

    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.query["_id"]).toBe(incidentId);
    expect(findBy.select["statusPages"]).toEqual({ _id: true });
  });
});

describe("IncidentService.onBeforeUpdate: scoped pages the editor cannot read survive the edit", () => {
  test("a hidden page is kept when the editor saves the pages they can see", async () => {
    readableStatusPageIds = [PAGE_A, PAGE_B];
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, HIDDEN_PAGE_X] }),
    ];

    // The dashboard sends back only what the editor sees, plus their change.
    const { data, carryForward } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [PAGE_A, PAGE_B] } }),
    );

    expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B, HIDDEN_PAGE_X]);
    expect(data["isScopedToStatusPages"]).toBe(true);

    // The hidden page is neither added nor removed.
    expect(scopeChangeOf(carryForward)).toEqual({
      addedStatusPageIds: [PAGE_B],
      removedStatusPageIds: [],
      isScoped: true,
      notificationQueued: false,
    });
  });

  test("clearing the pages the editor can see keeps the incident scoped to the hidden ones", async () => {
    readableStatusPageIds = [PAGE_A];
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, HIDDEN_PAGE_X] }),
    ];

    const { data, carryForward } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [] } }),
    );

    expect(savedStatusPageIds(data)).toEqual([HIDDEN_PAGE_X]);
    expect(data["isScopedToStatusPages"]).toBe(true);
    expect(scopeChangeOf(carryForward)?.removedStatusPageIds).toEqual([PAGE_A]);
  });

  test("asks the status page service which pages are readable with the editor's own props", async () => {
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, HIDDEN_PAGE_X] }),
    ];

    await runBeforeUpdate(scopeUpdate({ data: { statusPages: [PAGE_A] } }));

    expect(statusPageFindBy).toHaveBeenCalledTimes(1);
    expect(statusPageFindBy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
  });

  test("an editor without any status page access keeps every scoped page", async () => {
    readableStatusPageIds = null;
    storedIncidents = [
      storedIncident({ statusPageIds: [HIDDEN_PAGE_X, HIDDEN_PAGE_Y] }),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPages: [] },
        props: makeProps([Permission.IncidentMember]),
      }),
    );

    expect(savedStatusPageIds(data).sort()).toEqual(
      [HIDDEN_PAGE_X, HIDDEN_PAGE_Y].sort(),
    );
    expect(data["isScopedToStatusPages"]).toBe(true);
  });

  test("a page the editor sends that is also hidden is not added twice", async () => {
    readableStatusPageIds = [];
    storedIncidents = [storedIncident({ statusPageIds: [HIDDEN_PAGE_X] })];

    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [HIDDEN_PAGE_X.toUpperCase()] } }),
    );

    expect(savedStatusPageIds(data)).toEqual([HIDDEN_PAGE_X]);
  });

  test("a root caller replaces the list exactly, and nothing is checked for it", async () => {
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, HIDDEN_PAGE_X] }),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [PAGE_B] }, props: { isRoot: true } }),
    );

    expect(savedStatusPageIds(data)).toEqual([PAGE_B]);
    expect(statusPageFindBy).not.toHaveBeenCalled();
  });

  test("an incident with no scope asks nothing about readability", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [] })];

    await runBeforeUpdate(scopeUpdate({ data: { statusPages: [PAGE_A] } }));

    expect(statusPageFindBy).not.toHaveBeenCalled();
  });

  test("a bulk edit keeps hidden pages every matched incident holds", async () => {
    readableStatusPageIds = [PAGE_A];
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, HIDDEN_PAGE_X] }),
      storedIncident({
        _id: secondIncidentId,
        statusPageIds: [HIDDEN_PAGE_X],
      } as Partial<Incident>),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPages: [PAGE_B] },
        query: { projectId: projectId },
      }),
    );

    expect(savedStatusPageIds(data)).toEqual([PAGE_B, HIDDEN_PAGE_X]);
  });

  test("a bulk edit is refused when the matched incidents hide different pages", async () => {
    /*
     * The same list is written onto every matched incident, so keeping X
     * for the first would scope the second to a page it never had.
     */
    readableStatusPageIds = [PAGE_A];
    storedIncidents = [
      storedIncident({ statusPageIds: [HIDDEN_PAGE_X] }),
      storedIncident({
        _id: secondIncidentId,
        statusPageIds: [HIDDEN_PAGE_Y],
      } as Partial<Incident>),
    ];

    await expect(
      runBeforeUpdate(
        scopeUpdate({
          data: { statusPages: [PAGE_A] },
          query: { projectId: projectId },
        }),
      ),
    ).rejects.toThrow(
      "limited to different status pages that you do not have access to",
    );
  });

  test("an unexpected error reading status pages is not swallowed", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];
    statusPageFindBy.mockImplementation(() => {
      return Promise.reject(new Error("connection lost"));
    });

    await expect(
      runBeforeUpdate(scopeUpdate({ data: { statusPages: [PAGE_B] } })),
    ).rejects.toThrow("connection lost");
  });
});

describe("IncidentService.onBeforeUpdate: 'Send the incident-created notification to newly added pages'", () => {
  function addPages(
    data: {
      box?: boolean;
      extra?: Record<string, unknown>;
    } = {},
  ): UpdateBy<Incident> {
    return scopeUpdate({
      data: { statusPages: [PAGE_A, PAGE_B], ...(data.extra || {}) },
      miscDataProps:
        data.box === false
          ? undefined
          : IncidentScopeAddedPagesNotification.getMiscDataProps(),
    });
  }

  function withStatus(
    status: StatusPageSubscriberNotificationStatus,
    overrides: Partial<Incident> & { statusPageIds?: Array<string> } = {},
  ): Incident {
    return storedIncident({
      statusPageIds: [PAGE_A],
      subscriberNotificationStatusOnIncidentCreated: status,
      ...overrides,
    });
  }

  describe.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "while the notification is %s",
    (status: StatusPageSubscriberNotificationStatus) => {
      test("adding a page with the box ticked queues it again", async () => {
        storedIncidents = [withStatus(status)];

        const { data, carryForward } = await runBeforeUpdate(addPages());

        expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
          StatusPageSubscriberNotificationStatus.Pending,
        );
        expect(data["subscriberNotificationStatusMessage"]).toBe(
          IncidentScopeAddedPagesNotification.queuedMessage,
        );
        expect(scopeChangeOf(carryForward)).toEqual({
          addedStatusPageIds: [PAGE_B],
          removedStatusPageIds: [],
          isScoped: true,
          notificationQueued: true,
        });
        // The record of notified pages is the job's, and is left alone.
        expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
      });

      test("without the box, the scope changes and nothing is queued", async () => {
        storedIncidents = [withStatus(status)];

        const { data, carryForward } = await runBeforeUpdate(
          addPages({ box: false }),
        );

        expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B]);
        expect(data).not.toHaveProperty(
          "subscriberNotificationStatusOnIncidentCreated",
        );
        expect(scopeChangeOf(carryForward)?.notificationQueued).toBe(false);
      });
    },
  );

  test("while the notification is Pending, the queued send already uses the new scope", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.Pending),
    ];

    const { data, carryForward } = await runBeforeUpdate(addPages());

    expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B]);
    expect(data).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
    expect(data).not.toHaveProperty("subscriberNotificationStatusMessage");
    expect(scopeChangeOf(carryForward)?.notificationQueued).toBe(false);
  });

  test("while the notification is being sent, the edit is refused with a message", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.InProgress),
    ];

    await expect(runBeforeUpdate(addPages())).rejects.toThrow(
      IncidentScopeAddedPagesNotification.rejectedWhileSendingMessage,
    );
  });

  test("while the notification is being sent, the edit goes through without the box", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.InProgress),
    ];

    const { data } = await runBeforeUpdate(addPages({ box: false }));

    expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B]);
    expect(data).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
  });

  test("scoping an unscoped incident counts every selected page as added", async () => {
    // The job skips the pages it has a record of telling.
    storedIncidents = [
      storedIncident({
        statusPageIds: [],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Success,
      }),
    ];

    const { data, carryForward } = await runBeforeUpdate(addPages());

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(scopeChangeOf(carryForward)?.addedStatusPageIds).toEqual([
      PAGE_A,
      PAGE_B,
    ]);
  });

  describe("queues nothing", () => {
    async function expectNothingQueued(
      updateBy: UpdateBy<Incident>,
    ): Promise<void> {
      const { data } = await runBeforeUpdate(updateBy);

      expect(data).not.toHaveProperty(
        "subscriberNotificationStatusOnIncidentCreated",
      );
      expect(data).not.toHaveProperty("subscriberNotificationStatusMessage");
    }

    test("when no page is added: the same pages saved again", async () => {
      storedIncidents = [storedIncident({ statusPageIds: [PAGE_A, PAGE_B] })];

      await expectNothingQueued(addPages());
    });

    test("when pages are only removed, even while the notification is being sent", async () => {
      storedIncidents = [
        storedIncident({
          statusPageIds: [PAGE_A, PAGE_B, PAGE_C],
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.InProgress,
        }),
      ];

      await expectNothingQueued(addPages());
    });

    test("when the scope is cleared", async () => {
      storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

      await expectNothingQueued(
        scopeUpdate({
          data: { statusPages: [] },
          miscDataProps: IncidentScopeAddedPagesNotification.getMiscDataProps(),
        }),
      );
    });

    test("when notifying subscribers on creation is off for the incident", async () => {
      storedIncidents = [
        withStatus(StatusPageSubscriberNotificationStatus.Skipped, {
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
        }),
      ];

      await expectNothingQueued(addPages());
    });

    test("when the incident is hidden from status pages", async () => {
      storedIncidents = [
        withStatus(StatusPageSubscriberNotificationStatus.Skipped, {
          isVisibleOnStatusPage: false,
          subscriberNotificationStatusMessage:
            IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
        }),
      ];

      await expectNothingQueued(addPages());
    });

    test("when the same edit hides the incident", async () => {
      storedIncidents = [
        withStatus(StatusPageSubscriberNotificationStatus.Success),
      ];

      await expectNothingQueued(
        addPages({ extra: { isVisibleOnStatusPage: false } }),
      );
    });

    test("when the same edit makes the incident private", async () => {
      storedIncidents = [
        withStatus(StatusPageSubscriberNotificationStatus.Success),
      ];

      await expectNothingQueued(addPages({ extra: { isPrivate: true } }));
    });

    test("when the incident is private", async () => {
      storedIncidents = [
        withStatus(StatusPageSubscriberNotificationStatus.Skipped, {
          isPrivate: true,
          isVisibleOnStatusPage: false,
        }),
      ];

      await expectNothingQueued(addPages());
    });

    test("when the box is sent as anything but a real yes", async () => {
      storedIncidents = [
        withStatus(StatusPageSubscriberNotificationStatus.Success),
      ];

      await expectNothingQueued(
        scopeUpdate({
          data: { statusPages: [PAGE_A, PAGE_B] },
          miscDataProps: {
            [IncidentScopeAddedPagesNotification.miscDataKey]: "false",
          },
        }),
      );
    });

    test("when the update matches several incidents and one of them gains no page", async () => {
      storedIncidents = [
        withStatus(StatusPageSubscriberNotificationStatus.Success),
        storedIncident({
          _id: secondIncidentId,
          statusPageIds: [PAGE_A, PAGE_B],
        } as Partial<Incident>),
      ];

      await expectNothingQueued(addPages());
    });
  });

  test("the same edit publishing a hidden incident queues it too", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.Skipped, {
        isVisibleOnStatusPage: false,
      }),
    ];

    const { data } = await runBeforeUpdate(
      addPages({ extra: { isVisibleOnStatusPage: true } }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("publishing with its own box as well: the publish decides the status and message", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.Skipped, {
        isVisibleOnStatusPage: false,
      }),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: {
          statusPages: [PAGE_A, PAGE_B],
          isVisibleOnStatusPage: true,
          isPrivate: false,
        },
        miscDataProps: {
          ...IncidentScopeAddedPagesNotification.getMiscDataProps(),
          ...IncidentCreatedRenotify.getMiscDataProps(),
        },
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatusMessage"]).toBe(
      IncidentCreatedRenotify.queuedMessage,
    );
  });

  test("leaves an explicitly written status alone, even while a send is running", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.InProgress),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: {
          statusPages: [PAGE_A, PAGE_B],
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Failed,
        },
        props: { isRoot: true },
        miscDataProps: IncidentScopeAddedPagesNotification.getMiscDataProps(),
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Failed,
    );
  });

  test("a bulk edit queues when every matched incident gains a page and may be announced", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.Success),
      storedIncident({
        _id: secondIncidentId,
        statusPageIds: [],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      } as Partial<Incident>),
    ];

    const { data, carryForward } = await runBeforeUpdate(addPages());

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(scopeChangeOf(carryForward)?.notificationQueued).toBe(true);
    // The Pending one was already queued; this edit did not queue it.
    expect(
      scopeChangeOf(carryForward, secondIncidentId)?.notificationQueued,
    ).toBe(false);
  });

  test("a bulk edit is refused when one matched incident is being sent", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.Success),
      storedIncident({
        _id: secondIncidentId,
        statusPageIds: [],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      } as Partial<Incident>),
    ];

    await expect(runBeforeUpdate(addPages())).rejects.toThrow(
      IncidentScopeAddedPagesNotification.rejectedWhileSendingMessage,
    );
  });
});

describe("IncidentService.onBeforeUpdate: carries the scope change forward for the feed", () => {
  test("records the pages added and removed, next to a monitor change", async () => {
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, PAGE_B], monitors: [] }),
    ];

    const { carryForward } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPages: [PAGE_B, PAGE_C], monitors: [] },
        props: { isRoot: true },
      }),
    );

    expect(scopeChangeOf(carryForward)).toEqual({
      addedStatusPageIds: [PAGE_C],
      removedStatusPageIds: [PAGE_A],
      isScoped: true,
      notificationQueued: false,
    });
    // The monitor bookkeeping for the same incident is kept.
    expect(carryForward[incidentId]).toMatchObject({
      monitorsRemoved: [],
      monitorsAdded: [],
    });
  });

  test("records clearing the scope", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

    const { carryForward } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [] } }),
    );

    expect(scopeChangeOf(carryForward)).toEqual({
      addedStatusPageIds: [],
      removedStatusPageIds: [PAGE_A],
      isScoped: false,
      notificationQueued: false,
    });
  });
});

describe("IncidentService.onBeforeCreate: the scope of a new incident", () => {
  let template: IncidentTemplate | null = null;

  beforeEach(() => {
    template = null;

    const createdState: IncidentState = new IncidentState();
    createdState._id = "c0000000-0000-4000-8000-000000000001";
    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(createdState as never);
    jest
      .spyOn(ProjectService, "incrementAndGetIncidentCounter")
      .mockResolvedValue({ counter: 7, prefix: undefined } as never);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    // The root cause names the user who declared the incident.
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue("Test User" as never);
    jest.spyOn(IncidentTemplateService, "findOneBy").mockImplementation((() => {
      return Promise.resolve(template);
    }) as never);
  });

  function newIncident(overrides: Partial<Incident> = {}): Incident {
    const incident: Incident = new Incident();
    incident.title = "Site outage";
    incident.incidentSeverityId = new ObjectID(
      "d0000000-0000-4000-8000-000000000001",
    );
    Object.assign(incident, overrides);
    return incident;
  }

  async function runBeforeCreate(
    data: Incident,
    props: DatabaseCommonInteractionProps = { tenantId: projectId },
  ): Promise<Incident> {
    const onCreate: OnCreate<Incident> = await (
      IncidentService as unknown as { onBeforeCreate: OnBeforeCreate }
    ).onBeforeCreate({ data, props });

    return onCreate.createBy.data;
  }

  test("an incident created with pages is scoped", async () => {
    const created: Incident = await runBeforeCreate(
      newIncident({ statusPages: [statusPage(PAGE_A), statusPage(PAGE_B)] }),
    );

    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        created.statusPages,
      ),
    ).toEqual([PAGE_A, PAGE_B]);
    expect(created.isScopedToStatusPages).toBe(true);
  });

  test("an incident created without pages is unscoped", async () => {
    const created: Incident = await runBeforeCreate(newIncident());

    expect(created.isScopedToStatusPages).toBe(false);
    expect(created.statusPages).toBeUndefined();
  });

  test("an empty list is unscoped", async () => {
    const created: Incident = await runBeforeCreate(
      newIncident({ statusPages: [] }),
    );

    expect(created.isScopedToStatusPages).toBe(false);
  });

  test("ignores a flag the client sends: scoped with no pages would hide the incident everywhere", async () => {
    const created: Incident = await runBeforeCreate(
      newIncident({ isScopedToStatusPages: true }),
    );

    expect(created.isScopedToStatusPages).toBe(false);

    const scoped: Incident = await runBeforeCreate(
      newIncident({
        isScopedToStatusPages: false,
        statusPages: [statusPage(PAGE_A)],
      }),
    );

    expect(scoped.isScopedToStatusPages).toBe(true);
  });

  test("deduplicates the pages and writes them as stubs", async () => {
    const created: Incident = await runBeforeCreate(
      newIncident({
        statusPages: [
          statusPage(PAGE_A, "Site A"),
          PAGE_A.toUpperCase() as unknown as StatusPage,
          { _id: PAGE_B } as unknown as StatusPage,
        ],
      }),
    );

    expect(created.statusPages).toHaveLength(2);
    for (const page of created.statusPages || []) {
      expect(page).toBeInstanceOf(StatusPage);
    }
  });

  test("a client cannot seed the record of notified pages", async () => {
    const created: Incident = await runBeforeCreate(
      newIncident({ statusPagesNotifiedOnCreation: [PAGE_A] }),
      MEMBER_PROPS,
    );

    expect(created.statusPagesNotifiedOnCreation).toBeUndefined();
  });

  test("a root caller keeps the record it sends", async () => {
    const incident: Incident = newIncident({
      statusPagesNotifiedOnCreation: [PAGE_A],
    });
    incident.projectId = projectId;

    const created: Incident = await runBeforeCreate(incident, {
      isRoot: true,
    });

    expect(created.statusPagesNotifiedOnCreation).toEqual([PAGE_A]);
  });

  describe("declared from a template", () => {
    function templateWithPages(ids: Array<string>): IncidentTemplate {
      const incidentTemplate: IncidentTemplate = new IncidentTemplate();
      incidentTemplate._id = templateId;
      incidentTemplate.statusPages = ids.map((id: string) => {
        return statusPage(id);
      });
      return incidentTemplate;
    }

    test("copies the template's pages and scopes the incident", async () => {
      template = templateWithPages([PAGE_A, PAGE_C]);

      const created: Incident = await runBeforeCreate(
        newIncident({ createdIncidentTemplateId: templateId }),
      );

      expect(
        IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
          created.statusPages,
        ),
      ).toEqual([PAGE_A, PAGE_C]);
      expect(created.isScopedToStatusPages).toBe(true);
    });

    test("reads the template's pages, as root and within the project", async () => {
      template = templateWithPages([PAGE_A]);

      await runBeforeCreate(
        newIncident({ createdIncidentTemplateId: templateId }),
      );

      const findOneBy: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = (IncidentTemplateService.findOneBy as unknown as MockFunction).mock
        .calls[0]![0];

      expect(findOneBy.select["statusPages"]).toEqual({ _id: true });
      expect(findOneBy.query["projectId"]).toBe(projectId);
      expect(findOneBy.props).toEqual({ isRoot: true });
    });

    test("the pages the caller picked win over the template's", async () => {
      template = templateWithPages([PAGE_A, PAGE_C]);

      const created: Incident = await runBeforeCreate(
        newIncident({
          createdIncidentTemplateId: templateId,
          statusPages: [statusPage(PAGE_B)],
        }),
      );

      expect(
        IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
          created.statusPages,
        ),
      ).toEqual([PAGE_B]);
    });

    test("an explicitly empty list is an intentional override: the incident stays unscoped", async () => {
      template = templateWithPages([PAGE_A]);

      const created: Incident = await runBeforeCreate(
        newIncident({ createdIncidentTemplateId: templateId, statusPages: [] }),
      );

      expect(created.statusPages).toEqual([]);
      expect(created.isScopedToStatusPages).toBe(false);
    });

    test("a template without pages leaves the incident unscoped", async () => {
      template = templateWithPages([]);

      const created: Incident = await runBeforeCreate(
        newIncident({ createdIncidentTemplateId: templateId }),
      );

      expect(created.statusPages).toBeUndefined();
      expect(created.isScopedToStatusPages).toBe(false);
    });

    test("the copied pages are validated against the project with the rest", async () => {
      template = templateWithPages([PAGE_A]);

      await runBeforeCreate(
        newIncident({ createdIncidentTemplateId: templateId }),
      );

      const validation: {
        references: Array<{ modelName: string; id: unknown }>;
      } = (
        ProjectScopedReferenceValidator.validateReferencesBelongToProject as unknown as MockFunction
      ).mock.calls[0]![0];

      expect(
        validation.references
          .filter((reference: { modelName: string }) => {
            return reference.modelName === "Status Page";
          })
          .map((reference: { id: unknown }) => {
            return String(reference.id).toLowerCase();
          }),
      ).toEqual([PAGE_A]);
    });
  });
});

describe("IncidentService.onUpdateSuccess: the feed records scope changes", () => {
  let createFeedItem: MockFunction;

  beforeEach(() => {
    createFeedItem = getJestMockFunction();
    createFeedItem.mockResolvedValue(undefined);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation(createFeedItem as never);

    jest
      .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
      .mockReturnValue(undefined as never);

    jest.spyOn(IncidentService, "findOneById").mockImplementation((() => {
      const incident: Incident = new Incident();
      incident._id = incidentId;
      incident.projectId = projectId;
      incident.incidentNumber = 42;
      incident.incidentNumberWithPrefix = "INC-42";
      return Promise.resolve(incident);
    }) as never);

    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example/incidents/42"),
      );
    jest
      .spyOn(StatusPageService, "getStatusPageLinkInDashboard")
      .mockImplementation(((_projectId: ObjectID, statusPageId: ObjectID) => {
        return Promise.resolve(
          URL.fromString(
            `https://oneuptime.example/status-pages/${statusPageId.toString()}`,
          ),
        );
      }) as never);

    statusPageFindBy.mockImplementation(() => {
      return Promise.resolve([
        statusPage(PAGE_A, "Site 03"),
        statusPage(PAGE_B, "Site 07"),
        statusPage(PAGE_C, "Site 05"),
      ]);
    });
  });

  async function runUpdateSuccess(
    scopeChange: ScopeCarryForward | undefined,
  ): Promise<void> {
    await (
      IncidentService as unknown as { onUpdateSuccess: OnUpdateSuccess }
    ).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: incidentId },
          data: { statusPages: [] } as UpdateBy<Incident>["data"],
          props: { tenantId: projectId, userId },
          limit: 1,
          skip: 0,
        },
        carryForward: {
          [incidentId]: {
            monitorsRemoved: [],
            monitorsAdded: [],
            oldChangeMonitorStatusIdTo: undefined,
            newMonitorChangeStatusIdTo: undefined,
            statusPageScopeChange: scopeChange,
          },
        },
      },
      [new ObjectID(incidentId)],
    );
  }

  function feedMarkdown(): string {
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    return createFeedItem.mock.calls[0]![0].feedInfoInMarkdown as string;
  }

  test("writes an Incident Updated item naming the pages added and removed", async () => {
    await runUpdateSuccess({
      addedStatusPageIds: [PAGE_A, PAGE_B],
      removedStatusPageIds: [PAGE_C],
      isScoped: true,
      notificationQueued: false,
    });

    const item: {
      incidentFeedEventType: IncidentFeedEventType;
      projectId: ObjectID;
      userId: ObjectID;
    } = createFeedItem.mock.calls[0]![0];

    expect(item.incidentFeedEventType).toBe(
      IncidentFeedEventType.IncidentUpdated,
    );
    expect(item.projectId).toBe(projectId);
    expect(item.userId).toBe(userId);

    const markdown: string = feedMarkdown();

    expect(markdown).toContain("INC-42");
    expect(markdown).toContain(
      `**📣 Status Pages Added**:\n- [Site 03](https://oneuptime.example/status-pages/${PAGE_A})\n- [Site 07](https://oneuptime.example/status-pages/${PAGE_B})\n`,
    );
    expect(markdown).toContain(
      `**🔕 Status Pages Removed**:\n- [Site 05](https://oneuptime.example/status-pages/${PAGE_C})\n`,
    );
    expect(markdown).toContain("only its selected status pages");
    expect(markdown).not.toContain("will be sent the notification");
  });

  test("says when the added pages will be sent the incident-created notification", async () => {
    await runUpdateSuccess({
      addedStatusPageIds: [PAGE_B],
      removedStatusPageIds: [],
      isScoped: true,
      notificationQueued: true,
    });

    expect(feedMarkdown()).toContain(
      "Subscribers of the added status pages will be sent the notification that this incident was created.",
    );
  });

  test("says when the scope is cleared", async () => {
    await runUpdateSuccess({
      addedStatusPageIds: [],
      removedStatusPageIds: [PAGE_A],
      isScoped: false,
      notificationQueued: false,
    });

    const markdown: string = feedMarkdown();

    expect(markdown).not.toContain("Status Pages Added");
    expect(markdown).toContain("no longer limited to specific status pages");
  });

  test("reads page names as root, within the incident's project", async () => {
    await runUpdateSuccess({
      addedStatusPageIds: [PAGE_A],
      removedStatusPageIds: [PAGE_C],
      isScoped: true,
      notificationQueued: false,
    });

    const findBy: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = statusPageFindBy.mock.calls[0]![0];

    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.query["projectId"]).toBe(projectId);
  });

  test("a page deleted since is still listed, without its name", async () => {
    await runUpdateSuccess({
      addedStatusPageIds: ["b0000000-0000-4000-8000-0000000000dd"],
      removedStatusPageIds: [],
      isScoped: true,
      notificationQueued: false,
    });

    expect(feedMarkdown()).toContain("- A deleted status page\n");
  });

  test("writes no item when the scope did not change", async () => {
    await runUpdateSuccess({
      addedStatusPageIds: [],
      removedStatusPageIds: [],
      isScoped: true,
      notificationQueued: false,
    });

    expect(createFeedItem).not.toHaveBeenCalled();
    expect(statusPageFindBy).not.toHaveBeenCalled();
  });

  test("writes no item when the update did not touch the scope", async () => {
    await runUpdateSuccess(undefined);

    expect(createFeedItem).not.toHaveBeenCalled();
  });

  test("a failure naming the pages does not fail the update that was already written", async () => {
    statusPageFindBy.mockImplementation(() => {
      return Promise.reject(new Error("connection lost"));
    });

    await expect(
      runUpdateSuccess({
        addedStatusPageIds: [PAGE_A],
        removedStatusPageIds: [],
        isScoped: true,
        notificationQueued: false,
      }),
    ).resolves.toBeUndefined();

    expect(createFeedItem).not.toHaveBeenCalled();
  });
});

/*
 * isScopedToStatusPages and the notification columns are computed, and the
 * hook writes them into the caller's own update. The column check runs after
 * the hook and exempts computed columns only on create, so their update
 * access control has to let every role that may edit statusPages through, or
 * a non-root scope edit would fail with "not allowed to update".
 */
describe("Incident column permissions for scope edits", () => {
  const HOOK_WRITTEN_COLUMNS: Array<string> = [
    "isScopedToStatusPages",
    "statusPagesNotifiedOnCreation",
    "subscriberNotificationStatusOnIncidentCreated",
    "subscriberNotificationStatusMessage",
  ];

  function access(column: string): {
    create: Array<Permission>;
    read: Array<Permission>;
    update: Array<Permission>;
  } {
    const columnAccess: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } = new Incident().getColumnAccessControlFor(column) || {};

    return {
      create: (columnAccess.create || []).slice(),
      read: (columnAccess.read || []).slice(),
      update: (columnAccess.update || []).slice(),
    };
  }

  test("statusPages has the access control of the monitors list", () => {
    expect(access("statusPages")).toEqual(access("monitors"));
  });

  test("isScopedToStatusPages has the create and update access control of statusPages", () => {
    expect(access("isScopedToStatusPages").create).toEqual(
      access("statusPages").create,
    );
    expect(access("isScopedToStatusPages").update).toEqual(
      access("statusPages").update,
    );
  });

  test.each(HOOK_WRITTEN_COLUMNS)(
    "every role that may edit statusPages may also write %s",
    (column: string) => {
      for (const role of access("statusPages").update) {
        expect(access(column).update).toContain(role);
      }
    },
  );

  test("statusPagesNotifiedOnCreation follows the update access control of the created status", () => {
    expect(access("statusPagesNotifiedOnCreation").update).toEqual(
      access("subscriberNotificationStatusOnIncidentCreated").update,
    );
  });

  test("the scope and the record are readable by every incident reader", () => {
    for (const column of [
      "statusPages",
      "isScopedToStatusPages",
      "statusPagesNotifiedOnCreation",
    ]) {
      expect(access(column).read.sort()).toEqual(access("title").read.sort());
    }
  });

  test("the derived columns are computed and hidden from the API docs", () => {
    const incident: Incident = new Incident();

    for (const column of [
      "isScopedToStatusPages",
      "statusPagesNotifiedOnCreation",
    ]) {
      expect(incident.getTableColumnMetadata(column).computed).toBe(true);
      expect(
        incident.getTableColumnMetadata(column).hideColumnInDocumentation,
      ).toBe(true);
    }
  });

  test.each([
    Permission.IncidentMember,
    Permission.IncidentAdmin,
    Permission.ProjectMember,
    Permission.EditProjectIncident,
  ])(
    "setting, re-queueing and clearing the scope passes the column check for %s",
    async (role: Permission) => {
      const props: DatabaseCommonInteractionProps = makeProps([role]);

      storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

      const set: Record<string, unknown> = (
        await runBeforeUpdate(
          scopeUpdate({
            data: { statusPages: [PAGE_A, PAGE_B] },
            props,
            miscDataProps:
              IncidentScopeAddedPagesNotification.getMiscDataProps(),
          }),
        )
      ).data;

      // Harness guard: the hook really injected the computed columns.
      expect(set["isScopedToStatusPages"]).toBe(true);
      expect(set["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );

      const cleared: Record<string, unknown> = (
        await runBeforeUpdate(scopeUpdate({ data: { statusPages: [] }, props }))
      ).data;

      expect(cleared["isScopedToStatusPages"]).toBe(false);

      for (const data of [set, cleared]) {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            Incident,
            data as unknown as Incident,
            props,
            DatabaseRequestType.Update,
          );
        }).not.toThrow();
      }
    },
  );

  test("harness guard: a viewer's scope edit is refused by the same check", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Incident,
        {
          statusPages: [statusPage(PAGE_A)],
          isScopedToStatusPages: true,
        } as unknown as Incident,
        makeProps([Permission.IncidentViewer]),
        DatabaseRequestType.Update,
      );
    }).toThrow();
  });

  test("a create carrying the computed columns passes the check for an incident member", () => {
    const incident: Incident = new Incident();
    incident.title = "Site outage";
    incident.statusPages = [statusPage(PAGE_A)];
    incident.isScopedToStatusPages = true;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Incident,
        incident,
        makeProps([Permission.IncidentMember]),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });
});

/*
 * End to end through DatabaseService.updateOneById for a non-root incident
 * member: the real hook, then the real column check, then the write. Only the
 * database, the label/access-control query rewrite, the success hooks and the
 * workflow, realtime and audit side effects are stubbed.
 */
describe("IncidentService.updateOneById: an incident member sets and clears the scope", () => {
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
    expect(saveMock).toHaveBeenCalledTimes(1);
    return saveMock.mock.calls[0]![0] as Record<string, unknown>;
  }

  test("sets the scope: the list and the derived flag are written together", async () => {
    await IncidentService.updateOneById({
      id: new ObjectID(incidentId),
      data: {
        statusPages: [statusPage(PAGE_A), statusPage(PAGE_B)],
      },
      props: makeProps([Permission.IncidentMember]),
    });

    const written: Record<string, unknown> = saved();

    expect(savedStatusPageIds(written)).toEqual([PAGE_A, PAGE_B]);
    expect(written["isScopedToStatusPages"]).toBe(true);
    expect(written["_id"]).toBe(incidentId);
  });

  test("clears the scope", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

    await IncidentService.updateOneById({
      id: new ObjectID(incidentId),
      data: { statusPages: [] },
      props: makeProps([Permission.IncidentMember]),
    });

    const written: Record<string, unknown> = saved();

    expect(written["statusPages"]).toEqual([]);
    expect(written["isScopedToStatusPages"]).toBe(false);
  });

  test("adds pages and re-queues the notification in the same write", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

    await IncidentService.updateOneById({
      id: new ObjectID(incidentId),
      data: { statusPages: [statusPage(PAGE_A), statusPage(PAGE_B)] },
      miscDataProps: IncidentScopeAddedPagesNotification.getMiscDataProps(),
      props: makeProps([Permission.IncidentMember]),
    });

    const written: Record<string, unknown> = saved();

    expect(written["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(written["subscriberNotificationStatusMessage"]).toBe(
      IncidentScopeAddedPagesNotification.queuedMessage,
    );
  });

  test("a flag sent on its own writes nothing", async () => {
    await IncidentService.updateOneById({
      id: new ObjectID(incidentId),
      data: { isScopedToStatusPages: true },
      props: makeProps([Permission.IncidentMember]),
    });

    expect(saveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("an incident viewer cannot change the scope", async () => {
    await expect(
      IncidentService.updateOneById({
        id: new ObjectID(incidentId),
        data: { statusPages: [statusPage(PAGE_A)] },
        props: makeProps([Permission.IncidentViewer]),
      }),
    ).rejects.toThrow();

    expect(saveMock).not.toHaveBeenCalled();
  });
});

/*
 * The created feed item of a scoped incident names the pages it is limited
 * to, so the feed's history starts with the scope the incident was declared
 * with. The pages are read on their own, not in onCreateSuccess's select.
 */
describe("IncidentService created feed item: the scope the incident was declared with", () => {
  let createFeedItem: MockFunction;
  let findOneById: MockFunction;
  let storedStatusPages: Array<StatusPage> = [];

  beforeEach(() => {
    storedStatusPages = [];

    createFeedItem = getJestMockFunction();
    createFeedItem.mockResolvedValue(undefined);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation(createFeedItem as never);

    jest
      .spyOn(IncidentWorkspaceMessages, "getIncidentCreateMessageBlocks")
      .mockResolvedValue([] as never);

    jest
      .spyOn(StatusPageService, "getStatusPageLinkInDashboard")
      .mockImplementation(((_projectId: ObjectID, statusPageId: ObjectID) => {
        return Promise.resolve(
          URL.fromString(
            `https://oneuptime.example/status-pages/${statusPageId.toString()}`,
          ),
        );
      }) as never);

    findOneById = getJestMockFunction();
    findOneById.mockImplementation(() => {
      const incident: Incident = new Incident();
      incident._id = incidentId;
      incident.statusPages = storedStatusPages;
      return Promise.resolve(incident);
    });
    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation(findOneById as never);
  });

  function createdIncident(isScoped: boolean): Incident {
    const incident: Incident = new Incident();
    incident._id = incidentId;
    incident.projectId = projectId;
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    incident.title = "Shared uplink down";
    incident.isScopedToStatusPages = isScoped;
    return incident;
  }

  async function createdFeedMarkdown(incident: Incident): Promise<string> {
    await (
      IncidentService as unknown as {
        createIncidentFeedAsync: (incident: Incident) => Promise<void>;
      }
    ).createIncidentFeedAsync(incident);

    expect(createFeedItem).toHaveBeenCalledTimes(1);

    return createFeedItem.mock.calls[0]![0].feedInfoInMarkdown as string;
  }

  test("lists the pages a scoped incident is limited to", async () => {
    storedStatusPages = [
      statusPage(PAGE_A, "Site 03"),
      statusPage(PAGE_B, "Site 07"),
    ];

    const markdown: string = await createdFeedMarkdown(createdIncident(true));

    expect(markdown).toContain(
      `📣 **Limited to Status Pages**:\n- [Site 03](https://oneuptime.example/status-pages/${PAGE_A})\n- [Site 07](https://oneuptime.example/status-pages/${PAGE_B})\n`,
    );

    const read: {
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findOneById.mock.calls[0]![0];

    expect(read.select).toEqual({ statusPages: { _id: true, name: true } });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("says so when every page it was limited to has been deleted since", async () => {
    storedStatusPages = [];

    expect(await createdFeedMarkdown(createdIncident(true))).toContain(
      "not shown on any status page",
    );
  });

  test("an unscoped incident gets no scope section, and nothing is read for it", async () => {
    const markdown: string = await createdFeedMarkdown(createdIncident(false));

    expect(markdown).not.toContain("Limited to Status Pages");
    expect(findOneById).not.toHaveBeenCalled();
  });
});
