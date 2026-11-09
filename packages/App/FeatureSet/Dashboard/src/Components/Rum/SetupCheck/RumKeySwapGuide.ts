import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SetupGuideContent, codeBlock } from "../../SetupGuide/SetupGuide";
import { RUM_TROUBLESHOOTING_DOCS_URL, RumClient } from "../RumSetupGuide";

/*
 * "Pick another key" (issue #6378): the key a RUM application sends with is
 * turned off or has expired, so everything sent with it is refused, and the
 * fix is another key in its place. The application is set up already, so
 * this is not its whole setup guide - the packages, the telemetry file and
 * the checks it has done once - but the three steps a new key takes: pick
 * one that is not refused (or create one), put it where the refused one
 * is, and deploy.
 *
 * Pure. Every word is a translation key the guide card draws in the
 * reader's language; the code is code, carrying the key picked in step 1.
 */

export const RUM_CHECK_THE_KEY_DOCS_URL: string = `${RUM_TROUBLESHOOTING_DOCS_URL}#check-the-key`;

export const KEY_SWAP_KEY_STEP: Readonly<Record<RumClient, string>> = {
  browser: translationKey(
    "Pick a Browser key that is turned on and allows your site's origin, or create one.",
  ),
  mobile: translationKey("Pick a Server key that is turned on, or create one."),
};

export const KEY_SWAP_PUT_IT_IN_TITLE: string = translationKey(
  "Put it in place of the refused key",
);

export const KEY_SWAP_PUT_IT_IN: Readonly<Record<RumClient, string>> = {
  browser: translationKey(
    "Your trace exporter in src/telemetry.ts sends with the refused key. Put this one in its place there, and in anything else that sends with it, such as a log exporter or Session Replay.",
  ),
  mobile: translationKey(
    "Your app sends with the refused key in the x-oneuptime-token header. Put this one in its place, in OTEL_EXPORTER_OTLP_HEADERS or wherever your app sets that header in code.",
  ),
};

export const KEY_SWAP_CHECK_TITLE: Readonly<Record<RumClient, string>> = {
  browser: translationKey("Deploy and check"),
  mobile: translationKey("Release and check"),
};

export const KEY_SWAP_CHECK: Readonly<Record<RumClient, string>> = {
  browser: translationKey(
    "Deploy the change and load a page of your site. Within a minute, the setup check on this app's Documentation tab shows its telemetry arriving again.",
  ),
  mobile: translationKey(
    "Release a build with the new key and open the app. Within a minute, the setup check on this app's Documentation tab shows its telemetry arriving again. Copies already installed keep sending with the refused key until they update.",
  ),
};

// The line the refused key is on, with the picked key in its place.
export function getRumKeySwapSnippet(data: {
  client: RumClient;
  apiKey: string;
}): string {
  if (data.client === "mobile") {
    return `OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${data.apiKey}"`;
  }

  return `headers: { "x-oneuptime-token": "${data.apiKey}" },`;
}

export function getRumKeySwapGuide(data: {
  client: RumClient;
  oneuptimeUrl: string;
  apiKey: string;
}): SetupGuideContent {
  const isMobile: boolean = data.client === "mobile";

  return {
    keyStep: {
      description: KEY_SWAP_KEY_STEP[data.client],
      // Where it sends does not change: the endpoint is there to check by.
      endpointLabel: translationKey("OTLP Endpoint"),
      endpointValue: `${data.oneuptimeUrl}/otlp`,
    },
    // A phone reads the whole header line, key and all, without scrolling.
    wrapLongLines: true,
    steps: [
      {
        title: KEY_SWAP_PUT_IT_IN_TITLE,
        description: KEY_SWAP_PUT_IT_IN[data.client],
        markdown: codeBlock(
          isMobile ? "bash" : "ts",
          getRumKeySwapSnippet({ client: data.client, apiKey: data.apiKey }),
        ),
      },
      {
        title: KEY_SWAP_CHECK_TITLE[data.client],
        description: KEY_SWAP_CHECK[data.client],
      },
    ],
    links: [{ title: "RUM troubleshooting", url: RUM_CHECK_THE_KEY_DOCS_URL }],
  };
}
