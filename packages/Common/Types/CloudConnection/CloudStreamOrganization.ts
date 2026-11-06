import { isAwsRegion } from "../Cloud/AwsRegionCode";
import { translationKey } from "../Translator";
import {
  getAwsOrganizationStartLines,
  getAwsStackSetDeleteLines,
  getAwsStackSetDeployLine,
  getAwsStackSetEveryAccountLine,
  getAwsStackSetHomeRegionLine,
  getAwsStackSetInstancesCommand,
  quoteForShell,
} from "./AwsStackSets";
import { isAwsAccountId } from "./CloudOrganizationAgents";
import {
  CLOUD_STREAM_TEMPLATE_FILE,
  CloudStreamLogsMode,
  CloudStreamTemplateOptions,
  getAwsCloudStreamTemplateBody,
  getCloudStreamCommandRegions,
  getCloudStreamNames,
} from "./CloudStreamTemplate";

/*
 * STREAMING EVERY ACCOUNT OF AN AWS ORGANIZATION, IN ONE COMMAND.
 *
 * A connection that reads an AWS Organization (its management account's
 * role, and the same role in each member account) streams every account
 * of it with one command, run in the management account's CloudShell:
 *
 *   - the same template as one account's (CloudStreamTemplate), as a
 *     StackSet named as the account's stack is (AwsStackSets, the helpers
 *     the Cloud AI agent's organization command uses too): in every account
 *     under the organization's root, in the same Regions, and in accounts
 *     that join the organization later (auto-deployment - the stream key is
 *     the connection's, the same in every account);
 *   - and the management account's own stacks, as one account's command
 *     deploys them, since StackSets never deploys to the management
 *     account.
 *
 * Each delivery names the account it is from, so what a member account
 * streams lands on that account's resources. The StackSet lives in one
 * Region, its home - US East (N. Virginia), or CloudShell's own in a
 * partition without it - so the commands that update, check and delete it
 * find it from any Region.
 *
 * Named log groups are one account's: an organization streams every log
 * group, or metrics alone (isCloudStreamOrganizationPossible). One
 * account's command checks that account's log subscription limits before
 * it deploys; a member account cannot be read from the management account,
 * so here a limit met fails that account's stack alone, which the
 * StackSet's instances (getAwsCloudStreamOrganizationInstancesCommand)
 * say.
 */

// The shell variable the StackSet's home Region is in.
const STREAM_HOME_VARIABLE: string = "STREAM_HOME";
const STREAM_HOME: string = `"$${STREAM_HOME_VARIABLE}"`;

// What the dialog says when the choices name log groups.
export const CLOUD_STREAM_ORGANIZATION_LOG_GROUPS_REFUSAL: string =
  translationKey(
    "Named log groups are one account's. To stream every account of the organization, stream every log group, or metrics alone.",
  );

// Whether these choices can be streamed from every account of an organization.
export function isCloudStreamOrganizationPossible(
  options: Pick<CloudStreamTemplateOptions, "logs">,
): boolean {
  return options.logs !== CloudStreamLogsMode.Groups;
}

// What the command says when it is pasted into another account's shell.
export function getCloudStreamOrganizationWrongAccountMessage(
  managementAccountId: string,
): string {
  return `This command is for your AWS Organization's management account ${managementAccountId}, and this shell is signed in to another one. Open CloudShell in AWS account ${managementAccountId} and run the command there.`;
}

// What it prints once the StackSet's stacks are on their way.
export const CLOUD_STREAM_ORGANIZATION_STARTED_MESSAGE: string =
  "The streams are being set up in every account of the organization. StackSets makes each account's stacks in the background: the dialog says when deliveries arrive.";

// The Regions as one shell word list; CloudShell's own when none is known.
function getRegionList(regions: Array<string>): string {
  return regions.length > 0 ? regions.join(" ") : '"${AWS_REGION:-us-east-1}"';
}

/*
 * The command, for the management account's CloudShell: the template and
 * the key, then - in the management account only - StackSets' access to
 * the organization, the StackSet with every account's stacks, and the
 * management account's own stacks. A key of null leaves STREAM_KEY for the
 * person to fill in, as one account's command does.
 */
export function getAwsCloudStreamOrganizationCommand(data: {
  options: CloudStreamTemplateOptions;
  regions: Array<string>;
  streamKey: string | null;
  // The organization's management account: where the command runs.
  managementAccountId: string;
}): string {
  const names: ReturnType<typeof getCloudStreamNames> = getCloudStreamNames(
    data.options.connectionId,
  );
  const regionList: string = getRegionList(
    getCloudStreamCommandRegions({
      regions: data.regions,
      logs: data.options.logs,
      logGroups: data.options.logGroups,
      metrics: data.options.metrics,
    }),
  );
  const management: string = isAwsAccountId(data.managementAccountId)
    ? data.managementAccountId
    : "";

  return [
    `cat > ${CLOUD_STREAM_TEMPLATE_FILE} <<'TEMPLATE'`,
    getAwsCloudStreamTemplateBody(data.options),
    "TEMPLATE",
    `STREAM_KEY=${quoteForShell(data.streamKey || "<YOUR_STREAM_KEY>")}`,
    "ACCOUNT=$(aws sts get-caller-identity --query Account --output text)",
    `if [ "$ACCOUNT" != ${quoteForShell(management)} ]; then`,
    `  echo ${quoteForShell(getCloudStreamOrganizationWrongAccountMessage(management))}`,
    "else",
    `  ${getAwsStackSetHomeRegionLine({ variable: STREAM_HOME_VARIABLE, region: null })}`,
    ...getAwsOrganizationStartLines().map((line: string): string => {
      return `  ${line}`;
    }),
    `  ${getAwsStackSetDeployLine({
      stackSetName: names.stackName,
      homeRegion: STREAM_HOME,
      templateFile: CLOUD_STREAM_TEMPLATE_FILE,
      description:
        "OneUptime: CloudWatch metrics and logs of every account of the organization, streamed by Amazon Data Firehose.",
      capabilities: "CAPABILITY_IAM",
      parameters: [
        { key: "StreamKey", value: null, shellVariable: "STREAM_KEY" },
      ],
      autoDeployment: true,
    })}`,
    `  ${getAwsStackSetEveryAccountLine({
      stackSetName: names.stackName,
      homeRegion: STREAM_HOME,
      regions: regionList,
    })}`,
    // The management account, which StackSets never deploys to: its own stacks, as one account's command makes them.
    `  for REGION in ${regionList}; do`,
    `    aws cloudformation deploy --region "$REGION" --stack-name ${names.stackName} --template-file ${CLOUD_STREAM_TEMPLATE_FILE} --capabilities CAPABILITY_IAM --parameter-overrides "StreamKey=$STREAM_KEY" --no-fail-on-empty-changeset`,
    "  done",
    `  echo ${quoteForShell(CLOUD_STREAM_ORGANIZATION_STARTED_MESSAGE)}`,
    "fi",
  ].join("\n");
}

/*
 * Where each member account's stacks stand - Region, status and, for one
 * that failed, why - in the management account's CloudShell.
 */
export function getAwsCloudStreamOrganizationInstancesCommand(
  connectionId: string,
): string {
  return [
    getAwsStackSetHomeRegionLine({
      variable: STREAM_HOME_VARIABLE,
      region: null,
    }),
    getAwsStackSetInstancesCommand({
      stackSetName: getCloudStreamNames(connectionId).stackName,
      homeRegion: STREAM_HOME,
    }),
  ].join("\n");
}

/*
 * Stopping for good, in the management account's CloudShell: its own stack
 * in each Region, then - when the organization's StackSet is there - every
 * member account's stacks and the StackSet. The buckets of failed
 * deliveries are kept.
 */
export function getAwsCloudStreamOrganizationDeleteCommand(data: {
  connectionId: string;
  regions: Array<string>;
}): string {
  const stackSetName: string = getCloudStreamNames(data.connectionId).stackName;
  const regionList: string = getRegionList(
    data.regions
      .map((region: string): string => {
        return region.trim().toLowerCase();
      })
      .filter((region: string, index: number, all: Array<string>): boolean => {
        return isAwsRegion(region) && all.indexOf(region) === index;
      }),
  );

  return [
    `for REGION in ${regionList}; do`,
    `  aws cloudformation delete-stack --region "$REGION" --stack-name ${stackSetName}`,
    "done",
    getAwsStackSetHomeRegionLine({
      variable: STREAM_HOME_VARIABLE,
      region: null,
    }),
    `if aws cloudformation describe-stack-set --stack-set-name ${stackSetName} --region ${STREAM_HOME} > /dev/null 2>&1; then`,
    // Every Region the StackSet's stacks are in, whichever the list above names.
    `  STACK_SET_REGIONS=$(aws cloudformation list-stack-instances --stack-set-name ${stackSetName} --region ${STREAM_HOME} --query "Summaries[].Region" --output text | tr '\\t' '\\n' | sort -u | tr '\\n' ' ')`,
    ...getAwsStackSetDeleteLines({
      stackSetName,
      homeRegion: STREAM_HOME,
      regions: "$STACK_SET_REGIONS",
    }).map((line: string): string => {
      return `  ${line}`;
    }),
    "fi",
  ].join("\n");
}
