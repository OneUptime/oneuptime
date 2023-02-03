import type Exception from 'Common/Types/Exception/Exception';
import type { FunctionComponent, ReactElement } from 'react';
import React, { useState } from 'react';

export interface ComponentProps {
    children: ReactElement;
}

const ErrorBoundary: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [error, setError] = useState<string | null>(null);

    try {
        if (!error) {
            return props.children;
        }
    } catch (e) {
        const exception: Exception = e as Exception;
        setError(exception.message);
    }

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
                An unexpected error has occured. Please reload the page to
                continue
            </div>
        </div>
    );
};

export default ErrorBoundary;
