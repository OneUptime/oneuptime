import {
  HelpChoice,
  HelpItemSetting,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import {
  GIVE_FEEDBACK_NOT_TAKEN_MESSAGE,
  GiveFeedbackDestination,
  ONEUPTIME_SUPPORT_EMAIL,
  ProductFeedbackSettings,
  getGiveFeedbackDestination,
  isGiveFeedbackEmailed,
  isGiveFeedbackOffered,
  readProductFeedbackSettings,
} from "../../../Types/ProductFeedback/ProductFeedback";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE GIVE FEEDBACK GOES, ONCE A SERVER'S ADMINS CAN CHOOSE (#10865).
 *
 * By default exactly as before (#8893): the OneUptime team on OneUptime
 * Cloud, a self-hosted server's admins at its Admin Notification Email, or
 * kept for them in Admin Dashboard > Feedback. A server's admins can send it
 * to an address of their own - offered only while the server can send email,
 * so nothing anyone writes is silently dropped - or to a page of their own
 * that Give feedback opens, or hide it.
 */

const setting: (choice: HelpChoice, value?: string) => HelpItemSetting = (
  choice: HelpChoice,
  value?: string,
): HelpItemSetting => {
  return { choice: choice, value: value ?? null };
};

describe("where Give feedback goes", () => {
  test("by default, exactly as before", () => {
    expect(
      getGiveFeedbackDestination({
        isOneUptimeCloud: true,
        adminNotificationEmail: "admins@example.com",
      }),
    ).toBe(GiveFeedbackDestination.OneUptimeTeam);
    expect(
      getGiveFeedbackDestination({
        isOneUptimeCloud: false,
        adminNotificationEmail: "admins@example.com",
        giveFeedback: setting(HelpChoice.Default),
      }),
    ).toBe(GiveFeedbackDestination.ServerAdminsByEmail);
    expect(
      getGiveFeedbackDestination({
        isOneUptimeCloud: false,
        adminNotificationEmail: " ",
        giveFeedback: setting(HelpChoice.Default),
      }),
    ).toBe(GiveFeedbackDestination.ServerAdmins);
    expect(ONEUPTIME_SUPPORT_EMAIL).toBe("support@oneuptime.com");
  });

  test("to an address of the server's own, in place of the Admin Notification Email", () => {
    expect(
      getGiveFeedbackDestination({
        isOneUptimeCloud: false,
        adminNotificationEmail: "admins@example.com",
        giveFeedback: setting(HelpChoice.Email, "support-team@example.com"),
      }),
    ).toBe(GiveFeedbackDestination.SupportTeamByEmail);
  });

  test("to a page of the server's own", () => {
    expect(
      getGiveFeedbackDestination({
        isOneUptimeCloud: false,
        adminNotificationEmail: null,
        giveFeedback: setting(
          HelpChoice.Link,
          "https://desk.example.com/feedback",
        ),
      }),
    ).toBe(GiveFeedbackDestination.SupportPage);
  });

  test("is emailed only where an address is", () => {
    expect(isGiveFeedbackEmailed(GiveFeedbackDestination.OneUptimeTeam)).toBe(
      true,
    );
    expect(
      isGiveFeedbackEmailed(GiveFeedbackDestination.ServerAdminsByEmail),
    ).toBe(true);
    expect(
      isGiveFeedbackEmailed(GiveFeedbackDestination.SupportTeamByEmail),
    ).toBe(true);
    expect(isGiveFeedbackEmailed(GiveFeedbackDestination.ServerAdmins)).toBe(
      false,
    );
    expect(isGiveFeedbackEmailed(GiveFeedbackDestination.SupportPage)).toBe(
      false,
    );
  });
});

describe("whether Give feedback is offered", () => {
  test("by default, as it always was, whether or not the server can send email", () => {
    for (const canSendEmail of [true, false]) {
      expect(
        isGiveFeedbackOffered({
          giveFeedback: setting(HelpChoice.Default),
          canSendEmail: canSendEmail,
        }),
      ).toBe(true);
      expect(isGiveFeedbackOffered({ canSendEmail: canSendEmail })).toBe(true);
    }
  });

  test("to an address of the server's own, only while the server can send email", () => {
    expect(
      isGiveFeedbackOffered({
        giveFeedback: setting(HelpChoice.Email, "support-team@example.com"),
        canSendEmail: true,
      }),
    ).toBe(true);
    expect(
      isGiveFeedbackOffered({
        giveFeedback: setting(HelpChoice.Email, "support-team@example.com"),
        canSendEmail: false,
      }),
    ).toBe(false);
  });

  test("to a page of the server's own, without needing email", () => {
    expect(
      isGiveFeedbackOffered({
        giveFeedback: setting(HelpChoice.Link, "https://desk.example.com"),
        canSendEmail: false,
      }),
    ).toBe(true);
  });

  test("never where it is hidden", () => {
    expect(
      isGiveFeedbackOffered({
        giveFeedback: setting(HelpChoice.Hidden),
        canSendEmail: true,
      }),
    ).toBe(false);
  });

  test("a refusal says where to look", () => {
    expect(GIVE_FEEDBACK_NOT_TAKEN_MESSAGE).toBe(
      "This server does not take Give feedback here. Open Help to see where to send it.",
    );
  });
});

describe("the settings the Dashboard reads", () => {
  test("carry whether Give feedback is offered, and the address or page", () => {
    expect(
      readProductFeedbackSettings({
        isOn: true,
        isAskingMe: true,
        giveFeedbackGoesTo: "support_team_by_email",
        isGiveFeedbackOffered: true,
        giveFeedbackTo: "support-team@example.com",
      }),
    ).toEqual({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.SupportTeamByEmail,
      isGiveFeedbackOffered: true,
      giveFeedbackTo: "support-team@example.com",
    } as ProductFeedbackSettings);

    expect(
      readProductFeedbackSettings({
        isOn: true,
        isAskingMe: false,
        giveFeedbackGoesTo: "support_page",
        isGiveFeedbackOffered: true,
        giveFeedbackUrl: "https://desk.example.com/feedback",
      })?.giveFeedbackUrl,
    ).toBe("https://desk.example.com/feedback");
  });

  test("an older server's answer still reads, offering Give feedback as before", () => {
    expect(
      readProductFeedbackSettings({
        isOn: true,
        isAskingMe: true,
        giveFeedbackGoesTo: "server_admins",
      }),
    ).toEqual({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdmins,
    });
  });

  test("an unsafe page or a broken address is never read", () => {
    const settings: ProductFeedbackSettings | null =
      readProductFeedbackSettings({
        isOn: true,
        isAskingMe: true,
        giveFeedbackGoesTo: "support_page",
        giveFeedbackUrl: "javascript:alert(1)",
        giveFeedbackTo: "Alice <a@example.com>",
        isGiveFeedbackOffered: "yes",
      });

    expect(settings?.giveFeedbackUrl).toBeUndefined();
    expect(settings?.giveFeedbackTo).toBeUndefined();
    expect(settings?.isGiveFeedbackOffered).toBeUndefined();
  });
});
