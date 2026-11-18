import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import Route from "Common/Types/API/Route";
import { BILLING_ENABLED } from "Common/UI/Config";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getNextClaimWords } from "../Probe/NextClaimWords";
import { OpenStackCertificateDetails } from "./OpenStackConnectionTestPanel";
import {
  OPENSTACK_STATUS_POLL_INTERVAL_IN_MS,
  OpenStackCollectionStatusView,
  OpenStackCollectionTone,
  OpenStackGentlerRow,
  OpenStackServiceRow,
  getOpenStackCollectionDescription,
  getOpenStackCollectionStatusView,
  getOpenStackGentlerRows,
  getOpenStackInventoryPhrases,
  getOpenStackNextCollection,
  getOpenStackServiceRows,
  getOpenStackSummaryModeLine,
  isOpenStackProbeCollected,
  readOpenStackNames,
} from "./OpenStackProbeCollectionView";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * How a cloud a probe collects is doing, on its Overview: is the probe collecting it, and if
 * not, exactly why and the one thing that fixes it. "Trust this certificate" is right here, for
 * a certificate the probe found and nobody trusted yet. When some services were read and another
 * was not, it says which. Nothing for a cloud the OpenStack agent sends.
 */

export interface ComponentProps {
  modelId: ObjectID;
}

function badgeTypeOf(tone: OpenStackCollectionTone): StatusBadgeType {
  switch (tone) {
    case OpenStackCollectionTone.Collecting:
      return StatusBadgeType.Success;
    case OpenStackCollectionTone.Failing:
      return StatusBadgeType.Danger;
    case OpenStackCollectionTone.Partial:
      return StatusBadgeType.Warning;
    default:
      return StatusBadgeType.Info;
  }
}

function iconOf(tone: OpenStackCollectionTone): IconProp {
  switch (tone) {
    case OpenStackCollectionTone.Collecting:
      return IconProp.CheckCircle;
    case OpenStackCollectionTone.Failing:
    case OpenStackCollectionTone.Partial:
      return IconProp.Alert;
    default:
      return IconProp.Clock;
  }
}

function iconColorOf(tone: OpenStackCollectionTone): string {
  switch (tone) {
    case OpenStackCollectionTone.Collecting:
      return "text-emerald-600";
    case OpenStackCollectionTone.Failing:
      return "text-red-600";
    case OpenStackCollectionTone.Partial:
      return "text-amber-600";
    default:
      return "text-indigo-600";
  }
}

const OpenStackCollectionStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [cloud, setCloud] = useState<OpenStackCloud | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTrusting, setIsTrusting] = useState<boolean>(false);
  const [trustError, setTrustError] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    const item: OpenStackCloud | null = await ModelAPI.getItem({
      modelType: OpenStackCloud,
      id: props.modelId,
      select: {
        collectionMethod: true,
        collectionStatus: true,
        collectionErrorCode: true,
        collectionError: true,
        presentedCertificate: true,
        collectionSummary: true,
        nextCollectionAt: true,
        lastCollectionAt: true,
        lastSuccessfulCollectionAt: true,
        collectionIntervalInMinutes: true,
        trustedCertificateFingerprints: true,
        authUrl: true,
        // What decides whether a probe may collect it (OpenStackCollectionStop).
        projectId: true,
        isCredentialSet: true,
        collectionProbeId: true,
        collectionProbe: {
          name: true,
          isGlobalProbe: true,
          projectId: true,
          connectionStatus: true,
        },
      },
    });

    setCloud(item);
  };

  useEffect(() => {
    load()
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [props.modelId.toString()]);

  const view: OpenStackCollectionStatusView | null =
    cloud && isOpenStackProbeCollected(cloud)
      ? getOpenStackCollectionStatusView(
          cloud,
          translator,
          new Date(),
          BILLING_ENABLED,
        )
      : null;

  // Ask again while the probe has the new settings and has not answered yet.
  useEffect(() => {
    if (!view?.isPending) {
      return undefined;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      load().catch(() => {
        // A failed background read keeps what the card shows.
      });
    }, OPENSTACK_STATUS_POLL_INTERVAL_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [view?.isPending]);

  if (isLoading) {
    return <DetailListSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloud || !view) {
    return <></>;
  }

  const canEdit: boolean = PermissionGate.check(
    new OpenStackCloud(),
    ModelAction.Update,
  ).isAllowed;

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS] as Route,
    { modelId: props.modelId },
  );

  const trustCertificate: (fingerprint: string) => Promise<void> = async (
    fingerprint: string,
  ): Promise<void> => {
    setIsTrusting(true);
    setTrustError("");

    try {
      /*
       * Added to the rest: a cloud can have a certificate per service, and the certificate
       * the probe found is the one thing that may be trusted without the secret again.
       */
      await ModelAPI.updateById({
        modelType: OpenStackCloud,
        id: props.modelId,
        data: {
          trustedCertificateFingerprints: [
            ...readOpenStackNames(cloud.trustedCertificateFingerprints),
            fingerprint,
          ],
        },
      });
      await load();
    } catch (err) {
      setTrustError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setIsTrusting(false);
    }
  };

  const services: Array<OpenStackServiceRow> = getOpenStackServiceRows(
    cloud.collectionSummary,
    translator,
  );
  const inventory: Array<string> = getOpenStackInventoryPhrases(
    cloud.collectionSummary,
    translator,
  );
  const warnings: Array<string> = cloud.collectionSummary?.warnings || [];
  const gentler: Array<OpenStackGentlerRow> = getOpenStackGentlerRows(
    cloud.collectionSummary,
    translator,
  );
  const summaryModeLine: string | null = getOpenStackSummaryModeLine(
    cloud.collectionSummary,
    translator,
  );

  return (
    <div className="mb-5" data-testid="openstack-data-collection-status">
      <Card
        title="Data Collection"
        description={getOpenStackCollectionDescription(
          cloud,
          translator,
          new Date(),
          BILLING_ENABLED,
        )}
        rightElement={
          <StatusBadge text={view.label} type={badgeTypeOf(view.tone)} />
        }
        buttons={[
          {
            title: "Settings",
            icon: IconProp.Settings,
            onClick: () => {
              Navigation.navigate(settingsRoute);
            },
          },
        ]}
      >
        <div
          className="space-y-3 text-sm"
          data-testid="openstack-collection-status"
          data-tone={view.tone}
        >
          <div className="flex items-start gap-2">
            <Icon
              icon={iconOf(view.tone)}
              className={`mt-0.5 h-4 w-4 flex-none ${iconColorOf(view.tone)}`}
            />
            <div className="min-w-0">
              <div className="font-medium text-gray-900">{view.title}</div>
              {view.message ? (
                <p className="mt-1 break-words text-gray-700">{view.message}</p>
              ) : (
                <></>
              )}
              {view.nextStep ? (
                <p className="mt-1 text-gray-600">{view.nextStep}</p>
              ) : (
                <></>
              )}
            </div>
          </div>

          {view.certificate ? (
            <OpenStackCertificateDetails
              certificate={view.certificate}
              onTrust={
                canEdit && !isTrusting
                  ? () => {
                      trustCertificate(view.certificate!.fingerprint256).catch(
                        (err: Error) => {
                          setTrustError(API.getFriendlyErrorMessage(err));
                        },
                      );
                    }
                  : undefined
              }
            />
          ) : (
            <></>
          )}

          {trustError ? (
            <p className="text-red-700" role="alert">
              <ErrorInSentence message={trustError} showWhereToLook={true} />
            </p>
          ) : (
            <></>
          )}

          {services.length > 0 ? (
            <div data-testid="openstack-collection-services">
              <div className="text-xs font-medium text-gray-700">
                {translator.translateText("What went without")}
              </div>
              <ul className="mt-1 divide-y divide-gray-200">
                {services.map((service: OpenStackServiceRow) => {
                  return (
                    <li
                      key={service.key}
                      className="py-2"
                      data-testid="openstack-collection-service"
                      data-outcome={service.outcome}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                          {service.label}
                        </span>
                        <span className="break-words text-sm text-gray-900">
                          {service.title}
                        </span>
                      </div>
                      {service.message ? (
                        <p className="mt-1 break-words text-xs text-gray-600">
                          {service.message}
                        </p>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <></>
          )}

          {gentler.length > 0 ? (
            <div data-testid="openstack-collection-gentler">
              <div className="text-xs font-medium text-gray-700">
                {translator.translateText(
                  "Asked more gently, because it answered slowly",
                )}
              </div>
              <ul className="mt-1 divide-y divide-gray-200">
                {gentler.map((row: OpenStackGentlerRow) => {
                  return (
                    <li key={row.key} className="py-2">
                      <div className="break-words text-sm text-gray-900">
                        {row.title}
                      </div>
                      <p className="mt-1 break-words text-xs text-gray-600">
                        {row.message}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <></>
          )}

          {summaryModeLine ? (
            <p
              className="text-xs text-gray-600"
              data-testid="openstack-collection-summary-mode"
            >
              {summaryModeLine}
            </p>
          ) : (
            <></>
          )}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Last collection")}
              </dt>
              <dd className="text-gray-900">
                {cloud.lastCollectionAt
                  ? OneUptimeDate.fromNow(cloud.lastCollectionAt)
                  : translator.translateText("Not yet")}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Last successful collection")}
              </dt>
              <dd className="text-gray-900">
                {cloud.lastSuccessfulCollectionAt
                  ? OneUptimeDate.fromNow(cloud.lastSuccessfulCollectionAt)
                  : translator.translateText("Not yet")}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Next collection")}
              </dt>
              <dd
                className="text-gray-900"
                data-testid="openstack-next-collection"
              >
                {getNextClaimWords(
                  getOpenStackNextCollection(
                    cloud,
                    new Date(),
                    BILLING_ENABLED,
                  ),
                  translator,
                )}
              </dd>
            </div>
          </dl>

          {inventory.length > 0 &&
          view.tone !== OpenStackCollectionTone.Failing ? (
            <ul
              className="flex flex-wrap gap-2"
              data-testid="openstack-collection-inventory"
            >
              {inventory.map((phrase: string) => {
                return (
                  <li
                    key={phrase}
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800 ring-1 ring-inset ring-gray-200"
                  >
                    {phrase}
                  </li>
                );
              })}
            </ul>
          ) : (
            <></>
          )}

          {warnings.length > 0 &&
          view.tone !== OpenStackCollectionTone.Checking ? (
            <div className="text-xs text-gray-600">
              <div className="font-medium text-gray-700">
                {translator.translateText("Left out of the last collection:")}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {warnings.map((warning: string) => {
                  return (
                    <li key={warning} className="break-words">
                      {warning}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>
    </div>
  );
};

export default OpenStackCollectionStatusCard;
