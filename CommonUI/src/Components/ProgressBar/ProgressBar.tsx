import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    count: number;
    totalCount: number;
}

const ProgressBar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    let percent = 0;

    try {
        percent = props.count * 100 / props.totalCount;
    } catch (err) {
        // do nothing. 
    }

    if (percent > 100) {
        percent = 100;
    }

    return (
        <div className="w-full h-4 mb-4 bg-gray-200 rounded-full dark:bg-gray-700">
            <div className="h-4 bg-blue-600 rounded-full dark:bg-blue-500" style={{ "width": percent + "%" }}></div>
        </div>
    );
};

export default ProgressBar;
