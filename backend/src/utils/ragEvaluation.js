export const RAG_EVAL_CASES = [
    { query: "two brothers search for the philosopher's stone", title: /fullmetal alchemist.*brotherhood/i },
    { query: "a pirate crew searches for the one piece", title: /one piece/i },
    { query: "a notebook lets its owner kill by writing names", title: /death note/i },
    { query: "students fight curses using cursed energy", title: /jujutsu kaisen/i },
    { query: "humanity fights giant titans behind walls", title: /attack on titan/i },
    { query: "a viking boy seeks revenge for his father", title: /vinland saga/i },
    { query: "a microwave sends messages into the past", title: /steins;gate/i },
    { query: "a boy protects his demon sister", title: /demon slayer/i },
    { query: "AnimeVerse quarterly revenue in 2042", absent: true },
];

export function scoreRagCases(cases, results, k = 3) {
    const details = cases.map((item, index) => {
        const sources = results[index]?.sources || [];
        const context = results[index]?.context || "";
        const top = sources.slice(0, k);
        const hit = item.absent
            ? sources.length === 0 && !context
            : top.some((source) => item.title.test(source.title || ""));
        const evidenceValid = sources.every((source) =>
            source.citationId && context.includes(`[${source.citationId}]`)
        );
        return {
            query: item.query,
            hit,
            evidenceValid,
            returned: sources.length,
            topTitles: top.map((source) => source.title),
        };
    });
    const positives = details.filter((_, index) => !cases[index].absent);
    return {
        hitAtK: positives.length ? positives.filter((row) => row.hit).length / positives.length : 0,
        negativeEvidencePassed: details.filter((_, index) => cases[index].absent).every((row) => row.hit),
        contextCitationCoverage: details.every((row) => row.evidenceValid),
        details,
    };
}
