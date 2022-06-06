import React, { FC, ReactElement, useEffect } from 'react';

type Props = {
    children: Array<ReactElement>;
    title: string;
};

const Container: FC<Props> = ({ children, title }: Props) => {
    useEffect(() => {
        document.title = `OneUptime | ${title}`;
    }, []);

    return <div>{children}</div>;
};

export default Container;
