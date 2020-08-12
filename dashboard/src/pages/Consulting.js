import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';

class Consulting extends Component {
    render() {
        const {
            location: { pathname },
        } = this.props;
        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={pathname}
                        name="Consulting &#38; Services"
                    />
                    <div className="Box-root">
                        <ShouldRender if={this.props.componentTutorial.show}>
                            <TutorialBox type="consultant" />
                        </ShouldRender>
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <div className="Box-root">
                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                DevOps &#38; IT Consulting
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <div className="Box-root">
                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                Software Consulting
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

Consulting.displayName = 'Consulting';

Consulting.propTypes = {
    location: PropTypes.shape({ pathname: PropTypes.string }),
    componentTutorial: PropTypes.shape({ show: PropTypes.bool }),
};

const mapStateToProps = state => {
    return {
        componentTutorial: state.tutorial.component,
    };
};

export default connect(mapStateToProps)(Consulting);
