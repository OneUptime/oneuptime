import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    className?: string | undefined;
}

const HorizontalRule: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div className={`border-b border-gray-900/10 mb-8 mt-8 ${props.className}`}></div>;
};

export default HorizontalRule;
