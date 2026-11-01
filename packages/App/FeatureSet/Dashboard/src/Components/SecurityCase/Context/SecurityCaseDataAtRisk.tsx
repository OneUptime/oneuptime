import AppLink from "../../AppLink/AppLink";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import {
  ExposurePill,
  SensitivityPill,
} from "../../DataSecurity/DataSecurityPills";
import { getDataSecurityIdentityRoute } from "../../DataSecurity/IdentityCells";
import { getStoreViewRoute } from "../../DataSecurity/IssueListRoute";
import StoreDataTypeList from "../../DataSecurity/StoreDataTypeList";
import {
  IMPACT_DATA_HEADING,
  IMPACT_DATA_IDENTITY,
  IMPACT_DATA_MORE,
  IMPACT_DATA_NAMED,
  IMPACT_DATA_OUTSIDE,
  IMPACT_DATA_RECORDS,
  IMPACT_DATA_THROUGH,
  IMPACT_DATA_WHO,
  SECURITY_CASE_CONTEXT_TEST_IDS,
} from "./SecurityCaseContextCopy";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityCaseDataAtRiskJson,
  SecurityCaseDataStoreAtRiskJson,
  SecurityCaseIdentityAtRiskJson,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE DATA A CASE PUTS AT RISK, on its Impact card.
 *
 * Each store the case names, and each one its identities can reach - the
 * blast radius of a credential the attack may hold - the most sensitive
 * first: how sensitive it is and how exposed, what kinds of data it holds
 * and about how many records, how the case reaches it, and how many
 * identities can reach it (how many of them from outside the connected
 * accounts). The identities the case names follow, each opening its own
 * page, where every store it reaches is listed.
 */

const SECTION_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

// Whether there is anything at risk to say.
export function hasDataAtRisk(
  dataAtRisk: SecurityCaseDataAtRiskJson | null | undefined,
): boolean {
  return Boolean(
    dataAtRisk &&
      (dataAtRisk.stores.length > 0 || dataAtRisk.identities.length > 0),
  );
}

const StoreAtRisk: FunctionComponent<{
  store: SecurityCaseDataStoreAtRiskJson;
}> = (props: { store: SecurityCaseDataStoreAtRiskJson }): ReactElement => {
  const translator: Translator = useTranslator();
  const store: SecurityCaseDataStoreAtRiskJson = props.store;
  const how: string = store.isNamedByCase
    ? translator.translateText(IMPACT_DATA_NAMED) || ""
    : translator.translateTemplate(IMPACT_DATA_THROUGH, {
        names: composedValue((sentence: Translator): string => {
          return formatNameList(store.reachedThrough, "and", sentence);
        }),
      });

  return (
    <li
      className="py-3 first:pt-0 last:pb-0"
      data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactDataStore}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200">
          <Icon icon={IconProp.Database} className="h-4 w-4 text-gray-600" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AppLink
              to={getStoreViewRoute(store.id)}
              className="text-sm font-semibold text-gray-900 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]"
            >
              <bdi>{store.name}</bdi>
            </AppLink>
            {store.kind ? (
              <span className="text-xs font-medium text-gray-500">
                {translator.translateText(store.kind) || store.kind}
              </span>
            ) : (
              <></>
            )}
            <SensitivityPill sensitivity={store.sensitivity} />
            {store.exposure ? (
              <ExposurePill exposure={store.exposure as never} />
            ) : (
              <></>
            )}
          </div>
          {store.dataTypeIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
              <StoreDataTypeList dataTypeIds={store.dataTypeIds} />
              {store.estimatedRecords ? (
                <span>
                  {translator.translateTemplate(IMPACT_DATA_RECORDS, {
                    count: translator.formatNumber(store.estimatedRecords),
                  })}
                </span>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
          <div className="text-sm text-gray-500 [overflow-wrap:anywhere]">
            {how}
            {" · "}
            {translator.translatePlural(IMPACT_DATA_WHO, store.identityCount)}
            {store.externalIdentityCount > 0 ? (
              <>
                {", "}
                <span className="text-orange-700">
                  {translator.translatePlural(
                    IMPACT_DATA_OUTSIDE,
                    store.externalIdentityCount,
                  )}
                </span>
              </>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    </li>
  );
};

export interface ComponentProps {
  dataAtRisk: SecurityCaseDataAtRiskJson;
}

const SecurityCaseDataAtRisk: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dataAtRisk: SecurityCaseDataAtRiskJson = props.dataAtRisk;

  return (
    <section data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.impactData}>
      <h3 className={`mb-2 ${SECTION_HEADING_CLASS_NAME}`}>
        {translator.translateText(IMPACT_DATA_HEADING)}
      </h3>
      {dataAtRisk.stores.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {dataAtRisk.stores.map(
            (store: SecurityCaseDataStoreAtRiskJson): ReactElement => {
              return <StoreAtRisk key={store.id} store={store} />;
            },
          )}
        </ul>
      ) : (
        <></>
      )}
      {dataAtRisk.identities.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-gray-600">
          {dataAtRisk.identities.map(
            (identity: SecurityCaseIdentityAtRiskJson): ReactElement => {
              return (
                <li
                  key={identity.id}
                  className="flex flex-wrap items-center gap-x-1.5 [overflow-wrap:anywhere]"
                  data-testid={
                    SECURITY_CASE_CONTEXT_TEST_IDS.impactDataIdentity
                  }
                >
                  <Icon
                    icon={IconProp.Key}
                    className="h-3.5 w-3.5 shrink-0 text-gray-400"
                  />
                  <AppLink
                    to={getDataSecurityIdentityRoute(identity.id)}
                    className="text-gray-900 hover:text-indigo-700 hover:underline"
                  >
                    {translator.translatePlural(
                      IMPACT_DATA_IDENTITY,
                      identity.storeCount,
                      { name: identity.name },
                    )}
                  </AppLink>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <></>
      )}
      {dataAtRisk.hasMoreStores ? (
        <p className="mt-2 text-sm text-gray-500">
          {translator.translateText(IMPACT_DATA_MORE)}
        </p>
      ) : (
        <></>
      )}
    </section>
  );
};

export default SecurityCaseDataAtRisk;
