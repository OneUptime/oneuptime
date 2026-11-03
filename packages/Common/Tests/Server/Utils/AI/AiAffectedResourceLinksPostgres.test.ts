/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer; nothing here touches the sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AlertGroupingEngineService from "../../../../Server/Services/AlertGroupingEngineService";
import AlertLabelRuleEngineService from "../../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationDecisionService from "../../../../Server/Services/AutoRemediationDecisionService";
import AutoRemediationRuleEngineService from "../../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../../Server/Services/CustomFieldMappingService";
import IncidentGroupingEngineService from "../../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentPrivacyRuleEngineService from "../../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../../Server/Services/IncidentSlaService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import {
  AddAlertAffectedResourcesTool,
  CreateAlertTool,
} from "../../../../Server/Utils/AI/Toolbox/AlertWriteTools";
import {
  AddIncidentAffectedResourcesTool,
  CreateIncidentTool,
} from "../../../../Server/Utils/AI/Toolbox/IncidentWriteTools";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import logger from "../../../../Server/Utils/Logger";
import ProductAnalytics from "../../../../Server/Utils/ProductAnalytics";
import SecurityConnections from "../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import {
  openDedupedAlerts,
  openDedupedIncidents,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventAlerting";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import { AiAffectedResourceKind } from "../../../../Types/AI/AiAffectedResources";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../../Types/AutoRemediation/AutoRemediationDecision";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { KubernetesAiRemediationMode } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import UserType from "../../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * WHAT AN INCIDENT OR ALERT IS LINKED TO, ON A REAL POSTGRES (#5303's
 * follow-up).
 *
 * Opt in with RUN_POSTGRES_AI_AFFECTED_RESOURCE_LINKS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_AI_AFFECTED_RESOURCE_LINKS_TESTS=true \
 *   AI_AFFECTED_RESOURCE_LINKS_TEST_DATABASE_HOST=127.0.0.1 \
 *   AI_AFFECTED_RESOURCE_LINKS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/AI/AiAffectedResourceLinksPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test what
 * incidents and alerts are linked to, on migrated Postgres").
 *
 * The production code runs against structure-only clones of the tables it
 * reads and writes (the project, its labels and hosts, clusters, cloud
 * resources, databases, devices, incidents and alerts with their states and
 * severities, every junction table of their lists, and the remediation
 * decisions) in a schema of its own; every other table it reads is the
 * migrated, empty public one. What an incident's or alert's creation sets
 * off besides its row and its lists - channels, feeds, on-call, rules,
 * investigation - has its own suites and is stubbed. Pinned, by the
 * junction rows Postgres holds:
 *
 *   - Ask AI's create_incident and create_alert, run as a member on a
 *     host's page, link the host they may view - and only it: a host
 *     outside their label-limited read is not linked, and the record is
 *     created all the same;
 *   - add_incident_affected_resources and add_alert_affected_resources,
 *     run as the member, add to what the record holds - a held host they
 *     may not view stays - and a member who may read the record but not
 *     edit it changes nothing;
 *   - a security detection's and Data Security's alerts and incidents are
 *     created holding what their match is about;
 *   - turning a cluster's Fixes on finds, by Postgres's jsonb containment,
 *     the open records whose latest decision said they were off there - and
 *     only those - and decides them again.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_AI_AFFECTED_RESOURCE_LINKS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "Label",
  "Host",
  "HostLabel",
  "KubernetesCluster",
  "CloudResource",
  "DatabaseServer",
  "NetworkDevice",
  "IncidentState",
  "IncidentSeverity",
  "Incident",
  "IncidentLabel",
  "IncidentMonitor",
  "IncidentHost",
  "IncidentKubernetesCluster",
  "IncidentCloudResource",
  "IncidentDatabaseServer",
  "IncidentNetworkDevice",
  "AlertState",
  "AlertSeverity",
  "Alert",
  "AlertLabel",
  "AlertHost",
  "AlertKubernetesCluster",
  "AlertCloudResource",
  "AlertDatabaseServer",
  "AlertNetworkDevice",
  "AutoRemediationDecision",
];

describePostgres("what incidents and alerts are linked to, on migrated Postgres", () => {
  const schema: string = `ai_links_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const memberId: ObjectID = ObjectID.generate();

  let database: DataSource;

  // What the tests read back, seeded once per test.
  let seeded: {
    teamLabelId: ObjectID;
    // A host the member may view: it carries the label their read is limited to.
    viewableHostId: ObjectID;
    // A host the member may not view.
    unviewableHostId: ObjectID;
    clusterId: ObjectID;
    otherClusterId: ObjectID;
    cloudResourceId: ObjectID;
    databaseServerId: ObjectID;
    networkDeviceId: ObjectID;
    openIncidentStateId: ObjectID;
    resolvedIncidentStateId: ObjectID;
    incidentSeverityId: ObjectID;
    openAlertStateId: ObjectID;
    resolvedAlertStateId: ObjectID;
    alertSeverityId: ObjectID;
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["AI_AFFECTED_RESOURCE_LINKS_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["AI_AFFECTED_RESOURCE_LINKS_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AI_AFFECTED_RESOURCE_LINKS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      /*
       * No schema option: TypeORM would then name every table with it, the
       * join tables included. The search path finds the clones first, and
       * the migrated public tables for the rest.
       */
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // No Valkey in this job: a lock is granted at once.
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation(() => {
      // No analytics in tests.
    });
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
      .mockResolvedValue(undefined);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
      .mockResolvedValue(undefined);

    for (const service of [
      IncidentService,
      AlertService,
      KubernetesClusterService,
      AutoRemediationDecisionService,
    ]) {
      jest
        .spyOn(service, "onTriggerRealtime" as never)
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(service, "onTriggerWorkflow" as never)
        .mockResolvedValue(undefined as never);
    }

    /*
     * What a creation sets off besides its row and its lists: channels,
     * feeds, states, on-call, rules, owners, grouping, SLAs, investigation
     * and remediation, each with its own suites.
     */
    for (const method of [
      "handleIncidentWorkspaceOperationsAsync",
      "createIncidentFeedAsync",
      "handleIncidentStateChangeAsync",
      "disableActiveMonitoringIfManualIncident",
      "refreshReminderSchedule",
    ]) {
      jest
        .spyOn(IncidentService as never, method as never)
        .mockResolvedValue(undefined as never);
    }

    for (const method of [
      "handleAlertWorkspaceOperationsAsync",
      "createAlertFeedAsync",
      "handleAlertStateChangeAsync",
      "executeAlertOnCallDutyPoliciesAsync",
      "refreshReminderSchedule",
      "addOwners",
    ]) {
      jest
        .spyOn(AlertService as never, method as never)
        .mockResolvedValue(undefined as never);
    }

    jest
      .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(false);
    jest
      .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentLabelRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentOnCallRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(new Map());
    jest
      .spyOn(RunbookRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentGroupingEngineService, "processIncident")
      .mockResolvedValue({ grouped: false } as never);
    jest
      .spyOn(IncidentSlaService, "createSlaForIncident")
      .mockResolvedValue(null);
    jest
      .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
      .mockResolvedValue(false);
    jest
      .spyOn(IncidentOwnerUserService, "create")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(AlertPrivacyRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(false as never);
    jest
      .spyOn(AlertOwnerRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertLabelRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertOnCallRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(new Map() as never);
    jest
      .spyOn(RunbookRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AlertGroupingEngineService, "processAlert")
      .mockResolvedValue({ grouped: false } as never);
    jest
      .spyOn(AIAlertInvestigationRunner, "investigateNewAlert")
      .mockResolvedValue(false as never);

    // A new record's remediation has its own suites.
    jest
      .spyOn(AutoRemediationRuleEngineService, "onIncidentCreated")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AutoRemediationRuleEngineService, "onAlertCreated")
      .mockResolvedValue(undefined as never);

    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      })
        .reverse()
        .join("; "),
    );

    // Linking writes an update the engine is told of: that has its own suites.
    jest
      .spyOn(AutoRemediationRuleEngineService, "onSubjectUpdated")
      .mockResolvedValue(false);

    seeded = await seedProject();
  });

  afterEach(() => {
    (
      AutoRemediationRuleEngineService.onSubjectUpdated as unknown as {
        mockRestore: () => void;
      }
    ).mockRestore();
  });

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = row[column];
        return value instanceof ObjectID ? value.toString() : value;
      }),
    );
  }

  async function seedResource(
    table: string,
    project: ObjectID,
    name: string,
    extra: Record<string, unknown>,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert(table, {
      _id: id,
      projectId: project,
      name,
      slug: `${name}-${id.toString()}`,
      version: 1,
      ...extra,
    });

    return id;
  }

  async function seedProject(): Promise<typeof seeded> {
    for (const id of [projectId, otherProjectId]) {
      await insert("Project", {
        _id: id,
        name: "Acme",
        slug: `acme-${id.toString()}`,
        version: 1,
      });
    }

    await insert("User", {
      _id: memberId,
      email: `member-${memberId.toString()}@example.com`,
      slug: `member-${memberId.toString()}`,
      version: 1,
    });

    const teamLabelId: ObjectID = await seedResource(
      "Label",
      projectId,
      "payments",
      { color: "#2563eb" },
    );

    const viewableHostId: ObjectID = await seedResource(
      "Host",
      projectId,
      "test01",
      { hostIdentifier: "test01" },
    );
    await insert("HostLabel", { hostId: viewableHostId, labelId: teamLabelId });

    const unviewableHostId: ObjectID = await seedResource(
      "Host",
      projectId,
      "billing-db-host",
      { hostIdentifier: "billing-db-host" },
    );

    const clusterId: ObjectID = await seedResource(
      "KubernetesCluster",
      projectId,
      "prod-eu",
      {
        clusterIdentifier: "prod-eu",
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      },
    );
    const otherClusterId: ObjectID = await seedResource(
      "KubernetesCluster",
      projectId,
      "staging",
      {
        clusterIdentifier: "staging",
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      },
    );

    const cloudResourceId: ObjectID = await seedResource(
      "CloudResource",
      projectId,
      "customer-exports",
      { resourceIdentifier: "arn:aws:s3:::customer-exports" },
    );
    const databaseServerId: ObjectID = await seedResource(
      "DatabaseServer",
      projectId,
      "payments-db",
      { databaseIdentifier: "postgresql|payments-db:5432", dbSystem: "postgresql" },
    );
    const networkDeviceId: ObjectID = await seedResource(
      "NetworkDevice",
      projectId,
      "edge-fw",
      { hostname: "edge-fw" },
    );

    const state: (
      table: "IncidentState" | "AlertState",
      name: string,
      order: number,
      flags: { isCreatedState?: boolean; isResolvedState?: boolean },
    ) => Promise<ObjectID> = async (
      table: "IncidentState" | "AlertState",
      name: string,
      order: number,
      flags: { isCreatedState?: boolean; isResolvedState?: boolean },
    ): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();

      await insert(table, {
        _id: id,
        projectId,
        name,
        ...(table === "IncidentState"
          ? { slug: `${name.toLowerCase()}-${id.toString()}` }
          : {}),
        color: "#6b7280",
        order,
        isCreatedState: flags.isCreatedState ?? false,
        isResolvedState: flags.isResolvedState ?? false,
        version: 1,
      });

      return id;
    };

    const openIncidentStateId: ObjectID = await state(
      "IncidentState",
      "Identified",
      1,
      { isCreatedState: true },
    );
    const resolvedIncidentStateId: ObjectID = await state(
      "IncidentState",
      "Resolved",
      3,
      { isResolvedState: true },
    );
    const openAlertStateId: ObjectID = await state("AlertState", "Identified", 1, {
      isCreatedState: true,
    });
    const resolvedAlertStateId: ObjectID = await state(
      "AlertState",
      "Resolved",
      3,
      { isResolvedState: true },
    );

    const incidentSeverityId: ObjectID = await seedResource(
      "IncidentSeverity",
      projectId,
      "SEV1",
      { color: "#dc2626", order: 1 },
    );
    const alertSeverityId: ObjectID = await seedResource(
      "AlertSeverity",
      projectId,
      "High",
      { color: "#dc2626", order: 1 },
    );

    return {
      teamLabelId,
      viewableHostId,
      unviewableHostId,
      clusterId,
      otherClusterId,
      cloudResourceId,
      databaseServerId,
      networkDeviceId,
      openIncidentStateId,
      resolvedIncidentStateId,
      incidentSeverityId,
      openAlertStateId,
      resolvedAlertStateId,
      alertSeverityId,
    };
  }

  /*
   * A responder who declares and edits incidents and raises and edits
   * alerts, and reads only the hosts of their team's label: what a member
   * may link is what they may view.
   */
  function memberProps(
    permissions: Array<Permission> = [
      Permission.IncidentMember,
      Permission.AlertMember,
    ],
  ): DatabaseCommonInteractionProps {
    const rows: Array<UserPermission> = permissions.map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    );

    rows.push({
      _type: "UserPermission",
      permission: Permission.ReadHost,
      labelIds: [seeded.teamLabelId],
      isBlockPermission: false,
      scope: PermissionScope.Labels,
    });

    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: rows,
    };

    return {
      tenantId: projectId,
      userId: memberId,
      userType: UserType.User,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  function hostPage(hostId: ObjectID): AIChatPageContext {
    return {
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.Host,
      entityId: hostId.toString(),
      entityTitle: "the host",
    };
  }

  function asMember(
    pageContext?: AIChatPageContext,
    props: DatabaseCommonInteractionProps = memberProps(),
  ): ToolContext {
    return {
      projectId,
      props,
      ...(pageContext ? { pageContext } : {}),
    };
  }

  // The junction rows of one record's list, as Postgres holds them.
  async function linked(
    table: string,
    ownerColumn: "incidentId" | "alertId",
    ownerId: ObjectID,
    linkedColumn: string,
  ): Promise<Array<string>> {
    const rows: Array<Record<string, string>> = await database.query(
      `SELECT "${linkedColumn}" AS "id" FROM "${schema}"."${table}" WHERE "${ownerColumn}" = $1 ORDER BY "${linkedColumn}"`,
      [ownerId.toString()],
    );

    return rows.map((row: Record<string, string>): string => {
      return row["id"]!;
    });
  }

  async function onlyIncidentId(): Promise<ObjectID> {
    const rows: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."Incident"`,
    );
    expect(rows).toHaveLength(1);
    return new ObjectID(rows[0]!._id);
  }

  async function onlyAlertId(): Promise<ObjectID> {
    const rows: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."Alert"`,
    );
    expect(rows).toHaveLength(1);
    return new ObjectID(rows[0]!._id);
  }

  async function seedIncident(
    options: { isResolved?: boolean; project?: ObjectID } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("Incident", {
      _id: id,
      projectId: options.project || projectId,
      title: "Memory is high on the payments hosts",
      slug: `incident-${id.toString()}`,
      currentIncidentStateId: options.isResolved
        ? seeded.resolvedIncidentStateId
        : seeded.openIncidentStateId,
      incidentSeverityId: seeded.incidentSeverityId,
      incidentNumber: 7,
      version: 1,
    });

    return id;
  }

  async function seedAlert(
    options: { isResolved?: boolean } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("Alert", {
      _id: id,
      projectId,
      title: "Memory above 90% on test01",
      currentAlertStateId: options.isResolved
        ? seeded.resolvedAlertStateId
        : seeded.openAlertStateId,
      alertSeverityId: seeded.alertSeverityId,
      alertNumber: 9,
      version: 1,
    });

    return id;
  }

  describe("Ask AI's create tools, as a member on a host's page", () => {
    test("create_incident links the host the member may view", async () => {
      await CreateIncidentTool.execute(
        { title: "High memory usage on test01" },
        asMember(hostPage(seeded.viewableHostId)),
      );

      const incidentId: ObjectID = await onlyIncidentId();

      expect(
        await linked("IncidentHost", "incidentId", incidentId, "hostId"),
      ).toEqual([seeded.viewableHostId.toString()]);
    });

    test("a host outside the member's read is not linked, and the incident is declared all the same", async () => {
      await CreateIncidentTool.execute(
        { title: "High memory usage on billing-db-host" },
        asMember(hostPage(seeded.unviewableHostId)),
      );

      const incidentId: ObjectID = await onlyIncidentId();

      expect(
        await linked("IncidentHost", "incidentId", incidentId, "hostId"),
      ).toEqual([]);
    });

    test("create_alert links the host the member may view", async () => {
      await CreateAlertTool.execute(
        { title: "Memory above 90% on test01" },
        asMember(hostPage(seeded.viewableHostId)),
      );

      const alertId: ObjectID = await onlyAlertId();

      expect(await linked("AlertHost", "alertId", alertId, "hostId")).toEqual(
        [seeded.viewableHostId.toString()],
      );
    });

    test("create_alert with an empty list links nothing, on the page of a host it could link", async () => {
      await CreateAlertTool.execute(
        { title: "Something to look at", affectedResources: [] },
        asMember(hostPage(seeded.viewableHostId)),
      );

      expect(
        await linked("AlertHost", "alertId", await onlyAlertId(), "hostId"),
      ).toEqual([]);
    });
  });

  describe("Ask AI's linking tools, as the member", () => {
    test("add_incident_affected_resources adds the host to what the incident holds, and a held host the member may not view stays", async () => {
      const incidentId: ObjectID = await seedIncident();
      await insert("IncidentHost", {
        incidentId,
        hostId: seeded.unviewableHostId,
      });

      await AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: incidentId.toString(),
          affectedResources: [
            {
              resourceType: AiAffectedResourceKind.Host,
              resourceId: seeded.viewableHostId.toString(),
            },
          ],
        },
        asMember(),
      );

      expect(
        await linked("IncidentHost", "incidentId", incidentId, "hostId"),
      ).toEqual(
        [
          seeded.viewableHostId.toString(),
          seeded.unviewableHostId.toString(),
        ].sort(),
      );
    });

    test("a list of another kind is left as it was: linking a host keeps the incident's cluster", async () => {
      const incidentId: ObjectID = await seedIncident();
      await insert("IncidentKubernetesCluster", {
        incidentId,
        kubernetesClusterId: seeded.clusterId,
      });

      await AddIncidentAffectedResourcesTool.execute(
        {
          incidentId: incidentId.toString(),
          affectedResources: [
            {
              resourceType: AiAffectedResourceKind.Host,
              resourceId: seeded.viewableHostId.toString(),
            },
          ],
        },
        asMember(),
      );

      expect(
        await linked(
          "IncidentKubernetesCluster",
          "incidentId",
          incidentId,
          "kubernetesClusterId",
        ),
      ).toEqual([seeded.clusterId.toString()]);
      expect(
        await linked("IncidentHost", "incidentId", incidentId, "hostId"),
      ).toEqual([seeded.viewableHostId.toString()]);
    });

    test("linking what the incident holds already writes nothing", async () => {
      const incidentId: ObjectID = await seedIncident();
      await insert("IncidentHost", {
        incidentId,
        hostId: seeded.viewableHostId,
      });

      const result: { dataForLlm: string } =
        await AddIncidentAffectedResourcesTool.execute(
          {
            incidentId: incidentId.toString(),
            affectedResources: [
              {
                resourceType: AiAffectedResourceKind.Host,
                resourceId: seeded.viewableHostId.toString(),
              },
            ],
          },
          asMember(),
        );

      expect(result.dataForLlm).toContain("nothing changed");
      expect(
        await linked("IncidentHost", "incidentId", incidentId, "hostId"),
      ).toEqual([seeded.viewableHostId.toString()]);
    });

    test("a host outside the member's read is never added", async () => {
      const incidentId: ObjectID = await seedIncident();

      await expect(
        AddIncidentAffectedResourcesTool.execute(
          {
            incidentId: incidentId.toString(),
            affectedResources: [
              {
                resourceType: AiAffectedResourceKind.Host,
                resourceId: seeded.unviewableHostId.toString(),
              },
            ],
          },
          asMember(),
        ),
      ).rejects.toThrow("Nothing was linked");

      expect(
        await linked("IncidentHost", "incidentId", incidentId, "hostId"),
      ).toEqual([]);
    });

    test("a member who may read the incident but not edit it changes nothing", async () => {
      const incidentId: ObjectID = await seedIncident();

      await expect(
        AddIncidentAffectedResourcesTool.execute(
          {
            incidentId: incidentId.toString(),
            affectedResources: [
              {
                resourceType: AiAffectedResourceKind.Host,
                resourceId: seeded.viewableHostId.toString(),
              },
            ],
          },
          asMember(
            undefined,
            memberProps([Permission.IncidentViewer, Permission.AlertViewer]),
          ),
        ),
      ).rejects.toThrow();

      expect(
        await linked("IncidentHost", "incidentId", incidentId, "hostId"),
      ).toEqual([]);
    });

    test("add_alert_affected_resources adds the host to what the alert holds, and a held host the member may not view stays", async () => {
      const alertId: ObjectID = await seedAlert();
      await insert("AlertHost", { alertId, hostId: seeded.unviewableHostId });

      await AddAlertAffectedResourcesTool.execute(
        {
          alertId: alertId.toString(),
          affectedResources: [
            {
              resourceType: AiAffectedResourceKind.Host,
              resourceId: seeded.viewableHostId.toString(),
            },
          ],
        },
        asMember(),
      );

      expect(await linked("AlertHost", "alertId", alertId, "hostId")).toEqual(
        [
          seeded.viewableHostId.toString(),
          seeded.unviewableHostId.toString(),
        ].sort(),
      );
    });

    test("a member who may read the alert but not edit it changes nothing", async () => {
      const alertId: ObjectID = await seedAlert();

      await expect(
        AddAlertAffectedResourcesTool.execute(
          {
            alertId: alertId.toString(),
            affectedResources: [
              {
                resourceType: AiAffectedResourceKind.Host,
                resourceId: seeded.viewableHostId.toString(),
              },
            ],
          },
          asMember(
            undefined,
            memberProps([Permission.IncidentViewer, Permission.AlertViewer]),
          ),
        ),
      ).rejects.toThrow();

      expect(await linked("AlertHost", "alertId", alertId, "hostId")).toEqual(
        [],
      );
    });
  });

  describe("what a security detection and Data Security open", () => {
    test("a detection's alert holds the host and the network device its match names exactly, and the cloud resource it comes from", async () => {
      const entityLinks: jest.SpyInstance = jest
        .spyOn(SecurityConnections, "readEntityLinks")
        .mockResolvedValue([
          {
            kind: SecurityConnectionKind.Host,
            id: seeded.viewableHostId.toString(),
            name: "test01",
            certainty: SecurityConnectionCertainty.Exact,
            matches: [
              {
                entity: { type: SecurityEntityType.Host, value: "test01" },
                certainty: SecurityConnectionCertainty.Exact,
                reason: SecurityConnectionReason.HostName,
                matchedValue: "test01",
              },
            ],
          },
          {
            kind: SecurityConnectionKind.NetworkDevice,
            id: seeded.networkDeviceId.toString(),
            name: "edge-fw",
            certainty: SecurityConnectionCertainty.Exact,
            matches: [],
          },
        ]);

      try {
        const created: number = await openDedupedAlerts({
          projectId,
          alertSeverityId: seeded.alertSeverityId,
          logLabel: "test",
          eventWindow: { start: new Date(), end: new Date() },
          matches: [
            {
              fingerprint: "detection-rule:1:abc",
              title: "[Detection] Brute force — test01",
              description: "Five failed sign-ins, then one that worked.",
              rootCause: "A detection rule matched.",
              entities: [{ type: SecurityEntityType.Host, value: "test01" }],
              affectedResources: [
                {
                  kind: AiAffectedResourceKind.CloudResource,
                  id: seeded.cloudResourceId.toString(),
                },
              ],
            },
          ],
        });

        expect(created).toBe(1);

        const alertId: ObjectID = await onlyAlertId();

        expect(await linked("AlertHost", "alertId", alertId, "hostId")).toEqual(
          [seeded.viewableHostId.toString()],
        );
        expect(
          await linked(
            "AlertNetworkDevice",
            "alertId",
            alertId,
            "networkDeviceId",
          ),
        ).toEqual([seeded.networkDeviceId.toString()]);
        expect(
          await linked(
            "AlertCloudResource",
            "alertId",
            alertId,
            "cloudResourceId",
          ),
        ).toEqual([seeded.cloudResourceId.toString()]);
      } finally {
        entityLinks.mockRestore();
      }
    });

    test("a Data Security incident holds the database server its store is", async () => {
      const created: number = await openDedupedIncidents({
        projectId,
        incidentSeverityId: seeded.incidentSeverityId,
        logLabel: "test",
        matches: [
          {
            fingerprint: "data-security-issue:1",
            title: "Data Security: Card security codes are stored (payments-db)",
            description: "payments-db holds Restricted data.",
            rootCause: "A Data Security check failed.",
            affectedResources: [
              {
                kind: AiAffectedResourceKind.DatabaseServer,
                id: seeded.databaseServerId.toString(),
              },
            ],
          },
        ],
      });

      expect(created).toBe(1);
      expect(
        await linked(
          "IncidentDatabaseServer",
          "incidentId",
          await onlyIncidentId(),
          "databaseServerId",
        ),
      ).toEqual([seeded.databaseServerId.toString()]);
    });
  });

  describe("a cluster's Fixes turned on", () => {
    async function decide(
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
      entries: Array<AutoRemediationDecisionEntry>,
      options: { minutesAgo?: number; project?: ObjectID } = {},
    ): Promise<void> {
      const createdAt: Date = new Date(
        Date.now() - (options.minutesAgo ?? 10) * 60 * 1000,
      );

      await database.query(
        `INSERT INTO "${schema}"."AutoRemediationDecision"
          ("_id", "projectId", "incidentId", "alertId", "stage", "entries", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7, 1)`,
        [
          ObjectID.generate().toString(),
          (options.project || projectId).toString(),
          subject.incidentId?.toString() || null,
          subject.alertId?.toString() || null,
          AutoRemediationDecisionStage.Evaluated,
          JSON.stringify(
            entries.map((entry: AutoRemediationDecisionEntry) => {
              return AutoRemediationDecisionHelper.toJSON(entry);
            }),
          ),
          createdAt,
        ],
      );
    }

    function fixesOff(clusterId: ObjectID): AutoRemediationDecisionEntry {
      return {
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        reason: AutoRemediationDecisionReason.ClusterFixesOff,
        kubernetesClusterId: clusterId.toString(),
        kubernetesClusterName: "prod-eu",
        remediationMode: KubernetesAiRemediationMode.Disabled,
      };
    }

    async function turnFixesOn(clusterId: ObjectID): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."KubernetesCluster" SET "aiRemediationMode" = $2 WHERE "_id" = $1`,
        [clusterId.toString(), KubernetesAiRemediationMode.RequireApproval],
      );
    }

    test("the open records whose latest decision said Fixes were off there are found by jsonb containment, and decided again - only they", async () => {
      // Decided again: open, its latest decision says this cluster's Fixes were off.
      const stopped: ObjectID = await seedIncident();
      await decide({ incidentId: stopped }, [fixesOff(seeded.clusterId)]);

      // An alert stopped the same way is decided again as an alert.
      const stoppedAlert: ObjectID = await seedAlert();
      await decide({ alertId: stoppedAlert }, [
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceNoneLinked,
        },
        fixesOff(seeded.clusterId),
      ]);

      // Not: another cluster's Fixes.
      const otherCluster: ObjectID = await seedIncident();
      await decide({ incidentId: otherCluster }, [
        fixesOff(seeded.otherClusterId),
      ]);

      // Not: resolved since.
      const resolved: ObjectID = await seedIncident({ isResolved: true });
      await decide({ incidentId: resolved }, [fixesOff(seeded.clusterId)]);

      // Not: decided again since, and the latest decision says something else.
      const decidedSince: ObjectID = await seedIncident();
      await decide({ incidentId: decidedSince }, [fixesOff(seeded.clusterId)], {
        minutesAgo: 30,
      });
      await decide(
        { incidentId: decidedSince },
        [
          {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            reason: AutoRemediationDecisionReason.ClusterNotReady,
            kubernetesClusterId: seeded.clusterId.toString(),
          },
        ],
        { minutesAgo: 5 },
      );

      // Not: another project's decision about the same cluster id.
      const otherProject: ObjectID = await seedIncident({
        project: otherProjectId,
      });
      await decide({ incidentId: otherProject }, [fixesOff(seeded.clusterId)], {
        project: otherProjectId,
      });

      await turnFixesOn(seeded.clusterId);

      const appliedToIncidents: jest.SpyInstance = jest
        .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
        .mockResolvedValue(undefined);
      const appliedToAlerts: jest.SpyInstance = jest
        .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlertById")
        .mockResolvedValue(undefined);

      try {
        const decided: number =
          await AutoRemediationRuleEngineService.onFixesTurnedOn({
            projectId,
            target: {
              lane: AutoRemediationDecisionLane.KubernetesCluster,
              id: seeded.clusterId.toString(),
            },
          });

        expect(decided).toBe(2);
        expect(
          appliedToIncidents.mock.calls.map((call: Array<unknown>): string => {
            return (call[0] as { incidentId: ObjectID }).incidentId.toString();
          }),
        ).toEqual([stopped.toString()]);
        expect(
          appliedToAlerts.mock.calls.map((call: Array<unknown>): string => {
            return (call[0] as { alertId: ObjectID }).alertId.toString();
          }),
        ).toEqual([stoppedAlert.toString()]);
      } finally {
        appliedToIncidents.mockRestore();
        appliedToAlerts.mockRestore();
      }
    });

    test("while the cluster's Fixes are still off, nothing is decided again", async () => {
      const stopped: ObjectID = await seedIncident();
      await decide({ incidentId: stopped }, [fixesOff(seeded.clusterId)]);

      const applied: jest.SpyInstance = jest
        .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
        .mockResolvedValue(undefined);

      try {
        expect(
          await AutoRemediationRuleEngineService.onFixesTurnedOn({
            projectId,
            target: {
              lane: AutoRemediationDecisionLane.KubernetesCluster,
              id: seeded.clusterId.toString(),
            },
          }),
        ).toBe(0);
        expect(applied).not.toHaveBeenCalled();
      } finally {
        applied.mockRestore();
      }
    });

    test("the cluster's own update turns them on: its service hands the write over, and the stopped incident is decided again", async () => {
      const stopped: ObjectID = await seedIncident();
      await decide({ incidentId: stopped }, [fixesOff(seeded.clusterId)]);

      const decidedFor: Array<string> = [];
      let resolveDecided: () => void = (): void => {};
      const decidedAgain: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          resolveDecided = resolve;
        },
      );
      const applied: jest.SpyInstance = jest
        .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
        .mockImplementation(async (data: { incidentId: ObjectID }) => {
          decidedFor.push(data.incidentId.toString());
          resolveDecided();
        });

      try {
        // As the server writes it for an agent's configuration: a root update.
        await KubernetesClusterService.updateOneById({
          id: seeded.clusterId,
          data: {
            aiRemediationMode: KubernetesAiRemediationMode.Automatic,
          },
          props: { isRoot: true },
        });

        // Not awaited by the save: wait for the decision it started.
        await Promise.race([
          decidedAgain,
          new Promise<void>((_resolve: () => void, reject: (e: Error) => void) => {
            setTimeout(() => {
              reject(new Error("the stopped incident was not decided again"));
            }, 15000);
          }),
        ]);

        expect(decidedFor).toEqual([stopped.toString()]);
      } finally {
        applied.mockRestore();
      }
    });
  });
});
