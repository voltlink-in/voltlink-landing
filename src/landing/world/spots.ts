// The places in the miniature that answer a hover or a click, and what they say. Kept apart from the scene so the
// page can show the words without loading Three.js. Every line restates something the page already says VoltLink does.

export type SpotId =
  | 'bay1'
  | 'bay2'
  | 'bay3'
  | 'reception'
  | 'pickup'
  | 'truck'
  | 'roadside'
  | 'handover'
  | 'ride'
  | 'parked0'
  | 'parked1'
  | 'parked2'
  | 'parked3';

/** What a spot is doing right now, for the spots whose story moves on. */
export type SpotNote = 'home' | 'out' | 'call' | 'back' | 'queued' | 'away' | 'coming' | null;

export interface SpotCopy {
  kicker: string;
  title: string;
  body: string;
  notes?: Partial<Record<Exclude<SpotNote, null>, string>>;
}

const PARKED: SpotCopy = {
  kicker: 'Customer parking',
  title: 'Saved to the account',
  body: 'Owners add a bike or scooter once, and every service after that already knows it.',
};

export const SPOTS: Record<SpotId, SpotCopy> = {
  bay1: {
    kicker: 'Bay 1',
    title: 'Servicing & repairs',
    body: 'A motorcycle goes up on the lift. Its job moves across the workshop board, from under inspection to in progress.',
  },
  bay2: {
    kicker: 'Bay 2',
    title: 'Under inspection',
    body: 'The rider described the problem in their own words, and approves the estimate before any work begins.',
  },
  bay3: {
    kicker: 'Bay 3',
    title: 'Final check',
    body: 'A mechanic takes the bike round the block before it goes back to its owner.',
    notes: { away: 'Out on its test ride now. Watch it come back in.', queued: 'Leaves on its test ride once the truck is back.' },
  },
  reception: {
    kicker: 'Reception',
    title: 'Garage portal',
    body: 'Service orders, quotations, the workshop board and billing, all run from the garage portal.',
  },
  pickup: {
    kicker: 'Forecourt',
    title: 'Pickup & drop-off',
    body: 'A garage collects the bike and brings it back, with a handover code at each end.',
    notes: { out: 'The pickup truck is out on a call.', queued: 'The truck sets off once the test ride is back.' },
  },
  truck: {
    kicker: 'VoltLink pickup',
    title: 'Pickup truck',
    body: 'Parked on the forecourt, ready for the next pickup.',
    notes: {
      out: 'On its way to a rider on the side road.',
      call: 'Loading the scooter onto the truck.',
      back: 'Bringing the scooter back to the garage.',
      queued: 'Sets off as soon as the test ride is back.',
    },
  },
  roadside: {
    kicker: 'Side road',
    title: 'Roadside support',
    body: 'Press SOS and nearby garages get the rider’s location and phone number.',
    notes: { coming: 'The pickup truck is on its way.', queued: 'The truck sets off once the test ride is back.' },
  },
  handover: {
    kicker: 'Drop-off',
    title: 'Handover',
    body: 'The scooter is checked in with a handover code, and another code confirms it on the way back.',
  },
  ride: {
    kicker: 'Bay 3',
    title: 'Test ride',
    body: 'Round the block and back into the bay before the bike goes home.',
  },
  parked0: PARKED,
  parked1: PARKED,
  parked2: PARKED,
  parked3: PARKED,
};

/** The spots a keyboard reaches, in reading order: one per place, not one per parked bike. */
export const SPOT_ORDER: SpotId[] = ['bay1', 'bay2', 'bay3', 'reception', 'pickup', 'handover', 'parked0', 'roadside', 'truck'];

export function spotText(id: SpotId, note: SpotNote): string {
  const s = SPOTS[id];
  return (note && s.notes?.[note]) || s.body;
}
