import ComponentID from "../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  ComponentType,
} from "../../../Types/Workflow/Component";

/*
 * A small curated set of the steps most authors reach for, surfaced as a
 * "Common steps" section at the top of the component picker. This is purely a
 * shortcut over the full catalog (which still lists everything) — no component
 * is removed or renamed, so there's no morph/fidelity risk.
 */

export const COMMON_CATEGORY_NAME: string = "Common steps";
export const COMMON_CATEGORY_DESCRIPTION: string =
  "Popular steps to get you started.";

const COMMON_TRIGGER_IDS: Array<string> = [
  ComponentID.Schedule,
  ComponentID.Webhook,
  ComponentID.Manual,
];

const COMMON_COMPONENT_IDS: Array<string> = [
  ComponentID.SlackSendMessageToChannel,
  ComponentID.SendEmail,
  ComponentID.ApiGet,
  ComponentID.ApiPost,
  ComponentID.IfElse,
  ComponentID.JavaScriptCode,
  ComponentID.Log,
  ComponentID.WorkflowRun,
  ComponentID.Sleep,
];

export type GetCommonComponentsFunction = (
  components: Array<ComponentMetadata>,
  componentType: ComponentType,
) => Array<ComponentMetadata>;

/*
 * Return the curated components of the given type that exist in the catalog,
 * in curated order. Unknown ids are skipped, so this never surfaces a broken
 * entry.
 */
export const getCommonComponents: GetCommonComponentsFunction = (
  components: Array<ComponentMetadata>,
  componentType: ComponentType,
): Array<ComponentMetadata> => {
  const curatedIds: Array<string> =
    componentType === ComponentType.Trigger
      ? COMMON_TRIGGER_IDS
      : COMMON_COMPONENT_IDS;

  const byId: Map<string, ComponentMetadata> = new Map<
    string,
    ComponentMetadata
  >();
  for (const component of components) {
    if (component.componentType === componentType) {
      byId.set(component.id, component);
    }
  }

  const result: Array<ComponentMetadata> = [];
  for (const id of curatedIds) {
    const component: ComponentMetadata | undefined = byId.get(id);
    if (component) {
      result.push(component);
    }
  }

  return result;
};
