import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  INSIGHT_HIGHLIGHT_LABELS,
  INSIGHT_HIGHLIGHTS_DESCRIPTION,
  INSIGHT_HIGHLIGHTS_TITLE,
  INSIGHT_SERVICE_HIGHLIGHT_ADVICE,
  describeHighlightFinding,
  describeNewHighlight,
  describeNewestFinding,
  describeServiceHighlight,
  hasHighlights,
  parseAIInsightHighlights,
} from "./InsightHighlightsData";
import {
  getInsightTypeIcon,
  getInsightTypeLabel,
  getSeverityTileClasses,
} from "./InsightPresentation";
import {
  AI_INSIGHT_HIGHLIGHTS_PATH,
  AIInsightHighlightFinding,
  AIInsightHighlights,
} from "Common/Types/AI/AIInsightHighlights";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightType from "Common/Types/AI/AIInsightType";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * What the AI Insights inbox leads with, above its filters and its list:
 * the open finding to look at first (with what OneUptime AI's triage
 * concluded), the service behind most of them, and what is new this week
 * (POST /ai-insight/highlights). It says nothing while it loads, when there
 * is nothing open, or when it could not be read — the inbox below is the
 * page either way, so a failure here never stands in its way.
 */

const NEXT_STEP_CLASS_NAME: string =
  "inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800";

export function getInsightRoute(insightId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_INSIGHT_VIEW] as Route,
    { modelId: insightId },
  );
}

export function getTelemetryServiceRoute(serviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SERVICE_VIEW] as Route,
    { modelId: serviceId },
  );
}

export async function loadInsightHighlights(): Promise<AIInsightHighlights | null> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        AI_INSIGHT_HIGHLIGHTS_PATH,
      ),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    return null;
  }

  return parseAIInsightHighlights(response.data);
}

function HighlightRow(props: {
  label: string;
  icon: IconProp;
  badgeClassName: string;
  headline: string;
  facts?: string | undefined;
  triageSummary?: string | undefined;
  target?: { route: Route; label: string } | undefined;
  testId: string;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0" data-testid={props.testId}>
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${props.badgeClassName}`}
      >
        <Icon icon={props.icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-500">
          {translator.translateText(props.label)}
        </p>
        <h3 className="mt-0.5 break-words text-base font-semibold text-gray-900">
          {props.headline}
        </h3>
        {props.facts ? (
          <p className="mt-1 break-words text-sm text-gray-600">
            {props.facts}
          </p>
        ) : (
          <></>
        )}
        {props.triageSummary ? (
          <dl className="mt-3 border-l-2 border-gray-200 pl-3">
            <dt className="text-xs font-medium text-gray-500">
              {translator.translateText("What OneUptime AI found")}
            </dt>
            <dd
              className="mt-0.5 break-words text-sm text-gray-800"
              data-testid="ai-insight-highlights-triage"
            >
              {props.triageSummary}
            </dd>
          </dl>
        ) : (
          <></>
        )}
        {props.target ? (
          <div className="mt-3">
            <Link to={props.target.route} className={NEXT_STEP_CLASS_NAME}>
              <span>{translator.translateText(props.target.label)}</span>
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
}

export interface ComponentProps {
  // The highlights to show, when the caller already has them (tests, fixtures).
  highlights?: AIInsightHighlights | null | undefined;
}

const InsightHighlights: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [loaded, setLoaded] = useState<AIInsightHighlights | null>(null);
  const isGiven: boolean = props.highlights !== undefined;

  useEffect(() => {
    if (isGiven) {
      return;
    }

    let isCurrent: boolean = true;

    loadInsightHighlights()
      .then((highlights: AIInsightHighlights | null) => {
        if (isCurrent) {
          setLoaded(highlights);
        }
      })
      .catch(() => {
        // Nothing to lead with: the inbox below is the page.
      });

    return () => {
      isCurrent = false;
    };
  }, [isGiven]);

  const highlights: AIInsightHighlights | null = isGiven
    ? props.highlights || null
    : loaded;

  if (!highlights || !hasHighlights(highlights)) {
    return <></>;
  }

  const top: AIInsightHighlightFinding = highlights.topFinding!;

  return (
    <div data-testid="ai-insight-highlights">
      <Card
        title={INSIGHT_HIGHLIGHTS_TITLE}
        description={INSIGHT_HIGHLIGHTS_DESCRIPTION}
      >
        <ul className="divide-y divide-gray-100">
          <HighlightRow
            testId="ai-insight-highlights-top"
            label={INSIGHT_HIGHLIGHT_LABELS.topFinding}
            icon={getInsightTypeIcon(top.insightType as AIInsightType)}
            badgeClassName={getSeverityTileClasses(
              top.severity as AIInsightSeverity,
            )}
            headline={top.title}
            facts={describeHighlightFinding(
              top,
              getInsightTypeLabel(top.insightType as AIInsightType),
            )}
            triageSummary={top.triageSummary}
            target={{
              route: getInsightRoute(top.id),
              label: translationKey("Open insight"),
            }}
          />
          {highlights.topService ? (
            <HighlightRow
              testId="ai-insight-highlights-service"
              label={INSIGHT_HIGHLIGHT_LABELS.topService}
              icon={IconProp.MapPin}
              badgeClassName="bg-indigo-50 text-indigo-600"
              headline={describeServiceHighlight(
                highlights.topService,
                highlights.openCount,
              )}
              facts={translator.translateText(
                INSIGHT_SERVICE_HIGHLIGHT_ADVICE,
              )}
              target={
                highlights.topService.id
                  ? {
                      route: getTelemetryServiceRoute(highlights.topService.id),
                      label: translationKey("Open service"),
                    }
                  : undefined
              }
            />
          ) : (
            <></>
          )}
          {highlights.newCount > 0 && highlights.newest ? (
            <HighlightRow
              testId="ai-insight-highlights-new"
              label={INSIGHT_HIGHLIGHT_LABELS.newest}
              icon={IconProp.Bell}
              badgeClassName="bg-amber-50 text-amber-600"
              headline={describeNewHighlight(highlights.newCount)}
              facts={describeNewestFinding(highlights.newest)}
              target={{
                route: getInsightRoute(highlights.newest.id),
                label: translationKey("Open the newest"),
              }}
            />
          ) : (
            <></>
          )}
        </ul>
      </Card>
    </div>
  );
};

export default InsightHighlights;
