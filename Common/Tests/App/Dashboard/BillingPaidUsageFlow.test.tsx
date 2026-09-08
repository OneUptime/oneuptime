import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import Billing from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Billing";
import {
  PAYMENT_METHOD_CONSENT_ERROR,
  PAYMENT_METHOD_CONSENT_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/BillingPaymentMethodForm";
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
const getItemMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const confirmSetupMock: MockFunction = getJestMockFunction();
let billingEnabled: boolean = true;
const projectId: ObjectID = ObjectID.generate();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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
 * Keep the billing page, its usage card and its real checkout form together;
 * unrelated model editors and the external provider are test boundaries.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      onItemDeleted: () => void;
      refreshToggle: string;
      cardProps: { buttons: Array<{ title: string; onClick: () => void }> };
    }) => {
      return (
        <div
          data-testid="payment-methods-table"
          data-refresh={props.refreshToggle}
        >
          <button onClick={props.onItemDeleted}>Remove payment method</button>
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
    getItemMock
      .mockReset()
      .mockResolvedValue({ paymentProviderPlanId: "free-plan" });
    postMock
      .mockReset()
      .mockResolvedValue({ data: { setupIntent: "test-secret" } });
    confirmSetupMock.mockReset().mockResolvedValue({});
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(projectId);
    getJestSpyOn(SubscriptionPlan, "isFreePlan").mockReturnValue(true);
    getJestSpyOn(SubscriptionPlan, "getSubscriptionPlans").mockReturnValue([]);
    getJestSpyOn(Navigation, "getCurrentURL").mockReturnValue(
      URL.fromString("https://example.com/dashboard/project/settings/billing"),
    );
  });

  it("loads payment status only for the current project", async () => {
    renderBilling();
    await screen.findByRole("heading", {
      name: "Free plan — paid usage locked",
    });
    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: BillingPaymentMethod,
        query: { projectId },
        select: { _id: true },
        limit: 1,
      }),
    );
  });

  it("keeps a failed payment lookup unknown and lets the user retry", async () => {
    getListMock
      .mockRejectedValueOnce(new Error("Payment methods unavailable"))
      .mockResolvedValueOnce({ data: [], count: 1 });
    renderBilling();
    await screen.findByRole("heading", {
      name: "Payment method status unavailable",
    });
    expect(
      screen.queryByText("Free plan — paid usage locked"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry payment method check" }),
    );
    await screen.findByRole("heading", { name: "Free plan + pay as you go" });
  });

  it("refreshes paid usage status when the last payment method is deleted", async () => {
    getListMock
      .mockResolvedValueOnce({ data: [], count: 1 })
      .mockResolvedValueOnce({ data: [], count: 0 });
    renderBilling();
    await screen.findByRole("heading", { name: "Free plan + pay as you go" });
    await userEvent.click(
      screen.getByRole("button", { name: "Remove payment method" }),
    );
    await screen.findByRole("heading", {
      name: "Free plan — paid usage locked",
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the form visible after missing consent and refreshes both status and card list after saving", async () => {
    getListMock
      .mockResolvedValueOnce({ data: [], count: 0 })
      .mockResolvedValueOnce({ data: [], count: 1 });
    renderBilling();
    await userEvent.click(
      await screen.findByRole("button", { name: "Enable paid usage" }),
    );
    const save: HTMLElement = await screen.findByRole("button", {
      name: "Save payment method and enable paid usage",
    });
    await waitFor(() => {
      expect(save).not.toBeDisabled();
    });
    await userEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      PAYMENT_METHOD_CONSENT_ERROR,
    );
    expect(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    ).toBeInTheDocument();
    expect(confirmSetupMock).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    );
    await userEvent.click(save);
    await screen.findByRole("heading", { name: "Free plan + pay as you go" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("payment-methods-table")).toHaveAttribute(
      "data-refresh",
      "1",
    );
    expect(confirmSetupMock).toHaveBeenCalledTimes(1);
  });

  it("clears a prior setup error and requests new consent when the payment modal is reopened", async () => {
    postMock
      .mockRejectedValueOnce(new Error("Payment provider unavailable"))
      .mockResolvedValueOnce({ data: { setupIntent: "second-secret" } });
    renderBilling();
    await userEvent.click(
      await screen.findByRole("button", { name: "Enable paid usage" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payment provider unavailable",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Close payment form" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Enable paid usage" }),
    );
    expect(
      await screen.findByRole("checkbox", {
        name: PAYMENT_METHOD_CONSENT_LABEL,
      }),
    ).not.toBeChecked();
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
