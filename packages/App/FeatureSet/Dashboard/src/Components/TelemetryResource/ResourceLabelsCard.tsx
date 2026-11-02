import Label from "Common/Models/DatabaseModels/Label";
import Card from "Common/UI/Components/Card/Card";
import LabelsElement from "Common/UI/Components/Label/Labels";
import React, { FunctionComponent, ReactElement } from "react";

export const RESOURCE_LABELS_TEST_ID: string = "resource-overview-labels";

/*
 * A resource's labels, on a phone only, under its Overview's Details card.
 *
 * From 640px up the page's header lists them beside the page's title
 * (ModelPage, Page's labels), so a card of them there said them a second
 * time, as the Explore telemetry card repeated the side menu (#4980); on a
 * phone the header has no room for them, and this card is where they are.
 * Every resource Overview draws its labels so: the ones built on
 * ResourceOverview and the ones whose Details are their record's columns
 * (ResourceRecordDetailsCard).
 */
export interface ComponentProps {
  labels?: Array<Label> | undefined;
}

const ResourceLabelsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.labels || props.labels.length === 0) {
    return <></>;
  }

  return (
    <div data-testid={RESOURCE_LABELS_TEST_ID} className="mt-6 sm:hidden">
      <Card
        title="Labels"
        description="Labels attached to this resource (manual or via label rules)."
      >
        <div className="-mt-2">
          <LabelsElement labels={props.labels} />
        </div>
      </Card>
    </div>
  );
};

export default ResourceLabelsCard;
