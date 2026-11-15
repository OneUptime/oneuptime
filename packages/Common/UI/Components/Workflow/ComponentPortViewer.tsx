import ComponentMetadata, { Port } from "../../../Types/Workflow/Component";
import { isOutPortFromSettings } from "../../../Types/Workflow/ComponentOutPorts";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export interface ComponentProps {
  ports: Array<Port>;
  name: string;
  description: string;
  /*
   * The step whose outputs these are. Its own outputs - Success, Error,
   * Yes, No - read in the reader's words, as the canvas and the run log
   * draw them; a Switch / Case's cases keep the names the person gave them
   * (isOutPortFromSettings). Left out (a step's inputs), every port is the
   * step's own.
   */
  metadata?: ComponentMetadata | undefined;
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
  const translator: Translator = useTranslator();
  return (
    <div>
      {props.name && (
        <h2 className="text-sm font-semibold text-gray-600">{props.name}</h2>
      )}
      {props.description && (
        <p className="mb-2 text-xs text-gray-500">{props.description}</p>
      )}
      {props.ports && props.ports.length === 0 && (
        <p className="text-xs italic text-gray-500">
          {translator.translateText("No connections.")}
        </p>
      )}
      {props.ports && props.ports.length > 0 && (
        <ul className="space-y-2">
          {props.ports.map((port: Port, i: number) => {
            const isNamedByThePerson: boolean = isOutPortFromSettings({
              metadata: props.metadata,
              portId: port.id,
            });
            const title: string = isNamedByThePerson
              ? port.title
              : translator.translateText(port.title) || port.title;
            const description: string | undefined =
              isNamedByThePerson || !port.description
                ? port.description
                : translator.translateText(port.description) ||
                  port.description;

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
                  <p
                    className="text-sm font-medium text-gray-900"
                    data-testid="workflow-port-title"
                  >
                    {title}
                  </p>
                  {description && (
                    <p className="text-xs text-gray-500">{description}</p>
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
