import { cva, type VariantProps } from 'class-variance-authority';

export const btnVariants = cva(
  'active:translate-x-0.5 active:translate-y-0.5 flex min-h-[44px] items-center justify-center gap-2 rounded-[2px] px-4 text-[15px] font-bold tracking-[0.01em] transition-colors transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        primary:
          'h-[52px] border-2 border-ink bg-signal-dark text-ticket shadow-[4px_4px_0_#241329] hover:-translate-y-0.5 hover:bg-signal hover:shadow-[6px_6px_0_#241329] disabled:translate-y-0 disabled:border-ink-faint disabled:bg-canvas-deep disabled:text-ink-faint disabled:shadow-none',
        secondary:
          'border-2 border-rule bg-ticket text-ink shadow-[3px_3px_0_#2457FF] hover:bg-electric-tint disabled:text-ink-faint disabled:shadow-none',
        quiet:
          'bg-transparent text-ink-muted underline-offset-4 hover:text-electric hover:underline disabled:text-ink-faint',
        danger:
          'border-2 border-ink bg-danger text-ticket shadow-[4px_4px_0_#241329] hover:bg-signal disabled:opacity-50',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

export type BtnVariant = NonNullable<VariantProps<typeof btnVariants>['variant']>;
