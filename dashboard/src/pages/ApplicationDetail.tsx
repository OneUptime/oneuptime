import React, { Component } from 'react';

import { Fade } from 'react-awesome-reveal';
import ApplicationSecurityDetail from '../components/security/ApplicationSecurityDetail';

class ApplicationDetail extends Component<ComponentProps> {

    public static propTypes = {};

    override render() {
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
            </Fade >
        );
    }
}


ApplicationDetail.displayName = 'ApplicationDetail';

export default ApplicationDetail;
