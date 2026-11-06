/*
 * ONE TEMPLATE IN EVERY ACCOUNT OF AN AWS ORGANIZATION, IN ONE COMMAND.
 *
 * What OneUptime sets up in a single AWS account with one stack - the
 * Cloud AI agent (CloudAiAgentSetupCommands), a CloudWatch stream
 * (CloudStreamTemplate) - it sets up in every account of an AWS
 * Organization with a CloudFormation StackSet, from the organization's
 * management account in AWS CloudShell. These are the shell lines both
 * write, so the two StackSets paths are one:
 *
 *   - StackSets' trusted access to the organization turned on (nothing
 *     happens when it is on already), and the organization's root, which
 *     every account is under;
 *   - the StackSet, created or - run again - updated with the template as
 *     it stands now, SERVICE_MANAGED (StackSets makes the roles it deploys
 *     with in every member account), with managed execution, so the
 *     operations the command starts queue rather than fail on each other;
 *   - stack instances: in every account under the organization's root, in
 *     the Regions given - or, for a template whose parameters differ by
 *     account (each Cloud AI agent's key is its own account's), one account
 *     at a time with its own parameter overrides. An instance that is there
 *     already is updated with its new values, one that is not is created.
 *
 * A StackSet lives in one Region, its home: every call names it (--region),
 * so the command finds the same StackSet whichever Region CloudShell runs
 * in. A value a command takes - a parameter's - is written in single quotes
 * the shell never reads inside (quoteForShell), or names a shell variable
 * the command set (expanded inside double quotes), and every name is a
 * constant of OneUptime's own. Nothing here runs anything: these are lines
 * of text the commands join. StackSets deploys to the management account's
 * members only, never to the management account itself: a command that
 * needs it there deploys a stack of its own beside the StackSet.
 */

/*
 * One of the StackSet's parameters: a value written as it is, a shell
 * variable the command set (shellVariable: "STREAM_KEY" for $STREAM_KEY),
 * or neither - null - to keep each instance's own (UsePreviousValue).
 */
export interface AwsStackSetParameter {
  key: string;
  value: string | null;
  shellVariable?: string | undefined;
}

// A value in single quotes for the shell: what it holds is never read by it.
export function quoteForShell(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/*
 * ParameterKey=K,ParameterValue=V (or UsePreviousValue=true), each one
 * word for the shell.
 */
export function formatAwsStackSetParameters(
  parameters: ReadonlyArray<AwsStackSetParameter>,
): string {
  return parameters
    .map((parameter: AwsStackSetParameter): string => {
      if (parameter.shellVariable) {
        return `"ParameterKey=${parameter.key},ParameterValue=$${parameter.shellVariable}"`;
      }

      return parameter.value === null
        ? `ParameterKey=${parameter.key},UsePreviousValue=true`
        : quoteForShell(
            `ParameterKey=${parameter.key},ParameterValue=${parameter.value}`,
          );
    })
    .join(" ");
}

// The shell variable the organization's root id is read into.
export const AWS_ORGANIZATION_ROOT_VARIABLE: string = "ORGANIZATION_ROOT";

/*
 * The Region a StackSet lives in when none is given: US East (N.
 * Virginia), the same whichever Region CloudShell runs in, so running the
 * command again finds the StackSet it made - CloudShell's own only in a
 * partition without that Region (AWS GovCloud, China).
 */
export const AWS_STACK_SET_DEFAULT_HOME_REGION: string = "us-east-1";

// The line that sets `variable` to the StackSet's home Region.
export function getAwsStackSetHomeRegionLine(data: {
  variable: string;
  // A Region given (checked as one by the caller), or null for the default.
  region: string | null;
}): string {
  if (data.region) {
    return `${data.variable}=${data.region}`;
  }

  return `${data.variable}=${AWS_STACK_SET_DEFAULT_HOME_REGION}; case "\${AWS_REGION:-}" in us-gov-*|cn-*) ${data.variable}="$AWS_REGION" ;; esac`;
}

/*
 * Trusted access for StackSets, then the organization's root: every
 * account of the organization is under it.
 */
export function getAwsOrganizationStartLines(): Array<string> {
  return [
    "aws cloudformation activate-organizations-access > /dev/null 2>&1 || true",
    getAwsOrganizationRootLine(),
  ];
}

function getAwsOrganizationRootLine(): string {
  return `${AWS_ORGANIZATION_ROOT_VARIABLE}=$(aws organizations list-roots --query "Roots[0].Id" --output text)`;
}

/*
 * The value a per-account parameter has in the StackSet itself: what no
 * instance keeps, since each has its own override. A Cloud AI agent that
 * starts with it registers nothing (no key reads like it).
 */
export const AWS_STACK_SET_PLACEHOLDER: string = "set-per-account";

/*
 * Every account at once, and an account that fails does not stop the
 * others: StackSets' own default stops an operation at its first failure.
 */
export const AWS_STACK_SET_OPERATION_PREFERENCES: string =
  "FailureTolerancePercentage=100,MaxConcurrentPercentage=100,RegionConcurrencyType=PARALLEL";

/*
 * The StackSet, created with this template or - when it is there already -
 * updated to it. autoDeployment: accounts added to the organization later
 * get a stack instance of their own, with the StackSet's own parameters
 * (only for a template whose parameters are the same in every account).
 */
export function getAwsStackSetDeployLine(data: {
  stackSetName: string;
  // The StackSet's home Region, a shell word.
  homeRegion: string;
  templateFile: string;
  description: string;
  capabilities: string;
  parameters: ReadonlyArray<AwsStackSetParameter>;
  autoDeployment: boolean;
}): string {
  const stackSet: string = `--stack-set-name ${data.stackSetName} --region ${data.homeRegion} --template-body file://${data.templateFile} --description ${quoteForShell(data.description)} --capabilities ${data.capabilities}`;
  const createParameters: string = formatAwsStackSetParameters(
    data.parameters.map(
      (parameter: AwsStackSetParameter): AwsStackSetParameter => {
        // A StackSet made now has no value to keep: the placeholder.
        return parameter.value === null && !parameter.shellVariable
          ? { key: parameter.key, value: AWS_STACK_SET_PLACEHOLDER }
          : parameter;
      },
    ),
  );
  const updateParameters: string = formatAwsStackSetParameters(data.parameters);
  const autoDeployment: string = data.autoDeployment
    ? "Enabled=true,RetainStacksOnAccountRemoval=false"
    : "Enabled=false";

  return [
    `aws cloudformation create-stack-set ${stackSet} --permission-model SERVICE_MANAGED --auto-deployment ${autoDeployment} --managed-execution Active=true${
      createParameters ? ` --parameters ${createParameters}` : ""
    } > /dev/null 2>&1`,
    `aws cloudformation update-stack-set ${stackSet} --auto-deployment ${autoDeployment} --managed-execution Active=true --operation-preferences ${AWS_STACK_SET_OPERATION_PREFERENCES}${
      updateParameters ? ` --parameters ${updateParameters}` : ""
    } > /dev/null`,
  ].join(" || ");
}

/*
 * Instances in every account under the organization's root, in these
 * Regions (a shell word list, such as us-east-1 eu-west-1): created, or
 * updated where they are there already.
 */
export function getAwsStackSetEveryAccountLine(data: {
  stackSetName: string;
  homeRegion: string;
  regions: string;
}): string {
  const targets: string = `--stack-set-name ${data.stackSetName} --region ${data.homeRegion} --deployment-targets OrganizationalUnitIds="$${AWS_ORGANIZATION_ROOT_VARIABLE}" --regions ${data.regions} --operation-preferences ${AWS_STACK_SET_OPERATION_PREFERENCES}`;

  return [
    `aws cloudformation create-stack-instances ${targets} > /dev/null 2>&1`,
    `aws cloudformation update-stack-instances ${targets} > /dev/null`,
  ].join(" || ");
}

/*
 * The instance of one account - the shell variable `accountVariable` holds
 * its id - in one Region, with that account's own parameter overrides
 * (values name shell variables, which are expanded inside double quotes):
 * updated where it is there already, created where it is not. StackSets
 * reaches a single account of the organization as the intersection of the
 * root and that account. A call StackSets refuses is said with the
 * account's id, and the next account goes on.
 */
export function getAwsStackSetOneAccountLine(data: {
  stackSetName: string;
  homeRegion: string;
  accountVariable: string;
  // The Region of the account's instance, a shell word.
  region: string;
  // Key -> the shell variable that holds its value in this account.
  overrides: ReadonlyArray<{ key: string; shellVariable: string }>;
  failedMessage: string;
}): string {
  const targets: string = `--stack-set-name ${data.stackSetName} --region ${data.homeRegion} --deployment-targets OrganizationalUnitIds="$${AWS_ORGANIZATION_ROOT_VARIABLE}",Accounts="$${data.accountVariable}",AccountFilterType=INTERSECTION --regions ${data.region}`;
  const overrides: string = formatAwsStackSetParameters(
    data.overrides.map(
      (override: {
        key: string;
        shellVariable: string;
      }): AwsStackSetParameter => {
        return {
          key: override.key,
          value: null,
          shellVariable: override.shellVariable,
        };
      },
    ),
  );

  return `aws cloudformation update-stack-instances ${targets} --parameter-overrides ${overrides} > /dev/null 2>&1 || aws cloudformation create-stack-instances ${targets} --parameter-overrides ${overrides} > /dev/null || echo "$${data.accountVariable}: ${data.failedMessage}"`;
}

/*
 * Where each account's stack stands - its Region, its status and, for one
 * that failed, why - for one who wants to see.
 */
export function getAwsStackSetInstancesCommand(data: {
  stackSetName: string;
  homeRegion: string;
}): string {
  return `aws cloudformation list-stack-instances --stack-set-name ${data.stackSetName} --region ${data.homeRegion} --query "Summaries[].[Account,Region,StackInstanceStatus.DetailedStatus,StatusReason]" --output table`;
}

// The statuses of a StackSet operation that is not over yet.
export const AWS_STACK_SET_OPERATION_UNFINISHED: ReadonlyArray<string> = [
  "QUEUED",
  "RUNNING",
  "STOPPING",
];

/*
 * Stopping for good: every instance under the root removed (their stacks
 * deleted), then the StackSet. Removing instances is an operation StackSets
 * runs in the background: the StackSet can only go once they are gone, so
 * the command waits for the operation first.
 */
export function getAwsStackSetDeleteLines(data: {
  stackSetName: string;
  homeRegion: string;
  regions: string;
}): Array<string> {
  const stackSet: string = `--stack-set-name ${data.stackSetName} --region ${data.homeRegion}`;

  return [
    getAwsOrganizationRootLine(),
    `OPERATION=$(aws cloudformation delete-stack-instances ${stackSet} --deployment-targets OrganizationalUnitIds="$${AWS_ORGANIZATION_ROOT_VARIABLE}" --regions ${data.regions} --no-retain-stacks --operation-preferences ${AWS_STACK_SET_OPERATION_PREFERENCES} --query OperationId --output text)`,
    `while [ -n "$OPERATION" ]; do case "$(aws cloudformation describe-stack-set-operation ${stackSet} --operation-id "$OPERATION" --query StackSetOperation.Status --output text)" in ${AWS_STACK_SET_OPERATION_UNFINISHED.join("|")}) sleep 10 ;; *) break ;; esac; done`,
    `aws cloudformation delete-stack-set ${stackSet}`,
  ];
}
