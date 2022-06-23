import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    title: string;
}

const Component: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div>{props.title}</div>;
};

export default Component;
