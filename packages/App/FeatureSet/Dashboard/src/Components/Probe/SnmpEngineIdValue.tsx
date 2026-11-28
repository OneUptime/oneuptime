import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  engineId: string;
  dataTestId?: string | undefined;
}

/*
 * An SNMPv3 engine ID, as a device's configuration takes it - hex, drawn
 * as code, broken anywhere a narrow screen needs it - with a button to copy
 * it: a probe's, which a device sending it informs is given, or a device's
 * own (OneUptime issues #11005, #11172, #11173). Read left to right on a
 * page read from the right too, as code always is.
 */
const SnmpEngineIdValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <code
        dir="ltr"
        className="break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono text-sm text-gray-900"
        data-testid={props.dataTestId || "snmp-engine-id"}
      >
        {props.engineId}
      </code>
      <CopyTextButton
        textToBeCopied={props.engineId}
        size="xs"
        variant="ghost"
      />
    </span>
  );
};

export default SnmpEngineIdValue;
