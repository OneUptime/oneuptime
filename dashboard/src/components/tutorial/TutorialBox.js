import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Tutorial from './Tutorial';
import PropTypes from 'prop-types';
import { closeTutorial } from '../../actions/tutorial';
import ApiDoc from '../fyipeApi/ApiDoc';
import ShouldRender from '../basic/ShouldRender';

const Tutorials = ({ type, closeTutorial }) => (
    <div tabIndex="0" className="Box-root Margin-vertical--12">
        <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium">
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28">
                            <ShouldRender if={type !== 'api'}>
                                <span>Quick Tips</span>
                            </ShouldRender>

                            <ShouldRender if={type === 'api'}>
                                <span id="boxTitle">API Documentation</span>
                            </ShouldRender>
                        </span>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"></span>
                    </div>
                    <ShouldRender if={type !== 'api'}>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <span
                                    className="incident-close-button"
                                    onClick={() => closeTutorial(type)}
                                ></span>
                            </div>
                        </div>
                    </ShouldRender>
                </div>
                <div className="db-Trends-content">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <ShouldRender if={type !== 'api'}>
                            <Tutorial type={type} />
                        </ShouldRender>

                        <ShouldRender if={type === 'api'}>
                            <ApiDoc />
                        </ShouldRender>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeTutorial }, dispatch);

Tutorials.displayName = 'TutorialBox';

Tutorials.propTypes = {
    type: PropTypes.string,
    closeTutorial: PropTypes.func,
};

export default connect(null, mapDispatchToProps)(Tutorials);
