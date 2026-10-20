import type PushNotificationService from "../../Server/Services/PushNotificationService";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import webpush from "web-push";

jest.mock("../../Server/Utils/Logger");

/*
 * VAPID_PRIVATE_KEY signs every web push. On Kubernetes it can come from a
 * Secret the operator manages (the chart's vapid.existingSecret), and a
 * Secret created from a file - kubectl create secret generic --from-file -
 * keeps the file's last newline. web-push refuses a key with anything around
 * it ('Vapid private key must be a URL safe Base 64'), so every web push
 * failed. The server reads the key trimmed; a key with nothing around it is
 * read as it always was.
 *
 * EnvironmentConfig reads process.env at module load, so each case sets the
 * environment, resets the module registry and imports afresh.
 */

interface EnvironmentConfigShape {
  VapidPrivateKey: string | undefined;
}

const VARIABLES: Array<string> = [
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
];

const SUBJECT: string = "mailto:oncall@example.com";

/*
 * The first import of the push service compiles everything it imports: half a
 * minute or more with nothing cached, so it happens in a hook with time of its
 * own rather than inside a test.
 */
const PUSH_SERVICE_IMPORT_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

// A real key pair, as `npx web-push generate-vapid-keys` makes one.
const KEYS: webpush.VapidKeys = webpush.generateVAPIDKeys();

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

function setEnvironment(values: Record<string, string | undefined>): void {
  for (const variable of VARIABLES) {
    delete process.env[variable];
  }

  for (const [variable, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[variable] = value;
    }
  }

  jest.resetModules();
}

async function privateKeyReadFrom(
  value: string | undefined,
): Promise<string | undefined> {
  setEnvironment({ VAPID_PRIVATE_KEY: value });

  const config: EnvironmentConfigShape = (await import(
    "../../Server/EnvironmentConfig"
  )) as unknown as EnvironmentConfigShape;

  return config.VapidPrivateKey;
}

/*
 * The push service, imported afresh in an environment: it reads the keys as
 * EnvironmentConfig read them when it was loaded.
 */
async function pushServiceIn(
  values: Record<string, string | undefined>,
): Promise<typeof PushNotificationService> {
  setEnvironment(values);

  const service: typeof PushNotificationService = (
    (await import("../../Server/Services/PushNotificationService")) as {
      default: typeof PushNotificationService;
    }
  ).default;

  service.isWebPushInitialized = false;

  return service;
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("VAPID_PRIVATE_KEY, as the server reads it", () => {
  it("is the key as written when nothing is around it", async () => {
    expect(await privateKeyReadFrom(KEYS.privateKey)).toBe(KEYS.privateKey);
  });

  it("drops the newline a Secret created from a file keeps", async () => {
    expect(await privateKeyReadFrom(`${KEYS.privateKey}\n`)).toBe(
      KEYS.privateKey,
    );
    expect(await privateKeyReadFrom(`${KEYS.privateKey}\r\n`)).toBe(
      KEYS.privateKey,
    );
  });

  it("drops spaces and tabs around the key", async () => {
    expect(await privateKeyReadFrom(`  ${KEYS.privateKey}\t `)).toBe(
      KEYS.privateKey,
    );
  });

  it("is unset when the variable is empty or only whitespace, as with no key at all", async () => {
    for (const value of ["", " ", "\n", "\r\n", "\t \n"]) {
      expect({ value, read: await privateKeyReadFrom(value) }).toEqual({
        value,
        read: undefined,
      });
    }
  });

  it("is unset when the variable is not set", async () => {
    expect(await privateKeyReadFrom(undefined)).toBeUndefined();
  });

  it("keeps every character of the key itself", async () => {
    // A key's base64url alphabet includes - and _; trimming touches neither.
    const key: string = `-${KEYS.privateKey.slice(1, -1)}_`;

    expect(await privateKeyReadFrom(`${key}\n`)).toBe(key);
  });
});

describe("web-push, with the key from a Secret created from a file", () => {
  it("refuses the key with the file's newline still on it", () => {
    expect(() => {
      webpush.setVapidDetails(
        SUBJECT,
        KEYS.publicKey,
        `${KEYS.privateKey}\n`,
      );
    }).toThrow("Vapid private key must be a URL safe Base 64");
  });

  it("takes the key as the server reads it", async () => {
    const key: string | undefined = await privateKeyReadFrom(
      `${KEYS.privateKey}\n`,
    );

    expect(() => {
      webpush.setVapidDetails(SUBJECT, KEYS.publicKey, key as string);
    }).not.toThrow();
  });
});

describe("the push service, with the key from a Secret created from a file", () => {
  let service: typeof PushNotificationService;

  beforeAll(async () => {
    service = await pushServiceIn({
      VAPID_PRIVATE_KEY: `${KEYS.privateKey}\n`,
      VAPID_PUBLIC_KEY: KEYS.publicKey,
      VAPID_SUBJECT: SUBJECT,
    });
  }, PUSH_SERVICE_IMPORT_TIMEOUT_IN_MS);

  it("sets web push up, where it refused the key before", () => {
    expect(() => {
      service.initializeWebPush();
    }).not.toThrow();
    expect(service.isWebPushInitialized).toBe(true);
  });
});

describe("the push service, with a Secret that holds only a newline", () => {
  let service: typeof PushNotificationService;

  beforeAll(async () => {
    service = await pushServiceIn({
      VAPID_PRIVATE_KEY: "\n",
      VAPID_PUBLIC_KEY: KEYS.publicKey,
      VAPID_SUBJECT: SUBJECT,
    });
  }, PUSH_SERVICE_IMPORT_TIMEOUT_IN_MS);

  it("leaves web push off, as with no key at all", () => {
    expect(() => {
      service.initializeWebPush();
    }).not.toThrow();
    expect(service.isWebPushInitialized).toBe(false);
  });
});
