import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import OnCallReadinessService, {
  ReadinessMethod,
  ReadinessMethodType,
  ReadinessStatus,
  ResponderSource,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import ProjectService from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { PUSH_TURNED_OFF_READINESS_CLAUSE } from "../../../Types/PushNotification/PushNotificationsTurnedOff";
import { getWhoCanTurnOnClause } from "../../../Utils/Project/NotificationChannels";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * READINESS, WHILE THE SERVER HAS PUSH TURNED OFF.
 *
 * Readiness answers "can this person be paged". While a master admin has
 * push notifications turned off for the whole server, nothing is pushed, so
 * a push device reaches nobody: a responder whose every verified method is a
 * push device is not reachable, and readiness says so in a sentence that
 * names who can turn push back on - a server admin, in the Admin Dashboard -
 * rather than the project owner the project switches' sentences name. When a
 * project switch is in the way too, one sentence says both. When push is not
 * in the way, every sentence reads as it always did.
 *
 * A switch that cannot be read counts as off: a responder then looks less
 * reachable than they may be, never more, which is the direction readiness
 * always errs in. A settings object that does not say (older code paths)
 * counts as on, as every server was before there was a switch.
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
  isPushTurnedOffOnServer?: boolean | undefined;
}

interface SeverityRef {
  id: ObjectID;
  name: string;
}

interface Internals {
  isChannelEnabled: (methodType: string, settings: ProjectSettings) => boolean;
  loadProjectSettings: (projectId: ObjectID) => Promise<ProjectSettings>;
  loadIsPushTurnedOffOnServer: () => Promise<boolean>;
  buildUserReadiness: (
    user: User,
    attachment: { sources: Set<ResponderSource>; teamIds: Set<string> },
    userIdString: string,
    inputs: {
      users: Array<User>;
      methodsByUserId: Map<string, Array<ReadinessMethod>>;
      coverageByKey: Map<string, unknown>;
      incidentSeverities: Array<SeverityRef>;
      alertSeverities: Array<SeverityRef>;
      projectSettings: ProjectSettings;
    },
    teamNamesById: Map<string, string>,
    isProjectMember: boolean,
  ) => UserReadiness;
}

function internals(): Internals {
  return OnCallReadinessService as unknown as Internals;
}

// The four channels a project switches: switched on unless a test says off.
const PROJECT_CHANNELS: Array<ReadinessMethodType> = [
  ReadinessMethodType.SMS,
  ReadinessMethodType.Call,
  ReadinessMethodType.WhatsApp,
  ReadinessMethodType.Telegram,
];

function settings(data: {
  isPushTurnedOffOnServer?: boolean | undefined;
  switchedOff?: Array<ReadinessMethodType>;
}): ProjectSettings {
  const off: Array<ReadinessMethodType> = data.switchedOff || [];

  return {
    isFallbackDisabled: false,
    enableSmsNotifications: !off.includes(ReadinessMethodType.SMS),
    enableCallNotifications: !off.includes(ReadinessMethodType.Call),
    enableWhatsAppNotifications: !off.includes(ReadinessMethodType.WhatsApp),
    enableTelegramNotifications: !off.includes(ReadinessMethodType.Telegram),
    customChannels: [],
    isPushTurnedOffOnServer: data.isPushTurnedOffOnServer,
  };
}

// A verified method of the type, as readiness loads it.
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

function responder(): User {
  const row: User = new User();
  row._id = ObjectID.generate().toString();
  row.name = new Name("Jane Tan");
  row.email = new Email("jane@example.com");
  return row;
}

// A responder's readiness, with no severities: only reachability is judged.
function readinessOf(
  methods: Array<ReadinessMethod>,
  projectSettings: ProjectSettings,
  incidentSeverities: Array<SeverityRef> = [],
): UserReadiness {
  const jane: User = responder();

  return internals().buildUserReadiness(
    jane,
    { sources: new Set([ResponderSource.Direct]), teamIds: new Set() },
    jane.id!.toString(),
    {
      users: [jane],
      methodsByUserId: new Map([[jane.id!.toString(), methods]]),
      coverageByKey: new Map(),
      incidentSeverities: incidentSeverities,
      alertSeverities: [],
      projectSettings: projectSettings,
    },
    new Map(),
    true,
  );
}

const NO_USABLE_METHOD: string =
  "No usable notification method - cannot be paged";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("whether push is a channel the project can send on (isChannelEnabled)", () => {
  test("on while the server has push on, off while it has push turned off", () => {
    expect(
      internals().isChannelEnabled(
        ReadinessMethodType.Push,
        settings({ isPushTurnedOffOnServer: false }),
      ),
    ).toBe(true);
    expect(
      internals().isChannelEnabled(
        ReadinessMethodType.Push,
        settings({ isPushTurnedOffOnServer: true }),
      ),
    ).toBe(false);
  });

  test("settings that do not say count as on, as every server was before the switch", () => {
    const unsaid: ProjectSettings = settings({});
    delete unsaid.isPushTurnedOffOnServer;

    expect("isPushTurnedOffOnServer" in unsaid).toBe(false);
    expect(internals().isChannelEnabled(ReadinessMethodType.Push, unsaid)).toBe(
      true,
    );
  });

  test("no project switch gates push: every combination of the four, with push on, off and unsaid", () => {
    for (let mask: number = 0; mask < 16; mask++) {
      const switchedOff: Array<ReadinessMethodType> = PROJECT_CHANNELS.filter(
        (_channel: ReadinessMethodType, index: number): boolean => {
          return (mask & (1 << index)) !== 0;
        },
      );

      for (const isPushTurnedOffOnServer of [false, true, undefined]) {
        expect({
          switchedOff,
          isPushTurnedOffOnServer,
          enabled: internals().isChannelEnabled(
            ReadinessMethodType.Push,
            settings({ isPushTurnedOffOnServer, switchedOff }),
          ),
        }).toEqual({
          switchedOff,
          isPushTurnedOffOnServer,
          enabled: isPushTurnedOffOnServer !== true,
        });
      }
    }
  });

  test("push turned off gates nothing else: the free channels stay on, the paid ones follow their own switches", () => {
    const otherChannels: Array<ReadinessMethodType> = [
      ReadinessMethodType.Email,
      ReadinessMethodType.Webhook,
      ReadinessMethodType.Slack,
      ReadinessMethodType.MicrosoftTeams,
      ReadinessMethodType.CustomChannel,
      ...PROJECT_CHANNELS,
    ];

    for (const methodType of otherChannels) {
      for (const switchedOff of [[], [methodType]]) {
        const withPushOn: boolean = internals().isChannelEnabled(
          methodType,
          settings({ isPushTurnedOffOnServer: false, switchedOff }),
        );
        const withPushOff: boolean = internals().isChannelEnabled(
          methodType,
          settings({ isPushTurnedOffOnServer: true, switchedOff }),
        );

        expect({ methodType, switchedOff, withPushOff }).toEqual({
          methodType,
          switchedOff,
          withPushOff: withPushOn,
        });
      }
    }
  });
});

describe("loading whether push is off, with the project's switches", () => {
  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(new Project());
    jest
      .spyOn(CustomNotificationChannelService, "getChannelsThatAreOn")
      .mockResolvedValue([]);
  });

  test.each([[true], [false]])(
    "the server's switch, as GlobalConfigService has it: turned off = %p",
    async (isTurnedOff: boolean) => {
      const read: jest.SpyInstance = jest
        .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
        .mockResolvedValue(isTurnedOff);

      const loaded: ProjectSettings =
        await internals().loadProjectSettings(PROJECT_ID);

      expect(loaded.isPushTurnedOffOnServer).toBe(isTurnedOff);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  test("a switch that cannot be read counts as off - never a false green - and is logged", async () => {
    const failure: Error = new Error("database unavailable");

    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockRejectedValue(failure);

    const loaded: ProjectSettings =
      await internals().loadProjectSettings(PROJECT_ID);

    expect(loaded.isPushTurnedOffOnServer).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(failure);
  });

  test("a failed read does not take the project's own switches or channels with it", async () => {
    const project: Project = new Project();
    project.enableSmsNotifications = true;
    project.enableCallNotifications = false;

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockRejectedValue(new Error("database unavailable"));

    const loaded: ProjectSettings =
      await internals().loadProjectSettings(PROJECT_ID);

    expect(loaded.enableSmsNotifications).toBe(true);
    expect(loaded.enableCallNotifications).toBe(false);
    expect(loaded.customChannels).toEqual([]);
  });

  test("loadIsPushTurnedOffOnServer answers the switch, or off when it cannot be read", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expect(internals().loadIsPushTurnedOffOnServer()).resolves.toBe(
      false,
    );
    await expect(internals().loadIsPushTurnedOffOnServer()).resolves.toBe(true);
    await expect(internals().loadIsPushTurnedOffOnServer()).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe("a responder reached only by push", () => {
  test("push on: Ready", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push)],
      settings({ isPushTurnedOffOnServer: false }),
    );

    expect(readiness.status).toBe(ReadinessStatus.Ready);
    expect(readiness.reasons).toEqual([]);
  });

  test("push off: not reachable, and the reason names who can turn push back on", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push)],
      settings({ isPushTurnedOffOnServer: true }),
    );

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
    expect(readiness.reasons).toEqual([
      NO_USABLE_METHOD,
      `Every method they have verified is on Push, and ${PUSH_TURNED_OFF_READINESS_CLAUSE}`,
    ]);
  });

  test("push off: the reason names a server admin, not the project owners a project switch names", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push)],
      settings({ isPushTurnedOffOnServer: true }),
    );

    expect(readiness.reasons[1]).toContain("a server admin can turn them on");
    expect(readiness.reasons[1]).not.toContain(getWhoCanTurnOnClause("it"));
    expect(readiness.reasons[1]).not.toContain("this project has");
  });

  test("push off, with several push devices: push is named once", () => {
    const readiness: UserReadiness = readinessOf(
      [
        method(ReadinessMethodType.Push),
        method(ReadinessMethodType.Push),
        method(ReadinessMethodType.Push),
      ],
      settings({ isPushTurnedOffOnServer: true }),
    );

    expect(readiness.reasons).toEqual([
      NO_USABLE_METHOD,
      `Every method they have verified is on Push, and ${PUSH_TURNED_OFF_READINESS_CLAUSE}`,
    ]);
  });

  test("push off: the devices are still listed, as the person has them", () => {
    const pushDevice: ReadinessMethod = method(ReadinessMethodType.Push);

    const readiness: UserReadiness = readinessOf(
      [pushDevice],
      settings({ isPushTurnedOffOnServer: true }),
    );

    expect(readiness.methods).toEqual([pushDevice]);
  });

  test("settings that do not say whether push is off: Ready, as before the switch", () => {
    const unsaid: ProjectSettings = settings({});
    delete unsaid.isPushTurnedOffOnServer;

    expect(readinessOf([method(ReadinessMethodType.Push)], unsaid).status).toBe(
      ReadinessStatus.Ready,
    );
  });

  test("push off, and a device that no longer receives: the 'register it again' reasons, unchanged", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push, false)],
      settings({ isPushTurnedOffOnServer: true }),
    );

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
    expect(readiness.reasons).toEqual([
      "No verified notification method - cannot be paged",
      "A push device no longer receives notifications - register it again from the mobile app or browser it belongs to",
    ]);
  });
});

describe("a responder with another way to be reached", () => {
  test.each([
    [ReadinessMethodType.Email],
    [ReadinessMethodType.Slack],
    [ReadinessMethodType.MicrosoftTeams],
    [ReadinessMethodType.Webhook],
    [ReadinessMethodType.SMS],
  ])(
    "push off, and %s: Ready, with nothing said of push",
    (other: ReadinessMethodType) => {
      const readiness: UserReadiness = readinessOf(
        [method(ReadinessMethodType.Push), method(other)],
        settings({ isPushTurnedOffOnServer: true }),
      );

      expect(readiness.status).toBe(ReadinessStatus.Ready);
      expect(readiness.reasons).toEqual([]);
    },
  );

  test("push on, and SMS the project switched off: Ready - push reaches them", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push), method(ReadinessMethodType.SMS)],
      settings({
        isPushTurnedOffOnServer: false,
        switchedOff: [ReadinessMethodType.SMS],
      }),
    );

    expect(readiness.status).toBe(ReadinessStatus.Ready);
  });
});

describe("push and a project switch both in the way: one sentence says both", () => {
  test("Push and SMS, with SMS switched off", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push), method(ReadinessMethodType.SMS)],
      settings({
        isPushTurnedOffOnServer: true,
        switchedOff: [ReadinessMethodType.SMS],
      }),
    );

    expect(readiness.status).toBe(ReadinessStatus.NotReachable);
    expect(readiness.reasons).toEqual([
      NO_USABLE_METHOD,
      `Every method they have verified is on Push, SMS. This project has SMS switched off - ${getWhoCanTurnOnClause("it")} - and ${PUSH_TURNED_OFF_READINESS_CLAUSE}`,
    ]);
  });

  test("Push, SMS and Call, with both switched off: the project's two are 'them'", () => {
    const readiness: UserReadiness = readinessOf(
      [
        method(ReadinessMethodType.Push),
        method(ReadinessMethodType.SMS),
        method(ReadinessMethodType.Call),
      ],
      settings({
        isPushTurnedOffOnServer: true,
        switchedOff: [ReadinessMethodType.SMS, ReadinessMethodType.Call],
      }),
    );

    expect(readiness.reasons).toEqual([
      NO_USABLE_METHOD,
      `Every method they have verified is on Push, SMS, Call. This project has SMS, Call switched off - ${getWhoCanTurnOnClause("them")} - and ${PUSH_TURNED_OFF_READINESS_CLAUSE}`,
    ]);
  });

  test("the channels are named in the order the person's methods come, push wherever it is", () => {
    const readiness: UserReadiness = readinessOf(
      [
        method(ReadinessMethodType.Telegram),
        method(ReadinessMethodType.Push),
        method(ReadinessMethodType.WhatsApp),
      ],
      settings({
        isPushTurnedOffOnServer: true,
        switchedOff: [
          ReadinessMethodType.Telegram,
          ReadinessMethodType.WhatsApp,
        ],
      }),
    );

    expect(readiness.reasons[1]).toBe(
      `Every method they have verified is on Telegram, Push, WhatsApp. This project has Telegram, WhatsApp switched off - ${getWhoCanTurnOnClause("them")} - and ${PUSH_TURNED_OFF_READINESS_CLAUSE}`,
    );
  });
});

describe("push not in the way: the project switches' sentences read as they always did", () => {
  test("SMS only, switched off", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.SMS)],
      settings({
        isPushTurnedOffOnServer: true,
        switchedOff: [ReadinessMethodType.SMS],
      }),
    );

    expect(readiness.reasons).toEqual([
      NO_USABLE_METHOD,
      `Every method they have verified is on SMS, and this project has that channel switched off - ${getWhoCanTurnOnClause("it")}`,
    ]);
  });

  test("SMS and Call, both switched off", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.SMS), method(ReadinessMethodType.Call)],
      settings({
        isPushTurnedOffOnServer: false,
        switchedOff: [ReadinessMethodType.SMS, ReadinessMethodType.Call],
      }),
    );

    expect(readiness.reasons).toEqual([
      NO_USABLE_METHOD,
      `Every method they have verified is on SMS, Call, and this project has those channels switched off - ${getWhoCanTurnOnClause("them")}`,
    ]);
  });

  test("whether the server has push off makes no difference to them", () => {
    for (const methodTypes of [
      [ReadinessMethodType.WhatsApp],
      [ReadinessMethodType.Call, ReadinessMethodType.Telegram],
    ]) {
      const methods: Array<ReadinessMethod> = methodTypes.map(
        (methodType: ReadinessMethodType): ReadinessMethod => {
          return method(methodType);
        },
      );

      const reasonsWith: (isPushTurnedOffOnServer: boolean) => Array<string> = (
        isPushTurnedOffOnServer: boolean,
      ): Array<string> => {
        return readinessOf(
          methods,
          settings({ isPushTurnedOffOnServer, switchedOff: methodTypes }),
        ).reasons;
      };

      expect(reasonsWith(true)).toEqual(reasonsWith(false));
      expect(reasonsWith(true).join(" ")).not.toContain("server admin");
    }
  });
});

describe("every combination of push and the project's switches", () => {
  /*
   * Push verified or not, push on or off, and every set of the four paid
   * channels verified with the project's switch for each off - each in
   * orders drawn from a seeded stream, since the sentence names channels in
   * the order the person's methods come.
   */
  test("the status and both sentences follow from what is in the way", () => {
    const random: SeededRandom = seededRandom(5280);

    for (let mask: number = 0; mask < 16; mask++) {
      const projectChannels: Array<ReadinessMethodType> =
        PROJECT_CHANNELS.filter(
          (_channel: ReadinessMethodType, index: number): boolean => {
            return (mask & (1 << index)) !== 0;
          },
        );

      for (const hasPush of [false, true]) {
        const methodTypes: Array<ReadinessMethodType> = hasPush
          ? [ReadinessMethodType.Push, ...projectChannels]
          : projectChannels;

        if (methodTypes.length === 0) {
          continue;
        }

        for (const isPushTurnedOffOnServer of [false, true]) {
          for (let draw: number = 0; draw < 4; draw++) {
            const order: Array<ReadinessMethodType> = shuffled(
              methodTypes,
              random,
            );

            const readiness: UserReadiness = readinessOf(
              order.map((methodType: ReadinessMethodType): ReadinessMethod => {
                return method(methodType);
              }),
              settings({
                isPushTurnedOffOnServer,
                switchedOff: projectChannels,
              }),
            );

            const isPushInTheWay: boolean = hasPush && isPushTurnedOffOnServer;
            const isReachable: boolean = hasPush && !isPushTurnedOffOnServer;
            const disabled: Array<ReadinessMethodType> = order.filter(
              (methodType: ReadinessMethodType): boolean => {
                return (
                  methodType !== ReadinessMethodType.Push || isPushInTheWay
                );
              },
            );

            const label: Record<string, unknown> = {
              order,
              isPushTurnedOffOnServer,
            };

            expect({ ...label, status: readiness.status }).toEqual({
              ...label,
              status: isReachable
                ? ReadinessStatus.Ready
                : ReadinessStatus.NotReachable,
            });

            if (isReachable) {
              expect({ ...label, reasons: readiness.reasons }).toEqual({
                ...label,
                reasons: [],
              });
              continue;
            }

            const sentence: string = readiness.reasons[1] || "";

            expect({ ...label, first: readiness.reasons[0] }).toEqual({
              ...label,
              first: NO_USABLE_METHOD,
            });
            expect({ ...label, count: readiness.reasons.length }).toEqual({
              ...label,
              count: 2,
            });
            expect({
              ...label,
              names: sentence.startsWith(
                `Every method they have verified is on ${disabled.join(", ")}`,
              ),
              server: sentence.endsWith(PUSH_TURNED_OFF_READINESS_CLAUSE),
              project:
                sentence.includes(getWhoCanTurnOnClause("it")) ||
                sentence.includes(getWhoCanTurnOnClause("them")),
            }).toEqual({
              ...label,
              names: true,
              server: isPushInTheWay,
              project: projectChannels.length > 0,
            });
          }
        }
      }
    }
  });
});

describe("the fallback readiness names, while push is off", () => {
  const SEV1: Array<SeverityRef> = [{ id: ObjectID.generate(), name: "Sev1" }];

  test("push on: a page with no rule falls back to Push and Email", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push), method(ReadinessMethodType.Email)],
      settings({ isPushTurnedOffOnServer: false }),
      SEV1,
    );

    expect(readiness.status).toBe(ReadinessStatus.PartiallyReady);
    expect(readiness.reasons).toEqual([
      "No rules for Sev1 incidents - pages fall back to Push, Email",
      "No rules for Sev1 incident episodes - pages fall back to Push, Email",
    ]);
  });

  test("push off: it falls back to Email alone, as the fallback itself does", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push), method(ReadinessMethodType.Email)],
      settings({ isPushTurnedOffOnServer: true }),
      SEV1,
    );

    expect(readiness.reasons).toEqual([
      "No rules for Sev1 incidents - pages fall back to Email",
      "No rules for Sev1 incident episodes - pages fall back to Email",
    ]);
  });

  test("push off, with only a paid channel beside it: the paid channel is what a page falls back to", () => {
    const readiness: UserReadiness = readinessOf(
      [method(ReadinessMethodType.Push), method(ReadinessMethodType.SMS)],
      settings({ isPushTurnedOffOnServer: true }),
      SEV1,
    );

    expect(readiness.reasons).toEqual([
      "No rules for Sev1 incidents - pages fall back to SMS",
      "No rules for Sev1 incident episodes - pages fall back to SMS",
    ]);
  });
});
