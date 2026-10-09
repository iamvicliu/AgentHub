import type { ReactNode } from 'react'

export const settingsLabelClass = 'text-warm-text dark:text-dark-text text-sm font-medium'
export const settingsDescriptionClass =
  'text-warm-muted dark:text-dark-muted text-xs leading-relaxed'

export function SettingsSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-warm-text dark:text-dark-text text-base leading-6 font-semibold">
      {children}
    </h4>
  )
}

export default function SettingsSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-warm-border dark:border-dark-border border-t pt-5 first:border-t-0 first:pt-0">
      <div className="mb-2">
        <SettingsSectionHeading>{title}</SettingsSectionHeading>
      </div>
      {children}
    </section>
  )
}
