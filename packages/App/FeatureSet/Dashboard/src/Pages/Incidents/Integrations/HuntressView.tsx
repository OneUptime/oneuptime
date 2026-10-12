import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  HUNTRESS_PAGE_ON_CALL_FOR_LABELS,
  HUNTRESS_SEVERITY_BY_RANK_LABELS,
  HUNTRESS_SEVERITY_LABELS,
  HuntressConnectionState,
  getHuntressConnectionState,
} from "../../../Components/Huntress/HuntressConnectionDisplay";
import HuntressIncidentReportsTable from "../../../Components/Huntress/HuntressIncidentReportsTable";
import HuntressSetupCard from "../../../Components/Huntress/HuntressSetupCard";
import { getHuntressConnectionFormFields } from "./HuntressConnectionFormFields";
import HuntressConnection from "Common/Models/DatabaseModels/HuntressConnection";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Route from "Common/Types/API/Route";
import HuntressSeverity, {
  isHuntressSeverity,
} from "Common/Types/Huntress/HuntressSeverity";
import { parseHuntressOrganizationFilter } from "Common/Types/Huntress/HuntressOrganizationFilter";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

// How often a connection still waiting for Huntress is read again.
export const HUNTRESS_SETUP_POLL_INTERVAL_MS: number = 5000;

/*
 * One Huntress connection: its setup (or, once Huntress reaches it, its
 * state), its settings, and every report it received. While Huntress has
 * not reached it, the page reads the connection again every few seconds,
 * so "Send Test" in Huntress shows here without a reload.
 */
const HuntressConnectionView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [connection, setConnection] = useState<HuntressConnection | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);

  const fetchConnection: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const item: HuntressConnection | null = await ModelAPI.getItem({
          modelType: HuntressConnection,
          id: modelId,
          select: {
            _id: true,
            name: true,
            isSigningSecretSet: true,
            lastEventReceivedAt: true,
            lastEventType: true,
            lastError: true,
            lastErrorAt: true,
          },
        });

        setConnection(item);
        setError("");
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    }, [modelId.toString()]);

  useEffect(() => {
    fetchConnection().catch(() => {
      // fetchConnection reports its own errors.
    });
  }, [fetchConnection]);

  const isWaiting: boolean = Boolean(
    connection &&
      getHuntressConnectionState(connection) !==
        HuntressConnectionState.Receiving,
  );

  useEffect(() => {
    if (!isWaiting) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchConnection().catch(() => {
        // fetchConnection reports its own errors.
      });
    }, HUNTRESS_SETUP_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isWaiting, fetchConnection]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      {connection ? (
        <HuntressSetupCard
          connection={connection}
          onSigningSecretSaved={() => {
            fetchConnection().catch(() => {
              // fetchConnection reports its own errors.
            });
          }}
        />
      ) : null}

      <CardModelDetail<HuntressConnection>
        name="Huntress > Settings"
        cardProps={{
          title: "Settings",
          description:
            "Who is paged, and how a Huntress report becomes an incident.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={getHuntressConnectionFormFields()}
        refresher={refresher}
        onSaveSuccess={() => {
          setRefresher(!refresher);
          fetchConnection().catch(() => {
            // fetchConnection reports its own errors.
          });
        }}
        modelDetailProps={{
          modelType: HuntressConnection,
          id: "huntress-connection-settings",
          modelId: modelId,
          showDetailsInNumberOfColumns: 2,
          selectMoreFields: {
            pageOnCallFor: true,
            highIncidentSeverity: {
              name: true,
            },
            lowIncidentSeverity: {
              name: true,
            },
          },
          fields: [
            {
              field: {
                onCallDutyPolicies: {
                  name: true,
                },
              },
              title: "On-Call Policies",
              fieldType: FieldType.Element,
              getElement: (item: HuntressConnection): ReactElement => {
                const names: Array<string> = (item.onCallDutyPolicies || [])
                  .map((policy: OnCallDutyPolicy): string => {
                    return policy.name || "";
                  })
                  .filter((name: string): boolean => {
                    return Boolean(name);
                  });

                if (names.length === 0) {
                  return (
                    <p className="text-sm text-gray-500">
                      {translator.translateText(
                        "Nobody: incidents open without paging. Your incident on-call rules still apply.",
                      )}
                    </p>
                  );
                }

                return (
                  <div className="space-y-1">
                    <p className="text-sm text-gray-900">{names.join(", ")}</p>
                    <p className="text-sm text-gray-500">
                      {translator.translateTemplate("Paged for: {{reports}}", {
                        reports: isHuntressSeverity(item.pageOnCallFor)
                          ? translator.translateText(
                              HUNTRESS_PAGE_ON_CALL_FOR_LABELS[
                                item.pageOnCallFor
                              ],
                            ) || ""
                          : "",
                      })}
                    </p>
                  </div>
                );
              },
            },
            {
              field: {
                watchedOrganizations: true,
              },
              title: "Organizations",
              fieldType: FieldType.Element,
              getElement: (item: HuntressConnection): ReactElement => {
                const organizations: Array<string> =
                  parseHuntressOrganizationFilter(item.watchedOrganizations);

                if (organizations.length === 0) {
                  return (
                    <p className="text-sm text-gray-900">
                      {translator.translateText(
                        "Every organization in your Huntress account",
                      )}
                    </p>
                  );
                }

                return (
                  <p className="text-sm text-gray-900">
                    {organizations.join(", ")}
                  </p>
                );
              },
            },
            {
              field: {
                criticalIncidentSeverity: {
                  name: true,
                },
              },
              title: "Incident Severities",
              fieldType: FieldType.Element,
              getElement: (item: HuntressConnection): ReactElement => {
                return (
                  <dl
                    className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm"
                    data-testid="huntress-severity-mapping"
                  >
                    {[
                      {
                        severity: HuntressSeverity.Critical,
                        picked: item.criticalIncidentSeverity,
                      },
                      {
                        severity: HuntressSeverity.High,
                        picked: item.highIncidentSeverity,
                      },
                      {
                        severity: HuntressSeverity.Low,
                        picked: item.lowIncidentSeverity,
                      },
                    ].map(
                      (row: {
                        severity: HuntressSeverity;
                        picked: IncidentSeverity | undefined;
                      }): ReactElement => {
                        return (
                          <Fragment key={row.severity}>
                            <dt className="text-gray-500">
                              {translator.translateText(
                                HUNTRESS_SEVERITY_LABELS[row.severity],
                              )}
                            </dt>
                            <dd
                              className={
                                row.picked?.name
                                  ? "text-gray-900"
                                  : "text-gray-500"
                              }
                            >
                              {row.picked?.name ||
                                translator.translateText(
                                  HUNTRESS_SEVERITY_BY_RANK_LABELS[
                                    row.severity
                                  ],
                                )}
                            </dd>
                          </Fragment>
                        );
                      },
                    )}
                  </dl>
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: HuntressConnection): ReactElement => {
                const names: Array<string> = (item.labels || [])
                  .map((label: Label): string => {
                    return label.name || "";
                  })
                  .filter((name: string): boolean => {
                    return Boolean(name);
                  });

                return (
                  <p className="text-sm text-gray-900">
                    {names.length > 0
                      ? translator.translateTemplate(
                          "{{labels}}, and the report's organization",
                          { labels: names.join(", ") },
                        )
                      : translator.translateText("The report's organization")}
                  </p>
                );
              },
            },
            {
              field: {
                resolveIncidentWhenReportCloses: true,
              },
              title: "Resolve When Huntress Closes The Report",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
          ],
        }}
      />

      <HuntressIncidentReportsTable connectionId={modelId} />

      <ModelDelete
        modelType={HuntressConnection}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default HuntressConnectionView;
