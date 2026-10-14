import * as grpc from "@grpc/grpc-js";
import { handleExport } from "../../FeatureSet/Telemetry/GrpcServer";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import logger from "Common/Server/Utils/Logger";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A project a master admin blocked takes in no telemetry: resolving one of
 * its ingestion keys refuses it (TelemetryIngestionKeyService, whose own
 * suite is BlockedProjectBackgroundWork.test.ts). Over HTTP that is the
 * 403 the error handler answers. Over gRPC an exception the export handler
 * does not know is logged and answered as a success, so the exporter would
 * be told its data was taken while it was dropped: the refusal is answered
 * PERMISSION_DENIED instead, which an OTLP exporter does not retry, as an
 * unpaid project's is.
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return { __esModule: true, default: { getPolicyFromSecretKey: jest.fn() } };
});
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {},
    QueueName: { Telemetry: "Telemetry" },
  };
});

type ExportCallback = (
  error: grpc.ServiceError | null,
  response?: Record<string, unknown>,
) => void;

interface ExportOutcome {
  error: grpc.ServiceError | null;
  queued: number;
}

const getPolicyFromSecretKey: jest.Mock =
  TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as jest.Mock;

const exportOnce: () => Promise<ExportOutcome> =
  async (): Promise<ExportOutcome> => {
    const metadata: grpc.Metadata = new grpc.Metadata();
    metadata.set("x-oneuptime-token", ObjectID.generate().toString());

    let queued: number = 0;
    // Set by the callback, which handleExport calls once with its answer.
    const answer: { error?: grpc.ServiceError | null } = {};

    const callback: ExportCallback = (
      error: grpc.ServiceError | null,
    ): void => {
      answer.error = error;
    };

    await handleExport(
      { request: {}, metadata: metadata } as never,
      callback as never,
      ProductType.Logs,
      async (_req: TelemetryRequest): Promise<void> => {
        queued++;
      },
    );

    expect(answer.error).not.toBeUndefined();

    return { error: answer.error ?? null, queued: queued };
  };

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  getPolicyFromSecretKey.mockReset();
});

describe("gRPC export from a blocked project", () => {
  test("is refused with PERMISSION_DENIED that says why, and nothing is queued", async () => {
    getPolicyFromSecretKey.mockRejectedValue(new ProjectBlockedException());

    const outcome: ExportOutcome = await exportOnce();

    expect(outcome.error?.code).toBe(grpc.status.PERMISSION_DENIED);
    expect(outcome.error?.details).toBe(ExceptionMessages.ProjectBlocked);
    expect(outcome.queued).toBe(0);
  });

  test("an unpaid project's refusal is answered as before", async () => {
    getPolicyFromSecretKey.mockRejectedValue(
      new PaymentRequiredException("Add a payment method."),
    );

    const outcome: ExportOutcome = await exportOnce();

    expect(outcome.error?.code).toBe(grpc.status.PERMISSION_DENIED);
    expect(outcome.error?.details).toBe("Add a payment method.");
  });
});
