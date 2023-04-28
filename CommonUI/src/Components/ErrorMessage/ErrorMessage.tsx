import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    error: string;
    onRefreshClick?: undefined | (() => void);
}

const ErrorMessage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <p className="text-center my-10 text-gray-500 text-sm">
            {props.error} <br />{' '}
            {props.onRefreshClick ? (
                <span
                    role={'button'}
                    onClick={() => {
                        if (props.onRefreshClick) {
                            props.onRefreshClick();
                        }
                    }}
                    className="underline cursor-pointer hover:text-gray-700"
                >
                    Refresh?
                </span>
            ) : (
                <></>
            )}
        </p>
    );
};

export default ErrorMessage;
