import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The custom fields a project defined for a resource, rendered on that
 * resource's OVERVIEW page.
 *
 * Every resource that supports custom fields already has a dedicated
 * "Custom Fields" page hanging off its side menu, but a field only earns its
 * keep if it is visible where people actually look - the overview - rather
 * than behind a menu item nobody opens. This is the one place that decides
 * how that card is titled and that it disappears entirely for the projects
 * (the large majority) that never defined a field.
 */

export interface ComponentProps {
  modelId: ObjectID;
  modelType: DatabaseBaseModelType;
  customFieldType: DatabaseBaseModelType;
  /*
   * Singular and title-cased, the way the resource is named in the UI:
   * "Incident", "Status Page". Used for the Detail block's id, which has to
   * stay stable and distinct per resource.
   */
  resourceName: string;
  isEditable?: boolean | undefined;
}

const OverviewCustomFields: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  /*
   * Every overview page sits under a project route, so this is effectively
   * always set - but it is read from the URL/session rather than passed in,
   * and a card is not worth a crash if that lookup ever comes back empty.
   */
  if (!projectId) {
    return <></>;
  }

  return (
    <CustomFieldsDetail
      title="Custom Fields"
      description={`Custom fields for this ${props.resourceName.toLowerCase()}.`}
      modelType={props.modelType}
      customFieldType={props.customFieldType}
      name={`${props.resourceName} Custom Fields`}
      projectId={projectId}
      modelId={props.modelId}
      isEditable={props.isEditable}
      hideIfEmpty={true}
    />
  );
};

export default OverviewCustomFields;
