interface SwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function Switch({ label, hint, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>
        <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
        {hint && (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {hint}
          </span>
        )}
      </span>
      <span className="switch__track">
        <span className="switch__knob" />
      </span>
    </button>
  );
}
