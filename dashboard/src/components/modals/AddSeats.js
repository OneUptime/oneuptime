import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class AddSeats extends Component {
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Add an extra seat to continue.
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    You have reached the maximum limit of
                                    monitors that can be added with this plan.
                                    To add more monitors you have to add an
                                    extra seat which will cost you an extra
                                    user&apos;s cost. Press confirm to add a
                                    seat.
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender
                                        if={
                                            this.props.error &&
                                            !this.props.requesting
                                        }
                                    >
                                        <div className="bs-Tail-copy">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {this.props.error}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--red"
                                        type="button"
                                        onClick={this.props.confirmThisDialog}
                                        disabled={this.props.requesting}
                                    >
                                        {!this.props.requesting && (
                                            <span>Confirm</span>
                                        )}
                                        {this.props.requesting && (
                                            <FormLoader />
                                        )}
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

AddSeats.displayName = 'AddSeatsFormModal';

const mapDispatchToProps = dispatch => {
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state) {
    return {
        error: state.monitor.addseat && state.monitor.addseat.error,
        requesting: state.monitor.addseat && state.monitor.addseat.requesting,
    };
}

AddSeats.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    error: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
    requesting: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(AddSeats);
