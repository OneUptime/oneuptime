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
  DEFAULT_SETUP_ERROR_MESSAGE,
  getSetupIntentPaymentMethodId,
  SETUP_NOT_COMPLETED_ERROR_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/BillingPaymentMethodForm";
import Navigation from "../../../UI/Utils/Navigation";
import URL from "../../../Types/API/URL";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
/*
 * @stripe/* is a Dashboard dependency, not a Common one, so the SetupIntent
 * type is taken from the helper's own signature.
 */
type SetupIntent = Parameters<typeof getSetupIntentPaymentMethodId>[0];

const confirmSetupMock: MockFunction = getJestMockFunction();
let stripeReady: boolean = true;
let elementsReady: boolean = true;
const mockElements: Record<string, unknown> = {};

// The card the affected customer added to replace the declining one.
const NEW_CARD_ID: string = "pm_new_default_card";

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

type SetupIntentOverrides = Record<string, unknown>;

function setupIntentResult(overrides: SetupIntentOverrides = {}): {
  setupIntent: Record<string, unknown>;
} {
  return {
    setupIntent: {
      id: "seti_123",
      object: "setup_intent",
      status: "succeeded",
      payment_method: NEW_CARD_ID,
      last_setup_error: null,
      ...overrides,
    },
  };
}

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
    confirmSetupMock.mockReset().mockResolvedValue(setupIntentResult());
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

  it("saves without an acknowledgement, stays on the page when no redirect is needed, and keeps a clean return URL for redirect-based methods", async () => {
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
      redirect: "if_required",
    });
    expect(onError).not.toHaveBeenCalled();
  });

  /*
   * Production regression: the customer replaced a declining card, but the
   * page never learned which card was added (confirmSetup always redirected)
   * so it could not make it the default and autopay kept charging the old
   * card.
   */
  it("hands the id of the card that was just added to the billing page so it can become the default", async () => {
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(NEW_CARD_ID);
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reads the id from an expanded payment method object", async () => {
    confirmSetupMock.mockResolvedValueOnce(
      setupIntentResult({
        payment_method: { id: "pm_expanded", object: "payment_method" },
      }),
    );
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("pm_expanded");
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("still reports success without an id when a succeeded setup carries no payment method", async () => {
    confirmSetupMock.mockResolvedValueOnce(
      setupIntentResult({ payment_method: null }),
    );
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(null);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports success without an id for a setup that is still processing, since it cannot be made default yet", async () => {
    confirmSetupMock.mockResolvedValueOnce(
      setupIntentResult({ status: "processing" }),
    );
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(null);
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the previous success behaviour when the provider returns neither an error nor a setup intent", async () => {
    confirmSetupMock.mockResolvedValueOnce({});
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(null);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["requires_action", "requires_confirmation", "canceled"])(
    "does not treat a %s setup as saved",
    async (status: string) => {
      confirmSetupMock.mockResolvedValueOnce(
        setupIntentResult({ status: status }),
      );
      const { submit, onSuccess, onError } = renderForm();
      submit();
      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(SETUP_NOT_COMPLETED_ERROR_MESSAGE);
      });
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it("surfaces the provider's reason when the setup needs a different payment method", async () => {
    confirmSetupMock.mockResolvedValueOnce(
      setupIntentResult({
        status: "requires_payment_method",
        payment_method: null,
        last_setup_error: {
          code: "card_declined",
          message: "Your card does not support this type of purchase.",
        },
      }),
    );
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "Your card does not support this type of purchase.",
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("falls back to a readable message when a failed setup has no provider reason", async () => {
    confirmSetupMock.mockResolvedValueOnce(
      setupIntentResult({
        status: "requires_payment_method",
        payment_method: null,
        last_setup_error: null,
      }),
    );
    const { submit, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(SETUP_NOT_COMPLETED_ERROR_MESSAGE);
    });
  });

  it("can save after an authentication that did not complete", async () => {
    confirmSetupMock
      .mockResolvedValueOnce(setupIntentResult({ status: "requires_action" }))
      .mockResolvedValueOnce(setupIntentResult());
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(NEW_CARD_ID);
    });
    expect(confirmSetupMock).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce(setupIntentResult());
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Your card was declined.");
    });
    expect(onSuccess).not.toHaveBeenCalled();
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(NEW_CARD_ID);
    });
    expect(confirmSetupMock).toHaveBeenCalledTimes(2);
  });

  it("uses a readable message for a provider error without one", async () => {
    confirmSetupMock.mockResolvedValueOnce({ error: { type: "api_error" } });
    const { submit, onSuccess, onError } = renderForm();
    submit();
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(DEFAULT_SETUP_ERROR_MESSAGE);
    });
    expect(onSuccess).not.toHaveBeenCalled();
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
      resolveSetup!(setupIntentResult());
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(NEW_CARD_ID);
  });

  it("can save again when the add-card form is reopened", async () => {
    const first: ReturnType<typeof renderForm> = renderForm();
    first.submit();
    await waitFor(() => {
      expect(first.onSuccess).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    confirmSetupMock.mockResolvedValueOnce(
      setupIntentResult({ payment_method: "pm_second" }),
    );
    const second: ReturnType<typeof renderForm> = renderForm();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    second.submit();
    await waitFor(() => {
      expect(second.onSuccess).toHaveBeenCalledWith("pm_second");
    });
    expect(second.onError).not.toHaveBeenCalled();
    expect(confirmSetupMock).toHaveBeenCalledTimes(2);
  });
});

describe("getSetupIntentPaymentMethodId", () => {
  it.each([
    ["a string id", NEW_CARD_ID, NEW_CARD_ID],
    ["an expanded payment method", { id: "pm_obj" }, "pm_obj"],
    ["no payment method", null, null],
    ["an expanded payment method without an id", { id: "" }, null],
  ])(
    "returns the right id for %s",
    (_label: string, paymentMethod: unknown, expected: string | null) => {
      expect(
        getSetupIntentPaymentMethodId({
          payment_method: paymentMethod,
        } as unknown as SetupIntent),
      ).toBe(expected);
    },
  );
});
