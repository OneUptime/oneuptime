import React, { Component } from 'react';

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


ApplicationDetail.displayName = 'ApplicationDetail';

export default ApplicationDetail;
