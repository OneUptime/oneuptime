import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
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
import XcpNgDocumentationCard from "../../../Components/XcpNg/DocumentationCard";

/*
 * The install guide for the agent that reads this pool: the agent runs
 * beside the Xen Orchestra that manages the pool, so the guide installs it
 * under that Xen Orchestra's name (XO_NAME), and a reinstall keeps naming it
 * the way the pool's Settings show it.
 */
const XcpNgPoolDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchPool: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: XcpNgPool | null = await ModelAPI.getItem({
        modelType: XcpNgPool,
        id: modelId,
        select: {
          name: true,
          xenOrchestraName: true,
        },
      });
      setPool(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchPool().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!pool) {
    return <ErrorMessage message="Pool not found." />;
  }

  return (
    <Fragment>
      <XcpNgDocumentationCard
        xenOrchestraName={pool.xenOrchestraName || undefined}
        title="XCP-ng Agent Installation Guide"
        description="Install or reconfigure the OneUptime XCP-ng Agent that reads this pool from Xen Orchestra. Pick how to install it, then follow the steps."
      />
    </Fragment>
  );
};

export default XcpNgPoolDocumentation;
