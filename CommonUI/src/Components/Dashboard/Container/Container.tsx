import React, { ReactElement, useEffect, FC } from 'react';
import './Container.scss';

export interface ComponentProps {
    title: string;
    sideBar?: ReactElement;
    children: ReactElement | Array<ReactElement>;
}

const Container: FC<ComponentProps> = ({
    title,
    children,
    sideBar,
}): ReactElement => {
    useEffect(() => {
        document.title = title;
    }, [title]);

    return (
        <div className="container">
            <main className="main">
                {sideBar && <div className="sidebar">{sideBar}</div>}
                <div className="main_layout">{children}</div>
            </main>
        </div>
    );
};

export default Container;
