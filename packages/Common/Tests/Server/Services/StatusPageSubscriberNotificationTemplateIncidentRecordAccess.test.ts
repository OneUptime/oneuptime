import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SubscriberTemplateIncidentRecordAccess from "../../../Server/Utils/StatusPage/SubscriberTemplateIncidentRecordAccess";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A custom subscriber notification template can place {{incidentLabels}}
 * and any {{customFields.<key>}}: values from the team's incident records
 * that the status page does not show. The status page roles may write
 * templates, and add a Slack, Teams or webhook subscriber pointing at an
 * address they own, but may not read incidents. So a template that places
 * incident records is refused unless whoever writes it may read them, for
 * every incident of the project. Placeholders a template already holds stay
 * allowed on an update.
 */

type Model = StatusPageSubscriberNotificationTemplate;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const LABEL_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const LEAKING_SLACK_TEMPLATE: string =
  "{{incidentTitle}} {{customFields.root_cause}} {{customFields.customer_account}}";

type OnBeforeCreateFunction = (
  createBy: CreateBy<Model>,
) => Promise<OnCreate<Model>>;

type OnBeforeUpdateFunction = (
  updateBy: UpdateBy<Model>,
) => Promise<OnUpdate<Model>>;

function row(
  permission: Permission,
  extra: Partial<UserPermission> = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    ...extra,
  };
}

function propsWith(
  rows: Array<UserPermission>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    ...extra,
  };
}

const STATUS_PAGE_MEMBER: Array<UserPermission> = [
  row(Permission.StatusPageMember),
];

function template(data: Partial<Model> = {}): Model {
  const model: Model = new StatusPageSubscriberNotificationTemplate();
  model.projectId = PROJECT_ID;
  model.templateName = "Site 03 Slack";
  model.eventType =
    StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;
  model.notificationMethod = StatusPageSubscriberNotificationMethod.Slack;
  model.templateBody = "{{incidentTitle}}";
  Object.assign(model, data);
  return model;
}

function create(
  data: Partial<Model>,
  props: DatabaseCommonInteractionProps,
): Promise<OnCreate<Model>> {
  return (
    StatusPageSubscriberNotificationTemplateService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate({ data: template(data), props: props });
}

function update(
  data: Partial<Model>,
  props: DatabaseCommonInteractionProps,
): Promise<OnUpdate<Model>> {
  return (
    StatusPageSubscriberNotificationTemplateService as unknown as {
      onBeforeUpdate: OnBeforeUpdateFunction;
    }
  ).onBeforeUpdate({
    query: { _id: TEMPLATE_ID.toString() },
    data: data,
    props: props,
  } as UpdateBy<Model>);
}

let stored: Array<Model> = [];

beforeEach(() => {
  stored = [];
  jest
    .spyOn(StatusPageSubscriberNotificationTemplateService, "findBy")
    .mockImplementation((async () => {
      return stored;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a template that places incident records", () => {
  test("the table's own access control lets a Status Page Member write one", () => {
    // Why the check is needed: nothing else stands in the way.
    expect(() => {
      ModelPermission.checkCreatePermissions(
        StatusPageSubscriberNotificationTemplate,
        template({ templateBody: LEAKING_SLACK_TEMPLATE }),
        propsWith(STATUS_PAGE_MEMBER),
      );
    }).not.toThrow();
  });

  test.each([
    ["Status Page Member", [row(Permission.StatusPageMember)]],
    ["Status Page Admin", [row(Permission.StatusPageAdmin)]],
    [
      "Create Status Page Subscriber Notification Template",
      [row(Permission.CreateStatusPageSubscriberNotificationTemplate)],
    ],
  ] as Array<[string, Array<UserPermission>]>)(
    "is refused for a %s, who cannot read incidents",
    async (_role: string, rows: Array<UserPermission>) => {
      await expect(
        create({ templateBody: LEAKING_SLACK_TEMPLATE }, propsWith(rows)),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  test("the refusal names the placeholders and the permissions that would allow them", async () => {
    await expect(
      create(
        { templateBody: LEAKING_SLACK_TEMPLATE },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).rejects.toThrow(
      /Placing \{\{customFields\.customer_account\}\}, \{\{customFields\.root_cause\}\} in a subscriber notification template needs permission to read incidents .*Project Member.*Incident Viewer/,
    );
  });

  test.each([
    ["the labels", "Labels: {{incidentLabels}}"],
    ["a guessed key", "{{customFields.password}}"],
    ["spaces inside the braces", "{{ customFields.root_cause }}"],
  ])("is refused for %s too", async (_what: string, templateBody: string) => {
    await expect(
      create({ templateBody: templateBody }, propsWith(STATUS_PAGE_MEMBER)),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("is refused in an email subject too", async () => {
    await expect(
      create(
        {
          notificationMethod: StatusPageSubscriberNotificationMethod.Email,
          templateBody: "<p>{{incidentTitle}}</p>",
          emailSubject: "[{{customFields.root_cause}}] {{incidentTitle}}",
        },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  /*
   * An update may change the event type without touching the text, so a
   * template for any event is checked.
   */
  test("is refused for a template of an event that does not fill them", async () => {
    await expect(
      create(
        {
          eventType:
            StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
          templateBody: "{{customFields.root_cause}}",
        },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("a Status Page Member can still write one that places only what the status page shows", async () => {
    await expect(
      create(
        {
          templateBody:
            "{{incidentTitle}} {{incidentDescription}} {{incidentSeverity}} {{resourcesAffected}} {{affectedStatusPages}} {{statusPageName}} {{unsubscribeUrl}}",
        },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).resolves.toBeDefined();
  });

  test.each([
    ["Project Owner", [row(Permission.ProjectOwner)]],
    ["Project Admin", [row(Permission.ProjectAdmin)]],
    ["Project Member", [row(Permission.ProjectMember)]],
    [
      "Status Page Member who is also an Incident Viewer",
      [row(Permission.StatusPageMember), row(Permission.IncidentViewer)],
    ],
    [
      "Status Page Member who may read incidents and their custom fields",
      [
        row(Permission.StatusPageMember),
        row(Permission.ReadProjectIncident),
        row(Permission.ReadIncidentCustomField),
      ],
    ],
    [
      "Incident Viewer scoped to All, labels and all",
      [
        row(Permission.StatusPageMember),
        row(Permission.IncidentViewer, {
          scope: PermissionScope.All,
          labelIds: [LABEL_ID],
        }),
      ],
    ],
    [
      "Project Owner whose row carries a stray Owned scope",
      [row(Permission.ProjectOwner, { scope: PermissionScope.Owned })],
    ],
  ] as Array<[string, Array<UserPermission>]>)(
    "is allowed for a %s",
    async (_role: string, rows: Array<UserPermission>) => {
      await expect(
        create(
          {
            templateBody: `${LEAKING_SLACK_TEMPLATE} {{incidentLabels}}`,
          },
          propsWith(rows),
        ),
      ).resolves.toBeDefined();
    },
  );

  test.each([
    [
      "who may read incidents but not the custom field definitions",
      [row(Permission.StatusPageMember), row(Permission.ReadProjectIncident)],
    ],
    [
      "who may read every operational resource, which reaches no column",
      [
        row(Permission.StatusPageMember),
        row(Permission.ReadAllOperationalResources),
        row(Permission.ReadIncidentCustomField),
      ],
    ],
    [
      "whose incident access is limited to some labels",
      [
        row(Permission.StatusPageMember),
        row(Permission.IncidentViewer, { labelIds: [LABEL_ID] }),
      ],
    ],
    [
      "whose incident access is limited to some labels, scoped as such",
      [
        row(Permission.StatusPageMember),
        row(Permission.IncidentViewer, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_ID],
        }),
      ],
    ],
    [
      "whose incident access is limited to incidents they own",
      [
        row(Permission.StatusPageMember),
        row(Permission.IncidentViewer, { scope: PermissionScope.Owned }),
      ],
    ],
    [
      "who is a Project Member blocked from some incidents",
      [
        row(Permission.ProjectMember),
        row(Permission.IncidentViewer, {
          isBlockPermission: true,
          labelIds: [LABEL_ID],
        }),
      ],
    ],
  ] as Array<[string, Array<UserPermission>]>)(
    "is refused for someone %s",
    async (_who: string, rows: Array<UserPermission>) => {
      await expect(
        create({ templateBody: LEAKING_SLACK_TEMPLATE }, propsWith(rows)),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  test("the labels need the labels column, not the custom fields", async () => {
    const readsIncidentsOnly: Array<UserPermission> = [
      row(Permission.StatusPageMember),
      row(Permission.ReadProjectIncident),
    ];

    await expect(
      create(
        { templateBody: "{{incidentLabels}}" },
        propsWith(readsIncidentsOnly),
      ),
    ).resolves.toBeDefined();
    await expect(
      create(
        { templateBody: "{{customFields.root_cause}}" },
        propsWith(readsIncidentsOnly),
      ),
    ).rejects.toThrow(/read incident custom fields/);
  });

  test("root and master admin writes are not checked", async () => {
    await expect(
      create({ templateBody: LEAKING_SLACK_TEMPLATE }, { isRoot: true }),
    ).resolves.toBeDefined();
    await expect(
      create(
        { templateBody: LEAKING_SLACK_TEMPLATE },
        propsWith([], { isMasterAdmin: true }),
      ),
    ).resolves.toBeDefined();
  });

  test("an API key with only status page permissions is refused like a user", async () => {
    await expect(
      create(
        { templateBody: LEAKING_SLACK_TEMPLATE },
        propsWith(STATUS_PAGE_MEMBER, {
          userType: UserType.API,
          userId: undefined,
        }),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });
});

describe("updating a template", () => {
  test("a Status Page Member cannot add a custom field to it", async () => {
    stored = [template({ templateBody: "{{incidentTitle}}" })];

    await expect(
      update(
        { templateBody: "{{incidentTitle}} {{customFields.root_cause}}" },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).rejects.toThrow(
      /Placing \{\{customFields\.root_cause\}\} in a subscriber notification template/,
    );
  });

  test("the templates it would change are read as root, in the caller's project", async () => {
    stored = [template({ templateBody: "{{incidentTitle}}" })];

    await expect(
      update(
        { templateBody: "{{customFields.root_cause}}" },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    const findBy: jest.Mock =
      StatusPageSubscriberNotificationTemplateService.findBy as unknown as jest.Mock;
    const args: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(args.query).toEqual({
      _id: TEMPLATE_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(args.props.isRoot).toBe(true);
  });

  test("but can edit a template that already places one: fix the text, move it, keep it", async () => {
    stored = [
      template({
        templateBody: "Root cause: {{customFields.root_cause}}",
        emailSubject: "{{incidentLabels}}",
      }),
    ];

    await expect(
      update(
        {
          templateBody:
            "Root cause (fixed typo): {{customFields.root_cause}} {{incidentLabels}}",
          emailSubject: "{{incidentTitle}}",
        },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).resolves.toBeDefined();
  });

  test("or rename it, or change anything else, without the text being read", async () => {
    stored = [template({ templateBody: "{{customFields.root_cause}}" })];

    await expect(
      update({ templateName: "Renamed" }, propsWith(STATUS_PAGE_MEMBER)),
    ).resolves.toBeDefined();
    await expect(
      update(
        { templateBody: "{{incidentTitle}}" },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).resolves.toBeDefined();
    expect(
      StatusPageSubscriberNotificationTemplateService.findBy,
    ).not.toHaveBeenCalled();
  });

  test("an update of several templates is refused if it adds one to any of them", async () => {
    stored = [
      template({ templateBody: "{{customFields.root_cause}}" }),
      template({ templateBody: "{{incidentTitle}}" }),
    ];

    await expect(
      update(
        { templateBody: "{{customFields.root_cause}}" },
        propsWith(STATUS_PAGE_MEMBER),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("someone who may read incidents can add one", async () => {
    stored = [template({ templateBody: "{{incidentTitle}}" })];

    await expect(
      update(
        { templateBody: LEAKING_SLACK_TEMPLATE },
        propsWith([row(Permission.ProjectMember)]),
      ),
    ).resolves.toBeDefined();
  });

  test("root updates are not checked, nor read", async () => {
    await expect(
      update({ templateBody: LEAKING_SLACK_TEMPLATE }, { isRoot: true }),
    ).resolves.toBeDefined();
    expect(
      StatusPageSubscriberNotificationTemplateService.findBy,
    ).not.toHaveBeenCalled();
  });
});

describe("SubscriberTemplateIncidentRecordAccess.getRequirements", () => {
  function permissionsFor(placeholders: Array<string>): Array<Array<string>> {
    return SubscriberTemplateIncidentRecordAccess.getRequirements(
      placeholders,
    ).map((requirement: { permissions: Array<Permission> }) => {
      return requirement.permissions;
    });
  }

  test("reads the permissions from the models, so they follow the models", () => {
    const [incidents, values, definitions] = permissionsFor([
      "customFields.root_cause",
    ]);

    expect(incidents).toEqual(
      expect.arrayContaining([
        Permission.IncidentViewer,
        Permission.ReadProjectIncident,
        Permission.ReadAllOperationalResources,
      ]),
    );
    expect(values).toEqual(
      expect.arrayContaining([
        Permission.IncidentViewer,
        Permission.ReadProjectIncident,
      ]),
    );
    expect(definitions).toEqual(
      expect.arrayContaining([Permission.ReadIncidentCustomField]),
    );

    // No status page role reads any of them.
    for (const permissions of [incidents, values, definitions]) {
      expect(permissions).not.toContain(Permission.StatusPageAdmin);
      expect(permissions).not.toContain(Permission.StatusPageMember);
      expect(permissions).not.toContain(Permission.StatusPageViewer);
    }
  });

  test("labels need incidents and the labels column only", () => {
    expect(permissionsFor(["incidentLabels"])).toHaveLength(2);
    expect(permissionsFor(["customFields.a", "incidentLabels"])).toHaveLength(
      4,
    );
  });
});
