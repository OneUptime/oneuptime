import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ProjectUtil from "../../../UI/Utils/Project";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";

/*
 * A PROJECT'S SUBSCRIPTION FLAGS, KEPT FOR THAT PROJECT (#5306's follow-up).
 *
 * The Dashboard keeps whether the project a tab shows has an inactive or an
 * overdue subscription in localStorage, which every tab shares, under names
 * that start with the project's id (ProjectUtil). A tab that showed no
 * project kept them under "undefined_isSubscriptionInactive" and
 * "undefined_isSubscriptionOverdue" - one name for every such tab - and read
 * them back too. It now keeps and reads nothing without a project.
 *
 * A tab here is the address jsdom gives the page and its session storage.
 */

const ACTIVE_PROJECT_ID: string = "7b000000-0000-4000-8000-000000000001";
const UNPAID_PROJECT_ID: string = "7b000000-0000-4000-8000-000000000002";

type OpenTabFunction = (path: string) => void;

// The person moves to the tab at `path`: its address, and its own session storage.
const openTab: OpenTabFunction = (path: string): void => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", path);
};

type KeepFunction = (status: SubscriptionStatus) => boolean;

// What the Dashboard does with the project's subscription, as it loads it.
const keepStatus: KeepFunction = (status: SubscriptionStatus): boolean => {
  return ProjectUtil.setIsSubscriptionInactiveOrOverdue({
    paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Active,
    paymentProviderSubscriptionStatus: status,
  });
};

type KeptNamesFunction = () => Array<string>;

const keptNames: KeptNamesFunction = (): Array<string> => {
  const names: Array<string> = [];

  for (let index: number = 0; index < localStorage.length; index++) {
    const name: string | null = localStorage.key(index);

    if (name !== null) {
      names.push(name);
    }
  }

  return names.sort();
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("a project's subscription flags", () => {
  test("are kept under names that start with the project's id, in the tab that shows it", () => {
    openTab(`/dashboard/${UNPAID_PROJECT_ID}/settings/invoices`);

    expect(keepStatus(SubscriptionStatus.Unpaid)).toBe(true);
    expect(keptNames()).toEqual([
      `${UNPAID_PROJECT_ID}_isSubscriptionInactive`,
      `${UNPAID_PROJECT_ID}_isSubscriptionOverdue`,
    ]);
  });

  test("two projects in two tabs each read their own, whichever tab kept its flags last", () => {
    openTab(`/dashboard/${UNPAID_PROJECT_ID}/home`);
    keepStatus(SubscriptionStatus.Unpaid);

    openTab(`/dashboard/${ACTIVE_PROJECT_ID}/home`);
    keepStatus(SubscriptionStatus.Active);

    openTab(`/dashboard/${UNPAID_PROJECT_ID}/settings/invoices`);
    expect(ProjectUtil.isSubscriptionInactive()).toBe(true);

    openTab(`/dashboard/${ACTIVE_PROJECT_ID}/settings/invoices`);
    expect(ProjectUtil.isSubscriptionInactive()).toBe(false);
  });

  test("a tab that shows no project keeps nothing, under no name every such tab shares", () => {
    openTab("/dashboard/welcome");

    // The answer still says what the subscription is.
    expect(keepStatus(SubscriptionStatus.Unpaid)).toBe(true);

    expect(keptNames()).toEqual([]);
  });

  test("a tab that shows no project reads no flag - not one an older tab left under the shared name", () => {
    localStorage.setItem("undefined_isSubscriptionInactive", "true");
    localStorage.setItem("undefined_isSubscriptionOverdue", "true");

    openTab("/dashboard/welcome");

    expect(ProjectUtil.isSubscriptionInactive()).toBe(false);
  });
});
