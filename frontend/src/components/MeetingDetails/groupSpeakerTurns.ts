type TimedSpeech = {start: number; end: number; text: string; speaker: number; overlap: boolean};

export function groupSpeakerTurns<T extends TimedSpeech>(rows: T[]) {
  const groups = rows.map(row => ({row, interjections: [] as T[]}));
  const nested = new Set<T>();
  for (const clip of rows) {
    if (!clip.overlap || clip.text) continue;
    let bestOverlap = 0;
    let parent: typeof groups[number] | undefined;
    for (const group of groups) {
      const main = group.row;
      if (main.overlap || main.speaker === clip.speaker) continue;
      const overlap = Math.min(main.end, clip.end) - Math.max(main.start, clip.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        parent = group;
      }
    }
    if (parent) {
      parent.interjections.push(clip);
      nested.add(clip);
    }
  }
  return groups.filter(group => !nested.has(group.row));
}
