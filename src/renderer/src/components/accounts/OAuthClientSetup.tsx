import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import {
  MICROSOFT_REDIRECT_URI,
  cleanOAuthClientForm,
  oauthClientProblem,
  type OAuthClientInfo,
  type OAuthClientProblem,
  type OAuthProvider
} from '@shared/oauth-client'
import { classifyConnectError } from '../../lib/account-display'
import { TextInput } from '../ui'
import { ProblemPanel } from './ProblemPanel'

interface Step {
  /** Its text, under `addAccount.clientSetup.<provider>`. */
  key: string
  link?: string
  /** Something to copy, which the dialog's `select-none` would otherwise stop. */
  code?: string
}

const STEPS: Record<OAuthProvider, Step[]> = {
  google: [
    { key: 'project', link: 'https://console.cloud.google.com/projectcreate' },
    { key: 'calendarApi', link: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com' },
    { key: 'branding', link: 'https://console.cloud.google.com/auth/overview' },
    { key: 'publish', link: 'https://console.cloud.google.com/auth/audience' },
    { key: 'client', link: 'https://console.cloud.google.com/auth/clients/create' }
  ],
  microsoft: [
    { key: 'register', link: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
    { key: 'audience' },
    { key: 'redirect', code: MICROSOFT_REDIRECT_URI },
    { key: 'permissions' },
    { key: 'publicClient' },
    { key: 'copyId' }
  ]
}

/** What each field's value looks like. An example of a format, not words to translate. */
const ID_PLACEHOLDER: Record<OAuthProvider, string> = {
  google: '123456789012-abc123.apps.googleusercontent.com',
  microsoft: '12345678-1234-1234-1234-123456789012'
}

interface OAuthClientSetupProps {
  provider: OAuthProvider
  /** Shown to people, e.g. "Microsoft". */
  providerName: string
  info: OAuthClientInfo
  /** Accounts signed in with the current details, which are tied to them. */
  connected: number
  /** Saved or removed. The parent reads the state again. */
  onDone: () => void
  /** Absent when there is nothing to go back to. */
  onCancel?: () => void
}

/**
 * A place to enter the OAuth client for a copy of xrncal that has none, so
 * nobody has to edit a file to sign in. The steps say what to press, since
 * making a client is the hard part for someone who has never seen these
 * consoles. The secret is write-only: it is never sent back to fill the field.
 *
 * Not autofocused: focus would scroll the steps out of view.
 */
export const OAuthClientSetup: React.FC<OAuthClientSetupProps> = ({ provider, providerName, info, connected, onDone, onCancel }) => {
  const { t } = useTranslation()
  const [clientId, setClientId] = useState(info.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [problem, setProblem] = useState<OAuthClientProblem | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const auth = window.xrncal?.auth
  const usesSecret = provider === 'google'
  const keepsSecret = info.hasSecret && clientId.trim() === info.clientId

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setProblem(null)
    setFailure(null)
  }

  const act = async (call: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      await call()
      onDone()
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const form = cleanOAuthClientForm({ clientId, clientSecret })
    const found = oauthClientProblem(provider, form, keepsSecret)
    setProblem(found)
    if (found || !info.canSave || !auth) return
    void act(() => auth.saveOAuthClient(provider, form))
  }

  const remove = () => {
    if (!auth) return
    if (connected > 0 && !window.confirm(t('addAccount.clientSetup.removeConfirm', { provider: providerName }))) return
    void act(() => auth.clearOAuthClient(provider))
  }

  const message = (found: OAuthClientProblem): string =>
    found === 'idFormat'
      ? t(`addAccount.clientSetup.${provider}.idFormat`)
      : t(`addAccount.clientSetup.problems.${found}`)
  const secretProblem = problem === 'secretMissing' || problem === 'secretFormat' ? problem : null
  const idProblem = problem === 'idMissing' || problem === 'idFormat' ? problem : null

  return (
    // noValidate: the checks are ours, in words, not the browser's bubbles.
    <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
      <p className="text-sm text-primary">{t(`addAccount.clientSetup.${provider}.intro`)}</p>

      <ol
        className="space-y-2 border border-hairline bg-hover/40 px-3 py-2.5 text-xs"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        {STEPS[provider].map((step, index) => (
          <li key={step.key} className="flex gap-2">
            <span className="shrink-0 text-muted tabular-nums">{index + 1}.</span>
            <span className="min-w-0 text-primary">
              {t(`addAccount.clientSetup.${provider}.${step.key}`)}
              {step.code && <code className="mt-0.5 block break-all select-text">{step.code}</code>}
              {step.link && (
                <a
                  href={step.link}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {t('addAccount.clientSetup.open')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </span>
          </li>
        ))}
      </ol>

      {usesSecret && <p className="text-xs text-muted">{t('addAccount.clientSetup.google.unverified')}</p>}

      {!info.canSave && <ProblemPanel problem="keyring" provider={providerName} />}

      <TextInput
        label={t(usesSecret ? 'addAccount.clientSetup.clientId' : 'addAccount.clientSetup.applicationId')}
        variant="boxed"
        value={clientId}
        onChange={edit(setClientId)}
        placeholder={ID_PLACEHOLDER[provider]}
        error={idProblem ? message(idProblem) : undefined}
        disabled={!info.canSave}
      />
      {usesSecret && (
        <TextInput
          label={t('addAccount.clientSetup.clientSecret')}
          variant="boxed"
          type="password"
          value={clientSecret}
          onChange={edit(setClientSecret)}
          placeholder={keepsSecret ? t('addAccount.clientSetup.secretKept') : 'GOCSPX-…'}
          error={secretProblem ? message(secretProblem) : undefined}
          disabled={!info.canSave}
        />
      )}

      <p className="text-xs text-muted">
        {t('addAccount.clientSetup.privacy', { provider: providerName })}
        {connected > 0 && <> {t('addAccount.clientSetup.reconnect', { provider: providerName })}</>}
      </p>

      {failure && <ProblemPanel problem={classifyConnectError(failure)} raw={failure} provider={providerName} />}

      <div className="flex items-center justify-between gap-2">
        <div>
          {info.source === 'saved' && (
            <button type="button" className="gc-btn" disabled={busy} onClick={remove}>
              {t('addAccount.clientSetup.remove')}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" className="gc-btn" disabled={busy} onClick={onCancel}>
              {t('common.cancel')}
            </button>
          )}
          <button type="submit" className="gc-btn-primary" disabled={busy || !info.canSave}>
            {t('addAccount.clientSetup.save')}
          </button>
        </div>
      </div>
    </form>
  )
}
