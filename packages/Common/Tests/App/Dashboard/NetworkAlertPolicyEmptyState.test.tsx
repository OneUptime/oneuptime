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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What the Network Alert Policies page shows before any policy exists
 * (Pages/NetworkDevice/Settings/AlertPolicies.tsx, RecommendedPolicyEmptyState):
 * the offer to create the recommended policy. It is where the Network
 * first-run path's "Set up alerts" lands, so it is drawn the way every
 * empty list in the product is (TableEmptyState), with the recommended
 * policy as the page's one primary action, and its confirmation names the
 * policy and the template it adds as the names they will be found under.
 */

const countMock: MockFunction = getJestMockFunction();
let mockCanCreatePolicy: boolean = true;

const NOT_ALLOWED: string =
  "You need the Project Admin permission to create a Network Alert Policy.";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      check: (): { isAllowed: boolean; disabledReason?: string } => {
        return mockCanCreatePolicy
          ? { isAllowed: true }
          : { isAllowed: false, disabledReason: NOT_ALLOWED };
      },
      canReadColumn: (): boolean => {
        return true;
      },
      canPickRelation: (): boolean => {
        return true;
      },
    },
    ModelAction: {
      Create: "create",
      Read: "read",
      Update: "update",
      Delete: "delete",
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "10000000-0000-4000-8000-000000000001",
        );
      },
    },
  };
});

import { RecommendedPolicyEmptyState } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AlertPolicies";

async function flush(): Promise<void> {
  for (let i: number = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  mockCanCreatePolicy = true;
  countMock.mockReset();
  countMock.mockResolvedValue(11 as never);
});

afterEach(() => {
  cleanup();
});

describe("the Alert Policies page with no policy yet", () => {
  test("is drawn as every empty list is: an illustration, a heading, what a policy does", () => {
    render(<RecommendedPolicyEmptyState onCreated={() => {}} />);

    const empty: HTMLElement = screen.getByTestId(
      "network-alert-policies-empty",
    );

    expect(
      within(empty).getByTestId("network-alert-policies-empty-illustration"),
    ).toBeInTheDocument();
    expect(
      within(empty).getByTestId("network-alert-policies-empty-title"),
    ).toHaveTextContent(/^No alert policies yet$/);
    expect(
      within(empty).getByTestId("network-alert-policies-empty-description"),
    ).toHaveTextContent(
      "One policy alerts on many devices: the ones you have and the ones you add later.",
    );
    expect(
      within(empty).getByTestId("network-alert-policies-empty-description"),
    ).toHaveTextContent(
      "A device without SNMP credentials is only pinged, so only the stops-answering check can fire on it.",
    );
  });

  test("offers the recommended policy as the one primary action", () => {
    render(<RecommendedPolicyEmptyState onCreated={() => {}} />);

    const button: HTMLElement = screen.getByTestId(
      "create-recommended-alert-policy",
    );

    expect(button).toHaveTextContent("Create the recommended policy");
    // The primary style: the page's one obvious next step.
    expect(button.className).toContain("bg-indigo-600");
    expect(
      within(
        screen.getByTestId("network-alert-policies-empty-actions"),
      ).getAllByRole("button"),
    ).toHaveLength(1);
  });

  test("confirms first, naming the policy and the template it adds, and how many monitors at most", async () => {
    render(<RecommendedPolicyEmptyState onCreated={() => {}} />);

    fireEvent.click(screen.getByTestId("create-recommended-alert-policy"));
    await flush();

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialog).toHaveTextContent("Create the recommended policy?");
    expect(dialog).toHaveTextContent(
      'This adds the "Alert on every device" policy, and the "Network device alert pack (recommended)" monitor template it uses if the project does not have it yet.',
    );
    expect(dialog).toHaveTextContent(
      "each counted towards your plan: up to 11 monitors today.",
    );
    // The names are said as names: never run into the sentence around them.
    expect(dialog).not.toHaveTextContent("an Alert on every device policy");
  });

  test("one device: one monitor, said in the singular", async () => {
    countMock.mockResolvedValue(1 as never);
    render(<RecommendedPolicyEmptyState onCreated={() => {}} />);

    fireEvent.click(screen.getByTestId("create-recommended-alert-policy"));
    await flush();

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "up to 1 monitor today.",
    );
  });

  test("a count that cannot be read still confirms, without a number", async () => {
    countMock.mockRejectedValue(new Error("No access") as never);
    render(<RecommendedPolicyEmptyState onCreated={() => {}} />);

    fireEvent.click(screen.getByTestId("create-recommended-alert-policy"));
    await flush();

    const dialog: HTMLElement = screen.getByTestId("modal");
    expect(dialog).toHaveTextContent(
      'This adds the "Alert on every device" policy',
    );
    expect(dialog).toHaveTextContent(
      "each counted towards your plan. You can narrow the policy to some devices afterwards.",
    );
    expect(dialog).not.toHaveTextContent("up to");
  });

  test("someone who may not create a policy is told why, and offered nothing", () => {
    mockCanCreatePolicy = false;
    render(<RecommendedPolicyEmptyState onCreated={() => {}} />);

    expect(screen.queryByTestId("create-recommended-alert-policy")).toBeNull();
    expect(
      screen.getByTestId("network-alert-policies-empty-note"),
    ).toHaveTextContent(NOT_ALLOWED);
  });
});
