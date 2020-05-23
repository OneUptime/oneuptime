// import React, { Component } from 'react';
// import { Link } from 'react-router-dom';

// class BreadCrumb extends Component {
//     constructor(props) {
//         super(props);
//         this.state = {
//             link: '',
//             project: '',
//             routes: {
//                 components: 'Components',
//                 'status-pages': 'Status Pages',
//                 'on-call': {
//                     'on-call': 'Call Schedules',
//                     'alert-log': 'Alert Log',
//                 },
//                 reports: 'Reports',
//                 team: 'Team Members',
//                 settings: {
//                     settings: 'Project Settings',
//                     monitors: 'Monitors',
//                     integrations: 'Integrations',
//                     emails: 'Emails',
//                     sms: 'SMS',
//                     probe: 'Probe',
//                 },
//             },
//             items: [],
//         };
//     }

//     UNSAFE_componentWillReceiveProps(nextProps) {
//         const { link, project } = nextProps;
//         const urlParts = link.split('/');
//         let currentProject = null;
//         if (project.currentProject) {
//             const title = this.getItemLabel(
//                 urlParts[urlParts.length - 1],
//                 project.currentProject
//             );
//             currentProject = {
//                 project: project.currentProject.name,
//                 item: this.breadCrumbItem(link, title),
//             };
//         } else {
//             currentProject = this.getCurrentNode(nextProps);
//         }
//         this.setState(prevState => {
//             if (prevState.items.length === 0) {
//                 console.log(this.props, '>>>>>>>>>>>>>>>>>>>>');
//                 const prevProject = this.getCurrentNode(nextProps);
//                 return {
//                     project: prevProject
//                         ? prevProject.project
//                         : prevState.project,
//                     items: prevProject ? [prevProject.item] : prevState.items,
//                 };
//             } else {
//                 return {
//                     project: currentProject
//                         ? currentProject.project
//                         : prevState.project,
//                     items: currentProject
//                         ? [prevState[0], currentProject.item]
//                         : prevState.items,
//                 };
//             }
//         });
//     }

//     getCurrentNode(nextProps) {
//         const {
//             link,
//             project: { projects },
//         } = nextProps;
//         const urlParts = link.split('/');
//         const projectId = urlParts[3];
//         const currentProject = projects.projects.find(function(project) {
//             return project._id === projectId;
//         });
//         if (currentProject) {
//             const title = this.getItemLabel(
//                 urlParts[urlParts.length - 1],
//                 currentProject
//             );
//             return {
//                 project: currentProject.name,
//                 item: this.breadCrumbItem(link, title),
//             };
//         }
//         return null;
//     }

//     breadCrumbItem(path, title) {
//         return <Link to={path}>{title}</Link>;
//     }

//     getItemLabel(label, currentProject) {
//         switch (label) {
//             case 'components':
//                 return currentProject.name + ' / Components';
//             case 'status-pages':
//                 return 'Status Pages';
//             default:
//                 return;
//         }
//     }

//     render() {
//         const { link, project, items } = this.state;
//         return (
//             <div className="container">
//                 {items}
//                 {/* <div className="db-AccountSwitcherX-accountImage--content db-AccountSwitcherX-accountImage--fallback" /> */}
//             </div>
//         );
//     }
// }

// export default BreadCrumb;
