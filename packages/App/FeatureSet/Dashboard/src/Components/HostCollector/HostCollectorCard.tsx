import React, { FunctionComponent, ReactElement, useState } from "react";
import Host from "Common/Models/DatabaseModels/Host";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import { CARD_MODEL_DETAIL_BODY_CLASS_NAME } from "Common/UI/Components/ModelDetail/CardModelDetail";
import Detail from "Common/UI/Components/Detail/Detail";
import DetailField from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import AppLink from "../AppLink/AppLink";
import AgentVersion from "../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../Components/AgentVersion/AgentKind";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HostCollectorStatePill from "./HostCollectorStatePill";
import HostCollectorConfigPickerModal from "./HostCollectorConfigPickerModal";
import {
  HostCollectorState,
  HostCollectorTranslatableText,
  describeHostCollectorState,
  getHostCollectorConfigLabel,
  getHostCollectorState,
  summarizeCollectorError,
} from "./HostCollectorStatus";
import { describeHostCollectorConfigChoice } from "./HostCollectorConfigChoice";

/*
 * The collector OneUptime manages on a host, on the host's Collector page:
 * where it stands (with the reason when its config failed or it reports an
 * error), the config it runs and how that config was chosen, the version it
 * runs, and when it last reported.
 *
 *   - Change config: run the config the list gives the host, or one picked
 *     for it.
 *   - Try again: send a config that failed on the host once more - after
 *     whatever made it fail there (a missing file, a port in use) is fixed.
 */

// The host columns this card reads.
export const HOST_COLLECTOR_CARD_SELECT: Record<string, unknown> = {
  name: true,
  osType: true,
  agentVersion: true,
  collectorInstanceUid: true,
  collectorLastContactAt: true,
  collectorConfigId: true,
  collectorConfig: {
    name: true,
  },
  isCollectorConfigPinned: true,
  collectorConfigVersion: {
    versionNumber: true,
  },
  collectorConfigStatus: true,
  collectorConfigError: true,
  collectorFailedConfigHash: true,
  isCollectorHealthy: true,
  collectorHealthError: true,
  labels: {
    _id: true,
  },
};

export interface ComponentProps {
  host: Host;
  // The host changed here (a picked config, Try again): read it again.
  onChanged: () => void;
}

const HostCollectorCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [isRetryOpen, setIsRetryOpen] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryError, setRetryError] = useState<string>("");

  const host: Host = props.host;
  const state: HostCollectorState = getHostCollectorState(host);
  const updateGate: PermissionGateResult = PermissionGate.check(
    new Host(),
    ModelAction.Update,
  );

  const configName: string = getHostCollectorConfigLabel(
    {
      configName: host.collectorConfig?.name,
      osType: host.osType,
    },
    translator,
  );

  const stateText: HostCollectorTranslatableText = describeHostCollectorState({
    host: host,
    configName: configName,
  });

  const error: string | null =
    state === HostCollectorState.Failed
      ? host.collectorConfigError || null
      : state === HostCollectorState.Unhealthy
        ? host.collectorHealthError || null
        : null;
  const errorSummary: string | null = summarizeCollectorError(error);
  /*
   * The box says it in the pill's tone: red for a config that did not
   * start (Config failed), amber for a collector that runs but reports an
   * error (Collector error).
   */
  const errorTone: {
    name: string;
    box: string;
    text: string;
    summary: string;
  } =
    state === HostCollectorState.Unhealthy
      ? {
          name: "warning",
          box: "border-amber-200 bg-amber-50",
          text: "text-amber-900",
          summary: "text-amber-800",
        }
      : {
          name: "danger",
          box: "border-red-200 bg-red-50",
          text: "text-red-800",
          summary: "text-red-700",
        };

  const canRetry: boolean = Boolean(host.collectorFailedConfigHash);

  const buttons: Array<{
    title: string;
    icon: IconProp;
    buttonStyle: ButtonStyleType;
    onClick: () => void;
    disabled?: boolean | undefined;
    tooltip?: string | undefined;
  }> = [];

  if (updateGate.isAllowed || updateGate.disabledReason) {
    if (canRetry) {
      buttons.push({
        title: "Try again",
        icon: IconProp.Refresh,
        buttonStyle: ButtonStyleType.NORMAL,
        disabled: !updateGate.isAllowed,
        tooltip: updateGate.disabledReason,
        onClick: () => {
          setRetryError("");
          setIsRetryOpen(true);
        },
      });
    }

    buttons.push({
      title: "Change config",
      icon: IconProp.Edit,
      buttonStyle: ButtonStyleType.NORMAL,
      disabled: !updateGate.isAllowed,
      tooltip: updateGate.disabledReason,
      onClick: () => {
        setIsPickerOpen(true);
      },
    });
  }

  const configId: string | undefined = host.collectorConfigId?.toString();

  const fields: Array<DetailField<Host>> = [
    {
      key: "collectorConfigId",
      title: "Config",
      fieldType: FieldType.Element,
      getElement: (): ReactElement => {
        if (!configId) {
          return (
            <span data-testid="host-collector-config-name">{configName}</span>
          );
        }
        return (
          <AppLink
            className="text-indigo-600 hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_COLLECTOR_CONFIG_VIEW] as Route,
              { modelId: new ObjectID(configId) },
            )}
          >
            <span data-testid="host-collector-config-name">{configName}</span>
          </AppLink>
        );
      },
    },
    {
      key: "isCollectorConfigPinned",
      title: "Why this config",
      fieldType: FieldType.Element,
      getElement: (): ReactElement => {
        const choice: HostCollectorTranslatableText =
          describeHostCollectorConfigChoice({
            collectorConfigId: configId || null,
            isCollectorConfigPinned: host.isCollectorConfigPinned,
          });
        return (
          <span data-testid="host-collector-config-choice">
            {translator.translateTemplate(choice.template, choice.values)}
          </span>
        );
      },
    },
    {
      // The version of the Collector Config it runs: a default has none.
      key: "collectorConfigVersion",
      title: "Version",
      fieldType: FieldType.Element,
      showIf: (): boolean => {
        return Boolean(configId);
      },
      getElement: (): ReactElement => {
        const versionNumber: number | undefined =
          host.collectorConfigVersion?.versionNumber;

        if (!versionNumber) {
          return (
            <span data-testid="host-collector-config-version">
              {translator.translateText("Not yet")}
            </span>
          );
        }

        /*
         * After a config failed, the host went back to the last one that
         * worked: the version it runs is not the one that failed, and says
         * so - "1" alone under a failed config reads as the version that
         * failed.
         */
        return (
          <span data-testid="host-collector-config-version">
            {state === HostCollectorState.Failed
              ? translator.translateTemplate(
                  "{{number}}, the last that worked here",
                  { number: translator.formatNumber(versionNumber) },
                )
              : translator.formatNumber(versionNumber)}
          </span>
        );
      },
    },
    {
      key: "collectorLastContactAt",
      title: "Last report",
      fieldType: FieldType.Element,
      getElement: (): ReactElement => {
        /*
         * "2 minutes ago" in the reader's language (moment's fromNow is
         * English on every page), with the date and time on hover.
         */
        const lastContact: Date | null = host.collectorLastContactAt
          ? OneUptimeDate.fromString(host.collectorLastContactAt)
          : null;

        if (!lastContact || isNaN(lastContact.getTime())) {
          return <span data-testid="host-collector-last-report">—</span>;
        }

        const clock: FeedClock = getFeedClock({
          language: translator.language,
        });

        return (
          <span
            data-testid="host-collector-last-report"
            title={formatFeedFullTime(lastContact, clock)}
          >
            {formatFeedTimeAgo(lastContact, clock) ||
              OneUptimeDate.fromNow(lastContact)}
          </span>
        );
      },
    },
    {
      key: "agentVersion",
      title: "Collector release",
      fieldType: FieldType.Element,
      showIf: (item: Host): boolean => {
        return Boolean(item.agentVersion);
      },
      getElement: (item: Host): ReactElement => {
        /*
         * A sign beside a release older than the one this OneUptime pins
         * opens how to upgrade it: the install command, run again, which
         * this page's On the host card gives.
         */
        return (
          <AgentVersion
            kind={AgentKind.HostCollector}
            version={item.agentVersion}
            setupGuideRoute={RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_VIEW_DOCUMENTATION] as Route,
              { modelId: host._id?.toString() },
            )}
            upgradeGuideContext={{
              hostOsType: item.osType,
              isHostCollectorManaged: true,
            }}
          />
        );
      },
    },
  ];

  return (
    <Card
      title="Collector"
      description={
        /*
         * Collector Configs is where what a host collects is changed: a
         * link, one click from the sentence that names it.
         */
        <TranslatedSentence
          template="OneUptime installed this host's collector and sends it its config. Change what it collects with {{collectorConfigs}}."
          slots={{
            collectorConfigs: (
              <AppLink
                className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.HOST_COLLECTOR_CONFIGS] as Route,
                )}
              >
                {translator.translateTemplate("Collector Configs")}
              </AppLink>
            ),
          }}
        />
      }
      buttons={buttons}
    >
      <div className={CARD_MODEL_DETAIL_BODY_CLASS_NAME}>
        <div
          className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3"
          data-testid="host-collector-state"
        >
          <div className="flex-none">
            <HostCollectorStatePill host={host} />
          </div>
          <p className="min-w-0 text-sm text-gray-700 sm:flex-1">
            {translator.translateTemplate(stateText.template, stateText.values)}
          </p>
        </div>

        {error && (
          <div
            className={`mt-4 rounded-md border p-3 ${errorTone.box}`}
            data-testid="host-collector-error"
            data-tone={errorTone.name}
          >
            <p className={`break-words text-sm font-medium ${errorTone.text}`}>
              {errorSummary}
            </p>
            <details className="mt-2">
              <summary
                className={`cursor-pointer text-xs font-medium ${errorTone.summary}`}
              >
                {translator.translateText("What the host reported")}
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-xs text-gray-800">
                {error}
              </pre>
            </details>
          </div>
        )}

        <div className="mt-4">
          <Detail<Host>
            id="host-collector-details"
            item={host}
            showDetailsInNumberOfColumns={2}
            fields={fields}
          />
        </div>
      </div>

      {isPickerOpen ? (
        <HostCollectorConfigPickerModal
          host={host}
          onClose={() => {
            setIsPickerOpen(false);
          }}
          onSaved={() => {
            setIsPickerOpen(false);
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}

      {isRetryOpen ? (
        <ConfirmModal
          title="Try the config again?"
          description="OneUptime sends the failed config to this host again. Fix what stopped it first: if it fails again, the host keeps its last working config."
          submitButtonText="Try again"
          isLoading={isRetrying}
          error={retryError || undefined}
          onClose={() => {
            setIsRetryOpen(false);
          }}
          onSubmit={() => {
            setIsRetrying(true);
            setRetryError("");
            ModelAPI.updateById<Host>({
              modelType: Host,
              id: new ObjectID(host._id?.toString() || ""),
              data: {
                collectorFailedConfigHash: null,
              },
            })
              .then(() => {
                setIsRetrying(false);
                setIsRetryOpen(false);
                props.onChanged();
              })
              .catch((err: unknown) => {
                setIsRetrying(false);
                setRetryError(API.getFriendlyMessage(err));
              });
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default HostCollectorCard;
