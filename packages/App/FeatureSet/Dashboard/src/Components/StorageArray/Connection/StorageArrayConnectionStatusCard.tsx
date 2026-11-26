import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import Card from "Common/UI/Components/Card/Card";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { BILLING_ENABLED } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { getNextClaimWords } from "../../Probe/NextClaimWords";
import StorageArrayCertificateDetails from "./StorageArrayCertificateDetails";
import {
  StorageArrayCollectionStatusView,
  StorageArrayCollectionTone,
  getStorageArrayCollectionDescription,
  getStorageArrayNextCollection,
} from "./StorageArrayConnectionView";

/*
 * How a storage array connection's collection is doing (#11004), first on
 * its page: is the probe reading every array behind it, and if not,
 * exactly why and the one thing that fixes it - "Trust this certificate"
 * right here, for a certificate the probe found and nobody trusted yet.
 * VMware's Data Collection card (VMwareCollectionStatusCard), for a
 * Unisphere.
 */

export interface ComponentProps {
  connection: StorageArrayConnection;
  view: StorageArrayCollectionStatusView;
  collector: StorageArrayProbeCollector;
  canEdit: boolean;
  isTrusting: boolean;
  trustError: string;
  onTrustCertificate: (fingerprint: string) => void;
}

function badgeTypeOf(tone: StorageArrayCollectionTone): StatusBadgeType {
  switch (tone) {
    case StorageArrayCollectionTone.Collecting:
      return StatusBadgeType.Success;
    case StorageArrayCollectionTone.Failing:
      return StatusBadgeType.Danger;
    default:
      return StatusBadgeType.Info;
  }
}

const StorageArrayConnectionStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const connection: StorageArrayConnection = props.connection;
  const view: StorageArrayCollectionStatusView = props.view;
  const warnings: Array<string> = connection.collectionSummary?.warnings || [];
  const version: string = [
    connection.collectionSummary?.serverProductName,
    connection.collectionSummary?.serverVersion,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      title="Data Collection"
      description={getStorageArrayCollectionDescription(
        connection,
        translator,
        new Date(),
        BILLING_ENABLED,
      )}
      rightElement={
        <StatusBadge text={view.label} type={badgeTypeOf(view.tone)} />
      }
    >
      <div
        className="space-y-3 text-sm"
        data-testid="storage-array-connection-status"
      >
        <div className="flex items-start gap-2">
          <Icon
            icon={
              view.tone === StorageArrayCollectionTone.Failing
                ? IconProp.Alert
                : view.tone === StorageArrayCollectionTone.Collecting
                  ? IconProp.CheckCircle
                  : IconProp.Clock
            }
            className={`mt-0.5 h-4 w-4 flex-none ${
              view.tone === StorageArrayCollectionTone.Failing
                ? "text-red-600"
                : view.tone === StorageArrayCollectionTone.Collecting
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
          <StorageArrayCertificateDetails
            certificate={view.certificate}
            checkHint={props.collector.words.certificateCheckHint}
            onTrust={
              props.canEdit && !props.isTrusting
                ? () => {
                    props.onTrustCertificate(view.certificate!.fingerprint256);
                  }
                : undefined
            }
          />
        ) : (
          <></>
        )}

        {props.trustError ? (
          <p className="text-red-700" role="alert">
            <ErrorInSentence
              message={props.trustError}
              showWhereToLook={true}
            />
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
              {connection.lastCollectionAt
                ? OneUptimeDate.fromNow(connection.lastCollectionAt)
                : translator.translateText("Not yet")}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">
              {translator.translateText("Last successful collection")}
            </dt>
            <dd className="text-gray-900">
              {connection.lastSuccessfulCollectionAt
                ? OneUptimeDate.fromNow(connection.lastSuccessfulCollectionAt)
                : translator.translateText("Not yet")}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">
              {translator.translateText("Next collection")}
            </dt>
            <dd
              className="text-gray-900"
              data-testid="storage-array-next-collection"
            >
              {getNextClaimWords(
                getStorageArrayNextCollection(
                  connection,
                  new Date(),
                  BILLING_ENABLED,
                ),
                translator,
              )}
            </dd>
          </div>
          {version ? (
            <div>
              <dt className="text-gray-500">
                {translator.translateText("Unisphere version")}
              </dt>
              <dd className="text-gray-900">{version}</dd>
            </div>
          ) : (
            <></>
          )}
        </dl>

        {warnings.length > 0 &&
        view.tone === StorageArrayCollectionTone.Collecting ? (
          <div className="text-xs text-gray-600">
            <div className="font-medium text-gray-700">
              {translator.translateText("Left out of the last collection:")}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
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

export default StorageArrayConnectionStatusCard;
