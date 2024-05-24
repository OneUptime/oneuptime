import Screenshots, {
    Screenshot,
} from 'Common/Types/Monitor/SyntheticMonitors/Screenshot';
import React, { FunctionComponent, ReactElement } from 'react';
import SummarysScreenshot from './Screenshot';

export interface ComponentProps {
    screenshots: Screenshots | undefined;
}

const SummaryScreenshotGroup: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <div>
                {!props.screenshots ||
                Object.keys(props.screenshots).length === 0
                    ? 'No screenshots available'
                    : Object.keys(props.screenshots)?.map(
                          (screenshotName: string, index: number) => {
                              if (
                                  !props.screenshots ||
                                  !props.screenshots[screenshotName]
                              ) {
                                  return <></>;
                              }

                              return (
                                  <SummarysScreenshot
                                      key={index}
                                      screenshot={
                                          props.screenshots[
                                              screenshotName
                                          ] as Screenshot
                                      }
                                      screenshotName={screenshotName}
                                  />
                              );
                          }
                      )}
            </div>
        </div>
    );
};

export default SummaryScreenshotGroup;
