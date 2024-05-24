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
        <div className="w-fit">
            <div className="">
                <img
                    className="rounded-md w-fit h-fit shadow-md m-1"
                    src={`data:image/png;base64,${props.screenshot}`}
                    alt={props.screenshotName}
                />
            </div>
            <div className="text-gray-500 m-1 w-full flex justify-center">
                {props.screenshotName}
            </div>
        </div>
    );
};

export default SummarysScreenshot;
