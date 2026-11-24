import { Screenshot } from "Common/Types/Monitor/SyntheticMonitors/Screenshot";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getSyntheticScreenshotCaption } from "Common/Utils/Monitor/SyntheticTimedOutPageScreenshot";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  screenshot: Screenshot;
  screenshotName: string;
}

const SummarysScreenshot: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The name the script gave its screenshot, as written, or the probe's
   * own screenshot of a page a timed-out script left open, in the reader's
   * words (SyntheticTimedOutPageScreenshot).
   */
  const caption: string = getSyntheticScreenshotCaption({
    translator,
    screenshotName: props.screenshotName,
  });

  /// props.scresnshot is in base64 format
  return (
    <div className="w-fit">
      <div className="">
        <img
          className="rounded-md w-fit h-fit shadow m-1"
          src={`data:image/png;base64,${props.screenshot}`}
          alt={caption}
        />
      </div>
      <div className="text-gray-500 m-1 w-full flex justify-center">
        {caption}
      </div>
    </div>
  );
};

export default SummarysScreenshot;
