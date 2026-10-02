import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
} from "../../../../../Types/Workflow/Component";
import BuiltInComponents, {
  Categories,
} from "../../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../../Types/Workflow/Components/BaseModel";

/*
 * A small palette for the picker's tests, made the way the real one is: the
 * real hand-written steps, plus the real generator's output for a handful of
 * models. Only the four fields the generator reads are faked, so every
 * title, description and id here is the generator's own, never an
 * approximation of it - the search lives in the gap between those strings
 * and what people type.
 *
 * The full catalog (every model) is used by ComponentPickerRealCatalog.test,
 * which loads all the models; this keeps the other suites fast.
 */

export interface FixtureModel {
  tableName: string;
  singularName: string;
  pluralName: string;
  icon?: IconProp | undefined;
  description?: string | undefined;
  create?: boolean | undefined;
  read?: boolean | undefined;
  update?: boolean | undefined;
  delete?: boolean | undefined;
}

export const FIXTURE_MODELS: Array<FixtureModel> = [
  // Registered before Incident, as in the real registry.
  {
    tableName: "IncidentState",
    singularName: "Incident State",
    pluralName: "Incident States",
    icon: IconProp.ArrowCircleRight,
  },
  {
    tableName: "Incident",
    singularName: "Incident",
    pluralName: "Incidents",
    icon: IconProp.Alert,
    description: "Manage incidents for your project",
  },
  {
    tableName: "IncidentFeed",
    singularName: "Incident Feed",
    pluralName: "Incident Feeds",
  },
  {
    tableName: "IncidentEpisode",
    singularName: "Incident Episode",
    pluralName: "Incident Episodes",
  },
  {
    tableName: "IncidentEpisodeStateTimeline",
    singularName: "Incident Episode State Timeline",
    pluralName: "Incident Episode State Timelines",
  },
  {
    tableName: "IncidentPublicNote",
    singularName: "Incident Public Note",
    pluralName: "Incident Public Notes",
  },
  {
    tableName: "IncidentInternalNote",
    singularName: "Incident Internal Note",
    pluralName: "Incident Internal Notes",
  },
  {
    tableName: "IncidentNoteTemplate",
    singularName: "Incident Note Template",
    pluralName: "Incident Note Templates",
  },
  {
    tableName: "IncidentSeverity",
    singularName: "Incident Severity",
    pluralName: "Incident Severities",
  },
  {
    tableName: "Alert",
    singularName: "Alert",
    pluralName: "Alerts",
    icon: IconProp.Alert,
  },
  {
    tableName: "Monitor",
    singularName: "Monitor",
    pluralName: "Monitors",
    icon: IconProp.AltGlobe,
  },
  {
    tableName: "MonitorStatus",
    singularName: "Monitor Status",
    pluralName: "Monitor Statuses",
  },
  {
    tableName: "Team",
    singularName: "Team",
    pluralName: "Teams",
    icon: IconProp.Team,
  },
  // A create-only model, as the notification logs are.
  {
    tableName: "EmailLog",
    singularName: "Email Log",
    pluralName: "Email Logs",
    read: false,
    update: false,
    delete: false,
  },
  {
    tableName: "OnCallDutyPolicy",
    singularName: "On-Call Policy",
    pluralName: "On-Call Duty Policies",
  },
  {
    tableName: "ServiceLevelObjective",
    singularName: "Service Level Objective",
    pluralName: "Service Level Objectives",
  },
  {
    tableName: "IoTFleetLabelRule",
    singularName: "IoT Fleet Label Rule",
    pluralName: "IoT Fleet Label Rules",
  },
  {
    tableName: "StatusPage",
    singularName: "Status Page",
    pluralName: "Status Pages",
  },
  // Two models really do share this name.
  {
    tableName: "StatusPageSubscriberNotificationTemplate",
    singularName: "Subscriber Notification Template",
    pluralName: "Subscriber Notification Templates",
    icon: IconProp.Email,
  },
  {
    tableName: "StatusPageSubscriberNotificationTemplateStatusPage",
    singularName: "Subscriber Notification Template",
    pluralName: "Subscriber Notification Templates",
    icon: IconProp.Link,
  },
  // Read only, as AI Agent is.
  {
    tableName: "AIAgent",
    singularName: "AI Agent",
    pluralName: "AI Agents",
    create: false,
    update: false,
    delete: false,
  },
];

export type GetModelComponentsFunction = (
  model: FixtureModel,
) => Array<ComponentMetadata>;

// The real generator, handed just the fields it reads.
export const getModelComponents: GetModelComponentsFunction = (
  model: FixtureModel,
): Array<ComponentMetadata> => {
  return BaseModelComponentFactory.getComponents({
    tableName: model.tableName,
    singularName: model.singularName,
    pluralName: model.pluralName,
    enableWorkflowOn: {
      create: model.create !== false,
      read: model.read !== false,
      update: model.update !== false,
      delete: model.delete !== false,
    },
  } as unknown as BaseModel);
};

export interface FixturePalette {
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
}

export type BuildFixturePaletteFunction = (
  models?: Array<FixtureModel>,
) => FixturePalette;

/*
 * Shaped like loadComponentsAndCategories' result: the hand-written steps
 * and their categories first, then each model's steps and its category.
 */
export const buildFixturePalette: BuildFixturePaletteFunction = (
  models: Array<FixtureModel> = FIXTURE_MODELS,
): FixturePalette => {
  const components: Array<ComponentMetadata> = [...BuiltInComponents];
  const categories: Array<ComponentCategory> = [...Categories];

  for (const model of models) {
    components.push(...getModelComponents(model));
    categories.push({
      name: model.singularName,
      description:
        model.description ||
        `Interact with ${model.singularName} in your workflow.`,
      icon: model.icon || IconProp.Database,
      tableName: model.tableName,
    });
  }

  return { components: components, categories: categories };
};

export type FindByTitleFunction = (
  components: Array<ComponentMetadata>,
  title: string,
) => ComponentMetadata;

export const findByTitle: FindByTitleFunction = (
  components: Array<ComponentMetadata>,
  title: string,
): ComponentMetadata => {
  const found: ComponentMetadata | undefined = components.find(
    (componentMetadata: ComponentMetadata): boolean => {
      return componentMetadata.title === title;
    },
  );

  if (!found) {
    /*
     * A mistyped title would otherwise resolve to undefined and quietly
     * weaken every assertion that reads it.
     */
    throw new Error(`No component titled "${title}" in the fixture palette.`);
  }

  return found;
};
