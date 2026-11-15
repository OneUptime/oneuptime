import PageComponentProps from "../PageComponentProps";
import { SensitivityPill } from "../../Components/DataSecurity/DataSecurityPills";
import AppLink from "../../Components/AppLink/AppLink";
import {
  ANYONE_ON_THE_INTERNET,
  AccessLevelPill,
  NOT_USED_IN_90_DAYS,
  OPEN_SERVICE,
  OUTSIDE_YOUR_ACCOUNTS,
  PrincipalText,
  UNKNOWN_USE,
  getTracedServiceRoute,
  lastUsedNote,
  showsPrincipal,
} from "../../Components/DataSecurity/IdentityCells";
import IssueMoment from "../../Components/DataSecurity/IssueMoment";
import IdentityReachList from "../../Components/DataSecurity/IdentityReachList";
import IssueRiskScore, {
  FactorWords,
  IssueRiskFactor,
} from "../../Components/DataSecurity/IssueRiskScore";
import StoreDataTypeList from "../../Components/DataSecurity/StoreDataTypeList";
import { getStoreProviderName } from "../../Components/DataSecurity/StoreFieldOptions";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import { getDataSecurityBreadcrumbs } from "../../Utils/Breadcrumbs/DataSecurityBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import DataSecuritySideMenu from "./SideMenu";
import DataSecurityIdentity from "Common/Models/DatabaseModels/DataSecurityIdentity";
import Route from "Common/Types/API/Route";
import Select from "Common/Types/BaseDatabase/Select";
import {
  DataSecurityIdentityReach,
  getIdentityRiskFactors,
} from "Common/Types/DataSecurity/DataSecurityIdentity";
import DataSensitivity, {
  isDataSensitivity,
} from "Common/Types/DataSecurity/DataSensitivity";
import { DataStoreProvider } from "Common/Types/DataSecurity/DataStoreKind";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import {
  PluralTemplate,
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams } from "react-router-dom";

/*
 * WHAT CAN THIS IDENTITY REACH?
 *
 * One identity's blast radius - what a leaked credential of it would put
 * at risk - under the product's own side menu, Access lit: the most
 * sensitive data it reaches and in how many stores, the most it may do,
 * when it was last used and its risk; who it is and why that matters; why
 * it ranks where it does, part by part; and every store it reaches, the
 * most sensitive first (IdentityReachList).
 */

// What the page reads of the identity.
export const IDENTITY_VIEW_SELECT: Select<DataSecurityIdentity> = {
  _id: true,
  principal: true,
  principalName: true,
  principalType: true,
  provider: true,
  isExternal: true,
  isPublic: true,
  isUnused: true,
  isSeenInTraces: true,
  storeCount: true,
  sensitiveStoreCount: true,
  restrictedStoreCount: true,
  highestSensitivity: true,
  highestAccessLevel: true,
  canChangeSensitiveData: true,
  dataTypeIds: true,
  estimatedRecords: true,
  riskScore: true,
  lastUsedAt: true,
  firstSeenAt: true,
};

const STORES_REACHED: PluralTemplate = {
  one: "In {{count}} store",
  other: "Across {{count}} stores",
};
const ABOUT_RECORDS: string = translationKey(
  "About {{count}} records with sensitive data",
);
const REACHES_DATA: string = translationKey("Reaches {{sensitivity}} data");

// What each part of an identity's risk means, by the words it is labelled with.
const FACTOR_MEANINGS: Record<string, string> = {
  reaches: translationKey("The most sensitive data it can reach."),
  "Can change sensitive data": translationKey(
    "It may write to, or control, a store with sensitive data.",
  ),
  "Anyone on the internet": translationKey(
    "Nothing stands between anyone and what it reaches.",
  ),
  "Outside your accounts": translationKey(
    "It belongs to an account, tenant or project you have not connected.",
  ),
  "Not used in 90 days": translationKey(
    "Access nobody uses is access nobody watches.",
  ),
  "Sensitive stores it reaches": translationKey(
    "A point for each store with sensitive data it reaches, up to five.",
  ),
};

const FACTOR_TITLES: Record<string, string> = {
  "Can change sensitive data": translationKey("Can change sensitive data"),
  "Anyone on the internet": ANYONE_ON_THE_INTERNET,
  "Outside your accounts": OUTSIDE_YOUR_ACCOUNTS,
  "Not used in 90 days": NOT_USED_IN_90_DAYS,
  "Sensitive stores it reaches": translationKey("Sensitive stores it reaches"),
};

const REACHES_PREFIX: string = "Reaches ";
const DATA_SUFFIX: string = " data";

// A part of an identity's risk, named and explained in the reader's language.
export function describeIdentityFactor(
  factor: IssueRiskFactor,
  translator: Translator,
): FactorWords {
  if (
    factor.label.startsWith(REACHES_PREFIX) &&
    factor.label.endsWith(DATA_SUFFIX)
  ) {
    const sensitivity: string = factor.label.slice(
      REACHES_PREFIX.length,
      -DATA_SUFFIX.length,
    );

    return {
      title: translator.translateTemplate(REACHES_DATA, {
        sensitivity: translatableTerm(sensitivity, { inSentence: true }),
      }),
      meaning: translator.translateText(FACTOR_MEANINGS["reaches"]) || "",
    };
  }

  const title: string = FACTOR_TITLES[factor.label] || factor.label;
  const meaning: string | undefined = FACTOR_MEANINGS[factor.label];

  return {
    title: translator.translateText(title) || factor.label,
    meaning: meaning ? translator.translateText(meaning) || meaning : "",
  };
}

// The parts of an identity's score, from the identity as stored.
export function identityRiskFactors(
  identity: DataSecurityIdentity,
): Array<IssueRiskFactor> {
  const reach: DataSecurityIdentityReach = {
    highestSensitivity: isDataSensitivity(identity.highestSensitivity)
      ? identity.highestSensitivity
      : DataSensitivity.Public,
    canChangeSensitiveData: Boolean(identity.canChangeSensitiveData),
    isPublic: Boolean(identity.isPublic),
    isExternal: Boolean(identity.isExternal),
    isUnused: Boolean(identity.isUnused),
    sensitiveStoreCount: identity.sensitiveStoreCount || 0,
  };

  return getIdentityRiskFactors(reach);
}

// Who the identity is, line by line, each with why it matters.
function aboutLines(
  identity: DataSecurityIdentity,
  translator: Translator,
): Array<{ id: string; text: string }> {
  const lines: Array<{ id: string; text: string }> = [];

  if (identity.isPublic) {
    lines.push({
      id: "public",
      text:
        translator.translateText(
          "Anyone on the internet: no account or sign-in is needed to reach what it reaches.",
        ) || "",
    });
  } else if (identity.isExternal) {
    lines.push({
      id: "external",
      text:
        translator.translateText(
          "Outside your accounts: it belongs to an account, tenant or project you have not connected to OneUptime.",
        ) || "",
    });
  }

  if (identity.isUnused) {
    lines.push({
      id: "unused",
      text:
        translator.translateText(
          "Not used in 90 days, as far as its cloud can say: remove the access it no longer needs.",
        ) || "",
    });
  }

  if (identity.isSeenInTraces) {
    lines.push({
      id: "traced",
      text:
        translator.translateText(
          "Seen in traces: OneUptime saw this service call the stores it reaches.",
        ) || "",
    });
  }

  return lines;
}

const DataSecurityIdentityView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  const identityIdString: string = id || "";
  const identityId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(identityIdString);
  }, [identityIdString]);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [identity, setIdentity] = useState<DataSecurityIdentity | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    setError("");

    ModelAPI.getItem<DataSecurityIdentity>({
      modelType: DataSecurityIdentity,
      id: identityId,
      select: IDENTITY_VIEW_SELECT,
    })
      .then((item: DataSecurityIdentity | null): void => {
        if (isCurrent) {
          setIdentity(item);
          setIsLoading(false);
        }
      })
      .catch((caught: unknown): void => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(caught));
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [identityIdString]);

  const content: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <PageLoader isVisible={true} />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!identity) {
      return (
        <ErrorMessage message="This identity no longer reaches any store, or it was never one of this project's." />
      );
    }

    const records: number = identity.estimatedRecords || 0;
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
    const lines: Array<{ id: string; text: string }> = aboutLines(
      identity,
      translator,
    );
    const serviceRoute: Route | null = getTracedServiceRoute(identity);

    return (
      <>
        <EventStatBar
          columns={4}
          isLaidOutByOwnWidth={true}
          ariaLabel="Identity figures"
        >
          <EventStatTile
            variant="segment"
            icon={IconProp.Fingerprint}
            label="Reaches"
            value={
              <SensitivityPill sensitivity={identity.highestSensitivity} />
            }
            description={translator.translatePlural(
              STORES_REACHED,
              identity.storeCount || 0,
            )}
          />
          <EventStatTile
            variant="segment"
            icon={IconProp.Key}
            label="Most It May Do"
            value={<AccessLevelPill level={identity.highestAccessLevel} />}
            description={
              identity.canChangeSensitiveData
                ? translator.translateText("Can change sensitive data")
                : translator.translateText("Across the stores it reaches")
            }
          />
          <EventStatTile
            variant="segment"
            icon={IconProp.Clock}
            label="Last Used"
            value={
              identity.lastUsedAt ? (
                <IssueMoment value={identity.lastUsedAt} />
              ) : identity.isUnused ? (
                translator.translateText(NOT_USED_IN_90_DAYS) || ""
              ) : (
                // Not a finding, a gap: quieter than a value.
                <span className="text-gray-500">
                  {translator.translateText(UNKNOWN_USE)}
                </span>
              )
            }
            description={translator.translateText(lastUsedNote(identity))}
          />
          <EventStatTile
            variant="segment"
            icon={IconProp.Gauge}
            label="Risk Score"
            value={translator.formatNumber(identity.riskScore || 0)}
            description={translator.translateText(
              "How much harm it could do, from 0 to 100",
            )}
          />
        </EventStatBar>

        <CardGrid columns={2}>
          <Card
            headerLayout="stacked"
            title="Who It Is"
            description="As its cloud names it, and what that means for the data it reaches."
          >
            <div
              className="space-y-3"
              data-testid="data-security-identity-about"
            >
              {showsPrincipal(identity) ? (
                <div className="text-sm text-gray-900 [overflow-wrap:anywhere]">
                  <PrincipalText principal={identity.principal || ""} />
                </div>
              ) : (
                <></>
              )}
              {kind || serviceRoute ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                  {kind ? <span>{kind}</span> : <></>}
                  {serviceRoute ? (
                    <AppLink
                      to={serviceRoute}
                      className="font-medium text-indigo-600 hover:underline"
                      dataTestId="data-security-identity-service"
                    >
                      <span>{translator.translateText(OPEN_SERVICE)}</span>
                    </AppLink>
                  ) : (
                    <></>
                  )}
                </div>
              ) : (
                <></>
              )}
              {lines.length > 0 ? (
                <ul className="space-y-2">
                  {lines.map(
                    (line: { id: string; text: string }): ReactElement => {
                      return (
                        <li key={line.id} className="text-sm text-gray-700">
                          {line.text}
                        </li>
                      );
                    },
                  )}
                </ul>
              ) : (
                <></>
              )}
              {(identity.dataTypeIds || []).length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-sm font-medium text-gray-900">
                    {translator.translateText(
                      "Sensitive data in the stores it reaches",
                    )}
                  </div>
                  <StoreDataTypeList dataTypeIds={identity.dataTypeIds} />
                  {records > 0 ? (
                    <div className="text-sm text-gray-500">
                      {translator.translateTemplate(ABOUT_RECORDS, {
                        count: translator.formatNumber(records),
                      })}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              ) : (
                <></>
              )}
            </div>
          </Card>
          <Card
            headerLayout="stacked"
            title="Why It Ranks Here"
            description="Its risk score, part by part: the identities that could do the most harm with what they reach come first."
          >
            <IssueRiskScore
              testId="data-security-identity-risk-score"
              score={identity.riskScore || 0}
              factors={identityRiskFactors(identity)}
              describe={describeIdentityFactor}
            />
          </Card>
        </CardGrid>

        <IdentityReachList principal={identity.principal || ""} />
      </>
    );
  };

  return (
    <ModelPage
      title="Identity"
      modelType={DataSecurityIdentity}
      modelId={identityId}
      modelNameField="principalName"
      breadcrumbLinks={getDataSecurityBreadcrumbs(path)}
      sideMenu={<DataSecuritySideMenu />}
    >
      {content()}
    </ModelPage>
  );
};

export default DataSecurityIdentityView;
