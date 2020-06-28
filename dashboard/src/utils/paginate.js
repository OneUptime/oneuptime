/**
 * @description renders a certain amount of content on the page, based on the page number and limit
 * @param {array} items array of contents to be paginated
 * @param {number} page current page
 * @param {nummber} limit maximum amount of content to display
 */

function paginate(items, page = 1, limit = 10) {
    const offset = (page - 1) * limit,
        paginatedItems = items.slice(offset).slice(0, limit),
        total_pages = Math.ceil(items.length / limit);
    return {
        pre_page: page - 1 ? page - 1 : null,
        next_page: total_pages > page ? page + 1 : null,
        data: paginatedItems,
        count: items.length,
    };
}

export default paginate;
