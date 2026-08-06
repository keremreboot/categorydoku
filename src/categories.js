// The categories. One is assigned to each box of the grid, and that box then
// holds nine *different* members of it -- so every set needs exactly nine, and
// they have to stay tellable apart at about 30 pixels.
//
// No picture appears in two categories: a rocket is a vehicle, never a space
// thing, or the board would be ambiguous.
//
// Nothing is colour-coded. Working out that a fox and an owl are the same kind
// of thing is the puzzle -- a colour per category would just hand it over.
//
// Every glyph here is Unicode 12 or older. Windows 10 ships an emoji font that
// stops there, and a missing glyph is not a cosmetic problem -- it draws as an
// empty box, which is an unreadable square. Check any replacement on the
// oldest target you care about before swapping it in.
export const CATEGORIES = [
  { name: 'Animals', icons: ['🐘', '🦁', '🐢', '🦊', '🐸', '🦉', '🐧', '🐍', '🦌'] },
  { name: 'Fruit', icons: ['🍎', '🍌', '🍇', '🍓', '🍍', '🍒', '🥝', '🍑', '🥥'] },
  { name: 'Vehicles', icons: ['🚗', '🚲', '✈️', '🚂', '🚀', '⛵', '🚁', '🛵', '🚜'] },
  { name: 'Sports', icons: ['⚽', '🏀', '🎾', '🏈', '⚾', '🏓', '🏐', '🥊', '⛳'] },
  { name: 'Music', icons: ['🎸', '🎹', '🎺', '🥁', '🎻', '🎤', '🎷', '🪕', '🎧'] },
  { name: 'Weather', icons: ['☀️', '🌧️', '❄️', '⛈️', '🌈', '🌪️', '☁️', '🌩️', '💨'] },
  { name: 'Tools', icons: ['🔨', '🔧', '⚙️', '🔩', '⛏️', '🪓', '✂️', '🧰', '📏'] },
  { name: 'Space', icons: ['🪐', '🌙', '⭐', '☄️', '🔭', '🛸', '🌍', '🌌', '👽'] },
  { name: 'Plants', icons: ['🌵', '🌻', '🌳', '🍀', '🌷', '🍄', '🌹', '🌴', '🌾'] },
];

/** Members per category. A 3 x 3 box has nine squares, so this must be nine. */
export const MEMBERS = 9;

/** Board values are 1-based, so that 0 can mean "empty". */
export function category(v) {
  return CATEGORIES[v - 1];
}

export function glyph(v, member) {
  const c = category(v);
  return c ? c.icons[member % c.icons.length] : '?';
}
