import AppLink from "../../AppLink/AppLink";
import UserElement from "../../User/User";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  BLOCKED_LABEL,
  BLOCKLIST_TEST_IDS,
  CHALLENGED_LABEL,
  ENFORCEMENT_TOOLTIPS,
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
  SecurityBlockSource,
  SecurityBlockState,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockEnforcementState,
  SecurityBlockEnforcementView,
  getSecurityBlockEnforcementView,
} from "Common/Types/SecurityBlocklist/SecurityBlockEnforcement";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
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
): string {
  const view: SecurityBlockEnforcementView = getSecurityBlockEnforcementView(
    enforcement,
    now,
  );

  return translator.translateTemplate(ENFORCEMENT_TOOLTIPS[view], {
    destination: enforcement.destinationName || "",
    time: enforcement.lastConfirmedAt
      ? OneUptimeDate.fromNow(new Date(enforcement.lastConfirmedAt))
      : "",
    reason: enforcement.error || "",
  });
}

export interface AddressCellProps {
  block: SecurityBlock;
}

// The address or range, as code, with why it was blocked under it.
export const BlockAddressCell: FunctionComponent<AddressCellProps> = (
  props: AddressCellProps,
): ReactElement => {
  return (
    <div data-testid={BLOCKLIST_TEST_IDS.addressCell}>
      <span className="break-all font-mono text-sm text-gray-900">
        {props.block.value || ""}
      </span>
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

// Blocked or Challenged.
export const BlockActionCell: FunctionComponent<AddressCellProps> = (
  props: AddressCellProps,
): ReactElement => {
  const isChallenge: boolean =
    props.block.action === SecurityBlockAction.Challenge;

  return (
    <Pill
      text={isChallenge ? CHALLENGED_LABEL : BLOCKED_LABEL}
      tone={isChallenge ? PillTone.Warning : PillTone.Danger}
      isDotHidden={true}
    />
  );
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

  return (
    <span className="text-sm text-gray-700">
      {translator.translateText(SOURCE_LABELS[source])}
    </span>
  );
};
