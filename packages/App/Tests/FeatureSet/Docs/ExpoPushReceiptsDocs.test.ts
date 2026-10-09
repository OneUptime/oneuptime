import PushNotificationService from "Common/Server/Services/PushNotificationService";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { TRANSLATED_LANGUAGES } from "./DocsContentSupport";

/*
 * Mobile push receipts. Expo usually says a phone is gone in a push's
 * delivery receipt, about 15 minutes after the send, and OneUptime now reads
 * receipts - directly with EXPO_ACCESS_TOKEN, or through the push relay,
 * which answers them at /receipts. A push that never arrived turns from sent
 * to "Push notification not delivered" in the push log and the page's
 * on-call timeline.
 *
 * Self-hosted > Push Notifications says so in every language: the relay's
 * and Expo's receipt addresses in the network table, what "not delivered"
 * means and what to do for each of Expo's codes, and that receipts are what
 * usually marks a phone. Markdown is not compiled: nothing else notices a
 * page that still says only the send is checked.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PAGE: string = "self-hosted/push-notifications.md";

const LANGUAGES: Array<string> = ["en", ...TRANSLATED_LANGUAGES];

function readPage(lang: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, PAGE), "utf8");
}

const RELAY_RECEIPTS_URL: string =
  "https://oneuptime.com/api/notification/push-relay/receipts";

describe("Self-hosted > Push Notifications, in English", () => {
  const page: string = readPage("en");

  it("lists the receipt addresses a firewall has to allow, beside the send addresses", () => {
    expect(page).toContain(
      "| OneUptime → default push relay | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` |",
    );
    expect(page).toContain(
      "| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` |",
    );
  });

  it("says where a relay answers receipts, and what a relay without them means", () => {
    expect(page).toContain(
      "OneUptime reads delivery receipts from the relay at the same address with `/receipts` in place of `/send`.",
    );
    expect(page).toContain(
      "A relay without that route still delivers pushes; a device whose app was removed is then noticed only when a later push to it is refused.",
    );
  });

  it("says a receipt is read about 15 minutes after each push, and what a push that never arrived shows", () => {
    expect(page).toContain(
      "For mobile pushes, OneUptime also reads Expo's delivery receipt about 15 minutes after each push",
    );
    expect(page).toContain('### Pushes marked "not delivered"');
    expect(page).toContain(
      "the push log and the on-call timeline of the page change from sent to **Push notification not delivered**, with Expo's error code:",
    );
  });

  it("says what each of Expo's receipt errors means, and what to do", () => {
    expect(page).toContain(
      "- `DeviceNotRegistered`: the mobile app was removed from the device, or its push token is no longer valid. See the next section.",
    );
    expect(page).toContain(
      "- `MessageRateExceeded`: too many notifications were sent to the device in a short time.",
    );
    expect(page).toContain(
      "- `MessageTooBig`: the notification was larger than push services accept.",
    );
    expect(page).toContain(
      "- `InvalidCredentials` or `MismatchSenderId`: the push credentials of the Expo project that sent the push are not valid.",
    );
  });

  it("says a phone is usually marked from a receipt, not refused at once - and not after its app registered again", () => {
    expect(page).toContain(
      "It usually says so in a push's delivery receipt, which OneUptime reads about 15 minutes after the push, and sometimes refuses the push outright.",
    );
    expect(page).toContain(
      "A receipt for a push sent before the app registered again does not mark the device.",
    );
    expect(page).not.toContain(
      "Expo answers a push with `DeviceNotRegistered` when the mobile app was removed",
    );
  });

  it("says a phone set up from a backup takes over the old phone's device, with its rules", () => {
    expect(page).toContain(
      "When an up-to-date mobile app is set up on a new phone from a backup of the old one, it tells OneUptime the push token it had before, and the old phone's device moves to the new phone with its rules.",
    );
    expect(page).not.toContain(
      "reinstall or a new push token creates a new device registration",
    );
  });

  it("says the relay passes receipts and Expo's error codes on", () => {
    expect(page).toContain(
      "the relay reports `DeviceNotRegistered` when it sends a push, and reads the delivery receipts your instance asks it about.",
    );
    expect(page).toContain(
      "the relay passes on Expo's error code instead of answering with a server error.",
    );
  });
});

describe("what the docs say is what the server does", () => {
  it("the relay's receipts address is the one the server asks", () => {
    expect(PushNotificationService.getRelayReceiptsUrl()).toBe(
      RELAY_RECEIPTS_URL,
    );
  });

  it("a push that never arrived reads as the docs quote it", () => {
    expect(
      PushNotificationService.getUndeliveredExpoPushMessage({
        code: "MessageRateExceeded",
      }),
    ).toMatch(/^Push notification not delivered\. /);
    expect(
      PushNotificationService.getUndeliveredExpoPushMessage({
        code: "DeviceNotRegistered",
      }),
    ).toMatch(/^Push notification not delivered\. /);
  });
});

describe.each(LANGUAGES)("Self-hosted > Push Notifications (%s)", (lang: string) => {
  const page: string = readPage(lang);

  it("lists the receipt addresses in the network table", () => {
    expect(page).toContain(
      "`https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts`",
    );
    expect(page).toContain(
      "`https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts`",
    );
  });

  it("says where the relay answers receipts", () => {
    expect(page).toContain("`/receipts`");
    expect(page).toContain("`/send`");
  });

  it("names the label a push that never arrived shows, as the server writes it", () => {
    expect(page).toContain("**Push notification not delivered**");
  });

  it("names each of Expo's receipt errors", () => {
    for (const code of [
      "`DeviceNotRegistered`",
      "`MessageRateExceeded`",
      "`MessageTooBig`",
      "`InvalidCredentials`",
      "`MismatchSenderId`",
    ]) {
      expect(page).toContain(code);
    }
  });

  it("gives the 15 minutes after which a receipt is read", () => {
    expect(page.includes("15") || page.includes("۱۵")).toBe(true);
  });

  it("has the receipts section just before the DeviceNotRegistered one", () => {
    const headings: Array<string> = page
      .split("\n")
      .filter((line: string) => {
        return line.startsWith("### ");
      });
    const deviceNotRegistered: number = headings.findIndex((line: string) => {
      return line.includes("DeviceNotRegistered");
    });

    expect(deviceNotRegistered).toBeGreaterThan(0);

    const before: string = headings[deviceNotRegistered - 1]!;

    // Translated, but every language quotes the "not delivered" state.
    expect(before).not.toContain("DeviceNotRegistered");
    expect(
      page.indexOf(before) < page.indexOf("- `MessageRateExceeded`"),
    ).toBe(true);
  });
});
