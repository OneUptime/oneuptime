import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import ApplicationSecurityDetail from '../components/security/ApplicationSecurityDetail';

class ApplicationDetail extends Component {
    render() {
        return (
            <Fade>
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <ApplicationSecurityDetail />
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ApplicationDetail.displayName = 'ApplicationDetail';

export default ApplicationDetail;
