import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  EnterpriseLicenseUsageRefreshIntervalInMilliseconds,
  EnterpriseLicenseInstanceStatusPill,
  getEnterpriseLicenseUsageBoundaryRefreshDelay,
  isEnterpriseLicenseUsageRequestCurrent,
  LicenseStatusPill,
  SeatUsageMeter,
} from "../../../Components/EnterpriseLicense/LicenseUtil";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import EnterpriseLicenseUsageSnapshot from "Common/Types/EnterpriseLicense/EnterpriseLicenseUsageSnapshot";
import EnterpriseLicenseUsageUtil from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import VersionUtil from "Common/Utils/VersionUtil";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { APP_API_URL } from "Common/UI/Config";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

const fetchEnterpriseLicenseUsageSnapshot: (
  modelId: string,
) => Promise<EnterpriseLicenseUsageSnapshot> = async (
  modelId: string,
): Promise<EnterpriseLicenseUsageSnapshot> => {
  const usageResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `/enterprise-license/${modelId}/active-usage`,
      ),
    });

  if (usageResponse instanceof HTTPErrorResponse) {
    throw usageResponse;
  }

  return usageResponse.data as unknown as EnterpriseLicenseUsageSnapshot;
};

interface TimedEnterpriseLicenseUsageSnapshot {
  snapshot: EnterpriseLicenseUsageSnapshot;
  requestStartedAt: number;
}

const EnterpriseLicenseView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();

  const [license, setLicense] = useState<EnterpriseLicense | null>(null);
  const [timedUsageSnapshot, setTimedUsageSnapshot] =
    useState<TimedEnterpriseLicenseUsageSnapshot | null>(null);
  const usageSnapshot: EnterpriseLicenseUsageSnapshot | null =
    timedUsageSnapshot?.snapshot || null;
  const [instanceTableRefreshCounter, setInstanceTableRefreshCounter] =
    useState<number>(0);
  const usageSnapshotRequestIdRef: React.MutableRefObject<number> =
    useRef<number>(0);
  const [masterAdminEmails, setMasterAdminEmails] = useState<Array<string>>([]);
  const [reminderDays, setReminderDays] = useState<number>(
    EnterpriseLicenseUsageUtil.defaultExpiryReminderDays,
  );
  const [usageError, setUsageError] = useState<string>("");
  /*
   * The latest OneUptime release as known to this (hosted) installation. Used
   * to badge customer instances that are running an older build.
   */
  const [latestReleaseVersion, setLatestReleaseVersion] = useState<string>("");

  const refreshUsageSnapshot: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestId: number = ++usageSnapshotRequestIdRef.current;
      const requestStartedAt: number = performance.now();

      try {
        const snapshot: EnterpriseLicenseUsageSnapshot =
          await fetchEnterpriseLicenseUsageSnapshot(modelIdString);

        /* A slower, older request must never replace a newer snapshot. */
        if (
          !isEnterpriseLicenseUsageRequestCurrent(
            requestId,
            usageSnapshotRequestIdRef.current,
          )
        ) {
          return;
        }

        setTimedUsageSnapshot({
          snapshot,
          requestStartedAt,
        });
        setMasterAdminEmails([...snapshot.masterAdminEmails].sort());
        setUsageError("");
      } catch (err) {
        /* A stale failure must not cover a newer successful snapshot. */
        if (
          isEnterpriseLicenseUsageRequestCurrent(
            requestId,
            usageSnapshotRequestIdRef.current,
          )
        ) {
          setUsageError(API.getFriendlyMessage(err));
        }
      }
    }, [modelIdString]);

  useEffect(() => {
    const loadUsage: () => Promise<void> = async (): Promise<void> => {
      try {
        const fetchedLicense: EnterpriseLicense | null =
          await AdminModelAPI.getItem<EnterpriseLicense>({
            modelType: EnterpriseLicense,
            id: new ObjectID(modelIdString),
            select: {
              companyName: true,
              expiresAt: true,
              userLimit: true,
            },
          });

        const globalConfig: GlobalConfig | null =
          await AdminModelAPI.getItem<GlobalConfig>({
            modelType: GlobalConfig,
            id: ObjectID.getZeroObjectID(),
            select: {
              enterpriseLicenseExpiryReminderDays: true,
              latestReleaseVersion: true,
            },
          });

        setReminderDays(
          globalConfig?.enterpriseLicenseExpiryReminderDays ||
            EnterpriseLicenseUsageUtil.defaultExpiryReminderDays,
        );

        setLatestReleaseVersion(globalConfig?.latestReleaseVersion || "");

        await refreshUsageSnapshot();
        setLicense(fetchedLicense);
      } catch (err) {
        setUsageError(API.getFriendlyMessage(err));
      }
    };

    loadUsage().catch((err: Error) => {
      setUsageError(API.getFriendlyMessage(err));
    });
  }, [modelIdString, refreshUsageSnapshot]);

  /*
   * Reports can arrive while this page stays open. Polling keeps the headline
   * and row statuses current, while the boundary timer flips the next active
   * instance at the exact seven-day mark instead of waiting for a poll.
   */
  useEffect(() => {
    const refreshInstanceTable: () => void = (): void => {
      setInstanceTableRefreshCounter((counter: number): number => {
        return counter + 1;
      });
    };
    const refreshUsageAndInstanceTable: () => void = (): void => {
      /* Start both requests together; table latency must not delay the badge. */
      refreshInstanceTable();
      refreshUsageSnapshot().catch((err: Error) => {
        setUsageError(API.getFriendlyMessage(err));
      });
    };
    const interval: ReturnType<typeof setInterval> = setInterval(
      refreshUsageAndInstanceTable,
      EnterpriseLicenseUsageRefreshIntervalInMilliseconds,
    );
    const elapsedSinceRequestStarted: number = timedUsageSnapshot
      ? performance.now() - timedUsageSnapshot.requestStartedAt
      : 0;
    const boundaryDelay: number | null = timedUsageSnapshot
      ? getEnterpriseLicenseUsageBoundaryRefreshDelay(
          timedUsageSnapshot.snapshot,
          elapsedSinceRequestStarted,
        )
      : null;
    const boundaryTimer: ReturnType<typeof setTimeout> | undefined =
      boundaryDelay !== null
        ? setTimeout(refreshUsageAndInstanceTable, boundaryDelay)
        : undefined;

    return () => {
      clearInterval(interval);

      if (boundaryTimer !== undefined) {
        clearTimeout(boundaryTimer);
      }
    };
  }, [refreshUsageSnapshot, timedUsageSnapshot]);

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="companyName"
      modelType={EnterpriseLicense}
      modelAPI={AdminModelAPI}
      title={t("pages.enterpriseLicenseView.title")}
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
        {
          title: t("breadcrumbs.enterpriseLicense"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.ENTERPRISE_LICENSE_VIEW] as Route,
            {
              modelId,
            },
          ),
        },
      ]}
    >
      <div className="space-y-6">
        <CardModelDetail<EnterpriseLicense>
          name="Enterprise License"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: t("pages.enterpriseLicenseView.cardTitle"),
            description: t("pages.enterpriseLicenseView.cardDescription"),
          }}
          isEditable={true}
          editButtonText={t("pages.enterpriseLicenseView.editButton")}
          formFields={[
            {
              field: {
                companyName: true,
              },
              title: "Company Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
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
            },
            {
              field: {
                annualContractValue: true,
              },
              title: "Annual Contract Value (USD)",
              fieldType: FormFieldSchemaType.PositiveNumber,
              required: false,
            },
          ]}
          modelDetailProps={{
            modelType: EnterpriseLicense,
            id: "model-detail-enterprise-license",
            fields: [
              {
                field: {
                  _id: true,
                },
                title: "License ID",
                fieldType: FieldType.ObjectID,
                placeholder: "-",
              },
              {
                field: {
                  companyName: true,
                },
                title: "Company Name",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  licenseKey: true,
                },
                title: "License Key",
                description:
                  "The key the customer enters in their self-hosted installation.",
                fieldType: FieldType.HiddenText,
                opts: {
                  isCopyable: true,
                },
                placeholder: "-",
              },
              {
                field: {
                  expiresAt: true,
                },
                title: "Expires At",
                fieldType: FieldType.Date,
                placeholder: "-",
              },
              {
                field: {
                  isEvaluationLicense: true,
                },
                title: "Evaluation License",
                description:
                  "When on, the customer's installation shows an evaluation notice and the key is not meant for production use.",
                fieldType: FieldType.Boolean,
              },
              {
                field: {
                  userLimit: true,
                },
                title: "User Limit",
                fieldType: FieldType.Number,
                placeholder: "No limit",
              },
              {
                field: {
                  annualContractValue: true,
                },
                title: "Annual Contract Value (USD)",
                fieldType: FieldType.Number,
                placeholder: "-",
              },
              {
                field: {
                  createdAt: true,
                },
                title: "Issued On",
                fieldType: FieldType.Date,
                placeholder: "-",
              },
            ],
            modelId: modelId,
          }}
        />

        <Card
          title={t("pages.enterpriseLicenseView.usageCardTitle")}
          description={t("pages.enterpriseLicenseView.usageCardDescription")}
        >
          {usageError ? (
            <ErrorMessage message={usageError} />
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <div className="text-sm text-gray-500">Seats in use</div>
                <div className="mt-1 text-4xl font-semibold text-gray-900">
                  {license
                    ? (usageSnapshot?.currentUserCount || 0).toLocaleString()
                    : "—"}
                  {license?.userLimit ? (
                    <span className="ml-2 text-lg font-normal text-gray-500">
                      of {license.userLimit.toLocaleString()} licensed
                    </span>
                  ) : (
                    <span className="ml-2 text-lg font-normal text-gray-500">
                      · no seat limit
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <SeatUsageMeter
                    currentUserCount={
                      usageSnapshot?.currentUserCount ?? undefined
                    }
                    userLimit={license?.userLimit}
                  />
                </div>
                <div className="mt-3 text-sm text-gray-500">
                  {usageSnapshot?.lastUsageReportedAt
                    ? `Last reported ${OneUptimeDate.getDateAsUserFriendlyFormattedString(
                        new Date(usageSnapshot.lastUsageReportedAt),
                      )}`
                    : "This license has not reported usage yet."}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  Only instances active within the past{" "}
                  {EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays} days
                  are included.
                </div>
                <div className="mt-2">
                  <LicenseStatusPill
                    expiresAt={license?.expiresAt}
                    reminderDays={reminderDays}
                  />
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500">
                  Master admin contacts
                </div>
                <div className="mt-2">
                  {masterAdminEmails.length === 0 ? (
                    <div className="flex items-start gap-2 text-sm text-gray-500">
                      <Icon
                        icon={IconProp.Info}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                      />
                      <span>
                        No master admin emails synced yet. The customer&apos;s
                        instances report their master admins once a day — until
                        then, license notifications only go to the OneUptime
                        enterprise license email.
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {masterAdminEmails.map(
                        (email: string, index: number): ReactElement => {
                          return (
                            <a
                              key={index}
                              href={`mailto:${email}`}
                              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200"
                            >
                              <Icon
                                icon={IconProp.Email}
                                className="h-3.5 w-3.5 text-gray-500"
                              />
                              {email}
                            </a>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-3 text-sm text-gray-500">
                  These contacts get daily emails while the license is over its
                  user limit or within {reminderDays} days of expiry.
                </div>
              </div>
            </div>
          )}
        </Card>

        <ModelTable<EnterpriseLicenseInstance>
          modelType={EnterpriseLicenseInstance}
          modelAPI={AdminModelAPI}
          userPreferencesKey="admin-enterprise-license-instances-table"
          id="enterprise-license-instances-table"
          name="Enterprise License Instances"
          isDeleteable={true}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          showRefreshButton={true}
          refreshToggle={instanceTableRefreshCounter.toString()}
          onFetchSuccess={async () => {
            /* Keep the rows, status snapshot and headline count together. */
            await refreshUsageSnapshot();
          }}
          query={{
            enterpriseLicenseId: modelId,
          }}
          cardProps={{
            title: t("pages.enterpriseLicenseView.instancesCardTitle"),
            description: t(
              "pages.enterpriseLicenseView.instancesCardDescription",
            ),
          }}
          noItemsMessage={t("pages.enterpriseLicenseView.noInstances")}
          filters={[
            {
              field: {
                host: true,
              },
              title: "Host",
              type: FieldType.Text,
            },
            {
              field: {
                oneuptimeVersion: true,
              },
              title: "Version",
              type: FieldType.Text,
            },
            {
              field: {
                lastReportedAt: true,
              },
              title: "Last Reported At",
              type: FieldType.DateTime,
            },
          ]}
          columns={[
            {
              field: {
                host: true,
              },
              title: "Host",
              type: FieldType.Text,
              noValueMessage: "Unknown",
            },
            {
              field: {
                instanceId: true,
              },
              title: "Instance ID",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: EnterpriseLicenseInstance): ReactElement => {
                return (
                  <span className="font-mono text-xs text-gray-600">
                    {item.instanceId || "-"}
                  </span>
                );
              },
            },
            {
              field: {
                _id: true,
                createdAt: true,
                lastReportedAt: true,
              },
              title: "Status",
              type: FieldType.Element,
              getElement: (item: EnterpriseLicenseInstance): ReactElement => {
                return (
                  <EnterpriseLicenseInstanceStatusPill
                    instance={item}
                    isActive={
                      usageSnapshot
                        ? Boolean(
                            item.id &&
                              usageSnapshot.activeInstanceIds.includes(
                                item.id.toString(),
                              ),
                          )
                        : undefined
                    }
                  />
                );
              },
            },
            {
              field: {
                oneuptimeVersion: true,
              },
              title: "Version",
              type: FieldType.Element,
              getElement: (item: EnterpriseLicenseInstance): ReactElement => {
                if (!item.oneuptimeVersion) {
                  return (
                    <span className="text-sm text-gray-400">Not reported</span>
                  );
                }

                /*
                 * Without a known latest release there is nothing to compare
                 * against, and a bare version would read as "current" — which
                 * is exactly the wrong thing for support to conclude. Say so
                 * instead of staying silent.
                 */
                const isLatestReleaseKnown: boolean =
                  VersionUtil.isValid(latestReleaseVersion);

                const isOutdated: boolean = VersionUtil.isUpdateAvailable({
                  currentVersion: item.oneuptimeVersion,
                  latestVersion: latestReleaseVersion,
                });

                return (
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-gray-700">
                      v{item.oneuptimeVersion}
                    </span>
                    {!isLatestReleaseKnown ? (
                      <span
                        className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500"
                        title="This installation does not know the latest OneUptime release, so it cannot tell whether this instance is behind."
                      >
                        Not compared
                      </span>
                    ) : isOutdated ? (
                      <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                        Outdated
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              field: {
                userCount: true,
              },
              title: "Users",
              type: FieldType.Number,
              noValueMessage: "-",
            },
            {
              field: {
                masterAdminEmails: true,
              },
              title: "Master Admins",
              type: FieldType.Element,
              getElement: (item: EnterpriseLicenseInstance): ReactElement => {
                const emails: Array<string> = item.masterAdminEmails || [];

                if (emails.length === 0) {
                  return <span className="text-gray-400">Not synced yet</span>;
                }

                return (
                  <div className="space-y-0.5">
                    {emails.map(
                      (email: string, index: number): ReactElement => {
                        return (
                          <div key={index} className="text-sm text-gray-700">
                            {email}
                          </div>
                        );
                      },
                    )}
                  </div>
                );
              },
            },
            {
              field: {
                _id: true,
                createdAt: true,
                lastReportedAt: true,
              },
              title: "Last Activity",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: EnterpriseLicenseInstance): ReactElement => {
                const lastCommunicatedAt: Date | undefined =
                  EnterpriseLicenseUsageUtil.getInstanceLastCommunicatedAt(
                    item,
                  );

                if (!lastCommunicatedAt) {
                  return (
                    <span className="text-gray-400">Never communicated</span>
                  );
                }

                const isInactive: boolean = usageSnapshot
                  ? !(
                      item.id &&
                      usageSnapshot.activeInstanceIds.includes(
                        item.id.toString(),
                      )
                    )
                  : !EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
                      item,
                      OneUptimeDate.getCurrentDate(),
                    );

                return (
                  <div>
                    <div className="text-sm text-gray-700">
                      {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                        lastCommunicatedAt,
                      )}
                    </div>
                    {isInactive ? (
                      <div className="text-xs text-gray-400">
                        Inactive — not counted towards seats
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
          ]}
        />

        <ModelDelete
          modelType={EnterpriseLicense}
          modelId={modelId}
          modelAPI={AdminModelAPI}
          onDeleteSuccess={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.ENTERPRISE_LICENSES] as Route,
              ),
            );
          }}
        />
      </div>
    </ModelPage>
  );
};

export default EnterpriseLicenseView;
