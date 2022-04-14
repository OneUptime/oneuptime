const sortByName: Function = (data: $TSFixMe): void => {
    return data && data.length > 0 ? data.sort(compare) : [];
};

const compare: Function = (a: $TSFixMe, b: $TSFixMe): void => {
    if (!a || !b || !a.name || !b.name) {
        return 0;
    }

    const objectA: $TSFixMe = a.name.toLowerCase();
    const objectB: $TSFixMe = b.name.toLowerCase();

    if (objectA > objectB) {
        return 1;
    }
    if (objectA < objectB) {
        return -1;
    }
    return 0;
};

export default sortByName;
