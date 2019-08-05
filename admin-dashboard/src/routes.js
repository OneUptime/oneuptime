import pages from './pages';

const {
	DashboardView
} = pages;

export const groups = [
	{
		group: 'Products',
		visible: true,
		routes: [
			{
				title: 'Dashboard',
				path: '/',
				icon: 'atlas',
				component: DashboardView,
				visible: true,
				subRoutes: [],
				index: 1
			},
		]
	},
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
