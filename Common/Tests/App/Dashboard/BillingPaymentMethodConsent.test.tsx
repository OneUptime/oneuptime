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
import CheckoutForm, {
  PAYMENT_METHOD_CONSENT_ERROR,
  PAYMENT_METHOD_CONSENT_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/BillingPaymentMethodForm";
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

describe("Adding a payment method requires acknowledgement of paid usage", () => {
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

  it("shows rates and an unchecked acknowledgement before saving a card", () => {
    const { submit, onError } = renderForm();
    expect(
      screen.getByText(/Your subscription plan stays the same/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Active monitors:/)).toHaveTextContent(
      "$1 per monitor per month",
    );
    expect(screen.getByText(/Logs, traces, metrics/)).toHaveTextContent(
      "$0.10 per GB ingested",
    );
    expect(screen.getByText(/Session replay:/)).toHaveTextContent("$2 per GB");
    expect(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    ).not.toBeChecked();
    submit();
    expect(onError).toHaveBeenCalledWith(PAYMENT_METHOD_CONSENT_ERROR);
    expect(confirmSetupMock).not.toHaveBeenCalled();
  });

  it("does not start setup when the acknowledgement or payment details are clicked", async () => {
    renderForm();
    await userEvent.click(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    );
    await userEvent.click(screen.getByTestId("stripe-payment-element"));
    expect(confirmSetupMock).not.toHaveBeenCalled();
  });

  it("saves only after acknowledgement and returns to the clean billing URL", async () => {
    const { submit, onSuccess, onError } = renderForm();
    await userEvent.click(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    );
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

  it("blocks submission again if acknowledgement is withdrawn", async () => {
    const { submit, onError } = renderForm();
    const checkbox: HTMLElement = screen.getByRole("checkbox", {
      name: PAYMENT_METHOD_CONSENT_LABEL,
    });
    await userEvent.click(checkbox);
    await userEvent.click(checkbox);
    submit();
    expect(onError).toHaveBeenCalledWith(PAYMENT_METHOD_CONSENT_ERROR);
    expect(confirmSetupMock).not.toHaveBeenCalled();
  });

  it.each(["stripe", "elements"])(
    "reports an unavailable %s provider instead of leaving the save button loading",
    async (provider: string) => {
      stripeReady = provider !== "stripe";
      elementsReady = provider !== "elements";
      const { submit, onError } = renderForm();
      await userEvent.click(
        screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
      );
      submit();
      expect(onError).toHaveBeenCalledWith(
        "The payment form is still loading. Please try again in a moment.",
      );
      expect(confirmSetupMock).not.toHaveBeenCalled();
    },
  );

  it("keeps acknowledgement after a provider error and supports retry", async () => {
    confirmSetupMock
      .mockResolvedValueOnce({ error: { message: "Your card was declined." } })
      .mockResolvedValueOnce({});
    const { submit, onSuccess, onError } = renderForm();
    await userEvent.click(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    );
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Your card was declined.");
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    ).toBeChecked();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(confirmSetupMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from an unexpected provider failure without an unhandled rejection", async () => {
    confirmSetupMock.mockRejectedValueOnce(new Error("Network error"));
    const { submit, onError, onSuccess } = renderForm();
    await userEvent.click(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    );
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
    await userEvent.click(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    );
    submit();
    submit();
    expect(confirmSetupMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSetup!({});
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("starts with fresh acknowledgement when the add-card form is reopened", async () => {
    const first: ReturnType<typeof renderForm> = renderForm();
    await userEvent.click(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    );
    first.unmount();
    const second: ReturnType<typeof renderForm> = renderForm();
    expect(
      screen.getByRole("checkbox", { name: PAYMENT_METHOD_CONSENT_LABEL }),
    ).not.toBeChecked();
    second.submit();
    expect(second.onError).toHaveBeenCalledWith(PAYMENT_METHOD_CONSENT_ERROR);
    expect(confirmSetupMock).not.toHaveBeenCalled();
  });
});
