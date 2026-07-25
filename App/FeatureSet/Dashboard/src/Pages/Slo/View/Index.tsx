import PageComponentProps from "../../PageComponentProps";
import MonitorsElement from "../../../Components/Monitor/Monitors";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Color from "Common/Types/Color";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Label from "Common/Models/DatabaseModels/Label";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

type FormatPercentFunction = (value: number | undefined | null) => string;

const formatPercent: FormatPercentFunction = (
  value: number | undefined | null,
): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  return `${Math.round(value * 1000) / 1000}%`;
};

/*
 * SLO Overview — the "are we within budget?" page. Error-budget hero on
 * top (SLI vs target, budget remaining, burn rate, status), then the
 * editable configuration below. History charts live on the Charts
 * sub-page.
 */
const SloView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [slo, setSlo] = useState<ServiceLevelObjective | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchSlo: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const item: ServiceLevelObjective | null =
        await ModelAPI.getItem<ServiceLevelObjective>({
          modelType: ServiceLevelObjective,
          id: modelId,
          select: {
            targetPercentage: true,
            windowType: true,
            windowDays: true,
            currentSliPercentage: true,
            errorBudgetRemainingPercentage: true,
            errorBudgetRemainingSeconds: true,
            errorBudgetTotalSeconds: true,
            currentBurnRate: true,
            sloStatus: true,
            lastEvaluatedAt: true,
            isEnabled: true,
          },
        });

      setSlo(item);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchSlo().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  type GetStatusPillFunction = (status: SloStatus | undefined) => ReactElement;

  const getStatusPill: GetStatusPillFunction = (
    status: SloStatus | undefined,
  ): ReactElement => {
    let color: Color = Gray500;

    if (status === SloStatus.Healthy) {
      color = Green;
    } else if (status === SloStatus.AtRisk) {
      color = Yellow;
    } else if (status === SloStatus.BudgetExhausted) {
      color = Red;
    }

    return (
      <Pill
        text={status || SloStatus.Healthy}
        color={color}
        size={PillSize.Normal}
      />
    );
  };

  type GetHeroFunction = () => ReactElement;

  const getHero: GetHeroFunction = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="mb-5 rounded-lg bg-white p-6 shadow">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((index: number) => {
              return (
                <div key={index} className="space-y-2">
                  <div className="h-4 w-20 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-6 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (error || !slo) {
      // The hero is supplementary — the details card below still renders.
      return <></>;
    }

    const budgetRemainingPercentRaw: number | undefined | null =
      slo.errorBudgetRemainingPercentage;
    const budgetRemainingSecondsRaw: number | undefined | null =
      slo.errorBudgetRemainingSeconds;
    const budgetTotalSecondsRaw: number | undefined | null =
      slo.errorBudgetTotalSeconds;

    const budgetRemainingPercent: number | null =
      budgetRemainingPercentRaw === undefined ||
      budgetRemainingPercentRaw === null
        ? null
        : budgetRemainingPercentRaw;

    const budgetRemainingMinutes: number | null =
      budgetRemainingSecondsRaw === undefined ||
      budgetRemainingSecondsRaw === null
        ? null
        : Math.round(budgetRemainingSecondsRaw / 60);

    const budgetTotalMinutes: number | null =
      budgetTotalSecondsRaw === undefined || budgetTotalSecondsRaw === null
        ? null
        : Math.round(budgetTotalSecondsRaw / 60);

    /* Bar is clamped to 0..100 visually; the signed value is shown as text. */
    const budgetBarPercent: number =
      budgetRemainingPercent === null
        ? 0
        : Math.max(0, Math.min(100, budgetRemainingPercent));

    let budgetColorClassName: string = "text-emerald-700";
    let budgetBarColorClassName: string = "bg-emerald-500";
    if (budgetRemainingPercent !== null && budgetRemainingPercent <= 0) {
      budgetColorClassName = "text-red-700";
      budgetBarColorClassName = "bg-red-500";
    } else if (
      budgetRemainingPercent !== null &&
      budgetRemainingPercent <= 20
    ) {
      budgetColorClassName = "text-amber-700";
      budgetBarColorClassName = "bg-amber-500";
    }

    const currentSli: number | undefined | null = slo.currentSliPercentage;
    const target: number | undefined | null = slo.targetPercentage;
    const burnRate: number | undefined | null = slo.currentBurnRate;

    const meetsTarget: boolean =
      currentSli === undefined ||
      currentSli === null ||
      target === undefined ||
      target === null ||
      currentSli >= target;

    const lastEvaluatedAt: Date | null = slo.lastEvaluatedAt
      ? OneUptimeDate.fromString(slo.lastEvaluatedAt)
      : null;

    const windowText: string =
      slo.windowType === SloWindowType.CalendarMonth
        ? "calendar month"
        : `rolling ${slo.windowDays || 30} days`;

    return (
      <div
        data-testid="slo-error-budget-hero"
        className="mb-5 rounded-lg bg-white p-6 shadow"
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
          <div>
            <div className="text-sm font-medium text-gray-500">Current SLI</div>
            <div
              className={`mt-1.5 text-2xl font-semibold ${
                meetsTarget ? "text-gray-900" : "text-red-700"
              }`}
            >
              {formatPercent(slo.currentSliPercentage)}
            </div>
            <div className="mt-1.5 text-xs text-gray-500">
              Target {formatPercent(slo.targetPercentage)} over {windowText}
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-500">
              Error Budget Remaining
            </div>
            <div
              className={`mt-1.5 text-2xl font-semibold ${budgetColorClassName}`}
            >
              {budgetRemainingPercent === null
                ? "—"
                : formatPercent(budgetRemainingPercent)}
            </div>
            <div className="mt-1.5 text-xs text-gray-500">
              {budgetRemainingMinutes === null
                ? "Not evaluated yet"
                : budgetRemainingMinutes < 0
                  ? `${Math.abs(budgetRemainingMinutes)} min over budget`
                  : `${budgetRemainingMinutes} min left${
                      budgetTotalMinutes !== null
                        ? ` of ${budgetTotalMinutes} min`
                        : ""
                    }`}
            </div>
            {budgetRemainingPercent !== null && (
              <div className="mt-2 flex h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full ${budgetBarColorClassName}`}
                  style={{ width: `${budgetBarPercent}%` }}
                ></div>
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium text-gray-500">Burn Rate</div>
            <div className="mt-1.5 text-2xl font-semibold text-gray-900">
              {burnRate === undefined || burnRate === null
                ? "—"
                : `${Math.round(burnRate * 100) / 100}×`}
            </div>
            <div className="mt-1.5 text-xs text-gray-500">
              1× spends the budget exactly over the window
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-500">Status</div>
            <div className="mt-1.5">{getStatusPill(slo.sloStatus)}</div>
            {!slo.isEnabled && (
              <div className="mt-1.5 text-xs text-gray-500">
                This SLO is disabled and is not being evaluated.
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium text-gray-500">
              Last Evaluated
            </div>
            <div className="mt-1.5 text-sm text-gray-900">
              {lastEvaluatedAt ? (
                <span
                  title={OneUptimeDate.getDateAsLocalFormattedString(
                    lastEvaluatedAt,
                  )}
                >
                  {OneUptimeDate.fromNow(lastEvaluatedAt)}
                </span>
              ) : (
                <span className="text-gray-400">
                  Not evaluated yet — evaluation runs every few minutes.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      {getHero()}
      <CardModelDetail<ServiceLevelObjective>
        name="SLO Details"
        cardProps={{
          title: "SLO Details",
          description:
            "Target, compliance window, and the monitors this SLO measures.",
        }}
        isEditable={true}
        onSaveSuccess={() => {
          fetchSlo().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
          });
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "API Availability",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "99.9% availability for the public API",
          },
          {
            field: {
              targetPercentage: true,
            },
            title: "Target (%)",
            description:
              "Reliability target as a percentage, e.g. 99.9. Must be less than 100.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "99.9",
          },
          {
            field: {
              windowType: true,
            },
            title: "Window Type",
            description:
              "Rolling windows look back a fixed number of days. Calendar Month resets on the first of each month.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SloWindowType),
            required: true,
            placeholder: "Rolling",
          },
          {
            field: {
              windowDays: true,
            },
            title: "Window (Days)",
            description:
              "Length of the rolling compliance window. Ignored for Calendar Month windows.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              { label: "7 days", value: 7 },
              { label: "28 days", value: 28 },
              { label: "30 days", value: 30 },
              { label: "90 days", value: 90 },
            ],
            required: true,
            placeholder: "30 days",
          },
          {
            field: {
              atRiskThresholdPercentage: true,
            },
            title: "At-Risk Threshold (%)",
            description:
              "The SLO becomes At Risk when less than this percentage of the error budget remains. Default is 20.",
            fieldType: FormFieldSchemaType.Number,
            /*
             * Required because the column is NOT NULL with a DB default, so
             * the box is always prefilled: clearing a field the UI called
             * optional would otherwise submit "" into an integer column and
             * fail the whole save with an opaque server error.
             */
            required: true,
            placeholder: "20",
          },
          {
            field: {
              multiMonitorMode: true,
            },
            title: "Multi Monitor Mode",
            description:
              "How downtime counts when several monitors are attached: time when any monitor is down, or an average across monitors.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SloMultiMonitorMode),
            required: true,
            placeholder: "Any Monitor Down",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
            description: "Monitors whose uptime is measured by this SLO.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Monitors",
          },
          {
            field: {
              downtimeMonitorStatuses: true,
            },
            title: "Downtime Monitor Statuses",
            description:
              "Monitor statuses that count as downtime for this SLO. Defaults to non-operational statuses.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: MonitorStatus,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Statuses",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description: "Organize and filter SLOs with labels.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            description:
              "Disabled SLOs are not evaluated and do not fire burn-rate alerts.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: ServiceLevelObjective,
          id: "slo-details",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: ServiceLevelObjective): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                targetPercentage: true,
              },
              title: "Target",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return <span>{formatPercent(item.targetPercentage)}</span>;
              },
            },
            {
              field: {
                windowType: true,
              },
              title: "Window",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                if (item.windowType === SloWindowType.CalendarMonth) {
                  return <span>Calendar month</span>;
                }
                return <span>{item.windowDays || 30} days rolling</span>;
              },
            },
            {
              field: {
                atRiskThresholdPercentage: true,
              },
              title: "At-Risk Threshold",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return (
                  <span>
                    {formatPercent(item.atRiskThresholdPercentage)} of budget
                    remaining
                  </span>
                );
              },
            },
            {
              field: {
                multiMonitorMode: true,
              },
              title: "Multi Monitor Mode",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitors: {
                  name: true,
                  _id: true,
                },
              },
              title: "Monitors",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return (
                  <MonitorsElement
                    monitors={(item.monitors as Array<Monitor>) || []}
                  />
                );
              },
            },
            {
              field: {
                downtimeMonitorStatuses: {
                  name: true,
                },
              },
              title: "Downtime Monitor Statuses",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const statuses: Array<MonitorStatus> =
                  (item.downtimeMonitorStatuses as Array<MonitorStatus>) || [];
                if (statuses.length === 0) {
                  return (
                    <span className="text-gray-400">
                      Defaults to non-operational statuses
                    </span>
                  );
                }
                return (
                  <span>
                    {statuses
                      .map((status: MonitorStatus) => {
                        return status.name || "";
                      })
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return (
                  <LabelsElement labels={(item.labels as Array<Label>) || []} />
                );
              },
              showIf: (item: ServiceLevelObjective): boolean => {
                const labels: Array<Label> | undefined =
                  (item.labels as Array<Label> | undefined) ?? undefined;
                return Array.isArray(labels) && labels.length > 0;
              },
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Boolean,
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default SloView;
