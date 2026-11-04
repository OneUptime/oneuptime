import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import OpenStackCostCalculator from "./OpenStackCostCalculator";
import IconProp from "Common/Types/Icon/IconProp";
import SetupGuideCard, {
  SetupGuideFrameProps,
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent, SetupGuideOption } from "../SetupGuide/SetupGuide";
import SetupGuideOptionPicker from "../SetupGuide/SetupGuideOptionPicker";
import {
  DEFAULT_OPENSTACK_CONNECT_METHOD,
  OPENSTACK_CONNECT_METHODS,
  OpenStackConnectMethod,
  getOpenStackSetupGuide,
  resolveOpenStackConnectMethod,
} from "../../Pages/OpenStack/Utils/DocumentationMarkdown";
import {
  DEFAULT_OPENSTACK_DEPLOYMENT_TOOL,
  OPENSTACK_DEPLOYMENT_TOOLS,
  OpenStackDeploymentTool,
  doesOpenStackToolUseAgent,
  resolveOpenStackDeploymentTool,
} from "../../Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps extends SetupGuideFrameProps {
  title: string;
  description: string;
  /*
   * The cloud being set up (its Documentation tab). Omitted on the product
   * pages, where the guide suggests a name for a new cloud instead.
   */
  cloudName?: string | undefined;
}

const OpenStackDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [tool, setTool] = useState<OpenStackDeploymentTool>(
    DEFAULT_OPENSTACK_DEPLOYMENT_TOOL,
  );
  const [method, setMethod] = useState<OpenStackConnectMethod>(
    DEFAULT_OPENSTACK_CONNECT_METHOD,
  );

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  return (
    <Fragment>
      <SetupGuideCard
        title={props.title}
        description={props.description}
        icon={IconProp.Cloud}
        newKeyName={translationKey("OpenStack key")}
        optionsLabel="How do you deploy OpenStack?"
        options={OPENSTACK_DEPLOYMENT_TOOLS}
        initialOption={DEFAULT_OPENSTACK_DEPLOYMENT_TOOL}
        onOptionChange={(option: string): void => {
          setTool(resolveOpenStackDeploymentTool(option));
        }}
        optionsNote={
          // Only where there is an agent to install: a probe reads the other tools' clouds.
          doesOpenStackToolUseAgent(tool) ? (
            <div className="mt-4">
              <SetupGuideOptionPicker
                label={translate("How do you want to install the agent?")}
                options={OPENSTACK_CONNECT_METHODS.map(
                  (
                    option: SetupGuideOption<OpenStackConnectMethod>,
                  ): SetupGuideOption<OpenStackConnectMethod> => {
                    return {
                      ...option,
                      label: translate(option.label),
                      description: option.description
                        ? translate(option.description)
                        : undefined,
                      badge: option.badge ? translate(option.badge) : undefined,
                    };
                  },
                )}
                selectedKey={method}
                onSelect={(key: string): void => {
                  setMethod(resolveOpenStackConnectMethod(key));
                }}
                layout="pills"
              />
            </div>
          ) : undefined
        }
        keyStepDescription={translationKey(
          "The agent sends your cloud's metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it.",
        )}
        getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
          return getOpenStackSetupGuide({
            oneuptimeUrl: context.oneuptimeUrl,
            apiKey: context.apiKey,
            hasApiKey: context.hasApiKey,
            method: method,
            cloudName: props.cloudName,
            tool: resolveOpenStackDeploymentTool(context.option),
          });
        }}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
      <OpenStackCostCalculator />
    </Fragment>
  );
};

export default OpenStackDocumentationCard;
