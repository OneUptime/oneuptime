import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The alert templates of an infrastructure monitor type (Host, Docker,
 * Podman, Docker Swarm, Kubernetes, Proxmox, VMware, Ceph, Storage Array,
 * IoT), as the Quick Setup picker lists them. React-free, so App tests can
 * read it.
 *
 * Each template says in one line when it fires (`summary`); how it is
 * computed (`description`) is shown once it is picked.
 */

export interface AlertTemplatePickerTemplate {
  id: string;
  // Shown as written: template names are English in every language.
  name: string;
  summary: string;
  description: string;
  severity: string;
  category: string;
}

export interface AlertTemplateCategory {
  // The template's own category value ("ControlPlane").
  category: string;
  // What the picker calls it ("Control Plane"), looked up in the reader's language.
  label: string;
  icon: IconProp;
}

export interface AlertTemplateGroup<T extends AlertTemplatePickerTemplate> {
  // Undefined for a flat list (a type whose picker names no categories).
  category: string | undefined;
  label: string | undefined;
  icon: IconProp | undefined;
  templates: Array<T>;
}

export const ALERT_TEMPLATE_PICKER_INTRO: string = translationKey(
  "Pick a template. It fills in the metric, thresholds and criteria below.",
);

export const ALERT_TEMPLATE_PICKER_ARIA_LABEL: string =
  translationKey("Alert templates");

export const ALERT_TEMPLATE_CONFIGURATION_TITLE: string = translationKey(
  "Template Configuration",
);

export const ALERT_TEMPLATE_TIME_RANGE: string = translationKey("Time Range");

/*
 * The one line under each infrastructure monitor type's configuration card
 * title: the template comes first, the other two tabs are the way to do it
 * yourself.
 */
export const INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION: string =
  translationKey(
    "Start from a template, or pick a metric or build a query yourself.",
  );

/*
 * The templates in the order the picker shows them: under the categories
 * the type names, in that order, each keeping the catalog's order. A
 * template whose category the list does not name is still offered, under
 * its own category value after the named ones - a template must never be
 * silently left out. Without categories the list is flat.
 */
export function groupAlertTemplates<T extends AlertTemplatePickerTemplate>(
  templates: Array<T>,
  categories?: Array<AlertTemplateCategory> | undefined,
): Array<AlertTemplateGroup<T>> {
  if (!categories || categories.length === 0) {
    return templates.length > 0
      ? [
          {
            category: undefined,
            label: undefined,
            icon: undefined,
            templates: [...templates],
          },
        ]
      : [];
  }

  const groups: Array<AlertTemplateGroup<T>> = [];

  for (const category of categories) {
    const inCategory: Array<T> = templates.filter((template: T): boolean => {
      return template.category === category.category;
    });

    if (inCategory.length > 0) {
      groups.push({
        category: category.category,
        label: category.label,
        icon: category.icon,
        templates: inCategory,
      });
    }
  }

  const named: Set<string> = new Set<string>(
    categories.map((category: AlertTemplateCategory): string => {
      return category.category;
    }),
  );

  const unnamed: Map<string, AlertTemplateGroup<T>> = new Map();

  for (const template of templates) {
    if (named.has(template.category)) {
      continue;
    }

    let group: AlertTemplateGroup<T> | undefined = unnamed.get(
      template.category,
    );

    if (!group) {
      group = {
        category: template.category,
        label: template.category,
        icon: undefined,
        templates: [],
      };
      unnamed.set(template.category, group);
      groups.push(group);
    }

    group.templates.push(template);
  }

  return groups;
}

// Every template in the order the groups list them: the keyboard's order.
export function getAlertTemplatesInDrawnOrder<
  T extends AlertTemplatePickerTemplate,
>(groups: Array<AlertTemplateGroup<T>>): Array<T> {
  return groups.flatMap((group: AlertTemplateGroup<T>): Array<T> => {
    return group.templates;
  });
}

/*
 * Which template takes the group's one tab stop: the picked one when it is
 * listed, else the first.
 */
export function getAlertTemplateTabStopId(data: {
  templateIds: Array<string>;
  selectedTemplateId: string | undefined;
}): string | undefined {
  if (
    data.selectedTemplateId &&
    data.templateIds.includes(data.selectedTemplateId)
  ) {
    return data.selectedTemplateId;
  }

  return data.templateIds[0];
}

/*
 * Where an arrow key moves focus: one step on, clamped at either end
 * (running off the end and landing at the top reads as a glitch). Home and
 * End go to the first and the last.
 */
export function getAlertTemplateIdAfterKey(data: {
  templateIds: Array<string>;
  fromTemplateId: string;
  key: string;
}): string | undefined {
  const index: number = data.templateIds.indexOf(data.fromTemplateId);

  if (index < 0 || data.templateIds.length === 0) {
    return undefined;
  }

  let nextIndex: number = index;

  if (data.key === "ArrowDown" || data.key === "ArrowRight") {
    nextIndex = Math.min(index + 1, data.templateIds.length - 1);
  } else if (data.key === "ArrowUp" || data.key === "ArrowLeft") {
    nextIndex = Math.max(index - 1, 0);
  } else if (data.key === "Home") {
    nextIndex = 0;
  } else if (data.key === "End") {
    nextIndex = data.templateIds.length - 1;
  } else {
    return undefined;
  }

  return data.templateIds[nextIndex];
}

export function isCriticalAlertTemplate(
  template: Pick<AlertTemplatePickerTemplate, "severity">,
): boolean {
  return template.severity === "Critical";
}
