import Color from "Common/Types/Color";
import { Gray500, Green } from "Common/Types/BrandColors";
import { ServerlessFunctionStatusTone } from "Common/Types/Serverless/ServerlessFunctionStatus";

/*
 * The colour of a serverless function's status pill in a list: green while
 * its data arrives, grey while it waits for its first data or nothing has
 * invoked it lately. Never red - neither is a fault (ServerlessFunctionStatus,
 * issue #6269). A function's Overview draws the same tones in its hero.
 */
export const getServerlessFunctionStatusPillColor: (
  tone: ServerlessFunctionStatusTone,
) => Color = (tone: ServerlessFunctionStatusTone): Color => {
  return tone === "positive" ? Green : Gray500;
};
