type Size = 'sm' | 'md' | 'lg';

const sizes: Record<Size, number> = { sm: 12, md: 16, lg: 24 };

type Props = { size?: Size; className?: string };

/** Animated loading spinner that matches the old Svelte design. */
export function Spinner({ size = 'md', className }: Props) {
  const s = sizes[size];
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      className={['sg-spinner', className].filter(Boolean).join(' ')}
      aria-label="Loading"
      role="status"
      style={{ animation: 'sg-spin 0.7s linear infinite' }}
    >
      <circle
        cx={12}
        cy={12}
        r={10}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeDasharray="40 22"
        strokeLinecap="round"
      />
    </svg>
  );
}
