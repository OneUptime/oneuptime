import { InlineText } from "./GuideTypes";
import {
  BROWSER_KEY_PREREQUISITE,
  SERVER_KEY_PREREQUISITE,
  VALIDATE_BROWSER_KEY_BODY,
  VALIDATE_SERVER_KEY_BODY,
} from "./GuideShared";
import { NODE_PREREQUISITE } from "./JavaScriptShared";

/*
 * The sentences guides share on purpose, because they state one fact the
 * same way everywhere: each is kept in one place (GuideShared,
 * JavaScriptShared) and left out of the check that no two guides write the
 * same sentence (Tests/OpenTelemetryGuides). Everything else a guide says
 * is its own.
 */
export const SHARED_GUIDE_TEXTS: Array<InlineText> = [
  SERVER_KEY_PREREQUISITE,
  BROWSER_KEY_PREREQUISITE,
  NODE_PREREQUISITE,
  VALIDATE_SERVER_KEY_BODY,
  VALIDATE_BROWSER_KEY_BODY,
];
