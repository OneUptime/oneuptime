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
import SubscriberNotificationResend from "../../../Types/StatusPage/SubscriberNotificationResend";
import StatusPageReadAccess from "../../../Server/Utils/StatusPage/StatusPageReadAccess";
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
  notificationAlreadyQueued?: boolean | undefined;
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
  /*
   * An incident whose send settled since the record was introduced: it has
   * a record, empty unless a test says who was told. An incident from before
   * the record (null) is its own case below.
   */
  incident.statusPagesNotifiedOnCreation = [];

  const { statusPageIds, ...rest } = overrides;

  incident.statusPages = (statusPageIds || []).map((id: string) => {
    return statusPage(id);
  });

  Object.assign(incident, rest);
  return incident;
}

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsInQueryOperator(operator: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<Array<string>>
  )
    .flat()
    .map((id: string): string => {
      return String(id).toLowerCase();
    });
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

  test("a non-root caller's read is limited to their own project", async () => {
    /*
     * The update's tenant filter is only added after this hook, so without
     * it another project's incident would be read, and could refuse the
     * edit on its own state instead of the usual "nothing updated".
     */
    await runBeforeUpdate(scopeUpdate({ data: { statusPages: [PAGE_A] } }));

    expect(incidentFindBy.mock.calls[0]![0].query["projectId"]).toBe(projectId);
  });

  test("a root caller's read uses the update's own query", async () => {
    await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [PAGE_A] }, props: { isRoot: true } }),
    );

    expect(incidentFindBy.mock.calls[0]![0].query).toEqual({
      _id: incidentId,
    });
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
      notificationAlreadyQueued: false,
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

    // Only the hidden-page question: nothing is added.
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

  test("an incident with no scope has no hidden pages to keep: only the added pages are checked", async () => {
    storedIncidents = [storedIncident({ statusPageIds: [] })];

    await runBeforeUpdate(scopeUpdate({ data: { statusPages: [PAGE_A] } }));

    expect(statusPageFindBy).toHaveBeenCalledTimes(1);
    expect(
      idsInQueryOperator(statusPageFindBy.mock.calls[0]![0].query["_id"]),
    ).toEqual([PAGE_A]);
  });

  test("a bulk edit keeps hidden pages every matched incident holds", async () => {
    readableStatusPageIds = [PAGE_A, PAGE_B];
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
    "while the notification is %s, with a record of the pages told",
    (status: StatusPageSubscriberNotificationStatus) => {
      test("adding a page with the box ticked queues it again", async () => {
        storedIncidents = [
          withStatus(status, { statusPagesNotifiedOnCreation: [PAGE_A] }),
        ];

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
          notificationAlreadyQueued: false,
        });
        // The record of notified pages is the job's, and is left alone.
        expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
      });

      test("without the box, the scope changes and nothing is queued", async () => {
        storedIncidents = [
          withStatus(status, { statusPagesNotifiedOnCreation: [PAGE_A] }),
        ];

        const { data, carryForward } = await runBeforeUpdate(
          addPages({ box: false }),
        );

        expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B]);
        expect(data).not.toHaveProperty(
          "subscriberNotificationStatusOnIncidentCreated",
        );
        expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
        expect(scopeChangeOf(carryForward)?.notificationQueued).toBe(false);
      });
    },
  );

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "while the notification is %s, the edit goes through and the send picks the pages up",
    async (status: StatusPageSubscriberNotificationStatus) => {
      /*
       * A queued send reads the scope when it goes out; a running one reads
       * it again when it finishes. So nothing is refused or rewritten, and
       * onUpdateSuccess is told to check the send did not slip past.
       */
      storedIncidents = [withStatus(status)];

      const { data, carryForward } = await runBeforeUpdate(addPages());

      expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B]);
      expect(data).not.toHaveProperty(
        "subscriberNotificationStatusOnIncidentCreated",
      );
      expect(data).not.toHaveProperty("subscriberNotificationStatusMessage");
      expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
      expect(scopeChangeOf(carryForward)?.notificationQueued).toBe(false);
      expect(scopeChangeOf(carryForward)?.notificationAlreadyQueued).toBe(true);
    },
  );

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

  test("a bulk edit queues when one matched incident is being sent: that send picks the pages up", async () => {
    storedIncidents = [
      withStatus(StatusPageSubscriberNotificationStatus.Success),
      storedIncident({
        _id: secondIncidentId,
        statusPageIds: [],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
      } as Partial<Incident>),
    ];

    const { data, carryForward } = await runBeforeUpdate(addPages());

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(
      scopeChangeOf(carryForward, secondIncidentId)?.notificationQueued,
    ).toBe(false);
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
      notificationAlreadyQueued: false,
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
      notificationAlreadyQueued: false,
    });
  });
});

/*
 * The job's record of told pages decides who a re-queued 'created'
 * notification goes to. Two kinds of incident have no record (null), and
 * neither may let an added-pages request tell pages that were not added.
 */
describe("IncidentService.onBeforeUpdate: added pages and incidents without a record of told pages", () => {
  function addPage(
    statusPages: Array<string>,
    box: boolean = true,
  ): UpdateBy<Incident> {
    return scopeUpdate({
      data: { statusPages: statusPages },
      miscDataProps: box
        ? IncidentScopeAddedPagesNotification.getMiscDataProps()
        : undefined,
    });
  }

  async function expectNothingQueued(
    updateBy: UpdateBy<Incident>,
  ): Promise<Record<string, unknown>> {
    const { data, carryForward } = await runBeforeUpdate(updateBy);

    expect(data).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
    expect(data).not.toHaveProperty("subscriberNotificationStatusMessage");
    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
    expect(scopeChangeOf(carryForward)?.notificationQueued).toBe(false);

    return data;
  }

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "an incident told before the record existed (%s, no record) is not told again when it is scoped",
    async (status: StatusPageSubscriberNotificationStatus) => {
      /*
       * Created last release on a monitor shared by every site: all of them
       * were emailed. Narrowing it to Site A and B must not email them again.
       */
      storedIncidents = [
        storedIncident({
          statusPageIds: [],
          subscriberNotificationStatusOnIncidentCreated: status,
          statusPagesNotifiedOnCreation: null as unknown as Array<string>,
        }),
      ];

      const data: Record<string, unknown> = await expectNothingQueued(
        addPage([PAGE_A, PAGE_B]),
      );

      // The scope itself still changes.
      expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_B]);
      expect(data["isScopedToStatusPages"]).toBe(true);
    },
  );

  test("an incident published without announcing it tells only the page added later, not the pages it was limited to", async () => {
    /*
     * Hidden and Skipped, then published with 'Notify subscribers' unticked:
     * still Skipped, no record. Adding Site C with the box ticked must not
     * announce it on A and B, which the editor declined.
     */
    storedIncidents = [
      storedIncident({
        statusPageIds: [PAGE_A, PAGE_B],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        subscriberNotificationStatusMessage:
          IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      }),
    ];

    const { data, carryForward } = await runBeforeUpdate(
      addPage([PAGE_A, PAGE_B, PAGE_C]),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    // Written in the same update: the job then tells C only.
    expect(data["statusPagesNotifiedOnCreation"]).toEqual([PAGE_A, PAGE_B]);
    expect(scopeChangeOf(carryForward)?.notificationQueued).toBe(true);
  });

  test("a skipped incident that was not limited before: every page it is limited to now is added", async () => {
    storedIncidents = [
      storedIncident({
        statusPageIds: [],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      }),
    ];

    const { data } = await runBeforeUpdate(addPage([PAGE_A, PAGE_B]));

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
  });

  test("a skipped incident with a record keeps it", async () => {
    storedIncidents = [
      storedIncident({
        statusPageIds: [PAGE_A],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        statusPagesNotifiedOnCreation: [PAGE_A],
      }),
    ];

    const { data } = await runBeforeUpdate(addPage([PAGE_A, PAGE_B]));

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
  });

  test("without the box, a skipped incident's record is not written either", async () => {
    storedIncidents = [
      storedIncident({
        statusPageIds: [PAGE_A],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      }),
    ];

    await expectNothingQueued(addPage([PAGE_A, PAGE_B], false));
  });

  test("an unscoped incident narrowed to pages it already told queues nothing", async () => {
    // It reached every site; the record lists them.
    storedIncidents = [
      storedIncident({
        statusPageIds: [],
        statusPagesNotifiedOnCreation: [PAGE_A, PAGE_B, PAGE_C],
      }),
    ];

    await expectNothingQueued(addPage([PAGE_A, PAGE_B]));
  });

  test("a page removed earlier and added back is not told twice", async () => {
    storedIncidents = [
      storedIncident({
        statusPageIds: [PAGE_A],
        statusPagesNotifiedOnCreation: [PAGE_A, PAGE_B],
      }),
    ];

    await expectNothingQueued(addPage([PAGE_A, PAGE_B]));
  });

  test("a bulk edit writes one record for incidents that were limited to the same pages", async () => {
    storedIncidents = [
      storedIncident({
        statusPageIds: [PAGE_A],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      }),
      storedIncident({
        _id: secondIncidentId,
        statusPageIds: [PAGE_A],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      } as Partial<Incident>),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPages: [PAGE_A, PAGE_B] },
        query: { projectId: projectId },
        miscDataProps: IncidentScopeAddedPagesNotification.getMiscDataProps(),
      }),
    );

    expect(data["statusPagesNotifiedOnCreation"]).toEqual([PAGE_A]);
  });

  test.each([
    [
      "they were limited to different pages",
      {
        statusPageIds: [PAGE_B],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      },
    ],
    [
      "the other one has a record the write would overwrite",
      {
        statusPageIds: [PAGE_A],
        statusPagesNotifiedOnCreation: [PAGE_A],
      },
    ],
    [
      "the other one is already on its way",
      {
        statusPageIds: [PAGE_A],
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      },
    ],
  ])(
    "a bulk edit that would have to write a record is refused when %s",
    async (_label: string, other: Record<string, unknown>) => {
      storedIncidents = [
        storedIncident({
          statusPageIds: [PAGE_A],
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
          statusPagesNotifiedOnCreation: null as unknown as Array<string>,
        }),
        storedIncident({
          _id: secondIncidentId,
          ...other,
        } as Partial<Incident>),
      ];

      await expect(
        runBeforeUpdate(
          scopeUpdate({
            data: { statusPages: [PAGE_A, PAGE_B, PAGE_C] },
            query: { projectId: projectId },
            miscDataProps:
              IncidentScopeAddedPagesNotification.getMiscDataProps(),
          }),
        ),
      ).rejects.toThrow("Change them one at a time.");
    },
  );
});

/*
 * Picking a status page decides who is told about an incident, so it needs
 * read access to that page - through the API as well as the picker.
 */
describe("IncidentService.onBeforeUpdate: the pages an editor adds must be pages they can read", () => {
  test("an editor without status page access cannot add a page", async () => {
    readableStatusPageIds = null;
    storedIncidents = [storedIncident({ statusPageIds: [] })];

    await expect(
      runBeforeUpdate(
        scopeUpdate({
          data: { statusPages: [PAGE_A] },
          props: makeProps([Permission.IncidentMember]),
        }),
      ),
    ).rejects.toThrow(StatusPageReadAccess.getRefusalMessage("incident"));
  });

  test("a label-restricted editor cannot add a page outside their labels", async () => {
    readableStatusPageIds = [PAGE_A];
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A] })];

    await expect(
      runBeforeUpdate(scopeUpdate({ data: { statusPages: [PAGE_A, PAGE_C] } })),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("pages the incident already holds are not added, so they are not checked", async () => {
    // The dashboard sends the loaded list back, hidden pages included.
    readableStatusPageIds = [PAGE_A];
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, HIDDEN_PAGE_X] }),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { statusPages: [HIDDEN_PAGE_X] } }),
    );

    expect(savedStatusPageIds(data)).toEqual([HIDDEN_PAGE_X]);
  });

  test("removing pages needs no read access", async () => {
    readableStatusPageIds = null;
    storedIncidents = [storedIncident({ statusPageIds: [PAGE_A, PAGE_B] })];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPages: [PAGE_A] },
        props: makeProps([Permission.IncidentMember]),
      }),
    );

    // A was not readable, so it is kept as a hidden page too.
    expect(savedStatusPageIds(data).sort()).toEqual([PAGE_A, PAGE_B].sort());
  });

  test("a bulk edit checks every page it adds to any matched incident", async () => {
    readableStatusPageIds = [PAGE_A, PAGE_C];
    storedIncidents = [
      storedIncident({ statusPageIds: [PAGE_A, PAGE_C] }),
      storedIncident({
        _id: secondIncidentId,
        statusPageIds: [PAGE_A],
      } as Partial<Incident>),
    ];

    // C is added to the second one only, and readable: fine.
    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPages: [PAGE_A, PAGE_C] },
        query: { projectId: projectId },
      }),
    );

    expect(savedStatusPageIds(data)).toEqual([PAGE_A, PAGE_C]);
    expect(
      idsInQueryOperator(
        statusPageFindBy.mock.calls[statusPageFindBy.mock.calls.length - 1]![0]
          .query["_id"],
      ),
    ).toEqual([PAGE_C]);

    // B is added to both, and not readable.
    await expect(
      runBeforeUpdate(
        scopeUpdate({
          data: { statusPages: [PAGE_A, PAGE_B, PAGE_C] },
          query: { projectId: projectId },
        }),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a root caller adds any page of the project", async () => {
    readableStatusPageIds = null;
    storedIncidents = [storedIncident({ statusPageIds: [] })];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: { statusPages: [PAGE_A] },
        props: { isRoot: true },
      }),
    );

    expect(savedStatusPageIds(data)).toEqual([PAGE_A]);
    expect(statusPageFindBy).not.toHaveBeenCalled();
  });
});

/*
 * The API route of resending the 'created' notification - setting its status
 * back to Pending - goes to every page, as it always did. The job skips the
 * pages in its record, so the record is emptied in the same write.
 */
describe("IncidentService.onBeforeUpdate: a resend of the 'created' notification empties the record", () => {
  function resend(
    props: DatabaseCommonInteractionProps = MEMBER_PROPS,
    extra: Record<string, unknown> = {},
  ): UpdateBy<Incident> {
    return scopeUpdate({
      data: {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        ...extra,
      },
      props: props,
    });
  }

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Skipped,
  ])(
    "resending a notification that is %s reaches every page again",
    async (status: StatusPageSubscriberNotificationStatus) => {
      storedIncidents = [
        storedIncident({
          subscriberNotificationStatusOnIncidentCreated: status,
          statusPagesNotifiedOnCreation: [PAGE_A, PAGE_B],
        }),
      ];

      const { data } = await runBeforeUpdate(resend());

      expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
    },
  );

  test("Retry after a failure resumes: the pages the failed send told keep their record", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Failed,
        statusPagesNotifiedOnCreation: [PAGE_A],
      }),
    ];

    const { data } = await runBeforeUpdate(resend());

    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
  });

  test("a notification that is Pending keeps its record", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        statusPagesNotifiedOnCreation: [PAGE_A],
      }),
    ];

    const { data } = await runBeforeUpdate(resend());

    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
  });

  /*
   * A user's resend of a notification being sent is refused outright
   * (SubscriberNotificationInFlightRequeue.test.ts), so its record is never
   * touched; a root caller's keeps it.
   */
  test("a notification that is InProgress is not sent again by a user, and a root caller keeps its record", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.InProgress,
        statusPagesNotifiedOnCreation: [PAGE_A],
      }),
    ];

    await expect(runBeforeUpdate(resend())).rejects.toThrow(
      SubscriberNotificationResend.beingSentMessage,
    );

    const { data } = await runBeforeUpdate(resend({ isRoot: true }));

    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
  });

  test("turning notifying on creation on (root) resends to every page", async () => {
    storedIncidents = [
      storedIncident({
        statusPagesNotifiedOnCreation: [PAGE_A],
      }),
    ];

    const { data } = await runBeforeUpdate(
      scopeUpdate({
        data: {
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        },
        props: { isRoot: true },
      }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
  });

  test("a bulk resend empties the record when any matched incident would reach nobody", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Failed,
        statusPagesNotifiedOnCreation: [PAGE_A],
      }),
      storedIncident({
        _id: secondIncidentId,
        statusPagesNotifiedOnCreation: [PAGE_A],
      } as Partial<Incident>),
    ];

    const { data } = await runBeforeUpdate(resend());

    expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
  });

  test("a client's own record never survives, even on a resend", async () => {
    storedIncidents = [
      storedIncident({
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Failed,
      }),
    ];

    const { data } = await runBeforeUpdate(
      resend(MEMBER_PROPS, { statusPagesNotifiedOnCreation: [PAGE_C] }),
    );

    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
  });

  test("a root caller that writes the record itself keeps it", async () => {
    storedIncidents = [storedIncident()];

    const { data } = await runBeforeUpdate(
      resend({ isRoot: true }, { statusPagesNotifiedOnCreation: [PAGE_C] }),
    );

    expect(data["statusPagesNotifiedOnCreation"]).toEqual([PAGE_C]);
  });

  test("an update that does not resend reads nothing for it", async () => {
    await runBeforeUpdate(scopeUpdate({ data: { title: "Renamed" } }));

    expect(incidentFindBy).not.toHaveBeenCalled();
  });

  test("the resend's read is limited to the caller's project", async () => {
    storedIncidents = [storedIncident()];

    await runBeforeUpdate(resend());

    // The hook's own read, as root; the in-flight check reads as the caller.
    const rootReads: Array<{ query: JSONObject; props: JSONObject }> =
      incidentFindBy.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as { query: JSONObject; props: JSONObject };
        })
        .filter((read: { props: JSONObject }) => {
          return read.props["isRoot"] === true;
        });

    expect(rootReads).toHaveLength(1);
    expect(rootReads[0]!.query["projectId"]).toBe(projectId);
    expect(rootReads[0]!.props).toEqual({ isRoot: true });
  });
});

/*
 * A page added to an incident's scope while it is hidden cannot be told then,
 * and is no longer "added" by any later edit. Publishing offers to tell it.
 */
describe("IncidentService.onBeforeUpdate: publishing tells the pages added while the incident was hidden", () => {
  function publish(extra: Record<string, unknown> = {}): UpdateBy<Incident> {
    return scopeUpdate({
      data: { isVisibleOnStatusPage: true, ...extra },
      miscDataProps: IncidentCreatedRenotify.getMiscDataProps(),
    });
  }

  function toldThenHidden(
    overrides: Partial<Incident> & { statusPageIds?: Array<string> } = {},
  ): Incident {
    // Visible and told on A, hidden, then B added to its scope.
    return storedIncident({
      statusPageIds: [PAGE_A, PAGE_B],
      isVisibleOnStatusPage: false,
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Success,
      statusPagesNotifiedOnCreation: [PAGE_A],
      ...overrides,
    });
  }

  test("queues the notification for the pages that were never told", async () => {
    storedIncidents = [toldThenHidden()];

    const { data } = await runBeforeUpdate(publish());

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatusMessage"]).toBe(
      IncidentCreatedRenotify.queuedMessage,
    );
    // The record stays: the job tells B, not A again.
    expect(data).not.toHaveProperty("statusPagesNotifiedOnCreation");
  });

  test("queues nothing when every page of its scope was told", async () => {
    storedIncidents = [
      toldThenHidden({ statusPagesNotifiedOnCreation: [PAGE_A, PAGE_B] }),
    ];

    const { data } = await runBeforeUpdate(publish());

    expect(data).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
  });

  test("queues nothing for an incident told before the record existed", async () => {
    storedIncidents = [
      toldThenHidden({
        statusPagesNotifiedOnCreation: null as unknown as Array<string>,
      }),
    ];

    const { data } = await runBeforeUpdate(publish());

    expect(data).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
  });

  test("without the box, nothing is queued", async () => {
    storedIncidents = [toldThenHidden()];

    const { data } = await runBeforeUpdate(
      scopeUpdate({ data: { isVisibleOnStatusPage: true } }),
    );

    expect(data).not.toHaveProperty(
      "subscriberNotificationStatusOnIncidentCreated",
    );
  });

  test("the same edit's list of pages is the one that counts", async () => {
    storedIncidents = [
      toldThenHidden({ statusPagesNotifiedOnCreation: [PAGE_A, PAGE_B] }),
    ];

    const { data } = await runBeforeUpdate(
      publish({ statusPages: [PAGE_A, PAGE_B, PAGE_C] }),
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("reads the scope and the record, within the caller's project", async () => {
    storedIncidents = [toldThenHidden()];

    await runBeforeUpdate(publish());

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = incidentFindBy.mock.calls[0]![0];

    expect(findBy.select["statusPages"]).toEqual({ _id: true });
    expect(findBy.select["statusPagesNotifiedOnCreation"]).toBe(true);
    expect(findBy.query["projectId"]).toBe(projectId);
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

  describe("the pages a caller picks must be pages they can read", () => {
    let callerTemplates: Array<IncidentTemplate> | Error = [];
    let templatesWithPages: Array<IncidentTemplate> = [];

    beforeEach(() => {
      callerTemplates = [];
      templatesWithPages = [];

      jest.spyOn(IncidentTemplateService, "findBy").mockImplementation(((data: {
        props: DatabaseCommonInteractionProps;
      }) => {
        if (!data.props.isRoot) {
          return callerTemplates instanceof Error
            ? Promise.reject(callerTemplates)
            : Promise.resolve(callerTemplates);
        }

        return Promise.resolve(templatesWithPages);
      }) as never);
    });

    function template(
      id: string,
      statusPageIds: Array<string>,
    ): IncidentTemplate {
      const incidentTemplate: IncidentTemplate = new IncidentTemplate();
      incidentTemplate._id = id;
      incidentTemplate.statusPages = statusPageIds.map((pageId: string) => {
        return statusPage(pageId);
      });
      return incidentTemplate;
    }

    test("a page the caller cannot read is refused", async () => {
      readableStatusPageIds = [PAGE_A];

      await expect(
        runBeforeCreate(
          newIncident({
            statusPages: [statusPage(PAGE_A), statusPage(PAGE_C)],
          }),
          MEMBER_PROPS,
        ),
      ).rejects.toThrow(StatusPageReadAccess.getRefusalMessage("incident"));
    });

    test("a caller with no status page access at all cannot pick one", async () => {
      readableStatusPageIds = null;

      await expect(
        runBeforeCreate(
          newIncident({ statusPages: [statusPage(PAGE_A)] }),
          makeProps([Permission.IncidentMember]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a page of a template the caller can read may be picked without reading it", async () => {
      // The dashboard fills a template's pages in for whoever declares from it.
      readableStatusPageIds = null;
      callerTemplates = [template(templateId, [])];
      templatesWithPages = [template(templateId, [PAGE_C])];

      const created: Incident = await runBeforeCreate(
        newIncident({ statusPages: [statusPage(PAGE_C)] }),
        makeProps([Permission.IncidentMember]),
      );

      expect(
        IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
          created.statusPages,
        ),
      ).toEqual([PAGE_C]);
      expect(created.isScopedToStatusPages).toBe(true);

      // The templates are read with the caller's own permissions first.
      const callerRead: {
        query: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = (IncidentTemplateService.findBy as unknown as MockFunction).mock
        .calls[0]![0];

      expect(callerRead.props.isRoot).toBeFalsy();
      expect(callerRead.query["projectId"]).toBe(projectId);
    });

    test("a template page does not cover another page the caller cannot read", async () => {
      readableStatusPageIds = null;
      callerTemplates = [template(templateId, [])];
      templatesWithPages = [template(templateId, [PAGE_C])];

      await expect(
        runBeforeCreate(
          newIncident({
            statusPages: [statusPage(PAGE_C), statusPage(PAGE_B)],
          }),
          makeProps([Permission.IncidentMember]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a caller who cannot read templates gets no template's pages", async () => {
      readableStatusPageIds = null;
      callerTemplates = new NotAuthorizedException(
        "You do not have permissions to read Incident Template.",
      );
      templatesWithPages = [template(templateId, [PAGE_C])];

      await expect(
        runBeforeCreate(
          newIncident({ statusPages: [statusPage(PAGE_C)] }),
          makeProps([Permission.IncidentMember]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a root caller picks any page, and nothing is read for it", async () => {
      readableStatusPageIds = null;

      const incident: Incident = newIncident({
        statusPages: [statusPage(PAGE_C)],
      });
      incident.projectId = projectId;

      const created: Incident = await runBeforeCreate(incident, {
        isRoot: true,
      });

      expect(created.isScopedToStatusPages).toBe(true);
      expect(statusPageFindBy).not.toHaveBeenCalled();
    });
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

    test("pages copied from the template are not the caller's pick, so they are not checked", async () => {
      readableStatusPageIds = null;
      template = templateWithPages([PAGE_C]);

      const created: Incident = await runBeforeCreate(
        newIncident({ createdIncidentTemplateId: templateId }),
        makeProps([Permission.IncidentMember]),
      );

      expect(
        IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
          created.statusPages,
        ),
      ).toEqual([PAGE_C]);
      expect(statusPageFindBy).not.toHaveBeenCalled();
    });

    describe("a template whose status pages were all deleted", () => {
      function scopedTemplateWithoutPages(): IncidentTemplate {
        const incidentTemplate: IncidentTemplate = templateWithPages([]);
        incidentTemplate.isScopedToStatusPages = true;
        return incidentTemplate;
      }

      test("declares the incident scoped to nothing: hidden, rather than on every page", async () => {
        template = scopedTemplateWithoutPages();

        const created: Incident = await runBeforeCreate(
          newIncident({ createdIncidentTemplateId: templateId }),
        );

        expect(created.isScopedToStatusPages).toBe(true);
        expect(
          IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
            created.statusPages,
          ),
        ).toEqual([]);
      });

      test("reads the template's flag", async () => {
        template = scopedTemplateWithoutPages();

        await runBeforeCreate(
          newIncident({ createdIncidentTemplateId: templateId }),
        );

        const findOneBy: { select: Record<string, unknown> } = (
          IncidentTemplateService.findOneBy as unknown as MockFunction
        ).mock.calls[0]![0];

        expect(findOneBy.select["isScopedToStatusPages"]).toBe(true);
      });

      test("the pages the caller picked still win", async () => {
        template = scopedTemplateWithoutPages();

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
        expect(created.isScopedToStatusPages).toBe(true);
      });

      test("an explicitly empty list is still an intentional override", async () => {
        template = scopedTemplateWithoutPages();

        const created: Incident = await runBeforeCreate(
          newIncident({
            createdIncidentTemplateId: templateId,
            statusPages: [],
          }),
        );

        expect(created.isScopedToStatusPages).toBe(false);
      });

      test("a template that was never scoped still declares unscoped incidents", async () => {
        template = templateWithPages([]);
        template.isScopedToStatusPages = false;

        const created: Incident = await runBeforeCreate(
          newIncident({ createdIncidentTemplateId: templateId }),
        );

        expect(created.isScopedToStatusPages).toBe(false);
      });
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

  /*
   * Pages added while the 'created' notification was Pending or being sent
   * leave the status alone. If the whole send ran between this update
   * reading the status and writing the pages, it missed them: once the pages
   * are written, the notification is queued again for them.
   */
  describe("a send that finished without the pages the update added", () => {
    let stored: Incident | null = null;
    let updateOneById: MockFunction;

    beforeEach(() => {
      stored = null;

      jest.spyOn(IncidentService, "findOneById").mockImplementation(((data: {
        select: Record<string, unknown>;
      }) => {
        if (data.select["subscriberNotificationStatusOnIncidentCreated"]) {
          return Promise.resolve(stored);
        }

        const incident: Incident = new Incident();
        incident._id = incidentId;
        incident.projectId = projectId;
        incident.incidentNumber = 42;
        incident.incidentNumberWithPrefix = "INC-42";
        return Promise.resolve(incident);
      }) as never);

      updateOneById = getJestMockFunction();
      updateOneById.mockResolvedValue(1);
      jest
        .spyOn(IncidentService, "updateOneById")
        .mockImplementation(updateOneById as never);
    });

    function storedNotification(
      status: StatusPageSubscriberNotificationStatus,
      record: Array<string> | null,
    ): Incident {
      const incident: Incident = new Incident();
      incident._id = incidentId;
      incident.subscriberNotificationStatusOnIncidentCreated = status;
      incident.statusPagesNotifiedOnCreation = record as Array<string>;
      return incident;
    }

    const alreadyQueuedChange: ScopeCarryForward = {
      addedStatusPageIds: [PAGE_B],
      removedStatusPageIds: [],
      isScoped: true,
      notificationQueued: false,
      notificationAlreadyQueued: true,
    };

    test("queues it again when the send settled without an added page", async () => {
      stored = storedNotification(
        StatusPageSubscriberNotificationStatus.Success,
        [PAGE_A],
      );

      await runUpdateSuccess(alreadyQueuedChange);

      expect(updateOneById).toHaveBeenCalledTimes(1);
      expect(updateOneById.mock.calls[0]![0]).toEqual({
        id: new ObjectID(incidentId),
        data: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessage:
            IncidentScopeAddedPagesNotification.queuedMessage,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.InProgress,
    ])(
      "leaves a notification that is still %s alone: it reads the new pages itself",
      async (status: StatusPageSubscriberNotificationStatus) => {
        stored = storedNotification(status, [PAGE_A]);

        await runUpdateSuccess(alreadyQueuedChange);

        expect(updateOneById).not.toHaveBeenCalled();
      },
    );

    test("leaves it alone when the send did reach the added page", async () => {
      stored = storedNotification(
        StatusPageSubscriberNotificationStatus.Success,
        [PAGE_A, PAGE_B],
      );

      await runUpdateSuccess(alreadyQueuedChange);

      expect(updateOneById).not.toHaveBeenCalled();
    });

    test("leaves a failed send to its Retry", async () => {
      stored = storedNotification(
        StatusPageSubscriberNotificationStatus.Failed,
        [PAGE_A],
      );

      await runUpdateSuccess(alreadyQueuedChange);

      expect(updateOneById).not.toHaveBeenCalled();
    });

    test("checks nothing for an update that queued the notification itself, or found it settled", async () => {
      stored = storedNotification(
        StatusPageSubscriberNotificationStatus.Success,
        [PAGE_A],
      );

      await runUpdateSuccess({
        ...alreadyQueuedChange,
        notificationQueued: true,
        notificationAlreadyQueued: false,
      });

      expect(updateOneById).not.toHaveBeenCalled();
    });

    test("a failure checking does not fail the update that was already written", async () => {
      jest.spyOn(IncidentService, "findOneById").mockImplementation(((data: {
        select: Record<string, unknown>;
      }) => {
        if (data.select["subscriberNotificationStatusOnIncidentCreated"]) {
          return Promise.reject(new Error("connection lost"));
        }

        const incident: Incident = new Incident();
        incident._id = incidentId;
        incident.projectId = projectId;
        incident.incidentNumber = 42;
        return Promise.resolve(incident);
      }) as never);

      await expect(
        runUpdateSuccess(alreadyQueuedChange),
      ).resolves.toBeUndefined();

      expect(updateOneById).not.toHaveBeenCalled();
    });
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

  /*
   * An update writing these status pages. Built apart from the call, so the
   * compiler does not expand the deep partial-entity type of the literal.
   */
  function scopeData(ids: Array<string>): UpdateBy<Incident>["data"] {
    return {
      statusPages: ids.map((id: string): StatusPage => {
        return statusPage(id);
      }),
    } as unknown as UpdateBy<Incident>["data"];
  }

  function saved(): Record<string, unknown> {
    expect(saveMock).toHaveBeenCalledTimes(1);
    return saveMock.mock.calls[0]![0] as Record<string, unknown>;
  }

  test("sets the scope: the list and the derived flag are written together", async () => {
    await IncidentService.updateOneById({
      id: new ObjectID(incidentId),
      data: scopeData([PAGE_A, PAGE_B]),
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
      data: scopeData([PAGE_A, PAGE_B]),
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
        data: scopeData([PAGE_A]),
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
