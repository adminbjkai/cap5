import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

type FeedbackMessageProps = {
  type: 'empty' | 'error' | 'loading';
  title?: string;
  message?: string;
  /** Optional CTA rendered below the message */
  action?: ReactNode;
  className?: string;
};

const icons = {
  empty: (
    <svg className="h-6 w-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
      />
    </svg>
  ),
  error: (
    <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
      />
    </svg>
  ),
  loading: null,
};

export function FeedbackMessage({
  type,
  title,
  message,
  action,
  className = '',
}: FeedbackMessageProps) {
  if (type === 'loading') {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 py-12 text-center ${className}`}>
        <Spinner size="lg" className="text-blue" />
        {title && <p className="text-sm font-medium text-foreground">{title}</p>}
        {message && <p className="text-xs text-muted">{message}</p>}
        {action}
      </div>
    );
  }

  const icon = icons[type];
  const isError = type === 'error';

  return (
    <div
      className={`panel-subtle flex flex-col items-center justify-center gap-3 py-14 text-center ${isError ? 'border-red-200 dark:border-red-900/50' : ''} ${className}`}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted">
          {icon}
        </div>
      )}
      {title && (
        <p className={`text-sm font-semibold ${isError ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
          {title}
        </p>
      )}
      {message && <p className="max-w-xs text-xs text-muted">{message}</p>}
      {action}
    </div>
  );
}
