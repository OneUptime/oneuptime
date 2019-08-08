import pages from './pages';

const {
	Users,
	User
} = pages;

export const groups = [
	{
		group: 'Products',
		visible: true,
		routes: [
			{
				title: 'Users',
				path: '/users',
				icon: 'atlas',
				component: Users,
				visible: true,
				subRoutes: [{
					title: 'User',
					path: '/users/:userId',
					icon: 'atlas',
					component: User,
					visible: true,
					subRoutes: [],
					index: 1
				},],
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
