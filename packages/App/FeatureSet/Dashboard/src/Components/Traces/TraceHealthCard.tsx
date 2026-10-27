import {
  TRACE_HEALTH_DESCRIPTION,
  TRACE_HEALTH_TITLE,
  TraceHealthTile,
  describeTraceHealthSample,
  getTraceHealthTiles,
  isTraceHealthShown,
} from "./TraceHealthPresentation";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  TRACE_HEALTH_ROUTE,
  TraceHealthReport,
  parseTraceHealthReport,
} from "Common/Types/Telemetry/TraceHealth";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "Trace health" at the top of a service's Traces page: how many of its
 * spans arrive with the span they belong to, how many of its traces are one
 * span long, and how many of its logs link to a trace - over the last hour,
 * on a sample of its traces (POST /telemetry/traces/health). Under a number
 * that looks poor, one line says what usually causes it and links the docs
 * that fix it; what the numbers were measured on is in the (i).
 *
 * It is a hint above the list, never in its way: nothing is drawn while it
 * loads, when the service sent no span in the window, or when the numbers
 * could not be read.
 */

// The service's report for the last hour, or null when it cannot be read.
export async function loadTraceHealth(
  serviceId: string,
): Promise<TraceHealthReport | null> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(TRACE_HEALTH_ROUTE),
      data: { serviceId: serviceId },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    return null;
  }

  return parseTraceHealthReport(response.data);
}

function TraceHealthTileView(props: { tile: TraceHealthTile }): ReactElement {
  const translator: Translator = useTranslator();
  const tile: TraceHealthTile = props.tile;
  const label: string = translator.translateText(tile.label) || tile.label;

  return (
    <div
      className="rounded-lg border border-gray-200 p-4"
      data-testid={`trace-health-tile-${tile.key}`}
      data-poor={tile.isPoor ? "true" : "false"}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        {tile.isPoor ? (
          <Icon
            icon={IconProp.Alert}
            className="h-3.5 w-3.5 flex-shrink-0 text-amber-600"
          />
        ) : (
          <></>
        )}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 text-xl font-semibold ${
          tile.isPoor ? "text-amber-700" : "text-gray-900"
        }`}
        data-testid={`trace-health-tile-${tile.key}-value`}
      >
        {tile.value}
      </div>
      {tile.hint ? (
        <p
          className="mt-2 text-xs leading-relaxed text-gray-600"
          data-testid={`trace-health-tile-${tile.key}-hint`}
        >
          {translator.translateText(tile.hint.text)}{" "}
          <a
            className="font-medium text-indigo-600 hover:underline"
            href={tile.hint.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {translator.translateText(tile.hint.linkText)}
          </a>
        </p>
      ) : (
        <></>
      )}
    </div>
  );
}

export interface ComponentProps {
  serviceId: ObjectID;
  // The report to show, when the caller already has it (tests, fixtures).
  report?: TraceHealthReport | null | undefined;
}

const TraceHealthCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [loaded, setLoaded] = useState<TraceHealthReport | null>(null);
  const serviceId: string = props.serviceId.toString();
  const isGiven: boolean = props.report !== undefined;

  useEffect(() => {
    if (isGiven) {
      return;
    }

    let isCurrent: boolean = true;

    setLoaded(null);

    loadTraceHealth(serviceId)
      .then((report: TraceHealthReport | null) => {
        if (isCurrent) {
          setLoaded(report);
        }
      })
      .catch(() => {
        // The Traces list below is the page; a hint that fails says nothing.
      });

    return () => {
      isCurrent = false;
    };
  }, [serviceId, isGiven]);

  const report: TraceHealthReport | null = isGiven
    ? props.report || null
    : loaded;

  if (!isTraceHealthShown(report)) {
    return <></>;
  }

  const title: string =
    translator.translateText(TRACE_HEALTH_TITLE) || TRACE_HEALTH_TITLE;

  return (
    <div data-testid="trace-health-card">
      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            {title}
            <InfoTooltip
              label={TRACE_HEALTH_TITLE}
              text={describeTraceHealthSample(report, translator)}
              iconClassName="h-4 w-4"
              dataTestId="trace-health-sample"
            />
          </span>
        }
        titleText={TRACE_HEALTH_TITLE}
        description={TRACE_HEALTH_DESCRIPTION}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {getTraceHealthTiles(report, translator).map(
            (tile: TraceHealthTile): ReactElement => {
              return <TraceHealthTileView key={tile.key} tile={tile} />;
            },
          )}
        </div>
      </Card>
    </div>
  );
};

export default TraceHealthCard;
