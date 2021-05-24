const { find, update } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        layout: { $exists: true },
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage = statusPages[i];
        const visibleLayout = statusPage.layout.visible;
        const inVisibleLayout = statusPage.layout.invisible;
        const checkVisible = visibleLayout.find(
            item => item.name === 'Scheduled Maintenance Events'
        );
        const checkInVisible = inVisibleLayout.find(
            item => item.name === 'Scheduled Maintenance Events'
        );
        const name = 'Future Scheduled Events';
        if (checkVisible) {
            const checkIndex = visibleLayout.findIndex(
                item => item.name === 'Scheduled Maintenance Events'
            );
            if (checkIndex > -1) {
                visibleLayout[checkIndex].name = name;
            }
        }
        if (checkInVisible) {
            const checkIndex = inVisibleLayout.findIndex(
                item => item.name === 'Scheduled Maintenance Events'
            );
            if (checkIndex > -1) {
                inVisibleLayout[checkIndex].name = name;
            }
        }
        const layout = { visible: visibleLayout, invisible: inVisibleLayout };
        await update(statusPageCollection, { _id: statusPage._id }, { layout });
    }
}

module.exports = run;
