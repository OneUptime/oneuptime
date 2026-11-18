import BiLineageDialog from "./BiLineageDialog";
import { getBiLineageReason } from "./BiLineageWords";
import { DataLineageMapBiTool } from "Common/Types/DataObservability/DataLineageMap";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WHAT THE LINEAGE MAP CANNOT DRAW ON TABLES, AND WHY (#9507).
 *
 * A BI tool whose dashboards were read but are on no watched table - Power
 * BI's tenant settings off, its databases not connected - is told of on
 * the map, one line a tool: how many of its dashboards, the first reason,
 * and See Why for the steps that fix it (BiLineageDialog). On an empty
 * map it is the first thing said; on a drawn one, a line above it.
 */

const OFF_TABLES: PluralTemplate = {
  one: "{{count}} dashboard of {{name}} is built on no table OneUptime watches.",
  other:
    "{{count}} dashboards of {{name}} are built on no table OneUptime watches.",
};

export interface ComponentProps {
  tools: Array<DataLineageMapBiTool>;
  className?: string | undefined;
}

const BiLineageNotes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [explained, setExplained] = useState<DataLineageMapBiTool | null>(null);

  if (props.tools.length === 0) {
    return <></>;
  }

  return (
    <div
      className={props.className || "space-y-1.5"}
      data-testid="bi-lineage-notes"
    >
      {props.tools.map((tool: DataLineageMapBiTool): ReactElement => {
        const reason: string | null = getBiLineageReason(
          translator,
          tool.summary,
        );

        return (
          <p
            key={tool.dataBiConnectionId}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
            data-testid="bi-lineage-note"
          >
            <span>
              {translator.translatePlural(OFF_TABLES, tool.dashboardCount, {
                name: tool.name,
              })}
            </span>
            {reason ? <span className="text-yellow-700">{reason}</span> : <></>}
            <Button
              title="See Why"
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.ExtraSmall}
              className="font-medium"
              dataTestId="bi-lineage-note-why"
              onClick={(): void => {
                setExplained(tool);
              }}
            />
          </p>
        );
      })}
      {explained ? (
        <BiLineageDialog
          name={explained.name}
          summary={explained.summary}
          onClose={(): void => {
            setExplained(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default BiLineageNotes;
