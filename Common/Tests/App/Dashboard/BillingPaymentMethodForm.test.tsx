import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import CheckoutForm from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/BillingPaymentMethodForm";
import Navigation from "../../../UI/Utils/Navigation";
import URL from "../../../Types/API/URL";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

const confirmSetupMock: MockFunction = getJestMockFunction();
let stripeReady: boolean = true;
let elementsReady: boolean = true;
const mockElements: Record<string, unknown> = {};

jest.mock(
  "@stripe/react-stripe-js",
  () => {
    return {
      PaymentElement: () => {
        return <div data-testid="stripe-payment-element">Payment details</div>;
      },
      useStripe: () => {
        return stripeReady ? { confirmSetup: confirmSetupMock } : null;
      },
      useElements: () => {
        return elementsReady ? mockElements : null;
      },
    };
  },
  { virtual: true },
);

function renderForm(): {
  onError: MockFunction;
  onSuccess: MockFunction;
  submit: () => void;
  unmount: () => void;
} {
  const onError: MockFunction = getJestMockFunction();
  const onSuccess: MockFunction = getJestMockFunction();
  const formRef: React.RefObject<HTMLButtonElement> =
    React.createRef<HTMLButtonElement>();
  const { unmount } = render(
    <CheckoutForm formRef={formRef} onError={onError} onSuccess={onSuccess} />,
  );
  return {
    onError,
    onSuccess,
    submit: () => {
      fireEvent.click(formRef.current!);
    },
    unmount,
  };
}

describe("Adding a payment method", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    confirmSetupMock.mockReset().mockResolvedValue({});
    stripeReady = true;
    elementsReady = true;
    getJestSpyOn(Navigation, "getCurrentURL").mockReturnValue(
      URL.fromString(
        "https://example.com/dashboard/project/settings/billing?setup_intent=old",
      ),
    );
  });

  it("shows payment details without a pricing or acknowledgement panel", () => {
    renderForm();
    expect(screen.getByTestId("stripe-payment-element")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-method-usage-consent"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Adding a payment method enables paid usage/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Active monitors:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Session replay:/)).not.toBeInTheDocument();
  });

  it("does not start setup when payment details are clicked", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("stripe-payment-element"));
    expect(confirmSetupMock).not.toHaveBeenCalled();
  });

  it("saves without an acknowledgement and returns to the clean billing URL", async () => {
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(confirmSetupMock).toHaveBeenCalledWith({
      elements: mockElements,
      confirmParams: {
        return_url: "https://example.com/dashboard/project/settings/billing",
      },
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["stripe", "elements"])(
    "reports an unavailable %s provider instead of leaving the save button loading",
    (provider: string) => {
      stripeReady = provider !== "stripe";
      elementsReady = provider !== "elements";
      const { submit, onError } = renderForm();
      submit();
      expect(onError).toHaveBeenCalledWith(
        "The payment form is still loading. Please try again in a moment.",
      );
      expect(confirmSetupMock).not.toHaveBeenCalled();
    },
  );

  it("reports a provider error and supports retry", async () => {
    confirmSetupMock
      .mockResolvedValueOnce({ error: { message: "Your card was declined." } })
      .mockResolvedValueOnce({});
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Your card was declined.");
    });
    expect(onSuccess).not.toHaveBeenCalled();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(confirmSetupMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from an unexpected provider failure without an unhandled rejection", async () => {
    confirmSetupMock.mockRejectedValueOnce(new Error("Network error"));
    const { submit, onError, onSuccess } = renderForm();
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "Unable to save your payment method. Please try again.",
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("suppresses duplicate submissions while setup is in progress", async () => {
    let resolveSetup: ((result: Record<string, unknown>) => void) | undefined;
    confirmSetupMock.mockImplementationOnce(() => {
      return new Promise<Record<string, unknown>>(
        (resolve: (result: Record<string, unknown>) => void) => {
          resolveSetup = resolve;
        },
      );
    });
    const { submit, onSuccess } = renderForm();
    submit();
    submit();
    expect(confirmSetupMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSetup!({});
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("can save again when the add-card form is reopened", async () => {
    const first: ReturnType<typeof renderForm> = renderForm();
    first.submit();
    await waitFor(() => {
      expect(first.onSuccess).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    const second: ReturnType<typeof renderForm> = renderForm();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    second.submit();
    await waitFor(() => {
      expect(second.onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(second.onError).not.toHaveBeenCalled();
    expect(confirmSetupMock).toHaveBeenCalledTimes(2);
  });
});
