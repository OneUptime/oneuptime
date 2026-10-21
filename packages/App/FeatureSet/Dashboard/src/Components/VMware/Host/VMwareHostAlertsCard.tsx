import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  RecommendationStatus,
  RecommendationViewModel,
} from "../../Recommendations/RecommendationViewModel";
import {
  getVMwareHostAlertsToTurnOn,
  loadVMwareHostAlertCoverage,
} from "./VMwareHostAlertCoverage";

/*
 * "Will I hear about it when this host is in trouble?" on an ESXi host's
 * page: the recommended host alerts, which of them are on, and one step to
 * turn on the rest - the vCenter's Recommendations page, opened with those
 * alerts already ticked, where one button creates them. Each alert is one
 * monitor on the vCenter that fires for every host that crosses it, so the
 * card says so instead of suggesting one monitor per host.
 *
 * It is supplementary: when the monitors cannot be read (a role without
 * monitor access) the card is left out rather than showing an error.
 */

export const TURN_ON_BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export interface ComponentProps {
  vcenterId: ObjectID;
  vcenterName: string;
  // The vCenter's Recommendations page, with the alerts to turn on ticked.
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  // Re-read the coverage (the page's refresh).
  refreshToken?: number | undefined;
}

const VMwareHostAlertsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const listClassName: string = useCardRuledListClassName();

  const [viewModels, setViewModels] =
    useState<Array<RecommendationViewModel> | null>(null);
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  useEffect(() => {
    let ignore: boolean = false;

    loadVMwareHostAlertCoverage({
      vcenterId: props.vcenterId,
      vcenterName: props.vcenterName,
    })
      .then((loaded: Array<RecommendationViewModel>) => {
        if (ignore) {
          return;
        }
        setViewModels(loaded);
        setHasFailed(false);
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setHasFailed(true);
      });

    return () => {
      ignore = true;
    };
  }, [props.vcenterId.toString(), props.vcenterName, props.refreshToken]);

  if (hasFailed || !viewModels || viewModels.length === 0) {
    return <></>;
  }

  const toTurnOn: Array<string> = getVMwareHostAlertsToTurnOn(viewModels);

  const renderStatus: (viewModel: RecommendationViewModel) => ReactElement = (
    viewModel: RecommendationViewModel,
  ): ReactElement => {
    if (
      viewModel.status === RecommendationStatus.Created &&
      viewModel.monitorId
    ) {
      return (
        <Link
          to={props.getMonitorRoute(viewModel.monitorId)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:underline"
        >
          <Icon icon={IconProp.Check} className="h-3 w-3" />
          {tx("On")}
        </Link>
      );
    }

    if (viewModel.status === RecommendationStatus.Dismissed) {
      return (
        <span className="inline-flex whitespace-nowrap rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
          {tx("Dismissed")}
        </span>
      );
    }

    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
        {tx("Not set up")}
      </span>
    );
  };

  return (
    <div className="mb-6" data-testid="vmware-host-alerts">
      <Card
        title="Host alerts"
        description="Each one watches every host of this vCenter and fires for each host that crosses it."
        buttons={
          toTurnOn.length > 0
            ? [
                <Link
                  key="turn-on-host-alerts"
                  to={props.getRecommendationsRoute(toTurnOn)}
                  className={TURN_ON_BUTTON_CLASS_NAME}
                  dataTestId="vmware-host-alerts-turn-on"
                >
                  <Icon
                    icon={IconProp.Bell}
                    className="h-4 w-4 flex-shrink-0 text-gray-500"
                  />
                  <span>
                    {translator.translatePlural(
                      {
                        one: "Turn on {{count}} alert",
                        other: "Turn on {{count}} alerts",
                      },
                      toTurnOn.length,
                    )}
                  </span>
                </Link>,
              ]
            : []
        }
      >
        <ul className={listClassName}>
          {viewModels.map(
            (viewModel: RecommendationViewModel): ReactElement => {
              return (
                <li
                  key={viewModel.recommendation.recommendationId}
                  data-testid="vmware-host-alert"
                  data-status={viewModel.status}
                  className="flex items-start justify-between gap-3 px-5 py-3 md:px-6"
                >
                  {/*
                   * The template's own name and summary, as the
                   * Recommendations page shows them.
                   */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                      {viewModel.recommendation.name}
                    </div>
                    {viewModel.recommendation.summary ? (
                      <div className="mt-0.5 text-xs text-gray-500">
                        {viewModel.recommendation.summary}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                  <div className="flex-shrink-0 pt-0.5">
                    {renderStatus(viewModel)}
                  </div>
                </li>
              );
            },
          )}
        </ul>
      </Card>
    </div>
  );
};

export default VMwareHostAlertsCard;
