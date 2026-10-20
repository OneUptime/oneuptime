import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
  PROFILE_MONITOR_FUNCTION_MAX_LENGTH,
} from "Common/Types/Monitor/MonitorStepProfileMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ProfileCategory,
  formatProfileShare,
  getCategoryOfProfileTypes,
  getQueryProfileTypes,
} from "Common/Utils/Profiles/ProfileTypes";
import {
  PROFILE_KINDS_IN_ORDER,
  PROFILE_KIND_LABELS,
} from "../../../../Utils/ProfilesView";
import {
  PROFILE_MONITOR_ANY_KIND,
  PROFILE_MONITOR_PREVIEW_COUNT,
  PROFILE_MONITOR_PREVIEW_DESCRIPTION,
  PROFILE_MONITOR_PREVIEW_NOTHING,
  PROFILE_MONITOR_PREVIEW_SHARE,
  PROFILE_MONITOR_PREVIEW_TITLE,
} from "./ProfileMonitorCopy";

/*
 * A PROFILES MONITOR'S SETTINGS, AND WHAT IT WOULD READ NOW.
 *
 * What a person sets: the function to watch (its name, or part of its file
 * or package path - what the Function Share criteria measure), the kind of
 * profile to read, and the window. The services and infrastructure entities
 * that narrow it further fold under More fields, as on every telemetry
 * monitor. Below the settings, the preview reads what the monitor would
 * read right now (POST /telemetry/profiles/monitor-preview, the check's own
 * query): how many profiles the window holds and, with a function named,
 * its share - so a threshold is picked from what the function takes today.
 */

export interface ComponentProps {
  monitorStepProfileMonitor: MonitorStepProfileMonitor;
  onMonitorStepProfileMonitorChanged: (
    monitorStepProfileMonitor: MonitorStepProfileMonitor,
  ) => void;
  telemetryServices: Array<Service>;
  telemetryEntities?: Array<InventoryItem> | undefined;
}

// The kind field's value for every kind of profile (no type filter).
export const ANY_PROFILE_KIND: string = "any";

// A monitor saved with raw types of several kinds keeps them as they are.
export const CUSTOM_PROFILE_KIND: string = "custom";

export type ProfileMonitorFormValues = {
  functionName: string;
  kind: string;
  lastXSecondsOfProfiles: number;
  telemetryServiceIds: Array<string>;
  entityKeys: Array<string>;
};

const MORE_PROFILE_FILTERS: FormFieldCollapsibleSection<ProfileMonitorFormValues> =
  getAdvancedFormSection<ProfileMonitorFormValues>();

export const PROFILE_MONITOR_DURATION_OPTIONS: Array<{
  label: string;
  value: number;
}> = [
  { label: "Last 1 minute", value: 60 },
  { label: "Last 5 minutes", value: 300 },
  { label: "Last 15 minutes", value: 900 },
  { label: "Last 30 minutes", value: 1800 },
  { label: "Last 1 hour", value: 3600 },
  { label: "Last 6 hours", value: 21600 },
  { label: "Last 24 hours", value: 86400 },
];

// The kind a step reads, as the form's kind field holds it.
export function getProfileMonitorKindValue(
  profileTypes: Array<string> | undefined,
): string {
  if (!profileTypes || profileTypes.length === 0) {
    return ANY_PROFILE_KIND;
  }

  return getCategoryOfProfileTypes(profileTypes) || CUSTOM_PROFILE_KIND;
}

export function toProfileMonitorFormValues(
  monitor: MonitorStepProfileMonitor,
): ProfileMonitorFormValues {
  return {
    functionName: MonitorStepProfileMonitorUtil.getFunctionName(monitor),
    kind: getProfileMonitorKindValue(monitor.profileTypes),
    lastXSecondsOfProfiles:
      monitor.lastXSecondsOfProfiles ||
      MonitorStepProfileMonitorUtil.getDefault().lastXSecondsOfProfiles,
    telemetryServiceIds: (monitor.telemetryServiceIds || []).map(
      (id: ObjectID): string => {
        return id.toString();
      },
    ),
    entityKeys: monitor.entityKeys || [],
  };
}

export function toProfileMonitorConfig(
  values: ProfileMonitorFormValues,
  previous: MonitorStepProfileMonitor,
): MonitorStepProfileMonitor {
  const profileTypes: Array<string> =
    values.kind === CUSTOM_PROFILE_KIND
      ? previous.profileTypes || []
      : values.kind && values.kind !== ANY_PROFILE_KIND
        ? getQueryProfileTypes(values.kind) || []
        : [];

  return {
    attributes: previous.attributes || {},
    profileType: previous.profileType || "",
    profileTypes,
    telemetryServiceIds: (values.telemetryServiceIds || [])
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    entityKeys: (values.entityKeys || []).filter((key: string): boolean => {
      return Boolean(key);
    }),
    lastXSecondsOfProfiles:
      values.lastXSecondsOfProfiles ||
      MonitorStepProfileMonitorUtil.getDefault().lastXSecondsOfProfiles,
    functionName: (values.functionName || "")
      .trim()
      .substring(0, PROFILE_MONITOR_FUNCTION_MAX_LENGTH),
  };
}

interface PreviewAnswer {
  profileCount: number;
  functionShare: {
    functionName: string;
    sharePercent: number;
    windowSampleCount: number;
  } | null;
}

export function readProfileMonitorPreview(answer: JSONObject): PreviewAnswer {
  const share: JSONObject | null =
    answer["functionShare"] && typeof answer["functionShare"] === "object"
      ? (answer["functionShare"] as JSONObject)
      : null;

  return {
    profileCount: Number(answer["profileCount"]) || 0,
    functionShare: share
      ? {
          functionName: String(share["functionName"] || ""),
          sharePercent: Number(share["sharePercent"]) || 0,
          windowSampleCount: Number(share["windowSampleCount"]) || 0,
        }
      : null,
  };
}

const ProfileMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [formValues, setFormValues] = useState<ProfileMonitorFormValues>(
    toProfileMonitorFormValues(props.monitorStepProfileMonitor),
  );

  useEffect(() => {
    setFormValues(toProfileMonitorFormValues(props.monitorStepProfileMonitor));
  }, [props.monitorStepProfileMonitor]);

  const handleFormChange: (values: ProfileMonitorFormValues) => void = (
    values: ProfileMonitorFormValues,
  ): void => {
    setFormValues(values);
    props.onMonitorStepProfileMonitorChanged(
      toProfileMonitorConfig(values, props.monitorStepProfileMonitor),
    );
  };

  // The preview reads a debounced copy, so typing does not read per key.
  const [previewKey, setPreviewKey] = useState<string>("");

  const config: MonitorStepProfileMonitor = toProfileMonitorConfig(
    formValues,
    props.monitorStepProfileMonitor,
  );
  const configJSON: JSONObject = MonitorStepProfileMonitorUtil.toJSON(config);
  const configKey: string = JSON.stringify(configJSON);

  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setPreviewKey(configKey);
    }, 500);

    return (): void => {
      clearTimeout(timer);
    };
  }, [configKey]);

  const [preview, setPreview] = useState<PreviewAnswer | null>(null);
  const [previewError, setPreviewError] = useState<string>("");
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!previewKey) {
      return;
    }

    let isCancelled: boolean = false;
    setIsPreviewLoading(true);
    setPreviewError("");

    API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/telemetry/profiles/monitor-preview",
      ),
      data: JSON.parse(previewKey) as JSONObject,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    })
      .then((response: HTTPResponse<JSONObject> | HTTPErrorResponse) => {
        if (isCancelled) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setPreview(
          readProfileMonitorPreview((response.data || {}) as JSONObject),
        );
        setIsPreviewLoading(false);
      })
      .catch((err: unknown) => {
        if (isCancelled) {
          return;
        }

        setPreview(null);
        setPreviewError(API.getFriendlyMessage(err as Error));
        setIsPreviewLoading(false);
      });

    return (): void => {
      isCancelled = true;
    };
  }, [previewKey]);

  const kindOptions: Array<{ label: string; value: string }> = [
    { label: PROFILE_MONITOR_ANY_KIND, value: ANY_PROFILE_KIND },
    ...PROFILE_KINDS_IN_ORDER.map(
      (category: ProfileCategory): { label: string; value: string } => {
        return { label: PROFILE_KIND_LABELS[category], value: category };
      },
    ),
  ];

  if (formValues.kind === CUSTOM_PROFILE_KIND) {
    kindOptions.push({
      label: (props.monitorStepProfileMonitor.profileTypes || []).join(", "),
      value: CUSTOM_PROFILE_KIND,
    });
  }

  const renderPreview: () => ReactElement = (): ReactElement => {
    if (previewError) {
      return (
        <p
          className="text-sm text-red-700"
          data-testid="profile-monitor-preview-error"
        >
          {previewError}
        </p>
      );
    }

    if (!preview || isPreviewLoading) {
      return (
        <div
          className="h-12 animate-pulse rounded-lg border border-gray-100 bg-gray-50"
          data-testid="profile-monitor-preview-loading"
        />
      );
    }

    return (
      <div
        className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
        data-testid="profile-monitor-preview"
      >
        <p data-testid="profile-monitor-preview-count">
          {translator.translatePlural(
            PROFILE_MONITOR_PREVIEW_COUNT,
            preview.profileCount,
          )}
        </p>
        {preview.functionShare ? (
          preview.functionShare.windowSampleCount > 0 ? (
            <p data-testid="profile-monitor-preview-share">
              {translator.translateTemplate(PROFILE_MONITOR_PREVIEW_SHARE, {
                function: preview.functionShare.functionName,
                share: formatProfileShare(preview.functionShare.sharePercent),
              })}
            </p>
          ) : (
            <p data-testid="profile-monitor-preview-nothing">
              {translator.translateText(PROFILE_MONITOR_PREVIEW_NOTHING)}
            </p>
          )
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div>
      <BasicForm
        id="profile-monitor-form"
        hideSubmitButton={true}
        initialValues={formValues}
        onChange={handleFormChange}
        fields={[
          {
            field: {
              functionName: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Function",
            description:
              "Its name, or part of its file or package path, as the Profiler shows it.",
            placeholder: "parseOrder",
            hideOptionalLabel: true,
          },
          {
            field: {
              kind: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: kindOptions,
            title: "What to analyze",
            description: "The kind of profile the monitor reads.",
            hideOptionalLabel: true,
          },
          {
            field: {
              lastXSecondsOfProfiles: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: PROFILE_MONITOR_DURATION_OPTIONS,
            title: "Monitor profiles for (time)",
            description:
              "We will read the profiles sent within this time window.",
            defaultValue:
              MonitorStepProfileMonitorUtil.getDefault().lastXSecondsOfProfiles,
            hideOptionalLabel: true,
          },
          {
            field: {
              telemetryServiceIds: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.telemetryServices.map(
              (service: Service): { label: string; value: string } => {
                return {
                  label: service.name || "Untitled Service",
                  value: service.id?.toString() || "",
                };
              },
            ),
            title: "Filter by Telemetry Service",
            description: "Select telemetry services to scope this monitor.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_PROFILE_FILTERS,
          },
          {
            field: {
              entityKeys: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: (props.telemetryEntities || []).map(
              (telemetryEntity: InventoryItem) => {
                return {
                  label: `${
                    telemetryEntity.displayName ||
                    telemetryEntity.entityKey ||
                    ""
                  } (${telemetryEntity.entityType || ""})`,
                  value: telemetryEntity.entityKey || "",
                };
              },
            ),
            title: "Filter by Infrastructure Entity",
            description: "Scope to specific infrastructure entities (optional)",
            hideOptionalLabel: true,
            collapsibleSection: MORE_PROFILE_FILTERS,
          },
        ]}
      />

      <div>
        <HorizontalRule />
        <FieldLabelElement
          title={PROFILE_MONITOR_PREVIEW_TITLE}
          description={PROFILE_MONITOR_PREVIEW_DESCRIPTION}
          hideOptionalLabel={true}
          isHeading={true}
        />
        <div className="mt-4 mb-5">{renderPreview()}</div>
      </div>
    </div>
  );
};

export default ProfileMonitorStepForm;
