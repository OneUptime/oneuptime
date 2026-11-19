import User from "Common/Models/DatabaseModels/User";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import { ServerProductOffReason } from "Common/Types/Product/ServerProducts";
import {
  InMemoryOwnerNotificationDeliveries,
  useInMemoryOwnerNotificationDeliveries,
} from "Common/Tests/Helpers/InMemoryOwnerNotificationDeliveries";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE NEW OWNERS OF A TABLE, A PIPELINE OR A DATA STORE ARE TOLD (#9681).
 *
 * Data Observability's owner rules - for tables, data stores and, since
 * #9527, pipelines - write each owner they add not notified yet when their
 * Notify Owners is on, and an owner added on an Owners page starts so too.
 * No job read those rows: Notify Owners promised a message that never came.
 * Three owner-added jobs now tell them (DataAssetOwners, DataPipelineOwners,
 * DataStoreOwners), on the backlog and delivery table every owner-added job
 * runs on; OwnerNotificationJobsSurviveAStop puts them through every crash
 * point, and OwnerAddedProjectMembership through the project's membership.
 * Here, each real job runs with its services standing in for the database:
 *
 *   - a row is told once, through the person's own setting for the event,
 *     seeded first, and the next run tells nobody again;
 *   - what each channel says: the email's own template and literal subject,
 *     the text, the call and the push - and no WhatsApp message, which
 *     only an approved template could carry;
 *   - a record that is gone tells nobody;
 *   - while its product is switched off on the server the job reads and
 *     sends nothing, and the rows wait - a data store's job asks by its own
 *     owner table, which Data Observability and Data Security both serve;
 *   - a data store's link goes to Data Security's page, or to Data
 *     Observability's while Data Security is off;
 *   - the Workers start the three jobs.
 */

type CronHandler = () => Promise<void>;

// Declared before the hoisted jest.mock below, which may only close over "mock" names.
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

// A pre-existing TS5.9 diagnostic in PasswordHash fails any suite that loads it.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: { hash: jest.fn(), verify: jest.fn() },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return { __esModule: true, default: { getDashboardUrl: jest.fn() } };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      sendUserNotification: jest.fn(),
      ensureSettingExistsForUser: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      getUsersInTeams: jest.fn(),
      filterUsersToProjectMembers: jest.fn(),
    },
  };
});

// What is switched off on the server, as each test says.
jest.mock("Common/Server/Utils/ServerProducts/ServerProducts", () => {
  return {
    __esModule: true,
    default: {
      getOffProductOfServerWorkTable: jest.fn(),
      getOffReasonOfServerWork: jest.fn(),
    },
  };
});

import DatabaseConfig from "Common/Server/DatabaseConfig";
import DataAssetOwnerTeamService from "Common/Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "Common/Server/Services/DataAssetOwnerUserService";
import DataAssetService from "Common/Server/Services/DataAssetService";
import DataPipelineOwnerTeamService from "Common/Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "Common/Server/Services/DataPipelineOwnerUserService";
import DataPipelineService from "Common/Server/Services/DataPipelineService";
import DataStoreOwnerTeamService from "Common/Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "Common/Server/Services/DataStoreOwnerUserService";
import DataStoreService from "Common/Server/Services/DataStoreService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import ServerProducts from "Common/Server/Utils/ServerProducts/ServerProducts";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/DataAssetOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DataPipelineOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DataStoreOwners/SendOwnerAddedNotification";

type AnyMock = jest.Mock;

function asMock(fn: unknown): AnyMock {
  return fn as AnyMock;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000d1",
);
const OWNER_ROW_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000e1",
);
const DASHBOARD: string = "https://oneuptime.test/dashboard";

// A name typed by a person, quoting template syntax: it reaches every channel as written.
const TYPED_NAME: string = "orders_{{ .Values.image.tag }}";

function makeOwner(): User {
  const user: User = new User(
    new ObjectID("11111111-0000-4000-8000-000000000001"),
  );
  user.name = new Name("Ada Owner");
  user.email = new Email("ada@acme.test");
  return user;
}

const OWNER: User = makeOwner();

interface JobCase {
  title: string;
  jobName: string;
  kind: OwnerNotificationKind;
  eventType: NotificationSettingEventType;
  ownerTable: string;
  recordIdColumn: string;
  teamService: unknown;
  userService: unknown;
  recordService: unknown;
  record: () => JSONObject;
  // The record as every channel names it.
  noun: string;
  name: string;
  link: string;
  templateType: EmailTemplateType;
  // The email's variables, beside the description's HTML and the link.
  vars: JSONObject;
  linkVar: string;
  descriptionVar: string;
  pushTitle: string;
  pushTag: string;
}

const CASES: Array<JobCase> = [
  {
    title: "a table",
    jobName: "DataAssetOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DataAssetOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_DATA_ASSET_OWNER_ADDED_NOTIFICATION,
    ownerTable: "DataAssetOwnerUser",
    recordIdColumn: "dataAssetId",
    teamService: DataAssetOwnerTeamService,
    userService: DataAssetOwnerUserService,
    recordService: DataAssetService,
    record: (): JSONObject => {
      return {
        _id: RECORD_ID.toString(),
        id: RECORD_ID,
        projectId: PROJECT_ID,
        project: { name: "Acme" },
        name: TYPED_NAME,
        schemaName: "analytics",
        dataStoreName: "warehouse",
        description: "One row per **order**",
      } as unknown as JSONObject;
    },
    noun: "table",
    name: `analytics.${TYPED_NAME}`,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/data-observability/tables/${RECORD_ID.toString()}`,
    templateType: EmailTemplateType.DataAssetOwnerAdded,
    vars: {
      tableName: `analytics.${TYPED_NAME}`,
      databaseName: "warehouse",
      projectName: "Acme",
    },
    linkVar: "tableViewLink",
    descriptionVar: "tableDescription",
    pushTitle: "Added as Table Owner",
    pushTag: "data-asset-owner-added",
  },
  {
    title: "a pipeline",
    jobName: "DataPipelineOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DataPipelineOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_DATA_PIPELINE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "DataPipelineOwnerUser",
    recordIdColumn: "dataPipelineId",
    teamService: DataPipelineOwnerTeamService,
    userService: DataPipelineOwnerUserService,
    recordService: DataPipelineService,
    record: (): JSONObject => {
      return {
        _id: RECORD_ID.toString(),
        id: RECORD_ID,
        projectId: PROJECT_ID,
        project: { name: "Acme" },
        jobName: TYPED_NAME,
        jobNamespace: "airflow",
        description: "Loads the **orders**",
      } as unknown as JSONObject;
    },
    noun: "pipeline",
    name: TYPED_NAME,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/data-observability/pipelines/${RECORD_ID.toString()}`,
    templateType: EmailTemplateType.DataPipelineOwnerAdded,
    vars: {
      pipelineName: TYPED_NAME,
      pipelineNamespace: "airflow",
      projectName: "Acme",
    },
    linkVar: "pipelineViewLink",
    descriptionVar: "pipelineDescription",
    pushTitle: "Added as Pipeline Owner",
    pushTag: "data-pipeline-owner-added",
  },
  {
    title: "a data store",
    jobName: "DataStoreOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DataStoreOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_DATA_STORE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "DataStoreOwnerUser",
    recordIdColumn: "dataStoreId",
    teamService: DataStoreOwnerTeamService,
    userService: DataStoreOwnerUserService,
    recordService: DataStoreService,
    record: (): JSONObject => {
      return {
        _id: RECORD_ID.toString(),
        id: RECORD_ID,
        projectId: PROJECT_ID,
        project: { name: "Acme" },
        name: TYPED_NAME,
        description: "The **orders** database",
      } as unknown as JSONObject;
    },
    noun: "data store",
    name: TYPED_NAME,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/data-security/stores/${RECORD_ID.toString()}`,
    templateType: EmailTemplateType.DataStoreOwnerAdded,
    vars: {
      dataStoreName: TYPED_NAME,
      projectName: "Acme",
    },
    linkVar: "dataStoreViewLink",
    descriptionVar: "dataStoreDescription",
    pushTitle: "Added as Data Store Owner",
    pushTag: "data-store-owner-added",
  },
];

const OFF: ServerProductOffReason = ServerProductOffReason.SwitchedOff;

interface World {
  exists: boolean;
  isTaken: boolean;
  takes: number;
}

let world: World;
let table: InMemoryOwnerNotificationDeliveries;

function serviceOf(service: unknown): Record<string, AnyMock> {
  return service as Record<string, AnyMock>;
}

/*
 * One user row of the record, not notified yet: due until a run takes it.
 * The services are the real ones, their reads and the take standing in for
 * the database, so the links are written by the services' own helpers.
 */
function arrange(jobCase: JobCase): void {
  const ownerRow: JSONObject = {
    _id: OWNER_ROW_ID.toString(),
    id: OWNER_ROW_ID,
    [jobCase.recordIdColumn]: RECORD_ID,
    userId: OWNER.id,
    user: OWNER,
  } as unknown as JSONObject;

  jest
    .spyOn(jobCase.teamService as never, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(jobCase.teamService as never, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true as never);
  jest
    .spyOn(jobCase.userService as never, "findBy")
    .mockImplementation((async () => {
      return world.exists && !world.isTaken ? [ownerRow] : [];
    }) as never);
  jest
    .spyOn(jobCase.userService as never, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async () => {
      if (world.isTaken) {
        return false;
      }

      world.isTaken = true;
      world.takes++;
      return true;
    }) as never);

  jest
    .spyOn(jobCase.recordService as never, "findOneById")
    .mockImplementation((async () => {
      return world.exists ? jobCase.record() : null;
    }) as never);
  jest
    .spyOn(jobCase.recordService as never, "findBy")
    .mockImplementation((async () => {
      return world.exists ? [jobCase.record()] : [];
    }) as never);
}

async function runJob(jobCase: JobCase): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[jobCase.jobName];

  if (!handler) {
    throw new Error(`${jobCase.jobName} registered no cron handler.`);
  }

  await handler();
}

type SendData = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

function sends(): Array<SendData> {
  return asMock(
    UserNotificationSettingService.sendUserNotification,
  ).mock.calls.map((call: Array<unknown>): SendData => {
    return call[0] as SendData;
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  table = useInMemoryOwnerNotificationDeliveries();
  world = { exists: true, isTaken: false, takes: 0 };

  asMock(DatabaseConfig.getDashboardUrl).mockResolvedValue(
    URL.fromString(DASHBOARD),
  );
  asMock(ServerProducts.getOffProductOfServerWorkTable).mockResolvedValue(null);
  asMock(ServerProducts.getOffReasonOfServerWork).mockResolvedValue(null);
  asMock(TeamMemberService.getUsersInTeams).mockResolvedValue([]);
  asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
    async (data: { users: Array<User> }): Promise<Array<User>> => {
      return data.users;
    },
  );
  asMock(UserNotificationSettingService.sendUserNotification).mockResolvedValue(
    undefined,
  );
  asMock(
    UserNotificationSettingService.ensureSettingExistsForUser,
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)("the new owner of $title", (jobCase: JobCase) => {
  test("is told once, through their own setting for the event, seeded first", async () => {
    arrange(jobCase);

    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
    expect(sends()[0]!.userId.toString()).toBe(OWNER.id!.toString());
    expect(sends()[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(sends()[0]!.eventType).toBe(jobCase.eventType);

    // The setting is made sure of before the send, for this event.
    const ensure: AnyMock = asMock(
      UserNotificationSettingService.ensureSettingExistsForUser,
    );
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0]![0]).toEqual({
      userId: OWNER.id,
      projectId: PROJECT_ID,
      eventType: jobCase.eventType,
    });
    expect(ensure.mock.invocationCallOrder[0]!).toBeLessThan(
      asMock(UserNotificationSettingService.sendUserNotification).mock
        .invocationCallOrder[0]!,
    );

    // The row is taken, and the delivery says the owner was told.
    expect(world.takes).toBe(1);
    expect(table.statusesOf(OWNER_ROW_ID)).toEqual({
      [OWNER.id!.toString().toLowerCase()]:
        OwnerNotificationDeliveryStatus.Sent,
    });
    expect(table.rows[0]!.kind).toBe(jobCase.kind);
    expect(table.rows[0]!.resourceId).toBe(RECORD_ID.toString().toLowerCase());

    // The next run, a minute on, tells nobody again.
    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
    expect(world.takes).toBe(1);
  });

  test("says who was added to what, the same on every channel, the name as its author wrote it", async () => {
    arrange(jobCase);

    await runJob(jobCase);

    const sent: SendData = sends()[0]!;
    const sentence: string = `You have been added as an owner of the ${jobCase.noun} ${jobCase.name}`;

    // The email: its own template, its subject never read as a template.
    const email: EmailEnvelope = sent.emailEnvelope;
    expect(email.templateType).toBe(jobCase.templateType);
    expect(email.isSubjectLiteral).toBe(true);
    expect(email.subject).toBe(sentence);
    expect(email.vars).toEqual(
      expect.objectContaining({
        ...jobCase.vars,
        [jobCase.linkVar]: jobCase.link,
      }),
    );
    // The description, a person's Markdown, goes in as the email's HTML.
    expect(email.vars[jobCase.descriptionVar]).toContain("<strong>");

    expect(sent.smsMessage.message).toBe(
      `OneUptime: ${sentence}. Turn off in User Settings > Notification Settings.`,
    );
    expect(sent.callRequestMessage.data[0]).toEqual({
      sayMessage: `This is a message from OneUptime. ${sentence}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
    });
    expect(sent.pushNotificationMessage).toEqual(
      expect.objectContaining({
        title: jobCase.pushTitle,
        body: `You have been added as an owner of the ${jobCase.noun}: ${jobCase.name}. Click to view details.`,
        clickAction: jobCase.link,
        tag: jobCase.pushTag,
      }),
    );
    /*
     * No WhatsApp template is approved for these events, and WhatsApp sends
     * only approved ones: none is handed over, so the channel is skipped.
     */
    expect(sent.whatsAppMessage).toBeUndefined();
  });

  test("tells nobody of a record that is gone, and takes its rows", async () => {
    arrange(jobCase);
    serviceOf(jobCase.recordService)["findOneById"]!.mockResolvedValue(null);
    serviceOf(jobCase.recordService)["findBy"]!.mockResolvedValue([]);

    await runJob(jobCase);

    expect(sends()).toHaveLength(0);
    expect(world.takes).toBe(1);
  });

  test("reads and sends nothing while every product of its owner rows is switched off, and the rows wait", async () => {
    arrange(jobCase);
    asMock(ServerProducts.getOffProductOfServerWorkTable).mockResolvedValue({
      product: ProductKey.DataObservability,
      reason: OFF,
    });

    await runJob(jobCase);

    expect(ServerProducts.getOffProductOfServerWorkTable).toHaveBeenCalledWith(
      jobCase.ownerTable,
    );
    expect(serviceOf(jobCase.userService)["findBy"]).not.toHaveBeenCalled();
    expect(serviceOf(jobCase.teamService)["findBy"]).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(0);
    expect(world.takes).toBe(0);

    // Switched on again: the owner is told.
    asMock(ServerProducts.getOffProductOfServerWorkTable).mockResolvedValue(
      null,
    );

    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
  });

  test("tells a person a failing send leaves untold once, and never again", async () => {
    arrange(jobCase);
    asMock(
      UserNotificationSettingService.sendUserNotification,
    ).mockRejectedValue(new Error("The mail server is down"));

    await runJob(jobCase);
    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
    expect(table.statusesOf(OWNER_ROW_ID)).toEqual({
      [OWNER.id!.toString().toLowerCase()]:
        OwnerNotificationDeliveryStatus.Failed,
    });
  });
});

describe("a data store's link", () => {
  const storeCase: JobCase = CASES[2]!;

  test("goes to its page in Data Security, where its owners are", async () => {
    arrange(storeCase);

    await runJob(storeCase);

    expect(ServerProducts.getOffReasonOfServerWork).toHaveBeenCalledWith(
      ProductKey.DataSecurity,
    );
    expect(sends()[0]!.emailEnvelope.vars["dataStoreViewLink"]).toBe(
      `${DASHBOARD}/${PROJECT_ID.toString()}/data-security/stores/${RECORD_ID.toString()}`,
    );
  });

  test("goes to the database's page in Data Observability while Data Security is switched off", async () => {
    arrange(storeCase);
    asMock(ServerProducts.getOffReasonOfServerWork).mockImplementation(
      async (product: ProductKey) => {
        return product === ProductKey.DataSecurity ? OFF : null;
      },
    );

    await runJob(storeCase);

    const link: string = `${DASHBOARD}/${PROJECT_ID.toString()}/data-observability/stores/${RECORD_ID.toString()}`;

    expect(sends()[0]!.emailEnvelope.vars["dataStoreViewLink"]).toBe(link);
    expect(sends()[0]!.pushNotificationMessage.clickAction).toBe(link);
  });
});

describe("the Workers", () => {
  test("start the three jobs", () => {
    const workers: string = fs.readFileSync(
      path.resolve(__dirname, "../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    for (const job of [
      "DataAssetOwners",
      "DataPipelineOwners",
      "DataStoreOwners",
    ]) {
      expect(workers).toContain(
        `import "./Jobs/${job}/SendOwnerAddedNotification";`,
      );
    }

    expect(Object.keys(mockCapturedJobs).sort()).toEqual(
      CASES.map((jobCase: JobCase): string => {
        return jobCase.jobName;
      }).sort(),
    );
  });
});
