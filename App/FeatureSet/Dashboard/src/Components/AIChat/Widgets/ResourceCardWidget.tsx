import { AIChatWidget } from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  widget: AIChatWidget;
}

const ResourceCardWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const fields: Array<{ label: string; value: string }> =
    props.widget.data.fields || [];

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500">
          <Icon icon={IconProp.CheckCircle} className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          {props.widget.data.resourceType && (
            <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
              {props.widget.data.resourceType}
            </div>
          )}
          <div className="truncate text-sm font-semibold text-gray-900">
            {props.widget.data.heading}
          </div>
          {props.widget.data.subheading && (
            <div className="mt-0.5 text-xs text-gray-500">
              {props.widget.data.subheading}
            </div>
          )}
          {fields.length > 0 && (
            <dl className="mt-2.5 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              {fields.map(
                (field: { label: string; value: string }, index: number) => {
                  return (
                    <React.Fragment key={index}>
                      <dt className="text-[11px] font-medium text-gray-400">
                        {field.label}
                      </dt>
                      <dd className="truncate text-[11px] text-gray-700">
                        {field.value}
                      </dd>
                    </React.Fragment>
                  );
                },
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResourceCardWidget;
