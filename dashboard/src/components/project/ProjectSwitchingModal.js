import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import uuid from 'js-uuid';

export class SwitchingModal extends React.Component {
    constructor(props) {
        super(props);
    }

    delay = ms => {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    componentDidMount() {
        this.delay(3000).then(o => o);
    }

    render() {
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 71 }}
                >
                    <div className="Card-root Card-shadow--medium">
                        <div className="Box-root Padding-all--32">
                            <div className="Box-root Flex-flex Flex-alignItems--center Flex-direction--column Flex-justifyContent--flexStart">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="Spinner bs-SpinnerLegacy Spinner--size--large Box-root Flex-inlineFlex Flex-alignItems--center Flex-justifyContent--center">
                                        <svg
                                            viewBox="0 0 24 24"
                                            xmlns="http://www.w3.org/2000/svg"
                                            className="Spinner-svg"
                                        >
                                            <ellipse
                                                cx={12}
                                                cy={12}
                                                rx={10}
                                                ry={10}
                                                className="Spinner-ellipse"
                                            />
                                        </svg>
                                    </div>
                                </div>
                                <div className="Box-root">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Switching projects…</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

SwitchingModal.displayName = 'ProjectSwitchingModal';

function mapValueToProps(value) {
    return function() {
        return { project: value };
    };
}

function mapDispatchToProps(dispatch) {
    return bindActionCreators({}, dispatch);
}

export default (value, props) => {
    return props.openModal({
        id: uuid.v4(),
        content: connect(
            mapValueToProps(value),
            mapDispatchToProps
        )(SwitchingModal),
    });
};
