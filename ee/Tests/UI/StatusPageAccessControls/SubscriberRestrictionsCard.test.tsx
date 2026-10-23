import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";
import { getJestSpyOn } from "Common/Tests/Spy";

/*
 * The Who Can Subscribe card on a status page's Subscriber Settings
 * (SubscriberRestrictionsCard): Only Private Users Can Subscribe, a switch
 * that saves the moment it is flipped, and Allowed Email Domains, a list
 * saved with Save Domains. A list is checked before anything is sent, saved
 * as the server keeps it - one domain a line - and a refusal leaves what was
 * typed in the box.
 *
 * Only the network, the permission gate, the plan and the billing flag are
 * stubbed; the card, its rows, the switch and the text box are the real
 * ones.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: false };

(
  globalThis as unknown as { __subscriberRestrictionsConfig: MutableConfig }
).__subscriberRestrictionsConfig = config;

jest.mock("Common/UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("Common/UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __subscriberRestrictionsConfig: MutableConfig | undefined;
          }
        ).__subscriberRestrictionsConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

// A valid Enterprise license: nothing above the card, and it can be changed.
jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return "editable";
      },
    };
  },
);

import SubscriberRestrictionsCard from "../../../Dashboard/StatusPageAccessControls/SubscriberRestrictionsCard";
import SubscriberRestrictionsCopy, {
  ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID,
  PRIVATE_USERS_ONLY_SWITCH_TEST_ID,
  SUBSCRIBER_RESTRICTIONS_CARD_TEST_ID,
} from "@oneuptime/dashboard/Components/StatusPage/SubscriberRestrictionsCopy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import { MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS } from "Common/Types/StatusPage/SubscriberRestrictions";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { getStatusPageAccessSelect } from "@oneuptime/dashboard/Components/StatusPage/StatusPageAccessCopy";
import ProjectUtil from "Common/UI/Utils/Project";

const STATUS_PAGE_ID: string = "8d8d8d8d-0000-4000-8000-0000000000dd";

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

interface Stored {
  limitSubscribersToPrivateUsers?: boolean;
  allowedSubscriberEmailDomains?: string;
  // Who can see the page (Security -> Access).
  isPublicStatusPage?: boolean;
  enableMasterPassword?: boolean;
  masterPassword?: string;
}

let stored: Stored | Error = {};
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;

beforeEach(() => {
  stored = { isPublicStatusPage: false };
  gate = { isAllowed: true };
  plan = null;
  config.billingEnabled = false;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;

    for (const [column, value] of Object.entries(stored)) {
      (page as unknown as Record<string, unknown>)[column] = value;
    }

    return page;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <SubscriberRestrictionsCard
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
      />,
    );
  });

  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
}

async function theSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(PRIVATE_USERS_ONLY_SWITCH_TEST_ID);
}

function switchRow(): HTMLElement {
  return screen.getByTestId(`${PRIVATE_USERS_ONLY_SWITCH_TEST_ID}-row`);
}

async function domainsBox(): Promise<HTMLTextAreaElement> {
  return (await screen.findByTestId(
    `${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-input`,
  )) as HTMLTextAreaElement;
}

function saveButton(): HTMLElement | null {
  return screen.queryByTestId(`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-save`);
}

function discardButton(): HTMLElement | null {
  return screen.queryByTestId(
    `${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-discard`,
  );
}

async function type(value: string): Promise<void> {
  const box: HTMLTextAreaElement = await domainsBox();

  await act(async () => {
    fireEvent.change(box, { target: { value: value } });
  });
}

async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(saveButton()!);
  });
}

describe("reading the status page", () => {
  test("asks for the two settings and who can see the page, as the Access card reads it, and nothing else", async () => {
    await renderCard();
    await theSwitch();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({
      limitSubscribersToPrivateUsers: true,
      allowedSubscriberEmailDomains: true,
      ...getStatusPageAccessSelect(),
    });
  });

  test("is the Who Can Subscribe card, saying what it is for", async () => {
    await renderCard();
    await theSwitch();

    expect(
      screen.getByTestId(SUBSCRIBER_RESTRICTIONS_CARD_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SubscriberRestrictionsCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SubscriberRestrictionsCopy.cardDescription),
    ).toBeInTheDocument();
  });

  test("a new page takes anyone, from any domain", async () => {
    await renderCard();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      within(switchRow()).getByText(
        SubscriberRestrictionsCopy.privateUsersOnlyOffDescription,
      ),
    ).toBeInTheDocument();
    expect((await domainsBox()).value).toBe("");
    expect(saveButton()).not.toBeInTheDocument();
  });

  test("shows each setting as the page has it, the domains one a line", async () => {
    stored = {
      limitSubscribersToPrivateUsers: true,
      allowedSubscriberEmailDomains: "acme.com\nacme.de",
      isPublicStatusPage: false,
    };
    await renderCard();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      within(switchRow()).getByText(
        SubscriberRestrictionsCopy.privateUsersOnlyOnDescription,
      ),
    ).toBeInTheDocument();
    expect((await domainsBox()).value).toBe("acme.com\nacme.de");
  });

  test.each([
    ["open to anyone", { isPublicStatusPage: true }],
    [
      "open to anyone with the password",
      {
        isPublicStatusPage: false,
        enableMasterPassword: true,
        masterPassword: "hashed",
      },
    ],
  ])(
    "on a page %s, where no reader signs in, the switch says what it means there",
    async (_label: string, access: Stored) => {
      stored = access;
      await renderCard();
      await theSwitch();

      expect(
        within(switchRow()).getByText(
          SubscriberRestrictionsCopy.privateUsersOnlyNoSignInNote,
          { exact: false },
        ),
      ).toBeInTheDocument();
    },
  );

  test("on a page readers sign in to, it does not", async () => {
    stored = { isPublicStatusPage: false };
    await renderCard();
    await theSwitch();

    expect(
      screen.queryByText(
        SubscriberRestrictionsCopy.privateUsersOnlyNoSignInNote,
        { exact: false },
      ),
    ).not.toBeInTheDocument();
  });

  test("a read that fails says why", async () => {
    stored = new Error("Network down");
    await renderCard();

    expect(await screen.findByText("Network down")).toBeInTheDocument();
  });
});

describe("Only Private Users Can Subscribe", () => {
  test("saves the moment it is flipped, and says what on means", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.click(await theSwitch());
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({ limitSubscribersToPrivateUsers: true });
    expect(
      within(switchRow()).getByText(
        SubscriberRestrictionsCopy.privateUsersOnlyOnDescription,
      ),
    ).toBeInTheDocument();
  });

  test("a change the plan does not allow moves back, with the reason, and names the plan before anyone tries", async () => {
    config.billingEnabled = true;
    plan = PlanType.Growth;
    updateByIdMock.mockImplementation(async (): Promise<never> => {
      throw new Error("Please upgrade your plan to Scale to use this feature.");
    });

    await renderCard();
    await theSwitch();

    expect(within(switchRow()).getByText(/Scale/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(await theSwitch());
    });

    expect(
      await screen.findByText(
        "Please upgrade your plan to Scale to use this feature.",
      ),
    ).toBeInTheDocument();
    // The reason and the switch moving back can land on separate renders.
    await waitFor(async () => {
      expect(await theSwitch()).toHaveAttribute("aria-checked", "false");
    });
  });
});

describe("Allowed Email Domains", () => {
  test("is named and explained", async () => {
    await renderCard();
    await domainsBox();

    expect(
      screen.getByText(SubscriberRestrictionsCopy.allowedDomainsLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SubscriberRestrictionsCopy.allowedDomainsDescription),
    ).toBeInTheDocument();
    // The box is labelled by the setting's name.
    expect(
      screen.getByLabelText(SubscriberRestrictionsCopy.allowedDomainsLabel),
    ).toBe(await domainsBox());
  });

  test("Save and Discard appear only once something is typed", async () => {
    await renderCard();
    await domainsBox();

    expect(saveButton()).not.toBeInTheDocument();
    expect(discardButton()).not.toBeInTheDocument();

    await type("acme.com");

    expect(saveButton()).toBeInTheDocument();
    expect(discardButton()).toBeInTheDocument();
  });

  test("the same domains typed another way are no change", async () => {
    stored = { allowedSubscriberEmailDomains: "acme.com\nacme.de" };
    await renderCard();
    await domainsBox();

    await type("  ACME.com,\n@acme.de  ");

    expect(saveButton()).not.toBeInTheDocument();
  });

  test("Save Domains saves the list as the server keeps it, and the box shows it so", async () => {
    await renderCard();
    await type(" @ACME.com, acme.de\n\nacme.com ");
    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["data"]).toEqual({
      allowedSubscriberEmailDomains: "acme.com\nacme.de",
    });

    await waitFor(async () => {
      expect((await domainsBox()).value).toBe("acme.com\nacme.de");
    });
    expect(saveButton()).not.toBeInTheDocument();
    expect(
      await screen.findByTestId(
        `${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-status`,
      ),
    ).toHaveTextContent(/Saved/);
  });

  test("an empty list saves as none: any domain again", async () => {
    stored = { allowedSubscriberEmailDomains: "acme.com" };
    await renderCard();
    await type("");
    await save();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({ allowedSubscriberEmailDomains: null });
  });

  test("an entry that is not a domain is named before anything is sent, until the list is changed", async () => {
    await renderCard();
    await type("acme.com\nhttps://acme.de");
    await save();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "https://acme.de is not a valid domain. Enter one domain per line, such as acme.com.",
      ),
    ).toBeInTheDocument();
    expect((await domainsBox()).value).toBe("acme.com\nhttps://acme.de");

    await type("acme.com\nacme.de");

    expect(screen.queryByText(/is not a valid domain/)).not.toBeInTheDocument();
  });

  test(`more than ${MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS} domains are refused before anything is sent`, async () => {
    await renderCard();
    await type(
      Array.from(
        { length: MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS + 1 },
        (_value: unknown, index: number): string => {
          return `d${index}.example.com`;
        },
      ).join("\n"),
    );
    await save();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        `Allowed Email Domains can hold at most ${MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS} domains.`,
      ),
    ).toBeInTheDocument();
  });

  test("Discard Changes puts back what the page has", async () => {
    stored = { allowedSubscriberEmailDomains: "acme.com" };
    await renderCard();
    await type("something-else.com");

    await act(async () => {
      fireEvent.click(discardButton()!);
    });

    expect((await domainsBox()).value).toBe("acme.com");
    expect(saveButton()).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a list the server refuses says why, with what was typed left in the box", async () => {
    updateByIdMock.mockImplementation(async (): Promise<never> => {
      throw new Error("Please upgrade your plan to Scale to use this feature.");
    });

    await renderCard();
    await type("acme.com");
    await save();

    expect(
      await screen.findByTestId(
        `${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-error`,
      ),
    ).toHaveTextContent(
      "Please upgrade your plan to Scale to use this feature.",
    );
    expect((await domainsBox()).value).toBe("acme.com");
    // Still unsaved: it can be tried again.
    expect(saveButton()).toBeInTheDocument();
  });

  test("names the plan a project would need, before anyone tries", async () => {
    config.billingEnabled = true;
    plan = PlanType.Growth;

    await renderCard();
    await domainsBox();

    expect(
      within(
        screen.getByTestId(`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-row`),
      ).getByText(/Scale/),
    ).toBeInTheDocument();
  });

  test("names no plan on a plan that has it", async () => {
    config.billingEnabled = true;
    plan = PlanType.Scale;

    await renderCard();
    await domainsBox();

    expect(
      within(
        screen.getByTestId(`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-row`),
      ).queryByText(/Plan/),
    ).not.toBeInTheDocument();
  });

  test("someone who may not edit the page sees the list, locked", async () => {
    stored = { allowedSubscriberEmailDomains: "acme.com" };
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Status Page.",
    };

    await renderCard();

    expect((await domainsBox()).value).toBe("acme.com");
    expect(
      screen.getByTestId(`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-editor`),
    ).toBeDisabled();
    expect(await theSwitch()).toHaveAttribute("aria-disabled", "true");
  });
});
