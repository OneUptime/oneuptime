import SummarysScreenshot from "./Screenshot";
import Screenshots, {
  Screenshot,
} from "Common/Types/Monitor/SyntheticMonitors/Screenshot";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  screenshots: Screenshots | undefined;
}

const SummaryScreenshotGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <div className="mt-2 mb-2">Screenshots:</div>
      <div className="space-y-5">
        {!props.screenshots || Object.keys(props.screenshots).length === 0 ? (
          <ErrorMessage error="No screenshots available." />
        ) : (
          Object.keys(props.screenshots)?.map(
            (screenshotName: string, index: number) => {
              if (!props.screenshots || !props.screenshots[screenshotName]) {
                return <></>;
              }

              return (
                <SummarysScreenshot
                  key={index}
                  screenshot={props.screenshots[screenshotName] as Screenshot}
                  screenshotName={screenshotName}
                />
              );
            },
          )
        )}
      </div>
    </div>
  );
};

export default SummaryScreenshotGroup;
