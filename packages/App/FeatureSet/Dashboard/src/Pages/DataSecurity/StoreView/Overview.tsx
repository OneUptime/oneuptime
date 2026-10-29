import PageComponentProps from "../../PageComponentProps";
import DataSecurityApi from "../../../Components/DataSecurity/DataSecurityApi";
import {
  ExposurePill,
  SensitivityPill,
  SeverityPill,
} from "../../../Components/DataSecurity/DataSecurityPills";
import StoreDataTypeList from "../../../Components/DataSecurity/StoreDataTypeList";
import { getStoreProviderName } from "../../../Components/DataSecurity/StoreFieldOptions";
import { getDataSecurityIssueRoute } from "../../../Components/DataSecurity/StoreIssuesTable";
import StorePostureChecklist, {
  getPostureFactLines,
} from "../../../Components/DataSecurity/StorePostureChecklist";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import { ResourceOwnerEntry } from "../../../Components/ResourceOwners/OwnerEntry";
import OwnersCell from "../../../Components/ResourceOwners/OwnersCell";
import RankedBars, {
  RankedBarItem,
} from "../../../Components/SecurityOverview/RankedBars";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  DataStoreKindFacts,
  getDataStoreKindFacts,
  useDataStoreViewContext,
} from "./DataStoreViewContext";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreOwnerTeam from "Common/Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "Common/Models/DatabaseModels/DataStoreOwnerUser";
import Route from "Common/Types/API/Route";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DataCategory from "Common/Types/DataSecurity/DataCategory";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ONE STORE AT A GLANCE: how sensitive it is and why, how exposed it is,
 * what is inside it, how it is set up - each fact of its configuration as a
 * line that passes, fails or could not be read - what to fix on it first,
 * and who owns it.
 *
 * Scan Now samples its content again, and Check Now reads its configuration
 * again and runs its checks; each says what it started, and the page reads
 * the store again.
 */

const SEVERITY_BAR_COLORS: Readonly<Record<SecuritySeverity, string>> = {
  [SecuritySeverity.Critical]: "#ef4444",
  [SecuritySeverity.High]: "#f97316",
  [SecuritySeverity.Medium]: "#eab308",
  [SecuritySeverity.Low]: "#3b82f6",
};

// What the Overview reads of the store.
const OVERVIEW_SELECT: Select<DataStore> = {
  _id: true,
  name: true,
  kind: true,
  provider: true,
  sensitivity: true,
  sensitivityOverride: true,
  dataTypeIds: true,
  dataCategories: true,
  exposure: true,
  posture: true,
  estimatedRecords: true,
  isContentScanEnabled: true,
  configurationReadAt: true,
  contentScannedAt: true,
  findingCount: true,
  openIssueCount: true,
  highestIssueSeverity: true,
  riskScore: true,
  isPublicByDesign: true,
};

interface StoreOverviewData {
  store: DataStore | null;
  topIssues: Array<DataSecurityIssue>;
  owners: Array<ResourceOwnerEntry>;
}

type ActionKind = "scan" | "check";

interface ActionResult {
  type: AlertType;
  text: string;
}

async function readOwners(
  dataStoreId: ObjectID,
): Promise<Array<ResourceOwnerEntry>> {
  try {
    const [users, teams] = await Promise.all([
      ModelAPI.getList<DataStoreOwnerUser>({
        modelType: DataStoreOwnerUser,
        query: { dataStoreId: dataStoreId },
        select: {
          user: { _id: true, name: true, email: true, profilePictureId: true },
        },
        limit: 50,
        skip: 0,
        sort: {},
      }),
      ModelAPI.getList<DataStoreOwnerTeam>({
        modelType: DataStoreOwnerTeam,
        query: { dataStoreId: dataStoreId },
        select: { team: { _id: true, name: true } },
        limit: 50,
        skip: 0,
        sort: {},
      }),
    ]);

    return [
      ...(users as ListResult<DataStoreOwnerUser>).data
        .filter((owner: DataStoreOwnerUser): boolean => {
          return Boolean(owner.user);
        })
        .map((owner: DataStoreOwnerUser): ResourceOwnerEntry => {
          return { kind: "user", user: owner.user! };
        }),
      ...(teams as ListResult<DataStoreOwnerTeam>).data
        .filter((owner: DataStoreOwnerTeam): boolean => {
          return Boolean(owner.team);
        })
        .map((owner: DataStoreOwnerTeam): ResourceOwnerEntry => {
          return { kind: "team", team: owner.team! };
        }),
    ];
  } catch {
    // Someone who may not read owners sees none.
    return [];
  }
}

async function readTopIssues(
  dataStoreId: ObjectID,
): Promise<Array<DataSecurityIssue>> {
  try {
    const result: ListResult<DataSecurityIssue> =
      await ModelAPI.getList<DataSecurityIssue>({
        modelType: DataSecurityIssue,
        query: {
          dataStoreId: dataStoreId,
          status: DataSecurityIssueStatus.Open,
        },
        select: { _id: true, title: true, severity: true, riskScore: true },
        sort: { riskScore: SortOrder.Descending },
        limit: 5,
        skip: 0,
      });

    return result.data;
  } catch {
    return [];
  }
}

const DataStoreOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId, dataStore: layoutStore } = useDataStoreViewContext();
  const dataStoreIdString: string = dataStoreId.toString();

  const [data, setData] = useState<StoreOverviewData | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [runningAction, setRunningAction] = useState<ActionKind | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const [store, topIssues, owners] = await Promise.all([
          ModelAPI.getItem<DataStore>({
            modelType: DataStore,
            id: dataStoreId,
            select: OVERVIEW_SELECT,
          }),
          readTopIssues(dataStoreId),
          readOwners(dataStoreId),
        ]);

        if (isCurrent) {
          setError("");
          setData({ store, topIssues, owners });
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [dataStoreIdString, readCount]);

  const readAgain: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  const route: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: dataStoreId,
    });
  };

  const runAction: (kind: ActionKind) => Promise<void> = async (
    kind: ActionKind,
  ): Promise<void> => {
    setRunningAction(kind);
    setActionResult(null);

    try {
      if (kind === "scan") {
        await DataSecurityApi.scanNow(dataStoreId);
      } else {
        await DataSecurityApi.checkNow(dataStoreId);
      }

      setActionResult({
        type: AlertType.SUCCESS,
        text:
          kind === "scan"
            ? translator.translateText(
                "A scan of this store's content has started. What it finds shows on What's Inside when it is done.",
              ) || ""
            : translator.translateText(
                "This store's configuration is being read again and its checks run. Its issues update in a minute or two.",
              ) || "",
      });
      readAgain();
    } catch (err) {
      setActionResult({
        type: AlertType.DANGER,
        text: API.getFriendlyMessage(err),
      });
    }

    setRunningAction(null);
  };

  if (error && !data) {
    return <ErrorMessage message={error} onRefreshClick={readAgain} />;
  }

  if (!data) {
    return <PageLoader isVisible={true} />;
  }

  const store: DataStore | null = data.store || layoutStore;

  if (!store) {
    return (
      <ErrorMessage
        message="This data store could not be read. It may have been deleted, or you may not have permission to see it."
        onRefreshClick={readAgain}
      />
    );
  }

  const kindFacts: DataStoreKindFacts = getDataStoreKindFacts(store.kind);
  const openIssueCount: number = store.openIssueCount || 0;
  const findingCount: number = store.findingCount || 0;
  const hasConfiguration: boolean =
    Boolean(store.posture?.readAt) &&
    getPostureFactLines(store.posture).length > 0;

  // Scan Now and Check Now change the store: they need the right to edit it.
  const gate: (button: CardButtonSchema) => Array<CardButtonSchema> = (
    button: CardButtonSchema,
  ): Array<CardButtonSchema> => {
    const gated: CardButtonSchema | null = PermissionGate.gateCardButton(
      button,
      new DataStore(),
      ModelAction.Update,
    );

    return gated ? [gated] : [];
  };

  const scanDisabledReason: string | undefined = !kindFacts.isContentScannable
    ? translator.translateText(
        "OneUptime cannot sample this kind of store's content yet. Its configuration is still checked.",
      )
    : store.isContentScanEnabled === false
      ? translator.translateText(
          "Content scanning is off for this store. Turn it on in its Settings.",
        )
      : undefined;

  const scanButtons: Array<CardButtonSchema> = gate({
    title: "Scan Now",
    icon: IconProp.MagnifyingGlass,
    buttonStyle: ButtonStyleType.NORMAL,
    isLoading: runningAction === "scan",
    disabled: Boolean(scanDisabledReason) || runningAction !== null,
    ...(scanDisabledReason ? { tooltip: scanDisabledReason } : {}),
    onClick: () => {
      void runAction("scan");
    },
  });

  const checkButtons: Array<CardButtonSchema> = gate({
    title: "Check Now",
    icon: IconProp.Refresh,
    buttonStyle: ButtonStyleType.NORMAL,
    isLoading: runningAction === "check",
    disabled: runningAction !== null,
    onClick: () => {
      void runAction("check");
    },
  });

  const topIssueItems: Array<RankedBarItem> = data.topIssues.map(
    (issue: DataSecurityIssue): RankedBarItem => {
      const riskScore: number = issue.riskScore || 0;
      const severity: SecuritySeverity = issue.severity || SecuritySeverity.Low;

      return {
        key: issue._id?.toString() || issue.title || "",
        label: issue.title || "",
        count: riskScore,
        fillPercent: riskScore,
        color: SEVERITY_BAR_COLORS[severity],
        badge: <SeverityPill severity={severity} />,
        to: getDataSecurityIssueRoute(issue._id!),
      };
    },
  );

  const categories: Array<DataCategory> = store.dataCategories || [];

  return (
    <div className="space-y-5">
      {actionResult ? (
        <Alert
          type={actionResult.type}
          title={actionResult.text}
          onClose={() => {
            setActionResult(null);
          }}
        />
      ) : (
        <></>
      )}

      <EventStatBar
        columns={4}
        isLaidOutByOwnWidth={true}
        ariaLabel={translator.translateText("Data store figures")}
      >
        <EventStatTile
          variant="segment"
          icon={IconProp.Fingerprint}
          label="Sensitivity"
          value={
            <SensitivityPill
              sensitivity={store.sensitivityOverride || store.sensitivity}
            />
          }
          description={
            store.sensitivityOverride
              ? translator.translateTemplate(
                  "Set by hand. Its scans found {{level}}.",
                  {
                    level: translator.translateText(store.sensitivity) || "",
                  },
                )
              : translator.translateText(
                  "From the most sensitive data found in it",
                )
          }
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.Globe}
          label="Exposure"
          value={<ExposurePill exposure={store.exposure} />}
          description={
            store.isPublicByDesign
              ? translator.translateText("Public by design")
              : translator.translateText("Who could reach it from outside")
          }
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.ShieldExclamation}
          label="Open Issues"
          value={translator.formatNumber(openIssueCount)}
          description={
            openIssueCount > 0 && store.highestIssueSeverity
              ? translator.translateTemplate("The worst is {{severity}}", {
                  severity:
                    translator.translateText(store.highestIssueSeverity) || "",
                })
              : translator.translateText("Nothing to fix right now")
          }
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.Gauge}
          label="Risk Score"
          value={translator.formatNumber(store.riskScore || 0)}
          description={translator.translateText(
            "Its worst open issue's, from 0 to 100",
          )}
        />
      </EventStatBar>

      <CardGrid columns={2}>
        <Card
          headerLayout="stacked"
          title="What's Inside"
          description="The kinds of sensitive data its scans found, from samples of its content."
          buttons={[
            ...scanButtons,
            {
              title: "See Findings",
              icon: IconProp.Fingerprint,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(
                  route(PageMap.DATA_SECURITY_STORE_VIEW_INSIDE),
                );
              },
            },
          ]}
        >
          <div className="space-y-4">
            {categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((category: DataCategory): ReactElement => {
                  return (
                    <span
                      key={category}
                      className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700"
                    >
                      {translator.translateText(category)}
                    </span>
                  );
                })}
              </div>
            ) : (
              <></>
            )}
            {(store.dataTypeIds || []).length > 0 ? (
              <StoreDataTypeList
                dataTypeIds={store.dataTypeIds}
                maxVisible={8}
              />
            ) : (
              <p className="text-sm text-gray-500">
                {store.contentScannedAt
                  ? translator.translateText(
                      "Its scans found nothing sensitive.",
                    )
                  : kindFacts.isContentScannable
                    ? translator.translateText(
                        "Its content has not been scanned yet.",
                      )
                    : translator.translateText(
                        "OneUptime cannot sample this kind of store's content yet. Its configuration is still checked.",
                      )}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {translator.translateText("Findings")}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-gray-900">
                  {translator.formatNumber(findingCount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {translator.translateText("Estimated Sensitive Records")}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-gray-900">
                  {typeof store.estimatedRecords === "number"
                    ? translator.formatNumber(store.estimatedRecords)
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>
        </Card>

        <Card
          headerLayout="stacked"
          title="Configuration"
          description="What its configuration says about its safety. A line says Unknown when OneUptime could not read it."
          buttons={checkButtons}
        >
          {hasConfiguration ? (
            <StorePostureChecklist facts={store.posture} />
          ) : (
            <p className="text-sm text-gray-500">
              {kindFacts.isTelemetry
                ? translator.translateText(
                    "A service's telemetry has no configuration of its own to read. What is found in it is on What's Inside.",
                  )
                : translator.translateText(
                    "OneUptime has not read this store's configuration yet. It is read from a cloud connection with Data Security turned on.",
                  )}
            </p>
          )}
        </Card>
      </CardGrid>

      <CardGrid columns={2}>
        <Card
          headerLayout="stacked"
          title="Fix These First"
          description="Its open issues with the highest risk, from 0 to 100."
          buttons={[
            {
              title: "See All Issues",
              icon: IconProp.ShieldExclamation,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(
                  route(PageMap.DATA_SECURITY_STORE_VIEW_ISSUES),
                );
              },
            },
          ]}
        >
          <RankedBars
            items={topIssueItems}
            total={100}
            emptyText="No open issues on this store."
          />
        </Card>
        <Card
          headerLayout="stacked"
          title="Owners"
          description="The people and teams this store's issues go to."
          buttons={[
            {
              title: "Manage Owners",
              icon: IconProp.Team,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(
                  route(PageMap.DATA_SECURITY_STORE_VIEW_OWNERS),
                );
              },
            },
          ]}
        >
          {data.owners.length > 0 ? (
            <OwnersCell owners={data.owners} maxVisible={8} />
          ) : (
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "Nobody owns this store yet. An owner gets its issues; owner rules can name owners for every store like it.",
              )}
            </p>
          )}
        </Card>
      </CardGrid>

      <CardModelDetail<DataStore>
        name="About This Store"
        cardProps={{
          title: "About This Store",
          description:
            "Where it lives, how OneUptime found it, and when it last looked.",
        }}
        isEditable={false}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DataStore,
          id: "data-store-about",
          modelId: dataStoreId,
          fields: [
            {
              field: { kind: true },
              title: "Kind",
              fieldType: FieldType.Text,
            },
            {
              field: { provider: true },
              title: "Provider",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                const name: string = getStoreProviderName(item.provider);

                return (
                  <span className="text-sm text-gray-900">
                    {name ? translator.translateText(name) : "—"}
                  </span>
                );
              },
            },
            {
              field: { region: true },
              title: "Region",
              fieldType: FieldType.Text,
            },
            {
              field: { cloudAccountNumber: true },
              title: "Account",
              fieldType: FieldType.Text,
            },
            {
              field: { environment: true },
              title: "Environment",
              fieldType: FieldType.Text,
            },
            {
              field: { discoveredFrom: true },
              title: "Found From",
              fieldType: FieldType.Text,
            },
            {
              field: { providerResourceId: true },
              title: "ID in Its Cloud",
              fieldType: FieldType.Text,
              opts: { isCopyable: true },
            },
            {
              field: { contentScanStatus: true },
              title: "Last Content Scan",
              fieldType: FieldType.Text,
            },
            {
              field: { configurationReadAt: true },
              title: "Configuration Read",
              fieldType: FieldType.DateTime,
            },
            {
              field: { contentScannedAt: true },
              title: "Content Scanned",
              fieldType: FieldType.DateTime,
            },
            {
              field: { nextContentScanAt: true },
              title: "Next Content Scan",
              fieldType: FieldType.DateTime,
            },
            {
              field: { lastActivityAt: true },
              title: "Last Activity",
              fieldType: FieldType.DateTime,
            },
            {
              field: { firstSeenAt: true },
              title: "First Found",
              fieldType: FieldType.DateTime,
            },
            {
              field: { lastSeenAt: true },
              title: "Last Found",
              fieldType: FieldType.DateTime,
            },
          ],
        }}
      />
    </div>
  );
};

export default DataStoreOverview;
