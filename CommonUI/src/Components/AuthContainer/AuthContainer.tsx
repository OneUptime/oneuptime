import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';

export interface ComponentProps {
    title: string;
}

const AuthContainer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div>{props.title}</div>;
};

export default AuthContainer;
