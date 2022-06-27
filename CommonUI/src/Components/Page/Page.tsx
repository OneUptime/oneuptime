import Link from 'Common/Types/Link';
import React, { FunctionComponent, ReactElement } from 'react';
import Breadcrumbs from '../Breadcrumbs/Breadcrumbs';

export interface ComponentProps {
    title: string;
    breadcrumbLinks: Array<Link>;
    children: Array<ReactElement> | ReactElement;
    sideMenu?: undefined | ReactElement;
}

const Page: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    console.log('props.breadcrumbLinks', props.breadcrumbLinks);
    return (
        <div className="page-content">
            <div className="container-fluid">
                <div className="row">
                    <div className="col-12">
                        <div className="page-title-box d-sm-flex align-items-center justify-content-between">
                            <h4 className="mb-0 font-size-18">{props.title}</h4>
                            <Breadcrumbs links={props.breadcrumbLinks} />
                        </div>
                    </div>
                </div>
                {props.sideMenu && (
                    <div className="row">
                        <div className="col-12">
                            {props.sideMenu}
                            <div className="email-rightbar mb-3">
                                {props.children}
                            </div>
                        </div>
                    </div>
                )}
                {!props.sideMenu && props.children}
            </div>
        </div>
    );
};

export default Page;
