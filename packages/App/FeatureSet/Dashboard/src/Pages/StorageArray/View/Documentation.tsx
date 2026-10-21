import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import StorageArrayDocumentationCard from "../../../Components/StorageArray/DocumentationCard";

const StorageArrayDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [storageArray, setStorageArray] = useState<StorageArray | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStorageArray: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: StorageArray | null = await ModelAPI.getItem({
        modelType: StorageArray,
        id: modelId,
        select: {
          name: true,
          storageSystem: true,
        },
      });
      setStorageArray(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchStorageArray().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray) {
    return <ErrorMessage message="Storage array not found." />;
  }

  return (
    <Fragment>
      <StorageArrayDocumentationCard
        arrayName={storageArray.name || ""}
        storageSystem={storageArray.storageSystem}
        title="Storage Array Agent Installation Guide"
        description="Install or reconfigure the OneUptime Storage Array Agent for this array. Pick the platform, then follow the steps."
      />
    </Fragment>
  );
};

export default StorageArrayDocumentation;
