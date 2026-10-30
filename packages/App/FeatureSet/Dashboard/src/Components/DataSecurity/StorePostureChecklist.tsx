import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { DataSecurityCheckStatus } from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataStorePostureFacts,
  tlsVersionNumber,
} from "Common/Types/DataSecurity/DataStorePosture";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A STORE'S CONFIGURATION SAYS, AS A CHECKLIST.
 *
 * Each fact the readers record (Types/DataSecurity/DataStorePosture) is a
 * line: what a safe store looks like, and whether this one does - Pass,
 * Fail, or Unknown when the reader could not tell (a permission it did not
 * have). A fact that does not apply to the store's kind is not recorded,
 * and is not listed. The checks that open issues read the same facts; this
 * shows them all, so a store with no issue still shows how it is set up.
 */

export type PostureFactStatus =
  | DataSecurityCheckStatus.Pass
  | DataSecurityCheckStatus.Fail
  | DataSecurityCheckStatus.Unknown;

export interface PostureFactLine {
  key: string;
  // What a safe store looks like, in a few words.
  label: string;
  status: PostureFactStatus;
}

interface BooleanFact {
  key: keyof DataStorePostureFacts;
  label: string;
  // The value a safe store has.
  safeWhen: boolean;
}

interface ListFact {
  key: "sharedWithExternal" | "snapshotSharedWith";
  label: string;
}

const BOOLEAN_FACTS: ReadonlyArray<BooleanFact> = [
  {
    key: "publicRead",
    label: "Nobody on the internet can read it",
    safeWhen: false,
  },
  {
    key: "publicWrite",
    label: "Nobody on the internet can write to it",
    safeWhen: false,
  },
  {
    key: "blockPublicAccess",
    label: "Public access is blocked",
    safeWhen: true,
  },
  {
    key: "snapshotPublic",
    label: "Its snapshots are not public",
    safeWhen: false,
  },
  {
    key: "publicNetworkAccess",
    label: "It is not reachable from the public network",
    safeWhen: false,
  },
  {
    key: "openToAllAddresses",
    label: "It is not open to every internet address",
    safeWhen: false,
  },
  { key: "encryptedAtRest", label: "It is encrypted at rest", safeWhen: true },
  {
    key: "customerManagedKey",
    label: "It is encrypted with your own key",
    safeWhen: true,
  },
  {
    key: "encryptionInTransitEnforced",
    label: "Connections must be encrypted",
    safeWhen: true,
  },
  { key: "backupsEnabled", label: "Backups are on", safeWhen: true },
  {
    key: "pointInTimeRecovery",
    label: "Point-in-time recovery is on",
    safeWhen: true,
  },
  {
    key: "deletionProtection",
    label: "Deletion protection is on",
    safeWhen: true,
  },
  { key: "versioning", label: "Versioning is on", safeWhen: true },
  { key: "softDelete", label: "Deleted data can be recovered", safeWhen: true },
  {
    key: "accessLogging",
    label: "Reads of its data are logged",
    safeWhen: true,
  },
  {
    key: "sharedKeyAccess",
    label: "Shared access keys are turned off",
    safeWhen: false,
  },
  {
    key: "uniformAccess",
    label: "Access is managed in one place",
    safeWhen: true,
  },
];

const LIST_FACTS: ReadonlyArray<ListFact> = [
  {
    key: "sharedWithExternal",
    label: "It is not shared with accounts outside yours",
  },
  {
    key: "snapshotSharedWith",
    label: "Its snapshots are not shared outside your accounts",
  },
];

const MINIMUM_TLS_LABEL: string = "It requires TLS 1.2 or newer";

/*
 * The checklist of a store's facts, in the order above: exposure first,
 * then encryption, recovery, visibility and access. A fact the store's kind
 * does not have is left out.
 */
export function getPostureFactLines(
  facts: DataStorePostureFacts | null | undefined,
): Array<PostureFactLine> {
  if (!facts) {
    return [];
  }

  const lines: Array<PostureFactLine> = [];

  for (const fact of BOOLEAN_FACTS) {
    const value: unknown = facts[fact.key];

    if (value === undefined) {
      continue;
    }

    lines.push({
      key: fact.key,
      label: fact.label,
      status:
        value === null || typeof value !== "boolean"
          ? DataSecurityCheckStatus.Unknown
          : value === fact.safeWhen
            ? DataSecurityCheckStatus.Pass
            : DataSecurityCheckStatus.Fail,
    });
  }

  for (const fact of LIST_FACTS) {
    const value: Array<string> | undefined = facts[fact.key];

    if (value === undefined) {
      continue;
    }

    lines.push({
      key: fact.key,
      label: fact.label,
      status: !Array.isArray(value)
        ? DataSecurityCheckStatus.Unknown
        : value.length === 0
          ? DataSecurityCheckStatus.Pass
          : DataSecurityCheckStatus.Fail,
    });
  }

  if (facts.minimumTlsVersion !== undefined) {
    lines.push({
      key: "minimumTlsVersion",
      label: MINIMUM_TLS_LABEL,
      status:
        facts.minimumTlsVersion === null
          ? DataSecurityCheckStatus.Unknown
          : tlsVersionNumber(facts.minimumTlsVersion) >= 1.2
            ? DataSecurityCheckStatus.Pass
            : DataSecurityCheckStatus.Fail,
    });
  }

  return lines;
}

interface StatusLook {
  text: string;
  color: Color;
  icon: IconProp;
  iconClassName: string;
}

const STATUS_LOOK: Readonly<Record<PostureFactStatus, StatusLook>> = {
  [DataSecurityCheckStatus.Pass]: {
    text: "Pass",
    color: Green500,
    icon: IconProp.CheckCircle,
    iconClassName: "text-emerald-500",
  },
  [DataSecurityCheckStatus.Fail]: {
    text: "Fail",
    color: Red500,
    icon: IconProp.ExclaimationCircle,
    iconClassName: "text-red-500",
  },
  [DataSecurityCheckStatus.Unknown]: {
    text: "Unknown",
    color: Gray500,
    icon: IconProp.Help,
    iconClassName: "text-gray-400",
  },
};

export interface ComponentProps {
  facts: DataStorePostureFacts | null | undefined;
}

const StorePostureChecklist: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const lines: Array<PostureFactLine> = getPostureFactLines(props.facts);
  const warnings: Array<string> = props.facts?.readWarnings || [];
  const publicReason: string | undefined = props.facts?.publicReason;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-gray-100">
        {lines.map((line: PostureFactLine): ReactElement => {
          const look: StatusLook = STATUS_LOOK[line.status];

          return (
            <li
              key={line.key}
              className="flex items-center justify-between gap-3 py-2"
              data-testid={`store-posture-${line.key}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  icon={look.icon}
                  className={`h-4 w-4 flex-shrink-0 ${look.iconClassName}`}
                />
                <span className="text-sm text-gray-700">
                  {translator.translateText(line.label)}
                </span>
              </div>
              <Pill text={look.text} color={look.color} />
            </li>
          );
        })}
      </ul>

      {publicReason ? (
        <div
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 [overflow-wrap:anywhere]"
          data-testid="data-store-public-reason"
        >
          {/*
           * The reason is the cloud's own words: read the way they are
           * written, its full stop at its end on a Persian page too.
           */}
          <TranslatedSentence
            template="What makes it public: {{reason}}"
            slots={{ reason: <IsolatedText text={publicReason} /> }}
          />
        </div>
      ) : (
        <></>
      )}

      {warnings.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-900">
            {translator.translateText(
              "What OneUptime could not read, so the lines above may say Unknown:",
            )}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-amber-800">
            {warnings.map((warning: string): ReactElement => {
              return (
                <li key={warning} className="[overflow-wrap:anywhere]">
                  <IsolatedText text={warning} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default StorePostureChecklist;
