import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import IncidentStatusPageScopeCopy from "../../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import {
  NOTIFY_BOX_DESCRIPTION,
  NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT,
  getNotifyBoxDescription,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/Incident/NewIncidentNotifyDefaultCopy";
import Incident from "../../../../Models/DatabaseModels/Incident";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../Server/Types/Database/Permissions/ColumnPermission";
import logger from "../../../../Server/Utils/Logger";
import IncidentSubscriberAudienceBuilder from "../../../../Server/Utils/StatusPage/IncidentSubscriberAudienceBuilder";
import NewIncidentSubscriberNotificationDefaultReader from "../../../../Server/Utils/StatusPage/NewIncidentSubscriberNotificationDefaultReader";
import WorkspaceIncidentSubscriberNotification, {
  INCIDENT_NOTIFY_SUBSCRIBERS_COLUMN,
  WORKSPACE_NOTIFY_SUBSCRIBERS_EXCLUSION_TEXT,
  WORKSPACE_NOTIFY_SUBSCRIBERS_FIELD,
  WORKSPACE_NOTIFY_SUBSCRIBERS_PAGES_NAMED,
  WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT,
} from "../../../../Server/Utils/Workspace/WorkspaceIncidentSubscriberNotification";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceExcludedStatusPage,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceResult,
  IncidentSubscriberAudienceStatusPage,
} from "../../../../Types/StatusPage/IncidentSubscriberAudience";
import { WORKSPACE_CHECKBOX_TICKED_VALUE } from "../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * NOTIFY STATUS PAGE SUBSCRIBERS ON THE CHATS' DECLARE INCIDENT FORMS, AND
 * THE CONFIRMATION'S LINE ABOUT THEM (#7917, #7916).
 *
 * The one helper Slack's modal and Microsoft Teams' card share
 * (WorkspaceIncidentSubscriberNotification):
 *
 *   - its words are the Dashboard's: the box's name and question, and each
 *     status page's reason for telling nobody;
 *   - who is asked: whoever holds the column's create permission - the rule
 *     the server's column check writes it by, so the two never disagree -
 *     and never for an incident that will be private;
 *   - how the box starts: as the project says, read once, only for who is
 *     asked;
 *   - what a submitted form answers, in each chat's shape, and what a form
 *     with no box does: follow the project's switch;
 *   - an answer from someone who may not give one is refused, with who may;
 *   - the confirmation's line, for every way an incident can or cannot
 *     reach a status page subscriber - and never a claim that anyone was
 *     told, nor a throw once the incident exists.
 *
 * The forms and the submits through each chat's real path are in
 * SlackDeclareIncidentAffectedResourcesRoute and
 * MicrosoftTeamsDeclareIncidentAffectedResources.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "79170000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("79170000-0000-4000-8000-000000000002");
const INCIDENT_ID: ObjectID = new ObjectID(
  "79170000-0000-4000-8000-000000000003",
);

const TEXT: typeof WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT =
  WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT;

const DASHBOARD_CREATE_FILE: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create.tsx",
);

// A member's props: allow rows for `allowed`, and block rows for `blocked`.
function propsWith(
  allowed: Array<Permission>,
  blocked: Array<{ permission: Permission; labelIds?: Array<ObjectID> }> = [],
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = [
    ...allowed.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        isBlockPermission: false,
        labelIds: [],
      };
    }),
    ...blocked.map(
      (block: {
        permission: Permission;
        labelIds?: Array<ObjectID>;
      }): UserPermission => {
        return {
          _type: "UserPermission",
          permission: block.permission,
          isBlockPermission: true,
          labelIds: block.labelIds || [],
        };
      },
    ),
  ];

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  };
}

function counts(
  values: Partial<IncidentSubscriberAudienceCounts> = {},
): IncidentSubscriberAudienceCounts {
  return { ...IncidentSubscriberAudience.getEmptyCounts(), ...values };
}

function page(
  name: string,
  subscriberCounts: Partial<IncidentSubscriberAudienceCounts> = { email: 12 },
): IncidentSubscriberAudienceStatusPage {
  return {
    statusPageId: ObjectID.generate().toString(),
    name: name,
    subscriberCounts: counts(subscriberCounts),
  };
}

function excluded(
  name: string,
  reason: IncidentSubscriberAudienceExclusionReason,
): IncidentSubscriberAudienceExcludedStatusPage {
  return {
    statusPageId: ObjectID.generate().toString(),
    name: name,
    reason: reason,
  };
}

function audience(
  values: Partial<IncidentSubscriberAudienceResult> = {},
): IncidentSubscriberAudienceResult {
  return {
    hasMonitors: true,
    isScoped: false,
    isHiddenFromStatusPages: false,
    statusPages: [],
    hiddenStatusPageCount: 0,
    excludedStatusPages: [],
    selectedStatusPagesNotListingMonitors: [],
    ...values,
  };
}

function describe_(value: Partial<IncidentSubscriberAudienceResult>): string {
  return WorkspaceIncidentSubscriberNotification.describeAudience(
    audience(value),
  ).toString();
}

function willNotify(list: string): string {
  return `${TEXT.willNotify} ${list}.`;
}

function notNotified(reason: string): string {
  return `${TEXT.notNotified} ${reason}`;
}

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the words are the Dashboard's", () => {
  test("the box's name, as Declare New Incident titles it", () => {
    expect(TEXT.box).toBe("Notify Status Page Subscribers");
    expect(fs.readFileSync(DASHBOARD_CREATE_FILE, "utf8")).toContain(
      `title: "${TEXT.box}",`,
    );
  });

  test("its question, and the question in a project that starts it unticked", () => {
    expect(TEXT.question).toBe(NOTIFY_BOX_DESCRIPTION);
    expect(TEXT.questionUntickedByDefault).toBe(
      NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT,
    );

    for (const isTickedByDefault of [true, false]) {
      expect(
        WorkspaceIncidentSubscriberNotification.getField({
          isTickedByDefault: isTickedByDefault,
          isPrivate: false,
        })?.description,
      ).toBe(getNotifyBoxDescription(isTickedByDefault));
    }
  });

  test("each status page's reason, as the Dashboard's Not notified list says it", () => {
    const dashboard: Record<IncidentSubscriberAudienceExclusionReason, string> =
      {
        [IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope]:
          IncidentStatusPageScopeCopy.audienceOutsideScope,
        [IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents]:
          IncidentStatusPageScopeCopy.audienceOnlyShowsScoped,
        [IncidentSubscriberAudienceExclusionReason.HidesIncidents]:
          IncidentStatusPageScopeCopy.audienceHidesIncidents,
        [IncidentSubscriberAudienceExclusionReason.NotificationsOff]:
          IncidentStatusPageScopeCopy.audienceNotificationsOff,
        [IncidentSubscriberAudienceExclusionReason.AlreadyNotified]:
          IncidentStatusPageScopeCopy.audienceAlreadyNotified,
      };

    for (const reason of Object.values(
      IncidentSubscriberAudienceExclusionReason,
    )) {
      expect([
        reason,
        `{{name}} (${WORKSPACE_NOTIFY_SUBSCRIBERS_EXCLUSION_TEXT[reason]})`,
      ]).toEqual([reason, dashboard[reason]]);
    }

    expect(`{{name}} (${TEXT.noSubscribersYet})`).toBe(
      IncidentStatusPageScopeCopy.audiencePageWithoutSubscribers,
    );
    expect(`{{name}} (${TEXT.notListingMonitors})`).toBe(
      IncidentStatusPageScopeCopy.audienceNotListingMonitors,
    );
    expect(TEXT.oneMoreHiddenPage).toBe(
      IncidentStatusPageScopeCopy.audienceOneHiddenPage,
    );
    expect(TEXT.moreHiddenPages).toBe(
      IncidentStatusPageScopeCopy.audienceHiddenPages,
    );
  });

  test("what is written under the box is one short sentence or two, as every description under a field", () => {
    for (const description of [TEXT.question, TEXT.questionUntickedByDefault]) {
      expect(description.length).toBeLessThanOrEqual(150);
    }
  });

  test("the field is named for both chats alike, and its answer is saved in the incident's own column", () => {
    expect(WORKSPACE_NOTIFY_SUBSCRIBERS_FIELD).toBe(
      "notifyStatusPageSubscribers",
    );
    expect(INCIDENT_NOTIFY_SUBSCRIBERS_COLUMN).toBe(
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    );
  });
});

describe("mayChoose: whoever holds the column's create permission", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.CreateProjectIncident,
  ])("%s may", (permission: Permission) => {
    expect(
      WorkspaceIncidentSubscriberNotification.mayChoose(
        propsWith([permission]),
      ),
    ).toBe(true);
  });

  test.each([
    [[Permission.Viewer]],
    [[Permission.IncidentViewer]],
    [[Permission.ReadProjectIncident]],
    [[Permission.EditProjectIncident]],
    [[]],
  ])("a member holding only %j may not", (permissions: Array<Permission>) => {
    expect(
      WorkspaceIncidentSubscriberNotification.mayChoose(propsWith(permissions)),
    ).toBe(false);
  });

  test("a team's block with no labels takes it away, as it takes the column away on the server", () => {
    expect(
      WorkspaceIncidentSubscriberNotification.mayChoose(
        propsWith(
          [Permission.ProjectMember],
          [{ permission: Permission.CreateProjectIncident }],
        ),
      ),
    ).toBe(false);
  });

  test("a block with labels narrows which incidents, not the column: it still may", () => {
    expect(
      WorkspaceIncidentSubscriberNotification.mayChoose(
        propsWith(
          [Permission.ProjectMember],
          [
            {
              permission: Permission.CreateProjectIncident,
              labelIds: [ObjectID.generate()],
            },
          ],
        ),
      ),
    ).toBe(true);
  });

  test("OneUptime itself and a server admin always may", () => {
    expect(
      WorkspaceIncidentSubscriberNotification.mayChoose({ isRoot: true }),
    ).toBe(true);
    expect(
      WorkspaceIncidentSubscriberNotification.mayChoose({
        isMasterAdmin: true,
        userId: USER_ID,
      }),
    ).toBe(true);
  });

  /*
   * The Dashboard's form and the server's create both decide by the
   * column's own rule: the chats must answer as the create would, for
   * every member.
   */
  test.each([
    ["Project Member", propsWith([Permission.ProjectMember])],
    ["Create Incident", propsWith([Permission.CreateProjectIncident])],
    ["Viewer", propsWith([Permission.Viewer])],
    ["no permission", propsWith([])],
    [
      "Project Member, blocked from Create Incident",
      propsWith(
        [Permission.ProjectMember],
        [{ permission: Permission.CreateProjectIncident }],
      ),
    ],
  ])(
    "%s: it answers exactly as the server's column check writes the column",
    (_label: string, props: DatabaseCommonInteractionProps) => {
      const incident: Incident = new Incident();
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;

      let isWritten: boolean = true;

      try {
        ColumnPermissions.checkDataColumnPermissions(
          Incident,
          incident,
          { ...props },
          DatabaseRequestType.Create,
        );
      } catch {
        isWritten = false;
      }

      expect(WorkspaceIncidentSubscriberNotification.mayChoose(props)).toBe(
        isWritten,
      );
    },
  );

  test("the props it reads are left as they were: the create that follows takes them", () => {
    const props: DatabaseCommonInteractionProps = propsWith([
      Permission.ProjectMember,
    ]);
    const before: string = JSON.stringify(props);

    WorkspaceIncidentSubscriberNotification.mayChoose(props);

    expect(JSON.stringify(props)).toBe(before);
    expect(props.userGlobalAccessPermission).toBeUndefined();
  });
});

describe("readTickedByDefault: how the box starts, read only for who is asked", () => {
  type IsTickedByDefault =
    typeof NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault;

  let readSpy: SpyInstance<IsTickedByDefault>;

  beforeEach(() => {
    readSpy = jest
      .spyOn(
        NewIncidentSubscriberNotificationDefaultReader,
        "isTickedByDefault",
      )
      .mockResolvedValue(true);
  });

  test.each([true, false])(
    "as the project says (%s), read once, for the form's project",
    async (isTickedByDefault: boolean) => {
      readSpy.mockResolvedValue(isTickedByDefault);

      await expect(
        WorkspaceIncidentSubscriberNotification.readTickedByDefault({
          projectId: PROJECT_ID,
          props: propsWith([Permission.ProjectMember]),
        }),
      ).resolves.toBe(isTickedByDefault);

      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy).toHaveBeenCalledWith(PROJECT_ID);
    },
  );

  test("a member who may not choose is not asked, and nothing is read", async () => {
    await expect(
      WorkspaceIncidentSubscriberNotification.readTickedByDefault({
        projectId: PROJECT_ID,
        props: propsWith([Permission.Viewer]),
      }),
    ).resolves.toBeNull();

    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe("getField: what the form shows", () => {
  test("in a project that keeps it on: ticked, with the box's question", () => {
    expect(
      WorkspaceIncidentSubscriberNotification.getField({
        isTickedByDefault: true,
        isPrivate: false,
      }),
    ).toEqual({ isTickedByDefault: true, description: TEXT.question });
  });

  test("in a project that turned it off: unticked, and the question says so", () => {
    expect(
      WorkspaceIncidentSubscriberNotification.getField({
        isTickedByDefault: false,
        isPrivate: false,
      }),
    ).toEqual({
      isTickedByDefault: false,
      description: TEXT.questionUntickedByDefault,
    });
  });

  test.each([true, false])(
    "an incident that will be private is not asked about, ticked by default or not (%s)",
    (isTickedByDefault: boolean) => {
      expect(
        WorkspaceIncidentSubscriberNotification.getField({
          isTickedByDefault: isTickedByDefault,
          isPrivate: true,
        }),
      ).toBeNull();
    },
  );

  test("a member who is not asked gets no box", () => {
    expect(
      WorkspaceIncidentSubscriberNotification.getField({
        isTickedByDefault: null,
        isPrivate: false,
      }),
    ).toBeNull();
  });
});

describe("readSubmitted: what a form answers", () => {
  test.each([
    ["Slack, ticked", [WORKSPACE_CHECKBOX_TICKED_VALUE], true],
    ["Slack, unticked", [], false],
    ["Slack, an option it never had", ["something-else"], false],
    ["Teams, on", "true", true],
    ["Teams, off", "false", false],
    ["Teams, written another way", " TRUE ", true],
    ["a boolean, true", true, true],
    ["a boolean, false", false, false],
  ])("%s", (_label: string, value: unknown, answer: boolean) => {
    expect(WorkspaceIncidentSubscriberNotification.readSubmitted(value)).toBe(
      answer,
    );
  });

  test.each([
    ["no field at all", undefined],
    ["null", null],
    ["a word that is no answer", "yes"],
    ["a number", 1],
    ["an object", { value: "true" }],
  ])("%s: no answer", (_label: string, value: unknown) => {
    expect(
      WorkspaceIncidentSubscriberNotification.readSubmitted(value),
    ).toBeNull();
  });
});

describe("getRefusal: an answer from somebody who may not give one", () => {
  test.each([true, false])(
    "a member who may not choose, answering %s: refused, with who may, and how to declare it anyway",
    (choice: boolean) => {
      expect(
        WorkspaceIncidentSubscriberNotification.getRefusal({
          props: propsWith([Permission.Viewer]),
          choice: choice,
        }),
      ).toBe(
        "You do not have permission to choose whether status page subscribers are notified, so the incident was not declared. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident. Open the form again to declare it without this choice.",
      );
    },
  );

  test("a form with no box asks nothing of anyone: nothing to refuse", () => {
    expect(
      WorkspaceIncidentSubscriberNotification.getRefusal({
        props: propsWith([Permission.Viewer]),
        choice: null,
      }),
    ).toBeNull();
  });

  test.each([true, false])(
    "a member who may choose, answering %s: never refused",
    (choice: boolean) => {
      expect(
        WorkspaceIncidentSubscriberNotification.getRefusal({
          props: propsWith([Permission.ProjectMember]),
          choice: choice,
        }),
      ).toBeNull();
    },
  );
});

describe("applyToIncident: the answer is what the incident is created with", () => {
  type ApplyWithoutBox =
    typeof NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox;
  type IsTickedByDefault =
    typeof NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault;

  let applySpy: SpyInstance<ApplyWithoutBox>;
  let readSpy: SpyInstance<IsTickedByDefault>;

  beforeEach(() => {
    applySpy = jest.spyOn(
      NewIncidentSubscriberNotificationDefaultReader,
      "applyToIncidentDeclaredWithoutBox",
    );
    readSpy = jest
      .spyOn(
        NewIncidentSubscriberNotificationDefaultReader,
        "isTickedByDefault",
      )
      .mockResolvedValue(true);
  });

  test.each([
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ])(
    "answered %s in a project that starts the box %s: saved as answered, and the project is not read",
    async (choice: boolean, isTickedByDefault: boolean) => {
      readSpy.mockResolvedValue(isTickedByDefault);
      const incident: Incident = new Incident();

      await WorkspaceIncidentSubscriberNotification.applyToIncident({
        incident: incident,
        projectId: PROJECT_ID,
        choice: choice,
      });

      expect(
        incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBe(choice);
      expect(applySpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
    },
  );

  test("a form with no box, in a project that starts it unticked: declared without notifying, as before", async () => {
    readSpy.mockResolvedValue(false);
    const incident: Incident = new Incident();

    await WorkspaceIncidentSubscriberNotification.applyToIncident({
      incident: incident,
      projectId: PROJECT_ID,
      choice: null,
    });

    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(false);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a form with no box, in a project that keeps it on: the column is not written, as before", async () => {
    const incident: Incident = new Incident();

    await WorkspaceIncidentSubscriberNotification.applyToIncident({
      incident: incident,
      projectId: PROJECT_ID,
      choice: null,
    });

    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBeUndefined();
    expect(applySpy).toHaveBeenCalledTimes(1);
  });
});

describe("describeAudience: the confirmation's line for who the incident reaches", () => {
  test("hidden from status pages: nobody is told, whatever pages it reaches", () => {
    expect(
      describe_({
        isHiddenFromStatusPages: true,
        statusPages: [page("Acme Status")],
      }),
    ).toBe(notNotified(TEXT.hiddenReason));
  });

  test("one status page with subscribers: by name", () => {
    expect(describe_({ statusPages: [page("Acme Status")] })).toBe(
      willNotify("**Acme Status**"),
    );
  });

  test("two, and three: named, the last after 'and'", () => {
    expect(
      describe_({
        statusPages: [page("Acme Status"), page("Beta Status", { sms: 3 })],
      }),
    ).toBe(willNotify("**Acme Status** and **Beta Status**"));
    expect(
      describe_({
        statusPages: [page("A"), page("B"), page("C", { webhook: 1 })],
      }),
    ).toBe(willNotify("**A**, **B** and **C**"));
  });

  test("a page with no subscribers yet is not among those that will be told", () => {
    expect(
      describe_({
        statusPages: [page("Acme Status"), page("Empty Page", {})],
      }),
    ).toBe(willNotify("**Acme Status**"));
  });

  test("status pages the member may not read are counted, never named", () => {
    expect(describe_({ hiddenStatusPageCount: 1 })).toBe(
      willNotify(TEXT.oneHiddenPage),
    );
    expect(describe_({ hiddenStatusPageCount: 3 })).toBe(
      willNotify("3 status pages you do not have access to"),
    );
    expect(
      describe_({
        statusPages: [page("Acme Status")],
        hiddenStatusPageCount: 1,
      }),
    ).toBe(
      willNotify(
        "**Acme Status** and 1 more status page you do not have access to",
      ),
    );
    expect(
      describe_({
        statusPages: [page("Acme Status")],
        hiddenStatusPageCount: 2,
      }),
    ).toBe(
      willNotify(
        "**Acme Status** and 2 more status pages you do not have access to",
      ),
    );
  });

  test(`names ${WORKSPACE_NOTIFY_SUBSCRIBERS_PAGES_NAMED}, one more than that too, and counts the rest`, () => {
    const pages: (
      count: number,
    ) => Array<IncidentSubscriberAudienceStatusPage> = (
      count: number,
    ): Array<IncidentSubscriberAudienceStatusPage> => {
      return Array.from(
        { length: count },
        (
          _value: unknown,
          index: number,
        ): IncidentSubscriberAudienceStatusPage => {
          return page(`Site ${String(index + 1).padStart(2, "0")}`);
        },
      );
    };

    expect(describe_({ statusPages: pages(6) })).toBe(
      willNotify(
        "**Site 01**, **Site 02**, **Site 03**, **Site 04**, **Site 05** and **Site 06**",
      ),
    );
    expect(describe_({ statusPages: pages(7) })).toBe(
      willNotify(
        "**Site 01**, **Site 02**, **Site 03**, **Site 04**, **Site 05** and 2 more status pages",
      ),
    );
    expect(describe_({ statusPages: pages(8), hiddenStatusPageCount: 1 })).toBe(
      willNotify(
        "**Site 01**, **Site 02**, **Site 03**, **Site 04**, **Site 05**, 3 more status pages and 1 more status page you do not have access to",
      ),
    );
  });

  test("on no monitor: no status page shows it", () => {
    expect(describe_({ hasMonitors: false })).toBe(
      notNotified(TEXT.noMonitorsReason),
    );
  });

  test("no status page lists its monitors", () => {
    expect(describe_({})).toBe(notNotified(TEXT.noStatusPageReason));
  });

  test("the pages that show it have no subscribers yet: each by name", () => {
    expect(describe_({ statusPages: [page("Acme Status", {})] })).toBe(
      notNotified("**Acme Status** (no subscribers yet)."),
    );
    expect(
      describe_({
        statusPages: [page("Acme Status", {}), page("Beta Status", {})],
      }),
    ).toBe(
      notNotified(
        "**Acme Status** (no subscribers yet) and **Beta Status** (no subscribers yet).",
      ),
    );
  });

  test.each(Object.values(IncidentSubscriberAudienceExclusionReason))(
    "a page left out because it %s: by name, with the Dashboard's reason",
    (reason: IncidentSubscriberAudienceExclusionReason) => {
      expect(
        describe_({ excludedStatusPages: [excluded("Acme Status", reason)] }),
      ).toBe(
        notNotified(
          `**Acme Status** (${WORKSPACE_NOTIFY_SUBSCRIBERS_EXCLUSION_TEXT[reason]}).`,
        ),
      );
    },
  );

  test("pages with no subscribers yet and pages left out, said together", () => {
    expect(
      describe_({
        statusPages: [page("Acme Status", {})],
        excludedStatusPages: [
          excluded(
            "Internal",
            IncidentSubscriberAudienceExclusionReason.NotificationsOff,
          ),
          excluded(
            "Archive",
            IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          ),
        ],
      }),
    ).toBe(
      notNotified(
        "**Acme Status** (no subscribers yet), **Internal** (does not send notifications to its subscribers) and **Archive** (does not show incidents).",
      ),
    );
  });

  test("pages it is limited to that list none of its monitors: each by name", () => {
    expect(
      describe_({
        isScoped: true,
        selectedStatusPagesNotListingMonitors: [
          { statusPageId: ObjectID.generate().toString(), name: "Partners" },
        ],
      }),
    ).toBe(notNotified("**Partners** (lists none of these monitors)."));
  });

  test("a long list of pages that tell no one is cut short too", () => {
    const pages: Array<IncidentSubscriberAudienceExcludedStatusPage> =
      Array.from(
        { length: 9 },
        (
          _value: unknown,
          index: number,
        ): IncidentSubscriberAudienceExcludedStatusPage => {
          return excluded(
            `Site ${index + 1}`,
            IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          );
        },
      );

    expect(describe_({ excludedStatusPages: pages })).toBe(
      notNotified(
        "**Site 1** (does not show incidents), **Site 2** (does not show incidents), **Site 3** (does not show incidents), **Site 4** (does not show incidents), **Site 5** (does not show incidents) and 4 more status pages.",
      ),
    );
  });

  test("a page's name is text: it never becomes a link, a mention or emphasis", () => {
    const line: string = describe_({
      statusPages: [page("*Ops* [Status](https://evil.example) <!channel>")],
    });

    expect(line).toContain("\\*Ops\\*");
    expect(line).not.toContain("[Status](https://evil.example)");
    expect(line).not.toContain("<!channel>");
  });

  test("it never says anyone was told: only who will be, or who was not", () => {
    const lines: Array<string> = [
      describe_({ statusPages: [page("A")] }),
      describe_({ hiddenStatusPageCount: 2 }),
      describe_({}),
      describe_({ hasMonitors: false }),
      describe_({ isHiddenFromStatusPages: true }),
    ];

    for (const line of lines) {
      expect(line).not.toMatch(/\bwere notified\b|\bhas been notified\b/);
    }
  });
});

describe("getConfirmationLine: from the incident as created, and who it reaches", () => {
  type Build = typeof IncidentSubscriberAudienceBuilder.build;

  let buildSpy: SpyInstance<Build>;
  let warnSpy: SpyInstance<typeof logger.warn>;
  let built: IncidentSubscriberAudienceResult;

  beforeEach(() => {
    built = audience({ statusPages: [page("Acme Status")] });
    buildSpy = jest
      .spyOn(IncidentSubscriberAudienceBuilder, "build")
      .mockImplementation(async () => {
        return built;
      });
    warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  function created(values: Partial<Incident> = {}): Incident {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    Object.assign(incident, values);
    return incident;
  }

  function declared(values: Partial<Incident> = {}): Incident {
    const incident: Incident = new Incident();
    Object.assign(incident, values);
    return incident;
  }

  async function lineFor(data: {
    created?: Incident;
    declared?: Incident;
    props?: DatabaseCommonInteractionProps;
  }): Promise<string> {
    return (
      await WorkspaceIncidentSubscriberNotification.getConfirmationLine({
        projectId: PROJECT_ID,
        props: data.props || propsWith([Permission.ProjectMember]),
        created: data.created || created(),
        declared: data.declared || declared(),
      })
    ).toString();
  }

  test("the box on: who it reaches, read for the incident, as the member, in the project", async () => {
    const props: DatabaseCommonInteractionProps = propsWith([
      Permission.ProjectMember,
    ]);

    expect(
      await lineFor({
        declared: declared({
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        }),
        props: props,
      }),
    ).toBe(willNotify("**Acme Status**"));

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const request: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      incidentId: ObjectID;
    } = buildSpy.mock.calls[0]![0] as never;
    expect(request.projectId).toBe(PROJECT_ID);
    expect(request.incidentId.toString()).toBe(INCIDENT_ID.toString());
    expect(request.props.userId).toBe(USER_ID);
    // A copy: the reads write onto the props they are given.
    expect(request.props).not.toBe(props);
  });

  test("nothing said either way - the column's own default notifies them: who it reaches", async () => {
    expect(await lineFor({})).toBe(willNotify("**Acme Status**"));
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  test("the box off: not notified, why, and how to tell them later - and nobody's audience is read", async () => {
    expect(
      await lineFor({
        declared: declared({
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
        }),
      }),
    ).toBe(notNotified(`${TEXT.boxOffReason} ${TEXT.boxOffHint}`));
    expect(buildSpy).not.toHaveBeenCalled();
  });

  test("the incident as created decides: a create that wrote it off is off", async () => {
    expect(
      await lineFor({
        created: created({
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
        }),
        declared: declared({
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        }),
      }),
    ).toBe(notNotified(`${TEXT.boxOffReason} ${TEXT.boxOffHint}`));
  });

  test.each([
    ["declared private", { declared: { isPrivate: true } }],
    ["created private", { created: { isPrivate: true } }],
  ])(
    "%s: not notified, because it is private - whatever the box said, and nothing is read",
    async (
      _label: string,
      values: { declared?: Partial<Incident>; created?: Partial<Incident> },
    ) => {
      expect(
        await lineFor({
          created: created({
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
            ...(values.created || {}),
          }),
          declared: declared({
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
            ...(values.declared || {}),
          }),
        }),
      ).toBe(notNotified(TEXT.privateReason));
      expect(buildSpy).not.toHaveBeenCalled();
    },
  );

  test("every reason who it reaches gives is said: on no monitor, no status page, no subscribers", async () => {
    built = audience({ hasMonitors: false });
    expect(await lineFor({})).toBe(notNotified(TEXT.noMonitorsReason));

    built = audience({});
    expect(await lineFor({})).toBe(notNotified(TEXT.noStatusPageReason));

    built = audience({ statusPages: [page("Acme Status", {})] });
    expect(await lineFor({})).toBe(
      notNotified("**Acme Status** (no subscribers yet)."),
    );

    built = audience({ isHiddenFromStatusPages: true });
    expect(await lineFor({})).toBe(notNotified(TEXT.hiddenReason));
  });

  test("who it reaches cannot be worked out: it says so, logs why, and never throws", async () => {
    buildSpy.mockImplementation(async () => {
      throw new Error("the database is not connected");
    });

    await expect(lineFor({})).resolves.toBe(TEXT.couldNotWorkOut);
    expect(warnSpy).toHaveBeenCalled();
  });

  /*
   * Who reads the line just declared the incident: whoever may declare one
   * may see who it reaches, as on the Dashboard's review - so the line asks
   * no more of them than the create did.
   */
  test("everyone who may declare an incident may see who it reaches", () => {
    for (const permission of new Incident().getCreatePermissions()) {
      expect([
        permission,
        IncidentSubscriberAudienceBuilder.PERMISSIONS.includes(permission),
      ]).toEqual([permission, true]);
    }
  });

  test("the member's own reading decides which pages are named: never read as OneUptime", async () => {
    await lineFor({ props: propsWith([Permission.IncidentMember]) });

    const request: { props: DatabaseCommonInteractionProps } = buildSpy.mock
      .calls[0]![0] as never;
    expect(request.props.isRoot).toBeUndefined();
    expect(request.props.userId).toBe(USER_ID);
    expect(
      request.props.userTenantAccessPermission?.[PROJECT_ID.toString()]
        ?.permissions[0]?.permission,
    ).toBe(Permission.IncidentMember);
  });

  test("an incident the create gave back without its id: it says it could not work it out", async () => {
    const withoutId: Incident = new Incident();

    expect(await lineFor({ created: withoutId })).toBe(TEXT.couldNotWorkOut);
    expect(buildSpy).not.toHaveBeenCalled();
  });
});
