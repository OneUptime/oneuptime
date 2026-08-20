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
  MarketingConversionType,
} from "../../../../Types/Marketing/MarketingConversion";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * ---------------------------------------------------------------------------
 * Which conversion types may be uploaded to an ad platform at all.
 *
 * Every provider chooses its platform conversion action with a two-way branch:
 *
 *     this.isSignUp(conversion) ? signUpAction : paidSubscriptionAction
 *
 * There is no third arm. So a conversion type nobody wrote a mapping for --
 * MeetingBooked being the first one -- does not get skipped by that branch, it
 * gets uploaded to Google, Meta, Microsoft, LinkedIn and Reddit as a PURCHASE,
 * carrying whatever revenue the ledger row happens to hold. Every downstream
 * bid model then optimises against a booking that bought nothing.
 *
 * The screen is therefore in the base class, ahead of every provider hook,
 * where no provider and no call site can route around it.
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
    test("covers exactly the types every provider has a mapping for", () => {
      expect(AdUploadableMarketingConversionTypes).toEqual([
        MarketingConversionType.SignUp,
        MarketingConversionType.PaidSubscription,
      ]);
    });

    /*
     * This is the assertion that fails when someone adds a conversion type.
     * That failure is the prompt to write the per-provider mapping before
     * adding the type to the allowlist -- not to update this expectation.
     */
    test("does not silently grow when a conversion type is added", () => {
      const unlisted: Array<string> = Object.values(
        MarketingConversionType,
      ).filter((type: string) => {
        return !AdUploadableMarketingConversionTypes.includes(
          type as MarketingConversionType,
        );
      });

      expect(unlisted).toEqual([MarketingConversionType.MeetingBooked]);
    });
  });

  describe("the base class screen", () => {
    let provider: TestProvider;

    beforeEach(() => {
      provider = new TestProvider();
    });

    test("permanently skips a conversion type with no ad platform mapping", () => {
      const skip: ConversionSkip | null = provider.getSkipReason(
        makeConversion({
          conversionType: MarketingConversionType.MeetingBooked,
        }),
      );

      expect(skip).toEqual({
        reason:
          "Conversion type MeetingBooked has no ad platform conversion mapping",
        isPermanent: true,
      });
    });

    test("never lets the provider see an unmapped conversion type", () => {
      provider.getSkipReason(
        makeConversion({
          conversionType: MarketingConversionType.MeetingBooked,
        }),
      );

      expect(provider.providerSkipCalls).toBe(0);
    });

    test.each([
      ["an unknown type", "SomethingElse"],
      ["an empty type", ""],
      ["a lookalike with different casing", "meetingbooked"],
      ["a lookalike with different casing", "signup"],
    ])("permanently skips %s", (_label: string, conversionType: string) => {
      const skip: ConversionSkip | null = provider.getSkipReason(
        makeConversion({ conversionType: conversionType }),
      );

      expect(skip?.isPermanent).toBe(true);
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

    test.each([
      [MarketingConversionType.SignUp],
      [MarketingConversionType.PaidSubscription],
    ])(
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

  /*
   * The screen is exercised through the real providers too: the guard living
   * in the base class is only worth anything if no provider has quietly
   * overridden getSkipReason back.
   */
  describe("every shipped provider", () => {
    const providers: Array<[string, ConversionUploadProvider]> = [
      ["Google Ads", new GoogleAdsProvider()],
      ["Meta", new MetaProvider()],
      ["Microsoft Ads", new MicrosoftAdsProvider()],
      ["LinkedIn", new LinkedInProvider()],
      ["Reddit Ads", new RedditAdsProvider()],
    ];

    test.each(providers)(
      "%s permanently skips a booked meeting that carries its click id",
      (_name: string, provider: ConversionUploadProvider) => {
        const skip: ConversionSkip | null = provider.getSkipReason(
          makeConversion({
            conversionType: MarketingConversionType.MeetingBooked,
          }),
        );

        expect(skip).toEqual({
          reason:
            "Conversion type MeetingBooked has no ad platform conversion mapping",
          isPermanent: true,
        });
      },
    );

    test.each(providers)(
      "%s never uploads a booked meeting as a purchase",
      async (_name: string, provider: ConversionUploadProvider) => {
        const meeting: MarketingConversion = makeConversion({
          conversionType: MarketingConversionType.MeetingBooked,
          conversionValueInUSDCents: 500000,
        });
        const uploadSpy: SpyInstance<
          (
            conversions: Array<MarketingConversion>,
          ) => Promise<ConversionUploadBatchResult>
        > = jest.spyOn(provider, "upload");
        uploadSpy.mockResolvedValue({
          permanentFailures: new Map<number, string>(),
        } as never);

        /*
         * The worker only ever calls upload() for conversions getSkipReason
         * cleared, so a permanent skip is exactly "this never reaches the
         * platform".
         */
        if (!provider.getSkipReason(meeting)) {
          await provider.upload([meeting]);
        }

        expect(uploadSpy).not.toHaveBeenCalled();
        uploadSpy.mockRestore();
      },
    );
  });
});
