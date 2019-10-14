import pages from './pages';

const {
	Settings,
	TeamMembers,
	StatusPage,
	StatusPages,
	Profile,
	OnCall,
	Monitor,
	AlertLog,
	IncidentLog,
	Incident,
	Billing,
	Monitors,
	Schedule,
	Integrations,
	EmailTemplates,
	SmsTemplates,
	Reports,
	MonitorView,
	Probe,
} = pages;

export const groups = [
	{
		group: 'Products',
		visible: true,
		routes: [
			{
				title: 'Monitors',
				path: '/project/:projectId/monitoring',
				icon: 'atlas',
				component: Monitor,
				visible: true,
				subRoutes: [{
					title: 'Incident Log',
					path: '/project/:projectId/incident-log',
					icon: 'radar',
					visible: true,
					subRoutes: [],
					component: IncidentLog,
					index: 1
				}, {
					title: 'Incident',
					path: '/project/:projectId/incidents/:incidentId',
					icon: 'radar',
					visible: true,
					subRoutes: [],
					component: Incident,
					index: 2
				}, {
					title: 'Monitor View',
					path: '/project/:projectId/monitors/:monitorId',
					icon: 'radar',
					visible: true,
					subRoutes: [],
					component: MonitorView,
					index: 3
				}],
				index: 1
			},
			{
				title: 'Status Pages',
				path: '/project/:projectId/status-pages',
				icon: 'radar',
				visible: true,
				subRoutes: [
					{
						title: 'Status Page',
						path: '/project/:projectId/subProject/:subProjectId/status-page/:scheduleId',
						icon: 'radar',
						visible: true,
						subRoutes: [],
						component: StatusPage,
						index: 1
					}
				],
				component: StatusPages,
				index: 2
			},
			{
				title: 'Call Schedules',
				path: '/project/:projectId/on-call',
				icon: 'connect',
				visible: true,
				subRoutes: [{
					title: 'Alert Log',
					path: '/project/:projectId/alert-log',
					icon: 'radar',
					visible: true,
					subRoutes: [],
					component: AlertLog,
					index: 1
				},
				{
					title: 'Schedule',
					path: '/project/:projectId/subProject/:subProjectId/schedule/:scheduleId',
					icon: 'radar',
					visible: true,
					subRoutes: [],
					component: Schedule,
					index: 1
				}],
				component: OnCall,
				index: 3
			},
			{
				title: 'Reports',
				path: '/project/:projectId/reports',
				icon: 'report',
				visible: true,
				subRoutes: [],
				component: Reports,
				index: 4
			}

		]
	},
	{
		group: 'Settings',
		visible: true,
		routes: [
			{
				title: 'Team Members',
				path: '/project/:projectId/team',
				icon: 'customers',
				visible: true,
				component: TeamMembers,
				subRoutes: [],
				index: 1
			},
			{
				title: 'Project Settings',
				path: '/project/:projectId/settings',
				icon: 'businessSettings',
				visible: true,
				subRoutes: [
					{
						title: 'Billing',
						path: '/project/:projectId/billing',
						icon: 'radar',
						visible: true,
						subRoutes: [],
						component: Billing,
						index: 1
					},
					{
						title: 'Monitors',
						path: '/project/:projectId/monitors',
						icon: 'atlas',
						visible: true,
						subRoutes: [],
						component: Monitors,
						index: 2
					},
					{
						title: 'Integrations',
						path: '/project/:projectId/integrations',
						icon: 'radar',
						visible: true,
						subRoutes: [],
						component: Integrations,
						index: 3
					},
					{
						title: 'Email Settings',
						path: '/project/:projectId/emails',
						icon: 'radar',
						visible: true,
						subRoutes: [],
						component: EmailTemplates,
						index: 4
					},
					{
						title: 'SMS Settings',
						path: '/project/:projectId/sms',
						icon: 'radar',
						visible: true,
						subRoutes: [],
						component: SmsTemplates,
						index: 5
					},
					{
						title: 'Probe Settings',
						path: '/project/:projectId/probe',
						icon: 'radar',
						visible: true,
						subRoutes: [],
						component: Probe,
						index: 6
					}
				],
				component: Settings,
				index: 2
			}
		]
	},
	{
		group: 'Profile',
		routes: [
			{
				title: 'Profile Settings',
				path: '/profile/settings',
				icon: 'customers',
				visible: true,
				component: Profile,
				subRoutes: [],
				index: 1
			}
		]
	}
];

const joinFn = (acc = [], curr) => {
	return acc.concat(curr);
};

export const allRoutes = groups
	.map(function merge(group) {
		const { routes } = group;
		const subRoutes = routes.map(route => route.subRoutes).reduce(joinFn);
		return routes.concat(subRoutes);
	})
	.reduce(joinFn);

export const getGroups = () => groups;

export default {
	groups,
	allRoutes
};
