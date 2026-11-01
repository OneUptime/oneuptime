import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudAppRevision from "Common/Models/DatabaseModels/CloudAppRevision";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import { Gray500, Green, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  CLOUD_APP_REVISION_STATE_LABELS,
  CloudAppRevisionState,
  CloudAppSignalRow,
  CloudAppSignals,
  RESOURCE_ATTRIBUTE_PREFIX,
  CloudAppRevisionMarkerSource,
  countLiveInstancesByRevision,
  getCloudAppAttributes,
  getCloudAppRevisionNoun,
  getCloudAppRevisionState,
  getShortRevision,
  isCloudAppRolledBack,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import {
  buildCloudAppSignalRequest,
  fetchCloudAppSignalRows,
} from "../../Pages/AppPlatforms/Utils/CloudAppReads";
import { isCloudResourceScoped } from "../../Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import {
  APP_INSTANCE_COUNT,
  APP_ROLLED_BACK,
  CloudAppSignalCell,
  CloudAppSignalKind,
} from "./CloudAppCells";

/*
 * An App Platforms app's Revisions tab: its deploy history, newest first.
 * Each revision says when it was deployed and what ran before it, whether
 * it runs now (Current), still runs on some instances (Running - a rollout
 * draining, a traffic split) or no longer runs (Retired), and its requests,
 * error rate and p95 in the range picked above - so a bad release shows
 * beside the one before it, as Cloud Run's and Container Apps' own
 * revision lists show it.
 */

export const REVISIONS_TITLE: string = translationKey("Revisions");
export const REVISIONS_DESCRIPTION: string = translationKey(
  "Every revision this app ran, newest first: when each was deployed, whether it still runs, and its requests, errors and latency in the selected range.",
);
export const NO_REVISIONS_MESSAGE: string = translationKey(
  "No revision reported yet. A revision appears when the app's telemetry names one, such as aws.ecs.task.revision, faas.version or service.version.",
);
export const REVISION_REPLACED: string = translationKey(
  "Replaced {{revision}}",
);
export const REVISION_FIRST_SEEN: string = translationKey(
  "First revision seen",
);

// A revision's state, in the colours its pill and its Running now bar share.
export const CLOUD_APP_REVISION_STATE_COLORS: Readonly<
  Record<CloudAppRevisionState, Color>
> = {
  [CloudAppRevisionState.Current]: Green,
  [CloudAppRevisionState.Running]: Yellow,
  [CloudAppRevisionState.Retired]: Gray500,
};

export interface ComponentProps {
  app: CloudApp;
  environment: CloudResource;
  instances: Array<CloudResourceInstance>;
  /*
   * Every revision the page read, when it read them: they say whether the
   * revision the app runs is one it went back to, which its row then says.
   */
  revisions?: ReadonlyArray<CloudAppRevisionMarkerSource> | undefined;
  start: Date;
  end: Date;
  refreshToken: number;
}

const CloudAppRevisionsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [signals, setSignals] = useState<Map<string, CloudAppSignals>>(
    new Map<string, CloudAppSignals>(),
  );
  const [signalsState, setSignalsState] = useState<
    "loading" | "loaded" | "failed" | "none"
  >("loading");

  const revisionAttribute: string = (props.app.revisionAttribute || "").trim();
  const ownAttributes: Record<string, string> = getCloudAppAttributes(
    props.app,
  );
  const scopeKey: string = JSON.stringify([
    revisionAttribute,
    ownAttributes,
    props.environment.cloudPlatform,
    props.environment.cloudAccountId,
    props.environment.cloudRegion,
  ]);

  useEffect(() => {
    if (
      !revisionAttribute ||
      Object.keys(ownAttributes).length === 0 ||
      !isCloudResourceScoped(props.environment)
    ) {
      setSignalsState("none");
      return;
    }

    let ignore: boolean = false;
    setSignalsState("loading");

    const groupKey: string = `${RESOURCE_ATTRIBUTE_PREFIX}${revisionAttribute}`;
    const appFilters: Record<string, string> = {};

    for (const key of Object.keys(ownAttributes)) {
      appFilters[`${RESOURCE_ATTRIBUTE_PREFIX}${key}`] = ownAttributes[
        key
      ] as string;
    }

    fetchCloudAppSignalRows(
      buildCloudAppSignalRequest({
        read: { groupBy: [groupKey] },
        environment: props.environment,
        start: props.start,
        end: props.end,
        attributes: appFilters,
      }),
    )
      .then((rows: Array<CloudAppSignalRow> | null): void => {
        if (ignore) {
          return;
        }

        if (rows === null) {
          setSignalsState("failed");
          return;
        }

        const byRevision: Map<string, CloudAppSignals> = new Map<
          string,
          CloudAppSignals
        >();

        for (const row of rows) {
          const revision: string = String(
            (row.groupValues || {})[groupKey] ?? "",
          );
          const requests: number = Number(row.count) || 0;
          const errors: number = Number(row.errorCount) || 0;

          byRevision.set(revision, {
            requests,
            errors,
            errorRatePercent: requests > 0 ? (errors / requests) * 100 : null,
            p95Ms: requests > 0 ? Number(row.p95DurationMs) || 0 : null,
          });
        }

        setSignals(byRevision);
        setSignalsState("loaded");
      })
      .catch((): void => {
        if (!ignore) {
          setSignalsState("failed");
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [
    scopeKey,
    props.start.getTime(),
    props.end.getTime(),
    props.refreshToken,
  ]);

  const liveByRevision: Map<string, number> = countLiveInstancesByRevision(
    props.instances,
  );

  const signalsOf: (
    revision: CloudAppRevision,
  ) => CloudAppSignals | null | undefined = (
    revision: CloudAppRevision,
  ): CloudAppSignals | null | undefined => {
    if (signalsState === "failed") {
      return null;
    }

    if (signalsState !== "loaded") {
      return undefined;
    }

    return (
      signals.get(revision.revision || "") || {
        requests: 0,
        errors: 0,
        errorRatePercent: null,
        p95Ms: null,
      }
    );
  };

  const revisionNoun: string = getCloudAppRevisionNoun(props.app.cloudPlatform);

  /*
   * A rollback is a moment in the history, not a revision of its own: the
   * row of the revision the app went back to says when it did, under its
   * Current pill, as the header says it.
   */
  const rolledBackAt: Date | null =
    props.app.currentRevisionSince &&
    isCloudAppRolledBack({
      revisions: props.revisions || [],
      currentRevision: props.app.currentRevision,
      currentRevisionSince: props.app.currentRevisionSince,
      previousRevision: props.app.previousRevision,
    })
      ? OneUptimeDate.fromString(props.app.currentRevisionSince)
      : null;

  return (
    <ModelTable<CloudAppRevision>
      modelType={CloudAppRevision}
      id="cloud-app-revisions-table"
      userPreferencesKey="cloud-app-revisions-table"
      name="Revisions"
      singularName="Revision"
      pluralName="Revisions"
      query={{ cloudAppId: new ObjectID(props.app._id!.toString()) }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      refreshToggle={String(props.refreshToken)}
      sortBy="firstSeenAt"
      sortOrder={SortOrder.Descending}
      noItemsMessage={NO_REVISIONS_MESSAGE}
      selectMoreFields={{ previousRevision: true, lastSeenAt: true }}
      cardProps={{
        title: REVISIONS_TITLE,
        description: REVISIONS_DESCRIPTION,
      }}
      filters={[
        {
          field: { revision: true },
          title: "Revision",
          type: FieldType.Text,
        },
        {
          field: { firstSeenAt: true },
          title: "Deployed",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: { revision: true },
          title: "Revision",
          headerTooltip: revisionNoun,
          type: FieldType.Element,
          isNotCustomizable: true,
          getElement: (row: CloudAppRevision): ReactElement => {
            return (
              <div className="min-w-0" data-testid="cloud-app-revision-row">
                <div
                  className="truncate font-mono text-sm text-gray-900"
                  title={row.revision || undefined}
                >
                  <bdi>
                    {getShortRevision({
                      revision: row.revision,
                      appName: props.app.name,
                    }) || "—"}
                  </bdi>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {row.previousRevision
                    ? translator.translateTemplate(REVISION_REPLACED, {
                        revision: getShortRevision({
                          revision: row.previousRevision,
                          appName: props.app.name,
                        }),
                      })
                    : translator.translateText(REVISION_FIRST_SEEN)}
                </div>
              </div>
            );
          },
        },
        {
          field: { lastSeenAt: true },
          id: "state",
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          getElement: (row: CloudAppRevision): ReactElement => {
            const live: number = liveByRevision.get(row.revision || "") || 0;
            const state: CloudAppRevisionState = getCloudAppRevisionState({
              revision: row.revision,
              currentRevision: props.app.currentRevision,
              liveInstances: live,
            });

            return (
              <div className="min-w-0" data-revision-state={state}>
                <Pill
                  text={CLOUD_APP_REVISION_STATE_LABELS[state]}
                  color={CLOUD_APP_REVISION_STATE_COLORS[state]}
                />
                {state === CloudAppRevisionState.Current && rolledBackAt ? (
                  <div
                    className="mt-1 text-xs font-medium text-amber-700"
                    data-testid="cloud-app-revision-rolled-back"
                  >
                    {translator.translateTemplate(APP_ROLLED_BACK, {
                      time: OneUptimeDate.fromNow(rolledBackAt),
                    })}
                  </div>
                ) : (
                  <></>
                )}
                {live > 0 ? (
                  <div className="mt-1 text-xs text-gray-500">
                    {translator.translatePlural(APP_INSTANCE_COUNT, live)}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { firstSeenAt: true },
          title: "Deployed",
          type: FieldType.Element,
          getElement: (row: CloudAppRevision): ReactElement => {
            if (!row.firstSeenAt) {
              return <span className="text-sm text-gray-400">—</span>;
            }

            const deployedAt: Date = OneUptimeDate.fromString(
              row.firstSeenAt,
            );

            /*
             * "25 minutes ago", with the date and time it was under the
             * pointer: a deploy history is read against other times.
             */
            return (
              <span
                className="text-sm text-gray-700"
                title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  deployedAt,
                )}
              >
                {OneUptimeDate.fromNow(deployedAt)}
              </span>
            );
          },
        },
        {
          field: { _id: true },
          id: "requests",
          title: "Requests",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (row: CloudAppRevision): ReactElement => {
            return (
              <CloudAppSignalCell
                kind={CloudAppSignalKind.Requests}
                signals={signalsOf(row)}
                isLoading={signalsState === "loading"}
              />
            );
          },
        },
        {
          field: { _id: true },
          id: "error-rate",
          title: "Error rate",
          type: FieldType.Element,
          disableSort: true,
          getElement: (row: CloudAppRevision): ReactElement => {
            return (
              <CloudAppSignalCell
                kind={CloudAppSignalKind.ErrorRate}
                signals={signalsOf(row)}
                isLoading={signalsState === "loading"}
              />
            );
          },
        },
        {
          field: { _id: true },
          id: "p95",
          title: "p95 latency",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (row: CloudAppRevision): ReactElement => {
            return (
              <CloudAppSignalCell
                kind={CloudAppSignalKind.P95}
                signals={signalsOf(row)}
                isLoading={signalsState === "loading"}
              />
            );
          },
        },
      ]}
    />
  );
};

export default CloudAppRevisionsTab;
