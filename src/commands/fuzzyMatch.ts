export interface FuzzyResult {
  score: number;
  matchIndices: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const matchIndices: number[] = [];
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matchIndices.push(ti);
      // Bonus for consecutive matches
      score += lastMatchIndex === ti - 1 ? 2 : 1;
      // Bonus for matching at start or after separator
      if (ti === 0 || target[ti - 1] === ' ') score += 1;
      lastMatchIndex = ti;
      qi++;
    }
  }

  if (qi < q.length) return null;

  // Penalize longer targets (prefer shorter, more precise matches)
  score -= t.length * 0.01;

  return { score, matchIndices };
}
