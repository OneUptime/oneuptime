import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import OnCallReadinessService, {
  PHONE_METHOD_REQUIRED_READINESS_REASON,
  ReadinessMethod,
  ReadinessMethodType,
  ReadinessStatus,
  ResponderSource,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * READINESS, IN A PROJECT THAT ASKS PEOPLE ON CALL FOR A PHONE (#7449, #1809).
 *
 * Project.requirePhoneMethodForOnCall is a finding, not a gate: a responder
 * with no verified SMS, phone call or WhatsApp number is named
 * (isMissingPhoneMethod), with a reason that says what the project asks,
 * and is paged exactly as before - their status does not move. Somebody
 * nothing reaches is told the larger thing first, and is not told this
 * too. Readiness answers it once, from the one helper
 * (isMissingRequiredPhoneMethod); Setup health and the setup reminder read
 * the answer.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

interface ProjectSettings {
  isFallbackDisabled: boolean;
  enableSmsNotifications: boolean;
  enableCallNotifications: boolean;
  enableWhatsAppNotifications: boolean;
  enableTelegramNotifications: boolean;
  customChannels: Array<unknown>;
  isPushTurnedOffOnServer: boolean;
  isPhoneMethodRequired: boolean;
}

interface Internals {
  loadProjectSettings: (projectId: ObjectID) => Promise<ProjectSettings>;
  buildUserReadiness: (
    user: User,
    attachment: { sources: Set<ResponderSource>; teamIds: Set<string> },
    userIdString: string,
    inputs: {
      users: Array<User>;
      methodsByUserId: Map<string, Array<ReadinessMethod>>;
      coverageByKey: Map<string, unknown>;
      incidentSeverities: Array<{ id: ObjectID; name: string }>;
      alertSeverities: Array<{ id: ObjectID; name: string }>;
      projectSettings: ProjectSettings;
    },
    teamNamesById: Map<string, string>,
    isProjectMember: boolean,
  ) => UserReadiness;
}

function internals(): Internals {
  return OnCallReadinessService as unknown as Internals;
}

function settings(isPhoneMethodRequired: boolean): ProjectSettings {
  return {
    isFallbackDisabled: false,
    enableSmsNotifications: true,
    enableCallNotifications: true,
    enableWhatsAppNotifications: true,
    enableTelegramNotifications: true,
    customChannels: [],
    isPushTurnedOffOnServer: false,
    isPhoneMethodRequired: isPhoneMethodRequired,
  };
}

function method(
  methodType: ReadinessMethodType,
  isVerified: boolean = true,
): ReadinessMethod {
  return {
    methodId: ObjectID.generate(),
    methodType: methodType,
    maskedIdentifier: `${methodType} •••`,
    isVerified: isVerified,
  };
}

/*
 * Jane, on a policy in a project with no severities yet: no card can lack a
 * rule, so with one usable method she is Ready, phone or not.
 */
function readinessOf(data: {
  methods: Array<ReadinessMethod>;
  isPhoneMethodRequired: boolean;
  isProjectMember?: boolean;
}): UserReadiness {
  const jane: User = new User();
  jane._id = ObjectID.generate().toString();
  jane.name = new Name("Jane Tan");
  jane.email = new Email("jane@example.com");

  return internals().buildUserReadiness(
    jane,
    { sources: new Set([ResponderSource.Direct]), teamIds: new Set() },
    jane.id!.toString(),
    {
      users: [jane],
      methodsByUserId: new Map([[jane.id!.toString(), data.methods]]),
      coverageByKey: new Map(),
      incidentSeverities: [],
      alertSeverities: [],
      projectSettings: settings(data.isPhoneMethodRequired),
    },
    new Map(),
    data.isProjectMember ?? true,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project that does not ask for a phone", () => {
  test("says nothing of one: no flag, no reason", () => {
    const readiness: UserReadiness = readinessOf({
      methods: [method(ReadinessMethodType.Email)],
      isPhoneMethodRequired: false,
    });

    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.isMissingPhoneMethod).toBeUndefined();
    expect("isMissingPhoneMethod" in readiness).toBe(false);
    expect(readiness.reasons).toEqual([]);
  });
});

describe("a project that asks people on call for a phone", () => {
  test("somebody with only email and push is named, and paged as before", () => {
    const readiness: UserReadiness = readinessOf({
      methods: [
        method(ReadinessMethodType.Email),
        method(ReadinessMethodType.Push),
      ],
      isPhoneMethodRequired: true,
    });

    expect(readiness.isMissingPhoneMethod).toBe(true);
    // Their status is what it was: the ask locks nobody out.
    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.reasons).toEqual([PHONE_METHOD_REQUIRED_READINESS_REASON]);
  });

  test.each([
    ReadinessMethodType.SMS,
    ReadinessMethodType.Call,
    ReadinessMethodType.WhatsApp,
  ])(
    "a verified %s number is a phone method",
    (methodType: ReadinessMethodType) => {
      const readiness: UserReadiness = readinessOf({
        methods: [method(ReadinessMethodType.Email), method(methodType)],
        isPhoneMethodRequired: true,
      });

      expect(readiness.isMissingPhoneMethod).toBeUndefined();
      expect(readiness.reasons).toEqual([]);
    },
  );

  test("a number never verified is not one", () => {
    const readiness: UserReadiness = readinessOf({
      methods: [
        method(ReadinessMethodType.Email),
        method(ReadinessMethodType.SMS, false),
      ],
      isPhoneMethodRequired: true,
    });

    expect(readiness.isMissingPhoneMethod).toBe(true);
  });

  test("Telegram, Slack or a webhook is not one", () => {
    const readiness: UserReadiness = readinessOf({
      methods: [
        method(ReadinessMethodType.Telegram),
        method(ReadinessMethodType.Slack),
        method(ReadinessMethodType.Webhook),
      ],
      isPhoneMethodRequired: true,
    });

    expect(readiness.isMissingPhoneMethod).toBe(true);
  });

  test("somebody nothing reaches is told that first, and not this too", () => {
    const readiness: UserReadiness = readinessOf({
      methods: [],
      isPhoneMethodRequired: true,
    });

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
    expect(readiness.isMissingPhoneMethod).toBe(true);
    expect(readiness.reasons).not.toContain(
      PHONE_METHOD_REQUIRED_READINESS_REASON,
    );
  });

  test("somebody who is not a member of the project is not named for it", () => {
    const readiness: UserReadiness = readinessOf({
      methods: [method(ReadinessMethodType.Email)],
      isPhoneMethodRequired: true,
      isProjectMember: false,
    });

    expect(readiness.isMissingPhoneMethod).toBeUndefined();
    expect(readiness.reasons).not.toContain(
      PHONE_METHOD_REQUIRED_READINESS_REASON,
    );
  });

  test("the reason says what the project asks, and what counts", () => {
    expect(PHONE_METHOD_REQUIRED_READINESS_REASON).toBe(
      "No verified phone method (SMS, phone call or WhatsApp) - this project asks everyone on call to add one",
    );
  });
});

describe("the project's ask, as readiness reads it", () => {
  function readWith(project: Project | null): Promise<ProjectSettings> {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
    jest
      .spyOn(CustomNotificationChannelService, "getChannelsThatAreOn")
      .mockResolvedValue([] as never);
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(false);

    return internals().loadProjectSettings(PROJECT_ID);
  }

  test("is read with the project's switches, once", async () => {
    const project: Project = new Project();
    project.requirePhoneMethodForOnCall = true;

    const read: ProjectSettings = await readWith(project);

    expect(read.isPhoneMethodRequired).toBe(true);
    expect(
      (
        (ProjectService.findOneById as unknown as jest.Mock).mock
          .calls[0]![0] as { select: Record<string, boolean> }
      ).select["requirePhoneMethodForOnCall"],
    ).toBe(true);
  });

  test.each([
    ["off", false],
    ["never set (an existing project)", undefined],
    ["null", null],
  ])("%s: not asked", async (_name: string, value: unknown) => {
    const project: Project = new Project();
    project.requirePhoneMethodForOnCall = value as boolean;

    expect((await readWith(project)).isPhoneMethodRequired).toBe(false);
  });

  test("a project that cannot be found asks for nothing", async () => {
    expect((await readWith(null)).isPhoneMethodRequired).toBe(false);
  });
});
