import React, { Component } from 'react';

class ErrorEventTagDetail extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    override render() {
        return (
            <div className="Box-divider--border-top-1 Padding-vertical--20" >
                <div className="Flex-flex Flex-justifyContent--spaceBetween">
                    <p className="SubHeader">Tags Detailed</p>
                </div>
                <div className="Flex-flex Flex-justifyContent--spaceBetween">
                    <div className="Tag-Container">
                        <div className="Flex-flex Flex-justifyContent--spaceBetween Padding-all--16">
                            <span> User Type</span>
                            <button className="bs-Button" type="button">
                                <span>More Details</span>
                            </button>
                        </div>
                        <div className="Tag-Detail">
                            <div>
                                <span>Customer</span>
                                <span>2</span>
                            </div>
                        </div>
                    </div>
                    <div className="Tag-Container">
                        <div className="Flex-flex Flex-justifyContent--spaceBetween Padding-all--16">
                            <span> Device.Family</span>
                            <button className="bs-Button" type="button">
                                <span>More Details</span>
                            </button>
                        </div>
                        <div className="Tag-Detail">
                            <div>
                                <span>Nexus</span>
                                <span>5</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ErrorEventTagDetail.displayName = 'ErrorEventTagDetail';
export default ErrorEventTagDetail;
