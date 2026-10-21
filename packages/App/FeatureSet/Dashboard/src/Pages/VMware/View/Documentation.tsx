import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
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
import VMwareDocumentationCard from "../../../Components/VMware/DocumentationCard";

const VMwareVCenterDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchVCenter: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
        },
      });
      setVCenter(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchVCenter().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!vcenter) {
    return <ErrorMessage message="vCenter not found." />;
  }

  return (
    <Fragment>
      <VMwareDocumentationCard
        vcenterName={vcenter.name || ""}
        title="VMware Agent Installation Guide"
        description="Install or reconfigure the OneUptime VMware agent for this vCenter. Pick how to install it, then follow the steps."
      />
    </Fragment>
  );
};

export default VMwareVCenterDocumentation;
