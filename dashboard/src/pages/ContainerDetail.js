import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ContainerSecurityDetail from '../components/security/ContainerSecurityDetail';

class ContainerDetail extends Component {
    render() {
        return (
            <Dashboard>
                <Fade>
                    <div className="Margin-vertical--12">
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <ContainerSecurityDetail />
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

ContainerDetail.displayName = 'ContainerDetail';

export default ContainerDetail;
