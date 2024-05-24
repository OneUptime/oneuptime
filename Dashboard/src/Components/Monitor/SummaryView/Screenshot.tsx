import { Screenshot } from 'Common/Types/Monitor/SyntheticMonitors/Screenshot';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    screenshot: Screenshot;
    screenshotName: string;
}

const SummarysScreenshot: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    /// props.scresnshot is in base64 format
    return (
        <div>
            <div>{props.screenshotName}</div>
            <div>
                <img
                    src={`data:image/png;base64,${props.screenshot}`}
                    alt={props.screenshotName}
                />
            </div>
        </div>
    );
};

export default SummarysScreenshot;
