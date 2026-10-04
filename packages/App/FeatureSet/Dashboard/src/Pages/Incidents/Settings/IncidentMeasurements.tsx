import PageComponentProps from "../../PageComponentProps";
import {
  getMeasurementChartActionButton,
  getMeasurementChartSummaryFormField,
  getMeasurementColumnFormFields,
  getMeasurementMomentFormField,
  getMeasurementOccurrenceFormField,
  getMeasurementPresetFormField,
  getMeasurementShowOnViewFormField,
  getMeasurementStateFormField,
  getMeasurementUnitFormField,
} from "../../../Components/Measurement/MeasurementFormFields";
import MeasurementSummaryElement from "../../../Components/Measurement/MeasurementSummaryElement";
import { INCIDENT_EVENT_MEASUREMENTS } from "../../../Utils/Measurement/EventMeasurements";
import { getMeasurementsHelpMarkdown } from "../../../Utils/Measurement/MeasurementHelp";
import {
  INCIDENT_MEASUREMENT_FORM,
  MEASUREMENT_FORM_COPY,
  MEASUREMENT_KEY_PLACEHOLDER,
  MEASUREMENT_PAGE_COPY,
  MeasurementEnd,
  MeasurementPageCopy,
  MeasurementValues,
  getMeasurementSummaryText,
} from "../../../Utils/Measurement/MeasurementSetup";
import IncidentMeasurement from "Common/Models/DatabaseModels/IncidentMeasurement";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import {
  getMeasurementKeyError,
  getMeasurementKeyFromName,
} from "Common/Types/Measurement/MeasurementKey";
import { getGeneratedKeyFormField } from "Common/UI/Components/Forms/Fields/GeneratedKeyField";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { MeasurementDomain } from "Common/Utils/Measurement/MeasurementMoments";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const COPY: MeasurementPageCopy =
  MEASUREMENT_PAGE_COPY[MeasurementDomain.Incident];

/*
 * What most measurements never change, folded at the end of the Start and
 * End step. Built once: every field in it carries this same section.
 */
const advancedSection: FormFieldCollapsibleSection<IncidentMeasurement> =
  getAdvancedFormSection<IncidentMeasurement>({
    description: MEASUREMENT_FORM_COPY.advancedDescription,
  });

const IncidentMeasurementsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentMeasurement>
        modelType={IncidentMeasurement}
        id="incident-measurements-table"
        name="Settings > Incident Measurements"
        userPreferencesKey="incident-measurements-table"
        saveFilterProps={{
          tableId: "incident-measurements-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        cardProps={{
          title: COPY.cardTitle,
          description: COPY.cardDescription,
        }}
        helpContent={{
          title: COPY.helpTitle,
          description: COPY.helpDescription,
          markdown: getMeasurementsHelpMarkdown(MeasurementDomain.Incident),
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        /*
         * Drag the rows into the order the measurements are listed in; a new
         * one goes to the end. There is no order to type in.
         */
        enableDragAndDrop={true}
        dragDropIndexField="order"
        selectMoreFields={{
          isEnabled: true,
          metricName: true,
          aggregationType: true,
          endAnchorType: true,
          startIncidentStateRole: true,
          endIncidentStateRole: true,
          startStateOccurrence: true,
          endStateOccurrence: true,
          startIncidentState: {
            name: true,
          },
          endIncidentState: {
            name: true,
          },
        }}
        actionButtons={[getMeasurementChartActionButton<IncidentMeasurement>()]}
        filters={[
          {
            field: {
              name: true,
            },
            title: MEASUREMENT_FORM_COPY.nameColumn,
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: MEASUREMENT_FORM_COPY.enabledFilter,
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: MEASUREMENT_FORM_COPY.nameColumn,
            type: FieldType.Text,
          },
          {
            field: {
              startAnchorType: true,
            },
            id: "measures",
            title: MEASUREMENT_FORM_COPY.measuresColumn,
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: IncidentMeasurement): ReactElement => {
              return (
                <MeasurementSummaryElement
                  form={INCIDENT_MEASUREMENT_FORM}
                  measurement={item as unknown as MeasurementValues}
                />
              );
            },
            getExportValue: (item: IncidentMeasurement): string => {
              return getMeasurementSummaryText({
                form: INCIDENT_MEASUREMENT_FORM,
                measurement: item as unknown as MeasurementValues,
              });
            },
          },
          {
            // Part of the metric name; there for whoever charts it by hand.
            field: {
              key: true,
            },
            title: MEASUREMENT_FORM_COPY.keyTitle,
            type: FieldType.Text,
            isHiddenByDefault: true,
          },
          {
            field: {
              isEnabled: true,
            },
            title: MEASUREMENT_FORM_COPY.statusColumn,
            type: FieldType.Boolean,
            getElement: (item: IncidentMeasurement): ReactElement => {
              if (item.isEnabled) {
                return (
                  <Pill
                    color={Green}
                    text={MEASUREMENT_FORM_COPY.enabledPill}
                  />
                );
              }
              return (
                <Pill color={Red} text={MEASUREMENT_FORM_COPY.disabledPill} />
              );
            },
          },
        ]}
        formSteps={[
          { title: MEASUREMENT_FORM_COPY.measurementStep, id: "basics" },
          { title: MEASUREMENT_FORM_COPY.momentsStep, id: "moments" },
        ]}
        formFields={[
          getMeasurementPresetFormField<IncidentMeasurement>({
            form: INCIDENT_MEASUREMENT_FORM,
            stepId: "basics",
            title: MEASUREMENT_FORM_COPY.presetTitle,
            description: COPY.presetDescription,
            doNotShowWhenEditing: true,
          }),
          {
            field: {
              name: true,
            },
            title: MEASUREMENT_FORM_COPY.nameTitle,
            stepId: "basics",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: COPY.namePlaceholder,
            validation: {
              minLength: 2,
            },
            description: MEASUREMENT_FORM_COPY.nameDescription,
          },
          /*
           * Made from the name as it is typed, and by the server when the
           * create leaves it out; never asked for.
           */
          getGeneratedKeyFormField<IncidentMeasurement>({
            field: {
              key: true,
            },
            nameField: "name",
            title: MEASUREMENT_FORM_COPY.keyTitle,
            stepId: "basics",
            makeKey: getMeasurementKeyFromName,
            validateKey: getMeasurementKeyError,
            placeholder:
              MEASUREMENT_KEY_PLACEHOLDER[MeasurementDomain.Incident],
            description: COPY.keyDescription,
          }),
          {
            field: {
              description: true,
            },
            title: MEASUREMENT_FORM_COPY.descriptionTitle,
            stepId: "basics",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: COPY.descriptionPlaceholder,
          },
          {
            // A new measurement is on; only an existing one can be paused.
            field: {
              isEnabled: true,
            },
            title: MEASUREMENT_FORM_COPY.enabledTitle,
            stepId: "basics",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            doNotShowWhenCreating: true,
            description: COPY.enabledDescription,
          },
          ...getMeasurementColumnFormFields<IncidentMeasurement>(
            INCIDENT_MEASUREMENT_FORM,
          ),
          getMeasurementMomentFormField<IncidentMeasurement>({
            form: INCIDENT_MEASUREMENT_FORM,
            end: MeasurementEnd.Start,
            stepId: "moments",
            title: MEASUREMENT_FORM_COPY.startTitle,
            description: COPY.startDescription,
          }),
          getMeasurementStateFormField<IncidentMeasurement>({
            form: INCIDENT_MEASUREMENT_FORM,
            end: MeasurementEnd.Start,
            stepId: "moments",
            title: MEASUREMENT_FORM_COPY.startStateTitle,
            description: COPY.startStateDescription,
          }),
          getMeasurementMomentFormField<IncidentMeasurement>({
            form: INCIDENT_MEASUREMENT_FORM,
            end: MeasurementEnd.End,
            stepId: "moments",
            title: MEASUREMENT_FORM_COPY.endTitle,
            description: COPY.endDescription,
          }),
          getMeasurementStateFormField<IncidentMeasurement>({
            form: INCIDENT_MEASUREMENT_FORM,
            end: MeasurementEnd.End,
            stepId: "moments",
            title: MEASUREMENT_FORM_COPY.endStateTitle,
            description: COPY.endStateDescription,
          }),
          getMeasurementOccurrenceFormField<IncidentMeasurement>({
            form: INCIDENT_MEASUREMENT_FORM,
            end: MeasurementEnd.Start,
            stepId: "moments",
            title: MEASUREMENT_FORM_COPY.startOccurrenceTitle,
            description: COPY.startOccurrenceDescription,
            collapsibleSection: advancedSection,
          }),
          getMeasurementOccurrenceFormField<IncidentMeasurement>({
            form: INCIDENT_MEASUREMENT_FORM,
            end: MeasurementEnd.End,
            stepId: "moments",
            title: MEASUREMENT_FORM_COPY.endOccurrenceTitle,
            description: COPY.endOccurrenceDescription,
            collapsibleSection: advancedSection,
          }),
          getMeasurementUnitFormField<IncidentMeasurement>({
            stepId: "moments",
            collapsibleSection: advancedSection,
          }),
          getMeasurementChartSummaryFormField<IncidentMeasurement>({
            stepId: "moments",
            description: COPY.chartSummaryDescription,
            collapsibleSection: advancedSection,
          }),
          getMeasurementShowOnViewFormField<IncidentMeasurement>({
            column: INCIDENT_EVENT_MEASUREMENTS.showOnViewColumn,
            stepId: "moments",
            title: COPY.showOnViewTitle,
            description: COPY.showOnViewDescription,
            collapsibleSection: advancedSection,
          }),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentMeasurementsPage;
