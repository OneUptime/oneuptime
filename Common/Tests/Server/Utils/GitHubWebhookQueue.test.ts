import GitHubWebhookQueue, {
  GitHubWebhookDelivery,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookQueue";
import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
import Redis from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";

const delivery: GitHubWebhookDelivery = {
  event: "installation",
  deliveryId: "delivery-1",
  payload: { action: "created", installation: { id: 12 } },
};

describe("GitHub delivery queue and replay protection", () => {
  const values: Map<string, string> = new Map();
  const client: { exists: jest.Mock; set: jest.Mock } = {
    exists: jest.fn(async (key: string): Promise<number> => {
      return values.has(key) ? 1 : 0;
    }),
    set: jest.fn(async (key: string, value: string): Promise<string> => {
      values.set(key, value);
      return "OK";
    }),
  };
  const job: { getState: jest.Mock; retry: jest.Mock } = {
    getState: jest.fn(),
    retry: jest.fn(),
  };
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    values.clear();
    job.getState.mockResolvedValue("waiting");
    job.retry.mockResolvedValue(undefined);
    jest
      .spyOn(Redis, "getClient")
      .mockReturnValue(client as unknown as ReturnType<typeof Redis.getClient>);
    jest
      .spyOn(Queue, "addJob")
      .mockResolvedValue(
        job as unknown as Awaited<ReturnType<typeof Queue.addJob>>,
      );
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as Awaited<ReturnType<typeof Semaphore.lock>>);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  test("persists with bounded exponential retries and never replaces an existing job", async () => {
    await GitHubWebhookQueue.enqueue(delivery);
    expect(Queue.addJob).toHaveBeenCalledWith(
      QueueName.GitHubWebhook,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "installation",
      delivery,
      { skipExistenceCheck: true, attempts: 8, backoffDelayInMs: 5000 },
    );
    expect(client.set).not.toHaveBeenCalled();
  });
  test("delivery keys distinguish installations and preserve redelivery identity", () => {
    expect(GitHubWebhookQueue.getDeliveryKey(delivery)).toBe(
      GitHubWebhookQueue.getDeliveryKey({ ...delivery }),
    );
    expect(GitHubWebhookQueue.getDeliveryKey(delivery)).not.toBe(
      GitHubWebhookQueue.getDeliveryKey({
        ...delivery,
        payload: { ...delivery.payload, installation: { id: 13 } },
      }),
    );
    expect(GitHubWebhookQueue.getDeliveryKey(delivery)).not.toBe(
      GitHubWebhookQueue.getDeliveryKey({
        ...delivery,
        deliveryId: "delivery-2",
      }),
    );
  });
  test("only marks complete after dispatch and ignores redeliveries even after queue cleanup", async () => {
    const dispatch: jest.Mock = jest.fn(async () => {
      expect(client.set).not.toHaveBeenCalled();
    });
    await GitHubWebhookQueue.process(delivery, dispatch);
    expect(client.set).toHaveBeenCalledWith(
      expect.stringContaining("github-webhook-completed:"),
      "1",
      "EX",
      30 * 24 * 60 * 60,
    );
    await GitHubWebhookQueue.process(delivery, dispatch);
    await GitHubWebhookQueue.enqueue(delivery);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(Queue.addJob).not.toHaveBeenCalled();
    expect(Semaphore.release).toHaveBeenCalledTimes(2);
  });
  test("dispatch failure remains retryable and releases its lock", async () => {
    const dispatch: jest.Mock = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(undefined);
    await expect(
      GitHubWebhookQueue.process(delivery, dispatch),
    ).rejects.toThrow("temporary");
    expect(client.set).not.toHaveBeenCalled();
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
    await GitHubWebhookQueue.process(delivery, dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  test("distinct deliveries for one installation use the same processing mutex", async () => {
    const dispatch: jest.Mock = jest.fn().mockResolvedValue(undefined);
    await GitHubWebhookQueue.process(delivery, dispatch);
    await GitHubWebhookQueue.process(
      { ...delivery, deliveryId: "delivery-2" },
      dispatch,
    );
    const locks: Array<Parameters<typeof Semaphore.lock>> = jest.mocked(
      Semaphore.lock,
    ).mock.calls;
    expect(locks[0]![0]).toMatchObject({
      namespace: "github-installation",
      key: "12",
    });
    expect(locks[1]![0]).toEqual(locks[0]![0]);
  });
  test("an active repository import blocks later events in its installation while other installations progress", async () => {
    const tails: Map<string, Promise<void>> = new Map();
    const releases: Map<SemaphoreMutex, () => void> = new Map();
    jest
      .mocked(Semaphore.lock)
      .mockImplementation(
        async (
          data: Parameters<typeof Semaphore.lock>[0],
        ): Promise<SemaphoreMutex> => {
          const key: string = `${data.namespace}:${data.key}`;
          const previous: Promise<void> = tails.get(key) || Promise.resolve();
          let unlock: () => void = (): void => {};
          const current: Promise<void> = new Promise((resolve: () => void) => {
            unlock = resolve;
          });
          tails.set(
            key,
            previous.then((): Promise<void> => {
              return current;
            }),
          );
          await previous;
          const mutex: SemaphoreMutex = {} as SemaphoreMutex;
          releases.set(mutex, unlock);
          return mutex;
        },
      );
    jest
      .mocked(Semaphore.release)
      .mockImplementation(async (mutex: SemaphoreMutex): Promise<void> => {
        releases.get(mutex)?.();
      });
    let finishImport: () => void = (): void => {};
    let markStarted: () => void = (): void => {};
    const started: Promise<void> = new Promise((resolve: () => void) => {
      markStarted = resolve;
    });
    const importPending: Promise<void> = new Promise((resolve: () => void) => {
      finishImport = resolve;
    });
    const events: Array<string> = [];
    const importing: Promise<void> = GitHubWebhookQueue.process(
      delivery,
      async (): Promise<void> => {
        events.push("import started");
        markStarted();
        await importPending;
        events.push("import complete");
      },
    );
    await started;
    const waiting: Promise<void> = GitHubWebhookQueue.process(
      { ...delivery, deliveryId: "delivery-2" },
      async (): Promise<void> => {
        events.push("same installation event");
      },
    );
    await GitHubWebhookQueue.process(
      {
        ...delivery,
        payload: { ...delivery.payload, installation: { id: 13 } },
      },
      async (): Promise<void> => {
        events.push("other installation event");
      },
    );
    expect(events).toEqual(["import started", "other installation event"]);
    finishImport();
    await Promise.all([importing, waiting]);
    expect(events).toEqual([
      "import started",
      "other installation event",
      "import complete",
      "same installation event",
    ]);
  });
  test("completion-storage failure retries fanout rather than losing delivery", async () => {
    client.set.mockRejectedValueOnce(new Error("storage unavailable"));
    const dispatch: jest.Mock = jest.fn().mockResolvedValue(undefined);
    await expect(
      GitHubWebhookQueue.process(delivery, dispatch),
    ).rejects.toThrow("storage unavailable");
    await GitHubWebhookQueue.process(delivery, dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  test("redeliver reactivates an exhausted failed job", async () => {
    job.getState.mockResolvedValue("failed");
    await GitHubWebhookQueue.enqueue(delivery);
    expect(job.retry).toHaveBeenCalledTimes(1);
  });
  test("concurrent redelivery retry is harmless when another caller already retried", async () => {
    job.getState
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("waiting");
    job.retry.mockRejectedValueOnce(new Error("already retried"));
    await expect(GitHubWebhookQueue.enqueue(delivery)).resolves.toBeUndefined();
  });
  test("genuine retry failure is surfaced to GitHub", async () => {
    job.getState.mockResolvedValue("failed");
    job.retry.mockRejectedValueOnce(new Error("cannot retry"));
    await expect(GitHubWebhookQueue.enqueue(delivery)).rejects.toThrow(
      "cannot retry",
    );
  });
  test("queue failure never marks a delivery accepted", async () => {
    jest.mocked(Queue.addJob).mockRejectedValueOnce(new Error("queue offline"));
    await expect(GitHubWebhookQueue.enqueue(delivery)).rejects.toThrow(
      "queue offline",
    );
    expect(client.set).not.toHaveBeenCalled();
  });
  test("fails closed without a delivery store", async () => {
    jest.mocked(Redis.getClient).mockReturnValue(null);
    await expect(GitHubWebhookQueue.enqueue(delivery)).rejects.toThrow(
      "unavailable",
    );
    expect(Queue.addJob).not.toHaveBeenCalled();
  });
  test.each(["", "../../bad", "id:collision", "a".repeat(101)])(
    "rejects invalid delivery identity %s",
    async (deliveryId: string) => {
      await expect(
        GitHubWebhookQueue.enqueue({ ...delivery, deliveryId }),
      ).rejects.toThrow("X-GitHub-Delivery");
      expect(Queue.addJob).not.toHaveBeenCalled();
    },
  );
  test.each([
    null,
    {},
    { id: 0 },
    { id: -1 },
    { id: 1.5 },
    { id: "bad" },
    { id: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed installation", async (installation: unknown) => {
    await expect(
      GitHubWebhookQueue.enqueue({
        ...delivery,
        payload: { action: "created", installation: installation as never },
      }),
    ).rejects.toThrow("installation");
  });
});
