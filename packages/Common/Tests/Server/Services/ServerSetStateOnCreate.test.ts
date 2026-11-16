import Alert from "../../../Models/DatabaseModels/Alert";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import logger from "../../../Server/Utils/Logger";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT ONEUPTIME RECORDS ABOUT A RECORD IS NOT A CREATE'S TO SAY (#8907).
 *
 * #6541 held a create's value in a computed column - one OneUptime fills in
 * - to the column's create list. 32 such columns still listed whoever may
 * create the record, so a creator could start one with OneUptime's record
 * of it already written: its subscribers told or skipped, its owners told,
 * its number picked, its custom domain's certificate ordered or served, a
 * flag the service derives from the rest of the write, a template's next
 * event. Each was gone through. 29 now take no create list; the three a
 * creator chooses are named with why in ComputedColumnsFollowTheirCreateList,
 * which holds every computed column to the rule, and the custom domains have
 * a suite of their own (CustomDomainCertificateStateOnCreate).
 *
 * Here:
 *
 *   - the 29, by name: nobody may create one, and whoever could change one
 *     before still may - setting a notification's status back to Pending is
 *     how the dashboard sends it again;
 *   - the creates the product makes, through the whole create with the
 *     table in memory: an announcement posted from the dashboard, from a
 *     security playbook or an OpenStack notice, and an incident template
 *     made as the browser tests make one. What they send still goes
 *     through; a member's own value in one of these columns - a script's,
 *     a record read and sent back - is dropped, and refused by its name to
 *     someone who may create the record but not read it;
 *   - what the creators still choose: the state an incident starts in, from
 *     the declare form's Initial State, and the statuses that count as down.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "89070000-0000-4000-8000-0000000000a1",
);

interface ClosedColumn {
  modelType: DatabaseBaseModelType;
  column: string;
  /*
   * Who may change it once the record exists: whoever may edit the record
   * (a notification sent again, a scope edited), or nobody.
   */
  changedBy: "the record's editors" | "nobody";
}

const CLOSED_COLUMNS: Array<ClosedColumn> = [
  // A custom domain's certificate state.
  { modelType: StatusPageDomain, column: "isSslOrdered", changedBy: "nobody" },
  {
    modelType: StatusPageDomain,
    column: "isSslProvisioned",
    changedBy: "nobody",
  },
  { modelType: DashboardDomain, column: "isSslOrdered", changedBy: "nobody" },
  {
    modelType: DashboardDomain,
    column: "isSslProvisioned",
    changedBy: "nobody",
  },

  // Whether subscribers were told, and how it went.
  {
    modelType: Incident,
    column: "subscriberNotificationStatusOnIncidentCreated",
    changedBy: "the record's editors",
  },
  {
    modelType: Incident,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },
  {
    modelType: Incident,
    column: "subscriberNotificationStatusOnPostmortemPublished",
    changedBy: "the record's editors",
  },
  {
    modelType: Incident,
    column: "subscriberNotificationStatusMessageOnPostmortemPublished",
    changedBy: "the record's editors",
  },
  {
    modelType: IncidentPublicNote,
    column: "subscriberNotificationStatusOnNoteCreated",
    changedBy: "the record's editors",
  },
  {
    modelType: IncidentPublicNote,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },
  {
    modelType: IncidentEpisodePublicNote,
    column: "subscriberNotificationStatusOnNoteCreated",
    changedBy: "the record's editors",
  },
  {
    modelType: IncidentEpisodePublicNote,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },
  {
    modelType: ScheduledMaintenancePublicNote,
    column: "subscriberNotificationStatusOnNoteCreated",
    changedBy: "the record's editors",
  },
  {
    modelType: ScheduledMaintenancePublicNote,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },
  {
    modelType: IncidentStateTimeline,
    column: "subscriberNotificationStatus",
    changedBy: "the record's editors",
  },
  {
    modelType: IncidentStateTimeline,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },
  {
    modelType: ScheduledMaintenanceStateTimeline,
    column: "subscriberNotificationStatus",
    changedBy: "the record's editors",
  },
  {
    modelType: ScheduledMaintenanceStateTimeline,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },
  {
    modelType: StatusPageAnnouncement,
    column: "subscriberNotificationStatus",
    changedBy: "the record's editors",
  },
  {
    modelType: StatusPageAnnouncement,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },
  {
    modelType: ScheduledMaintenance,
    column: "subscriberNotificationStatusOnEventScheduled",
    changedBy: "the record's editors",
  },
  {
    modelType: ScheduledMaintenance,
    column: "subscriberNotificationStatusMessage",
    changedBy: "the record's editors",
  },

  // Whether its owners were told.
  {
    modelType: StatusPage,
    column: "isOwnerNotifiedOfResourceCreation",
    changedBy: "nobody",
  },
  {
    modelType: StatusPageAnnouncement,
    column: "isOwnerNotified",
    changedBy: "nobody",
  },

  // Its number in its project.
  { modelType: Alert, column: "alertNumber", changedBy: "nobody" },
  {
    modelType: ScheduledMaintenance,
    column: "scheduledMaintenanceNumber",
    changedBy: "nobody",
  },

  // What the service works out from the rest of the write.
  {
    modelType: Incident,
    column: "isScopedToStatusPages",
    changedBy: "the record's editors",
  },
  {
    modelType: IncidentTemplate,
    column: "isScopedToStatusPages",
    changedBy: "the record's editors",
  },
  {
    modelType: ScheduledMaintenanceTemplate,
    column: "scheduleNextEventAt",
    changedBy: "the record's editors",
  },
];

function nameOf(entry: ClosedColumn): string {
  return `${new entry.modelType().tableName}.${entry.column}`;
}

function sorted(permissions: ReadonlyArray<Permission>): Array<Permission> {
  return [...permissions].sort();
}

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the create to be refused, but it went through.");
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the server-set columns closed to creates", () => {
  test("are 29, each named once", () => {
    const names: Array<string> = CLOSED_COLUMNS.map(nameOf);

    expect(names).toHaveLength(29);
    expect(new Set(names).size).toBe(29);
  });

  test.each(
    CLOSED_COLUMNS.map((entry: ClosedColumn): [string, ClosedColumn] => {
      return [nameOf(entry), entry];
    }),
  )(
    "%s is OneUptime's: computed, and nobody may create it",
    (_name: string, entry: ClosedColumn) => {
      const model: BaseModel = new entry.modelType();

      expect(model.getTableColumnMetadata(entry.column).computed).toBe(true);
      expect(model.getColumnAccessControlFor(entry.column)?.create).toEqual([]);
    },
  );

  test.each(
    CLOSED_COLUMNS.map(
      (entry: ClosedColumn): [string, string, ClosedColumn] => {
        return [nameOf(entry), entry.changedBy, entry];
      },
    ),
  )(
    "%s is changed by %s, as before",
    (_name: string, _who: string, entry: ClosedColumn) => {
      const model: BaseModel = new entry.modelType();
      const lists: ColumnAccessControl | null = model.getColumnAccessControlFor(
        entry.column,
      );

      if (entry.changedBy === "nobody") {
        expect(lists?.update).toEqual([]);
        return;
      }

      expect(sorted(lists?.update || [])).toEqual(
        sorted(
          TablePermission.getTablePermission(
            entry.modelType,
            DatabaseRequestType.Update,
          ),
        ),
      );
    },
  );

  /*
   * Read as before: everyone who may read the record may read whether its
   * subscribers and owners were told, its number, its certificate's state.
   */
  test.each(
    CLOSED_COLUMNS.map((entry: ClosedColumn): [string, ClosedColumn] => {
      return [nameOf(entry), entry];
    }),
  )(
    "%s is read by whoever may read the record",
    (_name: string, entry: ClosedColumn) => {
      const model: BaseModel = new entry.modelType();

      expect(
        sorted(model.getColumnAccessControlFor(entry.column)?.read || []),
      ).toEqual(sorted(model.getReadPermissions()));
    },
  );
});

describe("an announcement", () => {
  let announcements: InMemoryTable;

  beforeEach(() => {
    announcements = useInMemoryTable(StatusPageAnnouncementService, []);
  });

  // What the dashboard's Create Announcement sends.
  function postedOnTheDashboard(
    extra?: Record<string, unknown>,
  ): StatusPageAnnouncement {
    const page: StatusPage = new StatusPage();
    page._id = ObjectID.generate().toString();

    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();

    Object.assign(announcement, {
      projectId: PROJECT_ID,
      title: "Database upgrade on Sunday",
      description: "The dashboard is read-only from 02:00 to 03:00 UTC.",
      showAnnouncementAt: new Date("2026-11-20T09:00:00.000Z"),
      statusPages: [page],
      shouldStatusPageSubscribersBeNotified: true,
      ...extra,
    });

    return announcement;
  }

  // Everything that says its subscribers and owners have been told.
  const TOLD: Record<string, unknown> = {
    subscriberNotificationStatus:
      StatusPageSubscriberNotificationStatus.Success,
    subscriberNotificationStatusMessage: "Sent to all 1,284 subscribers.",
    isOwnerNotified: true,
  };

  function saved(): StoredRow {
    expect(announcements.inserts).toHaveLength(1);
    return announcements.inserts[0]!;
  }

  // Queued for subscribers, and still to be announced to its owners.
  function expectQueued(row: StoredRow): void {
    expect(row["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(row["subscriberNotificationStatusMessage"]).toBeUndefined();
    expect(row["isOwnerNotified"] === true).toBe(false);
  }

  const POSTERS: Array<[string, Array<Permission>]> = [
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
    ["a project member", [Permission.ProjectMember]],
    ["a Status Page Admin", [Permission.StatusPageAdmin]],
    ["a Status Page Member", [Permission.StatusPageMember]],
    [
      "someone who may post and read announcements",
      [
        Permission.CreateStatusPageAnnouncement,
        Permission.ReadStatusPageAnnouncement,
        Permission.ReadProjectStatusPage,
      ],
    ],
  ];

  /*
   * Posts announcements on the status pages they may read, without reading
   * announcements: the create's answer leaves out what they may not read.
   */
  const POSTS_WITHOUT_READING: Array<Permission> = [
    Permission.CreateStatusPageAnnouncement,
    Permission.ReadProjectStatusPage,
  ];

  test.each(POSTERS)(
    "posted on the dashboard by %s is queued for its subscribers, its owners still to be told",
    async (_who: string, permissions: Array<Permission>) => {
      await StatusPageAnnouncementService.create({
        data: postedOnTheDashboard(),
        props: member(permissions),
      });

      expectQueued(saved());
    },
  );

  test("posted with Notify off is skipped, saying why", async () => {
    await StatusPageAnnouncementService.create({
      data: postedOnTheDashboard({
        shouldStatusPageSubscribersBeNotified: false,
      }),
      props: member([Permission.StatusPageMember]),
    });

    const row: StoredRow = saved();
    expect(row["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(row["subscriberNotificationStatusMessage"]).toBe(
      "Notifications skipped as subscribers are not to be notified for this announcement.",
    );
  });

  test.each(POSTERS)(
    "the 'sent', message and 'owners told' that %s sends are dropped: it is queued as the dashboard's is",
    async (_who: string, permissions: Array<Permission>) => {
      await StatusPageAnnouncementService.create({
        data: postedOnTheDashboard(TOLD),
        props: member(permissions),
      });

      expectQueued(saved());
    },
  );

  test.each(Object.keys(TOLD))(
    "someone who may post announcements but not read them is refused for sending %s, by its name, and nothing is saved",
    async (column: string) => {
      const error: unknown = await refusalOf(
        StatusPageAnnouncementService.create({
          data: postedOnTheDashboard({ [column]: TOLD[column] }),
          props: member(POSTS_WITHOUT_READING),
        }),
      );

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as ColumnWriteRefusedException).columnName).toBe(column);
      expect(announcements.inserts).toEqual([]);
    },
  );

  test("the same member posts one with what the dashboard sends", async () => {
    await StatusPageAnnouncementService.create({
      data: postedOnTheDashboard(),
      props: member(POSTS_WITHOUT_READING),
    });

    expectQueued(saved());
  });

  /*
   * OneUptime's own: a security playbook's Post Announcement step and an
   * OpenStack notice post one as root, saying only whether to notify.
   */
  test.each([true, false])(
    "OneUptime's own, notifying %s, is saved as its hook decides",
    async (notify: boolean) => {
      await StatusPageAnnouncementService.create({
        data: postedOnTheDashboard({
          shouldStatusPageSubscribersBeNotified: notify,
        }),
        props: { isRoot: true },
      });

      expect(saved()["subscriberNotificationStatus"]).toBe(
        notify
          ? StatusPageSubscriberNotificationStatus.Pending
          : StatusPageSubscriberNotificationStatus.Skipped,
      );
    },
  );
});

describe("an incident template", () => {
  let templates: InMemoryTable;

  beforeEach(() => {
    templates = useInMemoryTable(IncidentTemplateService, []);
  });

  /*
   * What the browser tests send to make one through the API
   * (IncidentTemplateCustomFieldsOnCreate, Forms): its scope flag among
   * the rest, as a record read back carries it.
   */
  function madeAsTheBrowserTestsMakeIt(
    extra?: Record<string, unknown>,
  ): IncidentTemplate {
    const template: IncidentTemplate = new IncidentTemplate();

    Object.assign(template, {
      projectId: PROJECT_ID,
      templateName: "Customer reported",
      templateDescription: "Declared for problems customers report.",
      title: "Customer reported problem",
      description: "The template's own description.",
      incidentSeverityId: ObjectID.generate(),
      isScopedToStatusPages: false,
      ...extra,
    });

    return template;
  }

  function saved(): StoredRow {
    expect(templates.inserts).toHaveLength(1);
    return templates.inserts[0]!;
  }

  const MAKERS: Array<[string, Array<Permission>]> = [
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
    ["a project member", [Permission.ProjectMember]],
    ["an Incident Admin", [Permission.IncidentAdmin]],
    ["an Incident Member", [Permission.IncidentMember]],
    [
      "someone who may create and read templates",
      [Permission.CreateIncidentTemplate, Permission.ReadIncidentTemplate],
    ],
  ];

  test.each(MAKERS)(
    "made by %s as the browser tests make it, it is created, unscoped as its pages say",
    async (_who: string, permissions: Array<Permission>) => {
      await IncidentTemplateService.create({
        data: madeAsTheBrowserTestsMakeIt(),
        props: member(permissions),
      });

      expect(saved()["isScopedToStatusPages"]).toBe(false);
    },
  );

  /*
   * A template scoped to no page declares incidents that no status page
   * shows. Only the pages it is given scope it.
   */
  test.each(MAKERS)(
    "the 'scoped' that %s sends for a template with no pages is dropped: its incidents are not hidden from every status page",
    async (_who: string, permissions: Array<Permission>) => {
      await IncidentTemplateService.create({
        data: madeAsTheBrowserTestsMakeIt({ isScopedToStatusPages: true }),
        props: member(permissions),
      });

      expect(saved()["isScopedToStatusPages"]).toBe(false);
    },
  );

  test("someone who may create templates but not read them is refused for sending the flag, by its name, and nothing is saved", async () => {
    const error: unknown = await refusalOf(
      IncidentTemplateService.create({
        data: madeAsTheBrowserTestsMakeIt(),
        props: member([Permission.CreateIncidentTemplate]),
      }),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "isScopedToStatusPages",
    );
    expect(templates.inserts).toEqual([]);
  });

  test("the same member makes one without it", async () => {
    const template: IncidentTemplate = madeAsTheBrowserTestsMakeIt();
    delete (template as unknown as Record<string, unknown>)[
      "isScopedToStatusPages"
    ];

    await IncidentTemplateService.create({
      data: template,
      props: member([Permission.CreateIncidentTemplate]),
    });

    expect(saved()["isScopedToStatusPages"]).toBe(false);
  });
});

/*
 * The three computed columns a creator still chooses
 * (ComputedColumnsFollowTheirCreateList's CHOSEN_ON_CREATE), as the product
 * sends them: asked of what the caller sent, before any hook runs.
 */
describe("what a creator still chooses", () => {
  function sentBy(
    modelType: DatabaseBaseModelType,
    values: Record<string, unknown>,
    permissions: Array<Permission>,
  ): { taken: Array<string>; record: Record<string, unknown> } {
    const record: BaseModel = new modelType();
    Object.assign(record, values);

    return {
      taken: ColumnPermissions.checkComputedColumnsSentOnCreate(
        modelType,
        record,
        member(permissions),
      ),
      record: record as unknown as Record<string, unknown>,
    };
  }

  test.each(
    TablePermission.getTablePermission(
      Incident,
      DatabaseRequestType.Create,
    ).map((permission: Permission): [Permission] => {
      return [permission];
    }),
  )(
    "the Initial State picked on the declare form, sent as currentIncidentState, is the declarer's to pick, holding %s",
    (permission: Permission) => {
      const initialState: string = ObjectID.generate().toString();

      const { taken, record } = sentBy(
        Incident,
        {
          title: "Checkout is failing",
          currentIncidentState: initialState,
          // Sent along with it by a client that read an incident back.
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Success,
        },
        [permission, Permission.ReadProjectIncident],
      );

      expect(taken).toContain("currentIncidentState");
      expect(record["currentIncidentState"]).toBe(initialState);
      // The notification's status is OneUptime's: dropped.
      expect(taken).not.toContain(
        "subscriberNotificationStatusOnIncidentCreated",
      );
      expect(
        record["subscriberNotificationStatusOnIncidentCreated"],
      ).toBeUndefined();
    },
  );

  test.each([
    ["a status page", StatusPage, Permission.StatusPageMember],
    [
      "a service level objective",
      ServiceLevelObjective,
      Permission.CreateServiceLevelObjective,
    ],
  ] as Array<[string, DatabaseBaseModelType, Permission]>)(
    "the statuses that count as down on %s are its creator's to pick",
    (
      _what: string,
      modelType: DatabaseBaseModelType,
      permission: Permission,
    ) => {
      const statuses: Array<{ _id: string }> = [
        { _id: ObjectID.generate().toString() },
      ];

      const { taken, record } = sentBy(
        modelType,
        { downtimeMonitorStatuses: statuses },
        [permission],
      );

      expect(taken).toEqual(["downtimeMonitorStatuses"]);
      expect(record["downtimeMonitorStatuses"]).toBe(statuses);
    },
  );
});
