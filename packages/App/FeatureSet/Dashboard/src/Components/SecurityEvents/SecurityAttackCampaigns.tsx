import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SECURITY_ATTACK_CAMPAIGNS_MAX,
  SecurityAttackActivity,
  SecurityAttackCampaign,
  SecurityAttackCampaignsResult,
  getCampaignGotThroughCount,
} from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import {
  SECURITY_ATTACK_NETWORK_ADDRESSES_MAX,
  SecurityAttackNetwork,
  SecurityAttackNetworksResult,
} from "Common/Types/SecurityEvent/SecurityAttackNetwork";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import BlockAddressModal from "./Blocklist/BlockAddressModal";
import { BLOCK_ADDRESS_TITLE } from "./Blocklist/BlocklistCopy";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
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
  VIEW_REQUESTS,
  buildCampaignCorrelateRoute,
  buildCampaignEventsRoute,
  buildCampaignNetworkEventsRoute,
  describeCampaignResult,
  getCampaignAddressText,
  getCampaignAttackKindLabel,
  getCampaignOutcomeSegments,
  getCampaignWindowRange,
  summarizeCampaigns,
} from "./SecurityAttackCampaignsModel";
import BlockCampaignsModal from "./Campaigns/BlockCampaignsModal";
import ChallengeNetworkModal from "./Campaigns/ChallengeNetworkModal";
import { getAttackNetworks } from "./Campaigns/CampaignContainmentApi";
import {
  BLOCK_ADDRESSES,
  CHALLENGE_THIS_NETWORK,
  CLEAR_SELECTION,
  GROUP_BY_NETWORK,
  GROUP_BY_NETWORK_DESCRIPTION,
  NETWORKS_LABEL,
  NETWORKS_TRUNCATED,
  SECURITY_CAMPAIGN_TEST_IDS,
  SELECT_ADDRESS_LABEL,
  SELECT_ALL_LABEL,
  SELECT_TO_BLOCK_HINT,
} from "./Campaigns/CampaignContainmentCopy";
import {
  RowBlockPill,
  getSelectableAddresses,
  isCampaignBlockable,
  isCampaignSelectable,
  isNetworkChallengeable,
  keepSelectable,
  writeNetworkAddressCount,
  writeNetworkAddresses,
  writeNetworkRanges,
  writeRowBlockPill,
  writeSelectedCount,
} from "./Campaigns/CampaignContainmentModel";

export const SECURITY_ATTACK_CAMPAIGNS_TEST_ID: string =
  "security-attack-campaigns";
export const SECURITY_ATTACK_CAMPAIGN_ROW_TEST_ID: string =
  "security-attack-campaign";

/*
 * A campaign's address can be blocked from its row (#10342) when it is a
 * public one (Campaigns/CampaignContainmentModel).
 */
export { isCampaignBlockable };

type LoadedRows =
  | {
      isByNetwork: false;
      result: SecurityAttackCampaignsResult;
      startTime: Date;
      endTime: Date;
    }
  | {
      isByNetwork: true;
      result: SecurityAttackNetworksResult;
      startTime: Date;
      endTime: Date;
    };

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

const OutcomeBar: FunctionComponent<{
  campaign: SecurityAttackActivity;
}> = (props: { campaign: SecurityAttackActivity }): ReactElement => {
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
            title={translator.translateTemplate("{{label}}: {{count}}", {
              label: translatableTerm(segment.label),
              count: translator.formatNumber(segment.count),
            })}
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

// The kinds of attack a row sent, as chips.
const AttackKindChips: FunctionComponent<{ kinds: Array<string> }> = (props: {
  kinds: Array<string>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <>
      {props.kinds.map((kind: string): ReactElement => {
        return (
          <span
            key={kind}
            className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600"
          >
            {translator.translateText(getCampaignAttackKindLabel(kind))}
          </span>
        );
      })}
    </>
  );
};

// The block on the Blocklist that holds a row now (#10354).
const RowBlock: FunctionComponent<{
  row: SecurityAttackActivity;
  value: string;
}> = (props: { row: SecurityAttackActivity; value: string }): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.row.block) {
    return <></>;
  }

  const pill: RowBlockPill = writeRowBlockPill({
    block: props.row.block,
    value: props.value,
    translator,
  });

  return (
    <span data-testid={SECURITY_CAMPAIGN_TEST_IDS.rowBlock}>
      <Pill
        text={pill.text}
        tone={pill.tone}
        size={PillSize.Small}
        isUserContent={true}
        {...(pill.tooltip
          ? { tooltip: pill.tooltip, isTooltipUserContent: true }
          : {})}
      />
    </span>
  );
};

interface CampaignRowProps {
  campaign: SecurityAttackCampaign;
  startTime: Date;
  endTime: Date;
  // Block Address on the row's address (#10342), and why it is locked; none without it.
  onBlock?: ((address: string) => void) | undefined;
  blockLockReason?: string | undefined;
  // Ticked for Block Addresses (#10354); none for a row it cannot take.
  isSelected?: boolean | undefined;
  onSelect?: ((isSelected: boolean) => void) | undefined;
  // Every row of a page whose rows can be selected keeps the box's room.
  hasSelection: boolean;
}

const CampaignRow: FunctionComponent<CampaignRowProps> = (
  props: CampaignRowProps,
): ReactElement => {
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
      {props.hasSelection ? (
        <span className="mt-0.5 flex w-4 flex-shrink-0 justify-center">
          {props.onSelect ? (
            <Checkbox
              value={Boolean(props.isSelected)}
              ariaLabel={translator.translateTemplate(SELECT_ADDRESS_LABEL, {
                address: campaign.sourceIp,
              })}
              isAriaLabelTranslated={true}
              dataTestId={SECURITY_CAMPAIGN_TEST_IDS.selectRow}
              onChange={(isChecked: boolean) => {
                props.onSelect?.(isChecked);
              }}
            />
          ) : (
            <></>
          )}
        </span>
      ) : (
        <></>
      )}
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
          {/*
            An IPv6 address is longer than a phone's row: it wraps inside its
            column rather than run under View requests, and reads left to
            right on a Persian page (an isolate, IsolatedText) - read there
            in the page's direction, "2001:db8::7334" came out as
            "db8::7334:2001".
          */}
          <IsolatedText
            text={getCampaignAddressText(campaign, translator)}
            dataTestId="security-attack-campaign-address"
            className="min-w-0 max-w-full font-mono text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
          />
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
          <AttackKindChips kinds={campaign.attackKinds} />
          <RowBlock row={campaign} value={campaign.sourceIp} />
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
            className="truncate font-mono text-xs text-gray-500"
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
        {props.onBlock && isCampaignSelectable(campaign) ? (
          <Button
            title={BLOCK_ADDRESS_TITLE}
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.Small}
            disabled={props.blockLockReason !== undefined}
            tooltip={props.blockLockReason || undefined}
            dataTestId="security-attack-campaign-block"
            onClick={() => {
              props.onBlock?.(campaign.sourceIp);
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

interface NetworkRowProps {
  network: SecurityAttackNetwork;
  // The window the page read: View requests opens the network's requests over it (#10896).
  startTime: Date;
  endTime: Date;
  // Challenge This Network (#10354), and why it is locked; none without it.
  onChallenge?: ((network: SecurityAttackNetwork) => void) | undefined;
  challengeLockReason?: string | undefined;
}

/*
 * One network a rotating attacker sent from (#10354): by its ASN where
 * Cloudflare's events name one, else its /24 or /48 - how many of its
 * addresses attacked, how far their requests got, which ones, and for an
 * ASN the ranges they came from - with View requests, which opens what the
 * network sent in the events list (#10896), and Challenge This Network.
 */
const NetworkRow: FunctionComponent<NetworkRowProps> = (
  props: NetworkRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const network: SecurityAttackNetwork = props.network;
  const lastSeen: Date | null = network.lastSeen
    ? new Date(network.lastSeen)
    : null;
  const ranges: string | null = writeNetworkRanges({ network, translator });
  const eventsRoute: Route | null = buildCampaignNetworkEventsRoute({
    network,
    startTime: props.startTime,
    endTime: props.endTime,
  });

  return (
    <li
      data-testid={SECURITY_CAMPAIGN_TEST_IDS.networkRow}
      data-network={network.network}
      className="flex items-start gap-3 px-5 py-3 md:px-6"
    >
      <span
        className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style={{
          backgroundColor: getRequestOutcomeColor(
            network.worstOutcome,
          ).toString(),
        }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <IsolatedText
            text={
              network.network ||
              // The requests whose address nobody knew, or a scrub rule hid: said as by address.
              getCampaignAddressText({ ...network, sourceIp: "" }, translator)
            }
            className="min-w-0 max-w-full font-mono text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
          />
          {network.asnName ? (
            <IsolatedText
              text={network.asnName}
              className="min-w-0 max-w-full truncate text-xs text-gray-500"
            />
          ) : (
            <></>
          )}
          {network.network ? (
            <span className="text-xs text-gray-500">
              {writeNetworkAddressCount(network, translator)}
            </span>
          ) : (
            <></>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SecurityEventRequestOutcomePill
            outcome={network.worstOutcome}
            size={PillSize.Small}
          />
          <AttackKindChips kinds={network.attackKinds} />
          <RowBlock row={network} value={network.network} />
          <span className="text-xs text-gray-500">
            {translator.translatePlural(REQUESTS_COUNT, network.requestCount)}
            {lastSeen ? ` · ${OneUptimeDate.fromNow(lastSeen)}` : ""}
          </span>
        </div>

        <OutcomeBar campaign={network} />
        <div className="text-xs text-gray-700">
          {describeCampaignResult(network, translator)}
        </div>

        {network.addresses.length > 0 ? (
          <div className="font-mono text-xs text-gray-500 [overflow-wrap:anywhere]">
            {writeNetworkAddresses({ network, translator })}
          </div>
        ) : (
          <></>
        )}
        {ranges ? <div className="text-xs text-gray-500">{ranges}</div> : <></>}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1 pt-0.5">
        {eventsRoute ? (
          <Link
            to={eventsRoute}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            dataTestId={SECURITY_CAMPAIGN_TEST_IDS.networkRequests}
          >
            {translator.translateText(VIEW_REQUESTS)}
          </Link>
        ) : (
          <></>
        )}
        {props.onChallenge &&
        isNetworkChallengeable(network) &&
        !network.block ? (
          <Button
            title={CHALLENGE_THIS_NETWORK}
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.Small}
            disabled={props.challengeLockReason !== undefined}
            tooltip={props.challengeLockReason || undefined}
            dataTestId={SECURITY_CAMPAIGN_TEST_IDS.challengeNetwork}
            onClick={() => {
              props.onChallenge?.(network);
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

/*
 * The bar above the rows by address (#10354): select every address that
 * can be blocked, how many are selected, and Block Addresses - one action
 * for all of them.
 */
const SelectionBar: FunctionComponent<{
  selectable: Array<string>;
  selected: Array<string>;
  lockReason?: string | undefined;
  onSelectAll: (isSelected: boolean) => void;
  onBlock: () => void;
  onClear: () => void;
}> = (props: {
  selectable: Array<string>;
  selected: Array<string>;
  lockReason?: string | undefined;
  onSelectAll: (isSelected: boolean) => void;
  onBlock: () => void;
  onClear: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const count: number = props.selected.length;
  const isEverySelected: boolean =
    count > 0 && count === props.selectable.length;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 px-5 py-2 md:px-6"
      data-testid={SECURITY_CAMPAIGN_TEST_IDS.selectionBar}
    >
      <span className="flex w-4 flex-shrink-0 justify-center">
        <Checkbox
          value={isEverySelected}
          isIndeterminate={count > 0 && !isEverySelected}
          ariaLabel={translator.translateText(SELECT_ALL_LABEL)}
          isAriaLabelTranslated={true}
          dataTestId={SECURITY_CAMPAIGN_TEST_IDS.selectAll}
          onChange={(isChecked: boolean) => {
            props.onSelectAll(isChecked);
          }}
        />
      </span>
      <span className="min-w-0 flex-1 text-sm text-gray-700" aria-live="polite">
        {count > 0
          ? writeSelectedCount(count, translator)
          : translator.translateText(SELECT_TO_BLOCK_HINT)}
      </span>
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            title={CLEAR_SELECTION}
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.Small}
            dataTestId={SECURITY_CAMPAIGN_TEST_IDS.clearSelection}
            onClick={props.onClear}
          />
          <Button
            title={BLOCK_ADDRESSES}
            icon={IconProp.NoSymbol}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            disabled={props.lockReason !== undefined}
            tooltip={props.lockReason || undefined}
            dataTestId={SECURITY_CAMPAIGN_TEST_IDS.blockAddresses}
            onClick={props.onBlock}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * Who is attacking the project, one row per address: a scanner that sent
 * a hundred probes is one row, not a hundred, and the rows whose requests
 * got through - reached a handler, broke something, ran in the database -
 * come first, so the page answers "did anything work?" at a glance.
 *
 * Grouped by network (#10354), one row per network the addresses came
 * from, with Challenge This Network; by address, the rows a person may
 * block can be selected and blocked in one go (Block Addresses).
 */
const SecurityAttackCampaigns: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledBodyClassName: string = useCardRuledBodyClassName();
  const [campaignWindow, setCampaignWindow] = useState<CampaignWindow>(
    DEFAULT_CAMPAIGN_WINDOW,
  );
  const [isByNetwork, setIsByNetwork] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<LoadedRows | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  // The address Block Address is open for, from its row (#10342).
  const [blocking, setBlocking] = useState<string | null>(null);
  // The addresses ticked for Block Addresses, and whether its dialog is open (#10354).
  const [selected, setSelected] = useState<Array<string>>([]);
  const [isBlockingSelected, setIsBlockingSelected] = useState<boolean>(false);
  // The network Challenge This Network is open for (#10354).
  const [challenging, setChallenging] = useState<SecurityAttackNetwork | null>(
    null,
  );
  const blockGate: PermissionGateResult = PermissionGate.check(
    new SecurityBlock(),
    ModelAction.Create,
  );
  const blockLockReason: string | undefined = blockGate.isAllowed
    ? undefined
    : blockGate.disabledReason || "";

  const load: (
    selectedWindow: CampaignWindow,
    byNetwork: boolean,
  ) => Promise<void> = useCallback(
    async (
      selectedWindow: CampaignWindow,
      byNetwork: boolean,
    ): Promise<void> => {
      const range: { startTime: Date; endTime: Date } = getCampaignWindowRange(
        selectedWindow,
        OneUptimeDate.getCurrentDate(),
      );

      setIsLoading(true);
      setError("");

      try {
        if (byNetwork) {
          const result: SecurityAttackNetworksResult =
            await getAttackNetworks(range);

          setLoaded({
            isByNetwork: true,
            result,
            startTime: new Date(result.startTime),
            endTime: new Date(result.endTime),
          });
        } else {
          const result: SecurityAttackCampaignsResult =
            await SecurityCaseApi.getAttackCampaigns(range);

          setLoaded({
            isByNetwork: false,
            result,
            startTime: new Date(result.startTime),
            endTime: new Date(result.endTime),
          });
          // A row a block now holds, or one gone from the window, is no longer selected.
          setSelected((current: Array<string>) => {
            return keepSelectable({
              selected: current,
              campaigns: result.campaigns,
            });
          });
        }
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
    void load(campaignWindow, isByNetwork);
  }, [campaignWindow, isByNetwork]);

  const campaigns: Array<SecurityAttackCampaign> =
    loaded && !loaded.isByNetwork ? loaded.result.campaigns : [];
  const networks: Array<SecurityAttackNetwork> =
    loaded && loaded.isByNetwork ? loaded.result.networks : [];
  const summary: CampaignsSummary = summarizeCampaigns(
    loaded?.isByNetwork ? [] : campaigns,
  );
  const selectable: Array<string> = getSelectableAddresses(campaigns);
  const hasSelection: boolean =
    blockLockReason === undefined && selectable.length > 0;

  let body: ReactElement;

  if (isLoading) {
    body = <CardListSkeleton />;
  } else if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void load(campaignWindow, isByNetwork);
        }}
      />
    );
  } else if (
    !loaded ||
    (loaded.isByNetwork ? networks.length === 0 : campaigns.length === 0)
  ) {
    body = (
      <EmptyState
        id="security-attack-campaigns-empty"
        icon={IconProp.ShieldCheck}
        title={translator.translateText(NO_CAMPAIGNS_TITLE) || ""}
        description={translator.translateText(NO_CAMPAIGNS_DESCRIPTION) || ""}
      />
    );
  } else if (loaded.isByNetwork) {
    let requests: number = 0;
    let gotThrough: number = 0;
    let addresses: number = 0;

    for (const network of networks) {
      requests += network.requestCount;
      gotThrough += getCampaignGotThroughCount(network);
      addresses += network.addressCount;
    }

    body = (
      <div>
        <div className="flex flex-wrap gap-6 border-b border-gray-100 px-5 py-3 md:px-6">
          <SummaryFigure label={NETWORKS_LABEL} value={networks.length} />
          <SummaryFigure label={ATTACKERS_LABEL} value={addresses} />
          <SummaryFigure label={ATTACK_REQUESTS_LABEL} value={requests} />
          <SummaryFigure
            label={GOT_THROUGH_LABEL}
            value={gotThrough}
            isAlarming={gotThrough > 0}
          />
        </div>
        <ul className="divide-y divide-gray-100">
          {networks.map((network: SecurityAttackNetwork): ReactElement => {
            return (
              <NetworkRow
                key={`${network.kind}:${network.network}`}
                network={network}
                startTime={loaded.startTime}
                endTime={loaded.endTime}
                challengeLockReason={blockLockReason}
                onChallenge={(picked: SecurityAttackNetwork) => {
                  setChallenging(picked);
                }}
              />
            );
          })}
        </ul>
        {loaded.result.isTruncated && (
          <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-500 md:px-6">
            {translator.translateTemplate(NETWORKS_TRUNCATED, {
              count: translator.formatNumber(
                SECURITY_ATTACK_NETWORK_ADDRESSES_MAX,
              ),
            })}
          </p>
        )}
      </div>
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
        {hasSelection ? (
          <SelectionBar
            selectable={selectable}
            selected={selected}
            lockReason={blockLockReason}
            onSelectAll={(isSelected: boolean) => {
              setSelected(isSelected ? selectable : []);
            }}
            onBlock={() => {
              setIsBlockingSelected(true);
            }}
            onClear={() => {
              setSelected([]);
            }}
          />
        ) : (
          <></>
        )}
        <ul className="divide-y divide-gray-100">
          {campaigns.map((campaign: SecurityAttackCampaign): ReactElement => {
            const isSelectable: boolean =
              hasSelection && isCampaignSelectable(campaign);

            return (
              <CampaignRow
                key={campaign.sourceIp || "unknown"}
                campaign={campaign}
                startTime={loaded.startTime}
                endTime={loaded.endTime}
                blockLockReason={blockLockReason}
                hasSelection={hasSelection}
                isSelected={selected.includes(campaign.sourceIp)}
                onSelect={
                  isSelectable
                    ? (isSelected: boolean) => {
                        setSelected((current: Array<string>) => {
                          return isSelected
                            ? [...current, campaign.sourceIp]
                            : current.filter((address: string) => {
                                return address !== campaign.sourceIp;
                              });
                        });
                      }
                    : undefined
                }
                onBlock={(address: string) => {
                  setBlocking(address);
                }}
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
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <Toggle
              title={GROUP_BY_NETWORK}
              tooltip={GROUP_BY_NETWORK_DESCRIPTION}
              value={isByNetwork}
              dataTestId={SECURITY_CAMPAIGN_TEST_IDS.groupByNetwork}
              onChange={(value: boolean) => {
                setIsByNetwork(value);
                setSelected([]);
              }}
            />
            <WindowPicker
              selected={campaignWindow}
              onChange={(selectedWindow: CampaignWindow) => {
                setCampaignWindow(selectedWindow);
                setSelected([]);
              }}
            />
          </div>
        }
      >
        {/*
         * Edge to edge under a rule below the header, as a list in a card
         * is (Card/CardSurface): the card's own padding cancelled on three
         * sides.
         */}
        <div className={ruledBodyClassName}>{body}</div>
      </Card>
      {blocking ? (
        <BlockAddressModal
          initialValue={blocking}
          onClose={() => {
            setBlocking(null);
          }}
          onBlocked={() => {
            setBlocking(null);
            void load(campaignWindow, isByNetwork);
          }}
        />
      ) : (
        <></>
      )}
      {isBlockingSelected ? (
        <BlockCampaignsModal
          addresses={selected}
          requestCounts={Object.fromEntries(
            campaigns.map((campaign: SecurityAttackCampaign) => {
              return [campaign.sourceIp, campaign.requestCount];
            }),
          )}
          onClose={() => {
            setIsBlockingSelected(false);
          }}
          onBlocked={() => {
            setIsBlockingSelected(false);
            setSelected([]);
            void load(campaignWindow, isByNetwork);
          }}
        />
      ) : (
        <></>
      )}
      {challenging && loaded ? (
        <ChallengeNetworkModal
          network={challenging}
          window={{ startTime: loaded.startTime, endTime: loaded.endTime }}
          onClose={() => {
            setChallenging(null);
          }}
          onChallenged={() => {
            setChallenging(null);
            void load(campaignWindow, isByNetwork);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityAttackCampaigns;
