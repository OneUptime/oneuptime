import Queue, { QueueName } from "../../../Infrastructure/Queue";
import Redis, { ClientType } from "../../../Infrastructure/Redis";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import GitHubEventUtil from "../../../../Utils/CodeRepository/GitHubEventUtil";
import crypto from "crypto";

export interface GitHubWebhookDelivery extends JSONObject {
  event: string;
  deliveryId: string;
  payload: JSONObject;
}

/** Verified deliveries are acknowledged only after BullMQ has persisted them. */
export default class GitHubWebhookQueue {
  public static readonly RETENTION_SECONDS: number = 30 * 24 * 60 * 60;

  public static isSupportedEvent(event: string): boolean {
    return (
      event === "installation" ||
      event === "installation_repositories" ||
      GitHubEventUtil.isSupportedEvent(event)
    );
  }

  public static validate(delivery: GitHubWebhookDelivery): void {
    const deliveryIdPattern: RegExp = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/;
    const installationIdPattern: RegExp = /^[1-9][0-9]*$/;
    if (!deliveryIdPattern.test(delivery.deliveryId)) {
      throw new BadDataException(
        "A valid X-GitHub-Delivery header is required.",
      );
    }

    const installation: unknown = delivery.payload["installation"];
    const id: unknown =
      installation && typeof installation === "object"
        ? (installation as JSONObject)["id"]
        : undefined;

    if (
      !(
        (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
        (typeof id === "string" && installationIdPattern.test(id))
      )
    ) {
      throw new BadDataException(
        "A valid GitHub App installation is required.",
      );
    }

    if (GitHubEventUtil.isSupportedEvent(delivery.event)) {
      GitHubEventUtil.normalize({ ...delivery, codeRepositoryId: "" });
    } else if (typeof delivery.payload["action"] !== "string") {
      throw new BadDataException("A GitHub installation action is required.");
    }
  }

  public static getDeliveryKey(delivery: GitHubWebhookDelivery): string {
    const installationId: string = (
      delivery.payload["installation"] as JSONObject
    )["id"]!.toString();
    return crypto
      .createHash("sha256")
      .update(JSON.stringify([installationId, delivery.deliveryId]))
      .digest("hex");
  }

  private static client(): ClientType {
    const client: ClientType | null = Redis.getClient();
    if (!client) {
      throw new Error("GitHub delivery storage is unavailable.");
    }
    return client;
  }

  private static completedKey(delivery: GitHubWebhookDelivery): string {
    return `github-webhook-completed:${this.getDeliveryKey(delivery)}`;
  }

  public static async enqueue(delivery: GitHubWebhookDelivery): Promise<void> {
    this.validate(delivery);
    if (await this.client().exists(this.completedKey(delivery))) {
      return;
    }

    const jobId: string = this.getDeliveryKey(delivery);
    const job: Awaited<ReturnType<typeof Queue.addJob>> = await Queue.addJob(
      QueueName.GitHubWebhook,
      jobId,
      delivery.event,
      delivery,
      {
        skipExistenceCheck: true,
        attempts: 8,
        backoffDelayInMs: 5000,
      },
    );

    // GitHub's manual Redeliver must also recover an exhausted failed job.
    if ((await job.getState()) === "failed") {
      try {
        await job.retry();
      } catch (error) {
        // A concurrent redelivery may already have retried this same job.
        if ((await job.getState()) === "failed") {
          throw error;
        }
      }
    }
  }

  public static async process(
    delivery: GitHubWebhookDelivery,
    dispatch: (delivery: GitHubWebhookDelivery) => Promise<void>,
  ): Promise<void> {
    this.validate(delivery);
    const mutex: SemaphoreMutex = await Semaphore.lock({
      /*
       * Lifecycle imports/removals and repository events must not run at the
       * same time: a comment could otherwise overtake its repository import.
       * This serializes active work, not GitHub's arrival order; GitHub can
       * deliver events out of order, so lifecycle state is reconciled live.
       */
      namespace: "github-installation",
      key: (delivery.payload["installation"] as JSONObject)["id"]!.toString(),
      lockTimeout: 60000,
      acquireTimeout: 1000,
    });

    try {
      if (await this.client().exists(this.completedKey(delivery))) {
        return;
      }
      await dispatch(delivery);
      // Separate from BullMQ history: worker restarts clean terminal jobs.
      await this.client().set(
        this.completedKey(delivery),
        "1",
        "EX",
        this.RETENTION_SECONDS,
      );
    } finally {
      await Semaphore.release(mutex);
    }
  }
}
