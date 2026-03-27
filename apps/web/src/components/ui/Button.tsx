import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'icon';
type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-700 text-white hover:bg-accent-600 focus-visible:ring-accent-700 disabled:bg-accent-700/60',
  ghost:
    'bg-transparent text-secondary hover:bg-hover hover:text-foreground focus-visible:ring-blue disabled:text-muted',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 disabled:bg-red-600/60',
  icon: 'bg-transparent text-muted hover:bg-hover hover:text-foreground focus-visible:ring-blue disabled:text-muted/50',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs rounded-md gap-1',
  md: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  lg: 'px-4 py-2 text-base rounded-xl gap-2',
};

const iconSizeClasses: Record<ButtonSize, string> = {
  sm: 'p-1 rounded-md',
  md: 'p-1.5 rounded-lg',
  lg: 'p-2 rounded-xl',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
  'aria-label'?: string;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const isIcon = variant === 'icon';
  const sizeClass = isIcon ? iconSizeClasses[size] : sizeClasses[size];

  return (
    <button
      type="button"
      disabled={disabled ?? loading}
      className={[
        'inline-flex items-center justify-center font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-70',
        variantClasses[variant],
        sizeClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {loading && <Spinner size={size === 'lg' ? 'md' : 'sm'} className="-ml-0.5" />}
      {children}
    </button>
  );
}
