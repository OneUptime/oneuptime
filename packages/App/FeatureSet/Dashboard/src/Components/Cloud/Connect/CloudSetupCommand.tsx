import {
  CloudConnectionAuthMethod,
  CloudConnectionAuthMethodDefinition,
  CloudConnectionDataSecurityLevel,
  CloudConnectionDataSecurityResponse,
  CloudConnectionDefinition,
  CloudConnectionWafBlocklist,
  getCloudConnectionAuthMethodDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionAccessExtra,
  CloudConnectionAwsRoleSetup,
  CloudConnectionSetupScope,
  getCloudConnectionAccessExtras,
  getCloudConnectionSetupCommand,
} from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { cloudConnectionDocsUrl } from "./CloudConnectApi";

/*
 * Step one of connecting a cloud: the one command that creates the access,
 * with the cloud's own browser terminal a click away. What the command
 * creates is said above it, and what OneUptime may do with the access
 * under it; the step-by-step guide is there for anyone who would rather
 * click through the cloud's console.
 *
 * The command is written from the settings the form holds - what to read,
 * and Data Security's two settings and AWS's Block addresses in AWS WAF
 * folded under it - so it grants what the connection is saved to use
 * (#10336, #10344). Most commands only read, and never data: the method's
 * hint and the cloud's explanation say so. One that also reads content
 * samples, may close an exposure or keeps the blocklist in AWS WAF says
 * what it creates without "can only read", and a line for each of those
 * under it (getCloudConnectionAccessExtras), so nothing beside the command
 * says it grants less than it does.
 */

/*
 * Where a whole organization's command is run, and what it creates: it has
 * to reach every account, so it is run where that is allowed - an AWS
 * Organization's management account, by someone who may assign roles on
 * the Azure tenant's root management group or on the Google Cloud
 * organization. Run anywhere else, it fails part way.
 */
export const ORGANIZATION_SETUP_HINTS: Readonly<Record<CloudProvider, string>> =
  {
    [CloudProvider.AWS]: translationKey(
      "Run this in AWS CloudShell in your organization's management account. It puts a role that can only read in every account, and prints the management account's role ARN.",
    ),
    [CloudProvider.Azure]: translationKey(
      "Run this in Azure Cloud Shell as someone who may assign roles on the tenant's root management group. It creates an app that can only read every subscription, and prints its details.",
    ),
    [CloudProvider.GCP]: translationKey(
      "Run this in Google Cloud Shell in a project of your organization, as someone who may grant roles on it. It creates a service account that can only read every project, and prints its key.",
    ),
  };

/*
 * The same hints for a command that grants more than reading how things
 * are set up: where it is run and what it prints, as above, and that what
 * it creates has the access the lines under the command list - never "can
 * only read". One for each method of one account, one for each cloud's
 * organization.
 */
export const SETUP_HINTS_FOR_ACCESS_BELOW: Readonly<
  Record<CloudConnectionAuthMethod, string>
> = {
  [CloudConnectionAuthMethod.AwsRole]: translationKey(
    "Run this in AWS CloudShell. It creates a role with the access below, and prints the role's ARN.",
  ),
  [CloudConnectionAuthMethod.AwsAccessKey]: translationKey(
    "Run this in AWS CloudShell. It creates a user with the access below, and prints its access key.",
  ),
  [CloudConnectionAuthMethod.AzureClientSecret]: translationKey(
    "Run this in Azure Cloud Shell. It creates an app with the access below, and prints its details.",
  ),
  [CloudConnectionAuthMethod.GcpServiceAccountKey]: translationKey(
    "Run this in Cloud Shell, in the project to monitor. It creates a service account with the access below, and prints its key.",
  ),
};

export const ORGANIZATION_SETUP_HINTS_FOR_ACCESS_BELOW: Readonly<
  Record<CloudProvider, string>
> = {
  [CloudProvider.AWS]: translationKey(
    "Run this in AWS CloudShell in your organization's management account. It puts a role with the access below in every account, and prints the management account's role ARN.",
  ),
  [CloudProvider.Azure]: translationKey(
    "Run this in Azure Cloud Shell as someone who may assign roles on the tenant's root management group. It creates an app with the access below on every subscription, and prints its details.",
  ),
  [CloudProvider.GCP]: translationKey(
    "Run this in Google Cloud Shell in a project of your organization, as someone who may grant roles on it. It creates a service account with the access below on every project, and prints its key.",
  ),
};

/*
 * What the access may do, under such a command: what every connection
 * reads - as each cloud's explanation says, without "only" and "never
 * data" - then a line for each thing it grants beyond that.
 */
export const ACCESS_READS_LINE: string = translationKey(
  "OneUptime reads metrics, resources and how they are set up, changes and health events.",
);

export const ACCESS_EXTRA_LINES: Readonly<
  Record<CloudConnectionAccessExtra, string>
> = {
  [CloudConnectionAccessExtra.ContentSamples]: translationKey(
    "Data Security also reads samples of what your data stores hold, to find sensitive data.",
  ),
  [CloudConnectionAccessExtra.DataSecurityResponse]: translationKey(
    "Data Security may also close a data store's exposures and fix its settings. Each change is approved by a person unless a playbook says otherwise.",
  ),
  [CloudConnectionAccessExtra.WafIpSets]: translationKey(
    "Your blocklist may also keep OneUptime's own IP sets in AWS WAF, and read the requests web ACLs sampled.",
  ),
  [CloudConnectionAccessExtra.WafRule]: translationKey(
    "OneUptime may also add its rule to the web ACLs you pick, and changes no rule of yours.",
  ),
  [CloudConnectionAccessExtra.WafPolicyRules]: translationKey(
    "Your blocklist may also keep OneUptime's own rules in the WAF policies you pick, and changes no rule of yours.",
  ),
};

const ACCESS_EXTRA_ICONS: Readonly<
  Record<CloudConnectionAccessExtra, IconProp>
> = {
  [CloudConnectionAccessExtra.ContentSamples]: IconProp.DocumentMagnifyingGlass,
  [CloudConnectionAccessExtra.DataSecurityResponse]: IconProp.Wrench,
  [CloudConnectionAccessExtra.WafIpSets]: IconProp.NoSymbol,
  [CloudConnectionAccessExtra.WafRule]: IconProp.ShieldCheck,
  [CloudConnectionAccessExtra.WafPolicyRules]: IconProp.ShieldCheck,
};

export interface ComponentProps {
  definition: CloudConnectionDefinition;
  method: CloudConnectionAuthMethod;
  // The account the command is run in, or its whole organization.
  scope?: CloudConnectionSetupScope | undefined;
  // What Data Security may read of the account. Off when absent.
  dataSecurity?: CloudConnectionDataSecurityLevel | undefined;
  // Whether Data Security may close a data store's exposure. Off when absent.
  dataSecurityResponse?: CloudConnectionDataSecurityResponse | undefined;
  // AWS: whether the blocklist may block addresses in AWS WAF. Off when absent.
  wafBlocklist?: CloudConnectionWafBlocklist | undefined;
  /*
   * AWS: what a role trusts, and the project's external id, which names a
   * role and the blocklist's IP sets. Undefined while it loads; the command
   * is shown once it is known.
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
      dataSecurity: props.dataSecurity,
      dataSecurityResponse: props.dataSecurityResponse,
      wafBlocklist: props.wafBlocklist,
    },
  );
  // What the command grants beyond reading how things are set up, if anything.
  const extras: Array<CloudConnectionAccessExtra> =
    getCloudConnectionAccessExtras({
      dataSecurity: props.dataSecurity,
      dataSecurityResponse: props.dataSecurityResponse,
      wafBlocklist: props.wafBlocklist,
      provider: props.definition.provider,
    });
  const isOrganization: boolean =
    props.scope === CloudConnectionSetupScope.Organization;

  const hint: string | undefined =
    extras.length === 0
      ? isOrganization
        ? ORGANIZATION_SETUP_HINTS[props.definition.provider]
        : method?.hint
      : isOrganization
        ? ORGANIZATION_SETUP_HINTS_FOR_ACCESS_BELOW[props.definition.provider]
        : SETUP_HINTS_FOR_ACCESS_BELOW[props.method];

  return (
    <div className="space-y-3" data-testid="cloud-setup-command">
      {hint ? (
        <p className="text-sm text-gray-700" data-testid="cloud-setup-hint">
          {translator.translateText(hint)}
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

      {extras.length === 0 ? (
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
      ) : (
        /*
         * The access below, as the hint above names it: what every
         * connection reads, then each thing this command grants besides.
         */
        <ul
          className="space-y-1.5 border-t border-gray-200 pt-3 text-xs text-gray-500"
          data-testid="cloud-setup-access"
        >
          <li
            className="flex items-start gap-1.5"
            data-testid="cloud-setup-access-reads"
          >
            <Icon
              icon={IconProp.Eye}
              className="mt-px h-3.5 w-3.5 flex-shrink-0"
            />
            <span>{translator.translateText(ACCESS_READS_LINE)}</span>
          </li>
          {extras.map((extra: CloudConnectionAccessExtra): ReactElement => {
            return (
              <li
                key={extra}
                className="flex items-start gap-1.5"
                data-testid={`cloud-setup-access-${extra}`}
              >
                <Icon
                  icon={ACCESS_EXTRA_ICONS[extra]}
                  className="mt-px h-3.5 w-3.5 flex-shrink-0"
                />
                <span>
                  {translator.translateText(ACCESS_EXTRA_LINES[extra])}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CloudSetupCommand;
