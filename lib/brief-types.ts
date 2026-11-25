/** Daily brief payload. Shared by the server generator and the client card. */
export type BriefContent = {
  date: string;
  /** Hash of the day's events; the cached brief is regenerated when it changes. */
  eventsHash: string;
  stats: {
    meetings: number;
    meetingMinutes: number;
    focusMinutes: number;
    longestFreeBlockMinutes: number;
    conflicts: number;
  };
  headline: string;
  summary: string;
  headsUp: string[];
  prep: { eventId: string; title: string; time: string; note: string }[];
  suggestions: { label: string; prompt: string }[];
  aiGenerated: boolean;
};
