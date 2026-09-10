import TelemetryIngestionKeyService, {
  Service,
} from "../../../Server/Services/TelemetryIngestionKeyService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import TelemetryIngest, {
  TelemetryRequest,
} from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual(
      "../../../Server/EnvironmentConfig",
    ) as typeof EnvironmentConfig),
    IsBillingEnabled: true,
  };
});

type KeyHooks = {
  onBeforeCreate: (input: CreateBy<TelemetryIngestionKey>) => Promise<unknown>;
  onBeforeUpdate: (input: UpdateBy<TelemetryIngestionKey>) => Promise<unknown>;
};
let service: Service;
let hooks: KeyHooks;
const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();

function key(project: ObjectID = projectId): TelemetryIngestionKey {
  return Object.assign(new TelemetryIngestionKey(), {
    id: ObjectID.generate(),
    projectId: project,
    secretKey: ObjectID.generate(),
    isEnabled: true,
    keyType: TelemetryIngestionKeyType.Server,
  });
}

function createInput(): CreateBy<TelemetryIngestionKey> {
  return { data: key(), props: { tenantId: projectId } };
}

function updateInput(
  data: UpdateBy<TelemetryIngestionKey>["data"],
): UpdateBy<TelemetryIngestionKey> {
  return {
    data,
    query: { _id: ObjectID.generate().toString() },
    props: { isRoot: true },
    limit: 10,
    skip: 0,
  };
}

type PaymentCheck = Parameters<
  typeof PayAsYouGoBillingService.canUsePayAsYouGo
>;

/*
 * requirePayAsYouGo forwards its own options argument straight through to
 * canUsePayAsYouGo, so a recorded check carries a second argument as well as
 * the project. Assert the two things that decide the outcome rather than the
 * exact argument list: whose payment setup was read, and that creating or
 * enabling a key stays a read-through check. Only ingest admission - which
 * runs per batch and whose client retries - opts into answering from a cached
 * denial; a key the user just created must not be refused because of one.
 */
function expectPaymentCheckedFor(project: ObjectID): void {
  const checks: Array<PaymentCheck> = jest.mocked(
    PayAsYouGoBillingService.canUsePayAsYouGo,
  ).mock.calls;

  expect(
    checks.map((check: PaymentCheck): string => {
      return check[0].toString();
    }),
  ).toEqual([project.toString()]);

  for (const check of checks) {
    expect(check[1]?.allowStaleDenial).toBeFalsy();
  }
}

beforeEach(() => {
  jest.restoreAllMocks();
  (EnvironmentConfig as { IsBillingEnabled: boolean }).IsBillingEnabled = true;
  service = new Service();
  hooks = service as unknown as KeyHooks;
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(false);
  jest.spyOn(service, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("telemetry key creation and enablement payment admission", () => {
  test.each(Object.values(TelemetryIngestionKeyType))(
    "requires payment setup to create a %s key",
    async (keyType: TelemetryIngestionKeyType) => {
      const input: CreateBy<TelemetryIngestionKey> = createInput();
      input.data.keyType = keyType;
      input.data.allowedOrigins = ["https://example.com"];
      await expect(hooks.onBeforeCreate(input)).rejects.toBeInstanceOf(
        PaymentRequiredException,
      );
    },
  );

  test("also guards legacy create requests without a key type", async () => {
    const input: CreateBy<TelemetryIngestionKey> = createInput();
    delete input.data.keyType;
    await expect(hooks.onBeforeCreate(input)).rejects.toThrow(
      "Project Settings > Billing",
    );
  });

  test("checks the authenticated tenant instead of the payload project", async () => {
    const input: CreateBy<TelemetryIngestionKey> = createInput();
    input.data.projectId = otherProjectId;
    await expect(hooks.onBeforeCreate(input)).rejects.toBeInstanceOf(
      PaymentRequiredException,
    );
    expectPaymentCheckedFor(projectId);
  });

  test("uses the project on an internal create without a request tenant", async () => {
    const input: CreateBy<TelemetryIngestionKey> = createInput();
    input.props = { isRoot: true };
    await expect(hooks.onBeforeCreate(input)).rejects.toBeInstanceOf(
      PaymentRequiredException,
    );
    expectPaymentCheckedFor(projectId);
  });

  test("does not admit a billed create without a project", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: new TelemetryIngestionKey(),
        props: { isRoot: true },
      }),
    ).rejects.toThrow("ProjectId required");
  });

  test("allows key creation when payment setup is authorized", async () => {
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);
    await expect(hooks.onBeforeCreate(createInput())).resolves.toBeDefined();
  });

  test("preserves self-hosted key creation without consulting billing", async () => {
    (EnvironmentConfig as { IsBillingEnabled: boolean }).IsBillingEnabled =
      false;
    await expect(hooks.onBeforeCreate(createInput())).resolves.toBeDefined();
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });

  test("guards re-enabling an existing key using its stored project", async () => {
    jest.spyOn(service, "findBy").mockResolvedValue([key(otherProjectId)]);
    const input: UpdateBy<TelemetryIngestionKey> = updateInput({
      isEnabled: true,
    });
    input.props.tenantId = projectId;
    await expect(hooks.onBeforeUpdate(input)).rejects.toBeInstanceOf(
      PaymentRequiredException,
    );
    expectPaymentCheckedFor(otherProjectId);
  });

  test("checks every distinct project of a bulk enable operation", async () => {
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([key(), key(), key(otherProjectId)]);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockImplementation(async (id: ObjectID): Promise<boolean> => {
        return id.toString() === projectId.toString();
      });
    await expect(
      hooks.onBeforeUpdate(updateInput({ isEnabled: true })),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledTimes(2);
  });

  test("scopes a non-root enable lookup to the request tenant", async () => {
    const input: UpdateBy<TelemetryIngestionKey> = updateInput({
      isEnabled: true,
    });
    input.props = { tenantId: projectId };
    await hooks.onBeforeUpdate(input);
    expect(service.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { ...input.query, projectId },
        limit: input.limit,
        skip: input.skip,
      }),
    );
  });

  test.each([{ isEnabled: false }, { name: "Renamed key" }])(
    "allows a nonbillable update %j without payment setup",
    async (data: UpdateBy<TelemetryIngestionKey>["data"]) => {
      await expect(
        hooks.onBeforeUpdate(updateInput(data)),
      ).resolves.toBeDefined();
      expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
      expect(service.findBy).not.toHaveBeenCalled();
    },
  );
});

describe("existing key payment admission", () => {
  test("rejects existing enabled keys before returning their policy or project", async () => {
    const existingKey: TelemetryIngestionKey = key();
    jest.spyOn(service, "findOneBy").mockResolvedValue(existingKey);
    await expect(
      service.getPolicyFromSecretKey(existingKey.secretKey!.toString()),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    await expect(
      service.getProjectIdFromSecretKey(existingKey.secretKey!.toString()),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
  });

  test("checks cached keys again so removing payment setup cannot leave an admitted key indefinitely", async () => {
    const existingKey: TelemetryIngestionKey = key();
    jest.spyOn(service, "findOneBy").mockResolvedValue(existingKey);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);
    await expect(
      service.getPolicyFromSecretKey(existingKey.secretKey!.toString()),
    ).resolves.toMatchObject({ projectId });
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(false);
    await expect(
      service.getPolicyFromSecretKey(existingKey.secretKey!.toString()),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(service.findOneBy).toHaveBeenCalledTimes(1);
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledTimes(2);
  });

  test("starts accepting an existing key after payment setup succeeds", async () => {
    const existingKey: TelemetryIngestionKey = key();
    jest.spyOn(service, "findOneBy").mockResolvedValue(existingKey);
    await expect(
      service.getPolicyFromSecretKey(existingKey.secretKey!.toString()),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);
    await expect(
      service.getPolicyFromSecretKey(existingKey.secretKey!.toString()),
    ).resolves.toMatchObject({ projectId });
    expect(service.findOneBy).toHaveBeenCalledTimes(1);
  });

  test.each([{ isEnabled: false }, { expiresAt: new Date(0) }])(
    "retains diagnostic policy resolution for unusable keys %j",
    async (state: Partial<TelemetryIngestionKey>) => {
      const existingKey: TelemetryIngestionKey = Object.assign(key(), state);
      jest.spyOn(service, "findOneBy").mockResolvedValue(existingKey);
      await expect(
        service.getPolicyFromSecretKey(existingKey.secretKey!.toString()),
      ).resolves.toMatchObject({ projectId });
      expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
    },
  );

  test("does not consult billing when no key resolves", async () => {
    jest.spyOn(service, "findOneBy").mockResolvedValue(null);
    await expect(
      service.getPolicyFromSecretKey(ObjectID.generate().toString()),
    ).resolves.toBeNull();
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });
});

describe("HTTP telemetry admission integrates key resolution and billing", () => {
  test.each(Object.values(TelemetryIngestSurface))(
    "prevents existing no-card keys reaching the %s handler",
    async (surface: TelemetryIngestSurface) => {
      const existingKey: TelemetryIngestionKey = key();
      jest
        .spyOn(TelemetryIngestionKeyService, "findOneBy")
        .mockResolvedValue(existingKey);
      jest
        .spyOn(TelemetryIngestionKeyService, "markUsed")
        .mockResolvedValue(undefined);
      const request: ExpressRequest = {
        headers: { "x-oneuptime-token": existingKey.secretKey!.toString() },
      } as unknown as ExpressRequest;
      const next: NextFunction = jest.fn() as unknown as NextFunction;
      await TelemetryIngest.forSurface(surface)(
        request,
        {} as ExpressResponse,
        next as NextFunction,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(expect.any(PaymentRequiredException));
      expect((request as TelemetryRequest).projectId).toBeUndefined();
      expect(TelemetryIngestionKeyService.markUsed).not.toHaveBeenCalled();
    },
  );

  test("continues to the handler after payment setup with the stored key project", async () => {
    const existingKey: TelemetryIngestionKey = key(otherProjectId);
    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(existingKey);
    jest
      .spyOn(TelemetryIngestionKeyService, "markUsed")
      .mockResolvedValue(undefined);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);
    const request: ExpressRequest = {
      headers: { "x-oneuptime-token": existingKey.secretKey!.toString() },
    } as unknown as ExpressRequest;
    const next: NextFunction = jest.fn() as unknown as NextFunction;
    await TelemetryIngest.isAuthorizedServiceMiddleware(
      request,
      {} as ExpressResponse,
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledWith();
    expect((request as TelemetryRequest).projectId.toString()).toBe(
      otherProjectId.toString(),
    );
    expect(TelemetryIngestionKeyService.markUsed).toHaveBeenCalledTimes(1);
  });
});
