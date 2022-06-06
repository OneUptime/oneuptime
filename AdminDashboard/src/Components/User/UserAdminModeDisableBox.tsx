import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { disableAdminMode } from '../../actions/user';

export class UserAdminModeDisableBox extends Component<ComponentProps> {
    public static displayName = '';
    public static propTypes = {};

    constructor(props: $TSFixMe) {
        super(props);
    }

    handleClick = () => {
        const { disableAdminMode, userId }: $TSFixMe = this.props;
        disableAdminMode(userId);
    };

    override render() {
        const { isRequesting }: $TSFixMe = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Disable Admin Mode</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to disable admin mode
                                        and revert to original user password
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        id="block"
                                        className="bs-Button bs-Button--green Box-background--green"
                                        disabled={isRequesting}
                                        onClick={this.handleClick}
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Dsiable Admin Mode</span>
                                        </ShouldRender>
                                        <ShouldRender if={isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

UserAdminModeDisableBox.displayName = 'UserAdminModeDisableBox';

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators({ disableAdminMode }, dispatch);
};

const mapStateToProps: Function = (state: RootState) => {
    const userId: $TSFixMe = state.user.user.user
        ? state.user.user.user._id
        : null;

    return {
        userId,
        isRequesting:
            state.user &&
            state.user.disableAdminMode &&
            state.user.disableAdminMode.requesting,
    };
};

UserAdminModeDisableBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    disableAdminMode: PropTypes.func.isRequired,
    userId: PropTypes.string,
};

UserAdminModeDisableBox.contextTypes = {};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(UserAdminModeDisableBox);
