import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import BaseAPI from "../../../UI/Utils/API/API";
import ObjectID from "../../../Types/ObjectID";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import MonitorType from "../../../Types/Monitor/MonitorType";
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
  MonitorBatchPayAsYouGoConsent,
  MonitorPayAsYouGoCard,
  SESSION_REPLAY_PRICE_PER_GB_TEXT,
  TELEMETRY_PRICE_PER_GB_TEXT,
  TelemetryPayAsYouGoCard,
  getMonitorBatchPriceSentence,
  getTelemetryPayAsYouGoFormFields,
  isMonitorBatchConsentRequired,
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
  });

  describe("getTelemetryPayAsYouGoFormFields", () => {
    it("adds only a nonblocking notice on the Free plan", () => {
      const fields: Array<ModelField<TelemetryIngestionKey>> =
        getTelemetryPayAsYouGoFormFields();

      expect(fields).toHaveLength(1);
      expect(fields[0]?.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(fields[0]?.required).toBe(false);
      expect(fields[0]?.customValidation).toBeUndefined();
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

    it("keeps both per-GB rates in the modal notice", () => {
      const noticeField: ModelField<TelemetryIngestionKey> =
        getTelemetryPayAsYouGoFormFields()[0]!;

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
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("keeps the notice out of the API payload", () => {
      const noticeField: ModelField<TelemetryIngestionKey> =
        getTelemetryPayAsYouGoFormFields()[0]!;

      expect(noticeField.field).toBeUndefined();
      expect(noticeField.overrideFieldKey).toBeUndefined();
      expect(noticeField.overrideField).toEqual({
        telemetryPayAsYouGoNotice: true,
      });
      expect(noticeField.showEvenIfPermissionDoesNotExist).toBe(true);
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
});
