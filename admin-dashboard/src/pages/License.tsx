import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import LicenseSetting from '../components/license/LicenseSetting';
import { fetchLicense } from '../actions/license';

class License extends Component {
    componentDidMount = async () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLicense' does not exist on type 'Re... Remove this comment to see the full error message
        await this.props.fetchLicense();
    };

    render() {
        return (
            <div className="Box-root Margin-vertical--12">
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span data-reactroot="">
                                    <div>
                                        <div>
                                            <div
                                                id="oneuptimeLicense"
                                                className="Box-root Margin-bottom--12"
                                            >
                                                <LicenseSetting />
                                            </div>
                                        </div>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
License.displayName = 'License';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ fetchLicense }, dispatch);

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
License.contextTypes = {};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
License.propTypes = {
    fetchLicense: PropTypes.func.isRequired,
};

export default connect(null, mapDispatchToProps)(License);
