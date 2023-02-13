import React, { FunctionComponent, ReactElement } from 'react';
import { Port } from 'Common/Types/Workflow/Component';
import ErrorMessage from '../ErrorMessage/ErrorMessage';

export interface ComponentProps {
    ports: Array<Port>;
    name: string;
    description: string;
}

const ComponentPortViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-5 mb-5">
            <h2 className="text-base font-medium text-gray-500">
                {props.name}
            </h2>
            <p className="text-sm font-medium text-gray-400">
                {props.description}
            </p>
            {props.ports && props.ports.length === 0 && (
                <ErrorMessage
                    error={'This component does not have any ports.'}
                />
            )}
            <div className="mt-3">
                {props.ports &&
                    props.ports.length > 0 &&
                    props.ports.map((port: Port, i: number) => {
                        return (
                            <div key={i} className="mt-2 mb-2 relative flex items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus-within:ring-2 focus-within:ring-pink-500 focus-within:ring-offset-2">
                                <div className="min-w-0 flex-1">
                                    <div className="focus:outline-none">
                                        <span
                                            className="absolute inset-0"
                                            aria-hidden="true"
                                        ></span>
                                        <p className="text-sm font-medium text-gray-900">
                                            {port.title}{' '}
                                            <span className="text-gray-500 font-normal">
                                                (ID: {port.id})
                                            </span>
                                        </p>
                                        <p className="truncate text-sm text-gray-500">
                                            {port.description}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
            </div>
        </div>
    );
};

export default ComponentPortViewer;
