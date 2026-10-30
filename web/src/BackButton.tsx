/** Back to what the panel showed before the last tap in it. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="link panel-back" onClick={onClick} title={`Back to ${label}`}>
      ‹ Back to {label}
    </button>
  );
}
