import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    error: string;
    onRefreshClick?: undefined | (() => void);
}

const ErrorMessage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="text-center my-10 text-gray-500 text-sm">
            {props.error}
            {props.onRefreshClick ? (
                <div
                    role={'refresh-button'}
                    onClick={() => {
                        if (props.onRefreshClick) {
                            props.onRefreshClick();
                        }
                    }}
                    className="underline cursor-pointer hover:text-gray-700 mt-3"
                >
                    Refresh?
                </div>
            ) : (
                <></>
            )}
        </div>
    );
};

export default ErrorMessage;
