import ConversionUploadProvider from "./ConversionUploadProvider";
import GoogleAdsProvider from "./Providers/GoogleAds";
import LinkedInProvider from "./Providers/LinkedIn";
import MetaProvider from "./Providers/Meta";
import MicrosoftAdsProvider from "./Providers/MicrosoftAds";
import RedditProvider from "./Providers/Reddit";

/*
 * All ad platforms OneUptime can upload offline conversions to. To add a
 * platform: implement ConversionUploadProvider (one file under Providers/),
 * add its env config to EnvironmentConfig, and list it here — no schema or
 * worker changes needed. Unconfigured providers are ignored at runtime.
 */
const AllConversionUploadProviders: Array<ConversionUploadProvider> = [
  new GoogleAdsProvider(),
  new MetaProvider(),
  new MicrosoftAdsProvider(),
  new LinkedInProvider(),
  new RedditProvider(),
];

export default AllConversionUploadProviders;
