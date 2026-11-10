import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { SessionReplayFrustrationSettings } from "../../../Types/Rum/SessionReplayFrustrationSignals";
import { describe, expect, it } from "@jest/globals";

/*
 * RumApplication.sessionReplayFrustrationSignals is checked on every write,
 * the API's as well as the dashboard's: settings no recorder could follow
 * are refused with words that name them, and the rest are stored canonical.
 * The check runs in checkCreateBeforeReferences / checkUpdateBeforeReferences,
 * which the base hooks call first on every write.
 */

interface ServiceHooks {
  onBeforeUpdate: (updateBy: unknown) => Promise<{ updateBy: unknown }>;
  checkCreateBeforeReferences: (createBy: unknown) => Promise<void>;
}

const hooks: ServiceHooks = RumApplicationService as unknown as ServiceHooks;

function serverUpdate(data: Record<string, unknown>): unknown {
  return {
    query: { _id: ObjectID.generate().toString() },
    data: data,
    // A server write: no project reference lookups, only the service's own check.
    props: { isRoot: true },
  };
}

describe("RumApplicationService frustration signals on update", () => {
  it("leaves a write that does not touch them alone", async () => {
    const data: Record<string, unknown> = { name: "Checkout" };

    await hooks.onBeforeUpdate(serverUpdate(data));

    expect(data).toEqual({ name: "Checkout" });
  });

  it("stores valid settings canonical: trimmed, every rule present, ids on every signal", async () => {
    const data: Record<string, unknown> = {
      sessionReplayFrustrationSignals: {
        rageClick: { clickCount: 4 },
        customSignals: [
          {
            name: " Payment failed ",
            trigger: "event",
            match: "payment_failed",
          },
        ],
      },
    };

    await hooks.onBeforeUpdate(serverUpdate(data));

    const stored: SessionReplayFrustrationSettings = data[
      "sessionReplayFrustrationSignals"
    ] as SessionReplayFrustrationSettings;

    expect(stored.rageClick).toEqual({
      isEnabled: true,
      clickCount: 4,
      windowMs: 1000,
      radiusPx: 30,
      ignoreSelectors: [],
    });
    expect(stored.deadClick.timeoutMs).toBe(3000);
    expect(stored.customSignals).toHaveLength(1);
    expect(stored.customSignals[0]?.name).toBe("Payment failed");
    expect(stored.customSignals[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses settings a recorder could not follow, naming what is wrong", async () => {
    await expect(
      hooks.onBeforeUpdate(
        serverUpdate({
          sessionReplayFrustrationSignals: { deadClick: { timeoutMs: 60000 } },
        }),
      ),
    ).rejects.toThrow(
      new BadDataException(
        "Dead clicks: the wait in milliseconds must be a whole number from 500 to 10000.",
      ),
    );

    await expect(
      hooks.onBeforeUpdate(
        serverUpdate({
          sessionReplayFrustrationSignals: {
            customSignals: [
              { name: "Checkout", trigger: "page", match: "checkout" },
            ],
          },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("clears the column with null, which means the built-in rules", async () => {
    const data: Record<string, unknown> = {
      sessionReplayFrustrationSignals: null,
    };

    await hooks.onBeforeUpdate(serverUpdate(data));

    expect(data["sessionReplayFrustrationSignals"]).toBeNull();
  });
});

describe("RumApplicationService frustration signals on create", () => {
  it("checks them on a new application too", async () => {
    const application: RumApplication = new RumApplication();
    application.sessionReplayFrustrationSignals = {
      refreshRage: { reloadCount: 1 },
    } as unknown as SessionReplayFrustrationSettings;

    await expect(
      hooks.checkCreateBeforeReferences({
        data: application,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "Refresh rage: the number of loads must be a whole number from 2 to 10.",
    );
  });

  it("creates without them as the built-in rules, untouched", async () => {
    const application: RumApplication = new RumApplication();

    await hooks.checkCreateBeforeReferences({
      data: application,
      props: { isRoot: true },
    });

    expect(application.sessionReplayFrustrationSignals).toBeUndefined();
  });
});
