import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { userData, validationError } from '../../actions/subscribe';
import ShouldRender from '../ShouldRender';

class Call extends Component {
    constructor(props) {
        super(props);
        this.state = { country: 'us' };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    handleChange = (event) => {
        const value = event.target.value;
        const name = event.target.name;
        this.setState({ [name]: value });
    }
    handleSubmit = (event) => {
        if (this.state.phone_number && this.state.phone_number.length) {
            const validnumber = this.validation(this.state.phone_number);
            if (validnumber) {
                const values = this.state;
                values.method = 'sms';
                this.props.userData(values);
            }
            else {
                this.props.validationError('Please enter a valid phone number.');
            }
        }
        else {
            this.props.validationError('Please enter your phone number.');
        }
        event.preventDefault();
    }
    validation = (phone) => {
        const numbers = /^[0-9]+$/;
        if (phone.match(numbers)) {
            return true;
        }
        else {
            return false;
        }
    }
    render() {
        return (
            <div>
                <div className="directions">
                    Get sms notifications when an incident is <strong>created</strong>.
          </div>
                <form id="subscribe-form-sms" onSubmit={this.handleSubmit}>
                    <select value={this.state.country} onChange={this.handleChange} name="country" className="select-full">
                        <option value="af">Afghanistan (+93)</option>
                        <option value="al">Albania (+355)</option>
                        <option value="dz">Algeria (+213)</option>
                        <option value="as">American Samoa (+1)</option>
                        <option value="ad">Andorra (+376)</option>
                        <option value="ao">Angola (+244)</option>
                        <option value="ai">Anguilla (+1)</option>
                        <option value="ag">Antigua and Barbuda (+1)</option>
                        <option value="ar">Argentina (+54)</option>
                        <option value="am">Armenia (+374)</option>
                        <option value="aw">Aruba (+297)</option>
                        <option value="au">Australia/Cocos/Christmas Island (+61)</option>
                        <option value="at">Austria (+43)</option>
                        <option value="az">Azerbaijan (+994)</option>
                        <option value="bs">Bahamas (+1)</option>
                        <option value="bh">Bahrain (+973)</option>
                        <option value="bd">Bangladesh (+880)</option>
                        <option value="bb">Barbados (+1)</option>
                        <option value="by">Belarus (+375)</option>
                        <option value="be">Belgium (+32)</option>
                        <option value="bz">Belize (+501)</option>
                        <option value="bj">Benin (+229)</option>
                        <option value="bm">Bermuda (+1)</option>
                        <option value="bo">Bolivia (+591)</option>
                        <option value="ba">Bosnia and Herzegovina (+387)</option>
                        <option value="bw">Botswana (+267)</option>
                        <option value="br">Brazil (+55)</option>
                        <option value="bn">Brunei (+673)</option>
                        <option value="bg">Bulgaria (+359)</option>
                        <option value="bf">Burkina Faso (+226)</option>
                        <option value="bi">Burundi (+257)</option>
                        <option value="kh">Cambodia (+855)</option>
                        <option value="cm">Cameroon (+237)</option>
                        <option value="ca">Canada (+1)</option>
                        <option value="cv">Cape Verde (+238)</option>
                        <option value="ky">Cayman Islands (+1)</option>
                        <option value="cf">Central Africa (+236)</option>
                        <option value="td">Chad (+235)</option>
                        <option value="cl">Chile (+56)</option>
                        <option value="cn">China (+86)</option>
                        <option value="co">Colombia (+57)</option>
                        <option value="km">Comoros (+269)</option>
                        <option value="cg">Congo (+242)</option>
                        <option value="cd">Congo, Dem Rep (+243)</option>
                        <option value="cr">Costa Rica (+506)</option>
                        <option value="hr">Croatia (+385)</option>
                        <option value="cy">Cyprus (+357)</option>
                        <option value="cz">Czech Republic (+420)</option>
                        <option value="dk">Denmark (+45)</option>
                        <option value="dj">Djibouti (+253)</option>
                        <option value="dm">Dominica (+1)</option>
                        <option value="do">Dominican Republic (+1)</option>
                        <option value="eg">Egypt (+20)</option>
                        <option value="sv">El Salvador (+503)</option>
                        <option value="gq">Equatorial Guinea (+240)</option>
                        <option value="ee">Estonia (+372)</option>
                        <option value="et">Ethiopia (+251)</option>
                        <option value="fo">Faroe Islands (+298)</option>
                        <option value="fj">Fiji (+679)</option>
                        <option value="fi">Finland/Aland Islands (+358)</option>
                        <option value="fr">France (+33)</option>
                        <option value="gf">French Guiana (+594)</option>
                        <option value="pf">French Polynesia (+689)</option>
                        <option value="ga">Gabon (+241)</option>
                        <option value="gm">Gambia (+220)</option>
                        <option value="ge">Georgia (+995)</option>
                        <option value="de">Germany (+49)</option>
                        <option value="gh">Ghana (+233)</option>
                        <option value="gi">Gibraltar (+350)</option>
                        <option value="gr">Greece (+30)</option>
                        <option value="gl">Greenland (+299)</option>
                        <option value="gd">Grenada (+1)</option>
                        <option value="gp">Guadeloupe (+590)</option>
                        <option value="gu">Guam (+1)</option>
                        <option value="gt">Guatemala (+502)</option>
                        <option value="gn">Guinea (+224)</option>
                        <option value="gy">Guyana (+592)</option>
                        <option value="ht">Haiti (+509)</option>
                        <option value="hn">Honduras (+504)</option>
                        <option value="hk">Hong Kong (+852)</option>
                        <option value="hu">Hungary (+36)</option>
                        <option value="is">Iceland (+354)</option>
                        <option value="in">India (+91)</option>
                        <option value="id">Indonesia (+62)</option>
                        <option value="ir">Iran (+98)</option>
                        <option value="iq">Iraq (+964)</option>
                        <option value="ie">Ireland (+353)</option>
                        <option value="il">Israel (+972)</option>
                        <option value="it">Italy (+39)</option>
                        <option value="jm">Jamaica (+1)</option>
                        <option value="jp">Japan (+81)</option>
                        <option value="jo">Jordan (+962)</option>
                        <option value="ke">Kenya (+254)</option>
                        <option value="kr">Korea, Republic of (+82)</option>
                        <option value="kw">Kuwait (+965)</option>
                        <option value="kg">Kyrgyzstan (+996)</option>
                        <option value="la">Laos (+856)</option>
                        <option value="lv">Latvia (+371)</option>
                        <option value="lb">Lebanon (+961)</option>
                        <option value="ls">Lesotho (+266)</option>
                        <option value="lr">Liberia (+231)</option>
                        <option value="ly">Libya (+218)</option>
                        <option value="li">Liechtenstein (+423)</option>
                        <option value="lt">Lithuania (+370)</option>
                        <option value="lu">Luxembourg (+352)</option>
                        <option value="mo">Macao (+853)</option>
                        <option value="mk">Macedonia (+389)</option>
                        <option value="mg">Madagascar (+261)</option>
                        <option value="mw">Malawi (+265)</option>
                        <option value="my">Malaysia (+60)</option>
                        <option value="mv">Maldives (+960)</option>
                        <option value="ml">Mali (+223)</option>
                        <option value="mt">Malta (+356)</option>
                        <option value="mq">Martinique (+596)</option>
                        <option value="mr">Mauritania (+222)</option>
                        <option value="mu">Mauritius (+230)</option>
                        <option value="mx">Mexico (+52)</option>
                        <option value="mc">Monaco (+377)</option>
                        <option value="mn">Mongolia (+976)</option>
                        <option value="me">Montenegro (+382)</option>
                        <option value="ms">Montserrat (+1)</option>
                        <option value="ma">Morocco/Western Sahara (+212)</option>
                        <option value="mz">Mozambique (+258)</option>
                        <option value="na">Namibia (+264)</option>
                        <option value="np">Nepal (+977)</option>
                        <option value="nl">Netherlands (+31)</option>
                        <option value="nz">New Zealand (+64)</option>
                        <option value="ni">Nicaragua (+505)</option>
                        <option value="ne">Niger (+227)</option>
                        <option value="ng">Nigeria (+234)</option>
                        <option value="no">Norway (+47)</option>
                        <option value="om">Oman (+968)</option>
                        <option value="pk">Pakistan (+92)</option>
                        <option value="ps">Palestinian Territory (+970)</option>
                        <option value="pa">Panama (+507)</option>
                        <option value="py">Paraguay (+595)</option>
                        <option value="pe">Peru (+51)</option>
                        <option value="ph">Philippines (+63)</option>
                        <option value="pl">Poland (+48)</option>
                        <option value="pt">Portugal (+351)</option>
                        <option value="pr">Puerto Rico (+1)</option>
                        <option value="qa">Qatar (+974)</option>
                        <option value="re">Reunion/Mayotte (+262)</option>
                        <option value="ro">Romania (+40)</option>
                        <option value="ru">Russia/Kazakhstan (+7)</option>
                        <option value="rw">Rwanda (+250)</option>
                        <option value="ws">Samoa (+685)</option>
                        <option value="sm">San Marino (+378)</option>
                        <option value="sa">Saudi Arabia (+966)</option>
                        <option value="sn">Senegal (+221)</option>
                        <option value="rs">Serbia (+381)</option>
                        <option value="sc">Seychelles (+248)</option>
                        <option value="sl">Sierra Leone (+232)</option>
                        <option value="sg">Singapore (+65)</option>
                        <option value="sk">Slovakia (+421)</option>
                        <option value="si">Slovenia (+386)</option>
                        <option value="za">South Africa (+27)</option>
                        <option value="es">Spain (+34)</option>
                        <option value="lk">Sri Lanka (+94)</option>
                        <option value="kn">St Kitts and Nevis (+1)</option>
                        <option value="lc">St Lucia (+1)</option>
                        <option value="vc">St Vincent Grenadines (+1)</option>
                        <option value="sd">Sudan (+249)</option>
                        <option value="sr">Suriname (+597)</option>
                        <option value="sz">Swaziland (+268)</option>
                        <option value="se">Sweden (+46)</option>
                        <option value="ch">Switzerland (+41)</option>
                        <option value="sy">Syria (+963)</option>
                        <option value="tw">Taiwan (+886)</option>
                        <option value="tj">Tajikistan (+992)</option>
                        <option value="tz">Tanzania (+255)</option>
                        <option value="th">Thailand (+66)</option>
                        <option value="tg">Togo (+228)</option>
                        <option value="to">Tonga (+676)</option>
                        <option value="tt">Trinidad and Tobago (+1)</option>
                        <option value="tn">Tunisia (+216)</option>
                        <option value="tr">Turkey (+90)</option>
                        <option value="tc">Turks and Caicos Islands (+1)</option>
                        <option value="ug">Uganda (+256)</option>
                        <option value="ua">Ukraine (+380)</option>
                        <option value="ae">United Arab Emirates (+971)</option>
                        <option value="gb">United Kingdom (+44)</option>
                        <option value="us">United States (+1)</option>
                        <option value="uy">Uruguay (+598)</option>
                        <option value="uz">Uzbekistan (+998)</option>
                        <option value="ve">Venezuela (+58)</option>
                        <option value="vn">Vietnam (+84)</option>
                        <option value="vg">Virgin Islands, British (+1)</option>
                        <option value="vi">Virgin Islands, U.S. (+1)</option>
                        <option value="ye">Yemen (+967)</option>
                        <option value="zm">Zambia (+260)</option>
                        <option value="zw">Zimbabwe (+263)</option></select>
                    <input name="phone_number" onChange={this.handleChange} type="text" placeholder="ex. 6505551234" className="input-full" />


                    <input type="submit" value="Subscribe" className="subscribe-btn-full" id="subscribe-btn-sms" />
                    <div className="terms_and_privacy_information small" style={{ marginTop: '10px' }}>Message and data rates may apply. By subscribing you agree to the Fyipe <a target="_blank" href="https://www.atlassian.com/legal/cloud-terms-of-service" rel="noopener noreferrer">Cloud Terms of Service</a>.</div>
                </form>
                <ShouldRender if={this.props.subscribed && this.props.subscribed.error}>
                    <div className="validation-error">
                        <span className="validation-error-icon"></span>
                        <span className='error-text'>
                            {this.props.subscribed && this.props.subscribed.error}
                        </span>
                    </div>
                </ShouldRender>
            </div>
        );
    }
}

Call.displayName = 'Call';

const mapStateToProps = (state) => ({
    userDetails: state.subscribe.userDetails,
    subscribed: state.subscribe.subscribed,
});

const mapDispatchToProps = (dispatch) => bindActionCreators({ userData, validationError }, dispatch)

Call.propTypes = {
    userData: PropTypes.func,
    validationError: PropTypes.func,
    subscribed: PropTypes.object,
    error: PropTypes.string
}

export default connect(mapStateToProps, mapDispatchToProps)(Call);