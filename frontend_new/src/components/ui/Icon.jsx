// Inline SVG icon library — fully self-contained, zero deps, tree-shakeable
// Each icon stores the complete SVG path strings as an array (supports multi-path icons)

const ICONS = {
  home:          ['M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z', 'M9 22V12h6v10'],
  explore:       ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z', 'M12 10a2 2 0 110-4 2 2 0 010 4'],
  bell:          ['M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 01-3.46 0'],
  trends:        ['M22 12h-4l-3 9L9 3l-3 9H2'],
  arrowUp:       ['M12 19V5', 'M5 12l7-7 7 7'],
  arrowDown:     ['M12 5v14', 'M19 12l-7 7-7-7'],
  'check-circle':['M22 11.08V12a10 10 0 11-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  'minus-circle':['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', 'M8 12h8'],
  'alert-circle':['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', 'M12 8v4', 'M12 16h.01'],
  'x-circle':    ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', 'M15 9l-6 6', 'M9 9l6 6'],
  'alert-triangle':['M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  // Aliases (used by some pages)
  alert:         ['M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  triangle:      ['M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  satellite:     ['M4 20l4-4', 'M6 14a6 6 0 014 4', 'M9 11a10 10 0 016 6', 'M15 4l5 5', 'M14 5l-3 3', 'M20 9l-3 3'],
  skull:         ['M12 2a9 9 0 110 18', 'M9 12h.01', 'M15 12h.01', 'M9 18v-2', 'M15 18v-2', 'M12 18v-2'],
  flame:         ['M12 2s4 4 4 9a4 4 0 11-8 0c0-5 4-9 4-9z', 'M12 12c1.7 1.6 2 2.5 2 4a2 2 0 11-4 0c0-1.5.7-2.5 2-4z'],
  car:           ['M3 16l1-5a2 2 0 012-2h12a2 2 0 012 2l1 5', 'M5 16v2', 'M19 16v2', 'M7 18a1 1 0 100-2 1 1 0 000 2z', 'M17 18a1 1 0 100-2 1 1 0 000 2z'],
  layers:        ['M12 2l10 6-10 6L2 8l10-6z', 'M2 16l10 6 10-6', 'M2 12l10 6 10-6'],
  sun:           ['M12 1v2', 'M12 21v2', 'M4.22 4.22l1.42 1.42', 'M18.36 18.36l1.42 1.42', 'M1 12h2', 'M21 12h2', 'M4.22 19.78l1.42-1.42', 'M18.36 5.64l1.42-1.42', 'M12 17a5 5 0 100-10 5 5 0 000 10z'],
  moon:          ['M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z'],
  info:          ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', 'M12 16v-4', 'M12 8h.01'],
  x:             ['M18 6L6 18', 'M6 6l12 12'],
  chevronRight:  ['M9 18l6-6-6-6'],
  chevronDown:   ['M6 9l6 6 6-6'],
  mapPin:        ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z', 'M12 13a3 3 0 100-6 3 3 0 000 6'],
  wind:          ['M9.59 4.59A2 2 0 1111 8H2', 'M10.59 11.41A2 2 0 1014 16H2', 'M15.73 8.27A2.5 2.5 0 1119.5 12H2'],
  droplet:       ['M12 2.69l5.66 5.66a8 8 0 11-11.31 0z'],
  thermometer:   ['M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z'],
  search:        ['M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'],
  filter:        ['M22 3H2l8 9.46V19l4 2v-8.54z'],
  edit:          ['M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z'],
  refresh:       ['M1 4v6h6', 'M23 20v-6h-6', 'M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15'],
  arrowRight:    ['M5 12h14', 'M12 5l7 7-7 7'],
  flag:          ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  clipboard:     ['M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2', 'M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z'],
  building:      ['M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z'],
  lock:          ['M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z', 'M7 11V7a5 5 0 0110 0v4'],
  check:         ['M20 6L9 17l-5-5'],
  minus:         ['M5 12h14'],
  plus:          ['M12 5v14', 'M5 12h14'],
  eye:           ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
};

export default function Icon({
  name,
  size = 18,
  color = 'currentColor',
  className = '',
  strokeWidth = 1.75,
  style = {},
}) {
  const paths = ICONS[name];
  if (!paths) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      aria-hidden="true"
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
