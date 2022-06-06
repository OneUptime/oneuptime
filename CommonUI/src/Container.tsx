import React, { ReactElement, useEffect } from 'react';

type Props = {
    children: Array<ReactElement>;
    title: string;
};

const Container: FunctionComponent<Props> = ({ children, title }: Props) => {
    useEffect(() => {
        document.title = `OneUptime | ${title}`;
    }, []);

    return <div>{children}</div>;
};

export default Container;
