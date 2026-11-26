import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import FilterQueryBuilder from "../../../Components/FilterQueryBuilder/FilterQueryBuilder";
import LogFilterConfig from "../../../Components/FilterQueryBuilder/LogFilterConfig";
import ProcessorForm from "../../../Components/LogPipeline/ProcessorForm";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const processorsDocMarkdown: string = `
Processors are the steps this pipeline runs on every log it matches, in order, each on what the one before it left. Drag a processor to change its place, and turn one off to skip it without deleting it.

## Grok Parser

Pulls fields out of a plain text line, such as an nginx access log or a syslog line, into attributes you can search and filter on.

1. It reads the **Source Field**: usually the log's \`body\`, or any attribute.
2. It runs your **grok pattern** on it. A grok pattern is a regular expression with names: \`%{IPV4:client_ip}\` matches an IPv4 address and stores it as \`client_ip\`. Add \`:int\` or \`:float\` to store a number, such as \`%{NUMBER:status:int}\`.
3. Every named part becomes an attribute, under a **Target Prefix** if you set one. A line the pattern does not match is left as it is.

| Log body | Pattern | Attributes added |
|----------|---------|------------------|
| \`10.0.1.5 - GET /health 200\` | \`%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}\` | client_ip, method, path, status |

The form's **pattern tester** shows the attributes a real log line would get, before you save.

## Key=Value Parser

Splits a line of \`key=value\` pairs into attributes, whatever order its fields come in: firewalls such as Sophos XGS and Fortinet, logfmt and many network appliances. A grok pattern needs the fields in a fixed order; this does not.

- It reads the **Source Field**, usually the \`body\`, and makes each pair an attribute, under a **Target Prefix** if you set one. Quoted values keep their spaces; text that is not a pair, such as a syslog header, is skipped.
- Pairs are split on spaces. Set a **Pair Delimiter** (\`,\` \`;\` \`|\`) or a **Key-Value Delimiter** (\`:\`) for other formats.
- Values are stored as text, and the first value of a repeated key wins. An attribute the log already has is replaced only with **Override on Conflict** on.

| Log body | Target prefix | Attributes added |
|----------|---------------|------------------|
| \`log_component="IPSec" con_name="HQ-Branch1" status="Terminated"\` | \`sophos\` | sophos.log_component, sophos.con_name, sophos.status |

## Severity Remapper

Sets a log's severity from a field, for an app that writes its own words for it, such as \`warn\` or \`fatal\`.

It reads the attribute named in **Source Key**, such as \`level\`, finds its value in your **Mappings** (in any case: \`WARN\` matches \`warn\`), and sets the log's severity to the one you mapped it to: Trace, Debug, Information, Warning, Error or Fatal. A value with no mapping leaves the log as it is.

| Value in the log | Severity |
|------------------|----------|
| trace | Trace |
| debug | Debug |
| info | Information |
| warn | Warning |
| error | Error |
| fatal | Fatal |

## Attribute Remapper

Renames or copies an attribute, so different services' names for one thing become one, such as \`client_ip\` and \`source_address\`.

It writes the **Source Key**'s value to the **Target Key**. Turn **Preserve Source** off to remove the source key, and **Override on Conflict** on to overwrite a target that is already set.

## Category Processor

Writes a category to the **Target Key**, such as "Payment Error" or "Rate Limit". Its categories are checked in order, and the first one whose filter a log matches is written. A category's filter is built as a pipeline's filter is, with conditions.

## Order Matters

A processor reads what the ones before it left. Put a grok or key=value parser before a severity remapper that reads a field it pulls out, and add one processor at a time, checking the result on the Logs page.
`;

const LogPipelineView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [showProcessorForm, setShowProcessorForm] = useState<boolean>(false);
  const [refreshProcessorToggle, setRefreshProcessorToggle] =
    useState<string>("initial");

  return (
    <Fragment>
      {/* Section 1: Pipeline Details */}
      <CardModelDetail<LogPipeline>
        name="Log Pipeline Details"
        cardProps={{
          title: "Pipeline Details",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Pipeline Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this pipeline does.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: LogPipeline,
          id: "model-detail-log-pipeline",
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Status",
              fieldType: FieldType.Boolean,
              getElement: (item: LogPipeline): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill color={Green} text="Enabled" icon={IconProp.Check} />
                  );
                }
                return <Pill tone={PillTone.Paused} text="Disabled" />;
              },
            },
            {
              // The pipeline's line: its ID, who created it and who last changed it.
              field: { _id: true },
              title: "ID",
              fieldType: FieldType.ObjectID,
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 2: Filter Conditions (Visual Builder) */}
      <FilterQueryBuilder
        modelType={LogPipeline}
        modelId={modelId}
        config={LogFilterConfig}
        title="Filter Conditions"
        description="Define which logs this pipeline applies to. Only logs that match these conditions will be processed. Leave empty to process all logs."
      />

      {/* Section 3: Processors */}
      <ModelTable<LogPipelineProcessor>
        modelType={LogPipelineProcessor}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        query={{
          logPipelineId: modelId,
        }}
        id="log-pipeline-processors-table"
        name="Log Pipeline > Processors"
        userPreferencesKey="log-pipeline-processors-table"
        saveFilterProps={{
          tableId: "log-pipeline-processors-table",
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        sortBy="sortOrder"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="sortOrder"
        cardProps={{
          title: "Processors",
          description:
            "Processors transform logs matched by this pipeline. They run in the order shown below. Drag to reorder.",
          buttons: [
            {
              title: "Add Processor",
              phoneTitle: "Add",
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setShowProcessorForm(true);
              },
              icon: IconProp.Add,
            },
          ],
        }}
        helpContent={{
          title: "How Log Processors Work",
          description:
            "The steps this pipeline runs on every log it matches, in order.",
          markdown: processorsDocMarkdown,
        }}
        showRefreshButton={true}
        refreshToggle={refreshProcessorToggle}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              processorType: true,
            },
            title: "Type",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
      />

      {showProcessorForm && (
        <ProcessorForm
          pipelineId={modelId}
          onProcessorCreated={() => {
            setShowProcessorForm(false);
            setRefreshProcessorToggle(Date.now().toString());
          }}
          onCancel={() => {
            setShowProcessorForm(false);
          }}
        />
      )}

      {/* Section 4: Delete Pipeline */}
      <ModelDelete
        modelType={LogPipeline}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_SETTINGS_PIPELINES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default LogPipelineView;
