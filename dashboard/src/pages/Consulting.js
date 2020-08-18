import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { PropTypes } from 'prop-types';

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
                        <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                            <div className="Box-root Card-shadow--medium Border-radius--4">
                                <div className="bs-ContentSection-content Box-root Padding-horizontal--32 Padding-vertical--32">
                                    <div className="Flex-direction--row Text-align--center Text-fontSize--32 Text-fontWeight--bold">
                                        <div className=" Padding-top--32 Margin-top--16">
                                            Welcome to Fyipe Advisors!
                                        </div>
                                    </div>
                                    <div className="Flex-direction--row Text-align--center Text-fontSize--20 Padding-bottom--48 Padding-top--12">
                                        <div>
                                            Hire an expert to take the stress
                                            out of DevOps and IT, and Software
                                            development
                                        </div>
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--left Padding-top--32 Padding-bottom--48">
                                        <div className="Margin-right--48">
                                            <div className="Text-fontSize--20 Text-fontWeight--bold Padding-bottom--20">
                                                Why hire a Fyipe Advisor?
                                            </div>
                                            <div className="Margin-bottom--12">
                                                <span className="db-ListItem-icon db-SideNav-icon--consultant" />
                                                <span>
                                                    An expert dedicated to you
                                                </span>
                                            </div>
                                            <div className="Margin-bottom--12">
                                                <span className="db-ListItem-icon db-SideNav-icon--tick" />
                                                <span>
                                                    Stay ahead of problems
                                                </span>
                                            </div>
                                            <div className="Margin-bottom--12">
                                                <span className="db-ListItem-icon db-SideNav-icon--dollar" />
                                                <span>
                                                    Priced right for small
                                                    businesses
                                                </span>
                                            </div>
                                            <div className="Margin-bottom--12">
                                                <button className="bs-Button bs-Button--blue">
                                                    <span>Start now</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div
                                            className="db-SideNav-icon--meeting Margin-left--48"
                                            style={{
                                                backgroundRepeat: 'no-repeat',
                                                backgroundSize: 'contain',
                                                flex: 1,
                                            }}
                                        />
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--left Margin-top--32">
                                        <div
                                            className="Text-fontSize--20 Text-fontWeight--bold Padding-bottom--20 Text-align--center"
                                            style={{ flex: 1 }}
                                        >
                                            Getting started is easy!
                                        </div>
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--center Margin-top--32">
                                        <div style={{ flex: 1 }}>
                                            <div className="db-SideNav-icon--connect db-SideNav-icon--selected Margin-bottom--12 db-Consulting-icon" />
                                            <div>
                                                <div className="Text-fontWeight--bold">
                                                    Book a free consultation
                                                </div>
                                                <div>
                                                    Share your worries and goals
                                                    with us.
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div className="db-SideNav-icon--sms db-SideNav-icon--selected Margin-bottom--12 db-Consulting-icon" />
                                            <div>
                                                <div className="Text-fontWeight--bold">
                                                    Explore your options
                                                </div>
                                                <div>
                                                    See the different plans and
                                                    how they can work for you.
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div className="db-SideNav-icon--user db-SideNav-icon--selected Margin-bottom--12 db-Consulting-icon" />
                                            <div>
                                                <div className="Text-fontWeight--bold">
                                                    Get peace of mind
                                                </div>
                                                <div>
                                                    Let your advisor solve your
                                                    problems.
                                                </div>
                                            </div>
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
};

export default Consulting;
