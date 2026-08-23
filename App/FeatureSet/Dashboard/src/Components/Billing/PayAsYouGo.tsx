import { isProjectOnFreePlan } from "../../Utils/PayAsYouGo";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  PRICING_PAGE_URL,
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Pay-as-you-go signposting for Free plan projects.
 *
 * Telemetry ingest and active monitors are metered: nothing about them is
 * included in the Free plan, so a user who creates an ingestion key or a
 * non-Manual monitor starts a charge. The server bills for it either way -
 * these components exist so the first the user hears of it is not the
 * invoice. Everything here renders only when billing is on AND the project is
 * on Free (see isProjectOnFreePlan, which fails closed).
 */

export const TELEMETRY_PRICE_PER_GB_TEXT: string = formatPriceInUSD(
  TELEMETRY_PRICE_IN_USD_PER_GB,
);

export const SESSION_REPLAY_PRICE_PER_GB_TEXT: string = formatPriceInUSD(
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
);

export const ACTIVE_MONITOR_PRICE_TEXT: string = formatPriceInUSD(
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
);

export const TELEMETRY_PRICE_SENTENCE: string = `${TELEMETRY_PRICE_PER_GB_TEXT} per GB ingested, with ${TELEMETRY_PRICE_RETENTION_IN_DAYS} day retention`;

/*
 * Session replay rides on the same ingestion key and is metered at its own,
 * much higher rate. Quoting only the telemetry rate for "what this key costs"
 * would understate a replay-heavy bill twentyfold, so both numbers travel
 * together everywhere the key's price is stated.
 */
export const SESSION_REPLAY_PRICE_SENTENCE: string = `${SESSION_REPLAY_PRICE_PER_GB_TEXT} per GB, with ${TELEMETRY_PRICE_RETENTION_IN_DAYS} day retention`;

export const TELEMETRY_RATES_SENTENCE: string = `Logs, traces, metrics, profiles and security events are billed at ${TELEMETRY_PRICE_SENTENCE}. Session replay recordings are billed at ${SESSION_REPLAY_PRICE_SENTENCE}.`;

export const ACTIVE_MONITOR_PRICE_SENTENCE: string = `${ACTIVE_MONITOR_PRICE_TEXT} per monitor per month`;

/*
 * The form keys the consent checkboxes are stored under. They are declared
 * with overrideField and no overrideFieldKey, which keeps them out of both the
 * model payload and miscDataProps - the acknowledgement never leaves the
 * browser, it only gates the submit.
 */
export const TELEMETRY_CONSENT_FIELD_KEY: string =
  "telemetryPayAsYouGoAcknowledged";

export const MONITOR_CONSENT_FIELD_KEY: string =
  "monitorPayAsYouGoAcknowledged";

export const TELEMETRY_CONSENT_ERROR: string =
  "Please confirm you understand telemetry sent with this key is billed as you use it before creating an ingestion key.";

export const MONITOR_CONSENT_ERROR: string = `Please confirm you understand this monitor is billed at ${ACTIVE_MONITOR_PRICE_TEXT} per month before creating it.`;

type ConsentValidator = (values: FormValues<unknown>) => string | null;

/**
 * A consent box is only satisfied by an explicit `true`. Unchecked (`false`)
 * and never-touched (`undefined`) both have to block, which is why this is a
 * customValidation and not `required` - the form's required check stringifies
 * the value, so `false` reads as the five-character string "false" and sails
 * straight through it.
 */
function buildConsentValidator(data: {
  fieldKey: string;
  message: string;
  isApplicable?: ((values: FormValues<unknown>) => boolean) | undefined;
}): ConsentValidator {
  return (values: FormValues<unknown>): string | null => {
    if (data.isApplicable && !data.isApplicable(values)) {
      return null;
    }

    if ((values as Record<string, unknown>)[data.fieldKey] === true) {
      return null;
    }

    return data.message;
  };
}

export const validateTelemetryConsent: ConsentValidator = buildConsentValidator(
  {
    fieldKey: TELEMETRY_CONSENT_FIELD_KEY,
    message: TELEMETRY_CONSENT_ERROR,
  },
);

export const validateMonitorConsent: ConsentValidator = buildConsentValidator({
  fieldKey: MONITOR_CONSENT_FIELD_KEY,
  message: MONITOR_CONSENT_ERROR,
  /*
   * Manual monitors are free and unlimited, so there is nothing to
   * acknowledge. showIf already hides the box for them; this keeps the
   * validator honest on its own terms too.
   */
  isApplicable: (values: FormValues<unknown>): boolean => {
    return MonitorTypeHelper.isBilledAsActiveMonitor(
      (values as Record<string, unknown>)["monitorType"] as MonitorType,
    );
  },
});

interface PayAsYouGoCardProps {
  cardTitle: string;
  cardDescription: string;
  featureName: string;
  featureIcon: IconProp;
  priceLabel: string;
  priceText: string;
  priceCaption: string;
  summary: string;
  points: Array<string>;
  dataTestId: string;
}

function openPricingPage(): void {
  window.open(PRICING_PAGE_URL, "_blank");
}

/*
 * The page level card. Card's own description is hidden on mobile
 * (`hidden md:block`), so every fact the user needs is repeated inside the
 * body panel rather than living in the description alone.
 */
const PayAsYouGoCard: FunctionComponent<PayAsYouGoCardProps> = (
  props: PayAsYouGoCardProps,
): ReactElement => {
  return (
    <Card
      title={props.cardTitle}
      description={props.cardDescription}
      rightElement={
        <Button
          title="View pricing"
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Billing}
          onClick={openPricingPage}
        />
      }
    >
      <div data-testid={props.dataTestId}>
        <div className="flex flex-col gap-4 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Icon
                icon={props.featureIcon}
                size={SizeProp.Large}
                thick={ThickProp.Thick}
                className="h-6 w-6"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900">
                  {props.featureName}
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  <Icon
                    icon={IconProp.CurrencyDollar}
                    size={SizeProp.Small}
                    thick={ThickProp.Thick}
                    className="h-2.5 w-2.5"
                  />
                  Pay as you go
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-700">{props.summary}</p>
              <ul className="mt-3 space-y-1.5">
                {props.points.map((point: string) => {
                  return (
                    <li
                      key={point}
                      className="flex items-start gap-2 text-sm text-gray-600"
                    >
                      <Icon
                        icon={IconProp.CheckCircle}
                        size={SizeProp.Small}
                        thick={ThickProp.Thick}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500"
                      />
                      <span>{point}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-5 py-4 text-center shadow-sm">
            <p className="text-xs font-semibold text-gray-500">
              {props.priceLabel}
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
              {props.priceText}
            </p>
            <p className="mt-1 text-xs text-gray-500">{props.priceCaption}</p>
          </div>
        </div>
      </div>
    </Card>
  );
};

/**
 * Shown above the telemetry ingestion keys table. Renders nothing unless the
 * project is on the Free plan of a billed deployment.
 */
export const TelemetryPayAsYouGoCard: FunctionComponent = (): ReactElement => {
  if (!isProjectOnFreePlan()) {
    return <></>;
  }

  return (
    <PayAsYouGoCard
      dataTestId="telemetry-pay-as-you-go-card"
      cardTitle="Telemetry is a pay as you go feature"
      cardDescription={`Your project is on the Free plan. Telemetry sent with an ingestion key is billed as you use it, from ${TELEMETRY_PRICE_SENTENCE}.`}
      featureName="Telemetry ingest"
      featureIcon={IconProp.ChartBar}
      priceLabel="Starting at"
      priceText={TELEMETRY_PRICE_PER_GB_TEXT}
      priceCaption={`per GB ingested (${TELEMETRY_PRICE_RETENTION_IN_DAYS} day retention)`}
      summary={`Telemetry is available on the Free plan, but it is not bundled into it. Data you send with an ingestion key is billed as you use it. ${TELEMETRY_RATES_SENTENCE}`}
      points={[
        "No commitment - you are only charged for what you ingest.",
        "Stop sending data, or delete the key, and the charge stops.",
        "Longer retention costs proportionally more per GB.",
      ]}
    />
  );
};

/**
 * Shown above the create monitor form. Renders nothing unless the project is
 * on the Free plan of a billed deployment.
 */
export const MonitorPayAsYouGoCard: FunctionComponent = (): ReactElement => {
  if (!isProjectOnFreePlan()) {
    return <></>;
  }

  return (
    <PayAsYouGoCard
      dataTestId="monitor-pay-as-you-go-card"
      cardTitle="Monitors are a pay as you go feature"
      cardDescription={`Your project is on the Free plan. Every monitor type except Manual is an active monitor, billed at ${ACTIVE_MONITOR_PRICE_SENTENCE}.`}
      featureName="Active monitoring"
      featureIcon={IconProp.Activity}
      priceLabel="Starting at"
      priceText={ACTIVE_MONITOR_PRICE_TEXT}
      priceCaption="per monitor per month"
      summary={`Your project is on the Free plan. Every monitor type except ${MonitorType.Manual} is an active monitor and is billed at ${ACTIVE_MONITOR_PRICE_SENTENCE}.`}
      points={[
        `${MonitorType.Manual} monitors are always free, and unlimited.`,
        "No commitment - delete a monitor and the charge stops.",
        "Telemetry based monitors are billed as active monitors on top of the telemetry they read.",
      ]}
    />
  );
};

/*
 * The compact notice that goes inside the create ingestion key modal, where
 * there is no room for the full card and no page card behind it.
 */
const TelemetryPayAsYouGoModalNotice: FunctionComponent = (): ReactElement => {
  return (
    <AlertBanner
      type={AlertBannerType.Info}
      title="Telemetry is a pay as you go feature"
    >
      <p className="text-sm text-gray-700">
        Your project is on the Free plan, which does not bundle any telemetry.
        Data sent with this ingestion key is billed as you use it.{" "}
        {TELEMETRY_RATES_SENTENCE}{" "}
        <Link
          className="underline"
          openInNewTab={true}
          to={URL.fromString(PRICING_PAGE_URL)}
        >
          See pay as you go pricing
        </Link>
        .
      </p>
    </AlertBanner>
  );
};

/**
 * The pay-as-you-go notice and consent checkbox for the create ingestion key
 * modal, as ModelForm fields. Empty unless the project is on the Free plan, so
 * the modal is untouched for everybody else.
 *
 * Both fields use `overrideField` with no `overrideFieldKey`: that gives them
 * a form value without adding them to the model payload or to miscDataProps.
 */
export function getTelemetryPayAsYouGoFormFields(): Array<
  ModelField<TelemetryIngestionKey>
> {
  if (!isProjectOnFreePlan()) {
    return [];
  }

  return [
    {
      overrideField: {
        telemetryPayAsYouGoNotice: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      doNotShowWhenEditing: true,
      title: "",
      hideOptionalLabel: true,
      spanFullRow: true,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      getCustomElement: (): ReactElement => {
        return <TelemetryPayAsYouGoModalNotice />;
      },
    },
    {
      overrideField: {
        [TELEMETRY_CONSENT_FIELD_KEY]: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      doNotShowWhenEditing: true,
      spanFullRow: true,
      fieldType: FormFieldSchemaType.Checkbox,
      title: "I understand telemetry sent with this key is billed as I use it",
      description: TELEMETRY_RATES_SENTENCE,
      dataTestId: "telemetry-pay-as-you-go-consent",
      /*
       * Seeds the key as false so the field is always present in form values.
       * customValidation is skipped for keys that are absent, and a plain
       * `defaultValue: false` is falsy and would not seed anything - required
       * below is the backstop for that path.
       */
      getDefaultValue: (): boolean => {
        return false;
      },
      required: true,
      customValidation: validateTelemetryConsent as (
        values: FormValues<TelemetryIngestionKey>,
      ) => string | null,
    },
  ];
}

/**
 * Whether a batch of monitors about to be created needs a pay-as-you-go
 * acknowledgement: Free plan, and at least one of them is billed.
 *
 * Bulk creation (monitor recommendations) does not go through a ModelForm, so
 * it cannot use the field factory below - but a "create 18 monitors" button is
 * the largest single charge a Free plan user can start in one click, which is
 * exactly where the notice matters most.
 */
export function isMonitorBatchConsentRequired(
  monitorTypes: Array<MonitorType>,
): boolean {
  if (!isProjectOnFreePlan()) {
    return false;
  }

  return monitorTypes.some((monitorType: MonitorType) => {
    return MonitorTypeHelper.isBilledAsActiveMonitor(monitorType);
  });
}

export function getMonitorBatchPriceSentence(
  monitorTypes: Array<MonitorType>,
): string {
  const billedCount: number = monitorTypes.filter(
    (monitorType: MonitorType) => {
      return MonitorTypeHelper.isBilledAsActiveMonitor(monitorType);
    },
  ).length;

  /*
   * "up to", because the Free plan also caps how many active monitors a
   * project may have - a batch that runs into the cap is rejected part way
   * rather than billed in full.
   */
  return `Creating ${billedCount} ${
    billedCount === 1 ? "monitor" : "monitors"
  } adds up to ${formatPriceInUSD(
    billedCount * ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  )} per month to your bill (${ACTIVE_MONITOR_PRICE_SENTENCE}).`;
}

export interface MonitorBatchConsentProps {
  monitorTypes: Array<MonitorType>;
  value: boolean;
  onChange: (value: boolean) => void;
}

/**
 * The bulk-create counterpart to the create-monitor consent field. Renders
 * nothing when nothing in the batch is billed, or off the Free plan; callers
 * pair it with isMonitorBatchConsentRequired to disable their submit button.
 */
export const MonitorBatchPayAsYouGoConsent: FunctionComponent<
  MonitorBatchConsentProps
> = (props: MonitorBatchConsentProps): ReactElement => {
  if (!isMonitorBatchConsentRequired(props.monitorTypes)) {
    return <></>;
  }

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-4"
      data-testid="monitor-batch-pay-as-you-go-notice"
    >
      <CheckboxElement
        title={`I understand these monitors are billed at ${ACTIVE_MONITOR_PRICE_TEXT} per month each`}
        description={
          <span>
            {getMonitorBatchPriceSentence(props.monitorTypes)}{" "}
            <Link
              className="underline"
              openInNewTab={true}
              to={URL.fromString(PRICING_PAGE_URL)}
            >
              See pay as you go pricing
            </Link>
            .
          </span>
        }
        value={props.value}
        dataTestId="monitor-batch-pay-as-you-go-consent"
        onChange={props.onChange}
      />
    </div>
  );
};

/**
 * The consent checkbox for the create monitor form, as a ModelForm field.
 * Empty unless the project is on the Free plan; hidden (and not validated) for
 * Manual monitors, which are free.
 *
 * `stepId` has to be the step the checkbox lives on: the form only validates
 * fields belonging to the step being submitted.
 */
export function getMonitorPayAsYouGoFormFields(data: {
  stepId: string;
}): Array<ModelField<Monitor>> {
  if (!isProjectOnFreePlan()) {
    return [];
  }

  return [
    {
      overrideField: {
        [MONITOR_CONSENT_FIELD_KEY]: true,
      },
      showEvenIfPermissionDoesNotExist: true,
      stepId: data.stepId,
      spanFullRow: true,
      fieldType: FormFieldSchemaType.Checkbox,
      title: `I understand this monitor is billed at ${ACTIVE_MONITOR_PRICE_TEXT} per month`,
      description: `Your project is on the Free plan. Every monitor type except ${MonitorType.Manual} is an active monitor, billed at ${ACTIVE_MONITOR_PRICE_SENTENCE}. Pick ${MonitorType.Manual} if you do not want to be billed for this monitor.`,
      dataTestId: "monitor-pay-as-you-go-consent",
      getDefaultValue: (): boolean => {
        return false;
      },
      required: true,
      showIf: (values: FormValues<Monitor>): boolean => {
        return MonitorTypeHelper.isBilledAsActiveMonitor(
          values.monitorType as MonitorType,
        );
      },
      customValidation: validateMonitorConsent as (
        values: FormValues<Monitor>,
      ) => string | null,
    },
  ];
}
