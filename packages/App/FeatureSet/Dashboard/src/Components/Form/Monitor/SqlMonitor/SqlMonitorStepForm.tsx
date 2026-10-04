import React, { FunctionComponent, ReactElement } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
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
import Link from "Common/UI/Components/Link/Link";
import URL from "Common/Types/API/URL";
import { DOCS_URL } from "Common/UI/Config";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  monitorStepSqlMonitor: MonitorStepSqlMonitor;
  onChange: (value: MonitorStepSqlMonitor) => void;
}

const SqlMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const databaseTypeOptions: Array<DropdownOption> =
    SqlDatabaseTypeUtil.getSupportedDatabaseTypes().map(
      (type: SqlDatabaseType) => {
        return { label: type, value: type };
      },
    );

  const useWindowsIntegratedAuthentication: boolean =
    props.monitorStepSqlMonitor.databaseType ===
      SqlDatabaseType.MicrosoftSqlServer &&
    Boolean(props.monitorStepSqlMonitor.useWindowsIntegratedAuthentication);

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
            return option.value === props.monitorStepSqlMonitor.databaseType;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const databaseType: SqlDatabaseType = value as SqlDatabaseType;
            props.onChange({
              ...props.monitorStepSqlMonitor,
              databaseType: databaseType,
              port: SqlDatabaseTypeUtil.getDefaultPort(databaseType),
              useWindowsIntegratedAuthentication:
                databaseType === SqlDatabaseType.MicrosoftSqlServer
                  ? props.monitorStepSqlMonitor
                      .useWindowsIntegratedAuthentication
                  : false,
            });
          }}
        />
      </div>

      {props.monitorStepSqlMonitor.databaseType ===
        SqlDatabaseType.MicrosoftSqlServer && (
        <div>
          <Toggle
            title="Use Windows Integrated Authentication"
            description="Authenticate as the account running the probe (SSPI on Windows or Kerberos on Linux/macOS). Username and password are ignored."
            initialValue={useWindowsIntegratedAuthentication}
            onChange={(value: boolean) => {
              props.onChange({
                ...props.monitorStepSqlMonitor,
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
          <FieldLabelElement
            title="Port"
            description="Database port"
            required={true}
          />
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

      <div
        className={`grid gap-4 ${
          useWindowsIntegratedAuthentication ? "grid-cols-1" : "grid-cols-2"
        }`}
      >
        <div>
          <FieldLabelElement
            title="Database Name"
            description="The database to run the query against"
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
      </div>

      {!useWindowsIntegratedAuthentication && (
        <div>
          <FieldLabelElement
            title="Password"
            description={
              <p>
                <TranslatedSentence
                  template="Database password. We recommend referencing a monitor secret with {{secret}} instead of typing the password here, so it stays encrypted at rest."
                  slots={{
                    secret: (
                      <code className="bg-gray-100 px-1 rounded">
                        {"{{monitorSecrets.name}}"}
                      </code>
                    ),
                  }}
                />{" "}
                <Link
                  className="underline"
                  openInNewTab={true}
                  to={URL.fromString(
                    DOCS_URL.toString() + "/monitor/monitor-secrets",
                  )}
                >
                  {translator.translateText("Learn more about secrets.")}
                </Link>
              </p>
            }
            required={false}
          />
          <Input
            initialValue={props.monitorStepSqlMonitor.password}
            placeholder="{{monitorSecrets.dbPassword}}"
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepSqlMonitor,
                password: value,
              });
            }}
          />
        </div>
      )}

      <div>
        <FieldLabelElement
          title="SQL Query"
          description="A single read-only query (SELECT / WITH). Writes are blocked — the probe runs it read-only and against a least-privilege database user. Example: SELECT COUNT(*) FROM orders WHERE status = 'CANCELLED' AND created_at > NOW() - INTERVAL '5 minutes'"
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
        icon={MORE_SECTION_ICON}
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
