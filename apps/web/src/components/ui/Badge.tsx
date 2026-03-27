type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted';

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-surface-muted text-secondary border border-default',
  success: 'bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-[var(--status-success)] border border-[color-mix(in_srgb,var(--status-success)_28%,transparent)]',
  warning: 'bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] text-[var(--status-warning)] border border-[color-mix(in_srgb,var(--status-warning)_28%,transparent)]',
  danger:  'bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)]  text-[var(--status-danger)]  border border-[color-mix(in_srgb,var(--status-danger)_28%,transparent)]',
  info:    'bg-accent-blue-subtle text-blue border border-blue-border',
  muted:   'bg-surface text-muted border border-default',
};

/** Maps transcription/processing status strings to a badge variant. */
export function statusToBadgeVariant(status: string | undefined): BadgeVariant {
  switch (status) {
    case 'complete':
    case 'ready':
      return 'success';
    case 'processing':
    case 'queued':
    case 'uploading':
    case 'downloading':
      return 'info';
    case 'failed':
    case 'error':
      return 'danger';
    case 'no_audio':
      return 'warning';
    default:
      return 'muted';
  }
}

type BadgeProps = {
  variant?: BadgeVariant;
  /** Convenience shorthand: derive variant from a status string */
  status?: string;
  className?: string;
  children: React.ReactNode;
};

export function Badge({ variant, status, className = '', children }: BadgeProps) {
  const resolvedVariant = variant ?? (status !== undefined ? statusToBadgeVariant(status) : 'default');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${variantClasses[resolvedVariant]} ${className}`}
    >
      {children}
    </span>
  );
}
