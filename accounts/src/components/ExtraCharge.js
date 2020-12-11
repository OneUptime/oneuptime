import React from 'react'
import { connect } from 'react-redux';
import {closeModal} from '../actions/modal'
class ExtraCharge extends React.Component{
    handleClick =()=>{
        this.props.close()
    }
    render(){
        
        return(
            <div>
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
                                        <span>Additional Charges</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                              <div>We charge you $1 to make sure our customers are genuine.</div> <br></br>  
                              <div>We also charge $1 to make sure there is no issue of toll fraud!</div> <br></br>
                              <div  
                                style={{ cursor:'pointer', textDecoration:"underline"}}>
                                  <a style={{color:'green',}} href="https://www.twilio.com/learn/voice-and-video/toll-fraud"
                                   target="_blank" rel="noopener noreferrer">About Toll Fraud</a></div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                            type="button"
                                            onClick={this.handleClick}
                                        >
                                            <span>
                                                {'Close'}
                                            </span>
                                        </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
        )
    }
}

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = (dispatch) => {
    return {
        close: () => {dispatch(closeModal({id:1}))}
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ExtraCharge);
