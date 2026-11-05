import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Calendar } from '@shared/event-model'
import type { AppLocale, ProviderStatus } from '@shared/ipc-contract'
import HolidayCalendarToggle from './HolidayCalendarToggle'
import ProviderMark from './accounts/ProviderMark'
import { NavRow } from './accounts/AccountViews'
import { ToggleSwitch } from './ui'

/** Where the welcome hands over: a provider to connect, or nowhere. */
export type WelcomeNext = 'google' | 'graph' | 'icloud' | 'caldav' | 'subscription' | null

interface WelcomeDialogProps {
  isOpen: boolean
  language: string
  onSetLanguage: (locale: AppLocale) => void
  showLunar: boolean
  onToggleLunar: (next: boolean) => void
  calendars: Calendar[]
  onCalendarsChanged: () => void
  /** Called once, when the welcome is finished; `launchAtLogin` is what was ticked. */
  onFinish: (next: WelcomeNext, launchAtLogin: boolean) => void
}

const CONNECTABLE: Exclude<WelcomeNext, null>[] = ['google', 'graph', 'icloud', 'caldav', 'subscription']

/**
 * Three short steps the first time xrncal opens: the language, a few basics
 * (lunar dates, holidays, starting with the computer), and the calendars to
 * bring in. Every step can be changed later in Settings; "Not now" on the last
 * one leaves a working calendar on this computer.
 */
export const WelcomeDialog: React.FC<WelcomeDialogProps> = ({
  isOpen,
  language,
  onSetLanguage,
  showLunar,
  onToggleLunar,
  calendars,
  onCalendarsChanged,
  onFinish
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  // Ticked by default here, where it is explained: a calendar's reminders are
  // only any use if it is running.
  const [launchAtLogin, setLaunchAtLogin] = useState(true)
  const [status, setStatus] = useState<ProviderStatus>({ google: true, microsoft: true })

  useEffect(() => {
    if (!isOpen) return
    window.xrncal?.auth
      ?.providerStatus?.()
      .then(setStatus)
      .catch(() => {})
  }, [isOpen])

  if (!isOpen) return null

  const needsSetup = (p: Exclude<WelcomeNext, null>): boolean =>
    (p === 'google' && !status.google) || (p === 'graph' && !status.microsoft)

  const dots = (
    <div className="flex items-center gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-accent' : 'bg-hairline'}`} />
      ))}
    </div>
  )

  return (
    <div className="gc-overlay select-none">
      <div className="gc-dialog flex w-full max-w-md flex-col gap-5 p-6" role="dialog" aria-label={t('welcome.title')}>
        {step === 0 && (
          <>
            <div>
              <h2 className="text-xl font-semibold text-primary">{t('welcome.title')}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{t('welcome.subtitle')}</p>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted">{t('settings.language')}</div>
              <div className="flex gap-2">
                {(
                  [
                    ['en', 'English'],
                    ['vi', 'Tiếng Việt']
                  ] as const
                ).map(([locale, name]) => (
                  <button
                    key={locale}
                    type="button"
                    className={`flex-1 justify-center ${language === locale ? 'gc-btn-primary' : 'gc-btn'}`}
                    onClick={() => onSetLanguage(locale)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <ToggleSwitch
              checked={showLunar}
              onChange={onToggleLunar}
              label={t('settings.lunar')}
              description={t('welcome.lunarHint')}
            />
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-primary">{t('welcome.basicsTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('welcome.basicsSubtitle')}</p>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted">{t('holidays.title')}</div>
              <HolidayCalendarToggle calendars={calendars} onCalendarsChanged={onCalendarsChanged} />
            </div>
            <ToggleSwitch
              checked={launchAtLogin}
              onChange={setLaunchAtLogin}
              label={t('settings.launchAtLogin')}
              description={t('settings.launchAtLoginHint')}
            />
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-primary">{t('welcome.connectTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('welcome.connectSubtitle')}</p>
            </div>
            <div className="-mx-2 flex flex-col gap-0.5">
              {CONNECTABLE.map((provider) => (
                <NavRow
                  key={provider}
                  icon={<ProviderMark kind={provider} />}
                  title={t(`addAccount.providers.${provider}.title`)}
                  subtitle={
                    needsSetup(provider)
                      ? t('addAccount.needsSetup')
                      : t(`addAccount.providers.${provider}.detail`)
                  }
                  onClick={() => onFinish(provider, launchAtLogin)}
                />
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-2">
          {dots}
          <div className="flex gap-2">
            {step > 0 && (
              <button type="button" className="gc-btn" onClick={() => setStep((s) => s - 1)}>
                {t('common.back')}
              </button>
            )}
            {step < 2 ? (
              <button type="button" className="gc-btn-primary" onClick={() => setStep((s) => s + 1)}>
                {t('welcome.next')}
              </button>
            ) : (
              <button type="button" className="gc-btn" onClick={() => onFinish(null, launchAtLogin)}>
                {t('welcome.notNow')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default WelcomeDialog
