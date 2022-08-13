import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    error: string;
    onRefreshClick?: undefined | (() => void);
}

const ErrorMessage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <p
            className="text-center color-light-grey"
            style={{
                marginTop: '50px',
                marginBottom: '50px',
            }}
        >
            {props.error} <br />{' '}
            {props.onRefreshClick ? (
                <span
                    onClick={() => {
                        if (props.onRefreshClick) {
                            props.onRefreshClick();
                        }
                    }}
                    className="underline primary-on-hover"
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
