import { BILLING_ENABLED } from "../Config";
import NewVersion, { NewVersionAudience } from "./NewVersion/NewVersion";
import User from "./User";
import { setPageErrorReader } from "./ErrorInSentence";
import { UnexplainedErrorReader } from "../../Types/Exception/UnexplainedError";

/*
 * Who reads the page, for an error nobody explained (#6836, #7307):
 * OneUptime Cloud or a server somebody runs, a master admin or not, and a
 * visitor of a status page or a public dashboard (NewVersion's audience).
 *
 * Kept apart from ErrorInSentence, which is window-free: the Dashboard's
 * React-free modules put errors in sentences with errorInSentence and are
 * read by tests in plain Node, where Config cannot load. The page tells
 * ErrorInSentence who reads it (setPageErrorReader) from the two places an
 * error nobody explained comes through: API (getFriendlyMessage writes
 * those sentences) and ErrorSentence (draws them).
 */
export const getErrorReader: () => UnexplainedErrorReader =
  (): UnexplainedErrorReader => {
    return {
      isCloud: BILLING_ENABLED,
      isMasterAdmin: Boolean(User.isMasterAdmin()),
      isVisitor: NewVersion.getAudience() === NewVersionAudience.Visitors,
    };
  };

// Tells ErrorInSentence the page's reader, read each time an error is said.
export const registerPageErrorReader: () => void = (): void => {
  setPageErrorReader(getErrorReader);
};
