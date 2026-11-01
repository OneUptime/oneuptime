import DataSecurityIdentity from "../../../../Models/DatabaseModels/DataSecurityIdentity";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "../../../../Types/DataSecurity/DataSensitivity";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_CASE_IMPACT_MAX_DATA_STORES,
  SECURITY_CASE_IMPACT_MAX_IDENTITIES,
  SecurityCaseDataAtRiskJson,
  SecurityCaseDataStoreAtRiskJson,
  SecurityCaseIdentityAtRiskJson,
} from "../../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityEntity,
  SecurityEntityType,
  getDataStoreKeyOfEntityValue,
} from "../../../../Types/SecurityCase/SecurityEntity";
import DataSecurityIdentityService from "../../../Services/DataSecurityIdentityService";
import DataStoreAccessService from "../../../Services/DataStoreAccessService";
import DataStoreService from "../../../Services/DataStoreService";

/*
 * THE DATA A SECURITY CASE PUTS AT RISK.
 *
 * A case names entities: a data store Data Security watches, and the users
 * and roles its detections saw acting. The data at risk is the stores the
 * case names, and every store the identities it names can reach - the
 * blast radius of a credential the attack may hold (DataSecurityIdentity)
 * - the most sensitive first, each with what it holds, about how many
 * records, how exposed it is and how many identities can reach it, so the
 * analyst knows what a breach would cost and who else to look at.
 *
 * An identity is matched as its cloud and the detection name it: an ARN,
 * an account id, a service account's email; a role's session
 * (arn:aws:sts::1:assumed-role/app/s) is the role (arn:aws:iam::1:role/app,
 * whatever its path); an email is the Google Cloud user or service
 * account, and the Azure principal, of that name.
 *
 * Read with the reader's own permissions: a role that cannot read Data
 * Security's records sees the source named as one it cannot read. Every
 * read is bounded.
 */

// The most grants read for the case's identities, and for the stores at risk.
export const DATA_AT_RISK_MAX_GRANTS: number = 1000;
// The most data types a store at risk lists.
export const DATA_AT_RISK_MAX_DATA_TYPES: number = 5;

export interface IdentityCandidates {
  // Principals as clouds write them: an ARN, an account id, user:a@b.com.
  principals: Array<string>;
  // Names that identify an identity by themselves: an email, a role's name in its account.
  names: Array<{ name: string; account?: string | undefined }>;
}

const ASSUMED_ROLE: string = ":assumed-role/";

/*
 * Who an entity may be among the project's identities: the principal it
 * names as written, the role of a role's session, and the cloud members an
 * email is.
 */
export function getIdentityCandidates(
  entities: ReadonlyArray<SecurityEntity>,
): IdentityCandidates {
  const principals: Set<string> = new Set();
  const names: Map<string, { name: string; account?: string | undefined }> =
    new Map();

  for (const entity of entities) {
    if (
      entity.type !== SecurityEntityType.User &&
      entity.type !== SecurityEntityType.Other
    ) {
      continue;
    }

    const value: string = (entity.value || "").trim().slice(0, 500);

    if (!value) {
      continue;
    }

    principals.add(value);

    // arn:aws:sts::123456789012:assumed-role/app/session -> the role app.
    if (value.startsWith("arn:") && value.includes(ASSUMED_ROLE)) {
      const parts: Array<string> = value.split(":");
      const partition: string = parts[1] || "aws";
      const account: string = parts[4] || "";
      const role: string = (
        parts.slice(5).join(":").split("/")[1] || ""
      ).trim();

      if (account && role) {
        principals.add(`arn:${partition}:iam::${account}:role/${role}`);
        names.set(`${account}|${role}`, { name: role, account });
      }

      continue;
    }

    // An email: a Google Cloud user or service account, an Azure principal.
    if (value.includes("@") && !value.includes(":") && !value.includes(" ")) {
      principals.add(`user:${value}`);
      principals.add(`serviceAccount:${value}`);
      names.set(value.toLowerCase(), { name: value });
    }
  }

  return {
    principals: Array.from(principals).slice(0, 200),
    names: Array.from(names.values()).slice(0, 100),
  };
}

// Whether an identity found by name is the one the case means.
export function isNamedIdentity(
  identity: DataSecurityIdentity,
  names: ReadonlyArray<{ name: string; account?: string | undefined }>,
): boolean {
  const name: string = (identity.principalName || "").trim();

  return names.some(
    (candidate: { name: string; account?: string | undefined }): boolean => {
      if (candidate.account) {
        return (
          name === candidate.name &&
          (identity.principal || "").includes(`:${candidate.account}:`)
        );
      }

      return name.toLowerCase() === candidate.name.toLowerCase();
    },
  );
}

function sensitivityOf(store: DataStore): DataSensitivity {
  const value: unknown = store.sensitivityOverride || store.sensitivity;

  return isDataSensitivity(value) ? value : DataSensitivity.Public;
}

// The most sensitive first, then the most records, then by name.
export function sortStoresAtRisk(
  stores: Array<SecurityCaseDataStoreAtRiskJson>,
): Array<SecurityCaseDataStoreAtRiskJson> {
  return [...stores].sort(
    (
      a: SecurityCaseDataStoreAtRiskJson,
      b: SecurityCaseDataStoreAtRiskJson,
    ): number => {
      const rank: (store: SecurityCaseDataStoreAtRiskJson) => number = (
        store: SecurityCaseDataStoreAtRiskJson,
      ): number => {
        return isDataSensitivity(store.sensitivity)
          ? DATA_SENSITIVITY_RANK[store.sensitivity]
          : 0;
      };

      if (rank(b) !== rank(a)) {
        return rank(b) - rank(a);
      }

      if ((b.estimatedRecords || 0) !== (a.estimatedRecords || 0)) {
        return (b.estimatedRecords || 0) - (a.estimatedRecords || 0);
      }

      return a.name.localeCompare(b.name);
    },
  );
}

const STORE_SELECT: {
  _id: true;
  name: true;
  kind: true;
  sensitivity: true;
  sensitivityOverride: true;
  dataTypeIds: true;
  estimatedRecords: true;
  exposure: true;
  storeKey: true;
} = {
  _id: true,
  name: true,
  kind: true,
  sensitivity: true,
  sensitivityOverride: true,
  dataTypeIds: true,
  estimatedRecords: true,
  exposure: true,
  storeKey: true,
};

export default class SecurityCaseDataAtRisk {
  public static async read(data: {
    projectId: ObjectID;
    entities: ReadonlyArray<SecurityEntity>;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityCaseDataAtRiskJson> {
    const storeKeys: Array<string> = Array.from(
      new Set(
        data.entities
          .filter((entity: SecurityEntity): boolean => {
            return entity.type === SecurityEntityType.DataStore;
          })
          .map((entity: SecurityEntity): string => {
            return getDataStoreKeyOfEntityValue(entity.value);
          })
          .filter((key: string): boolean => {
            return Boolean(key);
          }),
      ),
    ).slice(0, SECURITY_CASE_IMPACT_MAX_DATA_STORES);
    const candidates: IdentityCandidates = getIdentityCandidates(data.entities);

    if (storeKeys.length === 0 && candidates.principals.length === 0) {
      return { stores: [], identities: [], hasMoreStores: false };
    }

    const identities: Array<DataSecurityIdentity> = await this.readIdentities(
      data,
      candidates,
    );
    const named: Array<DataStore> =
      storeKeys.length > 0
        ? await DataStoreService.findBy({
            query: {
              projectId: data.projectId,
              storeKey: new Includes(storeKeys),
              isArchived: false,
            },
            select: STORE_SELECT,
            skip: 0,
            limit: SECURITY_CASE_IMPACT_MAX_DATA_STORES,
            props: data.props,
          })
        : [];

    // What the case's identities reach, and through which of them.
    const reachedThrough: Map<string, Set<string>> = new Map();
    const nameOf: Map<string, string> = new Map(
      identities.map((identity: DataSecurityIdentity): [string, string] => {
        return [
          identity.principal || "",
          identity.principalName || identity.principal || "",
        ];
      }),
    );

    if (identities.length > 0) {
      const grants: Array<DataStoreAccess> =
        await DataStoreAccessService.findBy({
          query: {
            projectId: data.projectId,
            principal: new Includes(
              identities.map((identity: DataSecurityIdentity): string => {
                return identity.principal || "";
              }),
            ),
          },
          select: { dataStoreId: true, principal: true },
          skip: 0,
          limit: DATA_AT_RISK_MAX_GRANTS,
          props: data.props,
        });

      for (const grant of grants) {
        const storeId: string = grant.dataStoreId?.toString() || "";

        if (!storeId) {
          continue;
        }

        const through: Set<string> = reachedThrough.get(storeId) || new Set();
        through.add(nameOf.get(grant.principal || "") || grant.principal || "");
        reachedThrough.set(storeId, through);
      }
    }

    const namedIds: Set<string> = new Set(
      named.map((store: DataStore): string => {
        return store.id!.toString();
      }),
    );
    const reachedIds: Array<string> = Array.from(reachedThrough.keys()).filter(
      (id: string): boolean => {
        return !namedIds.has(id);
      },
    );
    const reached: Array<DataStore> =
      reachedIds.length > 0
        ? await DataStoreService.findBy({
            query: {
              projectId: data.projectId,
              _id: new Includes(
                reachedIds
                  .slice(0, DATA_AT_RISK_MAX_GRANTS)
                  .map((id: string): ObjectID => {
                    return new ObjectID(id);
                  }),
              ),
              isArchived: false,
            },
            select: STORE_SELECT,
            skip: 0,
            limit: DATA_AT_RISK_MAX_GRANTS,
            props: data.props,
          })
        : [];

    const atRisk: Array<SecurityCaseDataStoreAtRiskJson> = sortStoresAtRisk(
      [...named, ...reached].map(
        (store: DataStore): SecurityCaseDataStoreAtRiskJson => {
          const id: string = store.id!.toString();

          return {
            id,
            name: store.name || "",
            kind: store.kind || "",
            sensitivity: sensitivityOf(store),
            dataTypeIds: (store.dataTypeIds || []).slice(
              0,
              DATA_AT_RISK_MAX_DATA_TYPES,
            ),
            estimatedRecords:
              typeof store.estimatedRecords === "number"
                ? store.estimatedRecords
                : null,
            exposure: store.exposure || "",
            isNamedByCase: namedIds.has(id),
            reachedThrough: Array.from(reachedThrough.get(id) || []).sort(),
            identityCount: 0,
            externalIdentityCount: 0,
          };
        },
      ),
    );
    const listed: Array<SecurityCaseDataStoreAtRiskJson> = atRisk.slice(
      0,
      SECURITY_CASE_IMPACT_MAX_DATA_STORES,
    );

    await this.countWhoCanReach(data, listed);

    return {
      stores: listed,
      identities: identities
        .map(
          (identity: DataSecurityIdentity): SecurityCaseIdentityAtRiskJson => {
            return {
              id: identity.id!.toString(),
              name: identity.principalName || identity.principal || "",
              principal: identity.principal || "",
              principalType: identity.principalType || "",
              storeCount: identity.storeCount || 0,
              sensitiveStoreCount: identity.sensitiveStoreCount || 0,
              highestSensitivity:
                identity.highestSensitivity || DataSensitivity.Public,
              riskScore: identity.riskScore || 0,
            };
          },
        )
        .sort(
          (
            a: SecurityCaseIdentityAtRiskJson,
            b: SecurityCaseIdentityAtRiskJson,
          ): number => {
            return b.riskScore - a.riskScore || a.name.localeCompare(b.name);
          },
        ),
      hasMoreStores: atRisk.length > listed.length,
    };
  }

  // The project's identities the case's entities are.
  private static async readIdentities(
    data: { projectId: ObjectID; props: DatabaseCommonInteractionProps },
    candidates: IdentityCandidates,
  ): Promise<Array<DataSecurityIdentity>> {
    if (candidates.principals.length === 0) {
      return [];
    }

    const select: {
      _id: true;
      principal: true;
      principalName: true;
      principalType: true;
      storeCount: true;
      sensitiveStoreCount: true;
      highestSensitivity: true;
      riskScore: true;
    } = {
      _id: true,
      principal: true,
      principalName: true,
      principalType: true,
      storeCount: true,
      sensitiveStoreCount: true,
      highestSensitivity: true,
      riskScore: true,
    };
    const byPrincipal: Array<DataSecurityIdentity> =
      await DataSecurityIdentityService.findBy({
        query: {
          projectId: data.projectId,
          principal: new Includes(candidates.principals),
        },
        select,
        skip: 0,
        limit: SECURITY_CASE_IMPACT_MAX_IDENTITIES,
        props: data.props,
      });
    const byName: Array<DataSecurityIdentity> =
      candidates.names.length > 0
        ? (
            await DataSecurityIdentityService.findBy({
              query: {
                projectId: data.projectId,
                principalName: new Includes(
                  candidates.names.map(
                    (candidate: { name: string }): string => {
                      return candidate.name;
                    },
                  ),
                ),
              },
              select,
              skip: 0,
              limit: SECURITY_CASE_IMPACT_MAX_IDENTITIES * 5,
              props: data.props,
            })
          ).filter((identity: DataSecurityIdentity): boolean => {
            return isNamedIdentity(identity, candidates.names);
          })
        : [];
    const unique: Map<string, DataSecurityIdentity> = new Map();

    for (const identity of [...byPrincipal, ...byName]) {
      if (identity.id && !unique.has(identity.id.toString())) {
        unique.set(identity.id.toString(), identity);
      }
    }

    return Array.from(unique.values()).slice(
      0,
      SECURITY_CASE_IMPACT_MAX_IDENTITIES,
    );
  }

  // How many identities can reach each listed store, and how many of them are outside.
  private static async countWhoCanReach(
    data: { projectId: ObjectID; props: DatabaseCommonInteractionProps },
    stores: Array<SecurityCaseDataStoreAtRiskJson>,
  ): Promise<void> {
    if (stores.length === 0) {
      return;
    }

    const grants: Array<DataStoreAccess> = await DataStoreAccessService.findBy({
      query: {
        projectId: data.projectId,
        dataStoreId: new Includes(
          stores.map((store: SecurityCaseDataStoreAtRiskJson): ObjectID => {
            return new ObjectID(store.id);
          }),
        ),
      },
      select: { dataStoreId: true, principal: true, isExternal: true },
      skip: 0,
      limit: DATA_AT_RISK_MAX_GRANTS * 5,
      props: data.props,
    });
    const who: Map<string, Map<string, boolean>> = new Map();

    for (const grant of grants) {
      const storeId: string = grant.dataStoreId?.toString() || "";
      const principals: Map<string, boolean> = who.get(storeId) || new Map();

      principals.set(
        grant.principal || "",
        Boolean(principals.get(grant.principal || "")) ||
          Boolean(grant.isExternal),
      );
      who.set(storeId, principals);
    }

    for (const store of stores) {
      const principals: Map<string, boolean> = who.get(store.id) || new Map();

      store.identityCount = principals.size;
      store.externalIdentityCount = Array.from(principals.values()).filter(
        (isExternal: boolean): boolean => {
          return isExternal;
        },
      ).length;
    }
  }
}
