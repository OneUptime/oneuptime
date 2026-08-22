import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "../../../../Server/Utils/Marketing/ConversionUploadProvider";
import GoogleAdsProvider from "../../../../Server/Utils/Marketing/Providers/GoogleAds";
import LinkedInProvider from "../../../../Server/Utils/Marketing/Providers/LinkedIn";
import MetaProvider from "../../../../Server/Utils/Marketing/Providers/Meta";
import MicrosoftAdsProvider from "../../../../Server/Utils/Marketing/Providers/MicrosoftAds";
import RedditAdsProvider from "../../../../Server/Utils/Marketing/Providers/Reddit";
import {
  AdUploadableMarketingConversionTypes,
  LeadMarketingConversionTypes,
  MarketingConversionType,
} from "../../../../Types/Marketing/MarketingConversion";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Which conversion types may be uploaded to an ad platform, and as what.
 *
 * THE HAZARD THIS GUARDS
 *
 * Providers used to choose their platform conversion action with a two-way
 * branch:
 *
 *     this.isSignUp(conversion) ? signUpAction : paidSubscriptionAction
 *
 * There was no third arm, so a conversion type nobody had written a mapping
 * for did not get skipped by that branch — it was uploaded to Google, Meta,
 * Microsoft, LinkedIn and Reddit as a PURCHASE carrying whatever revenue the
 * row happened to hold. The old defence was to keep such types out of the
 * uploadable allowlist entirely, which kept sales-led conversions out of the
 * ad platforms altogether.
 *
 * They are in the allowlist now, and the defence is structural instead: every
 * provider resolves its action through a Record over the conversion-type enum,
 * which the compiler will not accept unless every member is named. What is
 * left for these tests is everything the type system cannot see:
 *
 *   - the column is a plain varchar, so a value that is not a known type at
 *     all must still be refused, permanently, before any provider sees it;
 *   - an unconfigured mapping must leave the row PENDING, not discard it —
 *     the difference between "we have not set this up yet" and "this can never
 *     be uploaded";
 *   - a lead (a booked meeting, a licence request) must never carry revenue to
 *     any platform, whatever the row says, or bid models optimise towards
 *     demos that buy nothing.
 * ---------------------------------------------------------------------------
 */

class TestProvider extends ConversionUploadProvider {
  public override readonly key: string = "test";
  public override readonly displayName: string = "Test Provider";
  public providerSkipCalls: number = 0;
  public providerSkip: ConversionSkip | null = null;

  public override isConfigured(): boolean {
    return true;
  }

  protected override getProviderSkipReason(
    _conversion: MarketingConversion,
  ): ConversionSkip | null {
    this.providerSkipCalls++;
    return this.providerSkip;
  }

  public override async upload(
    _conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult> {
    return { permanentFailures: new Map<number, string>() };
  }

  public readValueInUSD(conversion: MarketingConversion): number | undefined {
    return this.getValueInUSD(conversion);
  }
}

type MakeConversionFunction = (
  data?: Partial<MarketingConversion>,
) => MarketingConversion;

const makeConversion: MakeConversionFunction = (
  data: Partial<MarketingConversion> = {},
): MarketingConversion => {
  return Object.assign(new MarketingConversion(), {
    conversionType: MarketingConversionType.SignUp,
    conversionAt: new Date("2026-08-19T10:00:00.000Z"),
    // One click id per platform, so nothing is skipped for lack of one.
    clickIds: {
      gclid: "google-click",
      fbclid: "meta-click",
      msclkid: "microsoft-click",
      li_fat_id: "linkedin-click",
      rdt_cid: "reddit-click",
    },
    ...data,
  });
};

describe("ad-uploadable conversion types", () => {
  describe("the allowlist itself", () => {
    /*
     * Every type is uploadable now, which is only safe because every provider
     * maps every type. If a type is ever removed from this list again, that is
     * a deliberate "no platform should hear about this" decision and should be
     * spelled out here.
     */
    test("covers every conversion type the ledger records", () => {
      expect([...AdUploadableMarketingConversionTypes].sort()).toEqual(
        [...Object.values(MarketingConversionType)].sort(),
      );
    });

    /*
     * A booked meeting is the ONLY sales-led conversion. Asking about an
     * enterprise licence and booking an architecture assessment are the same
     * conversation reached through the same Cal embed, so they are the same
     * conversion — not two types that would split the signal in reporting and
     * need separate conversion actions on five platforms.
     */
    test("classifies a booked meeting as the only sales-led step", () => {
      expect(LeadMarketingConversionTypes).toEqual([
        MarketingConversionType.MeetingBooked,
      ]);
    });

    test("never classifies a completed transaction as a lead", () => {
      expect(LeadMarketingConversionTypes).not.toContain(
        MarketingConversionType.SignUp,
      );
      expect(LeadMarketingConversionTypes).not.toContain(
        MarketingConversionType.PaidSubscription,
      );
    });
  });

  describe("the base class screen", () => {
    let provider: TestProvider;

    beforeEach(() => {
      provider = new TestProvider();
    });

    test.each([
      ["an unknown type", "SomethingElse"],
      ["an empty type", ""],
      ["a lookalike with different casing", "meetingbooked"],
      ["a lookalike with different casing", "signup"],
      ["a lookalike with different casing", "enterpriselicenserequested"],
    ])("permanently skips %s", (_label: string, conversionType: string) => {
      const skip: ConversionSkip | null = provider.getSkipReason(
        makeConversion({ conversionType: conversionType }),
      );

      expect(skip?.isPermanent).toBe(true);
      // The provider is never consulted about a type the ledger cannot name.
      expect(provider.providerSkipCalls).toBe(0);
    });

    test("names an absent conversion type as unknown rather than blank", () => {
      const conversion: MarketingConversion = makeConversion();
      delete conversion.conversionType;

      expect(provider.getSkipReason(conversion)).toEqual({
        reason: "Conversion type unknown has no ad platform conversion mapping",
        isPermanent: true,
      });
    });

    test.each(Object.values(MarketingConversionType))(
      "delegates %s to the provider",
      (conversionType: MarketingConversionType) => {
        expect(
          provider.getSkipReason(
            makeConversion({ conversionType: conversionType }),
          ),
        ).toBeNull();
        expect(provider.providerSkipCalls).toBe(1);
      },
    );

    test("returns the provider's own skip verbatim for a mapped type", () => {
      provider.providerSkip = {
        reason: "No Google click id",
        isPermanent: true,
      };

      expect(provider.getSkipReason(makeConversion())).toEqual({
        reason: "No Google click id",
        isPermanent: true,
      });
    });
  });

  describe("lead conversions never carry revenue", () => {
    const provider: TestProvider = new TestProvider();

    test.each(LeadMarketingConversionTypes)(
      "%s reports no value even when the row holds one",
      (conversionType: MarketingConversionType) => {
        /*
         * A row can legitimately hold a value here — nothing stops an operator
         * assigning an estimated pipeline value to a booked meeting — and the
         * platform still must not be told it as revenue.
         */
        expect(
          provider.readValueInUSD(
            makeConversion({
              conversionType: conversionType,
              conversionValueInUSDCents: 500000,
            }),
          ),
        ).toBeUndefined();
      },
    );

    test("a paid subscription still reports its value", () => {
      expect(
        provider.readValueInUSD(
          makeConversion({
            conversionType: MarketingConversionType.PaidSubscription,
            conversionValueInUSDCents: 500000,
          }),
        ),
      ).toBe(5000);
    });
  });

  /*
   * Exercised through the real providers too: a structural guarantee in the
   * base class is only worth something if no provider has quietly overridden
   * getSkipReason back.
   *
   * These run with no ad-platform environment configured, which is the state a
   * fresh checkout and CI are in — so what they assert is the behaviour of an
   * UNCONFIGURED deployment, which is where the dangerous failure mode lives:
   * a row silently thrown away is unrecoverable, a row left pending is not.
   */
  describe("every shipped provider, unconfigured", () => {
    const providers: Array<[string, ConversionUploadProvider]> = [
      ["Google Ads", new GoogleAdsProvider()],
      ["Meta", new MetaProvider()],
      ["Microsoft Ads", new MicrosoftAdsProvider()],
      ["LinkedIn", new LinkedInProvider()],
      ["Reddit Ads", new RedditAdsProvider()],
    ];

    test.each(providers)(
      "%s still permanently refuses an unknown conversion type",
      (_name: string, provider: ConversionUploadProvider) => {
        expect(
          provider.getSkipReason(
            makeConversion({ conversionType: "NotARealType" }),
          ),
        ).toEqual({
          reason:
            "Conversion type NotARealType has no ad platform conversion mapping",
          isPermanent: true,
        });
      },
    );

    /*
     * Google, Microsoft and LinkedIn each need an operator-supplied conversion
     * action per type. Unset, that is a config gap: the row waits.
     */
    const configuredByOperator: Array<[string, ConversionUploadProvider]> = [
      ["Google Ads", new GoogleAdsProvider()],
      ["Microsoft Ads", new MicrosoftAdsProvider()],
      ["LinkedIn", new LinkedInProvider()],
    ];

    test.each(configuredByOperator)(
      "%s leaves a booked meeting pending rather than discarding it",
      (_name: string, provider: ConversionUploadProvider) => {
        const skip: ConversionSkip | null = provider.getSkipReason(
          makeConversion({
            conversionType: MarketingConversionType.MeetingBooked,
          }),
        );

        expect(skip).not.toBeNull();
        expect(skip?.isPermanent).toBe(false);
        expect(skip?.reason).toMatch(/conversion (action id|name|rule id)/i);
      },
    );

    /*
     * Meta and Reddit name their events with platform constants rather than an
     * operator-configured id, so there is nothing to be missing: a booked
     * meeting is uploadable as soon as it has an identifier.
     */
    const selfDescribing: Array<[string, ConversionUploadProvider]> = [
      ["Meta", new MetaProvider()],
      ["Reddit Ads", new RedditAdsProvider()],
    ];

    test.each(selfDescribing)(
      "%s accepts a booked meeting outright",
      (_name: string, provider: ConversionUploadProvider) => {
        expect(
          provider.getSkipReason(
            makeConversion({
              conversionType: MarketingConversionType.MeetingBooked,
              // Inside Meta's and Reddit's 7-day window.
              conversionAt: new Date(),
            }),
          ),
        ).toBeNull();
      },
    );
  });
});
