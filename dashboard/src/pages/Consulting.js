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
                                        <div
                                            className="Padding-top--24 Text-fontWeight--bold"
                                            style={{ fontSize: '50px' }}
                                        >
                                            Who we are
                                        </div>
                                    </div>
                                    <div className="Flex-direction--row Text-align--center Text-fontSize--20 Padding-bottom--48 Padding-top--12">
                                        <div>
                                            We&#39;ve helped everyone from tiny
                                            startups to enterprises and helped
                                            them build products that are simple,
                                            beautiful and easy to use.
                                        </div>
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--center Margin-top--32 Flex-wrap--wrap">
                                        <div style={{ flex: 1 }}>
                                            <img
                                                src="/dashboard/assets/img/icons/sony.jpg"
                                                style={{
                                                    maxHheight: '9vw',
                                                    maxWidth: '75%',
                                                }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <img
                                                src="/dashboard/assets/img/icons/bank-of-america.png"
                                                style={{
                                                    maxHeight: '9vw',
                                                    maxWidth: '75%',
                                                }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <img
                                                src="/dashboard/assets/img/icons/adobe.png"
                                                style={{
                                                    maxHheight: '9vw',
                                                    maxWidth: '75%',
                                                }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <img
                                                src="/dashboard/assets/img/icons/hershey-logo.png"
                                                style={{
                                                    maxHheight: '9vw',
                                                    maxWidth: '75%',
                                                }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <img
                                                src="/dashboard/assets/img/icons/cocacola.png"
                                                style={{
                                                    maxHheight: '9vw',
                                                    maxWidth: '75%',
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="Flex-direction--row Text-align--center Text-fontSize--20 Padding-bottom--48 Padding-top--48">
                                        <div>
                                            We&#39;re one of the few agencies in
                                            the world that can take a product
                                            idea from end to end. From napkin
                                            sketch to real shipped product. Have
                                            a great new product idea and nobody
                                            to start building it? We&#39;re your
                                            team.
                                        </div>
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--left Flex-wrap--wrap">
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--demo"></span>
                                                    <span className="Text-fontWeight--bold">
                                                        Demos every week
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    We demo the work we&#39;ve
                                                    done at the end of every
                                                    week. If you&#39;re not
                                                    satisfied with the demo, we
                                                    waive the invoice off.
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--update" />
                                                    <span className="Text-fontWeight--bold">
                                                        Updates every day
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    We&#39;ll have a call with
                                                    you and update you every day
                                                    on Slack or Skype on work
                                                    we&#39;ve done.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--left Flex-wrap--wrap">
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--engineer"></span>
                                                    <span className="Text-fontWeight--bold">
                                                        Talk directly to
                                                        engineers
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    You talk directly to someone
                                                    who is actually working on
                                                    your project. No project
                                                    manager. No middle man. No
                                                    fuss.
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--group" />
                                                    <span className="Text-fontWeight--bold">
                                                        Our team is yours
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    Hire anyone on our team.
                                                    From app developers to UI/UX
                                                    designers, and even DevOps.
                                                    We&#39;re all yours.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--left Flex-wrap--wrap">
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--clock"></span>
                                                    <span className="Text-fontWeight--bold">
                                                        Part time or Full time
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    We engage with you part time
                                                    or full time. Any number of
                                                    hours a week are completely
                                                    fine by us.
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--transparency" />
                                                    <span className="Text-fontWeight--bold">
                                                        Transparency in work
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    Every minute of work we do
                                                    is recorded and snapshotted
                                                    for you to look at. We
                                                    believe in 100%
                                                    transparency.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Flex-flex Flex-direction--row Text-align--left Flex-wrap--wrap">
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--diversity" />
                                                    <span className="Text-fontWeight--bold">
                                                        Any technology
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    We work with any technology
                                                    and on any stack. From Web
                                                    to Mobile, Javascript to Go
                                                    and more.
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            style={{ flex: 1, padding: '20px' }}
                                        >
                                            <div>
                                                <div>
                                                    <span className="db-ListItem-icon db-SideNav-icon--plant" />
                                                    <span className="Text-fontWeight--bold">
                                                        Beautiful apps.
                                                        Guaranteed.
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginLeft: '26px',
                                                    }}
                                                >
                                                    We&#39;ll make your app and
                                                    services amazing, beautiful,
                                                    simple and easy to use.
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
