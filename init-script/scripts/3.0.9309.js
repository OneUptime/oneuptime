const { find, update } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    const statusPages = await find(statusPageCollection, {
        layout: { $exists: true },
    });

    for (let i = 0; i < statusPages.length; i++) {
        const statusPage = statusPages[i];
        const visibleLayout = statusPage.layout.visible;
        const check = visibleLayout.find(item => item.key === 'pastEvents');
        const key = { name: 'Past Scheduled Events', key: 'pastEvents' };
        if (!check) {
            if (statusPage.layout.invisible.length === 0) {
                visibleLayout.splice(8, 0, key);
            } else {
                const penIndex =
                    statusPage.layout.visible.length > 1
                        ? statusPage.layout.visible.length - 1
                        : 0;
                visibleLayout.splice(penIndex, 0, key);
            }
            const layout = { ...statusPage.layout, visible: visibleLayout };
            await update(
                statusPageCollection,
                { _id: statusPage._id },
                { layout }
            );
        }
    }
}

module.exports = run;
