import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Pill from "Common/UI/Components/Pill/Pill";
import IconProp from "Common/Types/Icon/IconProp";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Navigation from "Common/UI/Utils/Navigation";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import FilterQueryBuilder from "../../../Components/FilterQueryBuilder/FilterQueryBuilder";
import {
  DROP_FILTER_EDIT_ACTION_TITLE,
  getTraceDropFilterActionFields,
} from "../../../Components/Telemetry/DropFilterForm";
import TraceFilterConfig from "../../../Components/FilterQueryBuilder/TraceFilterConfig";
import {
  isSamplePercentageConfigured,
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
  resolveSamplePercentage,
} from "Common/Types/Telemetry/DropFilterSampling";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import DropFilterImpactPreview from "../../../Components/Telemetry/DropFilterImpact/DropFilterImpactPreview";
import { DropFilterImpactRule } from "../../../Components/Telemetry/DropFilterImpact/DropFilterImpactApi";
import useDropFilterImpactConfirmation, {
  DropFilterImpactConfirmation,
  DropFilterSavePurpose,
} from "../../../Components/Telemetry/DropFilterImpact/useDropFilterImpactConfirmation";
import useStoredDropFilter, {
  StoredDropFilterResult,
} from "../../../Components/Telemetry/DropFilterImpact/useStoredDropFilter";

const TraceDropFilterView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  /*
   * What a change would take (#10436): each card edits a part of the
   * filter, so the impact reads the filter as it is saved with the part
   * being edited over it, and a change to an enabled filter - or turning
   * one on - asks first when something reads what it would take.
   */
  const stored: StoredDropFilterResult = useStoredDropFilter({
    modelType: TraceDropFilter,
    modelId,
  });
  const confirmation: DropFilterImpactConfirmation =
    useDropFilterImpactConfirmation();

  const withStored: (change: DropFilterImpactRule) => DropFilterImpactRule = (
    change: DropFilterImpactRule,
  ): DropFilterImpactRule => {
    return { ...(stored.filter || {}), ...change };
  };

  const confirmChange: (data: {
    change: DropFilterImpactRule;
    isTurningOn?: boolean | undefined;
  }) => Promise<void> = async (data: {
    change: DropFilterImpactRule;
    isTurningOn?: boolean | undefined;
  }): Promise<void> => {
    // A filter left off takes nothing; turning it on asks then.
    if (!data.isTurningOn && !stored.filter?.isEnabled) {
      return;
    }

    await confirmation.confirmOrCancel({
      signal: "trace",
      rule: withStored(data.change),
      purpose: DropFilterSavePurpose.Save,
    });
  };

  return (
    <Fragment>
      {/* Section 1: Basic Details */}
      <CardModelDetail<TraceDropFilter>
        name="Trace Drop Filter Details"
        cardProps={{
          title: "Drop Filter Details",
        }}
        isEditable={true}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Filter Name",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this filter does.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            // Turned on here, what the filter would take.
            getFooterElement: (
              values: FormValues<TraceDropFilter>,
            ): ReactElement | undefined => {
              return values.isEnabled === true &&
                stored.filter &&
                !stored.filter.isEnabled ? (
                <DropFilterImpactPreview
                  signal="trace"
                  rule={withStored({})}
                  dataTestId="drop-filter-enable-impact"
                />
              ) : undefined;
            },
          },
        ]}
        onBeforeUpdate={async (
          item: TraceDropFilter,
        ): Promise<TraceDropFilter> => {
          if (item.isEnabled === true && stored.filter?.isEnabled === false) {
            await confirmChange({ change: {}, isTurningOn: true });
          }

          return item;
        }}
        onSaveSuccess={() => {
          stored.reload();
        }}
        modelDetailProps={{
          modelType: TraceDropFilter,
          id: "model-detail-trace-drop-filter",
          fields: [
            { field: { name: true }, title: "Name" },
            { field: { description: true }, title: "Description" },
            {
              field: { isEnabled: true },
              title: "Status",
              fieldType: FieldType.Boolean,
              getElement: (item: TraceDropFilter): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill color={Green} text="Enabled" icon={IconProp.Check} />
                  );
                }
                return <Pill tone={PillTone.Paused} text="Disabled" />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 2: Action Configuration */}
      <CardModelDetail<TraceDropFilter>
        name="Drop Filter Action"
        cardProps={{
          title: "Action",
          description:
            "Choose whether to drop all matching spans or keep a sample.",
        }}
        isEditable={true}
        editButtonText={DROP_FILTER_EDIT_ACTION_TITLE}
        editModalTitle={DROP_FILTER_EDIT_ACTION_TITLE}
        /*
         * The create form's Action fields (DropFilterForm): Drop or Sample,
         * each with its line, and the percentage only for Sample.
         */
        formFields={getTraceDropFilterActionFields(
          (values: FormValues<TraceDropFilter>): ReactElement => {
            return (
              <DropFilterImpactPreview
                signal="trace"
                rule={withStored({
                  action: values.action,
                  samplePercentage: values.samplePercentage,
                })}
                dataTestId="drop-filter-action-impact"
              />
            );
          },
        )}
        onBeforeUpdate={async (
          item: TraceDropFilter,
        ): Promise<TraceDropFilter> => {
          await confirmChange({
            change: {
              action: item.action,
              samplePercentage: item.samplePercentage,
            },
          });

          return item;
        }}
        onSaveSuccess={() => {
          stored.reload();
        }}
        modelDetailProps={{
          modelType: TraceDropFilter,
          id: "model-detail-trace-drop-filter-action",
          fields: [
            {
              field: { action: true },
              title: "Action",
              getElement: (item: TraceDropFilter): ReactElement => {
                if (item.action === "drop") {
                  return (
                    <div className="flex items-center gap-3">
                      <Pill color={Red} text="Drop" icon={IconProp.Trash} />
                      <span className="text-sm text-gray-500">
                        {translator.translateText(
                          "All matching spans are permanently discarded",
                        )}
                      </span>
                    </div>
                  );
                }
                if (item.action === "sample") {
                  return (
                    <div className="flex items-center gap-3">
                      <Pill
                        color={Yellow}
                        text="Sample"
                        icon={IconProp.Filter}
                      />
                      <span className="text-sm text-gray-500">
                        {translator.translateText(
                          "Only a percentage of matching spans are kept",
                        )}
                      </span>
                    </div>
                  );
                }
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Not configured")}
                  </span>
                );
              },
            },
            {
              field: { samplePercentage: true },
              title: "Sample Percentage",
              showIf: (item: TraceDropFilter): boolean => {
                return item.action === "sample";
              },
              /*
               * An unset percentage used to render as an empty value while
               * the engine quietly kept half of every matching span. State
               * the effective behaviour instead of leaving it blank.
               */
              getElement: (item: TraceDropFilter): ReactElement => {
                if (!isSamplePercentageConfigured(item.samplePercentage)) {
                  return (
                    <span className="text-sm text-gray-500">
                      {translator.translateTemplate(
                        "Not configured — no spans are being sampled away. Set a percentage between {{min}} and {{max}} to start sampling.",
                        {
                          min: MIN_SAMPLE_PERCENTAGE,
                          max: MAX_SAMPLE_PERCENTAGE,
                        },
                      )}
                    </span>
                  );
                }

                const pct: number = resolveSamplePercentage(
                  item.samplePercentage,
                );

                return (
                  <span className="text-sm text-gray-900">
                    {translator.translateTemplate(
                      "{{kept}}% kept • {{discarded}}% discarded",
                      { kept: pct, discarded: 100 - pct },
                    )}
                  </span>
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/*
       * Section 2b: Drop activity.
       *
       * A drop filter used to discard spans with no record anywhere, so
       * "is this filter the reason my spans are missing?" could not be
       * answered from the product at all. These two counters are written by
       * the ingest path and are the first place to look.
       */}
      <CardModelDetail<TraceDropFilter>
        name="Drop Filter Activity"
        cardProps={{
          title: "Activity",
          description:
            "How much this filter has actually discarded. Updated by the ingest pipeline within a minute of a drop.",
        }}
        isEditable={false}
        formFields={[]}
        modelDetailProps={{
          modelType: TraceDropFilter,
          id: "model-detail-trace-drop-filter-activity",
          fields: [
            {
              field: {
                droppedCount: true,
              },
              title: "Spans Dropped",
              getElement: (item: TraceDropFilter): ReactElement => {
                const dropped: number = item.droppedCount || 0;

                if (dropped === 0) {
                  return (
                    <span className="text-sm text-gray-500">
                      {translator.translateText(
                        "This filter has never matched a span.",
                      )}
                    </span>
                  );
                }

                return (
                  <span className="text-lg font-semibold text-gray-900">
                    {dropped.toLocaleString(getReaderNumberLocale())}
                  </span>
                );
              },
            },
            {
              field: {
                lastDroppedAt: true,
              },
              title: "Last Dropped",
              fieldType: FieldType.DateTime,
              placeholder: "Never",
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Section 3: Filter Conditions (Visual Builder) */}
      <FilterQueryBuilder
        modelType={TraceDropFilter}
        modelId={modelId}
        config={TraceFilterConfig}
        renderPreview={(query: string): ReactElement => {
          return (
            <DropFilterImpactPreview
              signal="trace"
              rule={withStored({ filterQuery: query })}
              dataTestId="drop-filter-query-impact"
            />
          );
        }}
        onBeforeSave={async (query: string): Promise<boolean> => {
          if (!stored.filter?.isEnabled) {
            return true;
          }

          return await confirmation.confirm({
            signal: "trace",
            rule: withStored({ filterQuery: query }),
            purpose: DropFilterSavePurpose.Save,
          });
        }}
        onSaved={() => {
          stored.reload();
        }}
        title="Filter Conditions"
        description="Define which spans this drop filter applies to. Matching spans will be dropped or sampled based on the action above."
      />

      {/* Section 4: Delete Filter */}
      <ModelDelete
        modelType={TraceDropFilter}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_SETTINGS_DROP_FILTERS] as Route,
              { modelId },
            ),
          );
        }}
      />

      {/* What a change would take, asked before it is saved (#10436). */}
      {confirmation.confirmation}
    </Fragment>
  );
};

export default TraceDropFilterView;
