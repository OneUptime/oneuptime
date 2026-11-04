import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
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
import OpenStackDocumentationCard from "../../../Components/OpenStack/DocumentationCard";

const OpenStackCloudDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cloud, setCloud] = useState<OpenStackCloud | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchCloud: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: OpenStackCloud | null = await ModelAPI.getItem({
        modelType: OpenStackCloud,
        id: modelId,
        select: {
          name: true,
        },
      });
      setCloud(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCloud().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloud) {
    return <ErrorMessage message="Cloud not found." />;
  }

  return (
    <Fragment>
      <OpenStackDocumentationCard
        cloudName={cloud.name || ""}
        title="OpenStack Agent Installation Guide"
        description="Install or reconfigure the OneUptime OpenStack agent for this cloud. Pick how to install it, then follow the steps."
      />
    </Fragment>
  );
};

export default OpenStackCloudDocumentation;
