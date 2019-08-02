import React, { Component } from 'react';
import PropTypes from 'prop-types';
import UptimeLegend from './UptimeLegend';
import NoMonitor from './NoMonitor';
import UptimeGraphs from './UptimeGraphs';
import ShouldRender from './ShouldRender';
import Footer from './Footer';
import NotesMain from './NotesMain';
import { API_URL } from '../config';
import moment from 'moment';
import { Helmet } from 'react-helmet';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { getStatusPage, getStatusPageIndividualNote } from '../actions/status';
import { Redirect } from 'react-router-dom';

class Main extends Component {

	componentDidMount() {
		let projectId;
		let url;

		if (window.location.search.substring(1) && window.location.search.substring(1) === 'embedded=true') {
			document.getElementsByTagName('html')[0].style.background = 'none transparent';
		}
		if (window.location.href.indexOf('localhost') > -1 || window.location.href.indexOf('fyipeapp.com') > 0) {
			projectId = window.location.host.split('.')[0];
			url = 'null';
		}
		else {
			projectId = 'null';
			url = window.location.host;
		}
		this.props.getStatusPage(projectId, url);
	}
	
	groupBy(collection, property) {
		var i = 0, val, index,
			values = [], result = [];
		for (; i < collection.length; i++) {
			val =  collection[i][property] ? collection[i][property]['name'] :'no-category';
			index = values.indexOf(val);
			if (index > -1)
				result[index].push(collection[i]);
			else {
				values.push(val);
				result.push([collection[i]]);
			}
		}
		return result;
	}

	groupedMonitors = () => {
		if (this.props.statusData && this.props.statusData.monitorIds != undefined && this.props.statusData.monitorIds.length > 0) {
			let monitorData = this.props.statusData.monitorIds;
			let groupedMonitorData = this.groupBy(monitorData, 'monitorCategoryId')
			let monitorCategoryStyle = {
				display: 'inline-block',
				marginBottom: 10,
				fontSize:10,
				color: '#8898aa',
				fontWeight: 'Bold'
			}
			let monitorCategoryGroupContainerStyle = {
				marginBottom:40
			}
			return groupedMonitorData.map((groupedMonitors, i) => {
				return (<div key={i} style = {monitorCategoryGroupContainerStyle}className="uptime-graph-header">
					<div style={monitorCategoryStyle}>
						<span>{groupedMonitors[0].monitorCategoryId ? groupedMonitors[0].monitorCategoryId.name.toUpperCase() : 'Uncategorized'.toUpperCase()}</span>
					</div>
					{groupedMonitors.map((monitor, i) => {
						return (<UptimeGraphs monitor={monitor} key={i} />)
					})}
				</div>)
			})
		} else {
			return <NoMonitor />
		}
	}
	render() {
		const { loginRequired } = this.props.login

		const date = new Date();
		let view = false;
		let status = '';
		let statusMessage = '';
		let faviconurl = '';
		let isGroupedByMonitorCategory = false;

		if (this.props.statusData && this.props.statusData.monitorIds) {

			let count = this.props.statusData.monitorIds.length;
			isGroupedByMonitorCategory = this.props.statusData.isGroupedByMonitorCategory;

			this.props.statusData.monitorIds.forEach((el) => {
				if (el.stat !== 'online') {
					count--;
				}
			});
			if (count === this.props.statusData.monitorIds.length) {
				status = 'status-bubble status-up';
				statusMessage = 'All services are online';
				faviconurl = '/greenfavicon.ico';
			}
			else if (count === 0) {
				status = 'status-bubble status-down';
				statusMessage = 'All services are offline';
				faviconurl = '/redfavicon.ico';
			}
			else if (count < this.props.statusData.monitorIds.length) {
				status = 'status-bubble status-paused';
				statusMessage = 'Some services are offline';
				faviconurl = '/yellowfavicon.ico';
			}
			view = true;
		}

		return (
			<div>
				{view ? <div className="innernew">
					<div className="header clearfix">
						<div className="heading">
							{this.props.statusData && this.props.statusData.logoPath ? <span><img src={`${API_URL}/file/${this.props.statusData.logoPath}`} alt="" className="logo" /></span> : ''}
						</div>
					</div>
					<div className="content">
						<div className="white box">
							<div className="largestatus">
								<span className={status}></span>
								<div className="title-wrapper">
									<span className="title">{statusMessage}</span>
									<label className="status-time">
										As of <span className="current-time">{moment(date).format('LLLL')}</span>
									</label>
								</div>
							</div>

							<div className="statistics">
								<div className="inner-gradient"></div>
								<div className="uptime-graphs box-inner">
									{isGroupedByMonitorCategory ? this.groupedMonitors()
										: (this.props.statusData && this.props.statusData.monitorIds != undefined && this.props.statusData.monitorIds.length > 0 ? this.props.statusData.monitorIds.map((monitor, i) => <UptimeGraphs monitor={monitor} key={i} />) : <NoMonitor />)
									}
								</div>
								{this.props.statusData && this.props.statusData.monitorIds != undefined && this.props.statusData.monitorIds.length > 0 ? <UptimeLegend /> : ''}
							</div>
						</div>
					</div>
					<Helmet>
						{this.props.statusData && this.props.statusData.faviconPath ? <link rel="shortcut icon" href={`${API_URL}/file/${this.props.statusData.faviconPath}`} /> : <link rel="shortcut icon" href={faviconurl} />}
						<title>{this.props.statusData && this.props.statusData.title ? this.props.statusData.title : 'Status page'}</title>
						<script src="/js/landing.base.js" type="text/javascript"></script>
					</Helmet>
					<ShouldRender if={this.props.statusData && this.props.statusData.projectId && this.props.statusData._id}>
						<NotesMain projectId={this.props.statusData.projectId._id} statusPageId={this.props.statusData._id} />
					</ShouldRender>
					<div id="footer">
						<ul>
							<ShouldRender if={this.props.statusData && this.props.statusData.copyright}>
								<li> <span>&copy;</span> {this.props.statusData && this.props.statusData.copyright ? this.props.statusData.copyright : ''}</li>
							</ShouldRender>
							<ShouldRender if={this.props.statusData && this.props.statusData.links && (this.props.statusData.links).length}>
								{this.props.statusData && this.props.statusData.links && this.props.statusData.links.map((link, i) => <Footer link={link} key={i} />)}
							</ShouldRender>
						</ul>

						<p><a href="https://fyipe.com" target="_blank" rel="noopener noreferrer">Powered by Fyipe</a></p>
					</div>
				</div> : ''}

				<ShouldRender if={this.props.status && this.props.status.requesting}>
					<div> error</div>
					<div
						id="app-loading"
						style={{
							'position': 'fixed',
							'top': '0',
							'bottom': '0',
							'left': '0',
							'right': '0',
							'backgroundColor': '#e6ebf1',
							'zIndex': '999',
							'display': 'flex',
							'justifyContent': 'center',
							'alignItems': 'center'
						}}
					>
						<div style={{ 'transform': 'scale(2)' }}>
							<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="bs-Spinner-svg">
								<ellipse cx="12" cy="12" rx="10" ry="10" className="bs-Spinner-ellipse"></ellipse>
							</svg>
						</div>
					</div>
				</ShouldRender>

				<ShouldRender if={this.props.login.error}>
					<div>error</div>
					<div id="app-loading">
						<div>{this.props.login.error}</div>
					</div>
				</ShouldRender>

				<ShouldRender if={this.props.status.error}>
					<div>error</div>
					<div id="app-loading">
						<div>{this.props.status.error}</div>
					</div>
				</ShouldRender>

				<ShouldRender if={this.props.status && this.props.status.error && this.props.status.error !== 'Project Not present' && this.props.status.error !== 'No Monitors Added yet'}>
					<div>error</div>
					<div id="app-loading">
						<div>Cannot connect to server.</div>
					</div>
				</ShouldRender>
				<ShouldRender if={loginRequired}>
					<div>error</div>
					<div id="app-loading">
						<div>The status page you are trying to access is private, taking you to login,<Redirect to="/login" /></div>
					</div>
				</ShouldRender>
				<ShouldRender if={this.props.status && this.props.status.error && this.props.status.error === 'Project Not present'}>
					<div> error</div>
					<div id="app-loading">
						<div>Invalid Project.</div>
					</div>
				</ShouldRender>
			</div>
		);
	}
}

Main.displayName = 'Main';

const mapStateToProps = (state) => ({
	status: state.status,
	statusData: state.status.statusPage,
	login: state.login,
});

const mapDispatchToProps = (dispatch) => bindActionCreators({
	getStatusPage,
	getStatusPageIndividualNote,
}, dispatch);

Main.propTypes = {
	statusData: PropTypes.object,
	status: PropTypes.object,
	getStatusPage: PropTypes.func,
	login: PropTypes.object.isRequired,
}

export default connect(mapStateToProps, mapDispatchToProps)(Main);