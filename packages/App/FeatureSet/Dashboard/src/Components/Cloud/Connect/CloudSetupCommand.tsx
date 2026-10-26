import {
  CloudConnectionAuthMethod,
  CloudConnectionAuthMethodDefinition,
  CloudConnectionDefinition,
  getCloudConnectionAuthMethodDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionAwsRoleSetup,
  CloudConnectionSetupScope,
  getCloudConnectionSetupCommand,
} from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import IconProp from "Common/Types/Icon/IconProp";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { cloudConnectionDocsUrl } from "./CloudConnectApi";

/*
 * Step one of connecting a cloud: the one command that creates read-only
 * access, with the cloud's own browser terminal a click away. What the
 * command creates is said above it, and what OneUptime may do with the
 * access under it; the step-by-step guide is there for anyone who would
 * rather click through the cloud's console.
 */

export interface ComponentProps {
  definition: CloudConnectionDefinition;
  method: CloudConnectionAuthMethod;
  // The account the command is run in, or its whole organization.
  scope?: CloudConnectionSetupScope | undefined;
  /*
   * AWS role only: what the role trusts. Undefined while it loads; the
   * command is shown once it is known.
   */
  roleSetup?: CloudConnectionAwsRoleSetup | undefined;
}

const CloudSetupCommand: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const method: CloudConnectionAuthMethodDefinition | undefined =
    getCloudConnectionAuthMethodDefinition(props.definition, props.method);
  const command: string | undefined = getCloudConnectionSetupCommand(
    props.definition.provider,
    props.method,
    {
      trustedPrincipalArn: props.roleSetup?.trustedPrincipalArn,
      externalId: props.roleSetup?.externalId,
      scope: props.scope,
    },
  );

  return (
    <div className="space-y-3" data-testid="cloud-setup-command">
      {method ? (
        <p className="text-sm text-gray-700">
          {translator.translateText(method.hint)}
        </p>
      ) : (
        <></>
      )}

      {command ? (
        /*
         * Tall enough for every cloud's whole command: what someone runs in
         * their cloud they read first.
         */
        <div data-testid="cloud-setup-command-code">
          <CodeBlock
            code={command}
            language="bash"
            wrapLongLines={true}
            maxHeight="340px"
          />
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-4 text-sm text-gray-500"
          data-testid="cloud-setup-command-loading"
        >
          <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
          <span>{translator.translateText("Getting the command ready…")}</span>
        </div>
      )}

      {/*
       * The shell's button keeps its name on one line (it wrapped beside
       * the guide in German and for Azure); the guide moves under it when
       * both do not fit.
       */}
      <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
        <a
          href={props.definition.shellUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="cloud-setup-open-shell"
          className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <Icon icon={IconProp.Terminal} className="h-4 w-4" />
          <span>
            {translator.translateTemplate("Open {{shell}}", {
              shell: props.definition.shellTitle,
            })}
          </span>
          <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
        </a>
        <a
          href={cloudConnectionDocsUrl(props.definition.docsPath).toString()}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="cloud-setup-guide-link"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Icon icon={IconProp.Book} className="h-4 w-4" />
          <span>
            {translator.translateText("Prefer the console? Step-by-step guide")}
          </span>
        </a>
      </div>

      <div
        className="flex items-start gap-1.5 border-t border-gray-200 pt-3 text-xs text-gray-500"
        data-testid="cloud-setup-read-only"
      >
        <Icon
          icon={IconProp.ShieldCheck}
          className="mt-px h-3.5 w-3.5 flex-shrink-0"
        />
        <span>{translator.translateText(props.definition.explanation)}</span>
      </div>
    </div>
  );
};

export default CloudSetupCommand;
