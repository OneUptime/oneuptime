import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The way forward, such as "Add a device".
  footer?: ReactElement | undefined;
}

/*
 * What a device map says when there is nothing on it: the graph's own empty
 * state, and the whole of the map's card when the network has no device at
 * all (NetworkTopologyLiveView).
 */
const NetworkTopologyEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="flex items-center justify-center py-16 px-6"
      data-testid="network-topology-empty-state"
    >
      <div className="text-center max-w-md">
        <div className="text-sm font-medium text-gray-900">
          {translator.translateText("No network topology discovered yet.")}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {translator.translateText(
            "Add your devices and they appear here. Devices read over SNMP are linked to the neighbours they report.",
          )}
        </p>
        {props.footer ? <p className="mt-3">{props.footer}</p> : <></>}
      </div>
    </div>
  );
};

export default NetworkTopologyEmptyState;
