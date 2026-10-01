import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
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
import PodmanDocumentationCard from "../../../Components/Podman/DocumentationCard";

const PodmanHostDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<PodmanHost | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchHost: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: PodmanHost | null = await ModelAPI.getItem({
        modelType: PodmanHost,
        id: modelId,
        select: {
          name: true,
          hostIdentifier: true,
        },
      });
      setHost(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHost().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const hostName: string = host.hostIdentifier || host.name || "";

  return (
    <Fragment>
      <PodmanDocumentationCard
        hostName={hostName}
        title="Agent Installation Guide"
        description="Install or reconfigure the OneUptime Podman agent on this host. Pick how you run it, then follow the steps."
      />
    </Fragment>
  );
};

export default PodmanHostDocumentation;
