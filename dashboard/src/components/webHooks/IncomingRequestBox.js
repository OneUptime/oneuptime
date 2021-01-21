import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
// import RenderIfAdmin from '../basic/RenderIfAdmin';
import IncomingRequestButton from './IncomingRequestButton';
import IncomingRequestList from './IncomingRequestList';

class IncomingRequestBox extends Component {
    render() {
        return (
            <div className="Box-root Margin-vertical--12">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            {/* <div className="Box-root"> */}
                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Incoming HTTP Request
                                                Integration
                                            </span>
                                        </span>
                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Integrate Fyipe with any
                                                external service that support
                                                HTTP request.
                                            </span>
                                        </span>
                                    </div>
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <div className="Box-root">
                                            {/* <RenderIfAdmin> */}
                                            <IncomingRequestButton />
                                            {/* </RenderIfAdmin> */}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {/* </div> */}
                            <IncomingRequestList />
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

IncomingRequestBox.displayName = 'IncomingRequestBox';

export default withRouter(IncomingRequestBox);
