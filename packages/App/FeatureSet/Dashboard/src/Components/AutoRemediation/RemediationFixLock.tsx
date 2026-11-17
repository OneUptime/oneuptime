import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A press the reader may not make on the Remediation step, in its place: a
 * lock, and why - quiet, as the line where a fix's Approve & Run would be
 * (RemediationStep). `reason` is already in the reader's language
 * (PermissionGate words it, the private record's reason with it).
 */
export interface ComponentProps {
  reason: string;
  testId: string;
}

const RemediationFixLock: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      data-testid={props.testId}
      className="flex items-start gap-1.5 text-xs leading-5 text-gray-500"
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
      />
      <span data-testid={`${props.testId}-words`} className="min-w-0">
        {props.reason}
      </span>
    </div>
  );
};

export default RemediationFixLock;
