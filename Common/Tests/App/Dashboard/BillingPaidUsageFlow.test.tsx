import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import Billing from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Billing";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import BillingPaymentMethod from "../../../Models/DatabaseModels/BillingPaymentMethod";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const confirmSetupMock: MockFunction = getJestMockFunction();
const openPlanEditorMock: MockFunction = getJestMockFunction();
let billingEnabled: boolean = true;
const projectId: ObjectID = ObjectID.generate();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async () => {
        return { data: { balance: 0 } };
      },
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: { capture: () => {}, captureRevenueEvent: () => {} },
  };
});

jest.mock("../../../UI/Config", () => {
  const config: Record<string, unknown> = {
    ...jest.requireActual("../../../UI/Config"),
  };
  Object.defineProperty(config, "BILLING_ENABLED", {
    get: () => {
      return billingEnabled;
    },
  });
  return config;
});

jest.mock(
  "@stripe/stripe-js/pure",
  () => {
    return {
      loadStripe: async () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock(
  "@stripe/react-stripe-js",
  () => {
    return {
      Elements: (props: { children: ReactNode }) => {
        return <>{props.children}</>;
      },
      PaymentElement: () => {
        return <div>Payment details</div>;
      },
      useStripe: () => {
        return { confirmSetup: confirmSetupMock };
      },
      useElements: () => {
        return {};
      },
    };
  },
  { virtual: true },
);

/*
 * Keep the billing page and real checkout form together. Model editors,
 * table requests and the external payment provider are test boundaries.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      cardProps: { title: string };
      isEditable: boolean;
      editButtonText: string;
      onBeforeEdit?: () => boolean;
    }): ReactElement => {
      if (props.cardProps.title !== "Current Plan") {
        return <></>;
      }

      return (
        <section aria-label="Current Plan">
          <button
            disabled={!props.isEditable}
            onClick={() => {
              if (props.onBeforeEdit?.()) {
                openPlanEditorMock();
              }
            }}
          >
            {props.editButtonText}
          </button>
        </section>
      );
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      onItemDeleted: () => void;
      onFetchSuccess?: (items: Array<unknown>, count: number) => void;
      refreshToggle: string;
      cardProps: { buttons: Array<{ title: string; onClick: () => void }> };
    }) => {
      return (
        <div
          data-testid="payment-methods-table"
          data-refresh={props.refreshToggle}
        >
          <button onClick={props.onItemDeleted}>Remove payment method</button>
          <button
            onClick={() => {
              // A filtered table can show no rows while a card is still saved.
              props.onFetchSuccess?.([], 0);
            }}
          >
            Refresh payment methods
          </button>
          {props.cardProps.buttons.map(
            (button: { title: string; onClick: () => void }) => {
              return (
                <button key={button.title} onClick={button.onClick}>
                  {button.title}
                </button>
              );
            },
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    default: (props: {
      children: ReactNode;
      error: string;
      submitButtonText: string;
      onSubmit: () => void;
      onClose: () => void;
      disableSubmitButton: boolean;
      isLoading: boolean;
    }): ReactElement => {
      return (
        <section role="dialog">
          {props.error ? <p role="alert">{props.error}</p> : <></>}
          {props.children}
          <button
            onClick={props.onSubmit}
            disabled={props.disableSubmitButton || props.isLoading}
          >
            {props.submitButtonText}
          </button>
          <button onClick={props.onClose}>Close payment form</button>
        </section>
      );
    },
  };
});

function renderBilling(): void {
  render(
    <Billing
      pageRoute={new Route("/settings/billing")}
      currentProject={null}
      hasPaymentMethod={false}
    />,
  );
}

describe("Billing page paid usage flow", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    billingEnabled = true;
    getListMock.mockReset().mockResolvedValue({ data: [], count: 0 });
    countMock.mockReset().mockResolvedValue(0);
    getItemMock
      .mockReset()
      .mockResolvedValue({ paymentProviderPlanId: "free-plan" });
    postMock
      .mockReset()
      .mockResolvedValue({ data: { setupIntent: "test-secret" } });
    confirmSetupMock.mockReset().mockResolvedValue({});
    openPlanEditorMock.mockReset();
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(projectId);
    getJestSpyOn(SubscriptionPlan, "isFreePlan").mockReturnValue(true);
    getJestSpyOn(SubscriptionPlan, "getSubscriptionPlans").mockReturnValue([]);
    getJestSpyOn(Navigation, "getCurrentURL").mockReturnValue(
      URL.fromString("https://example.com/dashboard/project/settings/billing"),
    );
  });

  it.each([0, 1])(
    "loads current-project payment status without a usage card (%i saved methods)",
    async (count: number) => {
      getListMock.mockResolvedValueOnce({ data: [], count });
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      expect(getListMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: BillingPaymentMethod,
          query: { projectId },
          select: { _id: true },
          limit: 1,
        }),
      );
      expect(
        screen.getByRole("button", { name: "Add Payment Method" }),
      ).toBeEnabled();
      expect(
        screen.queryByTestId("billing-usage-status"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Active monitors:/)).not.toBeInTheDocument();
      expect(screen.queryByText("full pricing")).not.toBeInTheDocument();
    },
  );

  it("recovers plan editing through table refresh after a failed lookup, regardless of filtered rows", async () => {
    getListMock.mockRejectedValueOnce(new Error("Payment methods unavailable"));
    countMock.mockResolvedValueOnce(1);
    renderBilling();
    await screen.findByTestId("payment-methods-table");

    const changePlan: HTMLElement = screen.getByRole("button", {
      name: "Change Plan",
    });
    expect(changePlan).toBeDisabled();
    expect(
      screen.queryByTestId("billing-usage-status"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Payment method status unavailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add Payment Method" }),
    ).toBeEnabled();

    // The table reports zero filtered rows; eligibility uses its own query.
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh payment methods" }),
    );
    expect(countMock).toHaveBeenCalledTimes(1);
    expect(countMock).toHaveBeenCalledWith({
      modelType: BillingPaymentMethod,
      query: { projectId },
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(changePlan).toBeEnabled();
    });
    await userEvent.click(changePlan);

    expect(openPlanEditorMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a payment method for plan changes after deleting the last card", async () => {
    getListMock.mockResolvedValueOnce({ data: [], count: 1 });
    countMock.mockResolvedValueOnce(0);
    renderBilling();
    await screen.findByTestId("payment-methods-table");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove payment method" }),
    );
    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(1);
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(countMock).toHaveBeenCalledWith({
      modelType: BillingPaymentMethod,
      query: { projectId },
    });
    await userEvent.click(screen.getByRole("button", { name: "Change Plan" }));

    expect(
      await screen.findByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "You need a payment method before changing your subscription plan.",
    );
    expect(openPlanEditorMock).not.toHaveBeenCalled();
  });

  it.each(["Refresh payment methods", "Remove payment method"])(
    "keeps plan editing available without resynchronizing table row IDs after %s",
    async (notification: string) => {
      getListMock.mockResolvedValueOnce({ data: [], count: 2 });
      countMock.mockResolvedValueOnce(1);
      renderBilling();
      await screen.findByTestId("payment-methods-table");

      await userEvent.click(screen.getByRole("button", { name: notification }));

      expect(countMock).toHaveBeenCalledTimes(1);
      expect(countMock).toHaveBeenCalledWith({
        modelType: BillingPaymentMethod,
        query: { projectId },
      });
      expect(getListMock).toHaveBeenCalledTimes(1);
      await userEvent.click(
        screen.getByRole("button", { name: "Change Plan" }),
      );
      expect(openPlanEditorMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("disables plan editing after a count failure and recovers on the next table refresh", async () => {
    getListMock.mockResolvedValueOnce({ data: [], count: 1 });
    countMock
      .mockRejectedValueOnce(new Error("Payment method count unavailable"))
      .mockResolvedValueOnce(1);
    renderBilling();
    await screen.findByTestId("payment-methods-table");

    const changePlan: HTMLElement = screen.getByRole("button", {
      name: "Change Plan",
    });
    const refresh: HTMLElement = screen.getByRole("button", {
      name: "Refresh payment methods",
    });
    expect(changePlan).toBeEnabled();
    await userEvent.click(refresh);
    await waitFor(() => {
      expect(changePlan).toBeDisabled();
    });

    await userEvent.click(refresh);
    await waitFor(() => {
      expect(changePlan).toBeEnabled();
    });
    expect(countMock).toHaveBeenCalledTimes(2);
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  it("saves without an extra pricing acknowledgement and refreshes status and the card list", async () => {
    getListMock
      .mockResolvedValueOnce({ data: [], count: 0 })
      .mockResolvedValueOnce({ data: [], count: 1 });
    renderBilling();
    await userEvent.click(
      await screen.findByRole("button", { name: "Add Payment Method" }),
    );
    const save: HTMLElement = await screen.findByRole("button", {
      name: "Save payment method and enable paid usage",
    });
    await waitFor(() => {
      expect(save).not.toBeDisabled();
    });
    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(within(dialog).getByText("Payment details")).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        /Adding a payment method enables paid usage for this project/,
      ),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(/Active monitors:/),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("full pricing")).not.toBeInTheDocument();
    await userEvent.click(save);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("payment-methods-table")).toHaveAttribute(
      "data-refresh",
      "1",
    );
    expect(confirmSetupMock).toHaveBeenCalledTimes(1);
    expect(confirmSetupMock).toHaveBeenCalledWith({
      elements: expect.anything(),
      confirmParams: {
        return_url: "https://example.com/dashboard/project/settings/billing",
      },
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Change Plan" }));
    expect(openPlanEditorMock).toHaveBeenCalledTimes(1);
  });

  it("keeps failed card setup retryable and refreshes eligibility only after success", async () => {
    getListMock
      .mockResolvedValueOnce({ data: [], count: 0 })
      .mockResolvedValueOnce({ data: [], count: 1 });
    confirmSetupMock
      .mockResolvedValueOnce({ error: { message: "Card setup failed" } })
      .mockResolvedValueOnce({});
    renderBilling();
    await userEvent.click(
      await screen.findByRole("button", { name: "Add Payment Method" }),
    );
    const save: HTMLElement = await screen.findByRole("button", {
      name: "Save payment method and enable paid usage",
    });
    await waitFor(() => {
      expect(save).not.toBeDisabled();
    });
    await userEvent.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Card setup failed",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("payment-methods-table")).toHaveAttribute(
      "data-refresh",
      "0",
    );
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(save).not.toBeDisabled();

    await userEvent.click(save);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(confirmSetupMock).toHaveBeenCalledTimes(2);
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("payment-methods-table")).toHaveAttribute(
      "data-refresh",
      "1",
    );
  });

  it("clears a prior setup error and loads payment details when the modal is reopened", async () => {
    postMock
      .mockRejectedValueOnce(new Error("Payment provider unavailable"))
      .mockResolvedValueOnce({ data: { setupIntent: "second-secret" } });
    renderBilling();
    await userEvent.click(
      await screen.findByRole("button", { name: "Add Payment Method" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payment provider unavailable",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Close payment form" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add Payment Method" }),
    );
    expect(await screen.findByText("Payment details")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).queryByRole("checkbox"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("does not show cloud usage status on a self-hosted installation with billing disabled", async () => {
    billingEnabled = false;
    renderBilling();
    await screen.findByTestId("payment-methods-table");
    expect(
      screen.queryByTestId("billing-usage-status"),
    ).not.toBeInTheDocument();
  });

  it("preserves the reseller billing experience", async () => {
    getItemMock.mockResolvedValueOnce({
      paymentProviderPlanId: "free-plan",
      reseller: {
        name: "Example reseller",
        description: "Your account contact",
      },
    });
    renderBilling();
    await screen.findByRole("heading", {
      name: "You have purchased this plan from Example reseller",
    });
    expect(
      screen.queryByTestId("billing-usage-status"),
    ).not.toBeInTheDocument();
  });
});
