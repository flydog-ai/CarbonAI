/** Carbon mark: open hexagon (graphene C) plus a quartz nucleus. Prototype C. */
export function Mark({ large }: { large?: boolean }) {
  return (
    <span className={large ? "mark lg" : "mark"} aria-hidden="true">
      <CarbonMarkSvg />
    </span>
  );
}

export function CarbonMarkSvg() {
  return (
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Carbon AI">
      <rect width="32" height="32" rx="8" fill="#161b1f" />
      <path
        d="M21 24.66 11 24.66 6 16 11 7.34 21 7.34"
        fill="none"
        stroke="#6ec9c4"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon fill="#6ec9c4" points="18.4,16 17.2,18.078 14.8,18.078 13.6,16 14.8,13.922 17.2,13.922" />
    </svg>
  );
}
