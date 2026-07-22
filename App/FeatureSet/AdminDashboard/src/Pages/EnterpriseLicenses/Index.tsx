import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  LicenseStatusPill,
  SeatUsageMeter,
  getLicenseLifecycle,
  isOverUserLimit,
} from "../../Components/EnterpriseLicense/LicenseUtil";
import Route from "Common/Types/API/Route";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import UUID from "Common/Utils/UUID";
import EnterpriseLicenseUsageUtil from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

interface LicenseStats {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  overLimit: number;
}

interface StatTileProps {
  label: string;
  value: number | null;
  icon: IconProp;
  iconClassName: string;
}

const StatTile: FunctionComponent<StatTileProps> = (
  props: StatTileProps,
): ReactElement => {
  return (
    <div className="flex items-center gap-4 rounded-lg bg-white p-5 shadow ring-1 ring-black ring-opacity-5">
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${props.iconClassName}`}
      >
        <Icon icon={props.icon} className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm text-gray-500">{props.label}</div>
        <div className="text-2xl font-semibold text-gray-900">
          {props.value === null ? "—" : props.value.toLocaleString()}
        </div>
      </div>
    </div>
  );
};

const EnterpriseLicenses: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const [stats, setStats] = useState<LicenseStats | null>(null);
  const [reminderDays, setReminderDays] = useState<number>(
    EnterpriseLicenseUsageUtil.defaultExpiryReminderDays,
  );
  const [statsError, setStatsError] = useState<string>("");
  const [tableRefreshToggle, setTableRefreshToggle] = useState<boolean>(false);

  useEffect(() => {
    if (!BILLING_ENABLED) {
      return;
    }

    const loadStats: () => Promise<void> = async (): Promise<void> => {
      try {
        const globalConfig: GlobalConfig | null =
          await AdminModelAPI.getItem<GlobalConfig>({
            modelType: GlobalConfig,
            id: ObjectID.getZeroObjectID(),
            select: {
              enterpriseLicenseExpiryReminderDays: true,
            },
          });

        const configuredReminderDays: number =
          globalConfig?.enterpriseLicenseExpiryReminderDays ||
          EnterpriseLicenseUsageUtil.defaultExpiryReminderDays;

        setReminderDays(configuredReminderDays);

        const licenses: ListResult<EnterpriseLicense> =
          await AdminModelAPI.getList<EnterpriseLicense>({
            modelType: EnterpriseLicense,
            query: {},
            limit: LIMIT_MAX,
            skip: 0,
            select: {
              expiresAt: true,
              userLimit: true,
              currentUserCount: true,
            },
            sort: {},
          });

        const nextStats: LicenseStats = {
          total: licenses.count,
          active: 0,
          expiringSoon: 0,
          expired: 0,
          overLimit: 0,
        };

        for (const license of licenses.data) {
          const lifecycle: ReturnType<typeof getLicenseLifecycle> =
            getLicenseLifecycle(license.expiresAt, configuredReminderDays);

          if (lifecycle?.state === "expired") {
            nextStats.expired += 1;
          } else if (lifecycle?.state === "expiring-soon") {
            nextStats.expiringSoon += 1;
          } else {
            nextStats.active += 1;
          }

          if (isOverUserLimit(license.userLimit, license.currentUserCount)) {
            nextStats.overLimit += 1;
          }
        }

        setStats(nextStats);
        setStatsError("");
      } catch (err) {
        setStatsError(API.getFriendlyMessage(err));
      }
    };

    loadStats().catch((err: Error) => {
      setStatsError(API.getFriendlyMessage(err));
    });
  }, [tableRefreshToggle]);

  if (!BILLING_ENABLED) {
    return (
      <Page
        title={t("pages.enterpriseLicenses.title")}
        breadcrumbLinks={[
          {
            title: t("breadcrumbs.adminDashboard"),
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
          },
          {
            title: t("breadcrumbs.enterpriseLicenses"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ENTERPRISE_LICENSES] as Route,
            ),
          },
        ]}
      >
        <EmptyState
          id="enterprise-licenses-not-available"
          icon={IconProp.Lock}
          title="Only available on OneUptime Cloud"
          description="Enterprise licenses are issued and tracked on the hosted oneuptime.com, where billing is enabled. This self-hosted instance does not manage licenses."
        />
      </Page>
    );
  }

  return (
    <Page
      title={t("pages.enterpriseLicenses.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.enterpriseLicenses"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ENTERPRISE_LICENSES] as Route,
          ),
        },
      ]}
    >
      <div>
        {statsError ? (
          <div className="mb-6">
            <ErrorMessage message={statsError} />
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile
              label="Total licenses"
              value={stats ? stats.total : null}
              icon={IconProp.Lock}
              iconClassName="bg-slate-100 text-slate-600"
            />
            <StatTile
              label="Active"
              value={stats ? stats.active : null}
              icon={IconProp.CheckCircle}
              iconClassName="bg-green-50 text-green-600"
            />
            <StatTile
              label="Expiring soon"
              value={stats ? stats.expiringSoon : null}
              icon={IconProp.Clock}
              iconClassName="bg-amber-50 text-amber-600"
            />
            <StatTile
              label="Expired"
              value={stats ? stats.expired : null}
              icon={IconProp.Error}
              iconClassName="bg-red-50 text-red-600"
            />
            <StatTile
              label="Over user limit"
              value={stats ? stats.overLimit : null}
              icon={IconProp.Alert}
              iconClassName="bg-red-50 text-red-600"
            />
          </div>
        )}

        <ModelTable<EnterpriseLicense>
          modelType={EnterpriseLicense}
          modelAPI={AdminModelAPI}
          userPreferencesKey="admin-enterprise-licenses-table"
          id="enterprise-licenses-table"
          name="Enterprise Licenses"
          isDeleteable={false}
          isEditable={false}
          isCreateable={true}
          isViewable={true}
          showViewIdButton={true}
          showRefreshButton={true}
          onFetchSuccess={() => {
            // Keep the stat tiles in sync with table refreshes.
            setTableRefreshToggle((value: boolean) => {
              return !value;
            });
          }}
          cardProps={{
            title: t("pages.enterpriseLicenses.cardTitle"),
            description: t("pages.enterpriseLicenses.cardDescription"),
          }}
          noItemsMessage={t("pages.enterpriseLicenses.noItems")}
          searchableFields={["companyName"]}
          viewPageRoute={Navigation.getCurrentRoute()}
          onBeforeCreate={(
            item: EnterpriseLicense,
          ): Promise<EnterpriseLicense> => {
            if (!item.licenseKey) {
              item.licenseKey = UUID.generate();
            }

            return Promise.resolve(item);
          }}
          formFields={[
            {
              field: {
                companyName: true,
              },
              title: "Company Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Acme, Inc.",
            },
            {
              field: {
                licenseKey: true,
              },
              title: "License Key",
              description: "Leave blank to auto-generate a key.",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: "Auto-generated if left blank",
              disableSpellCheck: true,
            },
            {
              field: {
                expiresAt: true,
              },
              title: "Expires At",
              fieldType: FormFieldSchemaType.Date,
              required: true,
            },
            {
              field: {
                isEvaluationLicense: true,
              },
              title: "Evaluation License",
              description:
                "Turn on for an evaluation/testing key. The customer's installation shows an evaluation notice and it is not meant for production use.",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
            {
              field: {
                userLimit: true,
              },
              title: "User Limit",
              description:
                "Maximum number of users allowed under this license. Leave blank for no limit.",
              fieldType: FormFieldSchemaType.PositiveNumber,
              required: false,
              placeholder: "No limit",
            },
            {
              field: {
                annualContractValue: true,
              },
              title: "Annual Contract Value (USD)",
              fieldType: FormFieldSchemaType.PositiveNumber,
              required: false,
              placeholder: "0",
            },
          ]}
          selectMoreFields={{
            userLimit: true,
            currentUserCount: true,
          }}
          filters={[
            {
              field: {
                companyName: true,
              },
              title: "Company Name",
              type: FieldType.Text,
            },
            {
              field: {
                expiresAt: true,
              },
              title: "Expires At",
              type: FieldType.Date,
            },
            {
              field: {
                userLimit: true,
              },
              title: "User Limit",
              type: FieldType.Number,
            },
            {
              field: {
                currentUserCount: true,
              },
              title: "Current Users",
              type: FieldType.Number,
            },
          ]}
          columns={[
            {
              field: {
                companyName: true,
              },
              title: "Company",
              type: FieldType.Text,
            },
            {
              field: {
                licenseKey: true,
              },
              title: "License Key",
              type: FieldType.Element,
              getElement: (item: EnterpriseLicense): ReactElement => {
                return (
                  <span className="font-mono text-xs text-gray-600">
                    {EnterpriseLicenseUsageUtil.maskLicenseKey(
                      item.licenseKey || "",
                    )}
                  </span>
                );
              },
            },
            {
              field: {
                isEvaluationLicense: true,
              },
              title: "Type",
              type: FieldType.Element,
              getElement: (item: EnterpriseLicense): ReactElement => {
                if (item.isEvaluationLicense) {
                  return (
                    <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                      Evaluation
                    </span>
                  );
                }

                return (
                  <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
                    Production
                  </span>
                );
              },
            },
            {
              field: {
                expiresAt: true,
              },
              title: "Status",
              type: FieldType.Element,
              getElement: (item: EnterpriseLicense): ReactElement => {
                return (
                  <LicenseStatusPill
                    expiresAt={item.expiresAt}
                    reminderDays={reminderDays}
                  />
                );
              },
            },
            {
              field: {
                currentUserCount: true,
              },
              title: "Seats",
              type: FieldType.Element,
              getElement: (item: EnterpriseLicense): ReactElement => {
                return (
                  <SeatUsageMeter
                    currentUserCount={item.currentUserCount}
                    userLimit={item.userLimit}
                  />
                );
              },
            },
            {
              field: {
                expiresAt: true,
              },
              title: "Expires At",
              type: FieldType.Date,
              hideOnMobile: true,
            },
            {
              field: {
                userCountUpdatedAt: true,
              },
              title: "Last Report",
              type: FieldType.DateTime,
              hideOnMobile: true,
              noValueMessage: "Never",
            },
          ]}
        />

        <div className="mt-6">
          <CardModelDetail<GlobalConfig>
            name="License Notification Settings"
            modelAPI={AdminModelAPI}
            cardProps={{
              title: t("pages.enterpriseLicenses.settingsCardTitle"),
              description: t(
                "pages.enterpriseLicenses.settingsCardDescription",
              ),
            }}
            isEditable={true}
            editButtonText={t("pages.enterpriseLicenses.settingsEditButton")}
            formFields={[
              {
                field: {
                  enterpriseLicenseNotificationEmail: true,
                },
                title: "OneUptime Enterprise License Email",
                description:
                  "OneUptime email address that gets a copy of every license notification sent to customers.",
                fieldType: FormFieldSchemaType.Email,
                required: false,
                placeholder: "enterprise@oneuptime.com",
              },
              {
                field: {
                  enterpriseLicenseExpiryReminderDays: true,
                },
                title: "Expiry Reminder (Days)",
                description:
                  "How many days before a license expires that daily reminder emails start going out.",
                fieldType: FormFieldSchemaType.PositiveNumber,
                required: false,
                placeholder: `${EnterpriseLicenseUsageUtil.defaultExpiryReminderDays}`,
              },
            ]}
            modelDetailProps={{
              modelType: GlobalConfig,
              id: "model-detail-license-notification-settings",
              fields: [
                {
                  field: {
                    enterpriseLicenseNotificationEmail: true,
                  },
                  title: "OneUptime Enterprise License Email",
                  fieldType: FieldType.Email,
                  placeholder: "Not configured — customers are still emailed",
                },
                {
                  field: {
                    enterpriseLicenseExpiryReminderDays: true,
                  },
                  title: "Expiry Reminder (Days)",
                  fieldType: FieldType.Number,
                  placeholder: `${EnterpriseLicenseUsageUtil.defaultExpiryReminderDays} (default)`,
                },
              ],
              modelId: ObjectID.getZeroObjectID(),
            }}
          />
        </div>
      </div>
    </Page>
  );
};

export default EnterpriseLicenses;
