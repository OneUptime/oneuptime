import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "../../../../Server/Utils/Marketing/ConversionUploadProvider";
import { MarketingConversionType } from "../../../../Types/Marketing/MarketingConversion";
import { AxiosError } from "axios";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

class TestProvider extends ConversionUploadProvider {
  public override readonly key: string = "test";
  public override readonly displayName: string = "Test Provider";

  public override isConfigured(): boolean {
    return true;
  }

  public override getSkipReason(
    _conversion: MarketingConversion,
  ): ConversionSkip | null {
    return null;
  }

  public override async upload(
    _conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult> {
    return { permanentFailures: new Map<number, string>() };
  }

  public readClickId(
    conversion: MarketingConversion,
    key: string,
  ): string | undefined {
    return this.getClickId(conversion, key);
  }

  public readValueInUSD(conversion: MarketingConversion): number | undefined {
    return this.getValueInUSD(conversion);
  }

  public readIsSignUp(conversion: MarketingConversion): boolean {
    return this.isSignUp(conversion);
  }

  public readIsOlderThanDays(
    conversion: MarketingConversion,
    days: number,
  ): boolean {
    return this.isOlderThanDays(conversion, days);
  }
}

const makeConversion: (
  data?: Partial<MarketingConversion>,
) => MarketingConversion = (
  data: Partial<MarketingConversion> = {},
): MarketingConversion => {
  return Object.assign(new MarketingConversion(), data);
};

describe("ConversionUploadProvider", () => {
  const provider: TestProvider = new TestProvider();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("extracts a non-empty string click ID", () => {
    const conversion: MarketingConversion = makeConversion({
      clickIds: { gclid: "google-click" },
    });

    expect(provider.readClickId(conversion, "gclid")).toBe("google-click");
  });

  test.each([undefined, null, "", 0, 123, false, { nested: true }])(
    "rejects an invalid click ID value: %p",
    (value: unknown) => {
      const conversion: MarketingConversion = makeConversion({
        clickIds: { gclid: value as never },
      });

      expect(provider.readClickId(conversion, "gclid")).toBeUndefined();
    },
  );

  test("returns undefined when click IDs are absent", () => {
    const conversion: MarketingConversion = makeConversion();
    delete conversion.clickIds;

    expect(provider.readClickId(conversion, "gclid")).toBeUndefined();
  });

  test("converts cents to an exact USD decimal", () => {
    expect(
      provider.readValueInUSD(
        makeConversion({ conversionValueInUSDCents: 12345 }),
      ),
    ).toBe(123.45);
  });

  test.each([undefined, null, 0, -1, -100])(
    "omits a non-positive or missing conversion value: %p",
    (value: number | null | undefined) => {
      const conversion: MarketingConversion = makeConversion();
      conversion.conversionValueInUSDCents = value as never;

      expect(provider.readValueInUSD(conversion)).toBeUndefined();
    },
  );

  test("classifies only the SignUp conversion type as a signup", () => {
    expect(
      provider.readIsSignUp(
        makeConversion({ conversionType: MarketingConversionType.SignUp }),
      ),
    ).toBe(true);
    expect(
      provider.readIsSignUp(
        makeConversion({
          conversionType: MarketingConversionType.PaidSubscription,
        }),
      ),
    ).toBe(false);
  });

  test("checks conversion age against the provider window", () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-22T12:00:00.000Z").getTime());

    expect(
      provider.readIsOlderThanDays(
        makeConversion({
          conversionAt: new Date("2026-04-22T11:59:59.999Z"),
        }),
        90,
      ),
    ).toBe(true);
    expect(
      provider.readIsOlderThanDays(
        makeConversion({
          conversionAt: new Date("2026-07-21T12:00:00.000Z"),
        }),
        90,
      ),
    ).toBe(false);
  });

  test("uses the current time when conversionAt is missing", () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-22T12:00:00.000Z").getTime());

    expect(provider.readIsOlderThanDays(makeConversion(), 90)).toBe(false);
  });

  test("formats ordinary errors without leaking an object dump", () => {
    expect(
      ConversionUploadProvider.getErrorMessage(new Error("network down")),
    ).toBe("network down");
  });

  test("formats Axios errors with status and bounded response data", () => {
    const error: AxiosError = new AxiosError("rate limited");
    Object.assign(error, {
      response: {
        status: 429,
        data: { error: "retry later" },
      },
    });

    expect(ConversionUploadProvider.getErrorMessage(error)).toBe(
      'HTTP 429: {"error":"retry later"}',
    );
  });

  test("falls back to Unknown error for non-error values", () => {
    expect(ConversionUploadProvider.getErrorMessage(null)).toBe(
      "Unknown error",
    );
  });
});
