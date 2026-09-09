import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import BaseAPI from "../../../UI/Utils/API/API";
import ObjectID from "../../../Types/ObjectID";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  ACTIVE_MONITOR_PRICE_TEXT,
  MONITOR_CONSENT_ERROR,
  MONITOR_CONSENT_FIELD_KEY,
  MonitorBatchPayAsYouGoConsent,
  MonitorPayAsYouGoCard,
  SESSION_REPLAY_PRICE_PER_GB_TEXT,
  TELEMETRY_CONSENT_ERROR,
  TELEMETRY_CONSENT_FIELD_KEY,
  TELEMETRY_PRICE_PER_GB_TEXT,
  TelemetryPayAsYouGoCard,
  getMonitorBatchPriceSentence,
  getMonitorPayAsYouGoFormFields,
  getTelemetryPayAsYouGoFormFields,
  isMonitorBatchConsentRequired,
  validateMonitorConsent,
  validateTelemetryConsent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo";

/*
 * The pay-as-you-go notices are the only warning a Free plan user gets before
 * a charge starts. They have to appear for exactly one audience - Free plan on
 * a billed deployment - and they have to quote the real rate.
 */

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: true };

(
  globalThis as unknown as { __payAsYouGoNoticeConfig: MutableConfig }
).__payAsYouGoNoticeConfig = config;

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...jest.requireActual("../../../UI/Config"),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __payAsYouGoNoticeConfig: MutableConfig | undefined;
          }
        ).__payAsYouGoNoticeConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

type SetPlanFunction = (plan: PlanType | null) => void;

const setPlan: SetPlanFunction = (plan: PlanType | null): void => {
  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(plan);
};

describe("Pay as you go notices", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(ObjectID.generate());
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValue({ data: { isAllowed: true } } as any);
    config.billingEnabled = true;
    setPlan(PlanType.Free);
  });

  describe("TelemetryPayAsYouGoCard", () => {
    it("tells a Free plan project that telemetry is pay as you go, and what it costs", () => {
      render(<TelemetryPayAsYouGoCard />);

      expect(
        screen.getByText("Telemetry is a pay as you go feature"),
      ).toBeInTheDocument();

      const card: HTMLElement = screen.getByTestId(
        "telemetry-pay-as-you-go-card",
      );

      expect(card).toHaveTextContent("$0.10");
      expect(card).toHaveTextContent("per GB ingested (15 day retention)");
      expect(card).toHaveTextContent("Pay as you go");
      expect(card).toHaveTextContent(
        "$0.10 per GB ingested, with 15 day retention",
      );
    });

    it("also quotes the session replay rate, which rides on the same key at 20x", () => {
      /*
       * Session replay is metered at $2.00/GB through the same ingestion key.
       * A card that quotes only $0.10 invites a user to plan around a bill
       * twenty times smaller than the one they will get.
       */
      render(<TelemetryPayAsYouGoCard />);

      const card: HTMLElement = screen.getByTestId(
        "telemetry-pay-as-you-go-card",
      );

      expect(card).toHaveTextContent("Session replay recordings are billed at");
      expect(card).toHaveTextContent("$2 per GB, with 15 day retention");
      expect(card).toHaveTextContent("Starting at");
    });

    it("names security events among the pillars billed at the telemetry rate", () => {
      /*
       * Security events ingest on the same key and meter at the same
       * $0.10/GB as the other telemetry pillars. This sentence is the body of
       * the consent checkbox a user has to tick to create a key, so a pillar
       * missing from it is a pillar the user is charged for without ever
       * having been told.
       */
      render(<TelemetryPayAsYouGoCard />);

      expect(
        screen.getByTestId("telemetry-pay-as-you-go-card"),
      ).toHaveTextContent(
        "Logs, traces, metrics, profiles and security events are billed at",
      );
    });

    it("says the charge stops when the key is deleted, so the notice is not just a threat", () => {
      render(<TelemetryPayAsYouGoCard />);

      expect(
        screen.getByTestId("telemetry-pay-as-you-go-card"),
      ).toHaveTextContent("delete the key, and the charge stops");
    });

    it("links out to the public pricing page", async () => {
      const open: jest.SpyInstance<any, any> = getJestSpyOn(window, "open");
      open.mockImplementation(() => {
        return null;
      });

      render(<TelemetryPayAsYouGoCard />);

      await userEvent.click(screen.getByText("View pricing"));

      expect(open).toHaveBeenCalledWith(
        "https://oneuptime.com/pricing",
        "_blank",
      );
    });

    it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
      "renders nothing on the %s plan",
      (plan: PlanType) => {
        setPlan(plan);

        const { container }: { container: HTMLElement } = render(
          <TelemetryPayAsYouGoCard />,
        );

        expect(container).toBeEmptyDOMElement();
      },
    );

    it("renders nothing on a self-hosted install", () => {
      config.billingEnabled = false;

      const { container }: { container: HTMLElement } = render(
        <TelemetryPayAsYouGoCard />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("MonitorPayAsYouGoCard", () => {
    it("provides a named pricing region with a clear heading hierarchy", () => {
      render(<MonitorPayAsYouGoCard />);

      const card: HTMLElement = screen.getByRole("region", {
        name: "Monitor pricing",
      });

      expect(card).toHaveAttribute("data-testid", "monitor-pay-as-you-go-card");
      expect(
        within(card).getByRole("heading", {
          name: "Monitor pricing",
          level: 2,
        }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("heading", {
          name: "Active monitoring",
          level: 3,
        }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("heading", {
          name: "Manual monitors",
          level: 3,
        }),
      ).toBeInTheDocument();
    });

    it("renders icon wrappers in valid HTML containers", () => {
      render(<MonitorPayAsYouGoCard />);

      const card: HTMLElement = screen.getByRole("region", {
        name: "Monitor pricing",
      });

      // Icon includes a div wrapper, which cannot be nested inside p or span.
      expect(card.querySelector("p div, span div")).toBeNull();
    });

    it("introduces the Free plan once without repeating the pricing summary", () => {
      render(<MonitorPayAsYouGoCard />);

      expect(
        screen.getAllByText(
          "Your project is on the Free plan. Choose the monitoring that fits your needs.",
        ),
      ).toHaveLength(1);
      expect(
        screen.getAllByText(/Your project is on the Free plan/),
      ).toHaveLength(1);
      expect(
        screen.queryByText("Monitors are a pay as you go feature"),
      ).not.toBeInTheDocument();
    });

    it("quotes the real active-monitor rate once with its billing unit", () => {
      render(<MonitorPayAsYouGoCard />);

      expect(screen.getAllByText(ACTIVE_MONITOR_PRICE_TEXT)).toHaveLength(1);
      expect(screen.getAllByText("per monitor per month")).toHaveLength(1);
      expect(screen.getByText("Pay as you go")).toBeInTheDocument();
      expect(
        screen.getAllByText(
          "Every monitor type except Manual is an active monitor.",
        ),
      ).toHaveLength(1);
      expect(screen.queryByText("Starting at")).not.toBeInTheDocument();
    });

    it("makes the unlimited free Manual option explicit", () => {
      render(<MonitorPayAsYouGoCard />);

      expect(screen.getByText("Always free")).toBeInTheDocument();
      expect(
        screen.getByText("Unlimited monitors. No monitoring charges."),
      ).toBeInTheDocument();
    });

    it("explains how to start and stop active-monitor charges", () => {
      render(<MonitorPayAsYouGoCard />);

      expect(
        screen.getAllByText(
          "Add a payment method before creating an active monitor.",
        ),
      ).toHaveLength(1);
      expect(
        screen.getByText(
          "No commitment. Delete a monitor to stop its charges.",
        ),
      ).toBeInTheDocument();
    });

    it("preserves the additional telemetry charge disclosure", () => {
      render(<MonitorPayAsYouGoCard />);

      expect(
        screen.getAllByText(
          "Telemetry-based monitors also incur charges for the telemetry they read.",
        ),
      ).toHaveLength(1);
    });

    it("offers a native pricing link that opens in a separate tab", () => {
      render(<MonitorPayAsYouGoCard />);

      const pricingLink: HTMLElement = screen.getByRole("link", {
        name: "View pricing",
      });

      expect(pricingLink).toHaveAttribute(
        "href",
        "https://oneuptime.com/pricing",
      );
      expect(pricingLink).toHaveAttribute("target", "_blank");
      expect(pricingLink).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("makes View pricing reachable with the keyboard", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      render(<MonitorPayAsYouGoCard />);

      await user.tab();

      expect(screen.getByRole("link", { name: "View pricing" })).toHaveFocus();
    });

    it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
      "renders nothing on the %s plan",
      (plan: PlanType) => {
        setPlan(plan);

        const { container }: { container: HTMLElement } = render(
          <MonitorPayAsYouGoCard />,
        );

        expect(container).toBeEmptyDOMElement();
      },
    );

    it.each([
      PlanType.Free,
      PlanType.Growth,
      PlanType.Scale,
      PlanType.Enterprise,
      null,
    ])(
      "renders nothing on a self-hosted install with plan %s",
      (plan: PlanType | null) => {
        config.billingEnabled = false;
        setPlan(plan);

        const { container }: { container: HTMLElement } = render(
          <MonitorPayAsYouGoCard />,
        );

        expect(container).toBeEmptyDOMElement();
      },
    );

    it("renders nothing when the plan is not known yet", () => {
      setPlan(null);

      const { container }: { container: HTMLElement } = render(
        <MonitorPayAsYouGoCard />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it("shows pricing when the plan becomes available and removes it after an upgrade", () => {
      setPlan(null);

      const { container, rerender } = render(<MonitorPayAsYouGoCard />);

      expect(container).toBeEmptyDOMElement();

      setPlan(PlanType.Free);
      rerender(<MonitorPayAsYouGoCard />);

      expect(
        screen.getByRole("region", { name: "Monitor pricing" }),
      ).toBeInTheDocument();

      setPlan(PlanType.Growth);
      rerender(<MonitorPayAsYouGoCard />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("quoted rates match the pricing constants", () => {
    it("uses the advertised figures verbatim", () => {
      expect(TELEMETRY_PRICE_PER_GB_TEXT).toBe("$0.10");
      expect(SESSION_REPLAY_PRICE_PER_GB_TEXT).toBe("$2");
      expect(ACTIVE_MONITOR_PRICE_TEXT).toBe("$1");
      expect(MONITOR_CONSENT_ERROR).toContain("$1");
    });

    it("does not put a single per-GB rate in the telemetry consent error", () => {
      /*
       * Two different per-GB rates travel on one ingestion key, so any single
       * figure in a message about "telemetry" is wrong for one of them. The
       * error stays rate-free and the rates live next to the checkbox.
       */
      expect(TELEMETRY_CONSENT_ERROR).not.toContain("$");
      expect(TELEMETRY_CONSENT_ERROR).toContain("billed as you use it");
    });
  });

  describe("getTelemetryPayAsYouGoFormFields", () => {
    const renderModalNotice: () => HTMLElement = (): HTMLElement => {
      const noticeField: ModelField<TelemetryIngestionKey> =
        getTelemetryPayAsYouGoFormFields()[0]!;

      render(
        <>
          {noticeField.getCustomElement!(
            {} as FormValues<TelemetryIngestionKey>,
            {},
          )}
        </>,
      );

      return screen.getByRole("region", { name: "Telemetry pricing" });
    };

    it("adds a notice and a consent checkbox on the Free plan", () => {
      const fields: Array<ModelField<TelemetryIngestionKey>> =
        getTelemetryPayAsYouGoFormFields();

      expect(fields).toHaveLength(2);
      expect(fields[0]?.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(fields[1]?.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    });

    it("gives the modal notice a named pricing region and a clear heading", () => {
      const notice: HTMLElement = renderModalNotice();

      expect(notice).toHaveAttribute(
        "data-testid",
        "telemetry-pay-as-you-go-notice",
      );
      expect(
        within(notice).getByRole("heading", {
          name: "Telemetry pricing",
          level: 3,
        }),
      ).toBeInTheDocument();
      expect(within(notice).getByText("Pay as you go")).toBeInTheDocument();
    });

    it("explains that the Free plan excludes telemetry without repeating the introduction", () => {
      const notice: HTMLElement = renderModalNotice();

      expect(
        within(notice).getAllByText(
          "Telemetry is not included in your Free plan.",
        ),
      ).toHaveLength(1);
      expect(within(notice).getAllByText(/Free plan/)).toHaveLength(1);
    });

    it.each([
      {
        name: "Telemetry",
        description: "Logs, traces, metrics, profiles and security events",
        price: TELEMETRY_PRICE_PER_GB_TEXT,
        unit: "per GB ingested",
        otherPrice: SESSION_REPLAY_PRICE_PER_GB_TEXT,
      },
      {
        name: "Session replay",
        description: "Session replay recordings",
        price: SESSION_REPLAY_PRICE_PER_GB_TEXT,
        unit: "per GB",
        otherPrice: TELEMETRY_PRICE_PER_GB_TEXT,
      },
    ])(
      "associates the $name rate and unit with its own data types",
      ({ name, description, price, unit, otherPrice }) => {
        const notice: HTMLElement = renderModalNotice();
        const rate: HTMLElement = within(notice).getByRole("group", { name });

        expect(
          within(rate).getByRole("heading", { name, level: 4 }),
        ).toBeInTheDocument();
        expect(within(rate).getByText(description)).toBeInTheDocument();
        expect(within(rate).getByText(price)).toBeInTheDocument();
        expect(within(rate).getByText(unit)).toBeInTheDocument();
        expect(within(rate).queryByText(otherPrice)).not.toBeInTheDocument();
        expect(within(notice).getAllByText(price)).toHaveLength(1);
      },
    );

    it("makes the shared 15-day retention explicit once", () => {
      const notice: HTMLElement = renderModalNotice();

      expect(
        within(notice).getAllByText("15 day retention for both."),
      ).toHaveLength(1);
      expect(within(notice).getAllByText(/retention/)).toHaveLength(1);
    });

    it("requires a payment method before creating a key as well as sending paid telemetry", () => {
      const notice: HTMLElement = renderModalNotice();

      expect(
        within(notice).getAllByText(
          "Add a payment method before creating a key or sending paid telemetry.",
        ),
      ).toHaveLength(1);
    });

    it("presents the pricing information without an assertive alert", () => {
      const notice: HTMLElement = renderModalNotice();

      expect(notice).not.toHaveAttribute("role", "alert");
      expect(notice).not.toHaveAttribute("aria-live", "assertive");
      expect(within(notice).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps icon wrappers in valid HTML containers", () => {
      const notice: HTMLElement = renderModalNotice();

      // Icon renders a div wrapper, so inline or paragraph parents are invalid.
      expect(notice.querySelector("p div, span div")).toBeNull();
    });

    it("offers a native pricing link that opens in a separate tab", () => {
      const notice: HTMLElement = renderModalNotice();
      const pricingLink: HTMLElement = within(notice).getByRole("link", {
        name: "View pricing",
      });

      expect(pricingLink).toHaveAttribute(
        "href",
        "https://oneuptime.com/pricing",
      );
      expect(pricingLink).toHaveAttribute("target", "_blank");
      expect(pricingLink).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("makes View pricing reachable with the keyboard", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const notice: HTMLElement = renderModalNotice();

      await user.tab();

      expect(
        within(notice).getByRole("link", { name: "View pricing" }),
      ).toHaveFocus();
    });

    it("keeps the informational notice out of the API payload and edit form", () => {
      const noticeField: ModelField<TelemetryIngestionKey> =
        getTelemetryPayAsYouGoFormFields()[0]!;

      expect(noticeField.field).toBeUndefined();
      expect(noticeField.overrideFieldKey).toBeUndefined();
      expect(noticeField.overrideField).toEqual({
        telemetryPayAsYouGoNotice: true,
      });
      expect(noticeField.showEvenIfPermissionDoesNotExist).toBe(true);
      expect(noticeField.doNotShowWhenEditing).toBe(true);
      expect(noticeField.required).toBe(false);
    });

    it("keeps consent explicit when the notice and checkbox are rendered together", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const onChange: MockFunction = getJestMockFunction();
      const fields: Array<ModelField<TelemetryIngestionKey>> =
        getTelemetryPayAsYouGoFormFields();
      const initialValues: FormValues<TelemetryIngestionKey> = {
        [TELEMETRY_CONSENT_FIELD_KEY]: false,
      } as FormValues<TelemetryIngestionKey>;

      render(
        <>
          {fields.map(
            (field: ModelField<TelemetryIngestionKey>, index: number) => {
              return (
                <React.Fragment key={index}>
                  {field.getCustomElement!(initialValues, {
                    onChange: onChange as (value: boolean) => void,
                  })}
                </React.Fragment>
              );
            },
          )}
        </>,
      );

      const checkbox: HTMLElement = screen.getByRole("checkbox", {
        name: "I agree to these usage charges",
      });

      await waitFor(() => {
        expect(checkbox).toBeEnabled();
      });
      expect(checkbox).not.toBeChecked();
      expect(fields[1]!.customValidation!(initialValues)).toBe(
        TELEMETRY_CONSENT_ERROR,
      );

      await user.tab();
      expect(screen.getByRole("link", { name: "View pricing" })).toHaveFocus();
      expect(onChange).not.toHaveBeenCalled();

      await user.tab();
      expect(checkbox).toHaveFocus();
      await act(async (): Promise<void> => {
        await user.keyboard(" ");
      });

      expect(onChange).toHaveBeenCalledWith(true);
      expect(checkbox).toBeChecked();
      expect(
        fields[1]!.customValidation!({
          [TELEMETRY_CONSENT_FIELD_KEY]: true,
        } as FormValues<TelemetryIngestionKey>),
      ).toBeNull();
    });

    it("keeps pricing available while a missing payment method blocks consent", async () => {
      jest
        .spyOn(BaseAPI, "get")
        .mockResolvedValue({ data: { isAllowed: false } } as any);
      const onChange: MockFunction = getJestMockFunction();
      const fields: Array<ModelField<TelemetryIngestionKey>> =
        getTelemetryPayAsYouGoFormFields();

      render(
        <>
          {fields.map(
            (field: ModelField<TelemetryIngestionKey>, index: number) => {
              return (
                <React.Fragment key={index}>
                  {field.getCustomElement!(
                    {
                      [TELEMETRY_CONSENT_FIELD_KEY]: false,
                    } as FormValues<TelemetryIngestionKey>,
                    { onChange: onChange as (value: boolean) => void },
                  )}
                </React.Fragment>
              );
            },
          )}
        </>,
      );

      expect(
        await screen.findByText(
          "Add a payment method before using this paid feature. Free features remain available without a card.",
        ),
      ).toBeInTheDocument();
      const checkbox: HTMLElement = screen.getByRole("checkbox", {
        name: "I agree to these usage charges",
      });

      expect(checkbox).toBeDisabled();
      expect(checkbox).not.toBeChecked();
      expect(
        screen.getByRole("region", { name: "Telemetry pricing" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "View pricing" }),
      ).toHaveAttribute("href", "https://oneuptime.com/pricing");
      await userEvent.click(checkbox);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("names both per-GB rates in the modal notice and on the consent box", () => {
      const [noticeField, consentField]: Array<
        ModelField<TelemetryIngestionKey>
      > = getTelemetryPayAsYouGoFormFields() as [
        ModelField<TelemetryIngestionKey>,
        ModelField<TelemetryIngestionKey>,
      ];

      render(
        <div>
          {noticeField.getCustomElement!(
            {} as FormValues<TelemetryIngestionKey>,
            {},
          )}
        </div>,
      );

      const notice: HTMLElement = screen.getByRole("region", {
        name: "Telemetry pricing",
      });

      expect(notice).toHaveTextContent("$0.10");
      expect(notice).toHaveTextContent("per GB ingested");
      expect(notice).toHaveTextContent("$2");
      expect(notice).toHaveTextContent("per GB");

      /*
       * The title is the sentence the user affirms by ticking, so it must not
       * carry a rate that is wrong for half the data the key accepts.
       */
      expect(consentField.title).not.toContain("$");
      expect(String(consentField.description)).toContain("$0.10 per GB");
      expect(String(consentField.description)).toContain("$2 per GB");
    });

    it("keeps the consent value out of the API payload", () => {
      const consentField: ModelField<TelemetryIngestionKey> =
        getTelemetryPayAsYouGoFormFields()[1]!;

      /*
       * overrideField with no overrideFieldKey is what makes this a purely
       * client-side field: ModelForm builds the payload from `field`, and
       * miscDataProps from `overrideFieldKey`. Neither is set to a real key.
       */
      expect(consentField.field).toBeUndefined();
      expect(consentField.overrideFieldKey).toBeUndefined();
      expect(consentField.overrideField).toEqual({
        [TELEMETRY_CONSENT_FIELD_KEY]: true,
      });
      expect(consentField.showEvenIfPermissionDoesNotExist).toBe(true);
    });

    it("seeds the consent value as false so validation actually runs on it", () => {
      const consentField: ModelField<TelemetryIngestionKey> =
        getTelemetryPayAsYouGoFormFields()[1]!;

      /*
       * The form skips customValidation for keys that are absent from its
       * values, and a plain `defaultValue: false` is falsy and seeds nothing.
       * getDefaultValue is the only thing that puts the key there.
       */
      expect(consentField.getDefaultValue).toBeDefined();
      expect(
        consentField.getDefaultValue!({} as FormValues<TelemetryIngestionKey>),
      ).toBe(false);
      expect(consentField.required).toBe(true);
    });

    it("does not touch the edit form - the key is only created once", () => {
      for (const field of getTelemetryPayAsYouGoFormFields()) {
        expect(field.doNotShowWhenEditing).toBe(true);
      }
    });

    it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
      "adds nothing on the %s plan",
      (plan: PlanType) => {
        setPlan(plan);

        expect(getTelemetryPayAsYouGoFormFields()).toEqual([]);
      },
    );

    it.each([
      PlanType.Free,
      PlanType.Growth,
      PlanType.Scale,
      PlanType.Enterprise,
      null,
    ])(
      "adds nothing on a self-hosted install with plan %s",
      (plan: PlanType | null) => {
        config.billingEnabled = false;
        setPlan(plan);

        expect(getTelemetryPayAsYouGoFormFields()).toEqual([]);
      },
    );

    it("adds nothing while the current plan is unknown", () => {
      setPlan(null);

      expect(getTelemetryPayAsYouGoFormFields()).toEqual([]);
    });

    it("adds the notice when the Free plan loads and removes it after an upgrade", () => {
      setPlan(null);
      expect(getTelemetryPayAsYouGoFormFields()).toEqual([]);

      setPlan(PlanType.Free);
      expect(getTelemetryPayAsYouGoFormFields()).toHaveLength(2);

      setPlan(PlanType.Growth);
      expect(getTelemetryPayAsYouGoFormFields()).toEqual([]);
    });
  });

  describe("getMonitorPayAsYouGoFormFields", () => {
    it("adds one consent checkbox, on the step it was asked for", () => {
      const fields: Array<ModelField<Monitor>> = getMonitorPayAsYouGoFormFields(
        { stepId: "monitor-info" },
      );

      expect(fields).toHaveLength(1);
      expect(fields[0]?.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(fields[0]?.stepId).toBe("monitor-info");
      expect(fields[0]?.overrideField).toEqual({
        [MONITOR_CONSENT_FIELD_KEY]: true,
      });
      expect(fields[0]?.overrideFieldKey).toBeUndefined();
    });

    it("is shown for billed monitor types and hidden for Manual", () => {
      const showIf: (values: FormValues<Monitor>) => boolean =
        getMonitorPayAsYouGoFormFields({ stepId: "monitor-info" })[0]!.showIf!;

      expect(
        showIf({ monitorType: MonitorType.Manual } as FormValues<Monitor>),
      ).toBe(false);

      for (const monitorType of [
        MonitorType.Website,
        MonitorType.API,
        MonitorType.Logs,
        MonitorType.IncomingRequest,
        MonitorType.NetworkDevice,
      ]) {
        expect(
          showIf({ monitorType: monitorType } as FormValues<Monitor>),
        ).toBe(true);
      }
    });

    it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
      "adds nothing on the %s plan",
      (plan: PlanType) => {
        setPlan(plan);

        expect(
          getMonitorPayAsYouGoFormFields({ stepId: "monitor-info" }),
        ).toEqual([]);
      },
    );

    it("adds nothing on a self-hosted install", () => {
      config.billingEnabled = false;

      expect(
        getMonitorPayAsYouGoFormFields({ stepId: "monitor-info" }),
      ).toEqual([]);
    });
  });

  describe("bulk monitor creation (recommendations)", () => {
    it("needs consent when any monitor in the batch is billed", () => {
      expect(
        isMonitorBatchConsentRequired([
          MonitorType.Manual,
          MonitorType.Kubernetes,
        ]),
      ).toBe(true);
      expect(isMonitorBatchConsentRequired([MonitorType.Host])).toBe(true);
    });

    it("needs no consent for an all-Manual or empty batch", () => {
      expect(isMonitorBatchConsentRequired([MonitorType.Manual])).toBe(false);
      expect(isMonitorBatchConsentRequired([])).toBe(false);
    });

    it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
      "needs no consent on the %s plan",
      (plan: PlanType) => {
        setPlan(plan);

        expect(isMonitorBatchConsentRequired([MonitorType.Kubernetes])).toBe(
          false,
        );
      },
    );

    it("needs no consent on a self-hosted install", () => {
      config.billingEnabled = false;

      expect(isMonitorBatchConsentRequired([MonitorType.Kubernetes])).toBe(
        false,
      );
    });

    it("quotes the batch total, counting only the billed monitors", () => {
      const sentence: string = getMonitorBatchPriceSentence([
        MonitorType.Kubernetes,
        MonitorType.Host,
        MonitorType.Docker,
        MonitorType.Manual,
      ]);

      /*
       * "up to", because the Free plan also caps active monitors - a batch
       * that hits the cap is rejected part way rather than billed in full.
       */
      expect(sentence).toContain("Creating 3 monitors");
      expect(sentence).toContain("adds up to $3 per month");
      expect(sentence).toContain("$1 per monitor per month");
    });

    it("says monitor, not monitors, for a batch of one", () => {
      expect(getMonitorBatchPriceSentence([MonitorType.Host])).toContain(
        "Creating 1 monitor adds up to $1 per month",
      );
    });

    it("renders a checkbox carrying the batch total and a pricing link", () => {
      render(
        <MonitorBatchPayAsYouGoConsent
          monitorTypes={[MonitorType.Kubernetes, MonitorType.Host]}
          value={false}
          onChange={() => {}}
        />,
      );

      const notice: HTMLElement = screen.getByTestId(
        "monitor-batch-pay-as-you-go-notice",
      );

      expect(notice).toHaveTextContent("adds up to $2 per month");
      expect(
        screen.getByTestId("monitor-batch-pay-as-you-go-consent"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("See pay as you go pricing").closest("a"),
      ).toHaveAttribute("href", "https://oneuptime.com/pricing");
    });

    it("reports ticks back to the caller, which is what unlocks its submit", async () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <MonitorBatchPayAsYouGoConsent
          monitorTypes={[MonitorType.Kubernetes]}
          value={false}
          onChange={onChange as (value: boolean) => void}
        />,
      );

      await userEvent.click(
        screen.getByTestId("monitor-batch-pay-as-you-go-consent"),
      );

      /*
       * Checkbox also passes an "indeterminate" second argument; only the
       * first one is the answer.
       */
      expect(onChange.mock.calls[0]?.[0]).toBe(true);
    });

    it("renders nothing for an all-Manual batch", () => {
      const { container }: { container: HTMLElement } = render(
        <MonitorBatchPayAsYouGoConsent
          monitorTypes={[MonitorType.Manual]}
          value={false}
          onChange={() => {}}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing off the Free plan", () => {
      setPlan(PlanType.Growth);

      const { container }: { container: HTMLElement } = render(
        <MonitorBatchPayAsYouGoConsent
          monitorTypes={[MonitorType.Kubernetes]}
          value={false}
          onChange={() => {}}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("consent validators", () => {
    it("only an explicit tick satisfies the telemetry consent", () => {
      expect(validateTelemetryConsent({})).toBe(TELEMETRY_CONSENT_ERROR);
      expect(
        validateTelemetryConsent({ [TELEMETRY_CONSENT_FIELD_KEY]: false }),
      ).toBe(TELEMETRY_CONSENT_ERROR);
      expect(
        validateTelemetryConsent({ [TELEMETRY_CONSENT_FIELD_KEY]: undefined }),
      ).toBe(TELEMETRY_CONSENT_ERROR);
      expect(
        validateTelemetryConsent({ [TELEMETRY_CONSENT_FIELD_KEY]: true }),
      ).toBeNull();
    });

    it("does not accept a truthy non-boolean as consent", () => {
      /*
       * The form's own `required` check stringifies values, which is exactly
       * why it cannot be used here - "false" is a non-empty string. Nothing
       * but boolean true counts.
       */
      expect(
        validateTelemetryConsent({ [TELEMETRY_CONSENT_FIELD_KEY]: "true" }),
      ).toBe(TELEMETRY_CONSENT_ERROR);
      expect(
        validateTelemetryConsent({ [TELEMETRY_CONSENT_FIELD_KEY]: 1 }),
      ).toBe(TELEMETRY_CONSENT_ERROR);
    });

    it("blocks a billed monitor until it is acknowledged", () => {
      expect(validateMonitorConsent({ monitorType: MonitorType.Website })).toBe(
        MONITOR_CONSENT_ERROR,
      );
      expect(
        validateMonitorConsent({
          monitorType: MonitorType.Website,
          [MONITOR_CONSENT_FIELD_KEY]: false,
        }),
      ).toBe(MONITOR_CONSENT_ERROR);
      expect(
        validateMonitorConsent({
          monitorType: MonitorType.Website,
          [MONITOR_CONSENT_FIELD_KEY]: true,
        }),
      ).toBeNull();
    });

    it("never blocks a Manual monitor - there is nothing to acknowledge", () => {
      expect(validateMonitorConsent({ monitorType: MonitorType.Manual })).toBe(
        null,
      );
      expect(
        validateMonitorConsent({
          monitorType: MonitorType.Manual,
          [MONITOR_CONSENT_FIELD_KEY]: false,
        }),
      ).toBeNull();
    });

    it("blocks when no monitor type has been picked yet", () => {
      /*
       * An unset type is not Manual, so it is treated as billed. Failing this
       * way round means the box can never be skipped by submitting early.
       */
      expect(validateMonitorConsent({})).toBe(MONITOR_CONSENT_ERROR);
    });
  });
});
