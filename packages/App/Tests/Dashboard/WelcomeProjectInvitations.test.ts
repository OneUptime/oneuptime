import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * /dashboard/welcome is the whole of what somebody sees the moment they finish
 * signing up and have no project. Someone invited by their team lands here
 * too, and until this wiring existed the page told them there was nothing here
 * and offered to sell them a project of their own - the invitation was two
 * clicks away under a menu they had no reason to open.
 *
 * The page now mounts the shared invitations card. What it does with that card
 * is a set of invariants no runtime value on this page exposes, and every one
 * of them fails silently:
 *
 *   - Mounting the card inside a branch, or more than once, remounts it every
 *     time its own load resolves - it refetches on the render it triggered and
 *     never settles.
 *   - Rendering the "No projects / create one" empty state before the
 *     invitations have been read shows the wrong headline to exactly the user
 *     this exists for, then swaps it underneath them.
 *   - Accepting has to leave through a real page load. The dashboard read this
 *     user's projects on boot, before the membership existed; a client-side
 *     route change into the new project finds it missing from that list and
 *     bounces straight back to this page.
 *
 * Assertions are on source text: this page is a React element tree that
 * renders nothing without a browser, and the App test suite has no DOM.
 */

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const WELCOME_PATH: string = nodePath.join(
  DASHBOARD_SRC,
  "Pages/Onboarding/Welcome.tsx",
);

/*
 * Comments are stripped first, so a file that explains an invariant in prose
 * cannot satisfy an assertion about the code that holds it. The prose above
 * every one of these rules in Welcome.tsx would otherwise pass most of them.
 */
type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

const WELCOME_SOURCE: string = stripComments(
  fs.readFileSync(WELCOME_PATH, "utf8"),
);

type CountOccurrencesFunction = (haystack: string, needle: string) => number;

const countOccurrences: CountOccurrencesFunction = (
  haystack: string,
  needle: string,
): number => {
  return haystack.split(needle).length - 1;
};

describe("the welcome page's pending invitations", () => {
  describe("mounting the card", () => {
    test("uses the shared invitations component rather than its own table", () => {
      expect(WELCOME_SOURCE).toContain(
        'import PendingProjectInvitations from "Common/UI/Components/ProjectInvitations/PendingProjectInvitations"',
      );
      expect(WELCOME_SOURCE).toContain("<PendingProjectInvitations");
    });

    /*
     * The single most load-bearing line in this file. Every state of this page
     * (loading, invited, not invited, creation restricted) has to render the
     * SAME element in the SAME slot: React reconciles by position, so a second
     * copy in a second branch is a different instance, and swapping between
     * them unmounts and remounts the card. It refetches on mount, which is the
     * render its own load just caused - a loop that never settles and hammers
     * the API on the first screen a new user ever sees.
     *
     * It is also what keeps the invitation reachable when project creation is
     * restricted: that branch shows only a "contact your admin" notice, and a
     * card mounted per-branch would be missing from it - stranding the one
     * user who has a way in.
     */
    test("mounts the card exactly once, outside every branch", () => {
      expect(
        countOccurrences(WELCOME_SOURCE, "<PendingProjectInvitations"),
      ).toBe(1);
    });

    test("asks to be told the invitation count, and where an accept landed", () => {
      expect(WELCOME_SOURCE).toContain("onInvitationsLoaded");
      expect(WELCOME_SOURCE).toContain("onInvitationAccepted");
    });
  });

  describe("what it shows underneath", () => {
    /*
     * Null until the invitations are read - not zero. Treating "not yet known"
     * as "none" is what puts "No projects - get started by creating a new
     * project" in front of somebody whose team just invited them.
     */
    test("waits for the count before deciding what to offer", () => {
      expect(WELCOME_SOURCE).toMatch(
        /useState<number \| null>\(\s*null,?\s*\)/,
      );
      expect(WELCOME_SOURCE).toMatch(
        /invitationCount === null[\s\S]{0,200}?PageLoader/,
      );
    });

    test("steps the create-project pitch aside when an invitation is waiting", () => {
      expect(WELCOME_SOURCE).toMatch(/invitationCount > 0/);
      expect(WELCOME_SOURCE).toContain('id="create-project-alternative"');
    });

    /*
     * Four E2E specs sign up and click straight through on this test id, and
     * it has to survive in BOTH shapes the page can take - the full empty
     * state, and the quiet line under an invitation.
     */
    test("keeps a create-project button in both shapes of the page", () => {
      expect(
        countOccurrences(
          WELCOME_SOURCE,
          'dataTestId="create-new-project-button"',
        ),
      ).toBe(2);
    });

    test("still tells a user on a locked-down server why they cannot create one", () => {
      expect(WELCOME_SOURCE).toContain(
        'id="empty-state-project-creation-restricted"',
      );
      expect(WELCOME_SOURCE).toContain("disableUserProjectCreation");
    });

    test("still offers the plain empty state to a user with no invitations", () => {
      expect(WELCOME_SOURCE).toContain('id="empty-state-no-projects"');
    });
  });

  describe("what happens after an accept", () => {
    /*
     * Without forceNavigate this is a client-side route change into a project
     * the already-loaded project list does not contain - the shell finds
     * nothing to select and sends the user straight back to this page, having
     * apparently done nothing.
     */
    test("leaves through a real page load, not a route change", () => {
      expect(WELCOME_SOURCE).toMatch(
        /Navigation\.navigate\([\s\S]{0,400}?forceNavigate:\s*true/,
      );
    });

    test("navigates into the project that was just joined", () => {
      expect(WELCOME_SOURCE).toMatch(
        /RouteMap\[PageMap\.HOME\][\s\S]{0,200}?RouteParams\.ProjectID,\s*projectId\.toString\(\)/,
      );
    });

    /*
     * The dashboard picks which project to open from this on the next boot,
     * and that boot is the page load above. Without it the user is dropped
     * into whichever project the fallbacks happen to reach first, which after
     * accepting a single invitation is a coin toss they did not ask to flip.
     */
    test("remembers the project so the reloaded dashboard opens it", () => {
      expect(WELCOME_SOURCE).toMatch(
        /ProjectUtil\.setLastAccessedProjectId\(\s*projectId,?\s*\)/,
      );
    });
  });

  /*
   * The page hands the accept off to the shared card and does nothing itself -
   * a second, page-local implementation of "accept" would drift from the one
   * that is actually tested, and would be the one a user's press ran.
   */
  describe("what it deliberately does not do", () => {
    test("does not write the acceptance itself", () => {
      expect(WELCOME_SOURCE).not.toContain("hasAcceptedInvitation");
      expect(WELCOME_SOURCE).not.toContain("ModelAPI");
    });
  });
});
