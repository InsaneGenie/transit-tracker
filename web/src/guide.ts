/**
 * The "How to use" guide: a few pages, each a picture and one line, shared by the website and the
 * app so both say the same thing. Page i shows picture i from guideArt.ts. It is an overview only:
 * features explain themselves with a one-time tip where they live (tips.ts), so a new feature gets
 * a tip there rather than another page here.
 */
export type GuideStep = { title: string; text: string };

export const GUIDE: GuideStep[] = [
  {
    title: 'Zoom in to see live vehicles',
    text: 'Every icon is a train, bus or ferry where it is right now, in its line’s color.',
  },
  {
    title: 'Tap a train or bus',
    text: 'See its next stops, any delays, and whether your transfer will connect.',
  },
  {
    title: 'Tap a station',
    text: 'See what’s coming both ways. Alert me tells you when to leave to catch it.',
  },
  {
    title: 'Star the lines you ride',
    text: 'In Lines, tap ☆ and the map shows only your lines.',
  },
  {
    title: 'Open a line',
    text: 'See every station, its trains or buses moving along, and how it’s running today.',
  },
];

/** Said on the last page. */
export const GUIDE_NOTE = 'Short tips show up the first time you use each part.';
