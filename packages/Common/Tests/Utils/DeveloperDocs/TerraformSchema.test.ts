import { describe, expect, test } from "@jest/globals";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import Alert from "../../../Models/DatabaseModels/Alert";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Models from "../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import ServerOwned from "../../../Types/Database/ServerOwned";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { WorkflowRunAs } from "../../../Types/Workflow/WorkflowRunAs";
import {
  canLookUpByName,
  getNameColumn,
  getTerraformAttribute,
  getTerraformAttributes,
  getTerraformModelOperations,
  getTerraformTypeName,
  isServerManagedColumn,
  SERVER_MANAGED_COLUMNS_BY_TABLE,
  TerraformAttributeDescriptor,
  TerraformSecretKind,
  TerraformValueKind,
  TERRAFORM_RESOURCE_META_ARGUMENTS,
  toTerraformSnakeCase,
  toTerraformTypeSnakeCase,
} from "../../../Utils/DeveloperDocs/TerraformSchema";

/*
 * TerraformSchema repeats, in the browser, how the Terraform provider derives
 * a resource from a model. TerraformProviderSchemaContract.test.ts holds it to
 * the real provider for every model; these pin the rules on the resources
 * people use most, so a failure says which rule broke.
 */

function attribute(
  modelType: DatabaseBaseModelType,
  attributeName: string,
): TerraformAttributeDescriptor {
  const found: TerraformAttributeDescriptor | undefined =
    getTerraformAttributes(modelType).find(
      (descriptor: TerraformAttributeDescriptor): boolean => {
        return descriptor.attributeName === attributeName;
      },
    );

  if (!found) {
    throw new Error(`${modelType.name} has no attribute ${attributeName}`);
  }

  return found;
}

function attributeNames(modelType: DatabaseBaseModelType): Array<string> {
  return getTerraformAttributes(modelType).map(
    (descriptor: TerraformAttributeDescriptor): string => {
      return descriptor.attributeName;
    },
  );
}

describe("toTerraformSnakeCase (the provider's attribute names, StringUtils.toLegacySnakeCase)", () => {
  test.each([
    ["isEnabled", "is_enabled"],
    ["monitorSteps", "monitor_steps"],
    ["On-Call Policy", "on_call_policy"],
    ["Status Page", "status_page"],
    ["APIKey", "api_key"],
    ["vCenter", "v_center"],
    ["DockerSwarm Cluster", "docker_swarm_cluster"],
    ["RUM Application", "rum_application"],
    ["IoT Fleet", "io_t_fleet"],
    ["customCSS", "custom_css"],
    ["headerHTML", "header_html"],
    ["Owner's Team", "owners_team"],
  ])("%s -> %s", (input: string, expected: string) => {
    expect(toTerraformSnakeCase(input)).toBe(expected);
  });
});

describe("toTerraformTypeSnakeCase (the provider's type names, StringUtils.toSnakeCase)", () => {
  test.each([
    ["IoT Fleet", "iot_fleet"],
    ["vCenter", "vcenter"],
    ["vCenter Label Rule", "vcenter_label_rule"],
    ["OpenStack Cloud Owner Team", "openstack_cloud_owner_team"],
    ["WhatsApp Log", "whatsapp_log"],
    ["On-Call Policy", "on_call_policy"],
    ["Status Page", "status_page"],
    ["APIKey", "api_key"],
    ["Patriot Fleet", "patriot_fleet"],
  ])("%s -> %s", (input: string, expected: string) => {
    expect(toTerraformTypeSnakeCase(input)).toBe(expected);
  });
});

describe("resource type names", () => {
  test.each([
    [Workflow, "oneuptime_workflow"],
    [Monitor, "oneuptime_monitor"],
    [StatusPage, "oneuptime_status_page"],
    [OnCallDutyPolicy, "oneuptime_on_call_policy"],
    [ScheduledMaintenance, "oneuptime_scheduled_maintenance_event"],
    [VMwareVCenter, "oneuptime_vcenter"],
    [OpenStackCloud, "oneuptime_openstack_cloud"],
    [IoTFleet, "oneuptime_iot_fleet"],
    [DockerSwarmCluster, "oneuptime_docker_swarm_cluster"],
  ])("%p is %s", (modelType: DatabaseBaseModelType, expected: string) => {
    expect(getTerraformTypeName(modelType)).toBe(expected);
  });

  test("a model the API does not document has no Terraform type", () => {
    expect(getTerraformTypeName(EmailVerificationToken)).toBeNull();
    expect(getTerraformAttributes(EmailVerificationToken)).toEqual([]);
  });

  test("a model that cannot be created over the API has a data source but no resource", () => {
    expect(getTerraformTypeName(AIInsight)).toBe("oneuptime_ai_insight");
    expect(getTerraformModelOperations(AIInsight).canCreate).toBe(false);
    expect(getTerraformAttributes(AIInsight)).toEqual([]);
  });
});

describe("a workflow's attributes", () => {
  test("are exactly the provider's", () => {
    expect(attributeNames(Workflow)).toEqual([
      "project_id",
      "name",
      "description",
      "is_archived",
      "is_enabled",
      "graph",
      "labels",
      "run_as",
      "run_as_custom_role_id",
      "webhook_secret_key",
      "incoming_email_secret_key",
      "webhook_signing_secret",
    ]);
  });

  /*
   * What its steps can do in the project (#9695, #9720): the
   * configuration's to give, Default unless it says otherwise, set when the
   * workflow is made and changed in place. Who gave it those permissions,
   * and when, OneUptime records from whoever saved it: no configuration
   * sets them, so they are no attribute.
   */
  test("what it runs as is configuration, Default unless it says otherwise; who gave it is OneUptime's", () => {
    const runAs: TerraformAttributeDescriptor = attribute(Workflow, "run_as");
    const role: TerraformAttributeDescriptor = attribute(
      Workflow,
      "run_as_custom_role_id",
    );

    expect(runAs.kind).toBe(TerraformValueKind.String);
    expect(runAs.defaultValue).toBe(WorkflowRunAs.Default);
    expect(runAs.isRequired).toBe(false);
    expect(runAs.isServerManaged).toBe(false);
    expect([runAs.inCreateSchema, runAs.inUpdateSchema]).toEqual([true, true]);

    expect(role.kind).toBe(TerraformValueKind.String);
    expect(role.relatedModelType).toBe(CustomRole);
    expect(role.isRequired).toBe(false);
    expect(role.isServerManaged).toBe(false);
    expect([role.inCreateSchema, role.inUpdateSchema]).toEqual([true, true]);

    for (const name of [
      "run_as_given_by_user_id",
      "run_as_given_by_api_key_id",
      "run_as_given_at",
    ]) {
      expect(attributeNames(Workflow)).not.toContain(name);
    }
  });

  test("each has the provider's type", () => {
    expect(attribute(Workflow, "name").kind).toBe(TerraformValueKind.String);
    expect(attribute(Workflow, "is_enabled").kind).toBe(
      TerraformValueKind.Bool,
    );
    expect(attribute(Workflow, "graph").kind).toBe(TerraformValueKind.Json);
    expect(attribute(Workflow, "labels").kind).toBe(TerraformValueKind.IdSet);
  });

  test("only the name is required, and is_enabled defaults to off", () => {
    expect(
      getTerraformAttributes(Workflow)
        .filter((descriptor: TerraformAttributeDescriptor): boolean => {
          return descriptor.isRequired;
        })
        .map((descriptor: TerraformAttributeDescriptor): string => {
          return descriptor.attributeName;
        }),
    ).toEqual(["name"]);
    expect(attribute(Workflow, "is_enabled").defaultValue).toBe(false);
  });

  test("the webhook and incoming email keys are secrets the API sets, changeable on update only", () => {
    for (const name of ["webhook_secret_key", "incoming_email_secret_key"]) {
      const descriptor: TerraformAttributeDescriptor = attribute(
        Workflow,
        name,
      );
      expect(descriptor.secretKind).toBe(TerraformSecretKind.Secret);
      expect(descriptor.inCreateSchema).toBe(false);
      expect(descriptor.inUpdateSchema).toBe(true);
    }
  });

  /*
   * The Huntress trigger's signing secret is the configuration's to give, as
   * a vCenter's password is: write-only (nobody reads it back, so the
   * provider keeps the value it was given) and a secret. Whether one is
   * saved is the server's to say, so, like is_v_center_password_set, it is
   * no attribute a configuration sets: the provider only reads it.
   */
  test("the signing secret is a write-only secret set on create or update; whether one is saved is not configuration", () => {
    const secret: TerraformAttributeDescriptor = attribute(
      Workflow,
      "webhook_signing_secret",
    );

    expect(secret.secretKind).toBe(TerraformSecretKind.Secret);
    expect(secret.readPermissions).toEqual([]);
    expect(secret.inCreateSchema).toBe(true);
    expect(secret.inUpdateSchema).toBe(true);
    expect(secret.isRequired).toBe(false);

    // isWebhookSigningSecretSet, isVCenterPasswordSet: the server's flags.
    const savedFlag: RegExp = /^is\w+Set$/;

    for (const modelType of [Workflow, VMwareVCenter, OpenStackCloud]) {
      expect(
        getTerraformAttributes(modelType)
          .map((descriptor: TerraformAttributeDescriptor): string => {
            return descriptor.columnName;
          })
          .filter((columnName: string): boolean => {
            return savedFlag.test(columnName);
          }),
      ).toEqual([]);
    }
  });

  test("the project is filled in by the server", () => {
    expect(attribute(Workflow, "project_id").isServerManaged).toBe(true);
    expect(attribute(Workflow, "name").isServerManaged).toBe(false);
  });

  test("who created it is no attribute at all: OneUptime decides it", () => {
    expect(
      getTerraformAttributes(Workflow).map(
        (descriptor: TerraformAttributeDescriptor): string => {
          return descriptor.attributeName;
        },
      ),
    ).not.toContain("created_by_user_id");
  });
});

describe("a monitor's attributes", () => {
  test("monitor_steps is the typed nested attribute", () => {
    expect(attribute(Monitor, "monitor_steps").kind).toBe(
      TerraformValueKind.MonitorSteps,
    );
  });

  test("monitor_type is required and can only be set when the monitor is created", () => {
    const monitorType: TerraformAttributeDescriptor = attribute(
      Monitor,
      "monitor_type",
    );
    expect(monitorType.isRequired).toBe(true);
    expect(monitorType.inCreateSchema).toBe(true);
    expect(monitorType.inUpdateSchema).toBe(false);
  });

  test("its current status and the probes' bookkeeping are the server's", () => {
    // The status it starts in is an attribute, the server's after the create.
    expect(
      attribute(Monitor, "current_monitor_status_id").isServerManaged,
    ).toBe(true);

    // Only OneUptime writes the bookkeeping: no attribute at all (#9985).
    for (const name of [
      "telemetry_monitor_next_monitor_at",
      "telemetry_monitor_last_monitor_at",
      "server_monitor_response",
      "server_monitor_request_received_at",
      "incoming_request_monitor_heartbeat_checked_at",
    ]) {
      expect({
        name,
        isAttribute: attributeNames(Monitor).includes(name),
      }).toEqual({ name, isAttribute: false });
    }

    for (const name of ["monitoring_interval", "monitor_steps"]) {
      expect({
        name,
        managed: attribute(Monitor, name).isServerManaged,
      }).toEqual({ name, managed: false });
    }

    /*
     * Its labels are a person's and a label rule's both (#10052): an
     * attribute OneUptime changes too, and a list held entry by entry
     * (#10134), which the Terraform page writes and the Crossplane page
     * leaves out.
     */
    expect({
      managed: attribute(Monitor, "labels").isServerManaged,
      changedByOneUptimeToo: attribute(Monitor, "labels")
        .isChangedByOneUptimeToo,
      heldEntryByEntry: attribute(Monitor, "labels").isHeldEntryByEntry,
      startsAtCreate: attribute(Monitor, "labels").startsAtCreate,
    }).toEqual({
      managed: true,
      changedByOneUptimeToo: true,
      heldEntryByEntry: true,
      startsAtCreate: false,
    });

    // A value OneUptime changes too is no list: never held entry by entry.
    for (const [modelType, name] of [
      [KubernetesCluster, "is_ai_investigation_enabled"],
      [Monitor, "name"],
      [Monitor, "monitor_steps"],
    ] as Array<[DatabaseBaseModelType, string]>) {
      expect({
        name,
        heldEntryByEntry: attribute(modelType, name).isHeldEntryByEntry,
      }).toEqual({ name, heldEntryByEntry: false });
    }
  });

  /*
   * The server writes an Incoming Request monitor's latest request from
   * each request it receives: nobody may set it on a create or change it
   * on an update (#6541), so a configuration cannot set it either.
   */
  test("its latest incoming request is no attribute: only the server writes it", () => {
    expect(
      getTerraformAttribute(Monitor, "incomingMonitorRequest"),
    ).toBeUndefined();
    expect(
      getTerraformAttribute(Monitor, "incomingMonitorRequestAsReceived"),
    ).toBeUndefined();
  });
});

describe("secrets", () => {
  test("a hashed column is a secret that cannot be read back", () => {
    expect(attribute(StatusPage, "master_password").secretKind).toBe(
      TerraformSecretKind.Hashed,
    );
  });

  test("a token is a secret by its name", () => {
    expect(
      attribute(StatusPage, "embedded_overall_status_token").secretKind,
    ).toBe(TerraformSecretKind.Secret);
  });

  test("the switch that turns a password on is not a secret", () => {
    expect(
      attribute(StatusPage, "enable_master_password").secretKind,
    ).toBeUndefined();
    expect(attribute(StatusPage, "enable_master_password").kind).toBe(
      TerraformValueKind.Bool,
    );
  });
});

describe("server-managed columns", () => {
  test("state machine positions and timestamps the server moves", () => {
    expect(isServerManagedColumn("Incident", "currentIncidentStateId")).toBe(
      true,
    );
    expect(isServerManagedColumn("AnyTable", "lastSeenAt")).toBe(true);
    expect(isServerManagedColumn("AnyTable", "nextPollAt")).toBe(true);
    expect(isServerManagedColumn("Incident", "postmortemPostedAt")).toBe(true);
  });

  test("a column its model says OneUptime keeps, whatever its name", () => {
    const status: TableColumnMetadata = new Monitor().getTableColumnMetadata(
      "currentMonitorStatusId",
    );
    expect(status.serverOwned).toBe(ServerOwned.AfterCreate);
    expect(
      isServerManagedColumn("Monitor", "currentMonitorStatusId", status),
    ).toBe(true);
    expect(
      isServerManagedColumn("AnyTable", "anything", {
        type: TableColumnType.Date,
        serverOwned: ServerOwned.AfterCreate,
      }),
    ).toBe(true);
    expect(
      isServerManagedColumn("AnyTable", "anything", {
        type: TableColumnType.Date,
      }),
    ).toBe(false);
    // A start a create gives is still an attribute: the status a monitor starts in.
    expect(
      attribute(Monitor, "current_monitor_status_id").isServerManaged,
    ).toBe(true);
  });

  test("what only OneUptime writes is no attribute at all", () => {
    for (const [modelType, column] of [
      [Monitor, "telemetryMonitorLastMonitorAt"],
      [Monitor, "telemetryMonitorNextMonitorAt"],
      [StatusPage, "sendNextReportBy"],
      [KubernetesCluster, "lastSeenAt"],
    ] as Array<[DatabaseBaseModelType, string]>) {
      expect([column, getTerraformAttribute(modelType, column)]).toEqual([
        column,
        undefined,
      ]);
    }
  });

  test("every column listed by table is an attribute of that table's resource", () => {
    /*
     * The list is for columns a configuration could set but should leave to
     * the server. A listed column that is no attribute at all - nobody may
     * write it - contradicts its own model, as the episode an incident or
     * alert is in once did.
     */
    const notAttributes: Array<string> = [];

    for (const [tableName, columns] of Object.entries(
      SERVER_MANAGED_COLUMNS_BY_TABLE,
    )) {
      const modelType: DatabaseBaseModelType | undefined = (
        Models as Array<DatabaseBaseModelType>
      ).find((candidate: DatabaseBaseModelType): boolean => {
        return new candidate().tableName === tableName;
      });

      expect({ tableName, found: Boolean(modelType) }).toEqual({
        tableName,
        found: true,
      });

      for (const column of columns) {
        if (!getTerraformAttribute(modelType!, column)) {
          notAttributes.push(`${tableName}.${column}`);
        }
      }
    }

    expect(notAttributes).toEqual([]);
  });

  test("an incident's or alert's episode is no attribute: OneUptime sets it from the episode's members", () => {
    for (const [modelType, column] of [
      [Incident, "incidentEpisodeId"],
      [Alert, "alertEpisodeId"],
    ] as Array<[DatabaseBaseModelType, string]>) {
      expect(getTerraformAttribute(modelType, column)).toBeUndefined();
      expect(attributeNames(modelType)).not.toContain(
        toTerraformSnakeCase(column),
      );
    }
  });

  test("configuration is not", () => {
    expect(isServerManagedColumn("Incident", "incidentSeverityId")).toBe(false);
    expect(isServerManagedColumn("ScheduledMaintenance", "startsAt")).toBe(
      false,
    );
    expect(isServerManagedColumn("AnyTable", "description")).toBe(false);
  });

  test("a cluster's agent-reported fields are not configuration", () => {
    // Only OneUptime writes them (#9985): no attribute a configuration sets.
    for (const name of ["last_seen_at", "agent_version", "node_count"]) {
      expect(attributeNames(KubernetesCluster)).not.toContain(name);
    }
  });
});

describe("required attributes", () => {
  test("a JSON column is never required (its schema accepts anything)", () => {
    expect(
      getTerraformAttributes(Incident).some(
        (descriptor: TerraformAttributeDescriptor): boolean => {
          return (
            descriptor.kind === TerraformValueKind.Json && descriptor.isRequired
          );
        },
      ),
    ).toBe(false);
  });

  test("an incident needs a title and a severity", () => {
    expect(attribute(Incident, "title").isRequired).toBe(true);
    expect(attribute(Incident, "incident_severity_id").isRequired).toBe(true);
    expect(attribute(Incident, "description").isRequired).toBe(false);
  });

  test("a scheduled maintenance event needs its start and end", () => {
    expect(attribute(ScheduledMaintenance, "starts_at").kind).toBe(
      TerraformValueKind.DateTime,
    );
    expect(attribute(ScheduledMaintenance, "starts_at").isRequired).toBe(true);
    expect(attribute(ScheduledMaintenance, "ends_at").isRequired).toBe(true);
  });
});

describe("getNameColumn", () => {
  test("name, title, or the model's own display column", () => {
    expect(getNameColumn(Workflow)).toBe("name");
    expect(getNameColumn(Incident)).toBe("title");
    expect(getNameColumn(ScheduledMaintenance)).toBe("title");
  });
});

describe("what an attribute points at", () => {
  test("an id points at the model of the relation it is the key of", () => {
    expect(attribute(Incident, "incident_severity_id").relatedModelType).toBe(
      IncidentSeverity,
    );
    expect(attribute(Alert, "monitor_id").relatedModelType).toBe(Monitor);
    expect(
      attribute(OnCallDutyPolicyEscalationRule, "on_call_duty_policy_id")
        .relatedModelType,
    ).toBe(OnCallDutyPolicy);
  });

  test("an incident's change_monitor_status_to_id is a monitor status, not an incident state", () => {
    expect(
      attribute(Incident, "change_monitor_status_to_id").relatedModelType,
    ).toBe(MonitorStatus);
    expect(
      attribute(ScheduledMaintenance, "change_monitor_status_to_id")
        .relatedModelType,
    ).toBe(MonitorStatus);
  });

  test("a set of ids points at the model of its records", () => {
    expect(attribute(Incident, "monitors").relatedModelType).toBe(Monitor);
    expect(attribute(Workflow, "labels").relatedModelType).toBe(Label);
  });

  test("plain values point at nothing", () => {
    expect(attribute(Incident, "title").relatedModelType).toBeUndefined();
    expect(attribute(Monitor, "monitor_type").relatedModelType).toBeUndefined();
  });

  test("an attribute carries its column's description, for the pages to explain it", () => {
    expect(attribute(Incident, "title").description).toBe(
      "Title of this incident",
    );
  });

  /*
   * A scheduled maintenance event's Change Monitor Status to can be changed
   * until the event starts (the server refuses a change after): in the
   * update schema as in the create schema, so a plan changes it in place
   * rather than replacing the event, and its description says when.
   */
  test("a scheduled maintenance event's change_monitor_status_to_id is set on create and changed in place", () => {
    const status: TerraformAttributeDescriptor = attribute(
      ScheduledMaintenance,
      "change_monitor_status_to_id",
    );

    expect(status.inCreateSchema).toBe(true);
    expect(status.inUpdateSchema).toBe(true);
    expect(status.isServerManaged).toBe(false);
    expect(status.isRequired).toBe(false);
    expect(status.description).toBe(
      "Relation to Monitor Status Object ID. The monitors attached to this event change to this status when the event starts, and back to operational when it ends. It can be changed until the event starts.",
    );
  });

  test("getTerraformAttribute finds one by column", () => {
    expect(
      getTerraformAttribute(Incident, "incidentSeverityId")?.attributeName,
    ).toBe("incident_severity_id");
    expect(getTerraformAttribute(Incident, "createdAt")).toBeUndefined();
  });
});

describe("names Terraform reserves", () => {
  test("lists Terraform's resource meta-arguments", () => {
    expect([...TERRAFORM_RESOURCE_META_ARGUMENTS].sort()).toEqual([
      "connection",
      "count",
      "depends_on",
      "for_each",
      "lifecycle",
      "provider",
      "provisioner",
    ]);
  });

  test("a Kubernetes cluster's provider attribute is named like the provider meta-argument", () => {
    expect(attribute(KubernetesCluster, "provider").isReservedName).toBe(true);
    expect(attribute(KubernetesCluster, "name").isReservedName).toBe(false);
  });

  test("source and version are only reserved in module blocks", () => {
    // An inventory item's source is OneUptime's (#9985); a relationship's is the person's.
    expect(attribute(InventoryItemRelationship, "source").isReservedName).toBe(
      false,
    );
    expect(attributeNames(InventoryItem)).not.toContain("source");
  });
});

describe("looking a record up by name", () => {
  test("works for a model with a name column", () => {
    expect(canLookUpByName(Monitor)).toBe(true);
    expect(canLookUpByName(IncidentSeverity)).toBe(true);
  });

  test("does not for one named by its title: the provider's lookup filters on name", () => {
    expect(canLookUpByName(Incident)).toBe(false);
    expect(canLookUpByName(ScheduledMaintenance)).toBe(false);
  });

  test("does not for a model outside the public API", () => {
    expect(canLookUpByName(EmailVerificationToken)).toBe(false);
  });
});
