import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import KindsWithOwners from "../../Types/Database/AccessControl/KindsWithOwners";
import { JSONObject } from "../../Types/JSON";
import { RecordOwners } from "../../Types/LabelAccess/LabelAccess";
import RecordOwnership, {
  RecordOwnershipResult,
} from "../../Types/RecordAccess/RecordOwnership";
import { APP_API_URL } from "../Config";
import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";
import RecordLocks, { RecordOwnershipFacts } from "./RecordLocks";
import React from "react";

/*
 * WHO OWNS THE RECORDS ON SCREEN, READ FROM THE SERVER ONCE FOR THEM
 * (#11436, Types/RecordAccess/RecordOwnership).
 *
 * A grant scoped to Owned reaches only the records the reader, or the team
 * it is given to, owns - which the reader's permission snapshot cannot
 * tell. A record's page (ModelPage) reads it for its record, and a list
 * (ModelTable) for the rows it shows: one request, POST
 * /<record>/record-ownership, answered from the lookups the server's Owned
 * scope narrows every write by. Read only for a reader who holds a grant
 * scoped to Owned at all, and only of a kind with owner tables
 * (KindsWithOwners): nobody else's locks depend on it, so nobody else asks.
 *
 * An answer that cannot be read leaves the owners to decide - nothing is
 * locked by them, and the server keeps the last word on every write.
 */

export const readRecordOwnership: (data: {
  modelType: { new (): BaseModel };
  ids: ReadonlyArray<string>;
}) => Promise<RecordOwnershipResult> = async (data: {
  modelType: { new (): BaseModel };
  ids: ReadonlyArray<string>;
}): Promise<RecordOwnershipResult> => {
  const path: string = new data.modelType().getCrudApiPath()?.toString() || "";

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromURL(APP_API_URL).addRoute(
        `${path}${RecordOwnership.routePath}`,
      ),
      data: { ids: [...data.ids] },
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const result: RecordOwnershipResult | null = RecordOwnership.fromJSON(
    response.data,
  );

  if (!result) {
    throw new Error(
      "Who owns these records could not be read from the server's answer.",
    );
  }

  return result;
};

/*
 * Whether a page asks who owns its records of `modelType`: a kind with
 * owner tables, for a reader with a grant scoped to Owned.
 */
export const isRecordOwnershipWanted: (
  modelType: { new (): BaseModel } | null | undefined,
) => boolean = (
  modelType: { new (): BaseModel } | null | undefined,
): boolean => {
  if (!modelType) {
    return false;
  }

  return (
    KindsWithOwners.hasOwnerTables(new modelType().tableName) &&
    RecordLocks.hasOwnedScopedGrants()
  );
};

export interface RecordOwnershipState {
  // The answer for the records asked about, or null: not wanted, not read, or unreadable.
  result: RecordOwnershipResult | null;
  /*
   * Whether there is nothing more to wait for: the answer landed, could not
   * be read, or was never wanted. While false, what the owners decide is
   * not known yet.
   */
  isRead: boolean;
}

/*
 * What a weigh of one record reads of the answer: who owns it, with the
 * answer itself (which tables and operations they decide). Null while the
 * answer says nothing of it: not read yet, or a record it leaves out.
 */
export const getRecordOwnershipFacts: (
  result: RecordOwnershipResult | null | undefined,
  recordId: string | null | undefined,
) => RecordOwnershipFacts | null = (
  result: RecordOwnershipResult | null | undefined,
  recordId: string | null | undefined,
): RecordOwnershipFacts | null => {
  const owners: RecordOwners | null = RecordOwnership.getOwners(
    result,
    recordId,
  );

  if (!result || !owners) {
    return null;
  }

  return { owners: owners, ownership: result };
};

/*
 * Who owns `ids`, records of `modelType`, read once for each set of them -
 * and again when `refresh` changes (a page bumps it when the record's
 * owners change). Nothing is read when `isWanted` is false or there is no
 * record to ask about: the state is then read, with no answer.
 */
export const useRecordOwnership: (data: {
  modelType: { new (): BaseModel };
  ids: ReadonlyArray<string>;
  isWanted: boolean;
  refresh?: number | undefined;
}) => RecordOwnershipState = (data: {
  modelType: { new (): BaseModel };
  ids: ReadonlyArray<string>;
  isWanted: boolean;
  refresh?: number | undefined;
}): RecordOwnershipState => {
  const tableName: string = new data.modelType().tableName || "";
  const key: string = Array.from(
    new Set<string>(
      data.ids
        .map((id: string): string => {
          return id.toString().trim().toLowerCase();
        })
        .filter(Boolean),
    ),
  )
    .sort()
    .join(",");

  const askedKey: string = data.isWanted && key ? `${tableName}|${key}` : "";

  const [answer, setAnswer] = React.useState<{
    key: string;
    result: RecordOwnershipResult | null;
  } | null>(null);

  React.useEffect(() => {
    if (!askedKey) {
      return undefined;
    }

    let isCurrent: boolean = true;

    readRecordOwnership({
      modelType: data.modelType,
      ids: key.split(","),
    })
      .then((result: RecordOwnershipResult) => {
        if (isCurrent) {
          setAnswer({ key: askedKey, result: result });
        }
      })
      .catch(() => {
        // The owners decide: nothing is locked by them.
        if (isCurrent) {
          setAnswer({ key: askedKey, result: null });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [askedKey, data.refresh]);

  if (!askedKey) {
    return { result: null, isRead: true };
  }

  // Only the answer for the records asked about now: none for the last ones.
  if (!answer || answer.key !== askedKey) {
    return { result: null, isRead: false };
  }

  return { result: answer.result, isRead: true };
};
