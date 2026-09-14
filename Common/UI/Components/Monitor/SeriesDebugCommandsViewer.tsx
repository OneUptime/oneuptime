import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SeriesDebugHints, {
  SeriesDebugCommand,
} from "../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import CopyTextButton from "../CopyTextButton/CopyTextButton";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorType?: MonitorType | undefined;
  seriesLabels?: JSONObject | undefined;
}

/**
 * The read-only commands worth running first, already filled in with the
 * pod / container / node / mount this alert is actually about.
 *
 * The commands come from `SeriesDebugHints`, which is the same source the
 * alert DESCRIPTION uses - so what the engineer reads in Slack and what
 * they see on this page are the same commands, and only one of them has
 * to be kept correct.
 *
 * Renders nothing when the series carries nothing addressable (an
 * ungrouped monitor, or a monitor type with no universally-safe
 * inspection command), rather than showing an empty card.
 */
const SeriesDebugCommandsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const commands: Array<SeriesDebugCommand> = SeriesDebugHints.getDebugCommands(
    {
      monitorType: props.monitorType,
      seriesLabels: props.seriesLabels,
    },
  );

  if (commands.length === 0) {
    return <Fragment />;
  }

  return (
    <div className="space-y-3">
      {commands.map((command: SeriesDebugCommand, index: number) => {
        return (
          <div key={index}>
            <div className="text-sm text-gray-500 mb-1">{command.purpose}</div>
            <div className="flex items-center justify-between gap-2 rounded-md bg-gray-900 px-3 py-2">
              <code className="font-mono text-xs text-gray-100 overflow-x-auto whitespace-pre">
                {command.command}
              </code>
              <CopyTextButton
                textToBeCopied={command.command}
                iconOnly={true}
                title="Copy command"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SeriesDebugCommandsViewer;
