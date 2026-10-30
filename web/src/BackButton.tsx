/** Back to what the panel showed before the last tap in it. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="panel-back" onClick={onClick} title={`Back to ${label}`}>
      <span className="panel-back-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M13 8H3.5M7.5 3.5 3 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="panel-back-text">
        <strong>Back</strong> to {label}
      </span>
    </button>
  );
}
