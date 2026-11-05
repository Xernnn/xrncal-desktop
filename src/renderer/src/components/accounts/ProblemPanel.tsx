import React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import type { ConnectProblem } from '../../lib/account-display'

/** Why it failed, in words, with the raw message kept underneath for anything we did not recognise. */
export const ProblemPanel: React.FC<{ problem: ConnectProblem; raw?: string; provider: string }> = ({ problem, raw, provider }) => {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex gap-2 border border-today/40 px-3 py-2.5 text-xs"
      style={{ borderRadius: 'var(--radius-control)' }}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-today" />
      <div className="min-w-0 space-y-1">
        <div className="text-primary">{t(`addAccount.problems.${problem}`, { provider })}</div>
        {raw && <div className="break-words text-muted select-text">{t('addAccount.details', { msg: raw })}</div>}
      </div>
    </div>
  )
}
