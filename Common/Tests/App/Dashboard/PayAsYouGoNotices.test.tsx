import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
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

// Imported after the mock so the components read the switchable flag.
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

type SetPlanFunction = (plan: PlanType | null) => void;

const setPlan: SetPlanFunction = (plan: PlanType | null): void => {
  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(plan);
};

describe("Pay as you go notices", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
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
    it("tells a Free plan project every monitor except Manual is billed, and at what rate", () => {
      render(<MonitorPayAsYouGoCard />);

      expect(
        screen.getByText("Monitors are a pay as you go feature"),
      ).toBeInTheDocument();

      const card: HTMLElement = screen.getByTestId(
        "monitor-pay-as-you-go-card",
      );

      expect(card).toHaveTextContent("$1");
      expect(card).toHaveTextContent("per monitor per month");
      expect(card).toHaveTextContent(
        "Every monitor type except Manual is an active monitor",
      );
      expect(card).toHaveTextContent(
        "Manual monitors are always free, and unlimited.",
      );
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

    it("renders nothing on a self-hosted install", () => {
      config.billingEnabled = false;

      const { container }: { container: HTMLElement } = render(
        <MonitorPayAsYouGoCard />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing when the plan is not known yet", () => {
      setPlan(null);

      const { container }: { container: HTMLElement } = render(
        <MonitorPayAsYouGoCard />,
      );

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
    it("adds a notice and a consent checkbox on the Free plan", () => {
      const fields: Array<ModelField<TelemetryIngestionKey>> =
        getTelemetryPayAsYouGoFormFields();

      expect(fields).toHaveLength(2);
      expect(fields[0]?.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(fields[1]?.fieldType).toBe(FormFieldSchemaType.Checkbox);
    });

    it("renders the modal notice with the rate and a pricing link", () => {
      const noticeField: ModelField<TelemetryIngestionKey> =
        getTelemetryPayAsYouGoFormFields()[0]!;

      render(
        <div>
          {noticeField.getCustomElement!(
            {} as FormValues<TelemetryIngestionKey>,
            {},
          )}
        </div>,
      );

      expect(
        screen.getByText("Telemetry is a pay as you go feature"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("See pay as you go pricing").closest("a"),
      ).toHaveAttribute("href", "https://oneuptime.com/pricing");
    });

    it("names both per-GB rates in the modal notice and on the consent box", () => {
      const [noticeField, consentField]: Array<
        ModelField<TelemetryIngestionKey>
      > = getTelemetryPayAsYouGoFormFields() as [
        ModelField<TelemetryIngestionKey>,
        ModelField<TelemetryIngestionKey>,
      ];

      const { container }: { container: HTMLElement } = render(
        <div>
          {noticeField.getCustomElement!(
            {} as FormValues<TelemetryIngestionKey>,
            {},
          )}
        </div>,
      );

      expect(container.textContent).toContain("$0.10 per GB ingested");
      expect(container.textContent).toContain("$2 per GB");

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

    it("adds nothing on a self-hosted install", () => {
      config.billingEnabled = false;

      expect(getTelemetryPayAsYouGoFormFields()).toEqual([]);
    });
  });

  describe("getMonitorPayAsYouGoFormFields", () => {
    it("adds one consent checkbox, on the step it was asked for", () => {
      const fields: Array<ModelField<Monitor>> = getMonitorPayAsYouGoFormFields(
        { stepId: "monitor-info" },
      );

      expect(fields).toHaveLength(1);
      expect(fields[0]?.fieldType).toBe(FormFieldSchemaType.Checkbox);
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

      // Checkbox also passes an "indeterminate" second argument; only the
      // first one is the answer.
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
