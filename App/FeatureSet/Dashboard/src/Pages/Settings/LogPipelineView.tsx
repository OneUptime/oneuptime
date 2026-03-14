import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
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
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import FilterQueryBuilder from "../../Components/LogPipeline/FilterQueryBuilder";
import ProcessorForm from "../../Components/LogPipeline/ProcessorForm";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const processorsDocMarkdown: string = `
### How Processors Work

Processors are transformation steps that modify logs matched by this pipeline. They run **in order** — drag rows to reorder them.

\`\`\`mermaid
flowchart LR
    A[Matched Log] --> B[Processor 1]
    B --> C[Processor 2]
    C --> D[Processor 3]
    D --> E[Transformed Log]
\`\`\`

---

### Processor Types

#### Severity Remapper
Maps a log field to a standard OpenTelemetry severity level.

**When to use:** Your application logs severity as custom text (e.g., "warn", "fatal", "verbose") instead of standard levels like WARNING or FATAL.

**How it works:**
1. Reads the value from the **Source Key** (e.g., \`level\`)
2. Looks up the value in your **Mappings** table
3. If found, sets \`severityText\` and \`severityNumber\` on the log

| Match Value | Severity Text | Severity Number |
|-------------|--------------|-----------------|
| trace | TRACE | 1 |
| debug | DEBUG | 5 |
| info | INFO | 9 |
| warn | WARNING | 13 |
| error | ERROR | 17 |
| fatal | FATAL | 21 |

---

#### Attribute Remapper
Renames or copies a log attribute from one key to another.

**When to use:** Different services use different attribute names for the same concept (e.g., \`client_ip\` vs \`source_address\`).

**How it works:**
1. Reads the value from the **Source Key**
2. Writes it to the **Target Key**
3. Optionally removes the source key (**Preserve Source** = off)
4. Optionally overwrites if target already exists (**Override on Conflict** = on)

---

#### Category Processor
Tags logs with a category label based on filter conditions.

**When to use:** You want to add business-level labels to logs (e.g., "Payment Error", "Auth Failure", "Rate Limit").

**How it works:**
1. Evaluates each **Category** rule in order
2. The first matching rule sets the **Target Key** to that category name
3. Uses the same filter syntax as pipeline filters

---

### Tips
- **Order matters** — processors run sequentially, so a severity remapper should run before a category processor that filters by severity
- **Disable without deleting** — toggle a processor off to temporarily skip it
- **Test incrementally** — add one processor at a time and verify in the Logs view
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
          description: "Basic information about this pipeline.",
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
                return (
                  <Pill color={Red} text="Disabled" icon={IconProp.Close} />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 2: Filter Conditions (Visual Builder) */}
      <FilterQueryBuilder
        modelType={LogPipeline}
        modelId={modelId}
        title="Filter Conditions"
        description="Define which logs this pipeline applies to. Only logs that match these conditions will be processed. Leave empty to process all logs."
      />

      {/* Section 3: Processors */}
      <ModelTable<LogPipelineProcessor>
        modelType={LogPipelineProcessor}
        query={{
          logPipelineId: modelId,
        }}
        id="log-pipeline-processors-table"
        name="Log Pipeline > Processors"
        userPreferencesKey="log-pipeline-processors-table"
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
            "Understanding Severity Remapper, Attribute Remapper, and Category Processor",
          markdown: processorsDocMarkdown,
        }}
        noItemsMessage={
          "No processors configured. Click 'Add Processor' above to add your first processor."
        }
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
            RouteMap[PageMap.SETTINGS_LOG_PIPELINES] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default LogPipelineView;
