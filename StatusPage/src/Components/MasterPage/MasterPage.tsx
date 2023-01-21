import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import Banner from '../Banner/Banner';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import URL from 'Common/Types/API/URL';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import BaseAPI from 'CommonUI/src/Utils/API/API';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import useAsyncEffect from 'use-async-effect';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import RouteParams from '../../Utils/RouteParams';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import BaseModel from 'Common/Models/BaseModel';
import File from 'Model/Models/File';
import { ImageFunctions } from 'CommonUI/src/Components/Image/Image';
import HTTPResponse from 'Common/Types/API/HTTPResponse';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isLoading?: boolean | undefined;
    error?: string | undefined;
    onLoadComplete: (masterPage: JSONObject) => void;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [masterPageData, setMasterPageData] = useState<JSONObject | null>(
        null
    );

    const [headerHtml, setHeaderHtml] = useState<null | string>(null);
    const [footerHtml, setFooterHTML] = useState<null | string>(null);

    const getId: Function = async (): Promise<ObjectID> => {
        const id: string | null = Navigation.getParamByName(
            RouteParams.StatusPageId,
            RouteMap[PageMap.PREVIEW_OVERVIEW]!
        );
        if (id) {
            return new ObjectID(id);
        }
        // get status page id by hostname.
        const response: HTTPResponse<JSONObject> =
            await BaseAPI.post<JSONObject>(
                URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                    `/status-page/domain`
                ),
                {
                    domain: Navigation.getHostname().toString(),
                },
                {}
            );

        if (response.data && response.data['statusPageId']) {
            return new ObjectID(response.data['statusPageId'] as string);
        }

        throw new BadDataException('Status Page ID not found');
    };

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);
            const id: ObjectID = await getId();

            LocalStorage.setItem('statusPageId', id);
            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/status-page/master-page/${id.toString()}`
                    ),
                    {},
                    {}
                );
            setMasterPageData(response.data);

            // setfavicon.
            const favIcon: File | null = JSONFunctions.getJSONValueInPath(
                response.data || {},
                'statusPage.faviconFile'
            ) as File | null;
            if (favIcon && favIcon.file) {
                const link: any = document.createElement('link');
                link.rel = 'icon';
                (document as any)
                    .getElementsByTagName('head')[0]
                    .appendChild(link);
                link.href = ImageFunctions.getImageURL(favIcon);
            }

            // setcss.
            const css: string | null = JSONFunctions.getJSONValueInPath(
                response.data || {},
                'statusPage.customCSS'
            ) as string | null;

            if (css) {
                const style: any = document.createElement('style');
                style.innerText = css;
                (document as any)
                    .getElementsByTagName('head')[0]
                    .appendChild(style);
            }

            const headHtml: string | null = JSONFunctions.getJSONValueInPath(
                response.data || {},
                'statusPage.headerHTML'
            ) as string | null;
            const footHTML: string | null = JSONFunctions.getJSONValueInPath(
                response.data || {},
                'statusPage.footerHTML'
            ) as string | null;

            if (headHtml) {
                setHeaderHtml(headHtml);
            }

            if (footHTML) {
                setFooterHTML(footHTML);
            }

            props.onLoadComplete(response.data);
            setIsLoading(false);
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                    'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
            setIsLoading(false);
        }
    }, []);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    if (
        Navigation.getCurrentRoute().toString().includes('login') ||
        Navigation.getCurrentRoute().toString().includes('forgot-password') ||
        Navigation.getCurrentRoute().toString().includes('reset-password')
    ) {
        return <>{props.children}</>;
    }

    const logo = (JSONFunctions.getJSONValueInPath(
        masterPageData || {},
        'statusPage.logoFile'
    ) as BaseModel) || undefined;

    const links = (
        (JSONFunctions.getJSONValueInPath(
            masterPageData || {},
            'headerLinks'
        ) as Array<JSONObject>) || []
    ).map((link: JSONObject) => {
        return {
            title: link['title'] as string,
            to: link['link'] as URL,
            openInNewTab: true,
        };
    })



    return (
        <div className='max-w-4xl m-auto'>
            {<div><Banner file={
                (JSONFunctions.getJSONValueInPath(
                    masterPageData || {},
                    'statusPage.coverImageFile'
                ) as BaseModel) || undefined
            } /></div>}
            <MasterPage
                className=" m-auto"
                topSectionClassName='shadow p-1 bg-white rounded mb-5 flex justify-center'
                hideHeader={!logo && links.length === 0}
                footer={
                    !footerHtml ? (
                        <Footer
                            className='fixed max-w-4xl flex m-auto inset-x-0 bottom-0'
                            copyright={
                                (JSONFunctions.getJSONValueInPath(
                                    masterPageData || {},
                                    'statusPage.copyrightText'
                                ) as string) || ''
                            }
                            links={(
                                (JSONFunctions.getJSONValueInPath(
                                    masterPageData || {},
                                    'footerLinks'
                                ) as Array<JSONObject>) || []
                            ).map((link: JSONObject) => {
                                return {
                                    title: link['title'] as string,
                                    to: link['link'] as URL,
                                    openInNewTab: true,
                                };
                            })}
                        />
                    ) : (
                        <div
                            dangerouslySetInnerHTML={{
                                __html: footerHtml as string,
                            }}
                        />
                    )
                }
                header={
                    !headerHtml ? (
                        <Header
                            logo={
                                logo
                            }
                            links={links}
                        />
                    ) : (
                        <div
                            dangerouslySetInnerHTML={{
                                __html: headerHtml as string,
                            }}
                        />
                    )
                }
                navBar={<NavBar show={true} isPreview={true} />}
                isLoading={props.isLoading || false}
                error={props.error || ''}
            >
                {props.children}
            </MasterPage>
        </div>

    );
};

export default DashboardMasterPage;
