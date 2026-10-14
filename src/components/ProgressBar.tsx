interface ProgressBarProps {
  /** 0..100. Values outside the range are clamped. */
  percent: number;
  label?: string;
  done?: boolean;
}

export function ProgressBar({ percent, label, done = false }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div>
      {label && (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="stat__label">{label}</span>
          <span className="stat__label">{clamped}%</span>
        </div>
      )}
      <div
        className="bar"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div
          className={done ? 'bar__fill bar__fill--done' : 'bar__fill'}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
