/*
 * Passkey service tests exercise the real model conversion and WebAuthn
 * ceremonies. Persistence and tracing are boundaries, so stub them before
 * importing the service instead of loading the entire server service graph.
 */
jest.mock("../../../Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class {
      public findBy: jest.Mock = jest.fn();
      public findOneBy: jest.Mock = jest.fn();
      public findOneById: jest.Mock = jest.fn();
      public create: jest.Mock = jest.fn();
      public updateOneById: jest.Mock = jest.fn();
    },
  };
});

jest.mock("../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

/*
 * Whether a person's sign-in is managed by single sign-on (#9688): it reads
 * the server's rule through services this file keeps out, and has a suite of
 * its own (Tests/Server/Utils/SsoManagedSignIn.test.ts). Here it lets
 * everyone through, unless a test says otherwise.
 */
jest.mock("../../../Server/Utils/SsoManagedSignIn", () => {
  return {
    __esModule: true,
    default: {
      assertMayChangeLocalSignIn: jest.fn(async (): Promise<void> => {
        return undefined;
      }),
      isManagedBySso: jest.fn(async (): Promise<boolean> => {
        return false;
      }),
      isManagedBySsoFor: jest.fn(async (): Promise<boolean> => {
        return false;
      }),
    },
  };
});

/*
 * Whether the session adding or removing a key has confirmed it's its
 * person's (#10155): it reads the session and the account through services
 * this file keeps out, and is pinned by Tests/Server/Utils/Reauthentication
 * and ReauthenticationGates.test.ts. Here every session has confirmed,
 * unless a test says otherwise.
 */
jest.mock("../../../Server/Utils/Reauthentication/Reauthentication", () => {
  return {
    __esModule: true,
    default: {
      assertConfirmed: jest.fn(async (): Promise<void> => {
        return undefined;
      }),
    },
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ) => {
        return descriptor;
      };
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn() },
  };
});
