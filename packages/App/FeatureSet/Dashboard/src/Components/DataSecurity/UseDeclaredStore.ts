import DataSecurityApi from "./DataSecurityApi";
import { DataSecurityDeclaredStoreResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";

/*
 * What the record of processing says of a store OneUptime declares
 * (#10398), read for its pages: null while it is read, or for a store that
 * is not one (isDeclared false, which reads nothing).
 */
export interface DeclaredStoreState {
  answer: DataSecurityDeclaredStoreResponse | null;
  error: string;
  readAgain: () => void;
}

export default function useDeclaredStore(
  dataStoreId: ObjectID,
  isDeclared: boolean,
): DeclaredStoreState {
  const [answer, setAnswer] =
    useState<DataSecurityDeclaredStoreResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const dataStoreIdString: string = dataStoreId.toString();

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    if (!isDeclared) {
      setAnswer(null);
      return;
    }

    DataSecurityApi.getDeclaredStore(dataStoreId)
      .then((response: DataSecurityDeclaredStoreResponse) => {
        if (isCurrent) {
          setAnswer(response);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dataStoreIdString, isDeclared, readCount]);

  return {
    answer,
    error,
    readAgain: (): void => {
      setReadCount((count: number): number => {
        return count + 1;
      });
    },
  };
}
