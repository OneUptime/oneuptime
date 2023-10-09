import React, { FunctionComponent, ReactElement } from 'react';
import { ErrorBoundary as NativeErrorBoundary } from 'react-error-boundary';

export interface ComponentProps {
    children?: ReactElement;
}

const Fallback: FunctionComponent = () => {
    return (
        <div
            id="app-loading"
            style={{
                position: 'fixed',
                top: '0',
                bottom: '0',
                left: '0',
                right: '0',
                backgroundColor: '#fdfdfd',
                zIndex: '999',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <div>
                An unexpected error has occurred. Please reload the page to
                continue
            </div>
        </div>
    );
};

const ErrorBoundary: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    return (
        <NativeErrorBoundary FallbackComponent={Fallback}>
            {props.children}
        </NativeErrorBoundary>
    );
};

export default ErrorBoundary;
