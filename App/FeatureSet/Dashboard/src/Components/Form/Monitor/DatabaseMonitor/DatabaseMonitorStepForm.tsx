import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorStepDatabaseMonitor, {
  DEFAULT_DATABASE_METRIC_GROUPS,
} from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import {
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getDatabaseMetricsByGroup,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "Common/Types/Monitor/SqlDatabaseType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import URL from "Common/Types/API/URL";
import { DOCS_URL } from "Common/UI/Config";

export interface ComponentProps {
  monitorStepDatabaseMonitor: MonitorStepDatabaseMonitor;
  onChange: (value: MonitorStepDatabaseMonitor) => void;
}

const groupTitles: Record<DatabaseMetricGroup, string> = {
  [DatabaseMetricGroup.Connections]: "Connections",
  [DatabaseMetricGroup.Activity]: "Activity",
  [DatabaseMetricGroup.Throughput]: "Throughput",
  [DatabaseMetricGroup.Locks]: "Locks and Blocking",
  [DatabaseMetricGroup.Storage]: "Storage",
  [DatabaseMetricGroup.Replication]: "Replication",
  [DatabaseMetricGroup.Maintenance]: "Maintenance",
};

const groupDescriptions: Record<DatabaseMetricGroup, string> = {
  [DatabaseMetricGroup.Connections]:
    "Session counts, the configured connection ceiling and server uptime.",
  [DatabaseMetricGroup.Activity]:
    "Open transactions, and the age of the longest running query and transaction.",
  [DatabaseMetricGroup.Throughput]:
    "Commits, rollbacks, rows read and written, and the cache hit ratio.",
  [DatabaseMetricGroup.Locks]: "Held locks, blocked sessions and deadlocks.",
  [DatabaseMetricGroup.Storage]:
    "Database size on disk and work that spilled to temporary files.",
  [DatabaseMetricGroup.Replication]:
    "Replication lag and the number of connected replicas.",
  [DatabaseMetricGroup.Maintenance]:
    "Dead rows awaiting vacuum and transaction ID wraparound headroom.",
};

/*
 * The exact statement to run on the server so this group can be collected.
 * The operator sees it while configuring rather than after a week of blank
 * charts: on PostgreSQL a monitoring login without pg_monitor still reads
 * pg_stat_activity successfully, it simply sees nothing but its own session,
 * so nothing about the connection itself reveals the missing grant.
 */
type GetPrivilegeHintFunction = (
  databaseType: SqlDatabaseType,
  group: DatabaseMetricGroup,
) => string;

const getPrivilegeHint: GetPrivilegeHintFunction = (
  databaseType: SqlDatabaseType,
  group: DatabaseMetricGroup,
): string => {
  if (databaseType === SqlDatabaseType.PostgreSQL) {
    if (
      group === DatabaseMetricGroup.Throughput ||
      group === DatabaseMetricGroup.Storage
    ) {
      return "Readable by any login that can connect.";
    }

    return "Needs the pg_monitor role.";
  }

  if (databaseType === SqlDatabaseType.MySQL) {
    if (group === DatabaseMetricGroup.Activity) {
      return "Needs the PROCESS privilege.";
    }

    if (
      group === DatabaseMetricGroup.Connections ||
      group === DatabaseMetricGroup.Locks
    ) {
      return "Needs SELECT on performance_schema, and performance_schema switched on.";
    }

    return "Readable by any login that can connect.";
  }

  if (group === DatabaseMetricGroup.Storage) {
    return "Readable by any login that can connect.";
  }

  return "Needs VIEW SERVER STATE.";
};

type GetGrantBlockFunction = (databaseType: SqlDatabaseType) => string;

const getGrantBlock: GetGrantBlockFunction = (
  databaseType: SqlDatabaseType,
): string => {
  if (databaseType === SqlDatabaseType.MySQL) {
    return [
      "GRANT PROCESS ON *.* TO '<monitoring_user>'@'%';",
      "GRANT SELECT ON performance_schema.* TO '<monitoring_user>'@'%';",
    ].join("\n");
  }

  if (databaseType === SqlDatabaseType.MicrosoftSqlServer) {
    return "GRANT VIEW SERVER STATE TO [<monitoring_login>];";
  }

  return [
    "GRANT CONNECT ON DATABASE <database_name> TO <monitoring_user>;",
    "GRANT pg_monitor TO <monitoring_user>;",
  ].join("\n");
};

/*
 * A group with no catalog metric for the selected engine produces nothing at
 * all there — stock MySQL has no deadlock counter, and neither MySQL nor SQL
 * Server exposes an autovacuum backlog. Saying so next to the toggle stops an
 * operator hunting for a grant that would not help.
 */
type IsGroupCollectableFunction = (
  databaseType: SqlDatabaseType,
  group: DatabaseMetricGroup,
) => boolean;

const isGroupCollectable: IsGroupCollectableFunction = (
  databaseType: SqlDatabaseType,
  group: DatabaseMetricGroup,
): boolean => {
  return getDatabaseMetricsByGroup(group).some(
    (metric: DatabaseMetricDefinition) => {
      return metric.engines.includes(databaseType);
    },
  );
};

const DatabaseMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  const databaseTypeOptions: Array<DropdownOption> =
    SqlDatabaseTypeUtil.getSupportedDatabaseTypes().map(
      (type: SqlDatabaseType) => {
        return { label: type, value: type };
      },
    );

  const databaseType: SqlDatabaseType =
    props.monitorStepDatabaseMonitor.databaseType;

  const useWindowsIntegratedAuthentication: boolean =
    databaseType === SqlDatabaseType.MicrosoftSqlServer &&
    Boolean(
      props.monitorStepDatabaseMonitor.useWindowsIntegratedAuthentication,
    );

  const enabledMetricGroups: Array<DatabaseMetricGroup> =
    props.monitorStepDatabaseMonitor.enabledMetricGroups || [];

  type ToggleMetricGroupFunction = (
    group: DatabaseMetricGroup,
    isEnabled: boolean,
  ) => void;

  const toggleMetricGroup: ToggleMetricGroupFunction = (
    group: DatabaseMetricGroup,
    isEnabled: boolean,
  ): void => {
    const selected: Set<DatabaseMetricGroup> = new Set<DatabaseMetricGroup>(
      enabledMetricGroups,
    );

    if (isEnabled) {
      selected.add(group);
    } else {
      selected.delete(group);
    }

    props.onChange({
      ...props.monitorStepDatabaseMonitor,
      // Store in the canonical order so the saved config is comparable.
      enabledMetricGroups: DEFAULT_DATABASE_METRIC_GROUPS.filter(
        (candidate: DatabaseMetricGroup) => {
          return selected.has(candidate);
        },
      ),
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Database Type"
          description="The database engine to connect to. PostgreSQL, MySQL, and Microsoft SQL Server are supported."
          required={true}
        />
        <Dropdown
          options={databaseTypeOptions}
          initialValue={databaseTypeOptions.find((option: DropdownOption) => {
            return option.value === databaseType;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const newDatabaseType: SqlDatabaseType = value as SqlDatabaseType;
            props.onChange({
              ...props.monitorStepDatabaseMonitor,
              databaseType: newDatabaseType,
              port: SqlDatabaseTypeUtil.getDefaultPort(newDatabaseType),
              useWindowsIntegratedAuthentication:
                newDatabaseType === SqlDatabaseType.MicrosoftSqlServer
                  ? props.monitorStepDatabaseMonitor
                      .useWindowsIntegratedAuthentication
                  : false,
            });
          }}
        />
      </div>

      {databaseType === SqlDatabaseType.MicrosoftSqlServer && (
        <div>
          <Toggle
            title="Use Windows Integrated Authentication"
            description="Authenticate as the account running the probe (SSPI on Windows or Kerberos on Linux/macOS). Username and password are ignored."
            initialValue={useWindowsIntegratedAuthentication}
            onChange={(value: boolean) => {
              props.onChange({
                ...props.monitorStepDatabaseMonitor,
                useWindowsIntegratedAuthentication: value,
              });
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabelElement
            title="Host"
            description="Database host reachable from the probe (e.g. db.internal)"
            required={true}
          />
          <Input
            initialValue={props.monitorStepDatabaseMonitor.host}
            placeholder="db.internal"
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepDatabaseMonitor,
                host: value,
              });
            }}
          />
        </div>

        <div>
          <FieldLabelElement
            title="Port"
            description="Database port"
            required={true}
          />
          <Input
            initialValue={
              props.monitorStepDatabaseMonitor.port?.toString() || "5432"
            }
            placeholder="5432"
            type={InputType.NUMBER}
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepDatabaseMonitor,
                port:
                  parseInt(value) ||
                  SqlDatabaseTypeUtil.getDefaultPort(databaseType),
              });
            }}
          />
        </div>
      </div>

      <div
        className={`grid gap-4 ${
          useWindowsIntegratedAuthentication ? "grid-cols-1" : "grid-cols-2"
        }`}
      >
        <div>
          <FieldLabelElement
            title="Database Name"
            description="The database to connect to. Server-wide metrics cover the whole instance; size and throughput are reported for this database."
            required={true}
          />
          <Input
            initialValue={props.monitorStepDatabaseMonitor.databaseName}
            placeholder="orders"
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepDatabaseMonitor,
                databaseName: value,
              });
            }}
          />
        </div>

        {!useWindowsIntegratedAuthentication && (
          <div>
            <FieldLabelElement
              title="Username"
              description="Use a dedicated monitoring login. It needs to read statistics and nothing else."
              required={false}
            />
            <Input
              initialValue={props.monitorStepDatabaseMonitor.username}
              placeholder="oneuptime_monitor"
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDatabaseMonitor,
                  username: value,
                });
              }}
            />
          </div>
        )}
      </div>

      {!useWindowsIntegratedAuthentication && (
        <div>
          <FieldLabelElement
            title="Password"
            description={
              <p>
                Database password. We recommend referencing a monitor secret
                with{" "}
                <code className="bg-gray-100 px-1 rounded">
                  {"{{monitorSecrets.name}}"}
                </code>{" "}
                instead of typing the password here, so it stays encrypted at
                rest.{" "}
                <Link
                  className="underline"
                  openInNewTab={true}
                  to={URL.fromString(
                    DOCS_URL.toString() + "/monitor/monitor-secrets",
                  )}
                >
                  Learn more about secrets.
                </Link>
              </p>
            }
            required={false}
          />
          <Input
            initialValue={props.monitorStepDatabaseMonitor.password}
            placeholder="{{monitorSecrets.dbPassword}}"
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepDatabaseMonitor,
                password: value,
              });
            }}
          />
        </div>
      )}

      <div>
        <Toggle
          title="Use SSL/TLS"
          initialValue={props.monitorStepDatabaseMonitor.useSsl}
          onChange={(value: boolean) => {
            props.onChange({
              ...props.monitorStepDatabaseMonitor,
              useSsl: value,
            });
          }}
        />
      </div>

      {props.monitorStepDatabaseMonitor.useSsl && (
        <div>
          <Toggle
            title="Verify server certificate"
            description="Turn off only if the database uses a self-signed certificate."
            initialValue={
              props.monitorStepDatabaseMonitor.rejectUnauthorizedSsl
            }
            onChange={(value: boolean) => {
              props.onChange({
                ...props.monitorStepDatabaseMonitor,
                rejectUnauthorizedSsl: value,
              });
            }}
          />
        </div>
      )}

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-2">
          Privileges this monitor needs on {databaseType}
        </h4>
        <p className="text-xs text-blue-700 mb-3">
          OneUptime only reads. Anything it cannot read is reported as a missing
          metric, never as an outage.
        </p>
        <pre className="text-xs text-blue-900 bg-white border border-blue-200 rounded p-3 overflow-x-auto whitespace-pre">
          {getGrantBlock(databaseType)}
        </pre>
        {databaseType === SqlDatabaseType.PostgreSQL && (
          <p className="text-xs text-blue-700 mt-3">
            Without pg_monitor, PostgreSQL still answers every statistics query
            — it just shows the monitoring session and nothing else, so
            connection and lock counts would read as one and zero forever. The
            probe checks for the role up front and reports those groups as
            missing instead of recording numbers it knows are wrong.
          </p>
        )}
        {databaseType === SqlDatabaseType.MySQL && (
          <p className="text-xs text-blue-700 mt-3">
            performance_schema must also be switched on (performance_schema = ON
            in my.cnf). Stock MySQL exposes no deadlock counter, so that metric
            is never collected here.
          </p>
        )}
      </div>

      <div>
        <FieldLabelElement
          title="Metric Groups"
          description="Each group is one set of statistics queries and one unit of failure: if its grant is missing, that group's metrics are left blank and the monitor stays online. Turn a group off to stop querying for it — summing table sizes is the one that costs real work on a large schema. Turning every group off is the same as leaving them all on."
          required={false}
        />
        <div className="space-y-4 border rounded-md p-4">
          {DEFAULT_DATABASE_METRIC_GROUPS.map((group: DatabaseMetricGroup) => {
            const isCollectable: boolean = isGroupCollectable(
              databaseType,
              group,
            );

            const description: string = isCollectable
              ? `${groupDescriptions[group]} ${getPrivilegeHint(databaseType, group)}`
              : `${groupDescriptions[group]} ${databaseType} does not report these, so this group collects nothing here.`;

            return (
              <Toggle
                key={group}
                title={groupTitles[group]}
                description={description}
                value={enabledMetricGroups.includes(group)}
                onChange={(value: boolean) => {
                  toggleMetricGroup(group, value);
                }}
              />
            );
          })}
        </div>
      </div>

      {!showAdvancedOptions && (
        <div className="mt-1 -ml-3">
          <Button
            title="Advanced: Timeouts"
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            onClick={() => {
              setShowAdvancedOptions(true);
            }}
          />
        </div>
      )}

      {showAdvancedOptions && (
        <div className="space-y-4 border p-4 rounded-md bg-gray-50">
          <h4 className="font-medium">Advanced Options</h4>

          <div>
            <FieldLabelElement
              title="Connection Timeout (ms)"
              description="How long to wait to establish a connection (max 30000)"
              required={false}
            />
            <Input
              initialValue={props.monitorStepDatabaseMonitor.connectionTimeoutInMs?.toString()}
              placeholder="10000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDatabaseMonitor,
                  connectionTimeoutInMs: parseInt(value) || 10000,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Statement Timeout (ms)"
              description="Hard cap on how long one statistics query may run before that group is abandoned (max 60000)"
              required={false}
            />
            <Input
              initialValue={props.monitorStepDatabaseMonitor.statementTimeoutInMs?.toString()}
              placeholder="10000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDatabaseMonitor,
                  statementTimeoutInMs: parseInt(value) || 10000,
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DatabaseMonitorStepForm;
