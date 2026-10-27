import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * The cloud account a tab is about: which cloud it is in and its id there
 * - what its resources and changes are read by. Each tab reads it, so a
 * tab stands on its own.
 */
export interface CloudAccountRead {
  account: CloudAccount | null;
  isLoading: boolean;
  error: string;
}

export default function useCloudAccount(modelId: ObjectID): CloudAccountRead {
  const [read, setRead] = useState<CloudAccountRead>({
    account: null,
    isLoading: true,
    error: "",
  });
  const id: string = modelId.toString();

  useEffect(() => {
    let ignore: boolean = false;

    setRead({ account: null, isLoading: true, error: "" });

    ModelAPI.getItem<CloudAccount>({
      modelType: CloudAccount,
      id: new ObjectID(id),
      select: {
        _id: true,
        name: true,
        provider: true,
        accountId: true,
        providerAccountName: true,
        resourceCount: true,
        lastSeenAt: true,
      },
    })
      .then((account: CloudAccount | null): void => {
        if (!ignore) {
          setRead({
            account,
            isLoading: false,
            error: account ? "" : "Cloud account not found.",
          });
        }
      })
      .catch((err: unknown): void => {
        if (!ignore) {
          setRead({
            account: null,
            isLoading: false,
            error: API.getFriendlyMessage(err),
          });
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [id]);

  return read;
}
