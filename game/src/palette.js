// The look plan, in one place. Duskline Yard is an industrial yard at dusk: a warm amber
// sun low over cool blue-grey steel, with one hot orange accent for the things that matter
// (sites, the bomb, the enemy). Every colour in the game is one of these six names; the same
// six are the CSS custom properties in index.html, so the page and the scene agree.
export const PALETTE = {
  canvas: '#171a21', // dusk sky / page background
  surface: '#232830', // steel panels, walls
  hairline: '#3a4150', // crates, trim, dark concrete
  ink: '#e8e2d4', // warm off-white: floors, lamps, Vanguard cloth
  muted: '#8b93a3', // cool grey-blue: shadows, Raiders cloth is tinted from this
  accent: '#f07a1e', // hot dusk orange: sites, bomb, Raiders, danger
};

export function shade(name) {
  return PALETTE[name];
}

// Team colours, derived from the palette so the two sides read at a glance: Vanguard in
// warm off-white with a cool trim, Raiders in the hot accent with dark steel.
export const TEAM = {
  vanguard: { cloth: '#e8e2d4', trim: '#5f7fa8', name: 'VANGUARD', tag: 'VAN' },
  raider: { cloth: '#c85a20', trim: '#3a4150', name: 'RAIDERS', tag: 'RAI' },
};
