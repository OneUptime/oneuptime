import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement } from 'react';
import URL from 'Common/Types/API/URL';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isLoading?: boolean | undefined;
    error?: string | undefined;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <MasterPage
            footer={<Footer />}
            header={<Header links={[
                {
                    title: 'Help and Support',
                    to: URL.fromString('https://oneuptime.com/support'),
                },
                {
                    title: 'Legal',
                    to: URL.fromString('https://oneuptime.com/legal'),
                },
                {
                    title: 'Powered by OneUptime',
                    to: URL.fromString('https://oneuptime.com'),
                    openInNewTab: true,
                },
            ]} />}
            navBar={<NavBar show={true} isPreview={true} />}
            isLoading={props.isLoading || false}
            error={props.error || ''}
            mainContentStyle={{
                display: 'flex',
                alignItems: 'center',
                margin: 'auto',
                maxWidth: '880px',
                marginLeft: 'auto !important',
            }}
        >
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
