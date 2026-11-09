import Color from "Common/Types/Color";
import { Gray500, Green } from "Common/Types/BrandColors";
import { RumApplicationStatusTone } from "Common/Types/Rum/RumApplicationStatus";

/*
 * The colour of a RUM application's status pill in a list: green while its
 * data arrives, grey while it waits for its first data or nobody is using
 * the app. Never red - neither is a fault (RumApplicationStatus, issue
 * #6191). An application's Overview draws the same tones in its hero.
 */
export const getRumApplicationStatusPillColor: (
  tone: RumApplicationStatusTone,
) => Color = (tone: RumApplicationStatusTone): Color => {
  return tone === "positive" ? Green : Gray500;
};
