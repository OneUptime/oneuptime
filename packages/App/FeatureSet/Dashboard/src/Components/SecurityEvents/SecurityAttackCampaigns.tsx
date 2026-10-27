import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SECURITY_ATTACK_CAMPAIGNS_MAX,
  SecurityAttackCampaign,
  SecurityAttackCampaignsResult,
} from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import SecurityEventRequestOutcomePill from "./SecurityEventRequestOutcomePill";
import { getRequestOutcomeColor } from "./SecurityEventRequestStory";
import {
  ATTACKERS_LABEL,
  ATTACK_REQUESTS_LABEL,
  CAMPAIGNS_DESCRIPTION,
  CAMPAIGNS_TITLE,
  CAMPAIGNS_TRUNCATED,
  CAMPAIGN_WINDOWS,
  CORRELATE_ADDRESS,
  CampaignOutcomeSegment,
  CampaignWindow,
  CampaignWindowDefinition,
  CampaignsSummary,
  DEFAULT_CAMPAIGN_WINDOW,
  DIFFERENT_REQUESTS,
  GOT_THROUGH_LABEL,
  LOAD_CAMPAIGNS_FAILED,
  NO_CAMPAIGNS_DESCRIPTION,
  NO_CAMPAIGNS_TITLE,
  REQUESTS_COUNT,
  UNKNOWN_ADDRESS,
  VIEW_REQUESTS,
  buildCampaignCorrelateRoute,
  buildCampaignEventsRoute,
  describeCampaignResult,
  getCampaignAttackKindLabel,
  getCampaignOutcomeSegments,
  getCampaignWindowRange,
  summarizeCampaigns,
} from "./SecurityAttackCampaignsModel";

export const SECURITY_ATTACK_CAMPAIGNS_TEST_ID: string =
  "security-attack-campaigns";
export const SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID: string =
  "security-attack-campaign";

interface LoadedCampaigns {
  result: SecurityAttackCampaignsResult;
  startTime: Date;
  endTime: Date;
}

const WindowPicker: FunctionComponent<{
  selected: CampaignWindow;
  onChange: (selected: CampaignWindow) => void;
}> = (props: {
  selected: CampaignWindow;
  onChange: (selected: CampaignWindow) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="inline-flex gap-1" role="group">
      {CAMPAIGN_WINDOWS.map(
        (definition: CampaignWindowDefinition): ReactElement => {
          const isActive: boolean = definition.window === props.selected;

          return (
            <button
              key={definition.window}
              type="button"
              aria-pressed={isActive}
              className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => {
                props.onChange(definition.window);
              }}
            >
              {translator.translateText(definition.label)}
            </button>
          );
        },
      )}
    </div>
  );
};

const SummaryFigure: FunctionComponent<{
  label: string;
  value: number;
  isAlarming?: boolean | undefined;
}> = (props: {
  label: string;
  value: number;
  isAlarming?: boolean | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-[7rem]">
      <div className="text-xs text-gray-500">
        {translator.translateText(props.label)}
      </div>
      <div
        className={`text-xl font-semibold tabular-nums ${
          props.isAlarming ? "text-red-600" : "text-gray-900"
        }`}
      >
        {translator.formatNumber(props.value)}
      </div>
    </div>
  );
};

const OutcomeBar: FunctionComponent<{ campaign: SecurityAttackCampaign }> = (
  props: { campaign: SecurityAttackCampaign },
): ReactElement => {
  const translator: Translator = useTranslator();
  const segments: Array<CampaignOutcomeSegment> = getCampaignOutcomeSegments(
    props.campaign,
  );
  const total: number = Math.max(1, props.campaign.requestCount);

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      {segments.map((segment: CampaignOutcomeSegment): ReactElement => {
        return (
          <div
            key={segment.key}
            title={`${translator.translateText(segment.label)}: ${translator.formatNumber(segment.count)}`}
            style={{
              width: `${Math.max(2, (segment.count / total) * 100)}%`,
              backgroundColor: segment.color.toString(),
            }}
          />
        );
      })}
    </div>
  );
};

const CampaignRow: FunctionComponent<{
  campaign: SecurityAttackCampaign;
  startTime: Date;
  endTime: Date;
}> = (props: {
  campaign: SecurityAttackCampaign;
  startTime: Date;
  endTime: Date;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const campaign: SecurityAttackCampaign = props.campaign;
  const lastSeen: Date | null = campaign.lastSeen
    ? new Date(campaign.lastSeen)
    : null;
  const correlateRoute: ReturnType<typeof buildCampaignCorrelateRoute> =
    buildCampaignCorrelateRoute(campaign);
  const moreTargets: number = Math.max(
    0,
    campaign.targetCount - campaign.sampleTargets.length,
  );

  return (
    <li
      data-testid={SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID}
      className="flex items-start gap-3 px-5 py-3 md:px-6"
    >
      <span
        className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style={{
          backgroundColor: getRequestOutcomeColor(
            campaign.worstOutcome,
          ).toString(),
        }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm font-semibold text-gray-900">
            {campaign.sourceIp || translator.translateText(UNKNOWN_ADDRESS)}
          </span>
          {campaign.userAgents[0] && (
            <span
              className="min-w-0 max-w-full truncate text-xs text-gray-500"
              title={campaign.userAgents.join("\n")}
            >
              {campaign.userAgents[0]}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SecurityEventRequestOutcomePill
            outcome={campaign.worstOutcome}
            size={PillSize.Small}
          />
          {campaign.attackKinds.map((kind: string): ReactElement => {
            return (
              <span
                key={kind}
                className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600"
              >
                {translator.translateText(getCampaignAttackKindLabel(kind))}
              </span>
            );
          })}
          <span className="text-xs text-gray-500">
            {translator.translatePlural(REQUESTS_COUNT, campaign.requestCount)}
            {lastSeen ? ` · ${OneUptimeDate.fromNow(lastSeen)}` : ""}
          </span>
        </div>

        <OutcomeBar campaign={campaign} />
        <div className="text-xs text-gray-700">
          {describeCampaignResult(campaign, translator)}
        </div>

        {campaign.sampleTargets.length > 0 && (
          <div
            className="truncate font-mono text-[11px] text-gray-500"
            title={campaign.sampleTargets.join("\n")}
          >
            {campaign.sampleTargets.join("  ·  ")}
            {moreTargets > 0
              ? `  ·  ${translator.translatePlural(DIFFERENT_REQUESTS, campaign.targetCount)}`
              : ""}
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1 pt-0.5">
        <Link
          to={buildCampaignEventsRoute({
            campaign,
            startTime: props.startTime,
            endTime: props.endTime,
          })}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          {translator.translateText(VIEW_REQUESTS)}
        </Link>
        {correlateRoute && (
          <Link
            to={correlateRoute}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {translator.translateText(CORRELATE_ADDRESS)}
          </Link>
        )}
      </div>
    </li>
  );
};

/*
 * Who is attacking the project, one row per address: a scanner that sent
 * a hundred probes is one row, not a hundred, and the rows whose requests
 * got through - reached a handler, broke something, ran in the database -
 * come first, so the page answers "did anything work?" at a glance.
 */
const SecurityAttackCampaigns: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [campaignWindow, setCampaignWindow] = useState<CampaignWindow>(
    DEFAULT_CAMPAIGN_WINDOW,
  );
  const [loaded, setLoaded] = useState<LoadedCampaigns | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const load: (selected: CampaignWindow) => Promise<void> = useCallback(
    async (selected: CampaignWindow): Promise<void> => {
      const range: { startTime: Date; endTime: Date } = getCampaignWindowRange(
        selected,
        OneUptimeDate.getCurrentDate(),
      );

      setIsLoading(true);
      setError("");

      try {
        const result: SecurityAttackCampaignsResult =
          await SecurityCaseApi.getAttackCampaigns(range);

        setLoaded({
          result,
          startTime: new Date(result.startTime),
          endTime: new Date(result.endTime),
        });
      } catch (err) {
        setLoaded(null);
        setError(
          (err as Error)?.message ||
            translator.translateText(LOAD_CAMPAIGNS_FAILED) ||
            LOAD_CAMPAIGNS_FAILED,
        );
      } finally {
        setIsLoading(false);
      }
    },
    [translator],
  );

  useEffect(() => {
    void load(campaignWindow);
  }, [campaignWindow]);

  const campaigns: Array<SecurityAttackCampaign> =
    loaded?.result.campaigns || [];
  const summary: CampaignsSummary = summarizeCampaigns(campaigns);

  let body: ReactElement;

  if (isLoading) {
    body = <ComponentLoader />;
  } else if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void load(campaignWindow);
        }}
      />
    );
  } else if (campaigns.length === 0 || !loaded) {
    body = (
      <EmptyState
        id="security-attack-campaigns-empty"
        icon={IconProp.ShieldCheck}
        title={translator.translateText(NO_CAMPAIGNS_TITLE) || ""}
        description={translator.translateText(NO_CAMPAIGNS_DESCRIPTION) || ""}
      />
    );
  } else {
    body = (
      <div>
        <div className="flex flex-wrap gap-6 border-b border-gray-100 px-5 py-3 md:px-6">
          <SummaryFigure label={ATTACKERS_LABEL} value={summary.attackers} />
          <SummaryFigure
            label={ATTACK_REQUESTS_LABEL}
            value={summary.requests}
          />
          <SummaryFigure
            label={GOT_THROUGH_LABEL}
            value={summary.gotThrough}
            isAlarming={summary.gotThrough > 0}
          />
        </div>
        <ul className="divide-y divide-gray-100">
          {campaigns.map((campaign: SecurityAttackCampaign): ReactElement => {
            return (
              <CampaignRow
                key={campaign.sourceIp || "unknown"}
                campaign={campaign}
                startTime={loaded.startTime}
                endTime={loaded.endTime}
              />
            );
          })}
        </ul>
        {loaded.result.isTruncated && (
          <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-500 md:px-6">
            {translator.translateTemplate(CAMPAIGNS_TRUNCATED, {
              count: translator.formatNumber(SECURITY_ATTACK_CAMPAIGNS_MAX),
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-testid={SECURITY_ATTACK_CAMPAIGNS_TEST_ID}>
      <Card
        title={CAMPAIGNS_TITLE}
        description={CAMPAIGNS_DESCRIPTION}
        rightElement={
          <WindowPicker
            selected={campaignWindow}
            onChange={setCampaignWindow}
          />
        }
        /*
         * Edge to edge under the header, as a list in a card is: the card's
         * own padding (CARD_PADDING_CLASS_NAME) cancelled on three sides.
         */
        bodyClassName="mt-4 -mx-5 -mb-6 border-t border-gray-100 md:-mx-6"
      >
        {body}
      </Card>
    </div>
  );
};

export default SecurityAttackCampaigns;
