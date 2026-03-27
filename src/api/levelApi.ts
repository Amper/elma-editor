export interface LevelSearchResult {
  LevelIndex: number;
  LevelName: string;
  LongName: string;
  Added: string;
  Apples: number;
  Killers: number;
  Besttime: number | null;
  KuskiData: { Kuski: string; Country: string } | null;
}

export interface LevelSearchResponse {
  rows: LevelSearchResult[];
  count: number;
}

export async function searchLevels(
  query: string,
  offset = 0,
  limit = 50,
): Promise<LevelSearchResponse> {
  const params = new URLSearchParams({ q: query, offset: String(offset), limit: String(limit) });
  const res = await fetch(`https://api.elma.online/api/level?${params}`);
  if (!res.ok) throw new Error(`Level search failed: ${res.status}`);
  return res.json();
}

export async function fetchLevelByIndex(levelIndex: number): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.elma.online/dl/level/${levelIndex}`);
  if (!res.ok) throw new Error(`Level download failed: ${res.status}`);
  return res.arrayBuffer();
}

export async function fetchLevelData(levelIndex: number): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.elma.online/api/level/leveldata/${levelIndex}`);
  if (!res.ok) throw new Error(`Level data fetch failed: ${res.status}`);
  const json: { LevelData: { data: number[] } } = await res.json();
  return new Uint8Array(json.LevelData.data).buffer;
}
