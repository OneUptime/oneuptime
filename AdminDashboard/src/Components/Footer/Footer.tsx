import React from 'react';
import Footer from 'CommonUI/src/Components/Footer/Footer';
import URL from 'Common/Types/API/URL';
import API from 'Common/Utils/API';
import { HOST, HTTP_PROTOCOL } from 'CommonUI/src/Config';
import { JSONObject } from 'Common/Types/JSON';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import Dictionary from 'Common/Types/Dictionary';
import HTTPResponse from 'Common/Types/API/HTTPResponse';

const DashboardFooter: () => JSX.Element = () => {
    const [showAboutModal, setShowAboutModal] = React.useState<boolean>(false);
    const [isAboutModalLoading, setIsAboutModalLoading] =
        React.useState<boolean>(false);
    const [versionText, setVersionText] = React.useState<Dictionary<string>>(
        {}
    );

    const fetchVersions: () => Promise<void> = async (): Promise<void> => {
        setIsAboutModalLoading(true);

        try {
            const verText: Dictionary<string> = {};
            const apps: Array<{
                name: string;
                path: string;
            }> = [
                {
                    name: 'API',
                    path: '/api',
                },
                {
                    name: 'Dashboard',
                    path: '/dashboard',
                },
                {
                    name: 'Notification',
                    path: '/notification',
                },
                {
                    name: 'Identity Service',
                    path: '/identity',
                },
            ];

            for (const app of apps) {
                const version: JSONObject = await fetchAppVersion(app.path);
                verText[
                    app.name
                ] = `${app.name}: ${version['version']} (${version['commit']})`;
            }

            setVersionText(verText);
        } catch (err) {
            setVersionText({
                error:
                    'Version data is not available: ' + (err as Error).message,
            });
        }

        setIsAboutModalLoading(false);
    };

    const fetchAppVersion: (appName: string) => Promise<JSONObject> = async (
        appName: string
    ): Promise<JSONObject> => {
        const response: HTTPResponse<JSONObject> = await API.get<JSONObject>(
            URL.fromString(`${HTTP_PROTOCOL}/${HOST}${appName}/version`)
        );

        if (response.data) {
            return response.data as JSONObject;
        }
        throw new BadDataException('Version data is not available');
    };

    return (
        <>
            <Footer
                className="bg-white h-16 inset-x-0 bottom-0 px-8"
                copyright="HackerBay, Inc."
                links={[
                    {
                        title: 'Help and Support',
                        to: URL.fromString('https://oneuptime.com/support'),
                    },
                    {
                        title: 'Legal',
                        to: URL.fromString('https://oneuptime.com/legal'),
                    },
                    {
                        title: 'Version',
                        onClick: async () => {
                            setShowAboutModal(true);
                            await fetchVersions();
                        },
                    },
                ]}
            />

            {showAboutModal ? (
                <ConfirmModal
                    title={`OneUptime Version`}
                    description={
                        <div>
                            {Object.keys(versionText).map(
                                (key: string, i: number) => {
                                    return (
                                        <div key={i}>{versionText[key]}</div>
                                    );
                                }
                            )}
                        </div>
                    }
                    isLoading={isAboutModalLoading}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setShowAboutModal(false);
                    }}
                />
            ) : (
                <></>
            )}
        </>
    );
};

export default DashboardFooter;
