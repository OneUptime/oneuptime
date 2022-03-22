import React from 'react';
import PropTypes from 'prop-types';

import { Link } from 'react-router-dom';
import { closeTutorial } from '../../actions/tutorial';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import ShouldRender from './ShouldRender';

function QuickTipBox({
    title,
    id,
    content,
    icon,
    callToActionLink,
    callToAction,
    projectId,
    closeTutorial,
    hideActionButton
}: $TSFixMe) {
    return (
        <div

            tabIndex="0"
            id={`info-${id}`}
            className="Box-root Margin-vertical--12"
        >
            <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28">
                                <span id={`box-header-${id}`}>
                                    {title || 'Quick Tip'}
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"></span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <span
                                    id={`close-${id}`}
                                    className="incident-close-button"
                                    onClick={() =>
                                        closeTutorial(`${id}Custom`, projectId)
                                    }
                                ></span>
                            </div>
                        </div>
                    </div>
                    <div className="db-Trends-content">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Flex-flex Flex-alignContent--stretch tut-Main row">
                                <div className="bs-u-justify--center col-sm-12 Flex-justifyContent--center Padding-all--20 Vertical">
                                    <div className="Flex-flex Flex-alignItems--center">
                                        <img
                                            src={`${icon}`}
                                            alt=""
                                            className={`tut-Icon--${title} Margin-right--20`}
                                            height="75"
                                            width="75"
                                        />
                                        <div>
                                            <h3>{title}</h3>
                                            <article className="Text-wrap--wrap col-sm-12">
                                                {content}
                                            </article>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <ShouldRender if={!hideActionButton}>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--flexEnd Padding-horizontal--20 Padding-vertical--12">
                            <div>
                                <Link
                                    id={`gotoPage-${id}`}
                                    className="bs-Button "
                                    to={callToActionLink || '/dashboard'}
                                >
                                    <span>{callToAction || 'Home'}</span>
                                </Link>
                            </div>
                        </div>
                    </ShouldRender>
                </div>
            </div>
        </div>
    );
}

QuickTipBox.displayName = 'QuickTipBox';

QuickTipBox.propTypes = {
    title: PropTypes.string,
    id: PropTypes.string,
    content: PropTypes.object,
    icon: PropTypes.string,
    callToActionLink: PropTypes.string,
    callToAction: PropTypes.string,
    projectId: PropTypes.string,
    closeTutorial: PropTypes.func,
    hideActionButton: PropTypes.bool,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ closeTutorial }, dispatch);

export default connect(null, mapDispatchToProps)(QuickTipBox);
