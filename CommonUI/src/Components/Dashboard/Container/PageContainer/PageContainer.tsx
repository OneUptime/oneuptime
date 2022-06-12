import React, { ReactElement, useEffect, FunctionComponent } from 'react';
import './PageContainer.scss';

export interface ComponentProps {
    title?: string;
    sideBar?: ReactElement;
    children: ReactElement | Array<ReactElement>;
}

const PageContainer: FunctionComponent<ComponentProps> = ({
    title = 'OneUptime',
    children,
    sideBar,
}: ComponentProps): ReactElement => {
    useEffect(() => {
        document.title = title;
    }, [title]);

    return (
        <div className="container">
            <main className="main">
                {sideBar && <div className="sidebar">{sideBar}</div>}
                <div className="mainLayout">{children}</div>
            </main>
        </div>
    );
};

export default PageContainer;
