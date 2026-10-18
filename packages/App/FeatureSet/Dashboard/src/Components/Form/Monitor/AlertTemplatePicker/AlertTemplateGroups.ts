import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The alert templates of an infrastructure monitor type (Host, Docker,
 * Podman, Docker Swarm, Kubernetes, Proxmox, VMware, Ceph, Storage Array,
 * IoT), as the Quick Setup picker lists them. React-free, so App tests can
 * read it.
 *
 * Each template says in one line when it fires (`summary`); how it is
 * computed (`description`) waits behind Show more once it is picked.
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

/*
 * Over the picked template, once the list has folded into it, in Title
 * Case like the card's other field labels. Not the bare "Template", which
 * several languages show in English on other pages.
 */
export const ALERT_TEMPLATE_PICKED_LABEL: string =
  translationKey("Alert Template");

// Unfolds the list again, to pick another template.
export const ALERT_TEMPLATE_CHANGE: string = translationKey("Change");

// The picked template's full description, behind the same words as on a resource's Recommendations.
export const ALERT_TEMPLATE_SHOW_MORE: string = translationKey("Show more");
export const ALERT_TEMPLATE_SHOW_LESS: string = translationKey("Show less");

export const ALERT_TEMPLATE_TIME_RANGE: string = translationKey("Time Range");

export const ALERT_TEMPLATE_TIME_RANGE_DESCRIPTION: string = translationKey(
  "How far back each check looks.",
);

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

/*
 * The picked template, when the list offers it: the list folds into it. A
 * pick the list does not offer (a storage array whose platform changed
 * since) has nothing to fold into, so the list stays open.
 */
export function getPickedAlertTemplate<T extends AlertTemplatePickerTemplate>(
  templates: Array<T>,
  selectedTemplateId: string | undefined,
): T | undefined {
  if (!selectedTemplateId) {
    return undefined;
  }

  return templates.find((template: T): boolean => {
    return template.id === selectedTemplateId;
  });
}

/*
 * Whether a row's pick is a new one, to hand to the form. Picking the
 * template already picked (after Change, to keep it) only folds the list:
 * handing it on would rebuild the criteria from the template and throw away
 * whatever was changed in them since.
 */
export function isNewAlertTemplatePick(data: {
  templateId: string;
  selectedTemplateId: string | undefined;
}): boolean {
  return data.templateId !== data.selectedTemplateId;
}

/*
 * Whether the picked template has more to say than its one-line summary:
 * then its full description waits behind Show more.
 */
export function hasAlertTemplateDetails(
  template: Pick<AlertTemplatePickerTemplate, "summary" | "description">,
): boolean {
  const description: string = template.description.trim();

  return description.length > 0 && description !== template.summary.trim();
}
