import UserPushAPI, {
  parseCriticalAlertSoundFromRegistration,
  parseCriticalAlertSoundStrict,
  parseCriticalAlertVolumeFromRegistration,
  parseCriticalAlertVolumeStrict,
} from "../../../Server/API/UserPushAPI";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import ExpoPushReceiptQueue from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
} from "../../../Types/PushNotification/CriticalAlertSound";
import { CRITICAL_ALERT_VOLUME_OPTIONS } from "../../../Types/PushNotification/CriticalAlertVolume";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * The API half of the alarm a phone plays for critical pages, and on an
 * iPhone how loud.
 *
 * Two ways the choice arrives, read deliberately differently:
 *
 *   - REGISTRATION is the app restating what it holds, on every launch and
 *     for every project, from builds old and new. A value this server does
 *     not know - a sound a newer app added - must not refuse the
 *     registration, because registering is how a phone gets paged at all. It
 *     is read as "not given", and the column's default applies.
 *   - The PREFERENCES route is a person choosing. A value this server cannot
 *     honour is refused by name, never stored and never quietly swapped for
 *     the default: the screen would say "Klaxon" while the pages played the
 *     system chime.
 *
 * And the Test Notification button sends with the device's own alarm and
 * volume: a test that sounds unlike the real page tests nothing.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000801");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000802",
);
const NEW_DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000803",
);
const EXISTING_DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000804",
);

const PHONE_TOKEN: string = "ExponentPushToken[preferences-phone-001]";
const OLD_PHONE_TOKEN: string = "ExponentPushToken[preferences-phone-000]";

const SOUND_IDS: Array<string> = CRITICAL_ALERT_SOUNDS.map(
  (definition: CriticalAlertSoundDefinition): string => {
    return definition.sound;
  },
);

const SOUND_REFUSAL: string = `sound must be one of: ${SOUND_IDS.join(", ")}.`;
const VOLUME_REFUSAL: string = "volume must be a whole number from 10 to 100.";
const NOTHING_TO_SET: string =
  "Give a critical alert sound, a critical alert volume, or both.";

// Sounds this server does not know, or values that are not sounds at all.
const NOT_A_SOUND: Array<[string, unknown]> = [
  ["a capitalised id", "Klaxon"],
  ["an upper case id", "SIREN"],
  ["a padded id", " digital"],
  ["a sound a newer app added", "foghorn"],
  ["a file name", "oneuptime_klaxon.wav"],
  ["a channel id", "oncall_critical_rising"],
  ["a title", "Smoke alarm"],
  ["an empty string", ""],
  ["a number", 1],
  ["a boolean", true],
  ["an object", { sound: "klaxon" }],
  ["an array", ["klaxon"]],
];

// Values that are not a whole percentage from 10 to 100.
const NOT_A_VOLUME: Array<[string, unknown]> = [
  ["zero", 0],
  ["just below the floor", 9],
  ["just above full", 101],
  ["negative", -50],
  ["a fraction", 50.5],
  ["APNs' 0 to 1 form", 0.75],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["a number written as text", "50"],
  ["text", "loud"],
  ["an empty string", ""],
  ["a boolean", true],
  ["an object", { volume: 50 }],
  ["an array", [50]],
];

type Answer = { json: JSONObject } | Error;

function signedIn(body: JSONObject, params: JSONObject = {}): OneUptimeRequest {
  return {
    params: params,
    body: body,
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
  } as unknown as OneUptimeRequest;
}

// Through the route's handler, as express would call it after its middleware.
async function call(uri: string, request: OneUptimeRequest): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", uri)
    .handlerFunction(request, res, (err?: unknown): void => {
      failure = err as Error;
    });

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  if (!failure && errorCalls.length > 0) {
    failure = errorCalls[0]![2] as Error;
  }

  if (failure) {
    return failure;
  }

  const jsonCalls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(jsonCalls).toHaveLength(1);

  return { json: jsonCalls[0]![2] as JSONObject };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserPushAPI();
});

beforeEach(() => {
  // Push is on for the whole server (GlobalConfig.disablePushNotifications).
  jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseCriticalAlertSoundFromRegistration - lenient", () => {
  test.each(
    SOUND_IDS.map((sound: string): [string] => {
      return [sound];
    }),
  )("keeps %s", (sound: string) => {
    expect(parseCriticalAlertSoundFromRegistration(sound)).toBe(sound);
  });

  test.each([
    ...NOT_A_SOUND,
    ["undefined - an app older than the choice", undefined],
    ["null", null],
  ] as Array<[string, unknown]>)(
    "reads %s as not given, without refusing the registration",
    (_label: string, raw: unknown) => {
      expect(parseCriticalAlertSoundFromRegistration(raw)).toBeUndefined();
    },
  );
});

describe("parseCriticalAlertVolumeFromRegistration - lenient", () => {
  test("keeps every whole percentage from 10 to 100", () => {
    for (let volume: number = 10; volume <= 100; volume++) {
      expect(parseCriticalAlertVolumeFromRegistration(volume)).toBe(volume);
    }
  });

  test.each([
    ...NOT_A_VOLUME,
    ["undefined - an app older than the choice", undefined],
    ["null", null],
  ] as Array<[string, unknown]>)(
    "reads %s as not given, without refusing the registration",
    (_label: string, raw: unknown) => {
      /*
       * Not clamped either: a registration that sent 0 has not chosen the
       * floor, it has sent something this server does not understand.
       */
      expect(parseCriticalAlertVolumeFromRegistration(raw)).toBeUndefined();
    },
  );
});

describe("parseCriticalAlertSoundStrict - the preferences route", () => {
  test.each(
    SOUND_IDS.map((sound: string): [string] => {
      return [sound];
    }),
  )("accepts %s", (sound: string) => {
    expect(parseCriticalAlertSoundStrict(sound)).toBe(sound);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
  ])("reads %s as keep what is stored", (_label: string, raw: unknown) => {
    expect(parseCriticalAlertSoundStrict(raw)).toBeUndefined();
  });

  test.each(NOT_A_SOUND)(
    "refuses %s, naming the sounds there are",
    (_label: string, raw: unknown) => {
      expect(() => {
        return parseCriticalAlertSoundStrict(raw);
      }).toThrow(new BadDataException(SOUND_REFUSAL));
    },
  );

  test("the refusal is a BadDataException, which the API answers with 400", () => {
    expect(() => {
      return parseCriticalAlertSoundStrict("foghorn");
    }).toThrow(BadDataException);
  });

  test("the refusal lists every sound, in the order the app shows them", () => {
    // Spelled out, so the message cannot drift along with the list it is built from.
    expect(() => {
      return parseCriticalAlertSoundStrict("foghorn");
    }).toThrow(
      new BadDataException(
        "sound must be one of: default, klaxon, siren, digital, smoke_alarm, rising.",
      ),
    );
  });

  test("an empty string is a malformed choice, not an absent one", () => {
    /*
     * Read as absent it would turn a request that said nothing useful into
     * "keep what is stored" - fine on its own, but paired with a volume it
     * would quietly drop half of what the caller meant.
     */
    expect(() => {
      return parseCriticalAlertSoundStrict("");
    }).toThrow(SOUND_REFUSAL);
  });
});

describe("parseCriticalAlertVolumeStrict - the preferences route", () => {
  test("accepts every whole percentage from 10 to 100, not only the app's steps", () => {
    for (let volume: number = 10; volume <= 100; volume++) {
      expect(parseCriticalAlertVolumeStrict(volume)).toBe(volume);
    }
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
  ])("reads %s as keep what is stored", (_label: string, raw: unknown) => {
    expect(parseCriticalAlertVolumeStrict(raw)).toBeUndefined();
  });

  test.each(NOT_A_VOLUME)(
    "refuses %s, naming the range",
    (_label: string, raw: unknown) => {
      expect(() => {
        return parseCriticalAlertVolumeStrict(raw);
      }).toThrow(new BadDataException(VOLUME_REFUSAL));
    },
  );

  test("0 is refused, never read as absent and never clamped to the floor", () => {
    /*
     * 0 is falsy. A guard written `if (!volume)` would read it as "keep what
     * is stored" and tell the caller it saved; clamping would store 10 for a
     * request that asked for silence. Either way the screen and the pages
     * disagree.
     */
    expect(() => {
      return parseCriticalAlertVolumeStrict(0);
    }).toThrow(BadDataException);
  });
});

describe("POST /user-push/critical-alert-preferences", () => {
  const URI: string = "/user-push/critical-alert-preferences";

  let setPreferences: SpyInstance<
    typeof UserPushService.setCriticalAlertPreferencesForDeviceToken
  >;

  beforeEach(() => {
    setPreferences = jest
      .spyOn(UserPushService, "setCriticalAlertPreferencesForDeviceToken")
      .mockResolvedValue(2);
  });

  function given(): Parameters<
    typeof UserPushService.setCriticalAlertPreferencesForDeviceToken
  >[0] {
    expect(setPreferences).toHaveBeenCalledTimes(1);
    return setPreferences.mock.calls[0]![0];
  }

  test("is mounted behind the user middleware", () => {
    expect(mockRouter.match("POST", URI).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("a sound alone is saved on the caller's handset, and the answer says what was saved", async () => {
    const answer: Answer = await call(
      URI,
      signedIn({ deviceToken: PHONE_TOKEN, sound: CriticalAlertSound.Klaxon }),
    );

    expect(answer).toEqual({
      json: {
        success: true,
        criticalAlertSound: CriticalAlertSound.Klaxon,
        devicesUpdated: 2,
      },
    });

    const preferences: Parameters<
      typeof UserPushService.setCriticalAlertPreferencesForDeviceToken
    >[0] = given();

    expect(preferences.userId.toString()).toBe(USER_ID.toString());
    expect(preferences.deviceToken).toBe(PHONE_TOKEN);
    expect(preferences.sound).toBe(CriticalAlertSound.Klaxon);
    expect(preferences.volumePercent).toBeUndefined();
  });

  test("a volume alone is saved, and the stored sound kept", async () => {
    const answer: Answer = await call(
      URI,
      signedIn({ deviceToken: PHONE_TOKEN, volume: 50 }),
    );

    expect(answer).toEqual({
      json: { success: true, criticalAlertVolume: 50, devicesUpdated: 2 },
    });
    expect(given().sound).toBeUndefined();
    expect(given().volumePercent).toBe(50);
  });

  test("both at once are saved together", async () => {
    const answer: Answer = await call(
      URI,
      signedIn({
        deviceToken: PHONE_TOKEN,
        sound: CriticalAlertSound.Rising,
        volume: 25,
      }),
    );

    expect(answer).toEqual({
      json: {
        success: true,
        criticalAlertSound: CriticalAlertSound.Rising,
        criticalAlertVolume: 25,
        devicesUpdated: 2,
      },
    });
    expect(given()).toMatchObject({
      deviceToken: PHONE_TOKEN,
      sound: CriticalAlertSound.Rising,
      volumePercent: 25,
    });
  });

  test.each(
    SOUND_IDS.map((sound: string): [string] => {
      return [sound];
    }),
  )("%s is passed on exactly as chosen", async (sound: string) => {
    await call(URI, signedIn({ deviceToken: PHONE_TOKEN, sound: sound }));

    expect(given().sound).toBe(sound);
  });

  test.each(
    [10, 33, ...CRITICAL_ALERT_VOLUME_OPTIONS].map(
      (volume: number): [number] => {
        return [volume];
      },
    ),
  )("%s%% is passed on exactly as chosen", async (volume: number) => {
    await call(URI, signedIn({ deviceToken: PHONE_TOKEN, volume: volume }));

    expect(given().volumePercent).toBe(volume);
  });

  test("null is read as keep what is stored, beside a value that is given", async () => {
    await call(
      URI,
      signedIn({
        deviceToken: PHONE_TOKEN,
        sound: null,
        volume: 75,
      }),
    );

    expect(given().sound).toBeUndefined();
    expect(given().volumePercent).toBe(75);
  });

  test("the handset is the authenticated caller's, whatever the body claims", async () => {
    await call(
      URI,
      signedIn({
        deviceToken: PHONE_TOKEN,
        sound: CriticalAlertSound.Siren,
        userId: "7f000000-0000-4000-8000-000000000899",
      }),
    );

    expect(given().userId.toString()).toBe(USER_ID.toString());
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
  ])(
    "a device token that is %s is refused, and nothing is saved",
    async (_label: string, deviceToken: unknown) => {
      const answer: Answer = await call(
        URI,
        signedIn({
          deviceToken: deviceToken as never,
          sound: CriticalAlertSound.Siren,
        }),
      );

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe("Device token is required");
      expect(setPreferences).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["neither", {}],
    ["both null", { sound: null, volume: null }],
    ["other fields only", { isEnabled: true }],
  ])(
    "a request that gives %s is refused, and nothing is saved",
    async (_label: string, fields: JSONObject) => {
      const answer: Answer = await call(
        URI,
        signedIn({ deviceToken: PHONE_TOKEN, ...fields }),
      );

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe(NOTHING_TO_SET);
      expect(setPreferences).not.toHaveBeenCalled();
    },
  );

  test.each(NOT_A_SOUND)(
    "a sound that is %s is refused by name, never saved as the default",
    async (_label: string, sound: unknown) => {
      const answer: Answer = await call(
        URI,
        signedIn({ deviceToken: PHONE_TOKEN, sound: sound as never }),
      );

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe(SOUND_REFUSAL);
      expect(setPreferences).not.toHaveBeenCalled();
    },
  );

  test.each(NOT_A_VOLUME)(
    "a volume that is %s is refused by name, never clamped and saved",
    async (_label: string, volume: unknown) => {
      const answer: Answer = await call(
        URI,
        signedIn({ deviceToken: PHONE_TOKEN, volume: volume as never }),
      );

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe(VOLUME_REFUSAL);
      expect(setPreferences).not.toHaveBeenCalled();
    },
  );

  test("a good volume beside a bad sound is refused as a whole: half a choice is not saved", async () => {
    /*
     * Saving the volume alone would answer the app with a success it reads
     * as "both saved", and the screen would show a sound the pages never
     * play.
     */
    const answer: Answer = await call(
      URI,
      signedIn({ deviceToken: PHONE_TOKEN, sound: "foghorn", volume: 50 }),
    );

    expect(answer).toBeInstanceOf(BadDataException);
    expect(setPreferences).not.toHaveBeenCalled();
  });

  test("a good sound beside a bad volume is refused as a whole", async () => {
    const answer: Answer = await call(
      URI,
      signedIn({
        deviceToken: PHONE_TOKEN,
        sound: CriticalAlertSound.Klaxon,
        volume: 0,
      }),
    );

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe(VOLUME_REFUSAL);
    expect(setPreferences).not.toHaveBeenCalled();
  });

  test("a handset with no device here is told so, in the service's words", async () => {
    setPreferences.mockRejectedValue(
      new BadDataException(
        "No registered device was found for this device token.",
      ),
    );

    const answer: Answer = await call(
      URI,
      signedIn({ deviceToken: PHONE_TOKEN, sound: CriticalAlertSound.Siren }),
    );

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe(
      "No registered device was found for this device token.",
    );
  });

  test("a browser's token is told critical alerts are for phones", async () => {
    setPreferences.mockRejectedValue(
      new BadDataException(
        "Critical alerts are only available on iOS and Android devices.",
      ),
    );

    const answer: Answer = await call(
      URI,
      signedIn({ deviceToken: "web-subscription", volume: 50 }),
    );

    expect((answer as Error).message).toBe(
      "Critical alerts are only available on iOS and Android devices.",
    );
  });

  test("somebody who is not signed in is refused before anything is saved", async () => {
    const request: OneUptimeRequest = signedIn({
      deviceToken: PHONE_TOKEN,
      sound: CriticalAlertSound.Siren,
    });
    delete (request as unknown as { userAuthorization?: unknown })
      .userAuthorization;

    const answer: Answer = await call(URI, request);

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(setPreferences).not.toHaveBeenCalled();
  });

  test("the answer reports how many devices took the choice, as the service counted them", async () => {
    setPreferences.mockResolvedValue(3);

    const answer: Answer = await call(
      URI,
      signedIn({ deviceToken: PHONE_TOKEN, volume: 100 }),
    );

    expect((answer as { json: JSONObject }).json["devicesUpdated"]).toBe(3);
  });
});

describe("POST /user-push/register with an alarm and volume", () => {
  const URI: string = "/user-push/register";

  let lookup: SpyInstance<typeof UserPushService.findOneBy>;
  let create: SpyInstance<typeof UserPushService.create>;
  let renew: SpyInstance<typeof UserPushService.renewExpoPushDevice>;

  beforeEach(() => {
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          return new Set<string>(
            data.userIds.map((userId: ObjectID | string): string => {
              return userId.toString();
            }),
          );
        },
      );

    jest
      .spyOn(ExpoPushReceiptQueue, "noteTokenRegistered")
      .mockResolvedValue(undefined);

    lookup = jest.spyOn(UserPushService, "findOneBy").mockResolvedValue(null);

    create = jest
      .spyOn(UserPushService, "create")
      .mockImplementation((async (data: { data: UserPush }) => {
        return {
          ...data.data,
          _id: NEW_DEVICE_ID.toString(),
          id: NEW_DEVICE_ID,
        };
      }) as never);

    renew = jest
      .spyOn(UserPushService, "renewExpoPushDevice")
      .mockResolvedValue(null);

    jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined as never);
  });

  function phone(extra: JSONObject = {}): JSONObject {
    // As the mobile app sends it (MobileApp/src/api/pushDevice.ts).
    return {
      deviceToken: PHONE_TOKEN,
      deviceType: PushDeviceType.iOS,
      deviceName: "iPhone 16",
      projectId: PROJECT_ID.toString(),
      isCriticalAlertEnabled: true,
      ...extra,
    };
  }

  function created(): UserPush {
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0]![0].data as UserPush;
  }

  test("a new device stores the alarm and volume the phone chose", async () => {
    const answer: Answer = await call(
      URI,
      signedIn(
        phone({
          criticalAlertSound: CriticalAlertSound.SmokeAlarm,
          criticalAlertVolume: 75,
        }),
      ),
    );

    expect((answer as { json: JSONObject }).json["alreadyRegistered"]).toBe(
      false,
    );
    expect(created().criticalAlertSound).toBe(CriticalAlertSound.SmokeAlarm);
    expect(created().criticalAlertVolume).toBe(75);
    expect(created().isCriticalAlertEnabled).toBe(true);
  });

  test.each(
    SOUND_IDS.map((sound: string): [string] => {
      return [sound];
    }),
  )("a new device that chose %s stores it", async (sound: string) => {
    await call(URI, signedIn(phone({ criticalAlertSound: sound })));

    expect(created().criticalAlertSound).toBe(sound);
  });

  test.each(
    CRITICAL_ALERT_VOLUME_OPTIONS.map((volume: number): [number] => {
      return [volume];
    }),
  )("a new device set to %s%% stores it", async (volume: number) => {
    await call(URI, signedIn(phone({ criticalAlertVolume: volume })));

    expect(created().criticalAlertVolume).toBe(volume);
  });

  test("a phone that does not say leaves both to the column defaults", async () => {
    /*
     * An app older than the choice. Nothing is written, so the database's
     * default - the system sound at full volume - is what the device gets.
     */
    await call(URI, signedIn(phone()));

    expect(created().criticalAlertSound).toBeUndefined();
    expect(created().criticalAlertVolume).toBeUndefined();
  });

  test.each(NOT_A_SOUND)(
    "a sound that is %s is ignored - the phone is still registered, with the default",
    async (_label: string, sound: unknown) => {
      const answer: Answer = await call(
        URI,
        signedIn(phone({ criticalAlertSound: sound as never })),
      );

      expect(answer).not.toBeInstanceOf(Error);
      expect(created().criticalAlertSound).toBeUndefined();
    },
  );

  test.each(NOT_A_VOLUME)(
    "a volume that is %s is ignored - the phone is still registered, at full volume",
    async (_label: string, volume: unknown) => {
      const answer: Answer = await call(
        URI,
        signedIn(phone({ criticalAlertVolume: volume as never })),
      );

      expect(answer).not.toBeInstanceOf(Error);
      expect(created().criticalAlertVolume).toBeUndefined();
    },
  );

  test("a junk sound does not cost the good volume beside it", async () => {
    await call(
      URI,
      signedIn(
        phone({ criticalAlertSound: "foghorn", criticalAlertVolume: 25 }),
      ),
    );

    expect(created().criticalAlertSound).toBeUndefined();
    expect(created().criticalAlertVolume).toBe(25);
  });

  test("a phone already registered here is answered as before: nothing is created, and its alarm is not written", async () => {
    lookup.mockResolvedValue({
      _id: EXISTING_DEVICE_ID.toString(),
      id: EXISTING_DEVICE_ID,
      isVerified: true,
      deviceType: PushDeviceType.iOS,
      isCriticalAlertEnabled: true,
      criticalAlertSound: CriticalAlertSound.Default,
      criticalAlertVolume: 100,
    } as never);

    const update: SpyInstance<typeof UserPushService.updateOneBy> = jest
      .spyOn(UserPushService, "updateOneBy")
      .mockResolvedValue(1);

    const answer: Answer = await call(
      URI,
      signedIn(phone({ criticalAlertSound: CriticalAlertSound.Siren })),
    );

    expect((answer as { json: JSONObject }).json["alreadyRegistered"]).toBe(
      true,
    );
    expect(create).not.toHaveBeenCalled();

    /*
     * A device the phone already has keeps its alarm: the preferences route
     * changes it (UserPushRegistrationRestatesCriticalAlerts.test.ts).
     */
    expect(update).not.toHaveBeenCalled();
  });

  describe("a phone with a new token that says which it had before", () => {
    function renewed(): Parameters<
      typeof UserPushService.renewExpoPushDevice
    >[0] {
      expect(renew).toHaveBeenCalledTimes(1);
      return renew.mock.calls[0]![0];
    }

    beforeEach(() => {
      renew.mockResolvedValue({
        _id: EXISTING_DEVICE_ID.toString(),
        id: EXISTING_DEVICE_ID,
      } as never);
    });

    test("the device it carries on with gets the alarm and volume the phone has now", async () => {
      const answer: Answer = await call(
        URI,
        signedIn(
          phone({
            previousDeviceToken: OLD_PHONE_TOKEN,
            criticalAlertSound: CriticalAlertSound.Digital,
            criticalAlertVolume: 50,
          }),
        ),
      );

      expect((answer as { json: JSONObject }).json["deviceId"]).toBe(
        EXISTING_DEVICE_ID.toString(),
      );
      expect(renewed().criticalAlertSound).toBe(CriticalAlertSound.Digital);
      expect(renewed().criticalAlertVolume).toBe(50);
      expect(create).not.toHaveBeenCalled();
    });

    test("a phone that does not say passes neither, so the device keeps what it had", async () => {
      await call(
        URI,
        signedIn(phone({ previousDeviceToken: OLD_PHONE_TOKEN })),
      );

      expect(renewed().criticalAlertSound).toBeUndefined();
      expect(renewed().criticalAlertVolume).toBeUndefined();
    });

    test("junk is passed as not given, so it never overwrites the device's choice", async () => {
      await call(
        URI,
        signedIn(
          phone({
            previousDeviceToken: OLD_PHONE_TOKEN,
            criticalAlertSound: "KLAXON",
            criticalAlertVolume: 0,
          }),
        ),
      );

      expect(renewed().criticalAlertSound).toBeUndefined();
      expect(renewed().criticalAlertVolume).toBeUndefined();
    });

    test("nothing to renew: the new device stores the choice instead", async () => {
      renew.mockResolvedValue(null);

      await call(
        URI,
        signedIn(
          phone({
            previousDeviceToken: OLD_PHONE_TOKEN,
            criticalAlertSound: CriticalAlertSound.Klaxon,
            criticalAlertVolume: 25,
          }),
        ),
      );

      expect(renewed().criticalAlertSound).toBe(CriticalAlertSound.Klaxon);
      expect(created().criticalAlertSound).toBe(CriticalAlertSound.Klaxon);
      expect(created().criticalAlertVolume).toBe(25);
    });
  });
});

describe("POST /user-push/:deviceId/test-notification plays the device's alarm", () => {
  const URI: string = "/user-push/:deviceId/test-notification";

  let device: Record<string, unknown>;
  let selects: Array<Record<string, unknown>>;

  beforeEach(() => {
    selects = [];

    device = {
      _id: EXISTING_DEVICE_ID.toString(),
      userId: USER_ID,
      projectId: PROJECT_ID,
      deviceName: "iPhone 16",
      deviceToken: PHONE_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
      isCriticalAlertEnabled: true,
      criticalAlertSound: CriticalAlertSound.Siren,
      criticalAlertVolume: 50,
    };

    jest.spyOn(TestSendAccess, "assertMaySendTestToSelf").mockResolvedValue({
      props: {
        userId: USER_ID,
        userGlobalAccessPermission: { projectIds: [PROJECT_ID] },
      },
      userId: USER_ID,
    } as never);

    jest
      .spyOn(UserPushService, "findOneById")
      .mockImplementation((async (findBy: {
        select: Record<string, unknown>;
      }) => {
        selects.push(findBy.select);
        return device;
      }) as never);

    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);

    jest.spyOn(ExpoPushReceiptQueue, "add").mockResolvedValue(0 as never);
  });

  function testRequest(): OneUptimeRequest {
    return signedIn({}, { deviceId: EXISTING_DEVICE_ID.toString() });
  }

  test("reads the device's alarm and volume along with its switch", async () => {
    jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined);

    await call(URI, testRequest());

    expect(selects[0]).toMatchObject({
      isCriticalAlertEnabled: true,
      criticalAlertSound: true,
      criticalAlertVolume: true,
    });
  });

  test.each(
    CRITICAL_ALERT_SOUNDS.map(
      (
        definition: CriticalAlertSoundDefinition,
      ): [string, CriticalAlertSoundDefinition] => {
        return [definition.sound, definition];
      },
    ),
  )(
    "a device that chose %s gets a test with that alarm and its volume",
    async (_sound: string, definition: CriticalAlertSoundDefinition) => {
      const send: SpyInstance<
        typeof PushNotificationService.sendPushNotification
      > = jest
        .spyOn(PushNotificationService, "sendPushNotification")
        .mockResolvedValue(undefined);

      device["criticalAlertSound"] = definition.sound;

      const answer: Answer = await call(URI, testRequest());

      expect(answer).toEqual({
        json: {
          success: true,
          message: "Test notification sent successfully",
          isCriticalAlert: true,
        },
      });

      const request: PushNotificationRequest = send.mock.calls[0]![0];

      expect(request.message.isCriticalAlert).toBe(true);
      expect(request.message.criticalAlertSound).toBe(definition.sound);
      expect(request.message.criticalAlertVolume).toBe(50);
    },
  );

  test("the test that reaches Expo rings exactly as a real page would", async () => {
    /*
     * End to end through the real sender: the file, the volume and the
     * critical interruption level all reach Expo.
     */
    const sentToExpo: Array<ExpoPushMessage> = [];

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);
    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async (
        messages: Array<ExpoPushMessage>,
      ): Promise<Array<ExpoPushTicket>> => {
        sentToExpo.push(...messages);
        return [{ status: "ok", id: "4c1e7a2b-9d3f-4e5a-8b6c-7d8e9f0a1b2c" }];
      }) as never);

    device["criticalAlertSound"] = CriticalAlertSound.Klaxon;
    device["criticalAlertVolume"] = 25;

    await call(URI, testRequest());

    expect(sentToExpo).toHaveLength(1);
    expect(sentToExpo[0]?.sound).toEqual({
      critical: true,
      name: "oneuptime_klaxon.wav",
      volume: 0.25,
    });
    expect(sentToExpo[0]?.interruptionLevel).toBe("critical");
  });

  test("an Android device's test goes on its sound's channel", async () => {
    const sentToExpo: Array<ExpoPushMessage> = [];

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);
    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async (
        messages: Array<ExpoPushMessage>,
      ): Promise<Array<ExpoPushTicket>> => {
        sentToExpo.push(...messages);
        return [{ status: "ok", id: "4c1e7a2b-9d3f-4e5a-8b6c-7d8e9f0a1b2d" }];
      }) as never);

    device["deviceType"] = PushDeviceType.Android;
    device["criticalAlertSound"] = CriticalAlertSound.SmokeAlarm;

    await call(URI, testRequest());

    expect(sentToExpo[0]?.channelId).toBe("oncall_critical_smoke_alarm");
  });

  test("a device with critical alerts off gets an ordinary test, whatever alarm it chose", async () => {
    const send: SpyInstance<
      typeof PushNotificationService.sendPushNotification
    > = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined);

    device["isCriticalAlertEnabled"] = false;
    device["criticalAlertSound"] = CriticalAlertSound.Klaxon;

    await call(URI, testRequest());

    const request: PushNotificationRequest = send.mock.calls[0]![0];

    expect(request.message.isCriticalAlert).toBe(false);
    expect(
      PushNotificationService.getExpoDeliveryOptions(
        request.message,
        PushDeviceType.iOS,
      ).sound,
    ).toBe("default");
  });

  test("a device that never chose gets the system sound at full volume", async () => {
    const send: SpyInstance<
      typeof PushNotificationService.sendPushNotification
    > = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined);

    delete device["criticalAlertSound"];
    delete device["criticalAlertVolume"];

    await call(URI, testRequest());

    expect(
      PushNotificationService.getExpoDeliveryOptions(
        send.mock.calls[0]![0].message,
        PushDeviceType.iOS,
      ).sound,
    ).toEqual({ critical: true, name: "default", volume: 1 });
  });
});
