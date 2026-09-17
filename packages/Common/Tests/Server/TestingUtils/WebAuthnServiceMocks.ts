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
