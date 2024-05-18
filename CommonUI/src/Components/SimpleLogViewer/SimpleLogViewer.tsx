import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | string | Array<ReactElement>;
}

const SimpleLogViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="text-gray-500 mt-5 text-sm h-96 overflow-y-auto overflow-x-hidden p-5 border-gray-50 border border-2 bg-gray-100 rounded">
            {props.children}
        </div>
    );
};

export default SimpleLogViewer;
