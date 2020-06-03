import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import ContainerSecurityDetail from '../components/security/ContainerSecurityDetail';

class ContainerDetail extends Component {
    render() {
        return (
            <Dashboard>
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <ContainerSecurityDetail />
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

ContainerDetail.displayName = 'ContainerDetail';

export default ContainerDetail;
