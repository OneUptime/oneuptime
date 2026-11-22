import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ExposurePill,
  SensitivityPill,
  SeverityPill,
} from "./DataSecurityPills";
import {
  FACT_CAN_RUN_FROM_HERE,
  FACT_DECLARED_IN,
  FACT_EXTERNAL_GRANTS,
  FACT_GRANT,
  FACT_HOLDS_COPY_OF_THIS,
  FACT_IDENTITIES,
  FACT_LAST_USED,
  FACT_MARKED_PUBLIC_BY_DESIGN,
  FACT_NO_OWNER,
  FACT_NO_SENSITIVE_DATA,
  FACT_NOTHING_USES_IT,
  FACT_OBJECTS,
  FACT_OUTSIDE_YOUR_ACCOUNTS,
  FACT_OWNERS,
  FACT_PROPOSED,
  FACT_PUBLIC,
  FACT_PUBLIC_GRANTS,
  FACT_RECORDS,
  FACT_SECURITY_CASE,
  FACT_SEEN_USING_IT,
  FACT_THE_FIX_REMOVES_IT,
  FACT_THE_ISSUE,
  FACT_THIS_HOLDS_ITS_COPY,
  FACT_USED_LATELY,
  FACT_VALUES_IN_COMMON,
  OPEN_SECURITY_CASE,
  PROPOSAL_KIND_TITLES,
  PROPOSAL_STATUS_TITLES,
  SET_OWNERS,
} from "./IssueAiAnalysisCopy";
import { DataTypeNamer, IssueDataTypeChips } from "./IssueDataTypes";
import { getStoreViewRoute } from "./IssueListRoute";
import {
  RESPONSE_ACTION_TITLES,
  UNAVAILABLE_SENTENCES,
} from "./IssueResponseAction";
import Route from "Common/Types/API/Route";
import { isDataSecurityAiProposalKind } from "Common/Types/DataSecurity/DataSecurityAi";
import { DataSecurityResponseUnavailableReason } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { getDataSecurityCheck } from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DATA_SECURITY_RECENCY_TITLES,
  DataSecurityAnalysisFact,
  DataSecurityAnalysisFactKind,
} from "Common/Types/DataSecurity/DataSecurityIssueAnalysis";
import { isDataSecurityResponseAction } from "Common/Types/DataSecurity/DataSecurityResponseAction";
import ObjectID from "Common/Types/ObjectID";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE FACTS A LINE OF ONEUPTIME AI'S ANALYSIS RESTS ON, AS THE CARD FOLDS
 * THEM OUT (#10369).
 *
 * Drawn from the facts themselves - what Data Security's code read - never
 * from the model's words: a name a cloud, a person or a service wrote is
 * drawn as text, set apart (IsolatedText), and every word of OneUptime's
 * is the reader's. The server sends only the facts the reader may read.
 */

export const ANALYSIS_FACTS_TEST_ID: string = "data-security-issue-ai-facts";

const ROW_CLASS_NAME: string =
  "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700";
const CODE_CLASS_NAME: string =
  "rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]";
const LINK_CLASS_NAME: string = "font-medium text-indigo-600 hover:underline";

function routeOf(page: PageMap, id: string): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(id),
  });
}

export interface FactRowProps {
  fact: DataSecurityAnalysisFact;
  namer: DataTypeNamer;
  // The store the issue is on: where its owners are set.
  dataStoreId?: string | undefined;
}

export const AnalysisFactRow: FunctionComponent<FactRowProps> = (
  props: FactRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const fact: DataSecurityAnalysisFact = props.fact;

  switch (fact.kind) {
    case DataSecurityAnalysisFactKind.Issue: {
      const title: string = getDataSecurityCheck(fact.checkId)?.title || "";

      return (
        <span className={ROW_CLASS_NAME}>
          <span className="text-gray-500">
            {translator.translateText(FACT_THE_ISSUE)}
          </span>
          {fact.severity ? <SeverityPill severity={fact.severity} /> : <></>}
          {title ? <span>{translator.translateText(title)}</span> : <></>}
        </span>
      );
    }
    case DataSecurityAnalysisFactKind.StoreHolds:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.sensitivity ? (
            <SensitivityPill sensitivity={fact.sensitivity} />
          ) : (
            <></>
          )}
          <IssueDataTypeChips
            dataTypeIds={fact.dataTypeIds}
            namer={props.namer}
            limit={6}
            emptyElement={
              <span className="text-gray-500">
                {translator.translateText(FACT_NO_SENSITIVE_DATA)}
              </span>
            }
          />
          {typeof fact.records === "number" ? (
            <span>
              {translator.translatePlural(FACT_RECORDS, fact.records)}
            </span>
          ) : (
            <></>
          )}
          {typeof fact.objects === "number" ? (
            <span>
              {translator.translatePlural(FACT_OBJECTS, fact.objects)}
            </span>
          ) : (
            <></>
          )}
        </span>
      );
    case DataSecurityAnalysisFactKind.StoreExposure:
      return (
        <span className={ROW_CLASS_NAME}>
          <ExposurePill exposure={fact.exposure} />
          {fact.isPublicByDesign ? (
            <span>
              {translator.translateText(FACT_MARKED_PUBLIC_BY_DESIGN)}
            </span>
          ) : (
            <></>
          )}
          {fact.publicReason ? (
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <IsolatedText text={fact.publicReason} />
            </span>
          ) : (
            <></>
          )}
        </span>
      );
    case DataSecurityAnalysisFactKind.StoreIdentity:
      return (
        <span className={ROW_CLASS_NAME}>
          <span className="min-w-0 font-medium text-gray-900 [overflow-wrap:anywhere]">
            <IsolatedText text={fact.name} />
          </span>
          {fact.storeKind ? (
            <span>{translator.translateText(fact.storeKind)}</span>
          ) : (
            <></>
          )}
          {fact.tags.map((tag: [string, string]): ReactElement => {
            return (
              <span key={tag[0]} className={CODE_CLASS_NAME}>
                <IsolatedText text={tag[1] ? `${tag[0]}=${tag[1]}` : tag[0]} />
              </span>
            );
          })}
        </span>
      );
    case DataSecurityAnalysisFactKind.Place:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>{props.namer(fact.dataTypeId) || fact.dataTypeName}</span>
          <span className={CODE_CLASS_NAME}>
            <IsolatedText text={fact.location} />
          </span>
        </span>
      );
    case DataSecurityAnalysisFactKind.Reach:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translatePlural(FACT_IDENTITIES, fact.identities)}
          </span>
          {fact.publicGrants > 0 ? (
            <span>
              {translator.translatePlural(
                FACT_PUBLIC_GRANTS,
                fact.publicGrants,
              )}
            </span>
          ) : (
            <></>
          )}
          {fact.externalGrants > 0 ? (
            <span>
              {translator.translatePlural(
                FACT_EXTERNAL_GRANTS,
                fact.externalGrants,
              )}
            </span>
          ) : (
            <></>
          )}
          <span>
            {translator.translatePlural(FACT_USED_LATELY, fact.usedLately)}
          </span>
        </span>
      );
    case DataSecurityAnalysisFactKind.Grant:
      return (
        <span className={ROW_CLASS_NAME}>
          <span className={CODE_CLASS_NAME}>
            <IsolatedText text={fact.principal} />
          </span>
          <span>
            {translator.translateTemplate(FACT_GRANT, {
              level: translator.translateText(fact.accessLevel) || "",
              via: fact.grantedVia,
            })}
          </span>
          {fact.isPublic ? (
            <Pill text={FACT_PUBLIC} tone={PillTone.Danger} />
          ) : (
            <></>
          )}
          {fact.isExternal && !fact.isPublic ? (
            <Pill text={FACT_OUTSIDE_YOUR_ACCOUNTS} tone={PillTone.Warning} />
          ) : (
            <></>
          )}
          {fact.isRemovedByFix ? (
            <Pill text={FACT_THE_FIX_REMOVES_IT} tone={PillTone.Info} />
          ) : (
            <></>
          )}
          <span className="text-gray-600">
            {translator.translateTemplate(FACT_LAST_USED, {
              when:
                translator.translateText(
                  DATA_SECURITY_RECENCY_TITLES[fact.lastUsed],
                ) || "",
            })}
          </span>
        </span>
      );
    case DataSecurityAnalysisFactKind.ServiceUse:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.serviceId ? (
            <AppLink
              className={LINK_CLASS_NAME}
              to={routeOf(PageMap.SERVICE_VIEW, fact.serviceId)}
            >
              <IsolatedText text={fact.serviceName} />
            </AppLink>
          ) : (
            <span className="font-medium text-gray-900">
              <IsolatedText text={fact.serviceName} />
            </span>
          )}
          <span className="text-gray-600">
            {translator.translateTemplate(FACT_SEEN_USING_IT, {
              when:
                translator.translateText(
                  DATA_SECURITY_RECENCY_TITLES[fact.lastSeen],
                ) || "",
            })}
          </span>
        </span>
      );
    case DataSecurityAnalysisFactKind.NothingUsesIt:
      return (
        <span className={ROW_CLASS_NAME}>
          {translator.translateText(FACT_NOTHING_USES_IT)}
        </span>
      );
    case DataSecurityAnalysisFactKind.Copy:
      return (
        <span className={ROW_CLASS_NAME}>
          <AppLink
            className={LINK_CLASS_NAME}
            to={getStoreViewRoute(fact.otherStoreId)}
          >
            <IsolatedText text={fact.otherStoreName} />
          </AppLink>
          <span>
            {translator.translateText(
              fact.isCopyOfThisStore
                ? FACT_HOLDS_COPY_OF_THIS
                : FACT_THIS_HOLDS_ITS_COPY,
            )}
          </span>
          {typeof fact.overlapPercent === "number" ? (
            <span className="text-gray-600">
              {translator.translateTemplate(FACT_VALUES_IN_COMMON, {
                percent: `${translator.formatNumber(fact.overlapPercent)}%`,
              })}
            </span>
          ) : (
            <></>
          )}
        </span>
      );
    case DataSecurityAnalysisFactKind.SecurityCase:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>{translator.translateText(FACT_SECURITY_CASE)}</span>
          <AppLink
            className={LINK_CLASS_NAME}
            to={routeOf(PageMap.SECURITY_CASE_VIEW, fact.securityCaseId)}
          >
            <span>{translator.translateText(OPEN_SECURITY_CASE)}</span>
          </AppLink>
        </span>
      );
    case DataSecurityAnalysisFactKind.Response: {
      const title: string = isDataSecurityResponseAction(fact.action)
        ? RESPONSE_ACTION_TITLES[fact.action]
        : fact.action;
      const why: string | undefined =
        fact.unavailableReason &&
        Object.values(DataSecurityResponseUnavailableReason).includes(
          fact.unavailableReason as DataSecurityResponseUnavailableReason,
        )
          ? UNAVAILABLE_SENTENCES[
              fact.unavailableReason as DataSecurityResponseUnavailableReason
            ]
          : undefined;

      return (
        <span className={ROW_CLASS_NAME}>
          <span className="font-medium text-gray-900">
            {translator.translateText(title)}
          </span>
          <span className="text-gray-600">
            {fact.isAvailable
              ? translator.translateText(FACT_CAN_RUN_FROM_HERE)
              : why
                ? translator.translateText(why)
                : ""}
          </span>
        </span>
      );
    }
    case DataSecurityAnalysisFactKind.Proposal:
      return (
        <span className={ROW_CLASS_NAME}>
          <span className="font-medium text-gray-900">
            {isDataSecurityAiProposalKind(fact.proposalKind)
              ? translator.translateText(
                  PROPOSAL_KIND_TITLES[fact.proposalKind],
                )
              : fact.proposalKind}
          </span>
          <span className="text-gray-600">
            {translator.translateTemplate(FACT_PROPOSED, {
              status:
                translator.translateText(
                  PROPOSAL_STATUS_TITLES[fact.status] || fact.status,
                ) || fact.status,
            })}
          </span>
        </span>
      );
    case DataSecurityAnalysisFactKind.DeclaredCode:
      return (
        <span className={ROW_CLASS_NAME}>
          <AppLink
            className={LINK_CLASS_NAME}
            to={routeOf(PageMap.CODE_REPOSITORY_VIEW, fact.repositoryId)}
          >
            <IsolatedText text={fact.repositoryName} />
          </AppLink>
          <span className="text-gray-600">
            {translator.translateTemplate(FACT_DECLARED_IN, {
              codeKind: fact.codeKind,
            })}
          </span>
          {fact.paths.map((filePath: string): ReactElement => {
            return (
              <span key={filePath} className={CODE_CLASS_NAME}>
                <IsolatedText text={filePath} />
              </span>
            );
          })}
        </span>
      );
    case DataSecurityAnalysisFactKind.Owners:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.ownerNames.length > 0 ? (
            fact.ownerNames.map((name: string): ReactElement => {
              return (
                <span key={name} className="font-medium text-gray-900">
                  <IsolatedText text={name} />
                </span>
              );
            })
          ) : (
            <span>{translator.translatePlural(FACT_OWNERS, fact.owners)}</span>
          )}
        </span>
      );
    case DataSecurityAnalysisFactKind.NoOwner:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>{translator.translateText(FACT_NO_OWNER)}</span>
          {props.dataStoreId ? (
            <AppLink
              className={LINK_CLASS_NAME}
              to={routeOf(
                PageMap.DATA_SECURITY_STORE_VIEW_OWNERS,
                props.dataStoreId,
              )}
            >
              <span>{translator.translateText(SET_OWNERS)}</span>
            </AppLink>
          ) : (
            <></>
          )}
        </span>
      );
  }
};

export interface FactListProps {
  facts: Array<DataSecurityAnalysisFact>;
  namer: DataTypeNamer;
  dataStoreId?: string | undefined;
}

// The facts a line rests on, one to a row.
export const AnalysisFactList: FunctionComponent<FactListProps> = (
  props: FactListProps,
): ReactElement => {
  return (
    <ul
      className="mt-2 space-y-2 border-s-2 border-gray-200 ps-3"
      data-testid={ANALYSIS_FACTS_TEST_ID}
    >
      {props.facts.map((fact: DataSecurityAnalysisFact): ReactElement => {
        return (
          <li key={fact.id} data-fact-kind={fact.kind}>
            <AnalysisFactRow
              fact={fact}
              namer={props.namer}
              dataStoreId={props.dataStoreId}
            />
          </li>
        );
      })}
    </ul>
  );
};
