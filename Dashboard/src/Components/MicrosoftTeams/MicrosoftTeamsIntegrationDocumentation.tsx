import React, { FunctionComponent, ReactElement } from 'react';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import Link from 'CommonUI/src/Components/Link/Link';
import URL from 'Common/Types/API/URL';

const MicrosoftTeamsIntegrationDocumentation: FunctionComponent = (): ReactElement => {
    return (
        <div className="mt-5">
            <Alert
                type={AlertType.INFO}
                strongTitle="Microsoft Teams Integration Not Configured"
                title="The Microsoft Teams integration feature has not been configured by your OneUptime administrator."
                description={
                    <span>
                        To use this feature, an administrator needs to set up the Microsoft Teams App Client ID in the OneUptime environment configuration. 
                        Please contact your administrator for assistance. If you are an administrator, please refer to the 
                        <Link
                            openInNewTab={true}
                            to={URL.fromString('https://oneuptime.com/docs/integrations/msteams-config')} // Placeholder URL
                            className="ml-1 underline"
                        >
                            OneUptime Microsoft Teams Integration Documentation
                        </Link> for setup instructions.
                    </span>
                }
            />
        </div>
    );
};

export default MicrosoftTeamsIntegrationDocumentation;
