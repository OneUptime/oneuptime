import { SensitivityPill } from "./DataSecurityPills";
import IssueMoment from "./IssueMoment";
import { getStoreProviderName } from "./StoreFieldOptions";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityIdentity from "Common/Models/DatabaseModels/DataSecurityIdentity";
import Route from "Common/Types/API/Route";
import {
  Gray500,
  Orange500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import { DataStoreProvider } from "Common/Types/DataSecurity/DataStoreKind";
import ObjectID from "Common/Types/ObjectID";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW AN IDENTITY READS IN A LIST AND ON ITS PAGE.
 *
 * Its name first, as people know it, and its principal under it as its
 * cloud writes it - an ARN, an account id, a service account's email -
 * unless that is the name again or means nothing to a reader (a service's
 * id, "*"). Then what matters most about it, as chips: anyone on the
 * internet, outside your accounts, not used in 90 days, seen in traces.
 * What it reaches reads as the most sensitive data it reaches and how many
 * stores; the most it may do as a level, red for Admin as everywhere.
 */

export const ACCESS_LEVEL_COLOR: Readonly<Record<string, Color>> = {
  [DataStoreAccessLevel.Admin]: Red500,
  [DataStoreAccessLevel.Write]: Orange500,
  [DataStoreAccessLevel.Read]: Yellow500,
};

export const ANYONE_ON_THE_INTERNET: string = translationKey(
  "Anyone on the internet",
);
export const OUTSIDE_YOUR_ACCOUNTS: string = translationKey(
  "Outside your accounts",
);
export const NOT_USED_IN_90_DAYS: string = translationKey(
  "Not used in 90 days",
);
export const SEEN_IN_TRACES: string = translationKey("Seen in traces");

const STORES_REACHED: PluralTemplate = {
  one: "{{count}} store",
  other: "{{count}} stores",
};
const RESTRICTED_STORES: PluralTemplate = {
  one: "{{count}} with Restricted data",
  other: "{{count}} with Restricted data",
};
const CAN_CHANGE_SENSITIVE_DATA: string = translationKey(
  "Can change sensitive data",
);

// The identity's own page.
export function getDataSecurityIdentityRoute(
  identityId: ObjectID | string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_IDENTITY_VIEW] as Route,
    { modelId: new ObjectID(identityId.toString()) },
  );
}

// The name people know an identity by.
export function getIdentityName(identity: DataSecurityIdentity): string {
  return identity.principalName || identity.principal || "";
}

/*
 * Whether the principal says more than the name: never for anyone on the
 * internet, nor for a service seen in traces, whose principal is its id.
 */
export function showsPrincipal(identity: DataSecurityIdentity): boolean {
  return (
    Boolean(identity.principal) &&
    identity.principal !== identity.principalName &&
    identity.principalType !== DataStorePrincipalType.Public &&
    identity.provider !== DataStoreProvider.OneUptime
  );
}

export const IdentityChips: FunctionComponent<{
  identity: DataSecurityIdentity;
}> = (props: { identity: DataSecurityIdentity }): ReactElement => {
  const identity: DataSecurityIdentity = props.identity;
  const chips: Array<ReactElement> = [];

  if (identity.isPublic) {
    chips.push(
      <Pill key="public" text={ANYONE_ON_THE_INTERNET} color={Red500} />,
    );
  } else if (identity.isExternal) {
    chips.push(
      <Pill key="external" text={OUTSIDE_YOUR_ACCOUNTS} color={Orange500} />,
    );
  }

  if (identity.isUnused) {
    chips.push(
      <Pill key="unused" text={NOT_USED_IN_90_DAYS} color={Gray500} />,
    );
  }

  if (identity.isSeenInTraces) {
    chips.push(<Pill key="traced" text={SEEN_IN_TRACES} color={Gray500} />);
  }

  if (chips.length === 0) {
    return <></>;
  }

  return <div className="mt-1 flex flex-wrap gap-1">{chips}</div>;
};

export const IdentityNameCell: FunctionComponent<{
  identity: DataSecurityIdentity;
}> = (props: { identity: DataSecurityIdentity }): ReactElement => {
  const translator: Translator = useTranslator();
  const identity: DataSecurityIdentity = props.identity;
  const kind: string = [
    identity.principalType
      ? translator.translateText(identity.principalType) ||
        identity.principalType
      : "",
    identity.provider && identity.provider !== DataStoreProvider.OneUptime
      ? translator.translateText(getStoreProviderName(identity.provider)) ||
        getStoreProviderName(identity.provider)
      : "",
  ]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" · ");

  return (
    <div className="min-w-[12rem]" data-testid="data-security-identity-name">
      <div className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
        <IsolatedText text={getIdentityName(identity)} />
      </div>
      {showsPrincipal(identity) ? (
        <div className="font-mono text-xs text-gray-500 [overflow-wrap:anywhere]">
          <IsolatedText text={identity.principal || ""} />
        </div>
      ) : (
        <></>
      )}
      {kind ? <div className="text-xs text-gray-500">{kind}</div> : <></>}
      <IdentityChips identity={identity} />
    </div>
  );
};

export const IdentityReachCell: FunctionComponent<{
  identity: DataSecurityIdentity;
}> = (props: { identity: DataSecurityIdentity }): ReactElement => {
  const translator: Translator = useTranslator();
  const identity: DataSecurityIdentity = props.identity;
  const restricted: number = identity.restrictedStoreCount || 0;

  return (
    <div className="flex flex-col items-start gap-0.5">
      <SensitivityPill sensitivity={identity.highestSensitivity} />
      <span className="whitespace-nowrap text-xs text-gray-500">
        {translator.translatePlural(STORES_REACHED, identity.storeCount || 0)}
      </span>
      {restricted > 0 ? (
        <span className="whitespace-nowrap text-xs text-gray-500">
          {translator.translatePlural(RESTRICTED_STORES, restricted)}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export const AccessLevelPill: FunctionComponent<{
  level: string | undefined;
}> = (props: { level: string | undefined }): ReactElement => {
  if (!props.level) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  return (
    <Pill
      text={props.level}
      color={ACCESS_LEVEL_COLOR[props.level] || Gray500}
    />
  );
};

export const IdentityLevelCell: FunctionComponent<{
  identity: DataSecurityIdentity;
}> = (props: { identity: DataSecurityIdentity }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="flex flex-col items-start gap-0.5">
      <AccessLevelPill level={props.identity.highestAccessLevel} />
      {props.identity.canChangeSensitiveData ? (
        <span className="whitespace-nowrap text-xs text-gray-500">
          {translator.translateText(CAN_CHANGE_SENSITIVE_DATA)}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export const IdentityLastUsedCell: FunctionComponent<{
  identity: DataSecurityIdentity;
}> = (props: { identity: DataSecurityIdentity }): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.identity.lastUsedAt && props.identity.isUnused) {
    return (
      <span className="whitespace-nowrap text-sm text-gray-700">
        {translator.translateText(NOT_USED_IN_90_DAYS)}
      </span>
    );
  }

  return <IssueMoment value={props.identity.lastUsedAt} />;
};
