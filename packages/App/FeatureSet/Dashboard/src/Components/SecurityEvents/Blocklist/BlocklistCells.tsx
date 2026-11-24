import AppLink from "../../AppLink/AppLink";
import UserElement from "../../User/User";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  BLOCKED_LABEL,
  BLOCKLIST_TEST_IDS,
  CHALLENGED_LABEL,
  ENFORCEMENT_TOOLTIPS,
  EVERY_MACHINE_LABEL,
  EVERY_MACHINE_TOOLTIP,
  QUARANTINED_LABEL,
  EXPIRED_LABEL,
  LIFTED_LABEL,
  NOT_ENFORCED_LABEL,
  NOT_ENFORCED_TOOLTIP,
  SOURCE_LABELS,
  UNTIL_LIFTED_LABEL,
} from "./BlocklistCopy";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "Common/Models/DatabaseModels/SecurityBlockEnforcement";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockReach,
  SecurityBlockSource,
  SecurityBlockState,
  isSecurityBlockAddressType,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
  SecurityBlockEnforcementView,
  getSecurityBlockEnforcementView,
} from "Common/Types/SecurityBlocklist/SecurityBlockEnforcement";
import { FEED_ENFORCEMENT_TOOLTIPS } from "../BlocklistFeeds/BlocklistFeedsCopy";
import { BLOCKED_BY_POLICY } from "../AutomaticResponse/AutomaticResponseCopy";
import { getPolicyDisplayName } from "../AutomaticResponse/AutomaticResponseModel";
import { SecurityAutomaticResponsePolicyKind } from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { formatCompactDurationInMinutes } from "../../../Utils/CompactDuration";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import {
  SecurityBlockReason,
  readSecurityBlockReason,
  wordSecurityBlockReason,
} from "Common/Types/SecurityBlocklist/SecurityBlockReason";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The cells of Security Events > Playbooks > Blocklist (#10338): what a row
 * blocks and why, its action, where it is enforced - a chip per destination
 * with where the block stands there - when it ends, its case, and who or
 * what added it.
 */

// The tone a destination's chip takes for where the block stands there.
export function getEnforcementTone(
  view: SecurityBlockEnforcementView,
): PillTone {
  switch (view) {
    case SecurityBlockEnforcementView.Enforced:
      return PillTone.Success;
    case SecurityBlockEnforcementView.Pending:
    case SecurityBlockEnforcementView.Removing:
      return PillTone.Info;
    case SecurityBlockEnforcementView.Unconfirmed:
      return PillTone.Warning;
    case SecurityBlockEnforcementView.NotApplied:
      return PillTone.Danger;
    default:
      return PillTone.Neutral;
  }
}

// What a destination's chip says on hover, in the reader's language.
export function writeEnforcementTooltip(
  translator: Translator,
  enforcement: SecurityBlockEnforcement,
  now: Date,
  blockCreatedAt?: Date | string | undefined,
): string {
  const view: SecurityBlockEnforcementView = getSecurityBlockEnforcementView(
    enforcement,
    now,
  );

  // A row applied and never read back is waiting for its read, as a new one is.
  const shown: SecurityBlockEnforcementView =
    view === SecurityBlockEnforcementView.Unconfirmed &&
    !enforcement.lastConfirmedAt
      ? SecurityBlockEnforcementView.Pending
      : view;

  /*
   * A feed is fetched, never written to (#10345): its chip says when a
   * firewall fetched the block - "2 min after it was made" - and last
   * fetched it, or that a firewall has yet to.
   */
  const feedTooltip: string | null =
    enforcement.provider === SecurityBlockDestinationProvider.Feed
      ? writeFeedEnforcementTooltip({
          translator,
          enforcement,
          view: shown,
          blockCreatedAt,
        })
      : null;

  if (feedTooltip) {
    return feedTooltip;
  }

  // Why, in the reader's words where the destination said it as a sentence (#10629).
  const reason: SecurityBlockReason | null = readSecurityBlockReason(
    enforcement.errorReason,
  );

  return translator.translateTemplate(ENFORCEMENT_TOOLTIPS[shown], {
    destination: enforcement.destinationName || "",
    time: enforcement.lastConfirmedAt
      ? OneUptimeDate.fromNow(new Date(enforcement.lastConfirmedAt))
      : "",
    reason: reason
      ? composedValue((words: Translator): string => {
          return wordSecurityBlockReason(reason, words);
        })
      : enforcement.error || "",
  });
}

// What a feed's chip says, or null to say it as any destination's chip does.
function writeFeedEnforcementTooltip(data: {
  translator: Translator;
  enforcement: SecurityBlockEnforcement;
  view: SecurityBlockEnforcementView;
  blockCreatedAt: Date | string | undefined;
}): string | null {
  const template: string | undefined = FEED_ENFORCEMENT_TOOLTIPS[data.view];

  if (!template) {
    return null;
  }

  const appliedAt: number | null = data.enforcement.appliedAt
    ? new Date(data.enforcement.appliedAt).getTime()
    : null;
  const createdAt: number | null = data.blockCreatedAt
    ? new Date(data.blockCreatedAt).getTime()
    : null;

  // How long after the block a firewall first fetched it, in whole minutes.
  const delay: string | null =
    appliedAt !== null && createdAt !== null
      ? formatCompactDurationInMinutes(
          Math.max(1, Math.round((appliedAt - createdAt) / (60 * 1000))),
          data.translator.language,
        )
      : null;

  if (data.view === SecurityBlockEnforcementView.Enforced && !delay) {
    return null;
  }

  return data.translator.translateTemplate(template, {
    destination: data.enforcement.destinationName || "",
    delay: delay || "",
    time: data.enforcement.lastConfirmedAt
      ? OneUptimeDate.fromNow(new Date(data.enforcement.lastConfirmedAt))
      : "",
  });
}

export interface AddressCellProps {
  block: SecurityBlock;
}

/*
 * What is blocked, as code - an address or a range, a domain, a URL, a
 * file's hash - with why it was blocked under it, and an address blocked
 * on every machine too saying so (#10346).
 */
export const BlockAddressCell: FunctionComponent<AddressCellProps> = (
  props: AddressCellProps,
): ReactElement => {
  const isEveryMachine: boolean =
    isSecurityBlockAddressType(props.block.indicatorType) &&
    props.block.reach === SecurityBlockReach.Everywhere;

  return (
    <div data-testid={BLOCKLIST_TEST_IDS.addressCell}>
      <span className="break-all font-mono text-sm text-gray-900">
        {props.block.value || ""}
      </span>
      {isEveryMachine ? (
        <span className="ml-2 inline-block align-middle">
          <Pill
            text={EVERY_MACHINE_LABEL}
            tooltip={EVERY_MACHINE_TOOLTIP}
            tone={PillTone.Neutral}
            isDotHidden={true}
          />
        </span>
      ) : (
        <></>
      )}
      {props.block.reason ? (
        <span className="mt-0.5 block text-xs text-gray-500">
          <IsolatedText text={props.block.reason} />
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * Blocked, Challenged, or - a file - Blocked and quarantined: what someone
 * chose to do, a plain fact, so never red (Docs/ux: red is for what broke).
 */
export const BlockActionCell: FunctionComponent<AddressCellProps> = (
  props: AddressCellProps,
): ReactElement => {
  const text: string =
    props.block.action === SecurityBlockAction.Challenge
      ? CHALLENGED_LABEL
      : props.block.action === SecurityBlockAction.BlockAndQuarantine
        ? QUARANTINED_LABEL
        : BLOCKED_LABEL;

  return <Pill text={text} tone={PillTone.Neutral} isDotHidden={true} />;
};

export interface EnforcedAtCellProps {
  block: SecurityBlock;
  enforcements: Array<SecurityBlockEnforcement>;
  now: Date;
}

/*
 * One chip per destination, named as the destination is, and toned by
 * where the block stands there. An active block nothing holds says so in
 * a chip of its own: not enforced is not done.
 */
export const BlockEnforcedAtCell: FunctionComponent<EnforcedAtCellProps> = (
  props: EnforcedAtCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isActive: boolean = props.block.state === SecurityBlockState.Active;

  const shown: Array<SecurityBlockEnforcement> = props.enforcements.filter(
    (enforcement: SecurityBlockEnforcement): boolean => {
      // An ended block's destinations that let it go say nothing more.
      return (
        isActive || enforcement.state !== SecurityBlockEnforcementState.Removed
      );
    },
  );

  const holds: boolean = shown.some(
    (enforcement: SecurityBlockEnforcement): boolean => {
      return (
        getSecurityBlockEnforcementView(enforcement, props.now) ===
        SecurityBlockEnforcementView.Enforced
      );
    },
  );

  if (shown.length === 0 && !isActive) {
    return <TableEmptyValue />;
  }

  return (
    <div
      className="flex flex-wrap gap-1"
      data-testid={BLOCKLIST_TEST_IDS.enforcedAtCell}
    >
      {isActive && !holds ? (
        <Pill
          text={NOT_ENFORCED_LABEL}
          tone={PillTone.Warning}
          tooltip={NOT_ENFORCED_TOOLTIP}
          dataTestId={BLOCKLIST_TEST_IDS.notEnforced}
        />
      ) : (
        <></>
      )}
      {shown.map((enforcement: SecurityBlockEnforcement): ReactElement => {
        const view: SecurityBlockEnforcementView =
          getSecurityBlockEnforcementView(enforcement, props.now);

        return (
          <Pill
            key={enforcement.destinationKey || enforcement.id?.toString()}
            text={enforcement.destinationName || ""}
            isUserContent={true}
            tone={getEnforcementTone(view)}
            tooltip={writeEnforcementTooltip(
              translator,
              enforcement,
              props.now,
              props.block.createdAt,
            )}
            isTooltipUserContent={true}
          />
        );
      })}
    </div>
  );
};

/*
 * When an active block ends - how far off, with the moment under the
 * pointer - or that it stays until someone lifts it; an ended block, how it
 * ended.
 */
export const BlockExpiresCell: FunctionComponent<AddressCellProps> = (
  props: AddressCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.block.state === SecurityBlockState.Lifted) {
    return <Pill text={LIFTED_LABEL} tone={PillTone.Paused} />;
  }

  if (props.block.state === SecurityBlockState.Expired) {
    return <Pill text={EXPIRED_LABEL} tone={PillTone.Paused} />;
  }

  if (!props.block.expiresAt) {
    return (
      <span
        className="text-sm text-gray-700"
        data-testid={BLOCKLIST_TEST_IDS.expiresCell}
      >
        {translator.translateText(UNTIL_LIFTED_LABEL)}
      </span>
    );
  }

  const expiresAt: Date = new Date(props.block.expiresAt);

  return (
    <span
      className="whitespace-nowrap text-sm text-gray-700"
      title={OneUptimeDate.getDateAsLocalShortDateTimeString(expiresAt)}
      data-testid={BLOCKLIST_TEST_IDS.expiresCell}
    >
      {OneUptimeDate.fromNow(expiresAt)}
    </span>
  );
};

// The case the block was made for, by its number.
export const BlockCaseCell: FunctionComponent<AddressCellProps> = (
  props: AddressCellProps,
): ReactElement => {
  if (!props.block.securityCaseId) {
    return <TableEmptyValue />;
  }

  return (
    <AppLink
      to={RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
        { modelId: new ObjectID(props.block.securityCaseId.toString()) },
      )}
      className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
    >
      {props.block.securityCase?.caseNumberWithPrefix ||
        props.block.securityCaseId.toString().slice(0, 8)}
    </AppLink>
  );
};

// The person who blocked it, or what did when no person did.
export const BlockAddedByCell: FunctionComponent<AddressCellProps> = (
  props: AddressCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const source: SecurityBlockSource =
    props.block.source || SecurityBlockSource.Person;

  if (source === SecurityBlockSource.Person) {
    return props.block.createdByUser ? (
      <UserElement user={props.block.createdByUser} hideEmail={true} />
    ) : (
      <TableEmptyValue />
    );
  }

  // An automatic response policy's block names the policy: "Scanners policy" (#10350).
  const policyName: string = props.block.securityAutomaticResponsePolicy?.name
    ? getPolicyDisplayName(
        {
          kind:
            props.block.securityAutomaticResponsePolicy.kind ||
            SecurityAutomaticResponsePolicyKind.Custom,
          name: props.block.securityAutomaticResponsePolicy.name,
        },
        translator,
      )
    : "";

  if (source === SecurityBlockSource.AutomaticResponse && policyName) {
    return (
      <span className="text-sm text-gray-700">
        {translator.translateTemplate(
          BLOCKED_BY_POLICY,
          { name: policyName },
          { setsValuesApart: true },
        )}
      </span>
    );
  }

  return (
    <span className="text-sm text-gray-700">
      {translator.translateText(SOURCE_LABELS[source])}
    </span>
  );
};
