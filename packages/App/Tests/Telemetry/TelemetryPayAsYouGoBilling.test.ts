import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import * as grpc from "@grpc/grpc-js";
import { Client, PublishPacket, AuthenticateError } from "aedes";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import IoTDeviceCredentialService from "Common/Server/Services/IoTDeviceCredentialService";
import { handleExport } from "../../FeatureSet/Telemetry/GrpcServer";
import { startMqttServer } from "../../FeatureSet/Telemetry/MqttServer";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: { getPolicyFromSecretKey: jest.fn() },
  };
});

jest.mock("Common/Server/Services/PayAsYouGoBillingService", () => {
  return {
    __esModule: true,
    default: { requirePayAsYouGo: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: { getCredentialContext: jest.fn(), markConnected: jest.fn() },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      isDisabled: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return { __esModule: true, default: { addMetricIngestJob: jest.fn() } };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Config", () => {
  return {
    MQTT_INGEST_ENABLED: true,
    MQTT_INGEST_PORT: 1883,
    MQTT_WEBSOCKET_PATH: "/mqtt",
  };
});

jest.mock("aedes", () => {
  const broker: Record<string, unknown> = { on: jest.fn() };
  return {
    __esModule: true,
    Aedes: {
      createBroker: async (): Promise<Record<string, unknown>> => {
        return broker;
      },
    },
    __broker: broker,
  };
});

jest.mock("net", () => {
  return {
    ...(jest.requireActual("net") as Record<string, unknown>),
    createServer: (): Record<string, unknown> => {
      return { on: jest.fn(), listen: jest.fn() };
    },
  };
});

type MockFn = jest.Mock;
const projectId: ObjectID = ObjectID.generate();
const paymentError: PaymentRequiredException = new PaymentRequiredException(
  "Add a payment method in Project Settings > Billing before sending telemetry.",
);

beforeEach(() => {
  jest.clearAllMocks();
  (PayAsYouGoBillingService.requirePayAsYouGo as MockFn).mockResolvedValue(
    undefined,
  );
  (IoTDeviceCredentialService.getCredentialContext as MockFn).mockResolvedValue(
    null,
  );
  (IoTDeviceCredentialService.markConnected as MockFn).mockResolvedValue(
    undefined,
  );
  (MetricsQueueService.addMetricIngestJob as MockFn).mockResolvedValue(
    undefined,
  );
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
  ).mockResolvedValue({
    ingestionKeyId: ObjectID.generate(),
    projectId,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
  });
});

describe("gRPC payment refusal", () => {
  test.each([
    ProductType.Logs,
    ProductType.Metrics,
    ProductType.Traces,
    ProductType.Profiles,
  ])(
    "returns a useful nonretryable refusal without queueing %s",
    async (productType: ProductType) => {
      (
        TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
      ).mockRejectedValue(paymentError);
      const metadata: grpc.Metadata = new grpc.Metadata();
      metadata.set("x-oneuptime-token", ObjectID.generate().toString());
      const callback: MockFn = jest.fn();
      const queue: MockFn = jest.fn();
      await handleExport(
        { request: {}, metadata },
        callback,
        productType,
        queue,
      );
      expect(queue).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: grpc.status.PERMISSION_DENIED,
          details: paymentError.message,
        }),
      );
    },
  );

  test("continues to queue an authorized project", async () => {
    const metadata: grpc.Metadata = new grpc.Metadata();
    metadata.set("x-oneuptime-token", ObjectID.generate().toString());
    const callback: MockFn = jest.fn();
    const queue: MockFn = jest.fn().mockResolvedValue(undefined);
    await handleExport(
      { request: {}, metadata },
      callback,
      ProductType.Logs,
      queue,
    );
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ projectId }));
    expect(callback).toHaveBeenCalledWith(null, {});
  });
});

interface TestBroker {
  authenticate: (
    client: Client,
    username: string | undefined,
    password: Buffer,
    done: (error: AuthenticateError | null, success: boolean | null) => void,
  ) => void;
  authorizePublish: (
    client: Client | null,
    packet: PublishPacket,
    callback: (error?: Error | null) => void,
  ) => void;
}
let broker: TestBroker;

beforeAll(async () => {
  await startMqttServer();
  broker = (jest.requireMock("aedes") as { __broker: TestBroker }).__broker;
});

function client(): Client {
  return { id: "sensor", closed: false, close: jest.fn() } as unknown as Client;
}

function connect(
  target: Client,
  username: string | undefined = undefined,
  secret: string = ObjectID.generate().toString(),
): Promise<{ error: AuthenticateError | null; success: boolean | null }> {
  return new Promise(
    (
      resolve: (result: {
        error: AuthenticateError | null;
        success: boolean | null;
      }) => void,
    ): void => {
      broker.authenticate(
        target,
        username,
        Buffer.from(secret),
        (error: AuthenticateError | null, success: boolean | null): void => {
          resolve({ error, success });
        },
      );
    },
  );
}

function publish(target: Client): Promise<Error | null | undefined> {
  const packet: PublishPacket = {
    cmd: "publish",
    qos: 0,
    dup: false,
    retain: false,
    topic: "oneuptime/fleet/sensor/telemetry",
    payload: Buffer.from(JSON.stringify({ metrics: { temperature: 21 } })),
  } as PublishPacket;
  return new Promise(
    (resolve: (error: Error | null | undefined) => void): void => {
      broker.authorizePublish(target, packet, resolve);
    },
  );
}

describe("MQTT payment admission", () => {
  test("refuses a project key when the shared resolver requires payment", async () => {
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
    ).mockRejectedValue(paymentError);
    const result: { error: AuthenticateError | null; success: boolean | null } =
      await connect(client());
    expect(result.success).toBe(false);
    expect(result.error?.returnCode).toBe(4);
    expect(result.error?.message).toBe(paymentError.message);
    expect(MetricsQueueService.addMetricIngestJob).not.toHaveBeenCalled();
  });

  test("checks payment setup for device credentials without a project key", async () => {
    const credentialId: string = ObjectID.generate().toString();
    const secretKey: string = ObjectID.generate().toString();
    (
      IoTDeviceCredentialService.getCredentialContext as MockFn
    ).mockResolvedValue({
      credentialId,
      secretKey,
      projectId: projectId.toString(),
      iotFleetId: ObjectID.generate().toString(),
      fleetName: "fleet",
      externalId: "sensor",
    });
    (PayAsYouGoBillingService.requirePayAsYouGo as MockFn).mockRejectedValue(
      paymentError,
    );
    const result: { error: AuthenticateError | null; success: boolean | null } =
      await connect(client(), credentialId, secretKey);
    expect(result.success).toBe(false);
    expect(result.error?.returnCode).toBe(4);
    expect(PayAsYouGoBillingService.requirePayAsYouGo).toHaveBeenCalledWith(
      projectId,
    );
    expect(IoTDeviceCredentialService.markConnected).not.toHaveBeenCalled();
  });

  test("rechecks billing for an already-connected project before queueing each publish", async () => {
    const target: Client = client();
    expect((await connect(target)).success).toBe(true);
    await expect(publish(target)).resolves.toBeNull();
    expect(MetricsQueueService.addMetricIngestJob).toHaveBeenCalledTimes(1);
    (PayAsYouGoBillingService.requirePayAsYouGo as MockFn).mockRejectedValue(
      paymentError,
    );
    await expect(publish(target)).resolves.toBe(paymentError);
    expect(PayAsYouGoBillingService.requirePayAsYouGo).toHaveBeenCalledTimes(2);
    expect(MetricsQueueService.addMetricIngestJob).toHaveBeenCalledTimes(1);
  });

  test("also rechecks billing on a connected device credential session", async () => {
    const target: Client = client();
    const credentialId: string = ObjectID.generate().toString();
    const secretKey: string = ObjectID.generate().toString();
    (
      IoTDeviceCredentialService.getCredentialContext as MockFn
    ).mockResolvedValue({
      credentialId,
      secretKey,
      projectId: projectId.toString(),
      iotFleetId: ObjectID.generate().toString(),
      fleetName: "fleet",
      externalId: "sensor",
    });
    expect((await connect(target, credentialId, secretKey)).success).toBe(true);
    (PayAsYouGoBillingService.requirePayAsYouGo as MockFn).mockRejectedValue(
      paymentError,
    );
    await expect(publish(target)).resolves.toBe(paymentError);
    expect(MetricsQueueService.addMetricIngestJob).not.toHaveBeenCalled();
  });
});
