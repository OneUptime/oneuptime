import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  getAllOpenStackAlertTemplates,
  getOpenStackAlertTemplatesForCloud,
  OpenStackAlertTemplate,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { OPENSTACK_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's OpenStack templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: OpenStackAlertTemplate) => void;
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
  /*
   * What the chosen cloud runs and how it is collected, once that is known: a template over something
   * it doesn't have could never fire. With no cloud chosen yet, the whole catalogue.
   */
  cloud?:
    | {
        services: ReadonlyArray<string>;
        isCollectedByProbe: boolean;
      }
    | undefined;
}

const OpenStackTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const offered: Array<string> = props.cloud
    ? getOpenStackAlertTemplatesForCloud(props.cloud).map(
        (template: OpenStackAlertTemplate): string => {
          return template.id;
        },
      )
    : [];

  return (
    <AlertTemplatePicker<OpenStackAlertTemplate>
      templates={
        props.cloud
          ? getAllOpenStackAlertTemplates().filter(
              (template: OpenStackAlertTemplate): boolean => {
                return (
                  // One already chosen stays, or the form couldn't show what it holds.
                  template.id === props.selectedTemplateId ||
                  offered.includes(template.id)
                );
              },
            )
          : getAllOpenStackAlertTemplates()
      }
      categories={OPENSTACK_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default OpenStackTemplatePicker;
