import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * SubscriberNotificationPreviewBuilder: what "Preview notification" and "Send
 * test to me" show and send - for each status page an incident's email would
 * go to, the email its subscribers would get.
 *
 * It runs for real down to the services: the audience builder, the scope
 * helper, the email builder, the values builder, the Markdown renderer and
 * the template compiler are the real ones; only the rows they read are
 * faked. What is pinned:
 *
 *   - who may preview what: the audience roles; an incident that exists is
 *     read with the caller's own permissions inside the caller's project, so
 *     another project's incident and a private one the caller may not read
 *     are not found; a draft's monitors, status pages, labels and severity
 *     must all be the project's;
 *   - nothing will be sent: no monitors, a hidden, private or quiet incident,
 *     no page that shows it - and then no email is built at all;
 *   - only the pages the caller can read are previewed, each with its "up
 *     to" counts and which template is used and why;
 *   - no subscriber is ever read (so no address can leave), and building a
 *     preview publishes nothing: no custom field image is made public.
 */

jest.mock("../../../../Server/Services/IncidentCustomFieldService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/InlineImageAccessTokenSync", () => {
  return {
    __esModule: true,
    syncIsPublicForMarkdownImages: jest.fn(),
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriberNotificationTemplate from "../../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import CustomFieldMappingService from "../../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import { syncIsPublicForMarkdownImages } from "../../../../Server/Utils/InlineImageAccessTokenSync";
import SubscriberNotificationPreviewBuilder, {
  SubscriberNotificationPreviewBuild,
  SubscriberNotificationPreviewPage,
} from "../../../../Server/Utils/StatusPage/SubscriberNotificationPreviewBuilder";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import Dictionary from "../../../../Types/Dictionary";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
} from "../../../../Types/StatusPage/IncidentSubscriberAudience";
import SubscriberNotificationPreview, {
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewIncidentDraft,
  SubscriberNotificationPreviewNothingSentReason,
  SubscriberNotificationPreviewRequest,
  SubscriberNotificationSendTestRequest,
} from "../../../../Types/StatusPage/SubscriberNotificationPreview";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");

const INCIDENT_ID: string = "a0000000-0000-4000-8000-00000000000a";
const PRIVATE_INCIDENT_ID: string = "a0000000-0000-4000-8000-00000000000b";
const OTHER_PROJECT_INCIDENT_ID: string =
  "a0000000-0000-4000-8000-00000000000c";

const MONITOR_ID: string = "c0000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_MONITOR_ID: string = "c0000000-0000-4000-8000-000000000009";

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const SITE_3: string = "b0000000-0000-4000-8000-000000000003";

const SEVERITY_ID: string = "d0000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_SEVERITY_ID: string =
  "d0000000-0000-4000-8000-000000000009";
const LABEL_ID: string = "e0000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_LABEL_ID: string = "e0000000-0000-4000-8000-000000000009";

const IMAGE_URL: string =
  "https://oneuptime.acme.com/file/image/access-token/abc123";

interface PageFixture {
  id: string;
  name: string;
  smtp?: boolean | undefined;
}

// Three site pages; each lists the monitor.
const PAGES: Array<PageFixture> = [
  { id: SITE_1, name: "Site 01", smtp: true },
  { id: SITE_2, name: "Site 02" },
  { id: SITE_3, name: "Site 03" },
];

const COUNTS: Dictionary<IncidentSubscriberAudienceCounts> = {
  [SITE_1]: { ...IncidentSubscriberAudience.getEmptyCounts(), email: 41 },
  [SITE_2]: { ...IncidentSubscriberAudience.getEmptyCounts(), email: 18 },
  [SITE_3]: { ...IncidentSubscriberAudience.getEmptyCounts(), sms: 2 },
};

// The pages the caller may read; null reads all of them.
let readablePageIds: Array<string> | null = null;
// Incidents the caller may read (the rest are private to them).
let readableIncidentIds: Array<string> = [];
// The custom email template linked to each page, by id.
let templates: Dictionary<StatusPageSubscriberNotificationTemplate> = {};
// The status pages the incident is limited to; null is unscoped.
let storedScope: Array<string> | null = null;

function sameId(a: unknown, b: unknown): boolean {
  return (
    String(a?.toString() || "").toLowerCase() ===
    String(b?.toString() || "").toLowerCase()
  );
}

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsIn(operator: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<
      Array<string | ObjectID>
    >
  )
    .flat()
    .map((id: string | ObjectID): string => {
      return id.toString().toLowerCase();
    });
}

function props(
  grants: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: grants.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
  } as UserTenantAccessPermission;

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function makePage(fixture: PageFixture): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = fixture.id;
  page.name = fixture.name;
  page.pageTitle = `${fixture.name} Status`;
  page.projectId = PROJECT_ID;
  page.isPublicStatusPage = true;
  page.onlyShowScopedIncidents = false;
  page.showIncidentsOnStatusPage = true;

  if (fixture.smtp) {
    (page as unknown as JSONObject)["smtpConfig"] = {
      _id: "f0000000-0000-4000-8000-000000000001",
    };
  }

  return page;
}

function draft(
  overrides: Partial<SubscriberNotificationPreviewIncidentDraft> = {},
): SubscriberNotificationPreviewRequest {
  return {
    event: SubscriberNotificationPreviewEvent.IncidentCreated,
    incident: {
      title: "Checkout requests failing",
      description: "Payments fail in **Europe**.",
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [MONITOR_ID],
      statusPageIds: [],
      labelIds: [LABEL_ID],
      customFields: {},
      isPrivate: false,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      ...overrides,
    },
  };
}

function publicNote(
  incidentId: string = INCIDENT_ID,
): SubscriberNotificationPreviewRequest {
  return {
    event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
    incidentId: incidentId,
    note: "We are **rolling back** the release.",
    postedAt: null,
  };
}

async function preview(
  request: SubscriberNotificationPreviewRequest,
  options: {
    callerProps?: DatabaseCommonInteractionProps;
    onlyStatusPageId?: string;
  } = {},
): Promise<SubscriberNotificationPreviewBuild> {
  return SubscriberNotificationPreviewBuilder.build({
    projectId: PROJECT_ID,
    props: options.callerProps || props(),
    request: request,
    onlyStatusPageId: options.onlyStatusPageId,
  });
}

function pageIds(build: SubscriberNotificationPreviewBuild): Array<string> {
  return build.statusPages.map(
    (page: SubscriberNotificationPreviewPage): string => {
      return page.statusPageId;
    },
  );
}

function body(page: SubscriberNotificationPreviewPage): JSONObject {
  return page.email.envelope.vars as JSONObject;
}

let getSubscribersByStatusPage: Mock;
let subscriberFindBy: Mock;
let applyMappingsToCreate: Mock;

beforeEach(() => {
  readablePageIds = null;
  readableIncidentIds = [INCIDENT_ID];
  storedScope = null;
  templates = {};

  (syncIsPublicForMarkdownImages as unknown as jest.Mock).mockReset();

  // One Rich text field, included in subscriber notifications.
  (IncidentCustomFieldService.findBy as unknown as jest.Mock).mockReset();
  (IncidentCustomFieldService.findBy as unknown as jest.Mock).mockResolvedValue(
    [
      {
        name: "Impact details",
        variableKey: "impact_details",
        customFieldType: CustomFieldType.Markdown,
        includeInSubscriberNotifications: true,
        sortOrder: 1,
      },
      {
        name: "Customer count",
        variableKey: "customer_count",
        customFieldType: CustomFieldType.Number,
        includeInSubscriberNotifications: true,
        sortOrder: 2,
      },
    ] as never,
  );

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(Hostname.fromString("oneuptime.acme.com") as never);
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS as never);

  jest.spyOn(StatusPageService, "getStatusPageURL").mockImplementation((async (
    id: ObjectID,
  ): Promise<string> => {
    return `https://status.acme.com/${id.toString()}`;
  }) as never);

  // Every page lists the monitor.
  jest
    .spyOn(StatusPageResourceService, "findByMonitors")
    .mockImplementation((async (data: {
      monitorIds: Array<ObjectID>;
    }): Promise<Array<StatusPageResource>> => {
      if (
        !data.monitorIds.some((id: ObjectID): boolean => {
          return sameId(id, MONITOR_ID);
        })
      ) {
        return [];
      }

      return PAGES.map((page: PageFixture, index: number) => {
        const resource: StatusPageResource = new StatusPageResource();
        resource._id = `90000000-0000-4000-8000-00000000000${index}`;
        resource.statusPageId = new ObjectID(page.id);
        resource.displayName = `Checkout on ${page.name}`;
        return resource;
      });
    }) as never);

  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation((async (
      ids: Array<ObjectID>,
    ): Promise<Array<StatusPage>> => {
      return PAGES.filter((page: PageFixture): boolean => {
        return ids.some((id: ObjectID): boolean => {
          return sameId(id, page.id);
        });
      }).map(makePage);
    }) as never);

  // Root reads check the project; the caller's reads are what they may read.
  jest.spyOn(StatusPageService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<StatusPage>> => {
    const wanted: Array<string> = idsIn(findBy.query["_id"]);

    return PAGES.filter((page: PageFixture): boolean => {
      return (
        wanted.includes(page.id) &&
        sameId(PROJECT_ID, findBy.query["projectId"]) &&
        (findBy.props.isRoot ||
          readablePageIds === null ||
          readablePageIds.includes(page.id))
      );
    }).map(makePage);
  }) as never);

  jest
    .spyOn(StatusPageSubscriberService, "countActiveSubscribersByChannel")
    .mockImplementation((async (data: {
      statusPageIds: Array<ObjectID>;
    }): Promise<Dictionary<IncidentSubscriberAudienceCounts>> => {
      const result: Dictionary<IncidentSubscriberAudienceCounts> = {};

      for (const id of data.statusPageIds) {
        const key: string = id.toString().toLowerCase();

        if (COUNTS[key]) {
          result[key] = COUNTS[key]!;
        }
      }

      return result;
    }) as never);

  // Neither may ever be reached: they read subscribers out, addresses and all.
  getSubscribersByStatusPage = jest.fn();
  jest
    .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
    .mockImplementation(getSubscribersByStatusPage as never);
  subscriberFindBy = jest.fn();
  jest
    .spyOn(StatusPageSubscriberService, "findBy")
    .mockImplementation(subscriberFindBy as never);

  jest.spyOn(MonitorService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Monitor>> => {
    return idsIn(findBy.query["_id"])
      .filter((id: string): boolean => {
        return (
          id === MONITOR_ID && sameId(PROJECT_ID, findBy.query["projectId"])
        );
      })
      .map((id: string): Monitor => {
        const monitor: Monitor = new Monitor();
        monitor._id = id;
        return monitor;
      });
  }) as never);

  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
    }): Promise<IncidentSeverity | null> => {
      if (
        !sameId(findOneBy.query["_id"], SEVERITY_ID) ||
        !sameId(findOneBy.query["projectId"], PROJECT_ID)
      ) {
        return null;
      }

      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ID;
      severity.name = "Major";
      return severity;
    }) as never);

  jest.spyOn(LabelService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Label>> => {
    return idsIn(findBy.query["_id"])
      .filter((id: string): boolean => {
        return id === LABEL_ID && sameId(findBy.query["projectId"], PROJECT_ID);
      })
      .map((id: string): Label => {
        const label: Label = new Label();
        label._id = id;
        label.name = "Europe";
        return label;
      });
  }) as never);

  applyMappingsToCreate = jest.fn(async (): Promise<void> => {
    return undefined;
  });
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockImplementation(applyMappingsToCreate as never);

  // The stored scope, as IncidentStatusPageScope reads it.
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Incident>> => {
    return idsIn(findBy.query["_id"]).map((id: string): Incident => {
      const incident: Incident = new Incident();
      incident._id = id;
      incident.isScopedToStatusPages = storedScope !== null;
      incident.statusPages = (storedScope || []).map(
        (pageId: string): StatusPage => {
          const page: StatusPage = new StatusPage();
          page._id = pageId;
          return page;
        },
      );
      return incident;
    });
  }) as never);

  /*
   * The incidents: one the caller may read, one private to others, and one
   * in another project. The caller's read applies their access; a root read
   * reads any row of the project it names.
   */
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident | null> => {
      const rows: Array<{ id: string; projectId: ObjectID }> = [
        { id: INCIDENT_ID, projectId: PROJECT_ID },
        { id: PRIVATE_INCIDENT_ID, projectId: PROJECT_ID },
        { id: OTHER_PROJECT_INCIDENT_ID, projectId: OTHER_PROJECT_ID },
      ];

      const row: { id: string; projectId: ObjectID } | undefined = rows.find(
        (candidate: { id: string; projectId: ObjectID }): boolean => {
          return (
            sameId(candidate.id, findOneBy.query["_id"]) &&
            sameId(candidate.projectId, findOneBy.query["projectId"])
          );
        },
      );

      if (!row) {
        return null;
      }

      if (!findOneBy.props.isRoot && !readableIncidentIds.includes(row.id)) {
        return null;
      }

      const incident: Incident = new Incident();
      incident._id = row.id;
      incident.projectId = row.projectId;
      incident.title = "Checkout requests failing";
      incident.description = "Payments fail.";
      incident.isVisibleOnStatusPage = true;
      incident.isPrivate = false;
      incident.customFields = {
        "Impact details": `Errors at checkout. ![graph](${IMAGE_URL})`,
      };

      const monitor: Monitor = new Monitor();
      monitor._id = MONITOR_ID;
      incident.monitors = [monitor];

      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "Critical";
      incident.incidentSeverity = severity;

      const state: IncidentState = new IncidentState();
      state.name = "Identified";
      incident.currentIncidentState = state;

      incident.labels = [];

      return incident;
    }) as never);

  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockImplementation((async (data: {
      statusPageId: ObjectID;
    }): Promise<StatusPageSubscriberNotificationTemplate | null> => {
      return templates[data.statusPageId.toString().toLowerCase()] || null;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may preview what", () => {
  test("a caller with none of the audience roles is refused", async () => {
    await expect(
      preview(draft(), { callerProps: props([Permission.StatusPageViewer]) }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("another project's incident is not found", async () => {
    await expect(
      preview(publicNote(OTHER_PROJECT_INCIDENT_ID)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test("a private incident the caller may not read is not found, and nothing about it is read as root", async () => {
    await expect(
      preview(publicNote(PRIVATE_INCIDENT_ID)),
    ).rejects.toBeInstanceOf(NotFoundException);

    const rootReads: Array<unknown> = (
      IncidentService.findOneBy as unknown as jest.Mock
    ).mock.calls.filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { props: DatabaseCommonInteractionProps }).props.isRoot ===
        true
      );
    });

    expect(rootReads).toEqual([]);
  });

  test("once the caller may read the incident, it is previewed", async () => {
    readableIncidentIds = [INCIDENT_ID, PRIVATE_INCIDENT_ID];

    const build: SubscriberNotificationPreviewBuild = await preview(
      publicNote(PRIVATE_INCIDENT_ID),
    );

    expect(pageIds(build)).toEqual([SITE_1, SITE_2, SITE_3]);
  });

  test("another project's monitors, severity or labels are refused", async () => {
    await expect(
      preview(draft({ monitorIds: [OTHER_PROJECT_MONITOR_ID] })),
    ).rejects.toBeInstanceOf(BadDataException);

    await expect(
      preview(draft({ incidentSeverityId: OTHER_PROJECT_SEVERITY_ID })),
    ).rejects.toThrow("incident severity was not found");

    await expect(
      preview(draft({ labelIds: [OTHER_PROJECT_LABEL_ID] })),
    ).rejects.toThrow("labels were not found");
  });

  test("a custom field value that does not fit its field is refused, as declaring would be", async () => {
    await expect(
      preview(draft({ customFields: { "Customer count": "many" } })),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("only the pages the caller can read are previewed; the rest are counted", async () => {
    readablePageIds = [SITE_1];

    // {{affectedStatusPages}} names only the pages the caller can read.
    templates[SITE_1] = Object.assign(
      new StatusPageSubscriberNotificationTemplate(),
      {
        templateName: "Branded",
        templateBody: "<p>{{affectedStatusPages}}</p>",
      },
    );

    const build: SubscriberNotificationPreviewBuild = await preview(draft());

    expect(pageIds(build)).toEqual([SITE_1]);
    expect(build.audience.hiddenStatusPageCount).toBe(2);
    expect(build.nothingSentReason).toBeNull();
    expect(body(build.statusPages[0]!)["body"]).toBe("<p>Site 01 Status</p>");
  });
});

describe("nothing will be sent", () => {
  test("a draft with no monitors previews as nothing will be sent, and builds no email", async () => {
    const build: SubscriberNotificationPreviewBuild = await preview(
      draft({ monitorIds: [] }),
    );

    expect(build.nothingSentReason).toBe(
      SubscriberNotificationPreviewNothingSentReason.NoMonitors,
    );
    expect(build.statusPages).toEqual([]);
    expect(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).not.toHaveBeenCalled();
  });

  test("a private draft, or one that does not notify, sends nothing", async () => {
    const privateBuild: SubscriberNotificationPreviewBuild = await preview(
      draft({ isPrivate: true }),
    );

    expect(privateBuild.nothingSentReason).toBe(
      SubscriberNotificationPreviewNothingSentReason.PrivateIncident,
    );
    expect(privateBuild.statusPages).toEqual([]);

    const quietBuild: SubscriberNotificationPreviewBuild = await preview(
      draft({
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      }),
    );

    expect(quietBuild.nothingSentReason).toBe(
      SubscriberNotificationPreviewNothingSentReason.NotifyOff,
    );
    expect(quietBuild.statusPages).toEqual([]);
  });

  test("an incident hidden from status pages sends nothing", async () => {
    (IncidentService.findOneBy as unknown as jest.Mock).mockImplementationOnce(
      (async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID;
        incident.isVisibleOnStatusPage = false;
        const monitor: Monitor = new Monitor();
        monitor._id = MONITOR_ID;
        incident.monitors = [monitor];
        return incident;
      }) as never,
    );

    const build: SubscriberNotificationPreviewBuild =
      await preview(publicNote());

    expect(build.nothingSentReason).toBe(
      SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages,
    );
    expect(build.statusPages).toEqual([]);
  });

  test("a status page that is not the project's is refused", async () => {
    await expect(
      preview(
        draft({ statusPageIds: ["b0000000-0000-4000-8000-000000000077"] }),
      ),
    ).rejects.toThrow("status pages were not found");
  });

  test("no page that lists the monitors will show it", async () => {
    (
      StatusPageResourceService.findByMonitors as unknown as jest.Mock
    ).mockImplementation((async (): Promise<Array<StatusPageResource>> => {
      return [];
    }) as never);

    const build: SubscriberNotificationPreviewBuild = await preview(draft());

    expect(build.nothingSentReason).toBe(
      SubscriberNotificationPreviewNothingSentReason.NoStatusPages,
    );
    expect(build.statusPages).toEqual([]);
  });
});

describe("the emails", () => {
  test("a draft: each readable page's 'incident created' email, its counts and why its template was chosen", async () => {
    templates[SITE_1] = Object.assign(
      new StatusPageSubscriberNotificationTemplate(),
      {
        templateName: "Site 01 branded",
        templateBody:
          "<h1>{{incidentTitle}}</h1>{{incidentDescription}}<p>{{incidentLabels}} / {{incidentSeverity}}</p><a href='{{unsubscribeUrl}}'>x</a>",
        emailSubject: "{{statusPageName}}: {{incidentTitle}}",
      },
    );
    templates[SITE_2] = Object.assign(
      new StatusPageSubscriberNotificationTemplate(),
      {
        templateName: "Site 02 branded",
        templateBody: "<p>{{incidentTitle}}</p>",
      },
    );

    const build: SubscriberNotificationPreviewBuild = await preview(
      draft({ statusPageIds: [SITE_1, SITE_2] }),
    );

    expect(build.event).toBe(
      SubscriberNotificationPreviewEvent.IncidentCreated,
    );
    expect(build.nothingSentReason).toBeNull();
    expect(build.audience.isScoped).toBe(true);
    expect(pageIds(build)).toEqual([SITE_1, SITE_2]);

    const [site1, site2] = build.statusPages as [
      SubscriberNotificationPreviewPage,
      SubscriberNotificationPreviewPage,
    ];

    // Site 01 has its own SMTP server: its custom template is used.
    expect(site1.name).toBe("Site 01");
    expect(site1.subscriberCounts).toEqual(COUNTS[SITE_1]);
    expect(site1.templateChoice).toEqual({
      usesCustomTemplate: true,
      reason: SubscriberEmailTemplateChoiceReason.CustomTemplate,
      customTemplateName: "Site 01 branded",
    });
    expect(site1.email.subject).toBe(
      "Site 01 Status: Checkout requests failing",
    );
    expect(site1.email.envelope.templateType).toBe(
      EmailTemplateType.BlankTemplate,
    );
    const site1Body: string = String(body(site1)["body"]);
    expect(site1Body).toContain("<h1>Checkout requests failing</h1>");
    expect(site1Body).toContain(
      "<p>Payments fail in <strong>Europe</strong>.</p>",
    );
    expect(site1Body).toContain("<p>Europe / Major</p>");
    expect(site1Body).toContain(
      `<a href='https://status.acme.com/${SITE_1}/unsubscribe/preview'>x</a>`,
    );

    // Site 02 does not: the default email, and why.
    expect(site2.templateChoice).toEqual({
      usesCustomTemplate: false,
      reason: SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp,
      customTemplateName: "Site 02 branded",
    });
    expect(site2.email.envelope.templateType).toBe(
      EmailTemplateType.SubscriberIncidentCreated,
    );
    expect(site2.email.subject).toBe("[Incident] Checkout requests failing");
    expect(body(site2)["statusPageName"]).toBe("Site 02 Status");
    expect(body(site2)["incidentSeverity"]).toBe("Major");
    expect(body(site2)["detailsUrl"]).toBe(`https://status.acme.com/${SITE_2}`);
    expect(body(site2)["unsubscribeUrl"]).toBe(
      SubscriberNotificationPreview.getPreviewUnsubscribeUrl(
        `https://status.acme.com/${SITE_2}`,
      ),
    );
    expect(body(site2)["resourcesAffected"]).toBe("Checkout on Site 02");
  });

  test("a draft's custom field values reach its email, after the mappings a declare would add", async () => {
    const build: SubscriberNotificationPreviewBuild = await preview(
      draft({
        customFields: {
          "Impact details": "Only **card** payments.",
          "Customer count": 1200,
        },
      }),
    );

    const rows: Array<JSONObject> = body(build.statusPages[0]!)[
      "customFieldRows"
    ] as unknown as Array<JSONObject>;

    expect(
      rows.map((row: JSONObject): unknown => {
        return row["title"];
      }),
    ).toEqual(["Impact details", "Customer count"]);
    expect(String(rows[0]!["renderedHtml"])).toContain("<strong>card</strong>");
    expect(rows[1]!["plainText"]).toBe("1200");

    expect(applyMappingsToCreate).toHaveBeenCalledTimes(1);
    const createBy: { data: Incident } = (
      applyMappingsToCreate.mock.calls[0]![0] as {
        createBy: { data: Incident };
      }
    ).createBy;
    expect(
      (createBy.data.monitors || []).map((monitor: Monitor): string => {
        return monitor._id!.toString();
      }),
    ).toEqual([MONITOR_ID]);
  });

  test("reach is the scope helper's: an incident limited to one page previews only that page", async () => {
    storedScope = [SITE_2];

    const build: SubscriberNotificationPreviewBuild =
      await preview(publicNote());

    expect(build.audience.isScoped).toBe(true);
    expect(pageIds(build)).toEqual([SITE_2]);
    expect(
      build.audience.excludedStatusPages.map(
        (page: { statusPageId: string }): string => {
          return page.statusPageId;
        },
      ),
    ).toEqual([SITE_1, SITE_3]);
  });

  test("a public note: each page's 'incident update' email, with the note being written", async () => {
    const build: SubscriberNotificationPreviewBuild =
      await preview(publicNote());

    expect(pageIds(build)).toEqual([SITE_1, SITE_2, SITE_3]);

    for (const page of build.statusPages) {
      expect(page.email.envelope.templateType).toBe(
        EmailTemplateType.SubscriberIncidentNoteCreated,
      );
      expect(page.email.subject).toBe(
        "[Update Incident] Checkout requests failing",
      );
      expect(String(body(page)["note"])).toContain(
        "<strong>rolling back</strong>",
      );
      expect(body(page)["detailsUrl"]).toBe(
        `https://status.acme.com/${page.statusPageId}/incidents/${INCIDENT_ID}`,
      );
    }
  });

  test("onlyStatusPageId builds that page's email alone", async () => {
    const build: SubscriberNotificationPreviewBuild = await preview(draft(), {
      onlyStatusPageId: SITE_3.toUpperCase(),
    });

    expect(pageIds(build)).toEqual([SITE_3]);
    // The audience still covers every page.
    expect(build.audience.statusPages).toHaveLength(3);
  });

  test("a page the caller cannot read cannot be picked", async () => {
    readablePageIds = [SITE_1];

    const build: SubscriberNotificationPreviewBuild = await preview(draft(), {
      onlyStatusPageId: SITE_2,
    });

    expect(build.statusPages).toEqual([]);
  });
});

describe("no side effects, and no addresses", () => {
  test("no subscriber is read and no custom field image is made public", async () => {
    await preview(publicNote());
    await preview(
      draft({ customFields: { "Impact details": `![x](${IMAGE_URL})` } }),
    );

    expect(getSubscribersByStatusPage).not.toHaveBeenCalled();
    expect(subscriberFindBy).not.toHaveBeenCalled();
    expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
  });

  test("nothing address-shaped is in the preview", async () => {
    const build: SubscriberNotificationPreviewBuild = await preview(draft());

    const serialized: string = JSON.stringify(
      build.statusPages.map((page: SubscriberNotificationPreviewPage) => {
        return {
          name: page.name,
          counts: page.subscriberCounts,
          email: page.email,
          templateChoice: page.templateChoice,
        };
      }),
    );

    expect(serialized).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe("parsing requests", () => {
  test("a draft: ids lower-cased, notify on unless switched off", () => {
    const request: SubscriberNotificationPreviewRequest =
      SubscriberNotificationPreviewBuilder.parseRequest({
        event: "IncidentCreated",
        incident: {
          title: "Down",
          monitorIds: [MONITOR_ID.toUpperCase()],
          statusPageIds: [SITE_1],
          labelIds: [],
          incidentSeverityId: "",
        },
      });

    expect(request).toEqual({
      event: SubscriberNotificationPreviewEvent.IncidentCreated,
      incident: {
        title: "Down",
        description: "",
        incidentSeverityId: null,
        monitorIds: [MONITOR_ID],
        statusPageIds: [SITE_1],
        labelIds: [],
        customFields: {},
        isPrivate: false,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
    });
  });

  test("a public note, with when it says it was posted", () => {
    const request: SubscriberNotificationPreviewRequest =
      SubscriberNotificationPreviewBuilder.parseRequest({
        event: "IncidentPublicNoteCreated",
        incidentId: INCIDENT_ID,
        note: "Update",
        postedAt: "2026-09-27T10:30:00.000Z",
      });

    expect(request.event).toBe(
      SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
    );
    expect((request as { postedAt: Date | null }).postedAt?.toISOString()).toBe(
      "2026-09-27T10:30:00.000Z",
    );
  });

  test.each([
    [{}, "event must be one of"],
    [{ event: "Nope" }, "event must be one of"],
    [{ event: "IncidentCreated" }, "incident must be an object"],
    [
      { event: "IncidentCreated", incident: { monitorIds: "x" } },
      "must be a list of IDs",
    ],
    [
      { event: "IncidentCreated", incident: { monitorIds: ["not-an-id"] } },
      "must be a valid ID",
    ],
    [
      { event: "IncidentCreated", incident: { title: 42 } },
      "incident.title must be text",
    ],
    [
      { event: "IncidentCreated", incident: { customFields: [] } },
      "incident.customFields must be an object",
    ],
    [
      { event: "IncidentPublicNoteCreated", incidentId: "x" },
      "incidentId must be a valid ID",
    ],
    [
      {
        event: "IncidentPublicNoteCreated",
        incidentId: INCIDENT_ID,
        postedAt: "not a date",
      },
      "postedAt must be a date",
    ],
  ])("refuses %j", (body: JSONObject, message: string) => {
    expect(() => {
      return SubscriberNotificationPreviewBuilder.parseRequest(body);
    }).toThrow(message);
  });

  test("too long a note is refused", () => {
    expect(() => {
      return SubscriberNotificationPreviewBuilder.parseRequest({
        event: "IncidentPublicNoteCreated",
        incidentId: INCIDENT_ID,
        note: "x".repeat(SubscriberNotificationPreview.maxTextLength + 1),
      });
    }).toThrow("at most");
  });

  test("a test send names a status page, and no address is read from the body", () => {
    const request: SubscriberNotificationSendTestRequest =
      SubscriberNotificationPreviewBuilder.parseSendTestRequest({
        event: "IncidentPublicNoteCreated",
        incidentId: INCIDENT_ID,
        note: "Update",
        statusPageId: SITE_1,
        toEmail: "someone-else@example.com",
      });

    expect(request.statusPageId).toBe(SITE_1);
    expect(JSON.stringify(request)).not.toContain("someone-else");

    expect(() => {
      return SubscriberNotificationPreviewBuilder.parseSendTestRequest({
        event: "IncidentPublicNoteCreated",
        incidentId: INCIDENT_ID,
      });
    }).toThrow("statusPageId must be a valid ID");
  });
});
