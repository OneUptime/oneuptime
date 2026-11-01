import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import {
  getCloudAccountAiResourceType,
  readCloudProvider,
} from "../../../../../Components/Cloud/CloudAiAgentSetup";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import ObjectID from "Common/Types/ObjectID";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

/*
 * A cloud account's AI pages read the account first: its cloud decides
 * which AI resource type it is (AwsAccount, AzureSubscription or
 * GoogleCloudProject), and so which descriptor the generic AI pages get.
 */
export interface CloudAccountAiDescriptorRead {
  descriptor: ResourceAiAgentDescriptor | null;
  account: CloudAccount | null;
  provider: CloudProvider | null;
  isLoading: boolean;
  error: string;
}

export default function useCloudAccountAiDescriptor(): CloudAccountAiDescriptorRead {
  const { id } = useParams();
  const modelId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);
  const [read, setRead] = useState<CloudAccountAiDescriptorRead>({
    descriptor: null,
    account: null,
    provider: null,
    isLoading: true,
    error: "",
  });

  useEffect(() => {
    let isMounted: boolean = true;

    ModelAPI.getItem<CloudAccount>({
      modelType: CloudAccount,
      id: modelId,
      select: {
        _id: true,
        name: true,
        provider: true,
        accountId: true,
        isAiLogReadEnabled: true,
      },
    })
      .then((account: CloudAccount | null): void => {
        if (!isMounted) {
          return;
        }

        const provider: CloudProvider | null = readCloudProvider(
          account?.provider,
        );
        const type: AiResourceType | null =
          getCloudAccountAiResourceType(provider);

        setRead({
          descriptor: type ? getResourceAiAgentDescriptor(type) : null,
          account,
          provider,
          isLoading: false,
          error: account ? "" : "Cloud account not found.",
        });
      })
      .catch((error: Error): void => {
        if (isMounted) {
          setRead({
            descriptor: null,
            account: null,
            provider: null,
            isLoading: false,
            error: API.getFriendlyMessage(error),
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [modelId.toString()]);

  return read;
}
