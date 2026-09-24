export function renumberKnowledgeResult(result, offset = 0) {
    const sources = result?.knowledgeSources;
    if (!Array.isArray(sources) || !sources.length) return { result, nextOffset: offset };

    const ids = new Map();
    const knowledgeSources = sources.map((source, index) => {
        const citationId = `AV${offset + index + 1}`;
        ids.set(source.citationId, citationId);
        return { ...source, citationId };
    });
    const context = String(result.context || "").replace(/\[(AV[1-9]\d*)\]/g, (text, id) =>
        ids.has(id) ? `[${ids.get(id)}]` : text
    );

    return {
        result: { ...result, context, knowledgeSources },
        nextOffset: offset + sources.length,
    };
}
