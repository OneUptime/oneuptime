import React, { Component, ReactNode } from 'react';

export interface ComponentProps {
    children?: ReactNode;
}

interface ComponentState {
    hasError: boolean;
}

class ErrorBoundary extends Component<ComponentProps, ComponentState> {
    public constructor(props: ComponentProps) {
        super(props);
        this.state = { hasError: false };
    }

    public static getDerivedStateFromError(_: Error): ComponentState {
        return { hasError: true };
    }

    // TODO: log the error to an error reporting service
    // public componentDidCatch?(error: Error, errorInfo: ErrorInfo) {}

    public override render(): ReactNode {
        if (this.state.hasError) {
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
                        An unexpected error has occurred. Please reload the page
                        to continue
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
