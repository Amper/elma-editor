export interface LgrInfo {
  LGRIndex: number;
  LGRName: string;
  LGRDesc: string;
  FileLink: string;
  PreviewLink: string;
}

export function lgrPreviewUrl(info: LgrInfo): string {
  return `https://space.elma.online/lgr/${info.PreviewLink}`;
}

let cached: LgrInfo[] | null = null;

export async function fetchLgrList(): Promise<LgrInfo[]> {
  if (cached) return cached;
  try {
    const res = await fetch('https://api.elma.online/api/lgr/info');
    if (!res.ok) throw new Error(`LGR list fetch failed: ${res.status}`);
    const data: LgrInfo[] = await res.json();
    cached = data;
    return data;
  } catch (err) {
    console.warn('Failed to fetch LGR list:', err);
    return [];
  }
}
