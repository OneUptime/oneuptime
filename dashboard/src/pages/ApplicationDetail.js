import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import ApplicationSecurityDetail from '../components/security/ApplicationSecurityDetail';

class ApplicationDetail extends Component {
    render() {
        return (
            <Dashboard>
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <ApplicationSecurityDetail />
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

ApplicationDetail.displayName = 'ApplicationDetail';

export default ApplicationDetail;
