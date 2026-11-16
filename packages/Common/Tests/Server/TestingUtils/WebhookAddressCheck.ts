import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import net from "net";
import SSRFProtection, {
  ValidatedWebhookTarget,
} from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";

/*
 * THE ADDRESS CHECK A WEBHOOK SENDER RUNS, STOOD IN FOR.
 *
 * Every webhook sender checks its URL before it sends and then dials only
 * what the check approved (SafeWebhookRequest.resolveTarget, which asks
 * SSRFProtection.validateAndResolveWebhookTarget). A suite about something
 * else - what a sender writes, what it records, how it retries - stands the
 * check in with this: every URL is approved, at a public address unless it
 * says otherwise, and DNS is never asked. A suite about a refusal makes the
 * spy reject, as the check does:
 *
 *   approveEveryWebhookAddress().mockRejectedValue(
 *     new BadDataException("Webhook URL is not allowed."),
 *   );
 *
 * The check itself, and the pinning, are SafeWebhookRequest.test.ts's and
 * the SSRFProtection suites' to prove.
 */

// A public address the check approves: example.com's.
export const APPROVED_WEBHOOK_ADDRESS: string = "93.184.216.34";

export type WebhookAddressCheckSpy = SpyInstance<
  typeof SSRFProtection.validateAndResolveWebhookTarget
>;

export function approveEveryWebhookAddress(
  address: string = APPROVED_WEBHOOK_ADDRESS,
): WebhookAddressCheckSpy {
  return jest
    .spyOn(SSRFProtection, "validateAndResolveWebhookTarget")
    .mockImplementation(
      async (rawUrl: string | URL): Promise<ValidatedWebhookTarget> => {
        return {
          url: new globalThis.URL(rawUrl.toString()),
          addresses: [{ address: address, family: net.isIP(address) || 4 }],
        };
      },
    ) as unknown as WebhookAddressCheckSpy;
}
