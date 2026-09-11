import { BASE_URL } from "../../Config";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  registerAndCreateProject,
  gotoProjectPage,
} from "./Helpers/ProductOnboarding";

/*
 * The invite form could not be filled in.
 *
 * Type a valid address into "Invite New User" and the email vanished from the
 * box; keep typing and characters disappeared as they were entered. Two
 * separate defects, both in Common's form stack, both only reachable through a
 * form like this one - the Email field reports every keystroke back to the page
 * so it can look up whether that address already has an account, and the page
 * re-renders when it answers:
 *
 *   - ModelForm returned a <Loader/> in place of the form while it refreshed
 *     the Team dropdown's options, which unmounted the form and threw away
 *     everything typed into it.
 *   - Input mirrored its React state into the DOM one render late, so a
 *     keystroke landing in that window was overwritten by the previous value.
 *
 * Common/Tests/UI/Components/Forms/ModelFormPreservesUserInput.test.tsx pins
 * both mechanisms directly. This walks the flow the reporter walked, through
 * the real app, because that is the only place the whole chain - dashboard
 * page, real Team list request, real account-lookup request - is present at
 * once.
 */

type UsersPageUrlFunction = (projectId: string) => string;

const usersPageUrl: UsersPageUrlFunction = (projectId: string): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}/users`)
    .toString();
};

const EMAIL_PLACEHOLDER: string = "member@company.com";

interface SharedContext {
  page: Page;
  projectId: string;
}

test.describe("Invite user", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Invite User Project",
    });
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  type OpenInviteModalFunction = () => Promise<Locator>;

  const openInviteModal: OpenInviteModalFunction =
    async (): Promise<Locator> => {
      const page: Page = ctx.page;

      /*
       * exact, because getByRole matches an accessible name by substring and
       * this project is called "E2E Invite User Project ...". The header's
       * project switcher therefore matches "Invite User" too, and which of the
       * two the locator resolved to came down to whether the page body had
       * rendered yet - when it had not, this clicked the switcher, opened its
       * dropdown, and then waited out the test for a modal that was never
       * going to appear.
       */
      const inviteButton: Locator = page.getByRole("button", {
        name: "Invite User",
        exact: true,
      });

      await gotoProjectPage({
        page,
        projectId: ctx.projectId,
        url: usersPageUrl(ctx.projectId),
        ready: inviteButton,
      });

      await inviteButton.click();
      await page.getByTestId("modal").waitFor({ state: "visible" });

      const emailInput: Locator = page.getByPlaceholder(EMAIL_PLACEHOLDER);
      await emailInput.waitFor({ state: "visible" });

      return emailInput;
    };

  /*
   * The reported sequence, verbatim: type a valid address, press Tab, wait long
   * enough for the account lookup to come back (it is debounced by 400ms) and
   * re-render the page. The address has to still be there.
   */
  test("keeps the email after typing it and tabbing out", async () => {
    test.setTimeout(180000);

    const emailInput: Locator = await openInviteModal();
    const email: string = Faker.generateEmail().toString();

    await emailInput.click();
    await emailInput.fill(email);
    await emailInput.press("Tab");

    // Comfortably past the 400ms debounce plus the lookup round trip.
    await ctx.page.waitForTimeout(3000);

    await expect(emailInput).toHaveValue(email);
  });

  /*
   * The second half of the report. After the address had been checked once,
   * every further keystroke made it briefly invalid again, which flipped the
   * page's state back and re-triggered the whole cascade. Typing character by
   * character is the point here - `fill` would set the value in one event and
   * never reproduce it.
   */
  test("keeps every character when the address is typed one key at a time", async () => {
    test.setTimeout(180000);

    const emailInput: Locator = await openInviteModal();
    const email: string = Faker.generateEmail().toString();

    await emailInput.click();
    await emailInput.pressSequentially(email, { delay: 60 });

    await ctx.page.waitForTimeout(3000);

    await expect(emailInput).toHaveValue(email);
  });

  /*
   * And editing an address that has already been looked up, which is what the
   * reporter did after the first wipe.
   */
  test("keeps the email while it is edited after being checked", async () => {
    test.setTimeout(180000);

    const emailInput: Locator = await openInviteModal();
    const email: string = Faker.generateEmail().toString();

    await emailInput.click();
    await emailInput.fill(email);

    // Let the lookup resolve, so the page's state is no longer "unknown".
    await ctx.page.waitForTimeout(3000);

    await emailInput.pressSequentially(".uk", { delay: 60 });
    await ctx.page.waitForTimeout(3000);

    await expect(emailInput).toHaveValue(`${email}.uk`);
  });

  /*
   * The form is only fixed if it can actually be submitted, so this finishes
   * the job: pick a team and invite. On success the page navigates to the
   * invited user, which is where the address shows up again.
   */
  test("invites the user once the email and team are filled in", async () => {
    test.setTimeout(180000);

    const page: Page = ctx.page;
    const emailInput: Locator = await openInviteModal();
    const email: string = Faker.generateEmail().toString();

    await emailInput.click();
    await emailInput.fill(email);
    await page.waitForTimeout(3000);

    // The address survived long enough to pick a team.
    await expect(emailInput).toHaveValue(email);

    const teamInput: Locator = page.getByPlaceholder("Select a team");
    await teamInput.click();

    const ownersOption: Locator = page
      .getByRole("option", { name: /Owners/ })
      .first();
    await ownersOption.waitFor({ state: "visible", timeout: 30000 });
    await ownersOption.click();

    // Choosing a team must not have disturbed the email either.
    await expect(emailInput).toHaveValue(email);

    await page.getByTestId("modal-footer-submit-button").click();

    await expect(page.getByText(email).first()).toBeVisible({
      timeout: 60000,
    });
  });
});
