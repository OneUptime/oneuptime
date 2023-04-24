import Link from 'Common/Types/Link';
import React, { FunctionComponent, ReactElement } from 'react';
import Logo from '../Logo/Logo';
import UILink from 'CommonUI/src/Components/Link/Link';
import File from 'Model/Models/File';
import Header from 'CommonUI/src/Components/Header/Header';

export interface ComponentProps {
    links: Array<Link>;
    logo?: File | undefined;
    onLogoClicked: () => void;
}

const StatusPageHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.logo && props.links.length === 0) {
        return <></>;
    }

    return (
        <div>
            {(props.logo || props.links?.length > 0) && (
                <Header
                    className="bg-transparent flex justify-between mt-5"
                    leftComponents={
                        <>
                            {props.logo && (
                                <div className="flex h-12 mt-2">
                                    <Logo
                                        file={props.logo}
                                        onClick={() => {
                                            props.onLogoClicked();
                                        }}
                                        style={{
                                            maxWidth: '200px',
                                            maxHeight: '50px',
                                        }}
                                    />
                                </div>
                            )}
                        </>
                    }
                    rightComponents={
                        <>
                            {props.links && props.links.length > 0 && (
                                <div key={'links'}>
                                    <div className="flex space-x-4 ">
                                        {props.links &&
                                            props.links.map(
                                                (link: Link, i: number) => {
                                                    return (
                                                        <div
                                                            key={i}
                                                            className="flex items-center "
                                                        >
                                                            <UILink
                                                                className="flex w-full flex-col items-center text-gray-400 hover:text-gray-600 font-medium font-mono"
                                                                to={link.to}
                                                                openInNewTab={
                                                                    link.openInNewTab
                                                                }
                                                            >
                                                                {link.title}
                                                            </UILink>
                                                        </div>
                                                    );
                                                }
                                            )}
                                    </div>
                                </div>
                            )}
                        </>
                    }
                />
            )}
        </div>
    );
};

export default StatusPageHeader;
