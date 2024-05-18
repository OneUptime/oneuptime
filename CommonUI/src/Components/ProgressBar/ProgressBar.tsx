import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export enum ProgressBarSize {
    Small = 'small',
    Medium = 'medium',
    Large = 'large'
}

export interface ComponentProps {
    count: number;
    totalCount: number;
    suffix: string;
    size?: ProgressBarSize;
}

const ProgressBar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [percent, setPercent] = useState<number>(0);

    useEffect(() => {
        let percent: number = 0;

        try {
            percent = (props.count * 100) / props.totalCount;
        } catch (err) {
            // do nothing.
        }

        if (percent > 100) {
            percent = 100;
        }

        setPercent(Math.ceil(percent));
    }, [props.count, props.totalCount]);

    let progressBarSize = 'h-4';

    if (props.size === ProgressBarSize.Small) {
        progressBarSize = 'h-2';
    } else if (props.size === ProgressBarSize.Large) {
        progressBarSize = 'h-6';
    }

    return (
        <div className={`w-full ${progressBarSize} mb-4 bg-gray-200 rounded-full`}>
            <div
                data-testid="progress-bar"
                className={`${progressBarSize} bg-indigo-600 rounded-full `}
                style={{ width: percent + '%' }}
            ></div>
            <div className="text-sm text-gray-400 mt-1 flex justify-between">
                <div data-testid="progress-bar-count">
                    {props.count} {props.suffix}
                </div>
                <div data-testid="progress-bar-total-count">
                    {props.totalCount} {props.suffix}
                </div>
            </div>
        </div>
    );
};

export default ProgressBar;
