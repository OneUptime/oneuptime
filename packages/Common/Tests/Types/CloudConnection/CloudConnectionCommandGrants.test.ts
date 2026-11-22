import { describe, expect, test } from "@jest/globals";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_CONNECTION_DATA_SECURITY_LEVELS,
  CLOUD_CONNECTION_DATA_SECURITY_RESPONSES,
  CLOUD_CONNECTION_WAF_BLOCKLIST_CHOICES,
  CloudConnectionAuthMethod,
  CloudConnectionAuthMethodDefinition,
  CloudConnectionCatalog,
  CloudConnectionDataSecurityLevel,
  CloudConnectionDataSecurityResponse,
  CloudConnectionDefinition,
  CloudConnectionField,
  CloudConnectionWafBlocklist,
  DATA_SECURITY_FIELD_KEY,
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  READ_SCOPE_FIELD_KEY,
  WAF_BLOCKLIST_FIELD_KEY,
  getCloudConnectionFieldsForMethod,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_DATA_SECURITY_CONFIGURATION_ACTIONS,
  AWS_DATA_SECURITY_GROUP_NAME,
  AWS_DATA_SECURITY_POLICY_NAME,
  AWS_DATA_SECURITY_RESPONSE_ACTIONS,
  AWS_DATA_SECURITY_RESPONSE_POLICY_NAME,
  AWS_ORGANIZATION_ACTION_GROUP,
  AWS_READ_ONLY_ACTIONS,
  AWS_SCOPED_READ_RESOURCES,
  AWS_WAF_BLOCKLIST_EVIDENCE_ACTIONS,
  AWS_WAF_BLOCKLIST_IP_SET_ACTIONS,
  AWS_WAF_BLOCKLIST_LIST_ACTIONS,
  AWS_WAF_BLOCKLIST_POLICY_NAME,
  AWS_WAF_BLOCKLIST_RULE_ACTIONS,
  AWS_WAF_WEB_ACL_RESOURCE,
  AWS_WAF_WEB_ACL_UPDATE_RESOURCES,
  AZURE_COST_ROLE,
  AZURE_DATA_SECURITY_CONTENT_ROLE,
  AZURE_DATA_SECURITY_RESPONSE_ACTIONS,
  AZURE_DATA_SECURITY_RESPONSE_ROLE,
  AZURE_READ_ONLY_ROLE,
  AwsPolicyStatement,
  CLOUD_CONNECTION_READ_ONLY_NAME,
  CloudConnectionAccessExtra,
  CloudConnectionCommandSettings,
  CloudConnectionSetupScope,
  GCP_COST_ROLES,
  GCP_DATA_SECURITY_CONTENT_ROLES,
  GCP_DATA_SECURITY_CONTENT_SERVICES,
  GCP_DATA_SECURITY_RESPONSE_PERMISSIONS,
  GCP_DATA_SECURITY_RESPONSE_ROLE_ID,
  GCP_READ_ONLY_ROLES,
  GCP_SERVICES,
  GCP_SERVICE_ACCOUNT_ID,
  canSetUpOrganization,
  getAwsExternalIdForProject,
  getAwsTrustPolicyDocument,
  getAwsWafBlocklistGroupName,
  getAwsWafIpSetResource,
  getCloudConnectionAccessExtras,
  getCloudConnectionCommandSettings,
  getCloudConnectionSetupCommand,
} from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * WHAT A PERSON PICKS IS WHAT THE COMMAND THEY RUN GRANTS (#10336).
 *
 * A connection's form writes its command from the settings it would save
 * (getCloudConnectionCommandSettings). Here, for every way it writes one -
 * each cloud, each sign-in method, the account or its whole organization -
 * and every Data security level, with Data security response off and on,
 * the command is read back line by line: every policy, role, permission
 * and API it grants, with no line left unread. What it grants is held to
 * what each choice needs, no more and no less:
 *
 *   - every connection: the read-only access, as it has always been;
 *   - Configuration only: the reads the data security reader calls (held
 *     to its calls by AwsDataSecurityReader.test.ts); nothing on Azure and
 *     Google Cloud, whose read-only roles read it already;
 *   - Configuration and content samples: that, and reading objects -
 *     s3:ListBucket, s3:GetObject, kms:Decrypt through S3 only - Storage
 *     Blob Data Reader, Storage Object Viewer and BigQuery Data Viewer;
 *   - Close exposures and fix settings: the writes each responder makes
 *     (held to what it names by CloudConnectionCommandNeeds.test.ts), and
 *     nothing else;
 *   - Block addresses in AWS WAF (#10344), AWS only: listing the IP sets,
 *     reading and writing the project's own, and reading what web ACLs
 *     sampled - with wafv2:UpdateWebACL only when OneUptime adds its rule
 *     itself (held to what the module calls by the same needs test).
 *
 * Then: every setting that changes a command is one the form asks with the
 * command (changesSetupCommand), and only those; what the words beside a
 * command say it grants beyond reading (getCloudConnectionAccessExtras) is
 * what it grants; and a connection saved before these settings, or with
 * them off, is shown the command it always had.
 */

const TRUSTED: string = "arn:aws:iam::999988887777:root";
const EXTERNAL_ID: string = getAwsExternalIdForProject(
  "11111111-1111-4111-8111-111111111111",
);
const ROLE_SETUP: { trustedPrincipalArn: string; externalId: string } = {
  trustedPrincipalArn: TRUSTED,
  externalId: EXTERNAL_ID,
};
const LINE_BREAK: string = "\n";

// One way the form writes a command.
interface CommandWay {
  definition: CloudConnectionDefinition;
  method: CloudConnectionAuthMethod;
  scope: CloudConnectionSetupScope;
}

// Every way: each cloud's methods, each in its one account and - where it can - its organization.
const WAYS: Array<CommandWay> = CloudConnectionCatalog.flatMap(
  (definition: CloudConnectionDefinition): Array<CommandWay> => {
    return definition.authMethods.flatMap(
      (method: CloudConnectionAuthMethodDefinition): Array<CommandWay> => {
        return [
          CloudConnectionSetupScope.Account,
          ...(canSetUpOrganization(definition.provider, method.method)
            ? [CloudConnectionSetupScope.Organization]
            : []),
        ].map((scope: CloudConnectionSetupScope): CommandWay => {
          return { definition, method: method.method, scope };
        });
      },
    );
  },
);

interface CommandChoice {
  dataSecurity: CloudConnectionDataSecurityLevel;
  dataSecurityResponse: CloudConnectionDataSecurityResponse;
  // AWS's alone: every other cloud's is off.
  wafBlocklist: CloudConnectionWafBlocklist;
}

// Data Security's choices, each with the blocklist's given.
function choicesWith(
  wafBlocklist: CloudConnectionWafBlocklist,
): Array<CommandChoice> {
  return CLOUD_CONNECTION_DATA_SECURITY_LEVELS.flatMap(
    (dataSecurity: CloudConnectionDataSecurityLevel): Array<CommandChoice> => {
      return CLOUD_CONNECTION_DATA_SECURITY_RESPONSES.map(
        (
          dataSecurityResponse: CloudConnectionDataSecurityResponse,
        ): CommandChoice => {
          return { dataSecurity, dataSecurityResponse, wafBlocklist };
        },
      );
    },
  );
}

// Every cloud's choices: Data Security's two settings, the blocklist off.
const CHOICES: Array<CommandChoice> = choicesWith("off");

// The AWS WAF choices beside them, which only AWS has.
const WAF_CHOICES: Array<CommandChoice> =
  CLOUD_CONNECTION_WAF_BLOCKLIST_CHOICES.flatMap(
    (wafBlocklist: CloudConnectionWafBlocklist): Array<CommandChoice> => {
      return choicesWith(wafBlocklist);
    },
  );

// The choices of a way's cloud: AWS's every one, the others' without the blocklist.
function choicesOf(way: CommandWay): Array<CommandChoice> {
  return way.definition.provider === CloudProvider.AWS ? WAF_CHOICES : CHOICES;
}

function describeWay(way: CommandWay, choice?: CommandChoice): string {
  return [
    way.definition.provider,
    way.method,
    way.scope,
    ...(choice
      ? [choice.dataSecurity, choice.dataSecurityResponse, choice.wafBlocklist]
      : []),
  ].join(" / ");
}

/*
 * What the form saves for a way and a choice: the scope only for a method
 * that reads one (an AWS access key's never), and the blocklist only for a
 * cloud that has it, as readCloudConnectionForm keeps the fields of the
 * method picked.
 */
function savedConfig(way: CommandWay, choice: CommandChoice): JSONObject {
  const fields: Array<CloudConnectionField> = getCloudConnectionFieldsForMethod(
    way.definition.configFields,
    way.method,
  );
  const has: (key: string) => boolean = (key: string): boolean => {
    return fields.some((field: CloudConnectionField): boolean => {
      return field.key === key;
    });
  };

  return {
    authMethod: way.method,
    ...(has(READ_SCOPE_FIELD_KEY) ? { [READ_SCOPE_FIELD_KEY]: way.scope } : {}),
    [DATA_SECURITY_FIELD_KEY]: choice.dataSecurity,
    [DATA_SECURITY_RESPONSE_FIELD_KEY]: choice.dataSecurityResponse,
    ...(has(WAF_BLOCKLIST_FIELD_KEY)
      ? { [WAF_BLOCKLIST_FIELD_KEY]: choice.wafBlocklist }
      : {}),
  };
}

// The command the form shows for a way and a choice: from what it would save.
function commandFor(way: CommandWay, choice: CommandChoice): string {
  const settings: CloudConnectionCommandSettings =
    getCloudConnectionCommandSettings(savedConfig(way, choice));
  const command: string | undefined = getCloudConnectionSetupCommand(
    way.definition.provider,
    way.method,
    { ...ROLE_SETUP, ...settings },
  );

  expect({ way: describeWay(way, choice), written: Boolean(command) }).toEqual({
    way: describeWay(way, choice),
    written: true,
  });

  return command!;
}

/*
 * ---------------------------------------------------------------------
 * Reading a command back: what it grants, and the lines it runs that
 * grant nothing. A line no reader knows is kept, so the test fails on it:
 * a new line that grants something has to be read here first.
 * ---------------------------------------------------------------------
 */

interface CommandGrant {
  // Who is given the access, by what it is: "role", "user", "app"...
  grants: Record<string, Array<string>>;
  // AWS: the inline policies of each identity, by name.
  policies: Record<string, Array<string>>;
  // Lines that grant nothing (creating the identity, printing it).
  plain: Array<string>;
  unread: Array<string>;
}

function emptyGrant(): CommandGrant {
  return { grants: {}, policies: {}, plain: [], unread: [] };
}

function addGrant(
  grant: CommandGrant,
  identity: string,
  items: Array<string>,
): void {
  grant.grants[identity] = Array.from(
    new Set<string>([...(grant.grants[identity] || []), ...items]),
  ).sort();
}

function addPolicy(grant: CommandGrant, identity: string, name: string): void {
  grant.policies[identity] = [...(grant.policies[identity] || []), name].sort();
}

// The text between a marker and the next double quote.
function quotedAfter(line: string, marker: string): string {
  const start: number = line.indexOf(marker);

  expect({ line, hasMarker: start >= 0 }).toEqual({ line, hasMarker: true });

  const from: number = start + marker.length;
  return line.slice(from, line.indexOf('"', from));
}

// The JSON a line quotes in single quotes after a marker.
function policyAfter(
  line: string,
  marker: string,
): { Statement: Array<AwsPolicyStatement> } {
  const start: number = line.indexOf(marker);
  const from: number = start + marker.length;

  return JSON.parse(line.slice(from, line.lastIndexOf("'"))) as {
    Statement: Array<AwsPolicyStatement>;
  };
}

// Each Allow of a policy as "action on resources [if condition]".
function statementsOf(policy: {
  Statement: Array<AwsPolicyStatement>;
}): Array<string> {
  return policy.Statement.flatMap(
    (statement: AwsPolicyStatement): Array<string> => {
      expect(statement.Effect).toBe("Allow");

      const resources: Array<string> = Array.isArray(statement.Resource)
        ? statement.Resource
        : [statement.Resource];
      const condition: string = statement.Condition
        ? ` if ${JSON.stringify(statement.Condition)}`
        : "";

      return statement.Action.map((action: string): string => {
        return `${action} on ${resources.join(" ")}${condition}`;
      });
    },
  );
}

const AWS_ROLE_POLICY: string =
  'aws iam put-role-policy --role-name "$ROLE" --policy-name ';
const AWS_USER_POLICY: string = `aws iam put-user-policy --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --policy-name `;
const POLICY_DOCUMENT: string = " --policy-document '";

/*
 * The groups the access key's user may take policies through: Data
 * Security's, and the project's own for the blocklist's AWS WAF writes.
 */
const AWS_GROUPS: Array<string> = [
  AWS_DATA_SECURITY_GROUP_NAME,
  getAwsWafBlocklistGroupName(EXTERNAL_ID),
];

interface GroupReading {
  policies: Array<string>;
  statements: Array<string>;
  userJoins: boolean;
}

function readAwsCommand(command: string): CommandGrant {
  const grant: CommandGrant = emptyGrant();
  const lines: Array<string> = command.split(LINE_BREAK);
  let inTemplate: boolean = false;
  const groups: Map<string, GroupReading> = new Map(
    AWS_GROUPS.map((group: string): [string, GroupReading] => {
      return [group, { policies: [], statements: [], userJoins: false }];
    }),
  );

  for (const line of lines) {
    if (line === "cat > oneuptime-read-only.json <<'TEMPLATE'") {
      inTemplate = true;
      grant.plain.push(line);
      continue;
    }

    if (inTemplate) {
      if (line === "TEMPLATE") {
        inTemplate = false;
        grant.plain.push(line);
        continue;
      }

      // The role the StackSet puts in every member account.
      const template: JSONObject = JSON.parse(line) as JSONObject;
      const resources: JSONObject = template["Resources"] as JSONObject;

      expect(Object.keys(resources)).toEqual(["OneUptimeReadOnlyRole"]);

      const role: JSONObject = resources["OneUptimeReadOnlyRole"] as JSONObject;
      const properties: JSONObject = role["Properties"] as JSONObject;

      expect(role["Type"]).toBe("AWS::IAM::Role");
      expect(properties["AssumeRolePolicyDocument"]).toEqual(
        JSON.parse(getAwsTrustPolicyDocument(ROLE_SETUP)),
      );
      expect(Object.keys(properties).sort()).toEqual([
        "AssumeRolePolicyDocument",
        "Policies",
        "RoleName",
      ]);

      for (const policy of properties["Policies"] as Array<JSONObject>) {
        addPolicy(grant, "members' role", policy["PolicyName"] as string);
        addGrant(
          grant,
          "members' role",
          statementsOf(
            policy["PolicyDocument"] as unknown as {
              Statement: Array<AwsPolicyStatement>;
            },
          ),
        );
      }

      continue;
    }

    if (line.startsWith(AWS_ROLE_POLICY)) {
      const name: string = line
        .slice(AWS_ROLE_POLICY.length)
        .split(POLICY_DOCUMENT)[0]!;

      addPolicy(grant, "role", name);
      addGrant(grant, "role", statementsOf(policyAfter(line, POLICY_DOCUMENT)));
      continue;
    }

    if (line.startsWith(AWS_USER_POLICY)) {
      const name: string = line
        .slice(AWS_USER_POLICY.length)
        .split(POLICY_DOCUMENT)[0]!;

      addPolicy(grant, "user", name);
      addGrant(grant, "user", statementsOf(policyAfter(line, POLICY_DOCUMENT)));
      continue;
    }

    const groupPolicy: string | undefined = AWS_GROUPS.find(
      (group: string): boolean => {
        return line.startsWith(
          `aws iam put-group-policy --group-name ${group} --policy-name `,
        );
      },
    );

    if (groupPolicy) {
      const reading: GroupReading = groups.get(groupPolicy)!;
      const marker: string = `aws iam put-group-policy --group-name ${groupPolicy} --policy-name `;

      reading.policies.push(
        line.slice(marker.length).split(POLICY_DOCUMENT)[0]!,
      );
      reading.statements.push(
        ...statementsOf(policyAfter(line, POLICY_DOCUMENT)),
      );
      continue;
    }

    const joined: string | undefined = AWS_GROUPS.find(
      (group: string): boolean => {
        return (
          line ===
          `aws iam add-user-to-group --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --group-name ${group}`
        );
      },
    );

    if (joined) {
      groups.get(joined)!.userJoins = true;
      continue;
    }

    const isPlain: boolean =
      line.startsWith("ROLE=") ||
      line === `TRUST='${getAwsTrustPolicyDocument(ROLE_SETUP)}'` ||
      line ===
        'aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" > /dev/null 2>&1 || aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"' ||
      line ===
        'aws iam get-role --role-name "$ROLE" --query Role.Arn --output text' ||
      line ===
        `aws iam create-user --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME} > /dev/null 2>&1 || true` ||
      AWS_GROUPS.some((group: string): boolean => {
        return (
          line ===
          `aws iam create-group --group-name ${group} > /dev/null 2>&1 || true`
        );
      }) ||
      line ===
        `aws iam create-access-key --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME}` ||
      line ===
        "aws cloudformation activate-organizations-access > /dev/null 2>&1 || true" ||
      (line.startsWith(
        "aws cloudformation create-stack-set --stack-set-name ",
      ) &&
        line.includes(
          "--template-body file://oneuptime-read-only.json --capabilities CAPABILITY_NAMED_IAM --permission-model SERVICE_MANAGED",
        )) ||
      (line.startsWith(
        "aws cloudformation create-stack-instances --stack-set-name ",
      ) &&
        line.endsWith("--regions us-east-1 > /dev/null 2>&1 || true"));

    if (isPlain) {
      grant.plain.push(line);
    } else {
      grant.unread.push(line);
    }
  }

  // A group's policies are the user's once it joins the group, and only then.
  for (const [group, reading] of groups) {
    if (reading.userJoins) {
      for (const name of reading.policies) {
        addPolicy(grant, "user", name);
      }

      addGrant(grant, "user", reading.statements);
    } else {
      expect({ group, policies: reading.policies }).toEqual({
        group,
        policies: [],
      });
    }
  }

  return grant;
}

const AZURE_ASSIGNMENT: string =
  'az role assignment create --assignee "$APP" --role "';
const AZURE_CREATE_APP: string = `OUT=$(az ad sp create-for-rbac --name ${CLOUD_CONNECTION_READ_ONLY_NAME} --role "`;

function readAzureCommand(command: string): CommandGrant {
  const grant: CommandGrant = emptyGrant();

  for (const line of command.split(LINE_BREAK)) {
    if (line.startsWith(AZURE_CREATE_APP)) {
      expect(line.endsWith('" --scopes "$SCOPE")')).toBe(true);
      addGrant(grant, "app", [`${quotedAfter(line, '--role "')} on $SCOPE`]);
      continue;
    }

    if (line.startsWith(AZURE_ASSIGNMENT)) {
      expect(line.endsWith('" --scope "$SCOPE" > /dev/null')).toBe(true);
      addGrant(grant, "app", [`${quotedAfter(line, '--role "')} on $SCOPE`]);
      continue;
    }

    if (line.startsWith('RESPONSE_ROLE=$(jq -n --arg scope "$SCOPE" ')) {
      // The custom role: its actions, nothing it may do to data, assignable where it is assigned.
      const actionsAt: number = line.indexOf("Actions: [") + "Actions: ".length;
      const actions: Array<string> = JSON.parse(
        line.slice(actionsAt, line.indexOf("]", actionsAt) + 1),
      ) as Array<string>;

      expect(line).toContain("NotActions: [], AssignableScopes: [$scope]}");
      expect(line).not.toContain("DataActions");
      addGrant(grant, `custom role ${quotedAfter(line, 'Name: "')}`, actions);
      continue;
    }

    const isPlain: boolean =
      line ===
        'SCOPE="/subscriptions/$(az account show --query id --output tsv)"' ||
      line ===
        'SCOPE="/providers/Microsoft.Management/managementGroups/$(az account show --query tenantId --output tsv)"' ||
      line === 'APP=$(echo "$OUT" | jq -r .appId)' ||
      line ===
        'az role definition create --role-definition "$RESPONSE_ROLE" > /dev/null 2>&1 || az role definition update --role-definition "$RESPONSE_ROLE" > /dev/null' ||
      line ===
        'END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)' ||
      line === `echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'`;

    if (isPlain) {
      grant.plain.push(line);
    } else {
      grant.unread.push(line);
    }
  }

  return grant;
}

const GCP_MEMBER: string = `serviceAccount:${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com`;
const GCP_ENABLE: string = "gcloud services enable ";

function readGcpCommand(command: string): CommandGrant {
  const grant: CommandGrant = emptyGrant();

  for (const line of command.split(LINE_BREAK)) {
    const bindings: Array<[string, string]> = [
      [
        `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "${GCP_MEMBER}" --role `,
        "project",
      ],
      [
        `gcloud organizations add-iam-policy-binding "$ORG_ID" --member "${GCP_MEMBER}" --role `,
        "organization",
      ],
    ];
    const binding: [string, string] | undefined = bindings.find(
      (candidate: [string, string]): boolean => {
        return line.startsWith(candidate[0]);
      },
    );

    if (binding) {
      const prefix: string = binding[0];
      const where: string = binding[1];
      const rest: string = line.slice(prefix.length);
      const role: string = rest.split(" ")[0]!;

      expect(rest).toBe(`${role} --condition=None > /dev/null`);
      addGrant(grant, "service account", [`${role} on ${where}`]);
      continue;
    }

    if (line.startsWith(GCP_ENABLE)) {
      addGrant(grant, "apis", line.slice(GCP_ENABLE.length).split(" "));
      continue;
    }

    if (line.startsWith("gcloud iam roles create ")) {
      // The custom role: made where it is bound, with the same permissions made or updated.
      const halves: Array<string> = line.split(" || ");

      expect(halves).toHaveLength(2);

      const create: string = halves[0]!;
      const update: string = halves[1]!;
      const id: string = create
        .slice("gcloud iam roles create ".length)
        .split(" ")[0]!;
      const home: string = create.includes(' --organization "$ORG_ID" ')
        ? "organization"
        : create.includes(' --project "$PROJECT_ID" ')
          ? "project"
          : "?";
      const permissionsOf: (half: string) => Array<string> = (
        half: string,
      ): Array<string> => {
        return half.split(" --permissions ")[1]!.split(" ")[0]!.split(",");
      };

      expect(update.startsWith(`gcloud iam roles update ${id} `)).toBe(true);
      expect(permissionsOf(update)).toEqual(permissionsOf(create));
      addGrant(grant, `custom role ${id} in ${home}`, permissionsOf(create));
      continue;
    }

    const isPlain: boolean =
      line === "PROJECT_ID=$(gcloud config get-value project)" ||
      line ===
        'ORG_ID=$(gcloud projects get-ancestors "$PROJECT_ID" --format="value(id)" | tail -1)' ||
      line ===
        `gcloud iam service-accounts create ${GCP_SERVICE_ACCOUNT_ID} --display-name "OneUptime (read only)" > /dev/null 2>&1 || true` ||
      line ===
        `gcloud iam service-accounts keys create oneuptime-key.json --iam-account "${GCP_SERVICE_ACCOUNT_ID}@$PROJECT_ID.iam.gserviceaccount.com"` ||
      line === "cat oneuptime-key.json && rm oneuptime-key.json";

    if (isPlain) {
      grant.plain.push(line);
    } else {
      grant.unread.push(line);
    }
  }

  return grant;
}

function readCommand(way: CommandWay, command: string): CommandGrant {
  if (way.definition.provider === CloudProvider.AWS) {
    return readAwsCommand(command);
  }

  if (way.definition.provider === CloudProvider.Azure) {
    return readAzureCommand(command);
  }

  return readGcpCommand(command);
}

/*
 * ---------------------------------------------------------------------
 * What each choice needs, from the needs alone.
 * ---------------------------------------------------------------------
 */

// The read-only policy, from its actions: the scoped ones on their resources.
function awsReadOnlyStatements(isManagementRole: boolean): Array<string> {
  const scoped: Array<string> = Object.keys(AWS_SCOPED_READ_RESOURCES);

  return [
    ...AWS_READ_ONLY_ACTIONS.filter((action: string): boolean => {
      return !scoped.includes(action);
    }).map((action: string): string => {
      return `${action} on *`;
    }),
    ...scoped.map((action: string): string => {
      return `${action} on ${AWS_SCOPED_READ_RESOURCES[action]!.join(" ")}`;
    }),
    ...(isManagementRole
      ? AWS_ORGANIZATION_ACTION_GROUP.actions.map((action: string): string => {
          return `${action} on *`;
        })
      : []),
  ];
}

// What reading objects takes: each on its own resources, kms:Decrypt through S3 only.
const AWS_CONTENT_STATEMENTS: Array<string> = [
  "s3:ListBucket on arn:aws:s3:::*",
  "s3:GetObject on arn:aws:s3:::*/*",
  'kms:Decrypt on * if {"StringLike":{"kms:ViaService":"s3.*.amazonaws.com"}}',
];

/*
 * What blocking addresses in AWS WAF takes: listing the IP sets, which
 * names no resource; the project's own sets and nobody else's; what web
 * ACLs sampled; and - only when OneUptime adds its rule - writing web ACLs,
 * checked against everything a web ACL may reference.
 */
function awsWafStatements(choice: CommandChoice): Array<string> {
  if (choice.wafBlocklist === "off") {
    return [];
  }

  return [
    ...AWS_WAF_BLOCKLIST_LIST_ACTIONS.map((action: string): string => {
      return `${action} on *`;
    }),
    ...AWS_WAF_BLOCKLIST_IP_SET_ACTIONS.map((action: string): string => {
      return `${action} on ${getAwsWafIpSetResource(EXTERNAL_ID)}`;
    }),
    ...AWS_WAF_BLOCKLIST_EVIDENCE_ACTIONS.map((action: string): string => {
      return `${action} on ${AWS_WAF_WEB_ACL_RESOURCE}`;
    }),
    ...(choice.wafBlocklist === "rule"
      ? AWS_WAF_BLOCKLIST_RULE_ACTIONS.map((action: string): string => {
          return `${action} on ${AWS_WAF_WEB_ACL_UPDATE_RESOURCES.join(" ")}`;
        })
      : []),
  ];
}

function awsNeeds(
  choice: CommandChoice,
  isManagementRole: boolean,
): { statements: Array<string>; policies: Array<string> } {
  const reads: boolean = choice.dataSecurity !== "off";
  const responds: boolean = choice.dataSecurityResponse === "block";
  const blocks: boolean = choice.wafBlocklist !== "off";

  return {
    statements: Array.from(
      new Set<string>([
        ...awsReadOnlyStatements(isManagementRole),
        ...(reads
          ? AWS_DATA_SECURITY_CONFIGURATION_ACTIONS.map(
              (action: string): string => {
                return `${action} on *`;
              },
            )
          : []),
        ...(choice.dataSecurity === "content" ? AWS_CONTENT_STATEMENTS : []),
        ...(responds
          ? AWS_DATA_SECURITY_RESPONSE_ACTIONS.map((action: string): string => {
              return `${action} on *`;
            })
          : []),
        ...awsWafStatements(choice),
      ]),
    ).sort(),
    policies: [
      CLOUD_CONNECTION_READ_ONLY_NAME,
      ...(reads ? [AWS_DATA_SECURITY_POLICY_NAME] : []),
      ...(responds ? [AWS_DATA_SECURITY_RESPONSE_POLICY_NAME] : []),
      ...(blocks ? [AWS_WAF_BLOCKLIST_POLICY_NAME] : []),
    ].sort(),
  };
}

function expectedGrant(
  way: CommandWay,
  choice: CommandChoice,
): Pick<CommandGrant, "grants" | "policies"> {
  const content: boolean = choice.dataSecurity === "content";
  const responds: boolean = choice.dataSecurityResponse === "block";
  const isOrganization: boolean =
    way.scope === CloudConnectionSetupScope.Organization;

  if (way.definition.provider === CloudProvider.AWS) {
    if (way.method === CloudConnectionAuthMethod.AwsAccessKey) {
      const needs: { statements: Array<string>; policies: Array<string> } =
        awsNeeds(choice, false);

      return {
        grants: { user: needs.statements },
        policies: { user: needs.policies },
      };
    }

    if (isOrganization) {
      const members: { statements: Array<string>; policies: Array<string> } =
        awsNeeds(choice, false);
      const management: {
        statements: Array<string>;
        policies: Array<string>;
      } = awsNeeds(choice, true);

      return {
        grants: {
          "members' role": members.statements,
          role: management.statements,
        },
        policies: {
          "members' role": members.policies,
          role: management.policies,
        },
      };
    }

    const needs: { statements: Array<string>; policies: Array<string> } =
      awsNeeds(choice, false);

    return {
      grants: { role: needs.statements },
      policies: { role: needs.policies },
    };
  }

  if (way.definition.provider === CloudProvider.Azure) {
    return {
      grants: {
        app: [
          AZURE_READ_ONLY_ROLE,
          AZURE_COST_ROLE,
          ...(content ? [AZURE_DATA_SECURITY_CONTENT_ROLE] : []),
          ...(responds ? [AZURE_DATA_SECURITY_RESPONSE_ROLE] : []),
        ]
          .map((role: string): string => {
            return `${role} on $SCOPE`;
          })
          .sort(),
        ...(responds
          ? {
              [`custom role ${AZURE_DATA_SECURITY_RESPONSE_ROLE}`]: [
                ...AZURE_DATA_SECURITY_RESPONSE_ACTIONS,
              ].sort(),
            }
          : {}),
      },
      policies: {},
    };
  }

  const where: string = isOrganization ? "organization" : "project";
  const customRole: string = isOrganization
    ? `organizations/$ORG_ID/roles/${GCP_DATA_SECURITY_RESPONSE_ROLE_ID}`
    : `projects/$PROJECT_ID/roles/${GCP_DATA_SECURITY_RESPONSE_ROLE_ID}`;

  return {
    grants: {
      apis: Array.from(
        new Set<string>([
          ...GCP_SERVICES,
          ...(content ? GCP_DATA_SECURITY_CONTENT_SERVICES : []),
        ]),
      ).sort(),
      "service account": [
        ...GCP_READ_ONLY_ROLES,
        ...GCP_COST_ROLES,
        ...(content ? GCP_DATA_SECURITY_CONTENT_ROLES : []),
        ...(responds ? [customRole] : []),
      ]
        .map((role: string): string => {
          return `${role} on ${where}`;
        })
        .sort(),
      ...(responds
        ? {
            [`custom role ${GCP_DATA_SECURITY_RESPONSE_ROLE_ID} in ${where}`]: [
              ...GCP_DATA_SECURITY_RESPONSE_PERMISSIONS,
            ].sort(),
          }
        : {}),
    },
    policies: {},
  };
}

describe("every way the form writes a command, with every choice", () => {
  test("the ways: each cloud's methods, in one account and - where they can read one - the organization", () => {
    expect(
      WAYS.map((way: CommandWay): string => {
        return describeWay(way);
      }),
    ).toEqual([
      "aws / aws-role / account",
      "aws / aws-role / organization",
      "aws / aws-access-key / account",
      "azure / azure-client-secret / account",
      "azure / azure-client-secret / organization",
      "gcp / gcp-service-account-key / account",
      "gcp / gcp-service-account-key / organization",
    ]);
    expect(CHOICES).toHaveLength(6);
    // AWS's blocklist: off, OneUptime adds its rule, the rule is added in code.
    expect(WAF_CHOICES).toHaveLength(18);
  });

  test("grants exactly what each choice needs: no more, no less, and nothing left unread", () => {
    let checked: number = 0;

    for (const way of WAYS) {
      for (const choice of choicesOf(way)) {
        const read: CommandGrant = readCommand(way, commandFor(way, choice));
        const needed: Pick<CommandGrant, "grants" | "policies"> = expectedGrant(
          way,
          choice,
        );

        expect({
          way: describeWay(way, choice),
          grants: read.grants,
          policies: read.policies,
          unread: read.unread,
        }).toEqual({
          way: describeWay(way, choice),
          grants: needed.grants,
          policies: needed.policies,
          unread: [],
        });
        checked++;
      }
    }

    // Three AWS ways with eighteen choices each, four others with six.
    expect(checked).toBe(3 * 18 + 4 * 6);
  });

  test("a choice only adds: every line of the command with every setting off is still there, in order, but an organization's template, which carries the policies", () => {
    for (const way of WAYS) {
      const off: Array<string> = commandFor(way, {
        dataSecurity: "off",
        dataSecurityResponse: "off",
        wafBlocklist: "off",
      }).split(LINE_BREAK);

      for (const choice of choicesOf(way)) {
        const lines: Array<string> = commandFor(way, choice).split(LINE_BREAK);
        let at: number = 0;
        const missing: Array<string> = [];

        for (const line of off) {
          // The StackSet's template is one line: its policies and description follow the choice.
          if (line.startsWith('{"AWSTemplateFormatVersion"')) {
            continue;
          }

          const found: number = lines.indexOf(line, at);

          if (found < 0) {
            missing.push(line);
          } else {
            at = found + 1;
          }
        }

        expect({ way: describeWay(way, choice), missing }).toEqual({
          way: describeWay(way, choice),
          missing: [],
        });
      }
    }
  });

  test("the organization's StackSet template says what its role may do: only read until it may write, then what it may fix and keep", () => {
    const organization: CommandWay = WAYS.find((way: CommandWay): boolean => {
      return (
        way.definition.provider === CloudProvider.AWS &&
        way.scope === CloudConnectionSetupScope.Organization
      );
    })!;

    for (const choice of WAF_CHOICES) {
      const template: JSONObject = JSON.parse(
        commandFor(organization, choice).split(LINE_BREAK)[1]!,
      ) as JSONObject;
      const description: string = template["Description"] as string;
      const responds: boolean = choice.dataSecurityResponse === "block";
      const mayAlso: Array<string> = [
        ...(responds
          ? ["close a data store's exposures and fix its settings"]
          : []),
        ...(choice.wafBlocklist === "rule"
          ? ["keep OneUptime's IP sets in AWS WAF and its rule in web ACLs"]
          : choice.wafBlocklist === "code"
            ? ["keep OneUptime's IP sets in AWS WAF"]
            : []),
      ];

      expect({ choice, description }).toEqual({
        choice,
        description: [
          `OneUptime: a role that ${mayAlso.length > 0 ? "reads" : "can only read"} this account's metrics, resources, changes and health events`,
          choice.dataSecurity === "content"
            ? ", and its data stores' configuration and samples of their content"
            : choice.dataSecurity === "configuration"
              ? ", and its data stores' configuration"
              : "",
          mayAlso.length > 0 ? `; it may also ${mayAlso.join(", and ")}` : "",
          ".",
        ].join(""),
      });
    }

    // A role that may only fix data stores says so as it always has.
    expect(
      JSON.parse(
        commandFor(organization, {
          dataSecurity: "off",
          dataSecurityResponse: "block",
          wafBlocklist: "off",
        }).split(LINE_BREAK)[1]!,
      )["Description"],
    ).toBe(
      "OneUptime: a role that reads this account's metrics, resources, changes and health events; it may also close a data store's exposures and fix its settings.",
    );
  });

  test("Close exposures and fix settings is in the command on every cloud: AWS's policy, Azure's and Google Cloud's custom roles", () => {
    const block: CommandChoice = {
      dataSecurity: "off",
      dataSecurityResponse: "block",
      wafBlocklist: "off",
    };

    for (const way of WAYS) {
      const command: string = commandFor(way, block);
      const name: string =
        way.definition.provider === CloudProvider.AWS
          ? AWS_DATA_SECURITY_RESPONSE_POLICY_NAME
          : way.definition.provider === CloudProvider.Azure
            ? AZURE_DATA_SECURITY_RESPONSE_ROLE
            : GCP_DATA_SECURITY_RESPONSE_ROLE_ID;

      expect({ way: describeWay(way), has: command.includes(name) }).toEqual({
        way: describeWay(way),
        has: true,
      });
      expect(
        commandFor(way, {
          dataSecurity: "off",
          dataSecurityResponse: "off",
          wafBlocklist: "off",
        }),
      ).not.toContain(name);
    }
  });

  test("Block addresses in AWS WAF is in every AWS command, its rule's write only when OneUptime adds its rule, and in no other cloud's", () => {
    for (const way of WAYS) {
      const isAws: boolean = way.definition.provider === CloudProvider.AWS;

      for (const wafBlocklist of CLOUD_CONNECTION_WAF_BLOCKLIST_CHOICES) {
        const choice: CommandChoice = {
          dataSecurity: "off",
          dataSecurityResponse: "off",
          wafBlocklist,
        };

        if (!isAws) {
          // Another cloud's form never saves it, and its command never reads it.
          expect(
            getCloudConnectionSetupCommand(
              way.definition.provider,
              way.method,
              { ...ROLE_SETUP, scope: way.scope, wafBlocklist },
            ),
          ).toBe(
            getCloudConnectionSetupCommand(
              way.definition.provider,
              way.method,
              { ...ROLE_SETUP, scope: way.scope },
            ),
          );
          continue;
        }

        const command: string = commandFor(way, choice);

        expect({
          way: describeWay(way, choice),
          policy: command.includes(`${AWS_WAF_BLOCKLIST_POLICY_NAME} `),
          rule: command.includes("wafv2:UpdateWebACL"),
          ipSets: command.includes("wafv2:UpdateIPSet"),
        }).toEqual({
          way: describeWay(way, choice),
          policy: wafBlocklist !== "off",
          rule: wafBlocklist === "rule",
          ipSets: wafBlocklist !== "off",
        });
      }
    }
  });

  test("the blocklist's writes are held to the project's own IP sets: another project's prefix, and the customer's sets, are out of reach", () => {
    const other: string = getAwsExternalIdForProject(
      "22222222-2222-4222-8222-222222222222",
    );

    expect(getAwsWafIpSetResource(EXTERNAL_ID)).not.toBe(
      getAwsWafIpSetResource(other),
    );
    expect(getAwsWafIpSetResource(EXTERNAL_ID)).toMatch(
      /^arn:aws:wafv2:\*:\*:\*\/ipset\/oneuptime-[0-9a-f]{8}-\*\/\*$/,
    );

    for (const way of WAYS.filter((candidate: CommandWay): boolean => {
      return candidate.definition.provider === CloudProvider.AWS;
    })) {
      const grant: CommandGrant = readCommand(
        way,
        commandFor(way, {
          dataSecurity: "off",
          dataSecurityResponse: "off",
          wafBlocklist: "code",
        }),
      );

      for (const items of Object.values(grant.grants)) {
        for (const item of items) {
          if (
            ["wafv2:CreateIPSet", "wafv2:UpdateIPSet", "wafv2:DeleteIPSet"].includes(
              item.split(" ")[0]!,
            )
          ) {
            expect(item).toBe(
              `${item.split(" ")[0]} on ${getAwsWafIpSetResource(EXTERNAL_ID)}`,
            );
          }

          // Code: OneUptime never writes a web ACL.
          expect(item.startsWith("wafv2:UpdateWebACL ")).toBe(false);
        }
      }
    }
  });

  test("the access key's command can only be written for the blocklist once the project's external id is known", () => {
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        { wafBlocklist: "rule" },
      ),
    ).toBeUndefined();
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        { wafBlocklist: "off" },
      ),
    ).toBe(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
      ),
    );
    expect(
      getCloudConnectionSetupCommand(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        { externalId: EXTERNAL_ID, wafBlocklist: "rule" },
      ),
    ).toContain(getAwsWafBlocklistGroupName(EXTERNAL_ID));
  });
});

describe("the settings a command is written from, as a connection keeps them", () => {
  const read: (config: JSONObject | undefined | null) => Array<string> = (
    config: JSONObject | undefined | null,
  ): Array<string> => {
    const settings: CloudConnectionCommandSettings =
      getCloudConnectionCommandSettings(config);

    return [
      settings.scope,
      settings.dataSecurity,
      settings.dataSecurityResponse,
      settings.wafBlocklist,
    ];
  };

  test("each value the form saves reads as itself", () => {
    for (const choice of WAF_CHOICES) {
      for (const scope of [
        CloudConnectionSetupScope.Account,
        CloudConnectionSetupScope.Organization,
      ]) {
        expect(
          read({
            [READ_SCOPE_FIELD_KEY]: scope,
            [DATA_SECURITY_FIELD_KEY]: choice.dataSecurity,
            [DATA_SECURITY_RESPONSE_FIELD_KEY]: choice.dataSecurityResponse,
            [WAF_BLOCKLIST_FIELD_KEY]: choice.wafBlocklist,
          }),
        ).toEqual([
          scope,
          choice.dataSecurity,
          choice.dataSecurityResponse,
          choice.wafBlocklist,
        ]);
      }
    }
  });

  test("nothing kept, or anything else, is the one account with every setting off", () => {
    expect(read(undefined)).toEqual(["account", "off", "off", "off"]);
    expect(read(null)).toEqual(["account", "off", "off", "off"]);
    expect(read({})).toEqual(["account", "off", "off", "off"]);

    const others: Array<JSONValue> = [
      "Organization",
      "everything",
      "Content",
      " content ",
      "on",
      "Block",
      " block ",
      "Rule",
      " rule ",
      "CODE",
      true,
      1,
      null,
      ["content"],
      ["rule"],
      { value: "content" },
    ];

    for (const value of others) {
      expect({
        value,
        read: read({
          [READ_SCOPE_FIELD_KEY]: value,
          [DATA_SECURITY_FIELD_KEY]: value,
          [DATA_SECURITY_RESPONSE_FIELD_KEY]: value,
          [WAF_BLOCKLIST_FIELD_KEY]: value,
        }),
      }).toEqual({ value, read: ["account", "off", "off", "off"] });
    }
  });

  test("the scope reads trimmed, as the connectors' readCloudSetting reads it", () => {
    expect(read({ [READ_SCOPE_FIELD_KEY]: " organization " })[0]).toBe(
      CloudConnectionSetupScope.Organization,
    );
  });

  test("a connection saved before these settings, or with them off, is shown the command it always had", () => {
    for (const way of WAYS) {
      const always: string | undefined = getCloudConnectionSetupCommand(
        way.definition.provider,
        way.method,
        { ...ROLE_SETUP, scope: way.scope },
      );
      const scope: JSONObject =
        way.scope === CloudConnectionSetupScope.Organization
          ? { [READ_SCOPE_FIELD_KEY]: way.scope }
          : {};

      for (const config of [
        { authMethod: way.method, ...scope },
        {
          authMethod: way.method,
          ...scope,
          [DATA_SECURITY_FIELD_KEY]: "off",
          [DATA_SECURITY_RESPONSE_FIELD_KEY]: "off",
          ...(way.definition.provider === CloudProvider.AWS
            ? { [WAF_BLOCKLIST_FIELD_KEY]: "off" }
            : {}),
        },
      ]) {
        expect({
          way: describeWay(way),
          command: getCloudConnectionSetupCommand(
            way.definition.provider,
            way.method,
            { ...ROLE_SETUP, ...getCloudConnectionCommandSettings(config) },
          ),
        }).toEqual({ way: describeWay(way), command: always });
      }
    }
  });

  test("and one whose choices are on is shown the command that grants them", () => {
    const way: CommandWay = WAYS[0]!;
    const command: string | undefined = getCloudConnectionSetupCommand(
      way.definition.provider,
      way.method,
      {
        ...ROLE_SETUP,
        ...getCloudConnectionCommandSettings({
          authMethod: way.method,
          [DATA_SECURITY_FIELD_KEY]: "content",
          [DATA_SECURITY_RESPONSE_FIELD_KEY]: "block",
        }),
      },
    );

    expect(command).toContain(
      `--policy-name ${AWS_DATA_SECURITY_POLICY_NAME} `,
    );
    expect(command).toContain(
      `--policy-name ${AWS_DATA_SECURITY_RESPONSE_POLICY_NAME} `,
    );
    expect(command).toContain("s3:GetObject");
    expect(command).not.toContain(AWS_WAF_BLOCKLIST_POLICY_NAME);

    const withWaf: string | undefined = getCloudConnectionSetupCommand(
      way.definition.provider,
      way.method,
      {
        ...ROLE_SETUP,
        ...getCloudConnectionCommandSettings({
          authMethod: way.method,
          [WAF_BLOCKLIST_FIELD_KEY]: "rule",
        }),
      },
    );

    expect(withWaf).toContain(`--policy-name ${AWS_WAF_BLOCKLIST_POLICY_NAME} `);
    expect(withWaf).toContain("wafv2:UpdateWebACL");
  });
});

/*
 * A setting the command is written from is asked with the command, and a
 * setting asked there is one it is written from: the form places a field
 * by changesSetupCommand (CloudConnectionForm), so one that changed the
 * command but sat on a later step would be picked after the command was
 * run - #10336 - and one flagged that changed nothing would crowd the
 * command's step. Each field's every choice (a text field, a value) is
 * tried on every way, and the command compared with its default's.
 */
describe("every setting that changes a command is asked with it, and no other", () => {
  function defaultConfig(
    definition: CloudConnectionDefinition,
    method: CloudConnectionAuthMethod,
  ): JSONObject {
    const config: JSONObject = { authMethod: method };

    for (const field of definition.configFields) {
      if (field.defaultValue !== undefined) {
        config[field.key] = field.defaultValue;
      }
    }

    return config;
  }

  function changesCommand(
    definition: CloudConnectionDefinition,
    field: CloudConnectionField,
  ): boolean {
    const values: Array<string> = field.options
      ? field.options.map((option: { value: string }): string => {
          return option.value;
        })
      : ["a value someone typed"];

    return definition.authMethods.some(
      (method: CloudConnectionAuthMethodDefinition): boolean => {
        const base: JSONObject = defaultConfig(definition, method.method);
        const write: (config: JSONObject) => string | undefined = (
          config: JSONObject,
        ): string | undefined => {
          return getCloudConnectionSetupCommand(
            definition.provider,
            method.method,
            { ...ROLE_SETUP, ...getCloudConnectionCommandSettings(config) },
          );
        };

        return values.some((value: string): boolean => {
          return write({ ...base, [field.key]: value }) !== write(base);
        });
      },
    );
  }

  test("each cloud's fields: flagged exactly when one of their choices writes another command", () => {
    for (const definition of CloudConnectionCatalog) {
      for (const field of definition.configFields) {
        expect({
          cloud: definition.provider,
          field: field.key,
          changesSetupCommand: Boolean(field.changesSetupCommand),
        }).toEqual({
          cloud: definition.provider,
          field: field.key,
          changesSetupCommand: changesCommand(definition, field),
        });
      }
    }
  });

  test("they are what to read and Data Security's two settings on every cloud, and Block addresses in AWS WAF on AWS", () => {
    for (const definition of CloudConnectionCatalog) {
      expect(
        definition.configFields
          .filter((field: CloudConnectionField): boolean => {
            return Boolean(field.changesSetupCommand);
          })
          .map((field: CloudConnectionField): string => {
            return field.key;
          })
          .sort(),
      ).toEqual(
        [
          DATA_SECURITY_FIELD_KEY,
          DATA_SECURITY_RESPONSE_FIELD_KEY,
          READ_SCOPE_FIELD_KEY,
          ...(definition.provider === CloudProvider.AWS
            ? [WAF_BLOCKLIST_FIELD_KEY]
            : []),
        ].sort(),
      );
      // No secret is a command's setting: a secret is pasted after it runs.
      expect(
        definition.secretFields.filter(
          (field: CloudConnectionField): boolean => {
            return Boolean(field.changesSetupCommand);
          },
        ),
      ).toEqual([]);
    }
  });
});

/*
 * The words beside a command (CloudSetupCommand) say "can only read" and
 * "Never data or secrets" unless getCloudConnectionAccessExtras names what
 * it grants beyond that. Held to the grants read back above: content
 * samples exactly when the command lets the connection read data, Data
 * security response exactly when it lets it write a data store, the
 * blocklist's IP sets exactly when it lets it write IP sets in AWS WAF, and
 * its rule exactly when it lets it write a web ACL.
 */
describe("what the words say a command grants beyond reading is what it grants", () => {
  const AWS_DATA_READS: Array<string> = [
    "s3:GetObject",
    "s3:ListBucket",
    "kms:Decrypt",
  ];
  const AWS_WRITE_VERB: Array<string> = [
    "Put",
    "Modify",
    "Update",
    "Delete",
    "Create",
    "Attach",
    "Detach",
    "Set",
    "Start",
    "Stop",
    "Restore",
    "Copy",
    "Tag",
    "Untag",
  ];
  const DATA_READER_ROLES: Array<string> = [
    AZURE_DATA_SECURITY_CONTENT_ROLE,
    ...GCP_DATA_SECURITY_CONTENT_ROLES,
  ];

  function actionOf(statement: string): string {
    return statement.split(" ")[0]!;
  }

  function readsData(grant: CommandGrant): boolean {
    return Object.values(grant.grants).some((items: Array<string>): boolean => {
      return items.some((item: string): boolean => {
        return (
          AWS_DATA_READS.includes(actionOf(item)) ||
          DATA_READER_ROLES.some((role: string): boolean => {
            return item.startsWith(`${role} on `);
          })
        );
      });
    });
  }

  function isAwsWrite(item: string): boolean {
    const verb: string = actionOf(item).split(":")[1] || "";

    return AWS_WRITE_VERB.some((write: string): boolean => {
      return verb.startsWith(write);
    });
  }

  function isWafAction(item: string): boolean {
    return actionOf(item).startsWith("wafv2:");
  }

  // A write to a data store: anything written but AWS WAF's.
  function writes(grant: CommandGrant): boolean {
    return Object.keys(grant.grants).some((identity: string): boolean => {
      const items: Array<string> = grant.grants[identity]!;

      if (identity.startsWith("custom role ")) {
        // A custom role of Azure's or Google Cloud's: anything but a read.
        return items.some((permission: string): boolean => {
          return !(permission.endsWith("/read") || permission.endsWith(".get"));
        });
      }

      return items.some((item: string): boolean => {
        return !isWafAction(item) && isAwsWrite(item);
      });
    });
  }

  // A write to AWS WAF's IP sets, which only the blocklist's policy grants.
  function writesIpSets(grant: CommandGrant): boolean {
    return Object.values(grant.grants).some((items: Array<string>): boolean => {
      return items.some((item: string): boolean => {
        return (
          isWafAction(item) &&
          isAwsWrite(item) &&
          actionOf(item).endsWith("IPSet")
        );
      });
    });
  }

  // A write to a web ACL.
  function writesWebAcls(grant: CommandGrant): boolean {
    return Object.values(grant.grants).some((items: Array<string>): boolean => {
      return items.some((item: string): boolean => {
        return actionOf(item) === "wafv2:UpdateWebACL";
      });
    });
  }

  test("content samples when it reads data, Data security response when it writes a data store, the blocklist's lines when it writes AWS WAF, and nothing when it only reads settings", () => {
    for (const way of WAYS) {
      for (const choice of choicesOf(way)) {
        const grant: CommandGrant = readCommand(way, commandFor(way, choice));
        const extras: Array<CloudConnectionAccessExtra> =
          getCloudConnectionAccessExtras(
            getCloudConnectionCommandSettings(savedConfig(way, choice)),
          );

        expect({
          way: describeWay(way, choice),
          extras,
        }).toEqual({
          way: describeWay(way, choice),
          extras: [
            ...(readsData(grant)
              ? [CloudConnectionAccessExtra.ContentSamples]
              : []),
            ...(writes(grant)
              ? [CloudConnectionAccessExtra.DataSecurityResponse]
              : []),
            ...(writesIpSets(grant)
              ? [CloudConnectionAccessExtra.WafIpSets]
              : []),
            ...(writesWebAcls(grant)
              ? [CloudConnectionAccessExtra.WafRule]
              : []),
          ],
        });
      }
    }
  });

  test("the checks see what they look for: each write and a data read are found in the commands that grant them", () => {
    const aws: CommandWay = WAYS[0]!;
    const read: (choice: CommandChoice) => Array<boolean> = (
      choice: CommandChoice,
    ): Array<boolean> => {
      const grant: CommandGrant = readCommand(aws, commandFor(aws, choice));

      return [
        readsData(grant),
        writes(grant),
        writesIpSets(grant),
        writesWebAcls(grant),
      ];
    };

    expect(
      read({
        dataSecurity: "content",
        dataSecurityResponse: "block",
        wafBlocklist: "rule",
      }),
    ).toEqual([true, true, true, true]);
    expect(
      read({
        dataSecurity: "configuration",
        dataSecurityResponse: "off",
        wafBlocklist: "off",
      }),
    ).toEqual([false, false, false, false]);
    expect(
      read({
        dataSecurity: "off",
        dataSecurityResponse: "off",
        wafBlocklist: "code",
      }),
    ).toEqual([false, false, true, false]);
    expect(
      read({
        dataSecurity: "off",
        dataSecurityResponse: "block",
        wafBlocklist: "off",
      }),
    ).toEqual([false, true, false, false]);
  });

  test("in the order the lines are drawn, and none for a stored value that is not one of the choices", () => {
    expect(
      getCloudConnectionAccessExtras({
        dataSecurity: "content",
        dataSecurityResponse: "block",
        wafBlocklist: "rule",
      }),
    ).toEqual([
      CloudConnectionAccessExtra.ContentSamples,
      CloudConnectionAccessExtra.DataSecurityResponse,
      CloudConnectionAccessExtra.WafIpSets,
      CloudConnectionAccessExtra.WafRule,
    ]);
    expect(getCloudConnectionAccessExtras({ wafBlocklist: "code" })).toEqual([
      CloudConnectionAccessExtra.WafIpSets,
    ]);
    expect(getCloudConnectionAccessExtras({})).toEqual([]);
    expect(
      getCloudConnectionAccessExtras({
        dataSecurity: "configuration",
        dataSecurityResponse: "off",
        wafBlocklist: "off",
      }),
    ).toEqual([]);
    expect(
      getCloudConnectionAccessExtras({
        dataSecurity: "Content" as CloudConnectionDataSecurityLevel,
        dataSecurityResponse: "on" as CloudConnectionDataSecurityResponse,
        wafBlocklist: "Rule" as CloudConnectionWafBlocklist,
      }),
    ).toEqual([]);
  });
});
