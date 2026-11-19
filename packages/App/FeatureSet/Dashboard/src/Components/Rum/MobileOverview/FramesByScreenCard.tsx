import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getLineDirection } from "Common/UI/Utils/LineDirection";
import { APP_SCREEN_NAME_ATTRIBUTE } from "Common/Types/Rum/MobileAppTelemetry";
import { MobileFrames, ScreenFrames } from "./MobileRumSignalData";

/*
 * A mobile app's slow and frozen frames per screen, the screens that froze
 * most first (#9588): where the app-wide count says "frames freeze", this
 * says on which screen. The screen is the one on view when OpenTelemetry
 * Android sent the app.jank event (its app.screen.name). It is the mobile
 * Overview's counterpart of a browser app's INP by route.
 */

export interface FramesByScreenCardProps {
  frames: MobileFrames | null;
  loading: boolean;
  // What the card shows, in an (i) beside its title.
  description?: string | undefined;
}

const FramesByScreenCard: FunctionComponent<FramesByScreenCardProps> = (
  props: FramesByScreenCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string =
    translator.translateText("Frozen frames by screen") ||
    "Frozen frames by screen";
  const screens: Array<ScreenFrames> = props.frames?.byScreen || [];

  // A screen's name gives way as a person sizes it; its counts never do.
  const screenColumns: ResizableColumns = useResizableColumns({
    tableKey: "rum-frames-by-screen-table",
    columns: [
      { id: "screen", cellNumber: 1 },
      { id: "frozen", cellNumber: 2 },
      { id: "slow", cellNumber: 3 },
    ],
  });

  const body: () => ReactElement = (): ReactElement => {
    if (props.loading && !props.frames) {
      return <TableSkeleton rows={3} columns={3} />;
    }

    if (props.frames?.byScreenFailed) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          {translator.translateText("Could not load the frames by screen.")}
        </div>
      );
    }

    if (screens.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <div className="text-sm font-medium text-gray-700">
            {translator.translateText(
              "Frames are reported, but not per screen",
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            <TranslatedSentence
              template="OpenTelemetry Android names the screen on view in {{attribute}}. Another SDK needs to set it on its app.jank events."
              slots={{ attribute: <code>{APP_SCREEN_NAME_ATTRIBUTE}</code> }}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        {screenColumns.styles}
        <table
          className={`${screenColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
          {...screenColumns.tableAttributes}
        >
          <thead>
            <tr>
              <ResizableHeaderCell
                className="py-2 pe-4 text-start text-xs font-medium uppercase tracking-wider text-gray-500"
                resize={screenColumns.getResize(
                  "screen",
                  translator.translateText("Screen") || "Screen",
                  ColumnWidthKind.Name,
                )}
              >
                <span>
                  {translator.translateText("Screen")}
                  <span className="ms-1 font-mono normal-case tracking-normal text-gray-500">
                    ({APP_SCREEN_NAME_ATTRIBUTE})
                  </span>
                </span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="py-2 pe-4 text-end text-xs font-medium uppercase tracking-wider text-gray-500"
                resize={screenColumns.getResize(
                  "frozen",
                  translator.translateText("Frozen frames") || "Frozen frames",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Frozen frames")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="py-2 text-end text-xs font-medium uppercase tracking-wider text-gray-500"
                resize={screenColumns.getResize(
                  "slow",
                  translator.translateText("Slow frames") || "Slow frames",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Slow frames")}</span>
              </ResizableHeaderCell>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {screens.map((screen: ScreenFrames): ReactElement => {
              return (
                <tr key={screen.screen} data-testid="rum-frames-by-screen-row">
                  {/*
                   * A screen's name reads from the left on a page read from
                   * the right too ("ProductDetailFragment"), and keeps the
                   * page's sides, so the columns line up under their names.
                   */}
                  <td className="max-w-md truncate py-2 pe-4 font-mono text-xs text-gray-700">
                    <span
                      dir={getLineDirection(screen.screen, translator.language)}
                    >
                      {screen.screen}
                    </span>
                  </td>
                  <td
                    className={`whitespace-nowrap py-2 pe-4 text-end font-semibold ${
                      screen.frozen > 0 ? "text-rose-600" : "text-gray-700"
                    }`}
                  >
                    {translator.formatNumber(screen.frozen)}
                  </td>
                  <td className="whitespace-nowrap py-2 text-end text-gray-700">
                    {translator.formatNumber(screen.slow)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="mt-6" data-testid="rum-frames-by-screen">
      <Card
        title={
          props.description ? (
            <span className="inline-flex items-center gap-1.5">
              {title}
              <InfoTooltip
                label={title}
                text={props.description}
                iconClassName="h-4 w-4"
              />
            </span>
          ) : (
            title
          )
        }
        description="The screens whose frames froze or drew slowly most often in the selected range."
      >
        <div className="-mt-2">{body()}</div>
      </Card>
    </div>
  );
};

export default FramesByScreenCard;
