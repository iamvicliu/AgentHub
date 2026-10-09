import { useTranslation } from 'react-i18next'

export default function SecurityIntroduction() {
  const { t } = useTranslation()
  return (
    <section
      data-testid="security-introduction"
      className="border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface rounded-[10px] border p-4"
      aria-label={t('security.introduction_title')}
    >
      <h3 className="text-warm-text dark:text-dark-text text-sm font-semibold">
        {t('security.introduction_title')}
      </h3>
      <p className="text-warm-muted dark:text-dark-muted mt-1 text-xs leading-relaxed">
        {t('security.introduction_body')}
      </p>
      <p className="text-warm-muted dark:text-dark-muted mt-2 text-xs leading-relaxed">
        {t('security.introduction_limits')}
      </p>
      <details className="mt-2">
        <summary className="text-warm-text dark:text-dark-text flex min-h-11 cursor-pointer items-center text-xs font-medium">
          {t('security.introduction_more')}
        </summary>
        <div className="text-warm-muted dark:text-dark-muted space-y-2 text-xs leading-relaxed">
          <p>{t('security.introduction_levels')}</p>
          <p>{t('security.introduction_actions')}</p>
          <p>{t('security.introduction_credentials')}</p>
        </div>
      </details>
    </section>
  )
}
