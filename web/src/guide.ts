/** The "How to use" guide, shared by the website and the app so both say the same thing. */
export type GuideSection = { title: string; points: string[] };

export const GUIDE: GuideSection[] = [
  {
    title: 'The map',
    points: [
      'Every icon is a vehicle, moving where it is right now: circles are subway trains, rounded squares are buses and diamonds are LIRR and Metro-North trains. Its color is its line’s color.',
      'Zoom in to see them. Vehicles are hidden while the whole city fits on the screen.',
      'Closer in, a small arrow beside each one shows which way it is heading, the stations of drawn lines get their names, and line names appear beside the icons.',
      'Subway trains don’t send GPS, so they are placed from their arrival times. A vehicle’s card says which kind of position it has.',
    ],
  },
  {
    title: 'Show only what you want',
    points: [
      'Subway, Rail and Bus switch each kind on or off.',
      'Routes draws every subway and rail line’s route on the map, so you can see where each line goes. Bus routes are left out, as there are too many.',
      'Lines lists every line. Tap ☆ on the ones you ride to make them your lines; the map then shows only those, with their routes and stations drawn.',
      'Search finds any line or bus route, such as M15 or Q44. Clear brings every line back to the map.',
      'The Route switch on each of your lines shows its route and vehicles on the map or hides them; tap a line’s badge under My lines to find it. Hide all routes switches them all off at once.',
      'Drag your lines’ badges to put them in the order you like. On a phone, press and hold a badge first.',
      'Your lines are remembered for next time.',
    ],
  },
  {
    title: 'A line’s own page',
    points: [
      'Tap any line in Lines to open its page: how many trains or buses are out, its alerts, and every station.',
      'Its trains or buses move down the strip of stations as they go. Switch direction at the top of the strip.',
      'Tap a train or bus there to jump to it on the map, or a station to open the line there. Show on map shows the whole line.',
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
      'Stations of your lines can be tapped too; that line opens at the station.',
      'A blue wheelchair symbol marks a station that is accessible, with step-free access from the street to the trains. Its card says when only some platforms are, such as one direction only. Every MTA bus is accessible, so bus stops aren’t marked.',
    ],
  },
  {
    title: 'Delays and service changes',
    points: [
      'A train or bus card, and a line’s page, list that line’s MTA alerts: delays, suspensions, and planned work or schedule changes coming up in the next few days.',
      'Tap an alert to read all of it, such as which stops are skipped and what to take instead.',
      'In Lines, each line says whether it has delays, a suspension or a service change right now.',
      'A dot on Lines means one of your lines has trouble.',
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
