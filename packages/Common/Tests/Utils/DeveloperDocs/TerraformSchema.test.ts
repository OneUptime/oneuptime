import { describe, expect, test } from "@jest/globals";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import Alert from "../../../Models/DatabaseModels/Alert";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Models from "../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Workflow from "../../../Models/DatabaseModels/Workflow";
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

describe("toTerraformSnakeCase (the provider's StringUtils.toSnakeCase)", () => {
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

describe("resource type names", () => {
  test.each([
    [Workflow, "oneuptime_workflow"],
    [Monitor, "oneuptime_monitor"],
    [StatusPage, "oneuptime_status_page"],
    [OnCallDutyPolicy, "oneuptime_on_call_policy"],
    [ScheduledMaintenance, "oneuptime_scheduled_maintenance_event"],
    [VMwareVCenter, "oneuptime_v_center"],
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
      "webhook_secret_key",
      "incoming_email_secret_key",
    ]);
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
    for (const name of [
      "current_monitor_status_id",
      "telemetry_monitor_next_monitor_at",
      "server_monitor_response",
      "incoming_monitor_request",
    ]) {
      expect({
        name,
        managed: attribute(Monitor, name).isServerManaged,
      }).toEqual({ name, managed: true });
    }

    for (const name of ["monitoring_interval", "labels", "monitor_steps"]) {
      expect({
        name,
        managed: attribute(Monitor, name).isServerManaged,
      }).toEqual({ name, managed: false });
    }
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
    expect(isServerManagedColumn("StatusPage", "sendNextReportBy")).toBe(true);
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
    expect(attribute(KubernetesCluster, "last_seen_at").isServerManaged).toBe(
      true,
    );
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
    expect(attribute(InventoryItem, "source").isReservedName).toBe(false);
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
