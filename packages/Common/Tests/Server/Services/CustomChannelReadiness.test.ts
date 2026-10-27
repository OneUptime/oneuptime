import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import OnCallReadinessService, {
  ReadinessMethod,
  ReadinessMethodType,
  ReadinessStatus,
  ResponderSource,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import ProjectService from "../../../Server/Services/ProjectService";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import { CUSTOM_CHANNEL_METHOD_LABEL } from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * Readiness answers "can this person be paged", and a custom channel is a
 * way they can be: one that pages everyone reaches every responder - through
 * the rules it was added to, and through the fallback - and one that does
 * not reaches the people whose rules name it. Nobody verifies a channel, so
 * being on is the whole test; and the readiness surface names the fallback
 * exactly as the fallback itself picks.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

interface ReadinessCustomChannel {
  id: ObjectID;
  name: string;
  pagesEveryone: boolean;
}

interface ProjectSettings {
  isFallbackDisabled: boolean;
  enableSmsNotifications: boolean;
  enableCallNotifications: boolean;
  enableWhatsAppNotifications: boolean;
  enableTelegramNotifications: boolean;
  customChannels: Array<ReadinessCustomChannel>;
}

interface ReadEveryPageData {
  description: string;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  consumePage: (rows: Array<unknown>) => void;
}

interface Internals {
  readEveryPage: (data: ReadEveryPageData) => Promise<void>;
  loadMethods: (
    projectId: ObjectID,
    userIds: Array<ObjectID>,
    completeness: { isTruncated: boolean },
    customChannels: Array<ReadinessCustomChannel>,
  ) => Promise<Map<string, Array<ReadinessMethod>>>;
  describeFallbackChannels: (
    usableMethods: Array<ReadinessMethod>,
    settings: ProjectSettings,
  ) => Array<string>;
  isChannelEnabled: (methodType: string, settings: ProjectSettings) => boolean;
  loadProjectSettings: (projectId: ObjectID) => Promise<ProjectSettings>;
  buildUserReadiness: (
    user: User,
    attachment: { sources: Set<ResponderSource>; teamIds: Set<string> },
    userIdString: string,
    inputs: {
      users: Array<User>;
      methodsByUserId: Map<string, Array<ReadinessMethod>>;
      coverageByKey: Map<string, unknown>;
      incidentSeverities: Array<unknown>;
      alertSeverities: Array<unknown>;
      projectSettings: ProjectSettings;
    },
    teamNamesById: Map<string, string>,
    isProjectMember: boolean,
  ) => UserReadiness;
}

function internals(): Internals {
  return OnCallReadinessService as unknown as Internals;
}

function settings(
  customChannels: Array<ReadinessCustomChannel> = [],
): ProjectSettings {
  return {
    isFallbackDisabled: false,
    enableSmsNotifications: true,
    enableCallNotifications: true,
    enableWhatsAppNotifications: true,
    enableTelegramNotifications: true,
    customChannels: customChannels,
  };
}

function readinessChannel(
  name: string,
  pagesEveryone: boolean,
): ReadinessCustomChannel {
  return { id: ObjectID.generate(), name: name, pagesEveryone: pagesEveryone };
}

function channelMethod(channel: ReadinessCustomChannel): ReadinessMethod {
  return {
    methodId: channel.id,
    methodType: ReadinessMethodType.CustomChannel,
    maskedIdentifier: channel.name,
    isVerified: true,
  };
}

let reads: Array<ReadEveryPageData>;
let rulesNamingChannels: Array<UserNotificationRule>;

beforeEach(() => {
  reads = [];
  rulesNamingChannels = [];

  // No personal methods; the rules that name a channel are the test's.
  jest
    .spyOn(internals(), "readEveryPage")
    .mockImplementation(async (data: ReadEveryPageData): Promise<void> => {
      reads.push(data);

      if (data.description === "on-call rules that page through a custom channel") {
        data.consumePage(rulesNamingChannels);
        return;
      }

      data.consumePage([]);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the method type", () => {
  test("is named as the payload and the fallback name it", () => {
    expect(ReadinessMethodType.CustomChannel).toBe(CUSTOM_CHANNEL_METHOD_LABEL);
  });

  test("no project setting switches a channel off", () => {
    expect(
      internals().isChannelEnabled(ReadinessMethodType.CustomChannel, {
        ...settings(),
        enableSmsNotifications: false,
        enableCallNotifications: false,
        enableWhatsAppNotifications: false,
        enableTelegramNotifications: false,
      }),
    ).toBe(true);
  });
});

describe("a responder's methods", () => {
  test("a channel that pages everyone is every responder's", async () => {
    const corpoApp: ReadinessCustomChannel = readinessChannel("CorpoApp", true);
    const jane: ObjectID = ObjectID.generate();
    const ravi: ObjectID = ObjectID.generate();

    const methods: Map<string, Array<ReadinessMethod>> =
      await internals().loadMethods(PROJECT_ID, [jane, ravi], { isTruncated: false }, [
        corpoApp,
      ]);

    for (const userId of [jane, ravi]) {
      expect(methods.get(userId.toString())).toEqual([channelMethod(corpoApp)]);
    }

    // Nothing to read for it: it reaches everyone.
    expect(
      reads.some((read: ReadEveryPageData): boolean => {
        return read.description === "on-call rules that page through a custom channel";
      }),
    ).toBe(false);
  });

  test("a channel people choose is theirs only when one of their rules names it", async () => {
    const pager: ReadinessCustomChannel = readinessChannel("Pager", false);
    const jane: ObjectID = ObjectID.generate();
    const ravi: ObjectID = ObjectID.generate();

    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userId = jane;
    rule.customNotificationChannelId = pager.id;
    rulesNamingChannels = [rule, rule];

    const methods: Map<string, Array<ReadinessMethod>> =
      await internals().loadMethods(PROJECT_ID, [jane, ravi], { isTruncated: false }, [
        pager,
      ]);

    // Once, however many rules name it.
    expect(methods.get(jane.toString())).toEqual([channelMethod(pager)]);
    expect(methods.get(ravi.toString())).toBeUndefined();
  });

  test("the rules are read for the project, the responders and those channels only, without a URL", async () => {
    const pager: ReadinessCustomChannel = readinessChannel("Pager", false);
    const jane: ObjectID = ObjectID.generate();

    await internals().loadMethods(PROJECT_ID, [jane], { isTruncated: false }, [
      pager,
    ]);

    const read: ReadEveryPageData | undefined = reads.find(
      (candidate: ReadEveryPageData): boolean => {
        return (
          candidate.description ===
          "on-call rules that page through a custom channel"
        );
      },
    );

    expect(read).toBeDefined();
    expect(read!.query["projectId"]).toBe(PROJECT_ID);
    expect(Object.keys(read!.query).sort()).toEqual(
      ["customNotificationChannelId", "projectId", "userId"].sort(),
    );
    expect(read!.select).toEqual({
      _id: true,
      userId: true,
      customNotificationChannelId: true,
    });
  });

  test("a rule naming a channel that is off, or no channel this read knows, adds nothing", async () => {
    const pager: ReadinessCustomChannel = readinessChannel("Pager", false);
    const jane: ObjectID = ObjectID.generate();

    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userId = jane;
    rule.customNotificationChannelId = ObjectID.generate();
    rulesNamingChannels = [rule];

    const methods: Map<string, Array<ReadinessMethod>> =
      await internals().loadMethods(PROJECT_ID, [jane], { isTruncated: false }, [
        pager,
      ]);

    expect(methods.get(jane.toString())).toBeUndefined();
  });

  test("with no channels on, nothing changes", async () => {
    const jane: ObjectID = ObjectID.generate();

    const methods: Map<string, Array<ReadinessMethod>> =
      await internals().loadMethods(PROJECT_ID, [jane], { isTruncated: false }, []);

    expect(methods.get(jane.toString())).toBeUndefined();
  });
});

describe("the fallback, as readiness names it", () => {
  test("names a channel that pages everyone among the channels that cost nothing", () => {
    const corpoApp: ReadinessCustomChannel = readinessChannel("CorpoApp", true);

    expect(
      internals().describeFallbackChannels(
        [channelMethod(corpoApp)],
        settings([corpoApp]),
      ),
    ).toEqual([CUSTOM_CHANNEL_METHOD_LABEL]);
  });

  test("never names a channel people choose: the fallback does not use it", () => {
    const pager: ReadinessCustomChannel = readinessChannel("Pager", false);

    expect(
      internals().describeFallbackChannels(
        [channelMethod(pager)],
        settings([pager]),
      ),
    ).toEqual([]);
  });

  test("names it after Microsoft Teams, in the order the fallback adds it", () => {
    const corpoApp: ReadinessCustomChannel = readinessChannel("CorpoApp", true);

    expect(
      internals().describeFallbackChannels(
        [
          channelMethod(corpoApp),
          {
            methodId: ObjectID.generate(),
            methodType: ReadinessMethodType.Email,
            maskedIdentifier: "j•••@example.com",
            isVerified: true,
          },
        ],
        settings([corpoApp]),
      ),
    ).toEqual([ReadinessMethodType.Email, CUSTOM_CHANNEL_METHOD_LABEL]);
  });

  test("one free channel is enough: SMS is not named beside it", () => {
    const corpoApp: ReadinessCustomChannel = readinessChannel("CorpoApp", true);

    expect(
      internals().describeFallbackChannels(
        [
          channelMethod(corpoApp),
          {
            methodId: ObjectID.generate(),
            methodType: ReadinessMethodType.SMS,
            maskedIdentifier: "+1 ••• ••• 4821",
            isVerified: true,
          },
        ],
        settings([corpoApp]),
      ),
    ).toEqual([CUSTOM_CHANNEL_METHOD_LABEL]);
  });
});

describe("a responder reached only through a channel", () => {
  function user(): User {
    const row: User = new User();
    row._id = ObjectID.generate().toString();
    row.name = new Name("Jane Tan");
    row.email = new Email("jane@example.com");
    return row;
  }

  test("is Ready", () => {
    const corpoApp: ReadinessCustomChannel = readinessChannel("CorpoApp", true);
    const jane: User = user();

    const readiness: UserReadiness = internals().buildUserReadiness(
      jane,
      { sources: new Set([ResponderSource.Direct]), teamIds: new Set() },
      jane.id!.toString(),
      {
        users: [jane],
        methodsByUserId: new Map([
          [jane.id!.toString(), [channelMethod(corpoApp)]],
        ]),
        coverageByKey: new Map(),
        incidentSeverities: [],
        alertSeverities: [],
        projectSettings: settings([corpoApp]),
      },
      new Map(),
      true,
    );

    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.methods).toEqual([channelMethod(corpoApp)]);
  });

  test("with no channel and no method, is not reachable", () => {
    const jane: User = user();

    const readiness: UserReadiness = internals().buildUserReadiness(
      jane,
      { sources: new Set([ResponderSource.Direct]), teamIds: new Set() },
      jane.id!.toString(),
      {
        users: [jane],
        methodsByUserId: new Map(),
        coverageByKey: new Map(),
        incidentSeverities: [],
        alertSeverities: [],
        projectSettings: settings(),
      },
      new Map(),
      true,
    );

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
  });
});

describe("the channels readiness reads", () => {
  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(new Project());
  });

  test("are the ones that are on, with whether each pages everyone", async () => {
    const corpoApp: CustomNotificationChannel = new CustomNotificationChannel();
    corpoApp._id = ObjectID.generate().toString();
    corpoApp.name = "CorpoApp";
    corpoApp.pageEveryoneByDefault = true;

    const pager: CustomNotificationChannel = new CustomNotificationChannel();
    pager._id = ObjectID.generate().toString();
    pager.name = "Pager";
    pager.pageEveryoneByDefault = false;

    jest
      .spyOn(CustomNotificationChannelService, "getChannelsThatAreOn")
      .mockResolvedValue([corpoApp, pager]);

    const loaded: ProjectSettings =
      await internals().loadProjectSettings(PROJECT_ID);

    expect(loaded.customChannels).toEqual([
      { id: corpoApp.id, name: "CorpoApp", pagesEveryone: true },
      { id: pager.id, name: "Pager", pagesEveryone: false },
    ]);
  });

  test("channels that cannot be read count as none: never a false green", async () => {
    jest
      .spyOn(CustomNotificationChannelService, "getChannelsThatAreOn")
      .mockRejectedValue(new Error("database down"));

    const loaded: ProjectSettings =
      await internals().loadProjectSettings(PROJECT_ID);

    expect(loaded.customChannels).toEqual([]);
  });

});
