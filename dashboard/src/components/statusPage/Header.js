import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

export class StatusHeader extends Component {

    render() {
        const { statusPage } = this.props;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <p>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Status Page: {statusPage.status.title || 'Status Page'}</span>
                                </span>
                            </p>
                            <p><span>Status page lets your customers and your team see the current status of your monitors.</span></p>
                        </div>
                    </div>

                </div>
            </div>
        );
    }
}

StatusHeader.displayName = 'StatusHeader'

StatusHeader.propTypes = {
    statusPage: PropTypes.object.isRequired
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {}, dispatch
)

const mapStateToProps = state => {
    const { statusPage} = state;
    return { statusPage };
}

export default connect(mapStateToProps, mapDispatchToProps)(StatusHeader);