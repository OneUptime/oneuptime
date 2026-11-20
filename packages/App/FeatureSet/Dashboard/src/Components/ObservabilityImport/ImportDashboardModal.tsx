import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import {
  DashboardImportItem,
  DashboardImportPlan,
  DashboardImportVariable,
  ImportItemStatus,
  ImportSourceKind,
} from "Common/Types/ObservabilityImport/ObservabilityImport";
import { joinWithArrowsOn } from "Common/Types/DirectionArrow";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import { getUniqueName } from "Common/UI/Components/Forms/Utils/UniqueName";
import {
  SteppedModalFooter,
  getSteppedModalFooter,
} from "Common/UI/Components/Forms/Utils/SteppedFormFooter";
import Input from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  DASHBOARD_SOURCE_KINDS,
  ImportReadError,
  ImportSourceDocument,
  readImportSource,
} from "Common/Utils/ObservabilityImport/ImportSource";
import {
  buildImportedDashboardViewConfig,
  getCreatedDashboardItems,
  listDatadogMetricNames,
  planDashboardImport,
} from "Common/Utils/ObservabilityImport/ObservabilityImport";
import { DatadogMetricKind } from "Common/Utils/ObservabilityImport/Datadog/DatadogPromQL";
import { fetchDashboardNames } from "../Dashboard/DashboardCreateForm";
import { getDashboardVariableTypeName } from "../Dashboard/Toolbar/DashboardVariableTypeNames";
import { getWidgetTypeName } from "../Dashboard/Toolbar/WidgetCatalog";
import {
  ImportFileField,
  ImportItemRow,
  ImportNoteList,
  ImportSection,
  ImportSummary,
} from "./ImportParts";
import {
  ImportAiTarget,
  lookUpDatadogMetricKinds,
  lookUpVariableStartingValues,
} from "./ObservabilityImportApi";

/*
 * IMPORT FROM GRAFANA OR DATADOG (issue #7697): Dashboards > ⋯.
 *
 * Two steps. The file: a Grafana dashboard's JSON model or a Datadog
 * dashboard's export, pasted or uploaded - read here, in the browser.
 * Then the preview: every panel and variable with what it becomes,
 * converted exactly, approximately (and what differs) or not (and why),
 * the dashboard's name, and Create Dashboard. Nothing is created before
 * it, and the dashboard is created through the same create the Create a
 * dashboard dialog uses, with the person's own permissions.
 *
 * A panel whose query no rule converted can be offered to OneUptime AI,
 * which the person asks for and reads before using it; using it converts
 * the file again with that query. A variable Grafana starts on its first
 * value starts on the first value the project's metrics have.
 */

export interface ComponentProps {
  onClose: () => void;
  // Called with the created dashboard, so the page can open it.
  onCreated: (dashboard: Dashboard) => void;
}

enum ImportStep {
  File = "file",
  Preview = "preview",
}

// The name's shortest length, as Create a dashboard asks.
const NAME_MIN_LENGTH: number = 2;
// A dashboard's name is short text.
const NAME_MAX_LENGTH: number = 100;

const SOURCE_NAMES: Readonly<Partial<Record<ImportSourceKind, string>>> = {
  [ImportSourceKind.GrafanaDashboard]: translationKey("Grafana dashboard"),
  [ImportSourceKind.DatadogDashboard]: translationKey("Datadog dashboard"),
};

const ImportDashboardModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [step, setStep] = useState<ImportStep>(ImportStep.File);
  const [text, setText] = useState<string>("");
  const [fileError, setFileError] = useState<string>("");
  const [source, setSource] = useState<ImportSourceDocument | null>(null);
  const [overrides, setOverrides] = useState<Map<string, string>>(
    new Map<string, string>(),
  );
  const [metricKinds, setMetricKinds] = useState<
    Map<string, DatadogMetricKind>
  >(new Map<string, DatadogMetricKind>());
  const [startingValues, setStartingValues] = useState<Map<string, string>>(
    new Map<string, string>(),
  );
  const [name, setName] = useState<string>("");
  const [nameError, setNameError] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [isReading, setIsReading] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // Set from Create until the server answers: a second press makes nothing.
  const isCreatingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const plan: DashboardImportPlan | null = useMemo(() => {
    return source
      ? planDashboardImport(source, {
          queryOverrides: overrides,
          knownMetricKinds: metricKinds,
        })
      : null;
  }, [source, overrides, metricKinds]);

  const createdItems: Array<DashboardImportItem> = useMemo(() => {
    return plan ? getCreatedDashboardItems(plan) : [];
  }, [plan]);

  const readFile: () => Promise<void> = async (): Promise<void> => {
    let read: ImportSourceDocument;

    try {
      read = readImportSource({ text, accepts: DASHBOARD_SOURCE_KINDS });
    } catch (err) {
      setFileError(
        err instanceof ImportReadError
          ? translator.translateTemplate(err.text, err.values)
          : API.getFriendlyMessage(err),
      );
      return;
    }

    setFileError("");
    setIsReading(true);

    try {
      const firstPlan: DashboardImportPlan = planDashboardImport(read);
      // Each lookup that fails hands back nothing: the preview still opens.
      const [names, starting, kinds]: [
        Array<string>,
        Map<string, string>,
        Map<string, DatadogMetricKind>,
      ] = await Promise.all([
        fetchDashboardNames(),
        lookUpVariableStartingValues(firstPlan),
        lookUpDatadogMetricKinds(listDatadogMetricNames(read)),
      ]);

      setSource(read);
      setOverrides(new Map<string, string>());
      setStartingValues(starting);
      setMetricKinds(kinds);
      setName(
        getUniqueName({
          name: (firstPlan.title || "Imported Dashboard").slice(
            0,
            NAME_MAX_LENGTH,
          ),
          existingNames: names,
        }),
      );
      setDescription(firstPlan.description);
      setNameError("");
      setError("");
      setStep(ImportStep.Preview);
    } catch (err) {
      setFileError(API.getFriendlyMessage(err));
    }

    setIsReading(false);
  };

  const create: () => Promise<void> = async (): Promise<void> => {
    if (!plan || isCreatingRef.current) {
      return;
    }

    if (name.trim().length < NAME_MIN_LENGTH) {
      setNameError(
        translationKey("Please give this dashboard a name of at least 2 letters."),
      );
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setError("");

    let created: Dashboard | null = null;

    try {
      const config: DashboardViewConfig = buildImportedDashboardViewConfig({
        plan,
        startingValues,
      });
      const dashboard: Dashboard = new Dashboard();
      dashboard.name = name.trim();

      if (description.trim()) {
        dashboard.description = description.trim();
      }

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        dashboard.projectId = projectId;
      }

      // As the dashboard's editor saves its board (DashboardView).
      dashboard.dashboardViewConfig = JSONFunctions.serializeValue(
        config,
      ) as unknown as DashboardViewConfig;

      const response: HTTPResponse<
        JSONObject | JSONArray | Dashboard | Array<Dashboard>
      > = await ModelAPI.create<Dashboard>({
        model: dashboard,
        modelType: Dashboard,
      });

      created = response.data as Dashboard;
    } catch (err) {
      // A name taken meanwhile, a plan's limit: said here, and Create can be pressed again.
      setError(API.getFriendlyMessage(err));
    }

    isCreatingRef.current = false;
    setIsCreating(false);

    if (created) {
      props.onCreated(created);
    }
  };

  const applyAiQuery: (targetKey: string | undefined, promQL: string) => void = (
    targetKey: string | undefined,
    promQL: string,
  ): void => {
    if (!targetKey) {
      return;
    }

    const next: Map<string, string> = new Map<string, string>(overrides);
    next.set(targetKey, promQL);
    setOverrides(next);
  };

  // "timeseries → Chart", pointing the way the reader's line is read.
  const arrow: (values: Array<string | undefined>) => string = (
    values: Array<string | undefined>,
  ): string => {
    return joinWithArrowsOn(
      values.filter((value: string | undefined): value is string => {
        return Boolean(value);
      }),
      translator.language,
    );
  };

  const renderVariable: (item: DashboardImportVariable) => ReactElement = (
    item: DashboardImportVariable,
  ): ReactElement => {
    const starting: string | undefined = startingValues.get(item.key);

    return (
      <ImportItemRow
        key={item.key}
        dataTestId="import-variable"
        title={item.variable?.label || item.sourceName}
        subtitle={arrow([
          item.sourceType,
          item.variable
            ? translator.translateText(
                getDashboardVariableTypeName(item.variable.type),
              )
            : "",
        ])}
        status={item.status}
        notes={item.notes}
        queries={[]}
        extra={
          starting ? (
            <p className="mt-0.5 text-xs text-gray-600">
              {translator.translateTemplate("Starts on {{value}}", {
                value: starting,
              })}
            </p>
          ) : undefined
        }
      />
    );
  };

  const renderItem: (item: DashboardImportItem) => ReactElement = (
    item: DashboardImportItem,
  ): ReactElement => {
    const widget: string | null = item.component
      ? getWidgetTypeName(item.component.componentType)
      : null;

    return (
      <ImportItemRow
        key={item.key}
        title={item.title}
        subtitle={arrow([
          item.sourceType,
          widget && item.status !== ImportItemStatus.NotConverted
            ? translator.translateText(widget)
            : "",
        ])}
        status={item.status}
        notes={item.notes}
        queries={item.queries.map((query: { promQL: string }): string => {
          return query.promQL;
        })}
        ai={
          item.status === ImportItemStatus.NotConverted && item.aiCandidate
            ? {
                candidate: item.aiCandidate,
                target: ImportAiTarget.Dashboard,
                onUse: (promQL: string) => {
                  applyAiQuery(item.aiCandidate?.targetKey, promQL);
                },
              }
            : undefined
        }
      />
    );
  };

  const renderFileStep: () => ReactElement = (): ReactElement => {
    return (
      <ImportFileField
        id="dashboard-import-text"
        label="Dashboard JSON"
        hint="In Grafana, copy the JSON model from the dashboard's Settings. In Datadog, use Export dashboard JSON from the dashboard's settings."
        value={text}
        error={fileError}
        onChange={(value: string) => {
          setText(value);
          setFileError("");
        }}
      />
    );
  };

  const renderPreviewStep: () => ReactElement = (): ReactElement => {
    if (!plan) {
      return <></>;
    }

    const sourceName: string = SOURCE_NAMES[plan.source] || "";
    const variables: Array<DashboardImportVariable> = plan.variables;

    return (
      <div className="space-y-5" data-testid="dashboard-import-preview">
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            {arrow([translator.translateText(sourceName), plan.title])}
          </p>
          <ImportSummary
            statuses={plan.items.map(
              (item: DashboardImportItem): ImportItemStatus => {
                return item.status;
              },
            )}
          />
          <ImportNoteList notes={plan.notes} />
        </div>

        <div>
          <FieldLabelElement
            title="Name"
            htmlFor="dashboard-import-name"
            required={true}
            description="Dashboard names are unique within a project."
          />
          <Input
            id="dashboard-import-name"
            value={name}
            dataTestId="dashboard-import-name"
            error={nameError ? translator.translateText(nameError) : undefined}
            onChange={(value: string) => {
              setName(value);
              setNameError("");
            }}
          />
          <div className="mt-3">
            <FoldedSection
              title={MORE_FIELDS_SECTION_TITLE}
              dataTestId="dashboard-import-more-fields"
              items={[
                {
                  key: "description",
                  title: "Description",
                  isSet: description.trim().length > 0,
                },
              ]}
            >
              <div className="pt-1">
                <FieldLabelElement
                  title="Description"
                  htmlFor="dashboard-import-description"
                />
                <TextArea
                  id="dashboard-import-description"
                  value={description}
                  dataTestId="dashboard-import-description"
                  onChange={(value: string) => {
                    setDescription(value);
                  }}
                />
              </div>
            </FoldedSection>
          </div>
        </div>

        {variables.length > 0 ? (
          <ImportSection title="Variables" dataTestId="dashboard-import-variables">
            {variables.map(renderVariable)}
          </ImportSection>
        ) : (
          <></>
        )}

        <ImportSection
          title={
            plan.source === ImportSourceKind.DatadogDashboard
              ? "Widgets"
              : "Panels"
          }
          dataTestId="dashboard-import-items"
        >
          {plan.items.map(renderItem)}
        </ImportSection>
      </div>
    );
  };

  const footer: SteppedModalFooter = getSteppedModalFooter({
    hasSteps: true,
    isOnLastStep: step === ImportStep.Preview,
    onAction:
      createdItems.length > 0
        ? (): void => {
            void create();
          }
        : undefined,
    onNext:
      step === ImportStep.File
        ? (): void => {
            void readFile();
          }
        : undefined,
    nextButtonText: "Preview",
    isNextButtonDisabled: !text.trim() || isReading,
  });

  return (
    <Modal
      title="Import from Grafana or Datadog"
      description={
        step === ImportStep.File
          ? "Paste a Grafana dashboard's JSON model or a Datadog dashboard's export, or upload the file."
          : createdItems.length > 0
            ? "Check what each panel becomes, then create the dashboard."
            : "Nothing in this file converts, so there is no dashboard to create."
      }
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      error={error || undefined}
      isLoading={isCreating || isReading}
      submitButtonText="Create Dashboard"
      onSubmit={footer.onSubmit}
      secondaryButton={footer.secondaryButton}
      leftFooterElement={
        step === ImportStep.Preview ? (
          <Button
            title="Back"
            buttonStyle={ButtonStyleType.OUTLINE}
            icon={IconProp.ChevronLeft}
            disabled={isCreating}
            dataTestId="dashboard-import-back"
            onClick={() => {
              setError("");
              setStep(ImportStep.File);
            }}
          />
        ) : (
          <></>
        )
      }
    >
      <div className="min-w-0" data-step={step}>
        {step === ImportStep.File ? renderFileStep() : renderPreviewStep()}
      </div>
    </Modal>
  );
};

export default ImportDashboardModal;
