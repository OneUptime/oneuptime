import React, { Component } from 'react';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';

import { PropTypes } from 'prop-types';

import Slider from 'react-slick';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';

interface ConsultingProps {
    location?: {
        pathname?: string
    };
    currentProject: object;
    switchToProjectViewerNav?: boolean;
}

class Consulting extends Component<ComponentProps> {
    override render() {
        const settings = {
            infinite: true,
            speed: 1000,
            slidesToShow: 1.5,
            slidesToScroll: 1,
            autoplay: true,
            responsive: [
                {
                    breakpoint: 1024,
                    settings: {
                        slidesToShow: 1,
                        slidesToScroll: 1,
                    },
                },
                {
                    breakpoint: 760,
                    settings: {
                        slidesToShow: 1,
                        slidesToScroll: 1,
                    },
                },
                {
                    breakpoint: 600,
                    settings: {
                        slidesToShow: 1,
                        slidesToScroll: 1,
                    },
                },
                {
                    breakpoint: 375,
                    settings: {
                        slidesToShow: 1,
                        slidesToScroll: 1,
                    },
                },
            ],
        };

        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={pathname}
                    name="Consulting &#38; Services"
                />
                <div id="consultingServicesPage" className="Box-root">
                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                        <div className="Box-root Card-shadow--medium Border-radius--4">
                            <div className="bs-ContentSection-content Box-root Padding-horizontal--32 Padding-vertical--32">
                                <div className="Flex-direction--row Text-align--center Text-fontSize--24 Text-fontWeight--bold">
                                    <div className="Padding-top--24 Text-color--inherit Text-display--inline Text-fontSize--48 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                        We make products happen.
                                    </div>
                                </div>
                                <div className="Flex-direction--row Padding-bottom--32 Padding-top--12 Text-align--center">
                                    <div className="Text-display--inline Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        We&#39;ve helped everyone from tiny
                                        startups to enterprises and helped them
                                        build products that are simple,
                                        beautiful and easy to use.
                                    </div>
                                </div>
                                <div className="Flex-flex Flex-direction--row">
                                    <div className="Flex-flex Flex-direction--row Flex-flex--1 Text-align--center Flex-wrap--wrap bs-Container Text-fontWeight--medium">
                                        <span className="Margin-bottom--12 Flex-flex--1">
                                            <span className="db-ListItem-icon db-SideNav-icon--tick" />
                                            <span>
                                                Web and Mobile app development
                                            </span>
                                        </span>
                                        <span className="Margin-bottom--12 Flex-flex--1">
                                            <span className="db-ListItem-icon db-SideNav-icon--tick" />
                                            <span>
                                                Software &amp; DevOps Consulting
                                            </span>
                                        </span>
                                        <span className="Margin-bottom--12 Flex-flex--1">
                                            <span className="db-ListItem-icon db-SideNav-icon--tick" />
                                            <span>UI/UX Design</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="Flex-flex Flex-direction--row Text-align--center Margin-top--32 Flex-wrap--wrap">
                                    <div className="Flex-flex--1">
                                        <img
                                            src="/dashboard/assets/img/icons/sony.jpg"
                                            className="Responsive-image"
                                            alt="sony"
                                        />
                                    </div>
                                    <div className="Flex-flex--1">
                                        <img
                                            src="/dashboard/assets/img/icons/bank-of-america.png"
                                            className="Responsive-image"
                                            alt="bank-of-america"
                                        />
                                    </div>
                                    <div className="Flex-flex--1">
                                        <img
                                            src="/dashboard/assets/img/icons/adobe.png"
                                            className="Responsive-image"
                                            alt="adobe"
                                        />
                                    </div>
                                    <div className="Flex-flex--1">
                                        <img
                                            src="/dashboard/assets/img/icons/hershey-logo.png"
                                            className="Hershey-logo-image Responsive-image"
                                            alt="hershey-logo"
                                        />
                                    </div>
                                    <div className="Flex-flex--1">
                                        <img
                                            src="/dashboard/assets/img/icons/cocacola.png"
                                            className="Responsive-image"
                                            alt="cocacola"
                                        />
                                    </div>
                                </div>
                                <div className="Flex-direction--row Text-fontSize--20 Padding-bottom--48 Padding-top--48">
                                    <div className="Text-display--inline Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        We&#39;re one of the few agencies in the
                                        world that can take a product idea from
                                        end to end. From napkin sketch to real
                                        shipped product. Have a great new
                                        product idea and nobody to start
                                        building it? We&#39;re your team.
                                    </div>
                                </div>
                                <div className="Flex-flex Flex-direction--row Flex-wrap--wrap bs-Container">
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--demo"></span>
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Demos every week
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                style={{
                                                    marginLeft: '26px',
                                                }}
                                            >
                                                We demo the work we&#39;ve done
                                                at the end of every week. If
                                                you&#39;re not satisfied with
                                                the demo, we waive the invoice
                                                off.
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--update" />
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Updates every day
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                style={{
                                                    marginLeft: '26px',
                                                }}
                                            >
                                                We&#39;ll have a call with you
                                                and update you every day on
                                                Slack or Zoom on work we&#39;ve
                                                done.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="Flex-flex Flex-direction--row Flex-wrap--wrap bs-Container">
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--engineer"></span>
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Talk directly to engineers
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                style={{
                                                    marginLeft: '26px',
                                                }}
                                            >
                                                You talk directly to someone who
                                                is actually working on your
                                                project. No project manager. No
                                                middle man. No fuss.
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--group" />
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Our team is yours
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                style={{
                                                    marginLeft: '26px',
                                                }}
                                            >
                                                Hire anyone on our team. From
                                                app developers to UI/UX
                                                designers, and even DevOps.
                                                We&#39;re all yours.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="Flex-flex Flex-direction--row Flex-wrap--wrap bs-Container">
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--clock"></span>
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Part time or Full time
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                style={{
                                                    marginLeft: '26px',
                                                }}
                                            >
                                                We engage with you part time or
                                                full time. Any number of hours a
                                                week are completely fine by us.
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--transparency" />
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Transparency in work
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                style={{
                                                    marginLeft: '26px',
                                                }}
                                            >
                                                Every minute of work we do is
                                                recorded and snapshotted for you
                                                to look at. We believe in 100%
                                                transparency.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="Flex-flex Flex-direction--row Flex-wrap--wrap bs-Container">
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--diversity" />
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Any technology
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                                style={{
                                                    marginLeft: '26px',
                                                }}
                                            >
                                                We work with any technology and
                                                on any stack. From Web to
                                                Mobile, Javascript to Go and
                                                more.
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Flex-flex--1 Padding-all--20">
                                        <div>
                                            <div>
                                                <span className="db-ListItem-icon db-SideNav-icon--plant" />
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                    Beautiful apps. Guaranteed.
                                                </span>
                                            </div>
                                            <div
                                                className="Text-fontSize--16 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
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
                                <div className="Flex-direction--row Padding-bottom--48 Padding-top--48 Text-fontSize--14 Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <Slider {...settings}>
                                        <div className="Flex-flex Flex-direction--row Padding-all--12">
                                            <div className="Flex-flex Flex-direction--row bs-Carousel Flex-alignItems--center Flex-justifyContent--center">
                                                <div
                                                    className="Padding-all--32 Card-shadow--clear"
                                                    style={{
                                                        width: '400px',
                                                        height: '200px',
                                                    }}
                                                >
                                                    OneUptime team is one of the
                                                    most experienced web
                                                    developers that I have
                                                    worked with. They handled my
                                                    small project with extra
                                                    attention and was very
                                                    willing to educate me in
                                                    best web protocols.
                                                </div>
                                                <div className="ContextualPopover-arrowContainer">
                                                    <div className="ContextualPopover-arrow--right" />
                                                </div>
                                                <div className="Flex-flex Flex-direction--row Flex-alignItems--center">
                                                    <div
                                                        className="db-ListItem-icon"
                                                        style={{
                                                            borderRadius:
                                                                '100%',
                                                            marginLeft: '10px',
                                                            marginRight: '10px',
                                                            backgroundImage:
                                                                'url("/dashboard/assets/img/nikki.jpeg")',
                                                            backgroundSize:
                                                                'cover',
                                                            flex: 'none',
                                                        }}
                                                    />
                                                    <div className="Flex-flex Flex-direction--row">
                                                        <div>
                                                            <div>
                                                                Nikki Durkin
                                                            </div>
                                                            <div>
                                                                CEO, CodeMakers
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="Flex-flex Flex-direction--row Padding-all--12">
                                            <div className="Flex-flex Flex-direction--row bs-Carousel Flex-alignItems--center Flex-justifyContent--center">
                                                <div
                                                    className="Padding-all--32 Card-shadow--clear"
                                                    style={{
                                                        width: '400px',
                                                        height: '200px',
                                                    }}
                                                >
                                                    OneUptime team was very
                                                    skillful, They were always
                                                    open to feedback and helped
                                                    me troubleshoot issues that
                                                    weren&#39;t necessarily a
                                                    part of the contract.
                                                    Delivered on time.
                                                </div>
                                                <div className="ContextualPopover-arrowContainer">
                                                    <div className="ContextualPopover-arrow--right" />
                                                </div>
                                                <div className="Flex-flex Flex-direction--row Flex-alignItems--center">
                                                    <div
                                                        className="db-ListItem-icon db-SideNav-icon--engineer border"
                                                        style={{
                                                            borderRadius:
                                                                '100%',
                                                            marginLeft: '10px',
                                                            marginRight: '10px',
                                                            backgroundImage:
                                                                'url("/dashboard/assets/img/matt.jpeg")',
                                                            backgroundSize:
                                                                'cover',
                                                            flex: 'none',
                                                        }}
                                                    />
                                                    <div className="Flex-flex Flex-direction--row">
                                                        <div>
                                                            <div>
                                                                Matt Wilcox
                                                            </div>
                                                            <div>
                                                                CTO, Lunalights
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className=" Flex-flex Flex-direction--row Padding-all--12">
                                            <div className="Flex-flex Flex-direction--row bs-Carousel Flex-alignItems--center Flex-justifyContent--center">
                                                <div
                                                    className="Padding-all--32 Card-shadow--clear"
                                                    style={{
                                                        width: '400px',
                                                        height: '200px',
                                                    }}
                                                >
                                                    Your tech team often was
                                                    able to offer expert advice
                                                    on topics that I had not
                                                    considered. Nawaz was
                                                    definitely added value to
                                                    this project and I look
                                                    forward to working with him
                                                    in the future.
                                                </div>
                                                <div className="ContextualPopover-arrowContainer">
                                                    <div className="ContextualPopover-arrow--right" />
                                                </div>
                                                <div className="Flex-flex Flex-direction--row Flex-alignItems--center">
                                                    <div
                                                        className="db-ListItem-icon db-SideNav-icon--engineer"
                                                        style={{
                                                            borderRadius:
                                                                '100%',
                                                            marginLeft: '10px',
                                                            marginRight: '10px',
                                                            backgroundImage:
                                                                'url("/dashboard/assets/img/pratap.jpeg")',
                                                            backgroundSize:
                                                                'cover',
                                                            flex: 'none',
                                                        }}
                                                    />
                                                    <div className="Flex-flex Flex-direction--row">
                                                        <div>
                                                            <div>
                                                                Pratap Shergill
                                                            </div>
                                                            <div>
                                                                CEO, PetCloud
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </Slider>
                                </div>
                                <div className="Flex-direction--row Text-align--center Padding-bottom--48 Padding-top--48">
                                    <div className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                        Have a project for us?
                                    </div>
                                    <div className="Padding-all--20">
                                        <a
                                            href="mailto: consulting@oneuptime.com"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="bs-Button bs-Button--blue"
                                        >
                                            <span>Let&#39;s Chat</span>
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}


Consulting.displayName = 'Consulting';


Consulting.propTypes = {
    location: PropTypes.shape({ pathname: PropTypes.string }),
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapStateToProps = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

export default connect(mapStateToProps)(Consulting);
