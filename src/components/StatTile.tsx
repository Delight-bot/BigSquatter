import type { ReactNode } from 'react';

interface StatTileProps {
  label: string;
  value: ReactNode;
  accent?: 'default' | 'streak';
}

export function StatTile({ label, value, accent = 'default' }: StatTileProps) {
  return (
    <div className="stat">
      <span className={accent === 'streak' ? 'stat__value streak' : 'stat__value'}>{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
