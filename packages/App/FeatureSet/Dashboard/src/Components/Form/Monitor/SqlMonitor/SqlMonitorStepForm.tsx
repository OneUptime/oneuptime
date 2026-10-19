import React, { FunctionComponent, ReactElement } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import {
  SQL_MONITOR_MORE_FIELDS,
  getMonitorOptionsMoreFieldsItems,
} from "../MonitorMoreFields";
import MonitorStepSqlMonitor from "Common/Types/Monitor/MonitorStepSqlMonitor";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "Common/Types/Monitor/SqlDatabaseType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import DatabaseAuthenticationField from "../DatabaseAuthenticationField";
import DatabasePasswordField from "../DatabasePasswordField";
import {
  DatabaseAuthentication,
  getDatabaseAuthentication,
  isDatabaseAuthenticationOffered,
  usesWindowsIntegratedAuthentication,
} from "../../../../Utils/Form/Monitor/DatabaseAuthenticationChoice";

export interface ComponentProps {
  monitorStepSqlMonitor: MonitorStepSqlMonitor;
  onChange: (value: MonitorStepSqlMonitor) => void;
}

const SqlMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const databaseTypeOptions: Array<DropdownOption> =
    SqlDatabaseTypeUtil.getSupportedDatabaseTypes().map(
      (type: SqlDatabaseType) => {
        return { label: type, value: type };
      },
    );

  /*
   * How the probe signs in: a username and a password, or (SQL Server only)
   * Windows Integrated Authentication. The credentials are asked for only
   * when they are used.
   */
  const authentication: DatabaseAuthentication = getDatabaseAuthentication({
    databaseType: props.monitorStepSqlMonitor.databaseType,
    useWindowsIntegratedAuthentication:
      props.monitorStepSqlMonitor.useWindowsIntegratedAuthentication,
  });

  const useWindowsIntegratedAuthentication: boolean =
    usesWindowsIntegratedAuthentication(authentication);

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Database Type"
          description="The database engine to connect to."
          required={true}
        />
        <Dropdown
          options={databaseTypeOptions}
          isClearable={false}
          initialValue={databaseTypeOptions.find((option: DropdownOption) => {
            return option.value === props.monitorStepSqlMonitor.databaseType;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const databaseType: SqlDatabaseType = value as SqlDatabaseType;
            props.onChange({
              ...props.monitorStepSqlMonitor,
              databaseType: databaseType,
              port: SqlDatabaseTypeUtil.getDefaultPort(databaseType),
              useWindowsIntegratedAuthentication:
                isDatabaseAuthenticationOffered(databaseType)
                  ? props.monitorStepSqlMonitor
                      .useWindowsIntegratedAuthentication
                  : false,
            });
          }}
        />
      </div>

      {/*
       * Host and Port on one line from the sm width, the port a quarter of
       * it. Neither needs a line of help: the placeholder shows a host, and
       * the card says the probe must reach the database. A line under Host
       * alone pushed its box below Port's.
       */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <FieldLabelElement title="Host" required={true} />
          <Input
            initialValue={props.monitorStepSqlMonitor.host}
            placeholder="db.internal"
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepSqlMonitor,
                host: value,
              });
            }}
          />
        </div>

        <div>
          <FieldLabelElement title="Port" required={true} />
          <Input
            initialValue={
              props.monitorStepSqlMonitor.port?.toString() || "5432"
            }
            placeholder="5432"
            type={InputType.NUMBER}
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepSqlMonitor,
                port: parseInt(value) || 5432,
              });
            }}
          />
        </div>
      </div>

      <div>
        <FieldLabelElement
          title="Database Name"
          description="The database to run the query against."
          required={true}
        />
        <Input
          initialValue={props.monitorStepSqlMonitor.databaseName}
          placeholder="orders"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepSqlMonitor,
              databaseName: value,
            });
          }}
        />
      </div>

      {isDatabaseAuthenticationOffered(
        props.monitorStepSqlMonitor.databaseType,
      ) && (
        <DatabaseAuthenticationField
          value={authentication}
          onChange={(value: DatabaseAuthentication) => {
            props.onChange({
              ...props.monitorStepSqlMonitor,
              useWindowsIntegratedAuthentication:
                usesWindowsIntegratedAuthentication(value),
            });
          }}
        />
      )}

      {!useWindowsIntegratedAuthentication && (
        <div>
          <FieldLabelElement
            title="Username"
            description="Use a read-only, least-privilege database user."
            required={false}
          />
          <Input
            initialValue={props.monitorStepSqlMonitor.username}
            placeholder="readonly_user"
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepSqlMonitor,
                username: value,
              });
            }}
          />
        </div>
      )}

      {!useWindowsIntegratedAuthentication && (
        <DatabasePasswordField
          initialValue={props.monitorStepSqlMonitor.password}
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepSqlMonitor,
              password: value,
            });
          }}
        />
      )}

      <div>
        <FieldLabelElement
          title="SQL Query"
          description="One SELECT or WITH query. The probe runs it read-only, so writes are blocked."
          required={true}
        />
        <TextArea
          initialValue={props.monitorStepSqlMonitor.query}
          disableSpellCheck={true}
          placeholder={"SELECT COUNT(*) FROM orders WHERE status = 'CANCELLED'"}
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepSqlMonitor,
              query: value,
            });
          }}
        />
      </div>

      <div>
        <Toggle
          title="Use SSL/TLS"
          initialValue={props.monitorStepSqlMonitor.useSsl}
          onChange={(value: boolean) => {
            props.onChange({
              ...props.monitorStepSqlMonitor,
              useSsl: value,
            });
          }}
        />
      </div>

      {props.monitorStepSqlMonitor.useSsl && (
        <div>
          <Toggle
            title="Verify server certificate"
            description="Turn off only if the database uses a self-signed certificate."
            initialValue={props.monitorStepSqlMonitor.rejectUnauthorizedSsl}
            onChange={(value: boolean) => {
              props.onChange({
                ...props.monitorStepSqlMonitor,
                rejectUnauthorizedSsl: value,
              });
            }}
          />
        </div>
      )}

      {/*
       * More fields, folded like every form's: options most monitors
       * leave at their defaults. Its header names them and shows the
       * ones changed.
       */}
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        items={getMonitorOptionsMoreFieldsItems(
          props.monitorStepSqlMonitor,
          SQL_MONITOR_MORE_FIELDS,
        )}
        dataTestId="sql-monitor-more-fields"
      >
        <div className="space-y-4">
          <div>
            <FieldLabelElement
              title="Connection Timeout (ms)"
              description="How long to wait to establish a connection (max 30000)"
              required={false}
            />
            <Input
              initialValue={props.monitorStepSqlMonitor.connectionTimeoutInMs?.toString()}
              placeholder="10000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepSqlMonitor,
                  connectionTimeoutInMs: parseInt(value) || 10000,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Statement Timeout (ms)"
              description="Hard cap on how long the query may run (max 60000)"
              required={false}
            />
            <Input
              initialValue={props.monitorStepSqlMonitor.statementTimeoutInMs?.toString()}
              placeholder="15000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepSqlMonitor,
                  statementTimeoutInMs: parseInt(value) || 15000,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Max Rows"
              description="Upper bound on rows read from the database (max 1000)"
              required={false}
            />
            <Input
              initialValue={props.monitorStepSqlMonitor.maxRows?.toString()}
              placeholder="100"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepSqlMonitor,
                  maxRows: parseInt(value) || 100,
                });
              }}
            />
          </div>
        </div>
      </FoldedSection>
    </div>
  );
};

export default SqlMonitorStepForm;
