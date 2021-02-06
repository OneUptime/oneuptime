const CRITERIA_TYPES = {
    UP: {
        type: 'up',
        head: 'Monitor Up Criteria',
        tagline:
            'This is where you describe when your monitor is considered up',
        name: 'Online',
    },
    DEGRADED: {
        type: 'degraded',
        head: 'Monitor Degraded Criteria',
        tagline:
            'This is where you describe when your monitor is considered degraded',
        name: 'Degraded',
    },
    DOWN: {
        type: 'down',
        head: 'Monitor Down Criteria',
        tagline:
            'This is where you describe when your monitor is considered down',
        name: 'Offline',
    },
};

export const KUBERNETES_CRITERIA_TYPES = {
    UP: {
        type: 'up',
        head: 'Monitor Up Criteria',
        tagline:
            'This is where you describe when your monitor is considered up',
        name: 'Online',
    },
    DOWN: {
        type: 'down',
        head: 'Monitor Down Criteria',
        tagline:
            'This is where you describe when your monitor is considered down',
        name: 'Offline',
    },
};

export default CRITERIA_TYPES;
