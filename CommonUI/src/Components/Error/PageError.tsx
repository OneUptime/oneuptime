import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    message: string;
}

const PageError: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let message: string = props.message;

    if (props.message === 'Server Error') {
        message = 'Network Error: Please reload the page and try again.';
    }

    return (
        <div className="row text-center vertical-center">
            <p>{message}</p>
        </div>
    );
};

export default PageError;
