import React, { FunctionComponent, ReactElement } from 'react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';

export interface ComponentProps {
    text: string;
    children: ReactElement;
}

const Tooltip: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <Tippy key={Math.random()} content={<span>{props.text}</span>}>{props.children}</Tippy>;
};

export default Tooltip;
