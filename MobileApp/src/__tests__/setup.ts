/*
 * Shared test setup.
 *
 * expo-notifications, expo-device and AsyncStorage are native modules with no
 * JS implementation off-device, so every suite that touches the notification
 * code needs them mocked. They are mocked HERE rather than per-file so that
 * the shape each test asserts against is the same one, and so a future test
 * cannot accidentally assert against a subtly different fake.
 */

/*
 * The enums are values, not types, so the mock has to carry the real numbers -
 * a test that asserts "importance is MAX" against a fake where MAX is
 * undefined passes for the wrong reason.
 */
jest.mock("expo-notifications", () => {
  return {
    AndroidImportance: {
      UNKNOWN: 0,
      UNSPECIFIED: 1,
      NONE: 2,
      MIN: 3,
      LOW: 4,
      DEFAULT: 5,
      HIGH: 6,
      MAX: 7,
    },
    AndroidNotificationVisibility: {
      UNKNOWN: 0,
      PUBLIC: 1,
      PRIVATE: 2,
      SECRET: 3,
    },
    AndroidAudioUsage: {
      UNKNOWN: 0,
      MEDIA: 1,
      VOICE_COMMUNICATION: 2,
      VOICE_COMMUNICATION_SIGNALLING: 3,
      ALARM: 4,
      NOTIFICATION: 5,
      NOTIFICATION_RINGTONE: 6,
      NOTIFICATION_COMMUNICATION_REQUEST: 7,
      NOTIFICATION_COMMUNICATION_INSTANT: 8,
      NOTIFICATION_COMMUNICATION_DELAYED: 9,
      NOTIFICATION_EVENT: 10,
      ASSISTANCE_ACCESSIBILITY: 11,
      ASSISTANCE_NAVIGATION_GUIDANCE: 12,
      ASSISTANCE_SONIFICATION: 13,
      GAME: 14,
    },
    AndroidAudioContentType: {
      UNKNOWN: 0,
      SPEECH: 1,
      MUSIC: 2,
      MOVIE: 3,
      SONIFICATION: 4,
    },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => {
      return null;
    }),
    getNotificationChannelAsync: jest.fn(async () => {
      return null;
    }),
    setNotificationCategoryAsync: jest.fn(async () => {
      return null;
    }),
    getPermissionsAsync: jest.fn(async () => {
      return { status: "granted", ios: {} };
    }),
    requestPermissionsAsync: jest.fn(async () => {
      return { status: "granted", ios: {} };
    }),
    getExpoPushTokenAsync: jest.fn(async () => {
      return { data: "ExponentPushToken[test]" };
    }),
    addNotificationReceivedListener: jest.fn(() => {
      return { remove: jest.fn() };
    }),
    addNotificationResponseReceivedListener: jest.fn(() => {
      return { remove: jest.fn() };
    }),
    getLastNotificationResponseAsync: jest.fn(async () => {
      return null;
    }),
  };
});

jest.mock("expo-device", () => {
  return {
    isDevice: true,
    modelName: "iPhone Test",
  };
});

jest.mock("expo-constants", () => {
  return {
    __esModule: true,
    default: {
      expoConfig: { extra: { eas: { projectId: "test-project" } } },
      easConfig: { projectId: "test-project" },
    },
  };
});

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Map<string, string> = new Map<string, string>();

  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => {
        return store.has(key) ? store.get(key) : null;
      }),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
      __store: store,
    },
  };
});

/*
 * Keep test output readable; the code under test logs on every warning path,
 * and several suites deliberately drive those paths.
 *
 * Re-applied per test rather than once per file, because suites that call
 * jest.restoreAllMocks() in afterEach would otherwise un-silence the console
 * for every test after their first.
 */
beforeEach(() => {
  jest.spyOn(console, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(console, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(console, "error").mockImplementation((): void => {
    return undefined;
  });
});
