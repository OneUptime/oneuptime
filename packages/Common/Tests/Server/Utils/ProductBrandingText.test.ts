import { afterEach, describe, expect, test } from "@jest/globals";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import { ProductBranding } from "../../../Types/Branding/ProductBranding";
import CallRequest, {
  GatherInput,
  Say,
} from "../../../Types/Call/CallRequest";
import Phone from "../../../Types/Phone";
import URL from "../../../Types/API/URL";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";

/*
 * The installation's own name in what OneUptime sends on the paging
 * channels: SMS, voice calls and push notifications. "This is a message from
 * OneUptime" reads "This is a message from Acme" - and while the
 * installation shows OneUptime's own branding, every message is sent exactly
 * as it was written.
 */

const ACME: ProductBranding = {
  productName: "Acme",
  faviconUrl: "/api/branding/favicon?v=1",
};

const DEFAULT_ICON: string = "/dashboard/assets/img/OneUptimePNG/1.png";

afterEach(() => {
  uninstallEnterpriseModule();
});

describe("brandText", () => {
  test("names the installation's product in an SMS", () => {
    expect(
      ProductBrandingText.brandText(
        "This is a message from OneUptime. A new incident has been created. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.",
        ACME,
      ),
    ).toBe(
      "This is a message from Acme. A new incident has been created. To unsubscribe from this notification go to User Settings in Acme Dashboard.",
    );
  });

  test("leaves commands, URLs and identifiers alone", () => {
    const text: string =
      "Open https://oneuptime.com/dashboard or run oneuptime login. OneUptimeReplay is fine.";

    expect(ProductBrandingText.brandText(text, ACME)).toBe(text);
  });

  test.each([
    ["no branding", null],
    ["nothing set", {}],
    ["a logo but no name", { logoUrl: "/api/branding/logo" }],
  ])(
    "with %s, sends the text exactly as written",
    (_label: string, branding: ProductBranding | null) => {
      const text: string = "This is a message from OneUptime.";

      expect(ProductBrandingText.brandText(text, branding)).toBe(text);
    },
  );

  test("asks the enterprise module by default", () => {
    installFakeEnterpriseModule({ productBranding: ACME });

    expect(ProductBrandingText.brandText("Sign in to OneUptime")).toBe(
      "Sign in to Acme",
    );
    expect(ProductBrandingText.getProductName()).toBe("Acme");

    uninstallEnterpriseModule();

    expect(ProductBrandingText.brandText("Sign in to OneUptime")).toBe(
      "Sign in to OneUptime",
    );
    expect(ProductBrandingText.getProductName()).toBe("OneUptime");
  });
});

describe("brandCallRequest", () => {
  const callRequest: () => CallRequest = (): CallRequest => {
    const gather: GatherInput = {
      introMessage: "This is a call from OneUptime. Press 1 to acknowledge.",
      numDigits: 1,
      timeoutInSeconds: 10,
      noInputMessage: "You did not press anything. OneUptime will call again.",
      onInputCallRequest: {
        "1": { sayMessage: "Acknowledged in OneUptime. Good bye." },
        default: { sayMessage: "Invalid input. Good bye from OneUptime." },
      },
      responseUrl: URL.fromString("https://oneuptime.example/api/call"),
    };

    return {
      to: new Phone("+15550000000"),
      data: [
        { sayMessage: "This is a message from OneUptime." } as Say,
        gather,
      ],
    };
  };

  test("names the product in every sentence the call says", () => {
    const branded: CallRequest = ProductBrandingText.brandCallRequest(
      callRequest(),
      ACME,
    );

    expect((branded.data[0] as Say).sayMessage).toBe(
      "This is a message from Acme.",
    );

    const gather: GatherInput = branded.data[1] as GatherInput;

    expect(gather.introMessage).toBe(
      "This is a call from Acme. Press 1 to acknowledge.",
    );
    expect(gather.noInputMessage).toBe(
      "You did not press anything. Acme will call again.",
    );
    expect(gather.onInputCallRequest["1"]?.sayMessage).toBe(
      "Acknowledged in Acme. Good bye.",
    );
    expect(gather.onInputCallRequest.default.sayMessage).toBe(
      "Invalid input. Good bye from Acme.",
    );
    expect(gather.numDigits).toBe(1);
    expect(gather.responseUrl.toString()).toBe(
      "https://oneuptime.example/api/call",
    );
  });

  test("does not change the request it was given", () => {
    const original: CallRequest = callRequest();

    ProductBrandingText.brandCallRequest(original, ACME);

    expect((original.data[0] as Say).sayMessage).toBe(
      "This is a message from OneUptime.",
    );
  });

  test("hands the same request back when the installation is not renamed", () => {
    const original: CallRequest = callRequest();

    expect(ProductBrandingText.brandCallRequest(original, null)).toBe(original);
    expect(ProductBrandingText.brandCallRequest(original, {})).toBe(original);
  });
});

describe("brandPushMessage", () => {
  const message: () => PushNotificationMessage =
    (): PushNotificationMessage => {
      return {
        title: "OneUptime: New Monitor Created",
        body: "A monitor was created in OneUptime.",
        icon: DEFAULT_ICON,
        badge: "/dashboard/assets/img/OneUptimePNG/6.png",
        url: "https://oneuptime.example/dashboard",
      };
    };

  test("names the product and shows the installation's tab icon", () => {
    expect(
      ProductBrandingText.brandPushMessage(message(), [DEFAULT_ICON], ACME),
    ).toEqual({
      title: "Acme: New Monitor Created",
      body: "A monitor was created in Acme.",
      icon: "/api/branding/favicon?v=1",
      badge: "/dashboard/assets/img/OneUptimePNG/6.png",
      url: "https://oneuptime.example/dashboard",
    });
  });

  test("keeps an icon a notification chose itself", () => {
    expect(
      ProductBrandingText.brandPushMessage(
        { ...message(), icon: "/custom/icon.png" },
        [DEFAULT_ICON],
        ACME,
      ).icon,
    ).toBe("/custom/icon.png");
  });

  test("keeps OneUptime's icon when the installation has no tab icon of its own", () => {
    expect(
      ProductBrandingText.brandPushMessage(
        message(),
        [DEFAULT_ICON],
        { productName: "Acme" },
      ).icon,
    ).toBe(DEFAULT_ICON);
  });

  test("a tab icon alone changes the icon and not the words", () => {
    const branded: PushNotificationMessage =
      ProductBrandingText.brandPushMessage(message(), [DEFAULT_ICON], {
        faviconUrl: "/api/branding/favicon?v=2",
      });

    expect(branded.title).toBe("OneUptime: New Monitor Created");
    expect(branded.icon).toBe("/api/branding/favicon?v=2");
  });

  test("sends the message as it was without branding", () => {
    const original: PushNotificationMessage = message();

    expect(
      ProductBrandingText.brandPushMessage(original, [DEFAULT_ICON], null),
    ).toBe(original);
  });
});
