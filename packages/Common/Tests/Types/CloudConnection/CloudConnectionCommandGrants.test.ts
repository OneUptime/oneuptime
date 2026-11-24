import { describe, expect, test } from "@jest/globals";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_CONNECTION_DATA_SECURITY_LEVELS,
  CLOUD_CONNECTION_DATA_SECURITY_RESPONSES,
  CloudConnectionAuthMethod,
  CloudConnectionAuthMethodDefinition,
  CloudConnectionCatalog,
  CloudConnectionDataSecurityLevel,
  CloudConnectionDataSecurityResponse,
  CloudConnectionDefinition,
  CloudConnectionField,
  DATA_SECURITY_FIELD_KEY,
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  READ_SCOPE_FIELD_KEY,
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
 *     nothing else.
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
}

const CHOICES: Array<CommandChoice> =
  CLOUD_CONNECTION_DATA_SECURITY_LEVELS.flatMap(
    (dataSecurity: CloudConnectionDataSecurityLevel): Array<CommandChoice> => {
      return CLOUD_CONNECTION_DATA_SECURITY_RESPONSES.map(
        (
          dataSecurityResponse: CloudConnectionDataSecurityResponse,
        ): CommandChoice => {
          return { dataSecurity, dataSecurityResponse };
        },
      );
    },
  );

function describeWay(way: CommandWay, choice?: CommandChoice): string {
  return [
    way.definition.provider,
    way.method,
    way.scope,
    ...(choice ? [choice.dataSecurity, choice.dataSecurityResponse] : []),
  ].join(" / ");
}

/*
 * What the form saves for a way and a choice: the scope only for a method
 * that reads one (an AWS access key's never), as readCloudConnectionForm
 * keeps the fields of the method picked.
 */
function savedConfig(way: CommandWay, choice: CommandChoice): JSONObject {
  const fields: Array<CloudConnectionField> = getCloudConnectionFieldsForMethod(
    way.definition.configFields,
    way.method,
  );
  const hasScope: boolean = fields.some(
    (field: CloudConnectionField): boolean => {
      return field.key === READ_SCOPE_FIELD_KEY;
    },
  );

  return {
    authMethod: way.method,
    ...(hasScope ? { [READ_SCOPE_FIELD_KEY]: way.scope } : {}),
    [DATA_SECURITY_FIELD_KEY]: choice.dataSecurity,
    [DATA_SECURITY_RESPONSE_FIELD_KEY]: choice.dataSecurityResponse,
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
const AWS_GROUP_POLICY: string = `aws iam put-group-policy --group-name ${AWS_DATA_SECURITY_GROUP_NAME} --policy-name `;
const POLICY_DOCUMENT: string = " --policy-document '";

function readAwsCommand(command: string): CommandGrant {
  const grant: CommandGrant = emptyGrant();
  const lines: Array<string> = command.split(LINE_BREAK);
  let inTemplate: boolean = false;
  let userJoinsGroup: boolean = false;
  const groupStatements: Array<string> = [];
  const groupPolicies: Array<string> = [];

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

    if (line.startsWith(AWS_GROUP_POLICY)) {
      groupPolicies.push(
        line.slice(AWS_GROUP_POLICY.length).split(POLICY_DOCUMENT)[0]!,
      );
      groupStatements.push(...statementsOf(policyAfter(line, POLICY_DOCUMENT)));
      continue;
    }

    if (
      line ===
      `aws iam add-user-to-group --user-name ${CLOUD_CONNECTION_READ_ONLY_NAME} --group-name ${AWS_DATA_SECURITY_GROUP_NAME}`
    ) {
      userJoinsGroup = true;
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
      line ===
        `aws iam create-group --group-name ${AWS_DATA_SECURITY_GROUP_NAME} > /dev/null 2>&1 || true` ||
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

  // The group's policies are the user's once it joins the group, and only then.
  if (userJoinsGroup) {
    for (const name of groupPolicies) {
      addPolicy(grant, "user", name);
    }

    addGrant(grant, "user", groupStatements);
  } else {
    expect(groupPolicies).toEqual([]);
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

function awsNeeds(
  choice: CommandChoice,
  isManagementRole: boolean,
): { statements: Array<string>; policies: Array<string> } {
  const reads: boolean = choice.dataSecurity !== "off";
  const responds: boolean = choice.dataSecurityResponse === "block";

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
      ]),
    ).sort(),
    policies: [
      CLOUD_CONNECTION_READ_ONLY_NAME,
      ...(reads ? [AWS_DATA_SECURITY_POLICY_NAME] : []),
      ...(responds ? [AWS_DATA_SECURITY_RESPONSE_POLICY_NAME] : []),
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
  });

  test("grants exactly what each choice needs: no more, no less, and nothing left unread", () => {
    let checked: number = 0;

    for (const way of WAYS) {
      for (const choice of CHOICES) {
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

    // Seven ways, six choices each.
    expect(checked).toBe(42);
  });

  test("a choice only adds: every line of the command with both settings off is still there, in order, but an organization's template, which carries the policies", () => {
    for (const way of WAYS) {
      const off: Array<string> = commandFor(way, {
        dataSecurity: "off",
        dataSecurityResponse: "off",
      }).split(LINE_BREAK);

      for (const choice of CHOICES) {
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

  test("the organization's StackSet template says what its role may do: only read until it may write, then what it may fix", () => {
    const organization: CommandWay = WAYS.find((way: CommandWay): boolean => {
      return (
        way.definition.provider === CloudProvider.AWS &&
        way.scope === CloudConnectionSetupScope.Organization
      );
    })!;

    for (const choice of CHOICES) {
      const template: JSONObject = JSON.parse(
        commandFor(organization, choice).split(LINE_BREAK)[1]!,
      ) as JSONObject;
      const description: string = template["Description"] as string;
      const responds: boolean = choice.dataSecurityResponse === "block";

      expect({ choice, description }).toEqual({
        choice,
        description: [
          `OneUptime: a role that ${responds ? "reads" : "can only read"} this account's metrics, resources, changes and health events`,
          choice.dataSecurity === "content"
            ? ", and its data stores' configuration and samples of their content"
            : choice.dataSecurity === "configuration"
              ? ", and its data stores' configuration"
              : "",
          responds
            ? "; it may also close a data store's exposures and fix its settings"
            : "",
          ".",
        ].join(""),
      });
    }
  });

  test("Close exposures and fix settings is in the command on every cloud: AWS's policy, Azure's and Google Cloud's custom roles", () => {
    const block: CommandChoice = {
      dataSecurity: "off",
      dataSecurityResponse: "block",
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
        commandFor(way, { dataSecurity: "off", dataSecurityResponse: "off" }),
      ).not.toContain(name);
    }
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
    ];
  };

  test("each value the form saves reads as itself", () => {
    for (const choice of CHOICES) {
      for (const scope of [
        CloudConnectionSetupScope.Account,
        CloudConnectionSetupScope.Organization,
      ]) {
        expect(
          read({
            [READ_SCOPE_FIELD_KEY]: scope,
            [DATA_SECURITY_FIELD_KEY]: choice.dataSecurity,
            [DATA_SECURITY_RESPONSE_FIELD_KEY]: choice.dataSecurityResponse,
          }),
        ).toEqual([scope, choice.dataSecurity, choice.dataSecurityResponse]);
      }
    }
  });

  test("nothing kept, or anything else, is the one account with both settings off", () => {
    expect(read(undefined)).toEqual(["account", "off", "off"]);
    expect(read(null)).toEqual(["account", "off", "off"]);
    expect(read({})).toEqual(["account", "off", "off"]);

    const others: Array<JSONValue> = [
      "Organization",
      "everything",
      "Content",
      " content ",
      "on",
      "Block",
      " block ",
      true,
      1,
      null,
      ["content"],
      { value: "content" },
    ];

    for (const value of others) {
      expect({
        value,
        read: read({
          [READ_SCOPE_FIELD_KEY]: value,
          [DATA_SECURITY_FIELD_KEY]: value,
          [DATA_SECURITY_RESPONSE_FIELD_KEY]: value,
        }),
      }).toEqual({ value, read: ["account", "off", "off"] });
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

  test("they are what to read and Data Security's two settings, on every cloud", () => {
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
 * security response exactly when it lets it write.
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
        const verb: string = actionOf(item).split(":")[1] || "";

        return AWS_WRITE_VERB.some((write: string): boolean => {
          return verb.startsWith(write);
        });
      });
    });
  }

  test("content samples when it reads data, Data security response when it writes, and nothing when it only reads settings", () => {
    for (const way of WAYS) {
      for (const choice of CHOICES) {
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
          ],
        });
      }
    }
  });

  test("the checks see what they look for: a write and a data read are found in the commands that grant them", () => {
    const aws: CommandWay = WAYS[0]!;
    const both: CommandGrant = readCommand(
      aws,
      commandFor(aws, {
        dataSecurity: "content",
        dataSecurityResponse: "block",
      }),
    );
    const neither: CommandGrant = readCommand(
      aws,
      commandFor(aws, {
        dataSecurity: "configuration",
        dataSecurityResponse: "off",
      }),
    );

    expect([readsData(both), writes(both)]).toEqual([true, true]);
    expect([readsData(neither), writes(neither)]).toEqual([false, false]);
  });

  test("in the order the lines are drawn, and none for a stored value that is not one of the choices", () => {
    expect(
      getCloudConnectionAccessExtras({
        dataSecurity: "content",
        dataSecurityResponse: "block",
      }),
    ).toEqual([
      CloudConnectionAccessExtra.ContentSamples,
      CloudConnectionAccessExtra.DataSecurityResponse,
    ]);
    expect(getCloudConnectionAccessExtras({})).toEqual([]);
    expect(
      getCloudConnectionAccessExtras({
        dataSecurity: "configuration",
        dataSecurityResponse: "off",
      }),
    ).toEqual([]);
    expect(
      getCloudConnectionAccessExtras({
        dataSecurity: "Content" as CloudConnectionDataSecurityLevel,
        dataSecurityResponse: "on" as CloudConnectionDataSecurityResponse,
      }),
    ).toEqual([]);
  });
});
