/*
 * The template a create wizard goes on with, at the top of its Name step:
 * its icon, its name and a line about it - what a workflow template shows
 * you once its builder opens, what a dashboard template shows. So the step
 * still says what was chosen, and Back is there to choose again. Create a
 * workflow and Create a dashboard both draw it. Nothing is drawn for Start
 * from scratch: there is nothing to say about an empty start.
 */

import React, { ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import { CATALOG_TEXT_ALIGN_CLASS_NAME } from "./CatalogText";

export interface ComponentProps {
  icon: IconProp;
  // Catalog content, shown as it is written.
  name: string;
  line: string;
  dataTestId?: string | undefined;
}

const ChosenTemplate: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-4"
      data-testid={props.dataTestId}
    >
      {/* A div: Icon draws a div of its own, which a span may not hold. */}
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100">
        <Icon
          icon={props.icon}
          size={SizeProp.Large}
          className="h-5 w-5 text-indigo-600"
        />
      </div>
      {/* Read the way they are written, on a Persian page too (CatalogText). */}
      <div className="min-w-0 flex-1">
        <p
          dir="auto"
          className={`text-sm font-semibold text-gray-900 ${CATALOG_TEXT_ALIGN_CLASS_NAME}`}
        >
          {props.name}
        </p>
        <p
          dir="auto"
          className={`mt-1 text-sm text-gray-600 ${CATALOG_TEXT_ALIGN_CLASS_NAME}`}
        >
          {props.line}
        </p>
      </div>
    </div>
  );
};

export default ChosenTemplate;
