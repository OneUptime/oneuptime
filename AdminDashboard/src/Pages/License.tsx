import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import LicenseSetting from '../components/license/LicenseSetting';
import { fetchLicense } from '../actions/license';

class License extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    componentDidMount = async () => {

        await this.props.fetchLicense();
    };

    override render() {
        return (
            <div className="Box-root Margin-vertical--12" >
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


License.displayName = 'License';

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ fetchLicense }, dispatch);


License.contextTypes = {};


License.propTypes = {
    fetchLicense: PropTypes.func.isRequired,
};

export default connect(null, mapDispatchToProps)(License);
