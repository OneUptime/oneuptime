import IconProp from "Common/Types/Icon/IconProp";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackForecast } from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import { OPENSTACK_FORECAST_WINDOW_HOURS } from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";

/*
 * The Growth Forecast tile on the shared part pieces, and what a list's cell says of the
 * same thing. It says when there isn't enough history to tell, because a guess on a new
 * cloud would be the first thing an operator stops trusting.
 */

const FULL_NOW: string = translationKey("Full now");
const NOT_GROWING: string = translationKey("Not growing");
const NOT_ENOUGH_HISTORY: string = translationKey("Not enough history");

export function getOpenStackForecastText(
  forecast: OpenStackForecast,
  translator: Translator,
): string {
  switch (forecast.state) {
    case "full":
      return translator.translateText(FULL_NOW) || FULL_NOW;
    case "not-growing":
      return translator.translateText(NOT_GROWING) || NOT_GROWING;
    case "not-enough-history":
      return translator.translateText(NOT_ENOUGH_HISTORY) || NOT_ENOUGH_HISTORY;
    default:
      return translator.translatePlural(
        { one: "~{{count}} day", other: "~{{count}} days" },
        Math.max(1, Math.round(forecast.days)),
      );
  }
}

export interface ComponentProps {
  forecast: OpenStackForecast | null;
  // What it says of its own value, in the (i).
  description: string;
}

const OpenStackForecastTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.forecast) {
    return <></>;
  }

  return (
    <GoldenMetricTile
      title="Growth Forecast"
      icon={IconProp.ArrowTrendingUp}
      iconColor="violet"
      value={getOpenStackForecastText(props.forecast, translator)}
      sublabel={
        props.forecast.state === "days"
          ? translator.translatePlural(
              {
                one: "until full, at the last {{count}} hour's growth",
                other: "until full, at the last {{count}} hours' growth",
              },
              OPENSTACK_FORECAST_WINDOW_HOURS,
            )
          : undefined
      }
      description={props.description}
    />
  );
};

export default OpenStackForecastTile;
