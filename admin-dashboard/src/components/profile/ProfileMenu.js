import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Link } from 'react-router-dom';
import { User } from '../../config';
import { hideProfileMenu } from '../../actions/profile'

export class ProfileMenu extends Component {
    
    logout(){
       var values = {name: User.getName(),email: User.getEmail()};
        User.clear();
        window.location.href='/login'; //hard refresh.
        if(window.location.href.indexOf('localhost') <= -1){
            this.context.mixpanel.track('User Logged Out', values);
        }
    }

    render() {
        var name = User.getName();
        var email = User.getEmail();

        return  this.props.visible ? 
            (
                <div className="ContextualLayer-layer--topright ContextualLayer-layer--anytop ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                    style={{top: '49px', width: '232px', right: '19px'}}>
                    <span>
                        <div className="ContextualPopover" style={{transformOrigin: '100% 0px 0px'}}>
                            <div className="ContextualPopover-arrowContainer">
                                <div className="ContextualPopover-arrow"></div>
                            </div>
                            <div className="ContextualPopover-contents">
                                <div className="Box-root" style={{width: '232px'}}>
                                    <div className="Box-root Box-divider--surface-bottom-1 Padding-all--12">
                                        <div>
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">{name}</span>
                                        </div>
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--12 Text-fontWeight--regular Text-lineHeight--16 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                <span>{email}</span>
                                            </span>
                                        </span>
                                    </div>
                                    <div className="Box-root Padding-vertical--8">
                                        <div className="Box-root" style={{padding: '10px', fontWeight: '500', marginTop: '-12px'}}>
                                            <Link to="/profile/settings" className="ButtonLink db-Menu-item db-Menu-item--link" type="button" onClick={()=> this.props.hideProfileMenu()}>
                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed">
                                                    <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>Profile</span>
                                                        </span>
                                                    </span>
                                                </div>
                                            </Link>
                                        </div>
                                        <div className="Box-root" style={{padding: '10px', fontWeight: '500', marginTop: '-12px'}}>
                                            <button className="ButtonLink db-Menu-item db-Menu-item--link"  id="logout-button" type="button" onClick={()=>this.logout()}>
                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed">
                                                    <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>Sign out</span>
                                                        </span>
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </span>
                </div>
        ) : null;
    }
}

ProfileMenu.displayName = 'ProfileMenu'

const mapStateToProps = state_Ignored => ({});

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ hideProfileMenu}, dispatch);
};

ProfileMenu.propTypes = {
    visible: PropTypes.bool,
    hideProfileMenu: PropTypes.func.isRequired
}

ProfileMenu.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(ProfileMenu);
