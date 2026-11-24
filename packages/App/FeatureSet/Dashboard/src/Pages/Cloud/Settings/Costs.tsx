import PageComponentProps from "../../PageComponentProps";
import { forgetProjectCloudCostBasis } from "../../../Components/Cloud/CloudCostBasis";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import CloudCostSetting from "Common/Models/DatabaseModels/CloudCostSetting";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { isCloudCommitmentExpiryDaysText } from "Common/Types/Cloud/CloudCommitmentAlerts";
import {
  CLOUD_COST_BASES,
  CLOUD_COST_BASIS_DESCRIPTIONS,
  CLOUD_COST_BASIS_LABELS,
  CloudCostBasis,
  resolveCloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Cloud > Settings > Cost Settings: what the Cloud pages show and budgets
 * watch - billed, amortized or net costs (#11007) - and when the project's
 * commitments alert (#11011): how many days before one ends, under what
 * utilization and coverage, and who is told. A project has one settings
 * row, made with every default the first time anything asks for it: the
 * page may be opened before any cost was read, so it does the same.
 */

export const COST_BASIS_CARD_TITLE: string = translationKey("Cost Basis");
export const COST_BASIS_CARD_DESCRIPTION: string = translationKey(
  "The cost the Cloud pages open on and budgets watch, unless a person or a budget picks another.",
);
export const COMMITMENT_ALERTS_CARD_TITLE: string =
  translationKey("Commitment Alerts");
export const COMMITMENT_ALERTS_CARD_DESCRIPTION: string = translationKey(
  "When your Savings Plans, reservations and committed use discounts alert: before one ends, while one is under-used, and when coverage falls.",
);
export const EXPIRY_DAYS_NOT_DAYS: string = translationKey(
  "Write each as a whole number of days, separated by commas, such as 90, 30, 7.",
);
export const COVERAGE_ALERTS_OFF: string = translationKey("Off");
export const SETTINGS_NOT_MADE: string = translationKey(
  "These settings have not been made yet. Someone who may edit cloud resources needs to open this page first.",
);

async function readSettingId(projectId: ObjectID): Promise<ObjectID | null> {
  const result: ListResult<CloudCostSetting> =
    await ModelAPI.getList<CloudCostSetting>({
      modelType: CloudCostSetting,
      query: { projectId },
      limit: 1,
      skip: 0,
      select: { _id: true },
      sort: {},
    });

  return result.data[0]?.id || null;
}

const CloudCostSettingsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [settingId, setSettingId] = useState<ObjectID | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      if (!projectId) {
        return;
      }

      try {
        let id: ObjectID | null = await readSettingId(projectId);

        if (!id) {
          const setting: CloudCostSetting = new CloudCostSetting();
          setting.projectId = projectId;

          try {
            await ModelAPI.create<CloudCostSetting>({
              model: setting,
              modelType: CloudCostSetting,
            });
          } catch {
            // Another tab made it first, or this person may only read: read below.
          }

          id = await readSettingId(projectId);
        }

        setSettingId(id);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!settingId) {
    return <ErrorMessage message={SETTINGS_NOT_MADE} />;
  }

  const percent: (value: unknown) => string = (value: unknown): string => {
    const number: number = Number(value);

    return Number.isFinite(number) && value !== null && value !== undefined
      ? `${translator.formatNumber(number)}%`
      : translator.translateText(COVERAGE_ALERTS_OFF) || COVERAGE_ALERTS_OFF;
  };

  return (
    <Fragment>
      <CardModelDetail<CloudCostSetting>
        name="cloud-cost-basis-setting"
        cardProps={{
          title: COST_BASIS_CARD_TITLE,
          description: COST_BASIS_CARD_DESCRIPTION,
        }}
        isEditable={true}
        onSaveSuccess={() => {
          if (projectId) {
            forgetProjectCloudCostBasis(projectId.toString());
          }
        }}
        formFields={[
          {
            field: { costBasis: true },
            title: "Cost Basis",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: CLOUD_COST_BASES.map((basis: CloudCostBasis) => {
              return { label: CLOUD_COST_BASIS_LABELS[basis], value: basis };
            }),
            required: true,
            description:
              "Billed counts a commitment paid up front on the day it was bought. Amortized spreads it over what it covers. Net takes credits off.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: CloudCostSetting,
          id: "cloud-cost-basis-setting-detail",
          modelId: settingId,
          fields: [
            {
              field: { costBasis: true },
              title: "Cost Basis",
              fieldType: FieldType.Element,
              getElement: (item: CloudCostSetting): ReactElement => {
                const basis: CloudCostBasis = resolveCloudCostBasis(
                  item.costBasis,
                );

                return (
                  <div data-testid="cloud-cost-basis-setting" data-basis={basis}>
                    <div className="text-sm font-medium text-gray-900">
                      {translator.translateText(CLOUD_COST_BASIS_LABELS[basis])}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      {translator.translateText(
                        CLOUD_COST_BASIS_DESCRIPTIONS[basis],
                      )}
                    </div>
                  </div>
                );
              },
            },
          ],
        }}
      />

      <CardModelDetail<CloudCostSetting>
        name="cloud-commitment-alerts-setting"
        cardProps={{
          title: COMMITMENT_ALERTS_CARD_TITLE,
          description: COMMITMENT_ALERTS_CARD_DESCRIPTION,
        }}
        isEditable={true}
        formSteps={[
          { title: "When", id: "when" },
          { title: "Who Is Told", id: "who" },
        ]}
        formFields={[
          {
            field: { isCommitmentAlertsEnabled: true },
            title: "Alert On Commitments",
            stepId: "when",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: { commitmentExpiryAlertDays: true },
            title: "Alert Before a Commitment Ends",
            stepId: "when",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "90, 30, 7",
            description:
              "Days before the end, separated by commas: an alert at each, with the renewal plan.",
            customValidation: (
              values: FormValues<CloudCostSetting>,
            ): string | null => {
              const text: unknown = values.commitmentExpiryAlertDays;

              return typeof text === "string" &&
                isCloudCommitmentExpiryDaysText(text)
                ? null
                : translator.translateText(EXPIRY_DAYS_NOT_DAYS) ||
                    EXPIRY_DAYS_NOT_DAYS;
            },
          },
          {
            field: { commitmentUtilizationThreshold: true },
            title: "Alert When Utilization Is Below",
            stepId: "when",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "80",
            description:
              "In percent: a commitment used less over the last 7 days alerts, with what its unused part cost.",
            validation: { minValue: 1, maxValue: 100 },
          },
          {
            field: { commitmentCoverageThreshold: true },
            title: "Alert When Coverage Falls Below",
            stepId: "when",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "60",
            description:
              "In percent: an account whose coverage falls under it alerts. Leave empty to not alert on coverage.",
            validation: { minValue: 1, maxValue: 100 },
          },
          {
            field: { commitmentAlertSeverity: true },
            title: "Alert Severity",
            stepId: "who",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
              sort: { order: SortOrder.Ascending },
            },
            required: false,
            placeholder: "The project's least severe",
            description:
              "How severe the alerts are. Leave empty for the project's least severe.",
          },
          {
            field: { commitmentOnCallDutyPolicies: true },
            title: "On-Call Policies",
            stepId: "who",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select On-Call Policies",
            description: "Who is paged when a commitment alerts.",
          },
          getOwnersFormField<CloudCostSetting>({
            usersKey: "commitmentAlertOwnerUsers",
            teamsKey: "commitmentAlertOwnerTeams",
            stepId: "who",
            description:
              "The people and teams who own the alerts, and are told of each.",
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: CloudCostSetting,
          id: "cloud-commitment-alerts-setting-detail",
          modelId: settingId,
          fields: [
            {
              field: { isCommitmentAlertsEnabled: true },
              title: "Alert On Commitments",
              fieldType: FieldType.Boolean,
            },
            {
              field: { commitmentExpiryAlertDays: true },
              title: "Alert Before a Commitment Ends",
              fieldType: FieldType.Text,
            },
            {
              field: { commitmentUtilizationThreshold: true },
              title: "Alert When Utilization Is Below",
              fieldType: FieldType.Element,
              getElement: (item: CloudCostSetting): ReactElement => {
                return (
                  <span>{percent(item.commitmentUtilizationThreshold)}</span>
                );
              },
            },
            {
              field: { commitmentCoverageThreshold: true },
              title: "Alert When Coverage Falls Below",
              fieldType: FieldType.Element,
              getElement: (item: CloudCostSetting): ReactElement => {
                return <span>{percent(item.commitmentCoverageThreshold)}</span>;
              },
            },
            {
              field: { commitmentAlertSeverity: { name: true } },
              title: "Alert Severity",
              fieldType: FieldType.Entity,
            },
            {
              field: { commitmentOnCallDutyPolicies: { name: true } },
              title: "On-Call Policies",
              fieldType: FieldType.EntityArray,
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default CloudCostSettingsPage;
