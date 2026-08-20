import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "../../../../Server/Utils/Marketing/ConversionUploadProvider";
import { MarketingConversionType } from "../../../../Types/Marketing/MarketingConversion";
import { describe, expect, test } from "@jest/globals";

class TestProvider extends ConversionUploadProvider {
  public override readonly key: string = "test";
  public override readonly displayName: string = "Test";

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
}

describe("MeetingBooked marketing conversions", () => {
  test("is a canonical ledger type", () => {
    expect(MarketingConversionType.MeetingBooked).toBe("MeetingBooked");
  });

  test("cannot fall through to paid ad conversion mappings", () => {
    const conversion: MarketingConversion = new MarketingConversion();
    conversion.conversionType = MarketingConversionType.MeetingBooked;

    expect(new TestProvider().isUploadableConversionType(conversion)).toBe(
      false,
    );
  });

  test("keeps the existing signup and paid conversion types uploadable", () => {
    const provider: TestProvider = new TestProvider();
    const signup: MarketingConversion = new MarketingConversion();
    signup.conversionType = MarketingConversionType.SignUp;
    const paid: MarketingConversion = new MarketingConversion();
    paid.conversionType = MarketingConversionType.PaidSubscription;

    expect(provider.isUploadableConversionType(signup)).toBe(true);
    expect(provider.isUploadableConversionType(paid)).toBe(true);
  });
});
