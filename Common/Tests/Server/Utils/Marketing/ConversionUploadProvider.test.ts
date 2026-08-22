import Attribution from "../../../../Server/Utils/Attribution";
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

  protected override getProviderSkipReason(
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

  public readIsLead(conversion: MarketingConversion): boolean {
    return this.isLead(conversion);
  }

  public readHashedEmail(conversion: MarketingConversion): string | undefined {
    return this.getHashedEmail(conversion);
  }

  public readByConversionType(
    conversion: MarketingConversion,
  ): string | undefined {
    return this.resolveByConversionType(conversion, {
      [MarketingConversionType.SignUp]: "signup-action",
      [MarketingConversionType.MeetingBooked]: "meeting-action",
      [MarketingConversionType.PaidSubscription]: "paid-action",
    });
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

  test("classifies a booked meeting as the sales-led step", () => {
    expect(
      provider.readIsLead(
        makeConversion({
          conversionType: MarketingConversionType.MeetingBooked,
        }),
      ),
    ).toBe(true);
    expect(
      provider.readIsLead(
        makeConversion({ conversionType: MarketingConversionType.SignUp }),
      ),
    ).toBe(false);
    expect(
      provider.readIsLead(
        makeConversion({
          conversionType: MarketingConversionType.PaidSubscription,
        }),
      ),
    ).toBe(false);
  });

  /*
   * A lead's value is suppressed at the base class, not at each call site, so
   * a provider cannot forget to do it.
   */
  test("suppresses the conversion value for a lead", () => {
    expect(
      provider.readValueInUSD(
        makeConversion({
          conversionType: MarketingConversionType.MeetingBooked,
          conversionValueInUSDCents: 99900,
        }),
      ),
    ).toBeUndefined();
  });

  describe("resolveByConversionType", () => {
    test.each([
      [MarketingConversionType.SignUp, "signup-action"],
      [MarketingConversionType.MeetingBooked, "meeting-action"],
      [MarketingConversionType.PaidSubscription, "paid-action"],
    ])(
      "maps %s to its own entry",
      (conversionType: MarketingConversionType, expected: string) => {
        expect(
          provider.readByConversionType(
            makeConversion({ conversionType: conversionType }),
          ),
        ).toBe(expected);
      },
    );

    /*
     * conversionType is a plain varchar. A value the enum does not name must
     * resolve to nothing rather than to whichever entry a loose lookup would
     * land on — that is the failure mode that used to send a booked meeting as
     * a purchase.
     */
    test.each(["SomethingElse", "", "signup", "MEETINGBOOKED"])(
      "resolves nothing for the unrecognised type %p",
      (conversionType: string) => {
        expect(
          provider.readByConversionType(
            makeConversion({ conversionType: conversionType }),
          ),
        ).toBeUndefined();
      },
    );

    test("resolves nothing when the type is absent", () => {
      const conversion: MarketingConversion = makeConversion();
      delete conversion.conversionType;

      expect(provider.readByConversionType(conversion)).toBeUndefined();
    });
  });

  describe("getHashedEmail", () => {
    /*
     * Deliberately NOT the real digest of the email beside it, so the first
     * test can only pass by returning the stored column rather than by
     * recomputing and happening to agree.
     */
    const STORED_DIGEST: string =
      "cc1dbbd8a5f5a4e9c0e2e4ba2c1e18c05f5c9e0e3d3b6c7bbd2d47d5a8f0e1f0";

    test("prefers the stored hash over rehashing the address", () => {
      expect(
        provider.readHashedEmail(
          makeConversion({
            email: "ada@example.com",
            emailHash: STORED_DIGEST,
          }),
        ),
      ).toBe(STORED_DIGEST);
      expect(STORED_DIGEST).not.toBe(Attribution.hashEmail("ada@example.com"));
    });

    /*
     * Rows written before emailHash existed still have to be matchable, or
     * enhanced matching would only ever work for conversions recorded after
     * this column shipped.
     */
    test("falls back to hashing the email column", () => {
      const hashed: string | undefined = provider.readHashedEmail(
        makeConversion({ email: "Ada@Example.com  " }),
      );

      expect(hashed).toBe(Attribution.hashEmail("ada@example.com"));
    });

    test("returns undefined when there is neither", () => {
      expect(provider.readHashedEmail(makeConversion())).toBeUndefined();
    });
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
