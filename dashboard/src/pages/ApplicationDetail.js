import React, { Component } from 'react';
import Zoom from 'react-reveal/Zoom';
import Dashboard from '../components/Dashboard';
import ApplicationSecurityDetail from '../components/security/ApplicationSecurityDetail';

class ApplicationDetail extends Component {
    render() {
        return (
            <Dashboard>
                <Zoom>
                    <div className="Margin-vertical--12">
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <ApplicationSecurityDetail />
                                </div>
                            </div>
                        </div>
                    </div>
                </Zoom>
            </Dashboard>
        );
    }
}

ApplicationDetail.displayName = 'ApplicationDetail';

export default ApplicationDetail;
