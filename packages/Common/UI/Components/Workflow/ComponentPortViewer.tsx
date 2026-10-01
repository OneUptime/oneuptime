import { Port } from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  ports: Array<Port>;
  name: string;
  description: string;
}

/*
 * A plain list: a port is a name and a sentence, and boxing each one made a
 * two-port step look as heavy as a form. The port's internal id ("out",
 * "success") is not shown. The canvas labels ports by their titles, so the id
 * only repeated the title in lower case.
 */
const ComponentPortViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      {props.name && (
        <h2 className="text-sm font-semibold text-gray-600">{props.name}</h2>
      )}
      {props.description && (
        <p className="mb-2 text-xs text-gray-500">{props.description}</p>
      )}
      {props.ports && props.ports.length === 0 && (
        <p className="text-xs italic text-gray-500">No connections.</p>
      )}
      {props.ports && props.ports.length > 0 && (
        <ul className="space-y-2">
          {props.ports.map((port: Port, i: number) => {
            return (
              <li
                key={port.id || i}
                className="flex items-start gap-2.5"
                data-testid="workflow-port"
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-300"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {port.title}
                  </p>
                  {port.description && (
                    <p className="text-xs text-gray-500">{port.description}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ComponentPortViewer;
