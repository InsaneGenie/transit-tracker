/** The "How to use" guide, shared by the website and the app so both say the same thing. */
export type GuideSection = { title: string; points: string[] };

export const GUIDE: GuideSection[] = [
  {
    title: 'The map',
    points: [
      'Every dot is a subway train, rail train or bus, moving where it is right now. Its color is its line’s color.',
      'Zoom in to see them. Vehicles are hidden while the whole city fits on the screen.',
      'Closer in, arrows show which way each one is heading, and their line names appear on the dots.',
      'Subway trains don’t send GPS, so they are placed from their arrival times. A vehicle’s card says which kind of position it has.',
    ],
  },
  {
    title: 'Show only what you want',
    points: [
      'Subway, Rail and Bus switch each kind on or off.',
      'Lines lists every line. Tap some to show only those; their routes and stations are drawn on the map.',
      'Type in the bus search to find a route, such as M15 or Q44. Show all brings every line back.',
      'Your picked lines are remembered for next time.',
    ],
  },
  {
    title: 'Tap a train or bus',
    points: [
      'Its card shows the line, where it is going, and its next stops with arrival times.',
      'Its whole route and stations are drawn on the map.',
      'Follow keeps the map moving with it. Drag the map to stop following.',
      'All stations lists every station on its line, in the direction it is going. Tapping its drawn route does the same.',
    ],
  },
  {
    title: 'Stations',
    points: [
      'Tap a stop in the list, or a station on the map, to bring it to the middle of the map.',
      'Its card lists the vehicles of that line on their way there, in both directions. Tap one to jump to it.',
      'The colored badges are the lines you can change to there. Show transfer lines draws them on the map.',
      'Tap a transfer badge to see that line on its own. Back returns you to where you were.',
      'Stations of the lines you picked in Lines can be tapped too; that line opens at the station.',
    ],
  },
  {
    title: 'Good to know',
    points: [
      'Positions and arrival times come from the MTA’s live feeds and refresh every few seconds. Times are predictions and can change.',
      'The location button takes the map to where you are.',
      'The map turns dark after sunset.',
      'If the map stays empty at first, give it a minute; the server may be waking up.',
    ],
  },
];
