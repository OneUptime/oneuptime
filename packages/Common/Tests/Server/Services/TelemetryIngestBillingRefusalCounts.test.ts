import TelemetryIngestionKeyService, {
  Service,
} from "../../../Server/Services/TelemetryIngestionKeyService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import TelemetryIngest from "../../../Server/Middleware/TelemetryIngest";
import logger from "../../../Server/Utils/Logger";
import TelemetryIngestRefusalRecorder, {
  TelemetryIngestRefusalKey,
  TelemetryIngestRefusalRecord,
  getTelemetryIngestRefusalKey,
} from "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A BILLING REFUSAL IS COUNTED AGAINST THE KEY IT WAS THROWN FOR
 * (issue #6378).
 *
 * The key service refuses a project with no way to pay, or one a master
 * admin blocked, by THROWING while it resolves the key - so the guard that
 * catches it never holds the policy. requireBillingForPolicy notes the key
 * on the exception (noteTelemetryIngestRefusalKey) and the guard counts it.
 * This runs the real service - the key read and the billing answers
 * stubbed - and the real guard, so a refactor that drops the note shows up
 * as an uncounted refusal here rather than as a setup check that says
 * "nothing arrived" to a project whose card was declined.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual(
      "../../../Server/EnvironmentConfig",
    ) as typeof EnvironmentConfig),
    IsBillingEnabled: true,
  };
});

jest.mock(
  "../../../Server/Services/TelemetryIngestionKeyRefusalService",
  () => {
    return {
      __esModule: true,
      default: {
        addRefusals: jest.fn(),
      },
    };
  },
);

const projectId: ObjectID = ObjectID.generate();

function key(
  state: Partial<TelemetryIngestionKey> = {},
): TelemetryIngestionKey {
  return Object.assign(new TelemetryIngestionKey(), {
    id: ObjectID.generate(),
    projectId,
    secretKey: ObjectID.generate(),
    isEnabled: true,
    keyType: TelemetryIngestionKeyType.Server,
    ...state,
  });
}

async function refusalOf(
  service: Service,
  secretKey: string,
): Promise<unknown> {
  try {
    await service.getPolicyFromSecretKey(secretKey);
  } catch (err) {
    return err;
  }

  throw new Error("the key was admitted");
}

let record: jest.SpiedFunction<typeof TelemetryIngestRefusalRecorder.record>;

beforeEach(() => {
  jest.restoreAllMocks();
  (EnvironmentConfig as { IsBillingEnabled: boolean }).IsBillingEnabled = true;
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(false);
  record = jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the key service notes the key on a billing refusal", () => {
  test("no way to pay: the PaymentRequiredException carries the key and its project", async () => {
    const service: Service = new Service();
    const existing: TelemetryIngestionKey = key();
    jest.spyOn(service, "findOneBy").mockResolvedValue(existing);

    const err: unknown = await refusalOf(
      service,
      existing.secretKey!.toString(),
    );

    expect(err).toBeInstanceOf(PaymentRequiredException);

    const noted: TelemetryIngestRefusalKey | null =
      getTelemetryIngestRefusalKey(err);
    expect(noted?.projectId.toString()).toBe(projectId.toString());
    expect(noted?.ingestionKeyId.toString()).toBe(existing.id!.toString());
  });

  test("a blocked project: the ProjectBlockedException carries the key", async () => {
    const service: Service = new Service();
    const existing: TelemetryIngestionKey = key();
    jest.spyOn(service, "findOneBy").mockResolvedValue(existing);
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(true);

    const err: unknown = await refusalOf(
      service,
      existing.secretKey!.toString(),
    );

    expect(err).toBeInstanceOf(ProjectBlockedException);
    expect(getTelemetryIngestRefusalKey(err)?.ingestionKeyId.toString()).toBe(
      existing.id!.toString(),
    );
  });

  test("a key read from the service's cache is noted too", async () => {
    const service: Service = new Service();
    const existing: TelemetryIngestionKey = key();
    jest.spyOn(service, "findOneBy").mockResolvedValue(existing);

    await refusalOf(service, existing.secretKey!.toString());
    const second: unknown = await refusalOf(
      service,
      existing.secretKey!.toString(),
    );

    expect(service.findOneBy).toHaveBeenCalledTimes(1);
    expect(
      getTelemetryIngestRefusalKey(second)?.ingestionKeyId.toString(),
    ).toBe(existing.id!.toString());
  });

  test("a key switched off is not asked about billing: its refusal is the guard's own", async () => {
    const service: Service = new Service();
    const existing: TelemetryIngestionKey = key({ isEnabled: false });
    jest.spyOn(service, "findOneBy").mockResolvedValue(existing);

    await expect(
      service.getPolicyFromSecretKey(existing.secretKey!.toString()),
    ).resolves.toMatchObject({ isEnabled: false });
  });
});

describe("the guard counts what the service noted", () => {
  async function runGuard(
    surface: TelemetryIngestSurface,
    token: string,
  ): Promise<jest.Mock> {
    const next: jest.Mock = jest.fn();
    const res: Record<string, unknown> = {
      headersSent: false,
      setHeader: jest.fn(),
      status: (): Record<string, unknown> => {
        return res;
      },
      send: (): Record<string, unknown> => {
        return res;
      },
      json: (): Record<string, unknown> => {
        return res;
      },
    };

    await TelemetryIngest.forSurface(surface)(
      {
        headers: { "x-oneuptime-token": token },
        id: "test-request-id",
      } as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    return next;
  }

  test("a project with no way to pay sending logs: counted once, against its key, on Logs", async () => {
    const existing: TelemetryIngestionKey = key();
    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(existing);

    const next: jest.Mock = await runGuard(
      TelemetryIngestSurface.OtelLogs,
      existing.secretKey!.toString(),
    );

    // The sender's answer is unchanged: the exception goes on to next().
    expect(next.mock.calls[0]![0]).toBeInstanceOf(PaymentRequiredException);

    expect(
      record.mock.calls.map(
        (call: [TelemetryIngestRefusalRecord]): Record<string, unknown> => {
          return {
            project: call[0].projectId.toString(),
            key: call[0].ingestionKeyId.toString(),
            reason: call[0].reason,
            surface: call[0].surface,
          };
        },
      ),
    ).toEqual([
      {
        project: projectId.toString(),
        key: existing.id!.toString(),
        reason: TelemetryIngestRefusalReason.PaymentRequired,
        surface: TelemetryIngestSurface.OtelLogs,
      },
    ]);
  });

  test("a token that is no key: no billing is asked, nothing is counted", async () => {
    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(null);

    await runGuard(
      TelemetryIngestSurface.OtelTraces,
      ObjectID.generate().toString(),
    );

    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
