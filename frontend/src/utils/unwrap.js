/**
 * Normalises the backend's ApiResponse envelope.
 * Backend commonly returns { data: <payload> } or paginated { data: { docs, totalDocs, page, ... } }.
 */

export function unwrapData(response) {
    const d = response?.data?.data;
    return d === undefined ? null : d;
}

export function unwrapList(response) {
    const d = unwrapData(response);
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.docs)) return d.docs;
    if (Array.isArray(d?.videos)) return d.videos;
    if (Array.isArray(d?.items)) return d.items;
    if (Array.isArray(d?.results)) return d.results;
    if (Array.isArray(d?.comments)) return d.comments;
    if (Array.isArray(d?.tweets)) return d.tweets;
    return [];
}

export function unwrapPagination(response) {
    const d = unwrapData(response) || {};
    return {
        items: unwrapList(response),
        page: Number(d.page ?? d.currentPage ?? 1),
        totalPages: Number(d.totalPages ?? d.pages ?? 1),
        totalDocs: Number(d.totalDocs ?? d.total ?? 0),
        hasNextPage: Boolean(
            d.hasNextPage ?? (d.page && d.totalPages && d.page < d.totalPages)
        ),
    };
}
