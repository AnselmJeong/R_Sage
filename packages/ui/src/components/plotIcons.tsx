// Line icons for the plot pane toolbar, drawn to match Positron's codicons.

const I = (d: JSX.Element) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    {d}
  </svg>
);

export const PlotIcon = {
  tidy: I(
    <>
      <path d="M2.5 13.5 9 7" />
      <path d="M8 6l2 2" />
      <path d="M11.5 1.5v3M10 3h3M13.5 7v2M12.5 8h2M5.5 2v2M4.5 3h2" />
    </>,
  ),
  back: I(<path d="M10 3.5 5.5 8l4.5 4.5" />),
  forward: I(<path d="M6 3.5 10.5 8 6 12.5" />),
  save: I(
    <>
      <path d="M3 2.5h8l2.5 2.5v8.5H3z" />
      <path d="M5.5 2.5v3h4.5v-3M5 13.5V9.5h6v4" />
    </>,
  ),
  copy: I(
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>,
  ),
  zoom: I(
    <>
      <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
      <rect x="5.5" y="5.5" width="5" height="5" rx="0.5" />
    </>,
  ),
  size: I(
    <>
      <rect x="2.5" y="4" width="11" height="8" rx="1" />
      <path d="M5 4v2.5M7.5 4v1.5M10 4v2.5" />
    </>,
  ),
  filter: I(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
    </>,
  ),
  code: I(<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />),
  history: I(
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M2.5 10.5h11M6 10.5v3M9.5 10.5v3" />
    </>,
  ),
  close: I(<path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />),
  clear: I(
    <>
      <path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.7 9h5.6l.7-9" />
      <path d="M7 7v4M9 7v4" />
    </>,
  ),
  chevron: (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="caret">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  ),
};
