import CloudAiAgentSetupModal from "./CloudAiAgentSetupModal";
import { getCloudAccountAiResourceType } from "./CloudAiAgentSetup";
import ResourceAiAgentStatusSummaryCard from "../ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../ResourceAiAgent/ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  ResourceAiAttention,
  getResourceAiAccessRequestBody,
  getResourceAiAttention,
  parseResourceAiAccessStatus,
} from "../ResourceAiAgent/ResourceAiAgentStatus";
import useAiAgentAccessStatus, {
  AiAgentAccessStatusRead,
} from "../AiAccess/useAiAgentAccessStatus";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceAiAccessStatus } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The "AI agent" card on a cloud account's Overview. OneUptime AI reads
 * every connected account already; until a Cloud AI agent runs in it, the
 * card says so, with the one button that changes it: "Let AI fix
 * problems". Once an agent connected, it is the AI agent card every
 * resource an AI agent serves has — connected or not, how far AI may go,
 * and anything that needs attention — with its link to the AI agent page.
 */

export const CLOUD_AI_AGENT_CARD_TEST_ID: string = "cloud-ai-agent-card";

export interface ComponentProps {
  cloudAccountId: ObjectID;
  provider: CloudProvider;
  accountId: string;
  isAiLogReadEnabled: boolean;
  refreshToken?: number | undefined;
}

const CloudAiAgentCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSettingUp, setIsSettingUp] = useState<boolean>(false);
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const resourceType: AiResourceType | null = getCloudAccountAiResourceType(
    props.provider,
  );
  const descriptor: ResourceAiAgentDescriptor | null = resourceType
    ? getResourceAiAgentDescriptor(resourceType)
    : null;

  const read: AiAgentAccessStatusRead<ResourceAiAccessStatus> =
    useAiAgentAccessStatus<ResourceAiAccessStatus>({
      route: RESOURCE_AI_ACCESS_STATUS_ROUTE,
      body: descriptor
        ? getResourceAiAccessRequestBody(
            descriptor,
            props.cloudAccountId.toString(),
          )
        : {},
      parse: parseResourceAiAccessStatus,
      refreshToken: (props.refreshToken || 0) + refreshToken,
      isEnabled: Boolean(descriptor),
    });

  if (!descriptor) {
    return <></>;
  }

  const status: ResourceAiAccessStatus | null = read.status;

  // An agent connected once: the AI agent card every resource has.
  if (status?.agent) {
    return (
      <ResourceAiAgentStatusSummaryCard
        descriptor={descriptor}
        resourceId={props.cloudAccountId}
        refreshToken={(props.refreshToken || 0) + refreshToken}
      />
    );
  }

  const attention: ResourceAiAttention | null = status
    ? getResourceAiAttention(status, descriptor)
    : null;

  return (
    <Card
      title="AI agent"
      description="Let OneUptime AI fix problems in this account, not only read about them."
    >
      <div className="space-y-4" data-testid={CLOUD_AI_AGENT_CARD_TEST_ID}>
        {read.isLoading ? (
          <ComponentLoader />
        ) : (
          <div className="flex items-start gap-3">
            <Icon
              icon={IconProp.Automation}
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400"
            />
            <p
              className="text-sm text-gray-900"
              data-testid={`${CLOUD_AI_AGENT_CARD_TEST_ID}-sentence`}
            >
              {translator.translateText(
                translationKey(
                  "OneUptime AI can read this account but can't change it.",
                ),
              )}
            </p>
          </div>
        )}

        {attention ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3"
            data-testid={`${CLOUD_AI_AGENT_CARD_TEST_ID}-attention`}
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <p className="text-sm text-gray-800">{attention.title}</p>
          </div>
        ) : (
          <></>
        )}

        {status?.aiAccessLastError ? (
          <p
            className="text-xs text-rose-600"
            data-testid={`${CLOUD_AI_AGENT_CARD_TEST_ID}-last-error`}
          >
            {status.aiAccessLastError}
          </p>
        ) : (
          <></>
        )}

        {/* The button lines up with the sentence: no dialog footer margin. */}
        <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
          <Button
            title="Let AI fix problems"
            icon={IconProp.Automation}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId={`${CLOUD_AI_AGENT_CARD_TEST_ID}-set-up`}
            onClick={() => {
              setIsSettingUp(true);
            }}
          />
        </div>
      </div>

      {isSettingUp ? (
        <CloudAiAgentSetupModal
          descriptor={descriptor}
          cloudAccountId={props.cloudAccountId}
          provider={props.provider}
          accountId={props.accountId}
          isAiLogReadEnabled={props.isAiLogReadEnabled}
          status={status}
          onClose={() => {
            setIsSettingUp(false);
            setRefreshToken((token: number) => {
              return token + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default CloudAiAgentCard;
