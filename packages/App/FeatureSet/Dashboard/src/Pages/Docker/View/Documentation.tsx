import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
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
import DockerDocumentationCard from "../../../Components/Docker/DocumentationCard";

const DockerHostDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<DockerHost | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchHost: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: DockerHost | null = await ModelAPI.getItem({
        modelType: DockerHost,
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

  return (
    <Fragment>
      <DockerDocumentationCard
        title="Docker Agent Installation Guide"
        description="Follow these steps to install the OneUptime Docker Agent on this host."
      />
    </Fragment>
  );
};

export default DockerHostDocumentation;
