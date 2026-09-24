const CITATION_PATTERN = /\[AV([1-9]\d*)\]/g;

export function citedSources(answer, citations) {
    if (!Array.isArray(citations) || !answer) return [];
    const byId = new Map(
        citations
            .filter((source) => /^AV[1-9]\d*$/.test(source?.citationId || ""))
            .map((source) => [source.citationId, source])
    );
    const seen = new Set();
    const used = [];
    for (const match of answer.matchAll(CITATION_PATTERN)) {
        const id = `AV${match[1]}`;
        if (!byId.has(id) || seen.has(id)) continue;
        seen.add(id);
        used.push(byId.get(id));
    }
    return used;
}
