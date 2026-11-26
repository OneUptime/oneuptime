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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import StorageArrayDocumentationCard from "../../../Components/StorageArray/DocumentationCard";
import StorageArrayCollectedByCard from "../../../Components/StorageArray/Connection/StorageArrayCollectedByCard";
import StorageArrayProbeCollectors from "Common/Types/StorageArray/Collection/StorageArrayProbeCollectors";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";

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
          systemId: true,
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
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray) {
    return <ErrorMessage message="Storage array not found." />;
  }

  /*
   * No agent reads an array a probe reads from its management server
   * (#11004): its guide is the connection's, not the agent's install.
   */
  const collector: StorageArrayProbeCollector | null =
    StorageArrayProbeCollectors.getCollector(storageArray.storageSystem);

  if (collector) {
    return (
      <Fragment>
        <StorageArrayCollectedByCard
          storageSystem={collector.storageSystem}
          systemId={storageArray.systemId}
        />
        <div className="mt-5">
          <Card
            title="How This Array Is Read"
            description={collector.words.listDescription}
            buttons={[
              {
                title: "Read the Guide",
                icon: IconProp.Book,
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: () => {
                  Navigation.navigate(Route.fromString(collector.docsPath), {
                    openInNewTab: true,
                  });
                },
              },
            ]}
          />
        </div>
      </Fragment>
    );
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
