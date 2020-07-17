import React, { Component } from 'react';
import Zoom from 'react-reveal/Zoom';
import Dashboard from '../components/Dashboard';
import ContainerSecurityDetail from '../components/security/ContainerSecurityDetail';

class ContainerDetail extends Component {
    render() {
        return (
            <Dashboard>
                <Zoom>
                    <div className="Margin-vertical--12">
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <ContainerSecurityDetail />
                                </div>
                            </div>
                        </div>
                    </div>
                </Zoom>
            </Dashboard>
        );
    }
}

ContainerDetail.displayName = 'ContainerDetail';

export default ContainerDetail;
