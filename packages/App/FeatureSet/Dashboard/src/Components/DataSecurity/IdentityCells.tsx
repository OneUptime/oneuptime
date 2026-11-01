import { SensitivityPill } from "./DataSecurityPills";
import IssueMoment from "./IssueMoment";
import { getStoreProviderName } from "./StoreFieldOptions";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityIdentity from "Common/Models/DatabaseModels/DataSecurityIdentity";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import Route from "Common/Types/API/Route";
import { getDataSecurityIdentityKey } from "Common/Types/DataSecurity/DataSecurityIdentity";
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
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PluralTemplate,
  Translator,
  translateText,
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

/*
 * The Last Used tile on an identity's page: when it was last used, and
 * under it whether that is inside the 90 days the unused-access check
 * counts - or, with no date, why there is none. A cloud says nothing of
 * anyone on the internet, nor of an account outside, so "Unknown" there
 * is the answer, not a gap.
 */
export const USED_IN_90_DAYS: string = translationKey(
  "Used in the last 90 days",
);
export const NO_RECORDED_USE: string = translationKey(
  "Its cloud has no record of its use",
);
export const LAST_USE_NOT_REPORTED: string = translationKey(
  "Its cloud does not say when it was last used",
);
export const UNKNOWN_USE: string = translationKey("Unknown");

// Under the Last Used tile's value: what that value means.
export function lastUsedNote(identity: DataSecurityIdentity): string {
  if (identity.lastUsedAt) {
    return identity.isUnused ? NOT_USED_IN_90_DAYS : USED_IN_90_DAYS;
  }

  return identity.isUnused ? NO_RECORDED_USE : LAST_USE_NOT_REPORTED;
}

export const OPEN_SERVICE: string = translationKey("Open service");

/*
 * The service page of a service seen in traces: its principal is its id
 * (DataSecurityTracedAccess). One the service map named but OneUptime
 * holds no record of goes by "service:<name>", and has no page.
 */
export function getTracedServiceRoute(
  identity: DataSecurityIdentity,
): Route | null {
  if (
    !identity.isSeenInTraces ||
    identity.principalType !== DataStorePrincipalType.Service ||
    !ObjectID.isValidUUID(identity.principal || "")
  ) {
    return null;
  }

  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SERVICE_VIEW] as Route,
    { modelId: new ObjectID(identity.principal || "") },
  );
}

// The identity's own page.
export function getDataSecurityIdentityRoute(
  identityId: ObjectID | string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_IDENTITY_VIEW] as Route,
    { modelId: new ObjectID(identityId.toString()) },
  );
}

// Said when a grant's identity is not worked out yet: the next evaluation does it.
export const IDENTITY_NOT_READY: string = translationKey(
  "This identity's page is not ready yet. It is worked out each time the stores are evaluated.",
);

/*
 * The page of the identity a grant belongs to - every other store it
 * reaches, and why it ranks where it does: one identity per principal in a
 * project (DataSecurityIdentities), found by its key. A grant's row opens
 * it, on Access and on a store's Who Can Reach It.
 */
export async function getAccessIdentityRoute(
  access: DataStoreAccess,
): Promise<Route> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const result: ListResult<DataSecurityIdentity> =
    await ModelAPI.getList<DataSecurityIdentity>({
      modelType: DataSecurityIdentity,
      query: {
        ...(projectId ? { projectId: projectId } : {}),
        identityKey: getDataSecurityIdentityKey(access.principal || ""),
      },
      limit: 1,
      skip: 0,
      select: { _id: true },
      sort: {},
    });
  const identityId: string | undefined = result.data[0]?._id?.toString();

  if (!identityId) {
    throw new BadDataException(
      translateText(IDENTITY_NOT_READY) || IDENTITY_NOT_READY,
    );
  }

  return getDataSecurityIdentityRoute(identityId);
}

// Whether the reader may open identities: a grant's row opens one only then.
export function canOpenIdentities(): boolean {
  return PermissionGate.check(new DataSecurityIdentity(), ModelAction.Read)
    .isAllowed;
}

// The name people know an identity by.
export function getIdentityName(identity: DataSecurityIdentity): string {
  return identity.principalName || identity.principal || "";
}

// What an identity, or one of its grants, is called and what it is.
export interface PrincipalNames {
  principal?: string | undefined;
  principalName?: string | undefined;
  principalType?: string | undefined;
  provider?: string | undefined;
  isPublic?: boolean | undefined;
  isSeenInTraces?: boolean | undefined;
}

/*
 * Whether the principal says more than the name, as a second line under
 * it: only beside a name of its own (without one, the principal is the
 * name), and never for anyone on the internet ("*"), nor for a service
 * seen in traces, whose principal is its id - the same rule on Access, an
 * identity's page and a store's Who Can Reach It.
 */
export function showsPrincipal(entry: PrincipalNames): boolean {
  return (
    Boolean(entry.principal) &&
    Boolean(entry.principalName) &&
    entry.principal !== entry.principalName &&
    !entry.isPublic &&
    entry.principalType !== DataStorePrincipalType.Public &&
    entry.provider !== DataStoreProvider.OneUptime &&
    !(
      entry.isSeenInTraces &&
      entry.principalType === DataStorePrincipalType.Service
    )
  );
}

/*
 * Where a principal may break across lines: after each ":" and "/" that
 * something follows - "arn:aws:iam::123456789012:" / "role/" /
 * "legacy-etl" - rather than at whatever letter fills the line.
 */
export function splitPrincipal(principal: string): Array<string> {
  const parts: Array<string> = [];
  let current: string = "";

  for (let index: number = 0; index < principal.length; index++) {
    const character: string = principal.charAt(index);
    const next: string = principal.charAt(index + 1);

    current += character;

    if (
      (character === ":" || character === "/") &&
      next !== "" &&
      next !== ":" &&
      next !== "/"
    ) {
      parts.push(current);
      current = "";
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

/*
 * A principal as its cloud writes it - an ARN, an account id, an email -
 * in the monospace identifiers read in, left to right in any page. On the
 * isolate itself: the Dashboard sets Inter on every element (index.ejs),
 * which an inner element would take over a class on its holder.
 */
export const PrincipalText: FunctionComponent<{
  principal: string;
  className?: string | undefined;
}> = (props: {
  principal: string;
  className?: string | undefined;
}): ReactElement => {
  const parts: Array<string> = splitPrincipal(props.principal);

  return (
    <bdi dir="ltr" className={`font-mono ${props.className || ""}`.trim()}>
      {parts.map((part: string, index: number): ReactElement => {
        return (
          <React.Fragment key={index}>
            {part}
            {index < parts.length - 1 ? <wbr /> : <></>}
          </React.Fragment>
        );
      })}
    </bdi>
  );
};

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
        <div className="text-xs text-gray-500 [overflow-wrap:anywhere]">
          <PrincipalText principal={identity.principal || ""} />
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

/*
 * What grants an entry its access, as its cloud's settings say it - a
 * bucket policy, an IAM policy, a role it may assume. A service seen
 * calling the store has no grant to name: it says "Seen in traces", in the
 * reader's language, where the server's own words are English
 * (DataSecurityTracedAccess).
 */
export const GrantedViaCell: FunctionComponent<{
  access: DataStoreAccess;
}> = (props: { access: DataStoreAccess }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.access.isSeenInTraces) {
    return (
      <span className="text-sm text-gray-700">
        {translator.translateText(SEEN_IN_TRACES)}
      </span>
    );
  }

  if (!props.access.grantedVia) {
    return <TableEmptyValue />;
  }

  return (
    <span className="text-sm text-gray-700 [overflow-wrap:anywhere]">
      <IsolatedText text={props.access.grantedVia} />
    </span>
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
