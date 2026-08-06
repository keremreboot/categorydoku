// The nine symbol classes that replace sudoku's nine digits.
//
// A cell no longer says "3", it shows *some* member of category 3. Every icon
// in a set is interchangeable, so reading the board means recognising what a
// thing *is* rather than matching a glyph. Boards smaller than 9x9 use the
// first N categories, which is why the distinctive ones come first.

// Tints are only shown in the optional assist mode, where they are laid over
// cream paper at low opacity -- so they are picked for separation at a glance
// rather than for the newsprint palette.
export const CATEGORIES = [
  { name: 'Animals', tint: '#b5651d', icons: ['🐘', '🦁', '🐢', '🦊', '🐸', '🦉'] },
  { name: 'Fruit', tint: '#c62828', icons: ['🍎', '🍌', '🍇', '🍓', '🍍', '🍒'] },
  { name: 'Vehicles', tint: '#1565c0', icons: ['🚗', '🚲', '✈️', '🚂', '🚀', '⛵'] },
  { name: 'Sports', tint: '#2e7d32', icons: ['⚽', '🏀', '🎾', '🏈', '⚾', '🏓'] },
  { name: 'Music', tint: '#8e24aa', icons: ['🎸', '🎹', '🎺', '🥁', '🎻', '🎤'] },
  { name: 'Weather', tint: '#00acc1', icons: ['☀️', '🌧️', '❄️', '⛈️', '🌈', '🌪️'] },
  { name: 'Tools', tint: '#546e7a', icons: ['🔨', '🔧', '⚙️', '🔩', '⛏️', '🪓'] },
  { name: 'Space', tint: '#3949ab', icons: ['🪐', '🌙', '⭐', '☄️', '🔭', '🛸'] },
  { name: 'Plants', tint: '#9e9d24', icons: ['🌵', '🌻', '🌳', '🍀', '🌷', '🍄'] },
];

export const VARIANTS = CATEGORIES[0].icons.length;

/** Values on the board are 1-based, matching sudoku's 1..N. */
export function category(v) {
  return CATEGORIES[v - 1];
}

export function glyph(v, variant) {
  const c = category(v);
  return c ? c.icons[variant % c.icons.length] : '?';
}
