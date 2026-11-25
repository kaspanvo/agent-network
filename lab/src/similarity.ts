const STOPWORDS = new Set(
  "a an and are as at be but by for from i i'd i'm if in is it it's of on or our s so that the this to up we we'd we're with would".split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

// TF-IDF cosine similarity of every query against every document.
export function cosineSimilarities(queries: string[], docs: string[]): number[][] {
  const tokenized = [...queries, ...docs].map(tokenize);
  const df = new Map<string, number>();
  for (const tokens of tokenized) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = tokenized.length;

  const vectors = tokenized.map((tokens) => {
    const v = new Map<string, number>();
    for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1);
    for (const [t, tf] of v) v.set(t, tf * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1));
    return v;
  });
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
  const cosine = (a: Map<string, number>, b: Map<string, number>) => {
    let dot = 0;
    for (const [t, x] of a) dot += x * (b.get(t) ?? 0);
    const denom = norm(a) * norm(b);
    return denom === 0 ? 0 : dot / denom;
  };

  return queries.map((_, i) => docs.map((_, j) => cosine(vectors[i]!, vectors[queries.length + j]!)));
}
