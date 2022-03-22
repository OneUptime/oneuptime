import React, { Component } from 'react';

import { Fade } from 'react-awesome-reveal';
import ContainerSecurityDetail from '../components/security/ContainerSecurityDetail';

class ContainerDetail extends Component {
    render() {
        return (
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
        );
    }
}


ContainerDetail.displayName = 'ContainerDetail';

export default ContainerDetail;
