import AppLink from "../AppLink/AppLink";
import { SensitivityPill } from "./DataSecurityPills";
import {
  AccessLevelPill,
  GrantedViaCell,
  NOT_USED_IN_90_DAYS,
} from "./IdentityCells";
import { getStoreViewRoute } from "./IssueListRoute";
import IssueMoment from "./IssueMoment";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "Common/Types/DataSecurity/DataSensitivity";
import { Gray500 } from "Common/Types/BrandColors";
import { DataStoreAccessLevel } from "Common/Types/DataSecurity/DataStoreAccess";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill from "Common/UI/Components/Pill/Pill";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT ONE IDENTITY CAN REACH: its blast radius.
 *
 * Every store the identity's grants reach, the most sensitive first - so
 * the stores a leaked credential would put at risk lead - then the most it
 * may do, then by name. Each row says the store, how sensitive what it
 * holds is, what the identity may do to it - its access level, as a
 * store's Who Can Reach It says it - what grants that and when it was last
 * used, a grant unused for 90 days marked as there. Read as one list of at most MAX_REACH_ROWS grants, sorted
 * here: an identity with more grants than that says how many under the
 * list.
 */

export const IDENTITY_REACH_LIST_ID: string = "data-security-identity-reach";

// A grant of the identity's that nobody has used in 90 days.
export const IDENTITY_REACH_UNUSED_TEST_ID: string =
  "data-security-identity-reach-unused";

// The most grants the list reads; Admin roles reaching every bucket are cut there.
export const MAX_REACH_ROWS: number = 500;

const LEVEL_RANK: Readonly<Record<string, number>> = {
  [DataStoreAccessLevel.Admin]: 3,
  [DataStoreAccessLevel.Write]: 2,
  [DataStoreAccessLevel.Read]: 1,
};

const SHOWING_SOME: string = translationKey(
  "Showing {{shown}} of its {{total}} grants.",
);

const STORE_GONE: string = translationKey("A store that is gone");

function sensitivityOf(access: DataStoreAccess): DataSensitivity {
  const value: unknown = access.dataStore?.sensitivity;

  return isDataSensitivity(value) ? value : DataSensitivity.Public;
}

// The most sensitive store first, then the most it may do there, then by name.
export function sortReach(
  rows: Array<DataStoreAccess>,
): Array<DataStoreAccess> {
  return [...rows].sort((a: DataStoreAccess, b: DataStoreAccess): number => {
    const sensitivity: number =
      DATA_SENSITIVITY_RANK[sensitivityOf(b)] -
      DATA_SENSITIVITY_RANK[sensitivityOf(a)];

    if (sensitivity !== 0) {
      return sensitivity;
    }

    const level: number =
      (LEVEL_RANK[b.accessLevel || ""] || 0) -
      (LEVEL_RANK[a.accessLevel || ""] || 0);

    if (level !== 0) {
      return level;
    }

    return (a.dataStore?.name || "").localeCompare(b.dataStore?.name || "");
  });
}

export interface ComponentProps {
  principal: string;
}

const IdentityReachList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [rows, setRows] = useState<Array<DataStoreAccess> | null>(null);
  const [count, setCount] = useState<number>(0);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setRows(null);
    setError("");

    ModelAPI.getList<DataStoreAccess>({
      modelType: DataStoreAccess,
      query: {
        ...(projectId ? { projectId: projectId } : {}),
        principal: props.principal,
      },
      limit: MAX_REACH_ROWS,
      skip: 0,
      select: {
        _id: true,
        dataStoreId: true,
        accessLevel: true,
        grantedVia: true,
        isSeenInTraces: true,
        lastUsedAt: true,
        isUnused: true,
        dataStore: { name: true, kind: true, sensitivity: true },
      },
      sort: { createdAt: SortOrder.Ascending },
    })
      .then((result: ListResult<DataStoreAccess>): void => {
        if (isCurrent) {
          setRows(sortReach(result.data));
          setCount(result.count);
        }
      })
      .catch((caught: unknown): void => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(caught));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.principal]);

  return (
    <Card
      title="What It Can Reach"
      description="Every store this identity can reach, the most sensitive first: what it may do there, what grants it, and when it was last used."
    >
      <div data-testid={IDENTITY_REACH_LIST_ID}>
        {error ? (
          <ErrorMessage message={error} />
        ) : rows === null ? (
          <PageLoader isVisible={true} />
        ) : (
          <>
            <LocalTable<DataStoreAccess>
              id={IDENTITY_REACH_LIST_ID}
              singularLabel="Store"
              pluralLabel="Stores"
              data={rows}
              columns={[
                {
                  key: "dataStoreId",
                  title: "Data Store",
                  type: FieldType.Element,
                  disableSort: true,
                  getElement: (access: DataStoreAccess): ReactElement => {
                    const storeId: string =
                      access.dataStoreId?.toString() || "";

                    if (!storeId || !access.dataStore?.name) {
                      return (
                        <span className="text-sm text-gray-500">
                          {translator.translateText(STORE_GONE)}
                        </span>
                      );
                    }

                    return (
                      <div className="min-w-0">
                        <AppLink
                          className="block min-w-0 text-sm font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
                          to={getStoreViewRoute(storeId)}
                        >
                          <IsolatedText text={access.dataStore.name} />
                        </AppLink>
                        {access.dataStore.kind ? (
                          <div className="text-xs text-gray-500">
                            {translator.translateText(access.dataStore.kind) ||
                              access.dataStore.kind}
                          </div>
                        ) : (
                          <></>
                        )}
                        {access.isUnused ? (
                          <div
                            className="mt-1"
                            data-testid={IDENTITY_REACH_UNUSED_TEST_ID}
                          >
                            <Pill text={NOT_USED_IN_90_DAYS} color={Gray500} />
                          </div>
                        ) : (
                          <></>
                        )}
                      </div>
                    );
                  },
                },
                {
                  key: "dataStore",
                  title: "Sensitivity",
                  type: FieldType.Element,
                  disableSort: true,
                  getElement: (access: DataStoreAccess): ReactElement => {
                    return (
                      <SensitivityPill sensitivity={sensitivityOf(access)} />
                    );
                  },
                },
                {
                  key: "accessLevel",
                  title: "Access Level",
                  type: FieldType.Element,
                  disableSort: true,
                  getElement: (access: DataStoreAccess): ReactElement => {
                    return <AccessLevelPill level={access.accessLevel} />;
                  },
                },
                {
                  key: "grantedVia",
                  title: "Granted Via",
                  type: FieldType.Element,
                  disableSort: true,
                  wrapContent: true,
                  wrapMaxWidthClassName: "max-w-xs",
                  hideOnMobile: true,
                  getElement: (access: DataStoreAccess): ReactElement => {
                    return <GrantedViaCell access={access} />;
                  },
                },
                {
                  key: "lastUsedAt",
                  title: "Last Used",
                  type: FieldType.Element,
                  disableSort: true,
                  hideOnMobile: true,
                  getElement: (access: DataStoreAccess): ReactElement => {
                    return <IssueMoment value={access.lastUsedAt} />;
                  },
                },
              ]}
            />
            {count > rows.length ? (
              <p className="mt-3 text-sm text-gray-500">
                {translator.translateTemplate(SHOWING_SOME, {
                  shown: translator.formatNumber(rows.length),
                  total: translator.formatNumber(count),
                })}
              </p>
            ) : (
              <></>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

export default IdentityReachList;
