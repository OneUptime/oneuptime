import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
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
import { CertificateDetails } from "./VMwareConnectionTestPanel";
import {
  VMWARE_STATUS_POLL_INTERVAL_IN_MS,
  VMwareCollectionStatusView,
  VMwareCollectionTone,
  getVMwareCollectionStatusView,
  getVMwareProductLine,
  isProbeCollected,
} from "./VMwareProbeCollectionView";

/*
 * How a vCenter a probe collects is doing, at the top of its overview: is
 * the probe collecting it, and if not, exactly why and the one thing that
 * fixes it - "Trust this certificate" right here, for a certificate the
 * probe found and nobody trusted yet. Nothing for a vCenter the VMware agent
 * sends.
 */

export interface ComponentProps {
  modelId: ObjectID;
}

function badgeTypeOf(tone: VMwareCollectionTone): StatusBadgeType {
  switch (tone) {
    case VMwareCollectionTone.Collecting:
      return StatusBadgeType.Success;
    case VMwareCollectionTone.Failing:
      return StatusBadgeType.Danger;
    default:
      return StatusBadgeType.Info;
  }
}

const VMwareCollectionStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTrusting, setIsTrusting] = useState<boolean>(false);
  const [trustError, setTrustError] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    const item: VMwareVCenter | null = await ModelAPI.getItem({
      modelType: VMwareVCenter,
      id: props.modelId,
      select: {
        collectionMethod: true,
        collectionStatus: true,
        collectionErrorCode: true,
        collectionError: true,
        presentedCertificate: true,
        collectionSummary: true,
        lastCollectionAt: true,
        lastSuccessfulCollectionAt: true,
        collectionIntervalInMinutes: true,
        vcenterUrl: true,
        collectionProbe: {
          name: true,
        },
      },
    });

    setVCenter(item);
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

  const view: VMwareCollectionStatusView | null =
    vcenter && isProbeCollected(vcenter)
      ? getVMwareCollectionStatusView(vcenter, translator)
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
    }, VMWARE_STATUS_POLL_INTERVAL_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [view?.isPending]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!vcenter || !view) {
    return <></>;
  }

  const canEdit: boolean = PermissionGate.check(
    new VMwareVCenter(),
    ModelAction.Update,
  ).isAllowed;

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_SETTINGS] as Route,
    { modelId: props.modelId },
  );

  const probeName: string =
    vcenter.collectionProbe?.name ||
    (translator.translateText("its probe") as string);

  const trustCertificate: (fingerprint: string) => Promise<void> = async (
    fingerprint: string,
  ): Promise<void> => {
    setIsTrusting(true);
    setTrustError("");

    try {
      await ModelAPI.updateById({
        modelType: VMwareVCenter,
        id: props.modelId,
        data: {
          trustedCertificateFingerprint: fingerprint,
        },
      });
      await load();
    } catch (err) {
      setTrustError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setIsTrusting(false);
    }
  };

  const product: string | null = getVMwareProductLine(
    vcenter.collectionSummary,
  );
  const warnings: Array<string> = vcenter.collectionSummary?.warnings || [];

  return (
    <Card
      title="Data Collection"
      description={translator.translatePlural(
        {
          one: "Collected by {{probe}} from {{address}}, every minute. No agent runs for it.",
          other:
            "Collected by {{probe}} from {{address}}, every {{count}} minutes. No agent runs for it.",
        },
        vcenter.collectionIntervalInMinutes || 2,
        {
          probe: probeName,
          address: vcenter.vcenterUrl || "",
        },
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
      <div className="space-y-3 text-sm" data-testid="vmware-collection-status">
        <div className="flex items-start gap-2">
          <Icon
            icon={
              view.tone === VMwareCollectionTone.Failing
                ? IconProp.Alert
                : view.tone === VMwareCollectionTone.Collecting
                  ? IconProp.CheckCircle
                  : IconProp.Clock
            }
            className={`mt-0.5 h-4 w-4 flex-none ${
              view.tone === VMwareCollectionTone.Failing
                ? "text-red-600"
                : view.tone === VMwareCollectionTone.Collecting
                  ? "text-emerald-600"
                  : "text-indigo-600"
            }`}
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
          <CertificateDetails
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
            {trustError}
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
              {vcenter.lastCollectionAt
                ? OneUptimeDate.fromNow(vcenter.lastCollectionAt)
                : translator.translateText("Not yet")}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">
              {translator.translateText("Last successful collection")}
            </dt>
            <dd className="text-gray-900">
              {vcenter.lastSuccessfulCollectionAt
                ? OneUptimeDate.fromNow(vcenter.lastSuccessfulCollectionAt)
                : translator.translateText("Not yet")}
            </dd>
          </div>
          {product ? (
            <div>
              <dt className="text-gray-500">
                {translator.translateText("vCenter version")}
              </dt>
              <dd className="text-gray-900">{product}</dd>
            </div>
          ) : (
            <></>
          )}
        </dl>

        {warnings.length > 0 &&
        view.tone === VMwareCollectionTone.Collecting ? (
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
  );
};

export default VMwareCollectionStatusCard;
